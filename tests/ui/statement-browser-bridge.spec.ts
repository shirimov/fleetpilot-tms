import { randomUUID, randomBytes, createHash } from "node:crypto";
import { test, expect } from "playwright/test";
import { prisma } from "@/lib/prisma";
import { statementFixture } from "../fixtures/quickmanage";
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
  ).toBeEnabled();
  await page.getByLabel("Inventory evidence", { exact: true }).setInputFiles(
    upload("accidental-browser-export.json", {
      cookies: [{ name: "fake-session", value: "synthetic-do-not-upload" }],
    }),
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Credentials" }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  const f = statementFixture({ terminated: true });
  const inventory = inventoryEvidence(provider, [f]);
  await page
    .getByLabel("Inventory evidence", { exact: true })
    .setInputFiles(upload("inventory.json", inventory));
  await expect(
    page.getByRole("alert").filter({ hasText: "Unbound Company" }),
  ).toContainText("Unbound Company");
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
    page.getByText("Binding recorded", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Inventory evidence", { exact: true })
    .setInputFiles(upload("inventory.json", inventory));
  await expect(
    page.getByText(/Expected 1 · Captured 0 · Missing 1/),
  ).toBeVisible();
  await page
    .getByLabel("Statement evidence", { exact: true })
    .setInputFiles(
      upload("terminated-driver.json", bundleEvidence(provider, f)),
    );
  await expect(page.getByText(new RegExp("UUID " + f.id))).toBeVisible();
  await page
    .getByRole("button", { name: "Capture selected statements" })
    .click();
  await expect(
    page.getByText(/Expected 1 · Captured 1 · Missing 0/),
  ).toBeVisible();
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
});
