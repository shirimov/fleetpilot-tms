import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  validateCatalog,
  validateInventory,
  validateBundle,
  businessOnly,
  BRIDGE_UPLOAD_LIMIT,
} from "./archive-bridge-validation";
import { bridgeBody } from "./archive-bridge-http";
import { statementFixture } from "../../../tests/fixtures/quickmanage";
import {
  catalogEvidence,
  inventoryEvidence,
  bundleEvidence,
} from "../../../tests/fixtures/quickmanage-browser";
import { hash } from "./archive-normalize";
const companyId = randomUUID();
test("bridge validates discovered business contracts and terminated provider identity", () => {
  const f = statementFixture({ terminated: true, contractor: true });
  assert.equal(validateCatalog(catalogEvidence(companyId))[0].id, companyId);
  assert.equal(
    validateInventory(inventoryEvidence(companyId, [f])).items.length,
    1,
  );
  const n = validateBundle(bundleEvidence(companyId, f));
  assert.equal(n.normalized.header.recipientStatus, "terminated");
  assert.equal(n.normalized.header.grossMinor, BigInt("100001"));
});
for (const mutation of [
  "duplicate",
  "scope",
  "pid",
  "version",
  "money",
  "recipient",
  "unknown",
] as const)
  test("inventory rejects " + mutation, () => {
    const f = statementFixture(),
      e = inventoryEvidence(companyId, [f]);
    if (mutation === "duplicate") e.items.push(e.items[0]);
    if (mutation === "scope") e.items[0].carrier_id = randomUUID();
    if (mutation === "pid") e.pid = "2026-99";
    if (mutation === "version") e.items[0].version = "-1";
    if (mutation === "money") e.items[0].gross = "NaN";
    if (mutation === "recipient")
      Object.assign(e.items[0], { driver_id: "not-a-uuid" });
    if (mutation === "unknown")
      Object.assign(e, { downloadUrl: "https://example.test" });
    assert.throws(() => validateInventory(e));
  });
for (const mutation of [
  "mime",
  "signature",
  "size",
  "checksum",
  "identity",
  "version",
  "filename",
  "url",
  "secret",
  "money",
  "activePDF",
  "sourceChanged",
] as const)
  test("statement rejects " + mutation, () => {
    const f = statementFixture(),
      e = bundleEvidence(companyId, f);
    if (mutation === "mime") e.mimeType = "text/html";
    if (mutation === "signature")
      e.pdfBase64 = Buffer.from("no PDF").toString("base64");
    if (mutation === "size") e.pdfBase64 = "A".repeat(28 * 1024 * 1024);
    if (mutation === "checksum") e.pdfSha256 = "0".repeat(64);
    if (mutation === "identity") e.statementId = randomUUID();
    if (mutation === "version") e.version = 999;
    if (mutation === "filename")
      Object.assign(e, { filename: "../../secret.pdf" });
    if (mutation === "url") Object.assign(e, { url: "http://169.254.169.254" });
    if (mutation === "sourceChanged") e.detailAfterSha256 = "a".repeat(64);
    if (mutation === "secret" || mutation === "money") {
      const raw = JSON.parse(f.bundle.detail.toString());
      if (mutation === "secret") raw.data.authorization = "Bearer fake-secret";
      else raw.data.header.net_pay_info.gross = "bad";
      const bytes = Buffer.from(JSON.stringify(raw));
      e.detailBase64 = bytes.toString("base64");
      e.detailAfterSha256 = hash(bytes);
    }
    if (mutation === "activePDF") {
      const bytes = Buffer.from("%PDF-1.4\n/JavaScript fake\n%%EOF");
      e.pdfBase64 = bytes.toString("base64");
      e.pdfSha256 = hash(bytes);
    }
    assert.throws(() => validateBundle(e));
  });
test("credential rejection recurses into metadata and arbitrary URLs", () => {
  for (const x of [
    { metadata: { cookie: "fake" } },
    { data: { access_token: "fake" } },
    { notes: "https://api.quickmanage.com/download?signed=secret" },
  ])
    assert.throws(() => businessOnly(x));
});
test("upload boundary rejects CSRF, wrong MIME, malformed JSON and streamed oversize without content-length", async () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/finance/archive/bridge", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        ...headers,
      },
      body,
    });
  assert.deepEqual(await bridgeBody(req("{}")), {});
  await assert.rejects(() =>
    bridgeBody(req("{}", { origin: "https://app.quickmanage.com" })),
  );
  await assert.rejects(() =>
    bridgeBody(req("{}", { "content-type": "multipart/form-data" })),
  );
  await assert.rejects(() => bridgeBody(req("{")));
  await assert.rejects(() =>
    bridgeBody(
      req("{}", { "content-length": String(BRIDGE_UPLOAD_LIMIT + 1) }),
    ),
  );
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(BRIDGE_UPLOAD_LIMIT + 1));
      c.close();
    },
  });
  const r = new Request("http://localhost/api/finance/archive/bridge", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(() => bridgeBody(r));
});
test("boolean or object money in source lines is rejected, not normalized to null", () => {
  for (const amount of [true, {}, "Infinity"]) {
    const f = statementFixture();
    const raw = JSON.parse(f.bundle.detail.toString());
    raw.data.deductions[0].charge = amount;
    f.bundle.detail = Buffer.from(JSON.stringify(raw));
    assert.throws(() => validateBundle(bundleEvidence(companyId, f)));
  }
});
test("configured public origin works behind a proxy; forged forwarded origin is ignored", async () => {
  const previous = process.env.AUTH_URL;
  process.env.AUTH_URL = "https://fleetpilot.example.test";
  try {
    assert.deepEqual(
      await bridgeBody(
        new Request("http://internal:3000/api/finance/archive/bridge", {
          method: "POST",
          headers: {
            origin: "https://fleetpilot.example.test",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
      {},
    );
    await assert.rejects(() =>
      bridgeBody(
        new Request("http://internal:3000/api/finance/archive/bridge", {
          method: "POST",
          headers: {
            origin: "https://attacker.example.test",
            "x-forwarded-host": "attacker.example.test",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = previous;
  }
});
test("browser-side guard prevents credential-bearing or malformed exports from being sent", async () => {
  const { browserEvidenceGuard } = await import("./archive-browser-evidence");
  assert.throws(() =>
    browserEvidenceGuard({ cookies: [{ value: "synthetic-secret" }] }),
  );
  const f = statementFixture();
  const e = bundleEvidence(companyId, f);
  browserEvidenceGuard(e);
  const raw = JSON.parse(f.bundle.detail.toString());
  raw.data.headers = { authorization: "synthetic-secret" };
  e.detailBase64 = Buffer.from(JSON.stringify(raw)).toString("base64");
  assert.throws(() => browserEvidenceGuard(e));
});
test("inventory dates and all normalized money reject malformed or overflowing input", () => {
  for (const amount of [
    "NaN",
    "Infinity",
    "1e3",
    "1,000.00",
    "92233720368547758.08",
    "-92233720368547758.09",
  ]) {
    const f = statementFixture();
    const e = inventoryEvidence(companyId, [f]);
    e.items[0].gross = amount;
    assert.throws(() => validateInventory(e));
    const raw = JSON.parse(f.bundle.detail.toString());
    raw.data.header.ytd_info = { gross: amount };
    f.bundle.detail = Buffer.from(JSON.stringify(raw));
    assert.throws(() => validateBundle(bundleEvidence(companyId, f)));
  }
  for (const date of ["bad", "2026-02-30", "2027-01-01"]) {
    const e = inventoryEvidence(companyId, [statementFixture()]);
    e.items[0].start_date = date;
    assert.throws(() => validateInventory(e));
  }
  for (const [amount, expected] of [
    ["0", "0"],
    ["12.34", "1234"],
    ["-12.34", "-1234"],
    ["92233720368547758.07", "9223372036854775807"],
    ["1.234", null],
  ] as const) {
    const f = statementFixture();
    const raw = JSON.parse(f.bundle.detail.toString());
    raw.data.header.net_pay_info.gross = amount;
    f.bundle.detail = Buffer.from(JSON.stringify(raw));
    const n = validateBundle(bundleEvidence(companyId, f)).normalized;
    assert.equal(n.header.grossMinor?.toString() ?? null, expected);
    if (expected === null) assert.ok(n.issues.length);
  }
});
test("business-only uploads reject credentials, URL variants, excess count and depth", () => {
  for (const key of [
    "password",
    "sessionToken",
    "Authorization",
    "csrf",
    "localStorage",
    "signed_url",
  ]) {
    assert.throws(() => businessOnly({ nested: { [key]: "synthetic" } }));
  }
  for (const url of [
    "http://localhost",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://169.254.169.254/latest/meta-data",
    "https://example.test/redirect",
  ]) {
    assert.throws(() => businessOnly({ note: url }));
  }
  const e = inventoryEvidence(companyId, [statementFixture()]);
  e.items = Array.from({ length: 2001 }, () => e.items[0]);
  assert.throws(() => validateInventory(e));
  let nested: unknown = "value";
  for (let i = 0; i < 32; i++) nested = { nested };
  assert.throws(() => businessOnly(nested));
  assert.throws(() =>
    validateBundle([bundleEvidence(companyId, statementFixture())]),
  );
});
