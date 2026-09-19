import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { prisma } from "@/lib/prisma";
import { ArchiveService } from "@/lib/finance/archive-service";
import { FinancialControlService } from "@/lib/finance/financial-control-service";
import type { FinancialAuthorization } from "@/lib/finance/financial-control-authorization";
import {
  FixtureArchiveProvider,
  statementFixture,
} from "../fixtures/quickmanage";

test("Statements archive shows scoped inventory, immutable history, bounded capture and original checksums", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  const company = await prisma.company.create({
      data: { name: "Archive UI " + randomUUID() },
    }),
    user = await prisma.user.create({
      data: {
        email: randomUUID() + "@example.test",
        displayName: "Archive UI Owner",
        activeCompanyId: company.id,
        memberships: { create: { companyId: company.id, role: "OWNER" } },
      },
    });
  const group = await new FinancialControlService().createGroup(
    "Archive UI group",
    {
      companyId: company.id,
      role: "OWNER",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        activeCompanyId: company.id,
        isActive: true,
      },
    },
  );
  const c: FinancialAuthorization = {
    userId: user.id,
    activeCompanyId: company.id,
    companyIds: [company.id],
    operatingGroupId: group.id,
    role: "OWNER",
  };
  const provider = new FixtureArchiveProvider(),
    service = new ArchiveService(),
    binding = await service.bind(company.id, provider.companyId, provider, c);
  provider.fixtures = [
    statementFixture(),
    statementFixture({ contractor: true }),
    statementFixture({ terminated: true }),
    statementFixture(),
  ];
  const snapshot = await service.discover(binding.id, "2026-37", provider, c),
    items = await prisma.archiveInventoryItem.findMany({
      where: { inventoryId: snapshot.id },
    });
  await service.run(
    snapshot.id,
    items
      .filter((x) => x.providerStatementId !== provider.fixtures[3].id)
      .map((x) => x.id),
    provider,
    c,
  );
  const token = randomBytes(32).toString("base64url");
  await prisma.emailSignInToken.create({
    data: {
      userId: user.id,
      email: user.email,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 900000),
    },
  });
  await page.goto(`/login/email/verify#token=${token}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/tasks");
  await page.goto("/accounting?view=statements");
  await expect(
    page.getByRole("heading", { name: "Statement archive" }),
  ).toBeVisible();
  await expect(
    page.getByText("Archived statements", { exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Statement archive views" });
  await nav.getByRole("button", { name: "Completeness", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "INCOMPLETE", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "2026-37", exact: true }).click();
  await expect(
    page.getByText(/Expected 4 · Captured 3 · Missing 1/),
  ).toBeVisible();
  await expect(
    page.getByText(provider.fixtures[3].id, { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Expected 4 · Captured 3 · Missing 1/),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Statements", exact: true }).click();
  await expect(page.getByText("Page 1 · 3 records")).toBeVisible();
  await page.getByLabel("Recipient lifecycle").selectOption("terminated");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("Page 1 · 1 records")).toBeVisible();
  await page.getByRole("button", { name: "2026-37 / 21", exact: true }).click();
  await expect(
    page.getByText("Synthetic Recipient · DRIVER · terminated", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("Details / Audit", { exact: true }).click();
  await expect(page.getByText(/Provider UUID:/)).toBeVisible();
  await expect(
    page.getByText("Unclassified source charge", { exact: true }),
  ).toBeVisible();
  const href = await page
    .getByRole("link", { name: "Original PDF" })
    .getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({ path: `test-results/archive-detail-${width}.png` });
  }
  await nav.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Browser-assisted capture" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Capture selected statements" }),
  ).toBeDisabled();
  await nav.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Upload statement" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Browser-assisted capture" }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("unauthenticated archive and original requests disclose no records", async ({
  request,
}) => {
  expect(
    (await request.get("/api/finance/archive?view=statements")).status(),
  ).toBe(401);
  expect(
    (await request.get("/api/finance/archive?download=unknown")).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/finance/archive", {
        data: {
          action: "capture",
          inventoryId: "unknown",
          itemIds: ["unknown"],
        },
      })
    ).status(),
  ).toBe(401);
});
