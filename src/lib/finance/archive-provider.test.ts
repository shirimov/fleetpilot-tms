import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { QuickManageArchiveProvider } from "./archive-provider";
import { statementFixture } from "../../../tests/fixtures/quickmanage";
const response = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
test("inventory compares complete identity manifests twice, uses combined historical search and explicit company", async () => {
  const company = randomUUID(),
    fixture = statementFixture({ terminated: true });
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const provider = new QuickManageArchiveProvider(
    "test",
    async () => ({ Authorization: "test-only" }),
    async (input, init) => {
      const url = String(input),
        body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      assert.equal(body.carrier_id, company);
      assert.equal(body.contractor, null);
      assert.deepEqual(body.statuses, []);
      return url.endsWith("/stats")
        ? response({ count: 1 })
        : response({
            items: [
              {
                carrier_id: company,
                statement_id: fixture.id,
                driver_id: fixture.recipientId,
                version: 1,
                batch_id: 202637,
                contractor: false,
              },
            ],
            has_more: false,
          });
    },
    async () => {},
  );
  const inventory = await provider.inventory(company, "2026-37");
  assert.equal(inventory.items.length, 1);
  assert.equal(inventory.metadata.verifiedTwice, true);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every((c) =>
      c.url.startsWith("https://api.quickmanage.com/api/payroll/statements"),
    ),
  );
});
test("equal counts with replaced identities do not seal inventory", async () => {
  const company = randomUUID();
  let pageCalls = 0;
  const provider = new QuickManageArchiveProvider(
    "test",
    async () => ({}),
    async (input) =>
      String(input).endsWith("/stats")
        ? response({ count: 1 })
        : response({
            items: [
              {
                carrier_id: company,
                statement_id: randomUUID(),
                driver_id: randomUUID(),
                version: 1,
                batch_id: 202637,
                contractor: false,
                order: pageCalls++,
              },
            ],
            has_more: false,
          }),
    async () => {},
  );
  await assert.rejects(
    () => provider.inventory(company, "2026-37"),
    /INVENTORY_CHANGED/,
  );
});
test("duplicate source identity and cross-company rows fail closed", async () => {
  for (const foreign of [false, true]) {
    const company = randomUUID(),
      row = {
        carrier_id: foreign ? randomUUID() : company,
        statement_id: randomUUID(),
        driver_id: randomUUID(),
        version: 1,
        batch_id: 202637,
        contractor: false,
      };
    const p = new QuickManageArchiveProvider(
      "test",
      async () => ({}),
      async (input) =>
        String(input).endsWith("/stats")
          ? response({ count: 2 })
          : response({ items: [row, row], has_more: false }),
      async () => {},
    );
    await assert.rejects(
      () => p.inventory(company, "2026-37"),
      /INVENTORY_INCOMPLETE|COMPANY_MISMATCH/,
    );
  }
});
test("bundle only reads detail/PDF/detail; changing source or non-PDF content fails", async () => {
  const company = randomUUID(),
    f = statementFixture();
  let requests = 0;
  const p = new QuickManageArchiveProvider(
    "test",
    async () => ({}),
    async (input, init) => {
      requests++;
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      return String(input).includes("/download?")
        ? new Response(f.bundle.pdf)
        : new Response(f.bundle.detail);
    },
    async () => {},
  );
  assert.equal((await p.bundle(company, f.id)).pdf.length, f.bundle.pdf.length);
  assert.equal(requests, 3);
  const bad = new QuickManageArchiveProvider(
    "test",
    async () => ({}),
    async (input) =>
      String(input).includes("/download?")
        ? new Response("<html>login</html>")
        : new Response(f.bundle.detail),
    async () => {},
  );
  await assert.rejects(() => bad.bundle(company, f.id), /INVALID_PDF/);
});
test("auth boundary is not retried and provider bodies/tokens never become errors", async () => {
  let calls = 0;
  const p = new QuickManageArchiveProvider(
    "test",
    async () => ({}),
    async () => {
      calls++;
      return new Response("secret-token-do-not-log", { status: 403 });
    },
    async () => {},
  );
  await assert.rejects(
    () => p.companies(),
    (e) => e instanceof Error && e.message === "AUTHENTICATION_REQUIRED",
  );
  assert.equal(calls, 1);
});
test("429 retry honors Retry-After and bounded retry/oversize limits", async () => {
  let calls = 0;
  const waits: number[] = [];
  const p = new QuickManageArchiveProvider(
    "test",
    async () => ({}),
    async () =>
      ++calls < 3
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : response([]),
    async (ms) => {
      waits.push(ms);
    },
  );
  await p.companies();
  assert.deepEqual(waits, [2000, 2000]);
  const huge = new QuickManageArchiveProvider(
    "test",
    async () => ({}),
    async () =>
      new Response("x", { headers: { "Content-Length": "999999999" } }),
    async () => {},
  );
  await assert.rejects(() => huge.companies(), /SOURCE_TOO_LARGE/);
});
