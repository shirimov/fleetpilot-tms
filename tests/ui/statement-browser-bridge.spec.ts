import { randomUUID, randomBytes, createHash } from "node:crypto";
import { test, expect } from "playwright/test";
import { prisma } from "@/lib/prisma";
import { tripTiesFixture } from "../fixtures/quickmanage-trip-ties";
import {
  catalogEvidence,
  inventoryEvidence,
  bundleEvidence,
} from "../fixtures/quickmanage-browser";
const upload = (name: string, value: unknown) => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});
test("OWNER review, unbound rejection, inventory preview, selected capture and duplicate/resume work without provider credentials", async ({
  page,
}) => {
  test.setTimeout(90000);
  const provider = randomUUID(),
    company = await prisma.company.create({
      data: { name: "Synthetic Carrier" },
    }),
    user = await prisma.user.create({
      data: {
        email: randomUUID() + "@example.test",
        displayName: "Browser bridge UI",
        activeCompanyId: company.id,
        memberships: { create: { companyId: company.id, role: "OWNER" } },
      },
    });
  await prisma.operatingGroup.create({
    data: {
      id: "bridge-ui-synthetic",
      name: "Bridge UI",
      companies: { create: { companyId: company.id } },
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const token = randomBytes(32).toString("base64url");
  await prisma.emailSignInToken.create({
    data: {
      userId: user.id,
      email: user.email,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 900000),
    },
  });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (
      r.url().includes("/api/finance/archive/bridge") &&
      r.method() === "POST"
    )
      requests.push(r.postData() ?? "");
  });
  await page.goto("/login/email/verify#token=" + token);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/tasks");
  await page.goto("/accounting?view=statements&archive=capture");
  await expect(
    page.getByRole("heading", { name: "Browser-assisted capture" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Completeness means complete against the/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Inventory evidence", { exact: true }),
  ).toBeDisabled();
  const f = tripTiesFixture();
  [f.payload.data.trips[7], f.payload.data.trips[8]] = [
    f.payload.data.trips[8],
    f.payload.data.trips[7],
  ];
  const after = Buffer.from(JSON.stringify(f.payload));
  const evidence = {
    ...bundleEvidence(provider, f),
    detailAfterBase64: after.toString("base64"),
    detailAfterSha256: createHash("sha256").update(after).digest("hex"),
  };
  const inventory = inventoryEvidence(provider, [f]);
  await page
    .getByLabel("Company catalog", { exact: true })
    .setInputFiles(upload("companies.json", catalogEvidence(provider)));
  await expect(
    page.getByRole("cell", { name: /NEEDS_CONFIRMATION/ }),
  ).toBeVisible();
  await page
    .getByLabel("Canonical Company for Synthetic Carrier")
    .selectOption(company.id);
  await page
    .getByLabel("Identity evidence for Synthetic Carrier")
    .fill("Synthetic identity verified by OWNER");
  await page
    .getByLabel(
      "I verified that these provider and canonical identities refer to the same Company.",
    )
    .check();
  await page.getByRole("button", { name: "Confirm Company binding" }).click();
  await expect(
    page.getByText("Not authorized for this run", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Run label").fill("Synthetic UI capture run");
  await page
    .getByRole("checkbox", {
      name: new RegExp("Synthetic Carrier — " + provider),
    })
    .check();
  await page.getByRole("button", { name: "Create draft run" }).click();
  await page.getByRole("button", { name: "Activate run" }).click();
  await expect(
    page.getByText("Authorized for this run", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Status: ACTIVE/)).toBeVisible();
  await page.getByLabel("Inventory evidence", { exact: true }).setInputFiles(
    upload("secret.json", {
      cookies: [{ name: "fake", value: "do-not-upload" }],
    }),
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Only QuickManage business evidence" }),
  ).toBeVisible();
  await page
    .getByLabel("Inventory evidence", { exact: true })
    .setInputFiles(upload("inventory.json", inventory));
  await expect(
    page.getByText(/Expected 1 · Captured 0 · Missing 1/),
  ).toBeVisible();
  await page
    .getByLabel("Statement evidence", { exact: true })
    .setInputFiles(upload("terminated-driver.json", evidence));
  await expect(page.getByText(new RegExp("UUID " + f.id))).toBeVisible();
  await page
    .getByRole("button", { name: "Capture selected statements" })
    .click();
  await expect(
    page.getByText(/Expected 1 · Captured 1 · Missing 0/),
  ).toBeVisible();
  // A fresh raw ordering of the same version reuses the immutable first capture.
  await page.getByLabel("Statement evidence", { exact: true }).setInputFiles(
    upload(
      "reordered.json",
      bundleEvidence(provider, {
        ...f,
        bundle: { ...f.bundle, detail: after },
      }),
    ),
  );
  await page
    .getByRole("button", { name: "Capture selected statements" })
    .click();
  await expect(
    page.getByText("Processed 1 submissions; 1 unchanged duplicates."),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({ path: `test-results/browser-bridge-${width}.png` });
  }
  const id = await page.getByLabel("Resume inventory ID").inputValue();
  await page.reload();
  await page.getByLabel("Resume inventory ID").fill(id);
  await page.getByRole("button", { name: "Load archive progress" }).click();
  await expect(
    page.getByText(/Expected 1 · Captured 1 · Missing 0/),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "Review archived recipients, trucks and versions",
    })
    .click();
  await expect(
    page.getByRole("cell", { name: /Synthetic Recipient.*terminated/ }),
  ).toBeVisible();
  expect(
    requests.every(
      (x) =>
        !/(access_token|authorization|cookie|csrf|password|signed_url)/i.test(
          x,
        ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /quickmanage|bridge/i.test(k)),
    ),
  ).toEqual([]);
  await expect(
    page.getByRole("cell", { name: /Synthetic Recipient/ }).first(),
  ).toBeVisible();
  await page.goto("/accounting?view=statements&archive=capture");
  await page.getByRole("button", { name: "Close run", exact: true }).click();
  await expect(
    page.getByLabel("Inventory evidence", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/No active run/)).toBeVisible();
  const priorRequest = JSON.parse(
    requests.find((x) => JSON.parse(x).action === "inventory")!,
  );
  const denied = await page.request.post("/api/finance/archive/bridge", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: priorRequest,
  });
  expect(denied.status()).toBe(403);
  const tampered = await page.request.post("/api/finance/archive/bridge", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { ...priorRequest, allowedProviderCompanyIds: [randomUUID()] },
  });
  expect(tampered.status()).toBe(400);
});
