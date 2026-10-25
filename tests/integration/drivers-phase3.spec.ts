import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "playwright/test";
import { encode } from "next-auth/jwt";
import { prisma } from "../../src/lib/prisma";
import {
  configureReminderPolicy,
  runDriverReminders,
} from "../../src/lib/drivers/reminder-service";
import {
  backupDriverDocuments,
  restoreDriverDocuments,
  inspectDriverStorage,
} from "../../src/lib/drivers/document-recovery";
import { driverStorage } from "../../src/lib/drivers/document-storage";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
test.describe.configure({ mode: "serial" });
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/");
const root = process.env.PRIVATE_FILE_STORAGE_ROOT || "";
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "15439" ||
  url.pathname !== "/fleetpilot_drivers_verify" ||
  process.env.AUTH_SECRET !== "fleetpilot-drivers-db-test-only" ||
  path.basename(root) !== "private-storage" ||
  !path.basename(path.dirname(root)).startsWith("drivers-pr99-verify.") ||
  !process.env.DRIVERS_CLAMD_SOCKET?.startsWith(path.dirname(root) + "/")
)
  throw new Error("Disposable Phase 3 runner required.");
let companyId = "",
  foreignCompanyId = "",
  userId = "",
  foreignUserId = "",
  driverId = "",
  versionId = "",
  documentId = "";
let admin: APIRequestContext, foreign: APIRequestContext;
const pdf = Buffer.from(
  "%PDF-1.4\nSynthetic production-readiness fixture\n%%EOF",
);
const expiresAt = new Date(Date.now() + 85 * 86400000)
  .toISOString()
  .slice(0, 10);
const downloadUrl = () =>
  `/api/drivers/${driverId}/documents/${documentId}/versions/${versionId}`;
async function client(id: string) {
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    token: { userId: id },
    maxAge: 3600,
  });
  return playwrightRequest.newContext({
    baseURL: "http://127.0.0.1:3124",
    extraHTTPHeaders: { Cookie: `authjs.session-token=${token}` },
  });
}
async function upload(bytes = pdf, fields: Record<string, string> = {}) {
  return admin.post(`/api/drivers/${driverId}/documents`, {
    multipart: {
      type: "CDL_FRONT",
      expiresAt,
      ...fields,
      file: {
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        buffer: bytes,
      },
    },
  });
}
test.beforeAll(async () => {
  companyId = (
    await prisma.company.create({ data: { name: "Synthetic Phase3" } })
  ).id;
  foreignCompanyId = (
    await prisma.company.create({ data: { name: "Synthetic Phase3 Foreign" } })
  ).id;
  for (const company of [companyId, foreignCompanyId]) {
    const user = await prisma.user.create({
      data: {
        email: `phase3-${company}@example.test`,
        displayName: "Synthetic readiness admin",
        activeCompanyId: company,
        memberships: { create: { companyId: company, role: "ADMIN" } },
      },
    });
    if (company === companyId) userId = user.id;
    else foreignUserId = user.id;
  }
  driverId = (
    await prisma.driver.create({
      data: {
        companyId,
        firstName: "Synthetic",
        lastName: "Readiness",
        payRate: 0,
      },
    })
  ).id;
  admin = await client(userId);
  foreign = await client(foreignUserId);
});
test("clean protocol receipt, private encrypted bytes, company isolation and direct file URL denial", async () => {
  const response = await upload();
  expect(response.status()).toBe(201);
  const result = await response.json();
  documentId = result.id;
  versionId = result.currentVersion.id;
  const saved = await prisma.driverDocumentVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  expect(saved.scanStatus).toBe("CLEAN");
  expect(saved.scannedAt).not.toBeNull();
  const raw = await readFile(
    path.join(root, "driver-documents", saved.storageKey),
  );
  expect(raw.includes(pdf)).toBe(false);
  expect(raw.subarray(0, 7).toString()).toBe("FPDRV1:");
  expect(await (await admin.get(downloadUrl())).body()).toEqual(pdf);
  expect((await foreign.get(downloadUrl())).status()).toBe(404);
  expect(
    (await admin.get(`/driver-documents/${saved.storageKey}`)).status(),
  ).toBe(404);
  expect(
    (await admin.get(`/.data/driver-documents/${saved.storageKey}`)).status(),
  ).toBe(404);
  const historicalUrl = downloadUrl();
  const corrected = await admin.patch(
    `/api/drivers/${driverId}/documents/${documentId}`,
    { data: { expectedVersionId: versionId, expiresAt } },
  );
  expect(corrected.status()).toBe(200);
  versionId = (await corrected.json()).id;
  expect(await (await admin.get(historicalUrl)).body()).toEqual(pdf);
  expect(
    (
      await prisma.driverDocumentVersion.findUniqueOrThrow({
        where: { id: versionId },
      })
    ).scanStatus,
  ).toBe("CLEAN");
});
test("infected/error protocol responses retain quarantined evidence without replacing historical versions", async () => {
  for (const [marker, status, receipt] of [
    ["SIMULATE-INFECTED", 400, "INFECTED"],
    ["SIMULATE-ERROR", 503, "ERROR"],
  ] as const) {
    const response = await upload(Buffer.from(`%PDF-1.4\n${marker}\n%%EOF`), {
      documentId,
      expectedVersionId: versionId,
    });
    expect(response.status()).toBe(status);
    expect(
      await prisma.driverDocumentScan.count({
        where: { driverId, status: receipt },
      }),
    ).toBe(1);
  }
  expect(
    await prisma.driverDocumentVersion.count({ where: { documentId } }),
  ).toBe(2);
  expect(await (await admin.get(downloadUrl())).body()).toEqual(pdf);
  expect(
    await prisma.driverAudit.count({
      where: { driverId, action: "DOCUMENT_SCAN_ERROR" },
    }),
  ).toBe(1);
});
test("unscanned and revoked access are denied without modifying versions or files", async () => {
  await prisma.driverDocumentVersion.update({
    where: { id: versionId },
    data: { scanStatus: "UNSCANNED", scannedAt: null },
  });
  expect((await admin.get(downloadUrl())).status()).toBe(503);
  await prisma.driverDocumentVersion.update({
    where: { id: versionId },
    data: { scanStatus: "CLEAN", scannedAt: new Date() },
  });
  await prisma.companyMembership.updateMany({
    where: { userId },
    data: { role: "MEMBER" },
  });
  expect((await admin.get(downloadUrl())).status()).toBe(403);
  await prisma.companyMembership.updateMany({
    where: { userId },
    data: { role: "ADMIN" },
  });
  expect((await admin.get(downloadUrl())).status()).toBe(200);
});
test("scheduled threshold, missing and MVR reminders persist once under concurrent workers and stay company scoped", async () => {
  const mvr = await admin.post(`/api/drivers/${driverId}/documents`, {
    multipart: {
      type: "MVR",
      issuedAt: new Date(Date.now() - 330 * 86400000)
        .toISOString()
        .slice(0, 10),
      file: { name: "mvr.pdf", mimeType: "application/pdf", buffer: pdf },
    },
  });
  expect(mvr.status()).toBe(201);
  await configureReminderPolicy(companyId, {
    enabled: true,
    requiredTypes: ["CDL_FRONT", "MEDICAL_CERTIFICATE"],
    trackedTypes: ["CDL_FRONT", "MVR"],
    mvrReviewDays: 365,
  });
  const now = new Date();
  await Promise.all([
    runDriverReminders(companyId, now),
    runDriverReminders(companyId, now),
  ]);
  expect(await prisma.driverReminder.count({ where: { companyId } })).toBe(3);
  const initialPolicy = await prisma.driverReminderPolicy.findUniqueOrThrow({
    where: { companyId },
  });
  await configureReminderPolicy(companyId, {
    enabled: true,
    requiredTypes: ["CDL_FRONT", "MEDICAL_CERTIFICATE"],
    trackedTypes: ["CDL_FRONT", "MVR"],
    mvrReviewDays: 365,
  });
  expect(
    (
      await prisma.driverReminderPolicy.findUniqueOrThrow({
        where: { companyId },
      })
    ).revision,
  ).toBe(initialPolicy.revision);
  await runDriverReminders(companyId, now);
  expect(await prisma.driverReminder.count({ where: { companyId } })).toBe(3);
  for (const days of [30, 60, 86])
    await runDriverReminders(
      companyId,
      new Date(now.getTime() + days * 86400000),
    );
  expect(await prisma.driverReminder.count({ where: { companyId } })).toBe(8);
  expect(
    await prisma.driverAudit.count({
      where: { driverId, action: "REMINDER_CREATED" },
    }),
  ).toBe(8);
  const history = await (await admin.get("/api/drivers/reminders")).json();
  expect(history.total).toBe(8);
  expect(
    (await (await foreign.get("/api/drivers/reminders")).json()).total,
  ).toBe(0);
  const policy = await prisma.driverReminderPolicy.findUniqueOrThrow({
    where: { companyId },
  });
  expect(policy.lastSuccessAt).not.toBeNull();
  await configureReminderPolicy(companyId, {
    enabled: false,
    requiredTypes: [],
    trackedTypes: [],
  });
  expect(await runDriverReminders(companyId)).toEqual({
    enabled: false,
    created: 0,
  });
  expect(await prisma.driverReminder.count({ where: { companyId } })).toBe(8);
});
test("encrypted backup restores every historical blob and metadata; missing/corrupt/orphan detection is non-destructive", async () => {
  const parent = path.dirname(root),
    backup = path.join(parent, "document-backup"),
    restored = path.join(parent, "document-restore");
  const before = await inspectDriverStorage(companyId);
  expect(before.missing).toBe(0);
  expect(before.corrupt).toBe(0);
  const snapshot = await backupDriverDocuments(companyId, backup);
  expect(snapshot.files).toBe(6);
  expect(
    (await readFile(path.join(backup, "manifest.enc"))).includes(
      Buffer.from(companyId),
    ),
  ).toBe(false);
  expect(
    await restoreDriverDocuments(backup, restored, companyId),
  ).toMatchObject({ files: 6, versions: 3 });
  const metadata = JSON.parse(
    await readFile(path.join(restored, "document-metadata.json"), "utf8"),
  );
  const persisted = await prisma.driverDocumentVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  const filename = path.join(root, "driver-documents", persisted.storageKey),
    original = await readFile(filename);
  await unlink(filename);
  expect((await inspectDriverStorage(companyId)).missing).toBe(1);
  await writeFile(
    filename,
    await readFile(
      path.join(restored, "driver-documents", persisted.storageKey),
    ),
    { mode: 0o600 },
  );
  expect(
    metadata.versions.find(
      (version: { id: string }) => version.id === versionId,
    ).sha256,
  ).toBe(persisted.sha256);
  expect(await (await admin.get(downloadUrl())).body()).toEqual(pdf);
  const tampered = Buffer.from(original);
  tampered[tampered.length - 1] ^= 1;
  await writeFile(filename, tampered);
  expect((await inspectDriverStorage(companyId)).corrupt).toBe(1);
  expect((await admin.get(downloadUrl())).status()).toBe(500);
  await expect(
    backupDriverDocuments(
      companyId,
      path.join(parent, "corrupt-source-backup"),
    ),
  ).rejects.toThrow();
  await writeFile(filename, original);
  const orphan = await (await driverStorage()).put(pdf);
  expect((await inspectDriverStorage(companyId)).globalOrphans).toBe(
    before.globalOrphans + 1,
  );
  expect(await (await driverStorage()).get(orphan)).toEqual(pdf);
  await expect(
    restoreDriverDocuments(
      backup,
      path.join(parent, "wrong-restore"),
      foreignCompanyId,
    ),
  ).rejects.toThrow("scope");
  await expect(
    restoreDriverDocuments(backup, restored, companyId),
  ).rejects.toThrow();
  const artifact = path.join(
    backup,
    "driver-documents-" + persisted.storageKey,
  );
  const backupBytes = await readFile(artifact);
  backupBytes[backupBytes.length - 1] ^= 1;
  await writeFile(artifact, backupBytes);
  await expect(
    restoreDriverDocuments(
      backup,
      path.join(parent, "tampered-recovery"),
      companyId,
    ),
  ).rejects.toThrow("integrity");
});
test("dashboard displays scoped reminder history without changing the approved navigation or drawer", async ({
  page,
}) => {
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    token: { userId },
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
  await page
    .getByText("Document notification history (8)", { exact: true })
    .click();
  await expect(
    page.getByText("External delivery is disabled.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/drivers-phase3-notifications.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Open driver", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
test.afterAll(async () => {
  if (companyId) {
    await prisma.driverReminder.deleteMany({ where: { companyId } });
    await prisma.driverReminderPolicy.deleteMany({ where: { companyId } });
    await prisma.driverDocumentScan.deleteMany({ where: { companyId } });
    await prisma.driverDocumentVersion.deleteMany({
      where: { document: { companyId } },
    });
    await prisma.driverDocument.deleteMany({ where: { companyId } });
    await prisma.driverAudit.deleteMany({ where: { companyId } });
    await prisma.driver.deleteMany({ where: { companyId } });
  }
  const users = [userId, foreignUserId].filter(Boolean),
    companies = [companyId, foreignCompanyId].filter(Boolean);
  await prisma.companyMembership.deleteMany({
    where: { userId: { in: users } },
  });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.company.deleteMany({ where: { id: { in: companies } } });
  await Promise.all([admin?.dispose(), foreign?.dispose()]);
  await prisma.$disconnect();
});
