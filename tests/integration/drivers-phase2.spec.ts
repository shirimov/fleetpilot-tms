import {
  expect,
  test,
  request as playwrightRequest,
  type APIRequestContext,
} from "playwright/test";
import { encode } from "next-auth/jwt";
import { prisma } from "../../src/lib/prisma";
import { readdir } from "node:fs/promises";
import path from "node:path";
const database = new URL(process.env.DATABASE_URL || "postgresql://invalid/");
if (
  database.hostname !== "127.0.0.1" ||
  database.port !== "15439" ||
  database.pathname !== "/fleetpilot_drivers_verify" ||
  process.env.AUTH_SECRET !== "fleetpilot-drivers-db-test-only"
)
  throw new Error(
    "Phase 2 tests require the dedicated disposable database and auth secret.",
  );
const storageRoot = process.env.PRIVATE_FILE_STORAGE_ROOT;
if (
  !storageRoot ||
  path.basename(storageRoot) !== "private-storage" ||
  !path.basename(path.dirname(storageRoot)).startsWith("drivers-pr99-verify.")
)
  throw new Error(
    "Phase 2 document tests require the disposable runner storage directory.",
  );
const tag = `phase2-${Date.now()}`;
let companyA = "",
  companyB = "",
  driverId = "",
  foreignDriver = "",
  adminId = "",
  documentId = "",
  versionId = "";
let admin: APIRequestContext,
  foreign: APIRequestContext,
  staff: APIRequestContext,
  safety: APIRequestContext;
const users: string[] = [],
  clients: APIRequestContext[] = [];
const pdf = Buffer.from("%PDF-1.4\nSynthetic qualification fixture v1\n%%EOF");
const replacement = Buffer.from(
  "%PDF-1.4\nSynthetic qualification fixture v2\n%%EOF",
);
const date = (days: number) => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
  )
    .toISOString()
    .slice(0, 10);
};
const core = {
  firstName: "Phase Two",
  lastName: "Preview",
  phone: "555-0101",
  email: "phase2@example.test",
  licenseNum: "PRIVATE-TEST-CDL",
  payType: "PERCENTAGE",
  payRate: "25",
  truckId: "",
};
async function account(
  name: string,
  companyId: string,
  role: "ADMIN" | "MEMBER",
  job?: "DISPATCHER" | "SAFETY",
) {
  const user = await prisma.user.create({
    data: {
      email: `${tag}-${name}@example.test`,
      displayName: `Test ${name}`,
      activeCompanyId: companyId,
      memberships: { create: { companyId, role } },
    },
  });
  users.push(user.id);
  if (job)
    await prisma.employee.create({
      data: {
        companyId,
        userId: user.id,
        firstName: name,
        lastName: tag,
        role: job,
      },
    });
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    token: { userId: user.id },
    maxAge: 3600,
  });
  const client = await playwrightRequest.newContext({
    baseURL: "http://127.0.0.1:3124",
    extraHTTPHeaders: { Cookie: `authjs.session-token=${token}` },
  });
  clients.push(client);
  return { id: user.id, client };
}
const upload = (
  client: APIRequestContext,
  id: string,
  type = "CDL_FRONT",
  bytes = pdf,
  extra: Record<string, string> = {},
) =>
  client.post(`/api/drivers/${id}/documents`, {
    multipart: {
      type,
      issuedAt: date(-100),
      expiresAt: date(20),
      ...extra,
      file: {
        name: "synthetic-cdl.pdf",
        mimeType: "application/pdf",
        buffer: bytes,
      },
    },
  });
test.beforeAll(async () => {
  companyA = (
    await prisma.company.create({
      data: { name: `${tag} · Synthetic Company A` },
    })
  ).id;
  companyB = (
    await prisma.company.create({
      data: { name: `${tag} · Synthetic Company B` },
    })
  ).id;
  const a = await account("admin", companyA, "ADMIN");
  admin = a.client;
  adminId = a.id;
  foreign = (await account("foreign", companyB, "ADMIN")).client;
  const s = await account("dispatcher", companyA, "MEMBER", "DISPATCHER");
  staff = s.client;
  const reader = await account("safety", companyA, "MEMBER", "SAFETY");
  safety = reader.client;
  // Legacy drivers retain null employment fields after the additive migration.
  driverId = (
    await prisma.driver.create({
      data: {
        companyId: companyA,
        firstName: core.firstName,
        lastName: core.lastName,
        payRate: 25,
        licenseNum: core.licenseNum,
      },
    })
  ).id;
  foreignDriver = (
    await prisma.driver.create({
      data: {
        companyId: companyB,
        firstName: "Foreign",
        lastName: tag,
        payRate: 0,
      },
    })
  ).id;
});
test("employment persistence preserves legacy unknowns, team relations, emergency privacy and audit history", async () => {
  expect(
    (await prisma.driver.findUniqueOrThrow({ where: { id: driverId } }))
      .employmentStatus,
  ).toBeNull();
  const before = await prisma.driver.findUniqueOrThrow({
    where: { id: driverId },
  });
  const response = await admin.patch(`/api/drivers/${driverId}`, {
    data: {
      ...core,
      employmentStatus: "ACTIVE",
      driverType: "COMPANY",
      employmentStartDate: date(-200),
      homeTerminal: "Chicago terminal",
      emergencyContactName: "Private Test Contact",
      emergencyContactPhone: "555-0198",
      emergencyContactRelation: "Sibling",
      teamName: "Blue Team",
      expectedUpdatedAt: before.updatedAt.toISOString(),
    },
  });
  expect(response.status()).toBe(200);
  const stored = await prisma.driver.findUniqueOrThrow({
    where: { id: driverId },
    include: { team: true },
  });
  expect(stored).toMatchObject({
    employmentStatus: "ACTIVE",
    driverType: "COMPANY",
    homeTerminal: "Chicago terminal",
    team: { companyId: companyA, name: "Blue Team" },
  });
  expect(
    (
      await admin.patch(`/api/drivers/${driverId}`, {
        data: { ...core, expectedUpdatedAt: before.updatedAt.toISOString() },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await admin.patch(`/api/drivers/${driverId}`, { data: core })).status(),
  ).toBe(200);
  expect(
    (await prisma.driver.findUniqueOrThrow({ where: { id: driverId } }))
      .employmentStatus,
  ).toBe("ACTIVE");
  const limited = await (await staff.get(`/api/drivers/${driverId}`)).json();
  expect(limited.licenseNum).toBeNull();
  expect(limited.emergencyContactName).toBeNull();
  expect(limited.homeTerminal).toBe("Chicago terminal");
  expect(
    (
      await admin.patch(`/api/drivers/${driverId}`, {
        data: {
          ...core,
          employmentStartDate: "2026-10-24",
          terminationDate: "2026-01-01",
        },
      })
    ).status(),
  ).toBe(400);
  const events = await prisma.driverAudit.findMany({ where: { driverId } });
  expect(events.length).toBeGreaterThan(0);
  expect(JSON.stringify(events)).not.toContain("Private Test Contact");
});
test("secure uploads persist privately with authorized downloads, alerts, and missing requirements", async () => {
  const response = await upload(admin, driverId);
  expect(response.status()).toBe(201);
  const document = await response.json();
  documentId = document.id;
  versionId = document.currentVersion.id;
  const stored = await prisma.driverDocumentVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  expect(stored.byteSize).toBe(pdf.length);
  expect(stored.storageKey).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.stringify(document)).not.toContain(stored.storageKey);
  const url = `/api/drivers/${driverId}/documents/${documentId}/versions/${versionId}`;
  const download = await admin.get(url);
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(pdf);
  expect(download.headers()["cache-control"]).toContain("no-store");
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect((await staff.get(url)).status()).toBe(403);
  expect((await staff.get(`/api/drivers/${driverId}/documents`)).status()).toBe(
    403,
  );
  expect((await safety.get(url)).status()).toBe(200);
  expect((await upload(safety, driverId, "MVR")).status()).toBe(403);
  expect((await foreign.get(url)).status()).toBe(404);
  expect(
    (
      await admin.get(
        `/api/drivers/${foreignDriver}/documents/${documentId}/versions/${versionId}`,
      )
    ).status(),
  ).toBe(404);
  const roster = await (await admin.get("/api/drivers")).json();
  const driver = roster.find(
    (driver: { id: string }) => driver.id === driverId,
  );
  expect(driver.documentAlerts).toMatchObject({
    within30: 1,
    within60: 1,
    within90: 1,
    expired: 0,
  });
  expect(driver.documentAlerts.missingRequired).toHaveLength(6);
  const preview = await admin.get(url + "?preview=1");
  expect(preview.headers()["content-disposition"]).toContain("attachment");
});
test("replacement and date corrections append immutable versions; stale concurrent replacements cannot overwrite", async () => {
  const response = await upload(admin, driverId, "CDL_FRONT", replacement, {
    documentId,
    expectedVersionId: versionId,
    expiresAt: date(70),
  });
  expect(response.status()).toBe(201);
  const v2 = (await response.json()).currentVersion;
  const stale = await upload(admin, driverId, "CDL_FRONT", pdf, {
    documentId,
    expectedVersionId: versionId,
  });
  expect(stale.status()).toBe(409);
  expect(
    await (
      await admin.get(
        `/api/drivers/${driverId}/documents/${documentId}/versions/${versionId}`,
      )
    ).body(),
  ).toEqual(pdf);
  const updates = await Promise.all(
    [1, 2].map(() =>
      admin.patch(`/api/drivers/${driverId}/documents/${documentId}`, {
        data: {
          issuedAt: date(-100),
          expiresAt: date(-1),
          expectedVersionId: v2.id,
        },
      }),
    ),
  );
  expect(updates.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  const history = await (
    await admin.get(`/api/drivers/${driverId}/documents/${documentId}`)
  ).json();
  expect(history.total).toBe(3);
  expect(
    history.versions.map((version: { version: number }) => version.version),
  ).toEqual([3, 2, 1]);
  const profile = await (await admin.get(`/api/drivers/${driverId}`)).json();
  expect(profile.documentAlerts).toMatchObject({
    expired: 1,
    within30: 0,
    within90: 0,
  });
  const v1 = await prisma.driverDocumentVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  expect(v1.expiresAt?.toISOString().slice(0, 10)).toBe(date(20));
});
test("rejects spoofed files, oversized uploads, unsafe metadata and cross-company document writes atomically", async () => {
  const before = await prisma.driverDocumentVersion.count({
    where: { document: { driverId } },
  });
  const folder = path.join(
    process.env.PRIVATE_FILE_STORAGE_ROOT!,
    "driver-documents",
  );
  const filesBefore = (await readdir(folder)).length;
  expect(
    (
      await admin.post(`/api/drivers/${driverId}/documents`, {
        multipart: {
          type: "MVR",
          file: { name: "mvr.png", mimeType: "image/png", buffer: pdf },
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await admin.post(`/api/drivers/${driverId}/documents`, {
        multipart: {
          type: "MVR",
          file: {
            name: "mvr.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
          },
        },
      })
    ).status(),
  ).toBe(400);
  expect((await upload(admin, foreignDriver, "MVR")).status()).toBe(404);
  expect(
    (
      await upload(admin, driverId, "MVR", pdf, { issuedAt: "2026-02-30" })
    ).status(),
  ).toBe(400);
  expect(
    await prisma.driverDocumentVersion.count({
      where: { document: { driverId } },
    }),
  ).toBe(before);
  expect((await readdir(folder)).length).toBe(filesBefore);
});
test("qualification reviews are attributed and append-only, never assert legal compliance, and preserve deletion protection", async () => {
  const response = await admin.post(`/api/drivers/${driverId}/qualification`, {
    data: {
      outcome: "NEEDS_FOLLOW_UP",
      notes: "Synthetic review: confirm medical certificate with reviewer.",
    },
  });
  expect(response.status()).toBe(201);
  expect(
    await prisma.driverQualificationReview.findFirstOrThrow({
      where: { driverId },
    }),
  ).toMatchObject({ reviewerId: adminId, outcome: "NEEDS_FOLLOW_UP" });
  expect(
    (await staff.get(`/api/drivers/${driverId}/qualification`)).status(),
  ).toBe(403);
  expect(
    (await safety.get(`/api/drivers/${driverId}/qualification`)).status(),
  ).toBe(200);
  expect(
    (
      await safety.post(`/api/drivers/${driverId}/qualification`, {
        data: { outcome: "REVIEWED", notes: "Not permitted" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await admin.post(`/api/drivers/${driverId}/qualification`, {
        data: { outcome: "COMPLIANT", notes: "Invalid auto compliance" },
      })
    ).status(),
  ).toBe(400);
  expect((await admin.delete(`/api/drivers/${driverId}`)).status()).toBe(409);
  expect(
    await prisma.driverDocumentVersion.count({
      where: { document: { driverId } },
    }),
  ).toBe(3);
  expect((await staff.get(`/api/drivers/${driverId}/activity`)).status()).toBe(
    403,
  );
  const events = await (
    await admin.get(`/api/drivers/${driverId}/activity`)
  ).json();
  expect(
    events.events.some(
      (event: { action: string }) => event.action === "QUALIFICATION_REVIEWED",
    ),
  ).toBe(true);
});
test("browser employment, document upload/history and qualification records preserve the approved desktop and mobile drawer", async ({
  page,
}) => {
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    token: { userId: adminId },
    maxAge: 3600,
  });
  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/drivers");
  await expect(
    page.getByRole("button", {
      name: "Open profile for Phase Two Preview",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/drivers-phase2-dashboard.png",
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByRole("button", {
      name: "Open profile for Phase Two Preview",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Employment & team" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit driver", exact: true }).click();
  await page
    .getByLabel("Employment status", { exact: true })
    .selectOption("ON_LEAVE");
  await page
    .getByLabel("Home terminal", { exact: true })
    .fill("Test Chicago terminal");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await prisma.driver.findUniqueOrThrow({ where: { id: driverId } }))
      .employmentStatus,
  ).toBe("ON_LEAVE");
  await page
    .getByRole("button", {
      name: "Open profile for Phase Two Preview",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Test Chicago terminal", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(
    page.getByText("synthetic-cdl.pdf", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add Document", exact: false })
    .click();
  await page
    .getByLabel("Document type", { exact: true })
    .selectOption("MEDICAL_CERTIFICATE");
  await page
    .getByLabel("Document expiration date", { exact: true })
    .fill(date(45));
  await page.getByLabel("Document file", { exact: true }).setInputFiles({
    name: "synthetic-medical.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await page.getByRole("button", { name: "Save document version" }).click();
  await expect(
    page.getByText("synthetic-medical.pdf", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/drivers-phase2-documents.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "History (3)", exact: true }).click();
  await expect(page.getByText("Version 1 ·", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "Safety", exact: true }).click();
  await page
    .getByLabel("Internal review outcome", { exact: true })
    .selectOption("REVIEWED");
  await page
    .getByLabel("Qualification review notes", { exact: true })
    .fill("Synthetic human review recorded; no legal compliance assertion.");
  await page
    .getByRole("button", { name: "Record qualification review" })
    .click();
  await expect(
    page.locator("article").getByText(
      "Synthetic human review recorded; no legal compliance assertion.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record qualification review" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "docs/screenshots/drivers-phase2-qualification.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.locator(".driver-profile-body").evaluate((element) => {
    element.scrollTop = 300;
  });
  await page.screenshot({
    path: "docs/screenshots/drivers-phase2-employment.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(
    page.getByText("synthetic-medical.pdf", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/drivers-phase2-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
});
test.afterAll(async () => {
  const driverIds = [driverId, foreignDriver].filter(Boolean);
  const documentIds = (
    await prisma.driverDocument.findMany({
      where: { driverId: { in: driverIds } },
      select: { id: true },
    })
  ).map((document) => document.id);
  await prisma.driverDocumentVersion.deleteMany({
    where: { documentId: { in: documentIds } },
  });
  await prisma.driverDocument.deleteMany({
    where: { id: { in: documentIds } },
  });
  await prisma.driverQualificationReview.deleteMany({
    where: { driverId: { in: driverIds } },
  });
  await prisma.driverAudit.deleteMany({
    where: { driverId: { in: driverIds } },
  });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  await prisma.driverTeam.deleteMany({
    where: { companyId: { in: [companyA, companyB].filter(Boolean) } },
  });
  await prisma.employee.deleteMany({ where: { userId: { in: users } } });
  await prisma.companyMembership.deleteMany({
    where: { userId: { in: users } },
  });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.company.deleteMany({
    where: { id: { in: [companyA, companyB].filter(Boolean) } },
  });
  await prisma.$disconnect();
  await Promise.all(clients.map((client) => client.dispose()));
});
