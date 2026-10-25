import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CompanyAuthorization } from "@/lib/auth/authorization";
import { FleetResourceNotFoundError } from "@/lib/fleet/fleet-authorization";
import { DriverValidationError } from "./validation";
import { DriverConflictError } from "./driver-mutations";
import {
  documentLabels,
  parseDateOnly,
  type DocumentKind,
} from "./qualification";
import {
  scanDocument,
  DriverStorageUnavailableError,
} from "./document-scanner";
import {
  driverStorage,
  quarantineStorage,
  validateDriverFile,
} from "./document-storage";
export const versionSelect = {
  id: true,
  version: true,
  filename: true,
  mimeType: true,
  byteSize: true,
  issuedAt: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.DriverDocumentVersionSelect;
export async function requireOwnedDriver(driverId: string, companyId: string) {
  if (
    !(await prisma.driver.findFirst({
      where: { id: driverId, companyId },
      select: { id: true },
    }))
  )
    throw new FleetResourceNotFoundError();
}
export function dates(input: Record<string, unknown>) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DriverValidationError("Invalid document dates.");
  try {
    const issuedAt = parseDateOnly(input.issuedAt, "Issue date"),
      expiresAt = parseDateOnly(input.expiresAt, "Expiration date");
    if (issuedAt && expiresAt && expiresAt < issuedAt)
      throw new Error("Expiration cannot precede issue date.");
    return { issuedAt, expiresAt };
  } catch (error) {
    throw new DriverValidationError((error as Error).message);
  }
}
export async function addDocument(
  context: CompanyAuthorization,
  driverId: string,
  form: FormData,
) {
  if (context.role === "MEMBER") throw new AuthorizationDeniedError();
  await requireOwnedDriver(driverId, context.companyId);
  const file = form.get("file");
  const type = form.get("type") as DocumentKind;
  if (!(file instanceof File) || !Object.hasOwn(documentLabels, type))
    throw new DriverValidationError(
      "Select a supported document type and file.",
    );
  const title =
    type === "OTHER"
      ? String(form.get("title") || "").trim()
      : documentLabels[type];
  if (!title || title.length > 100 || /[\u0000-\u001f]/.test(title))
    throw new DriverValidationError(
      "Document title must contain 1–100 characters.",
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata = validateDriverFile(file, bytes);
  const dateFields = dates({
    issuedAt: form.get("issuedAt"),
    expiresAt: form.get("expiresAt"),
  });
  const documentId = String(form.get("documentId") || "");
  const expectedVersionId = String(form.get("expectedVersionId") || "");
  const slot =
    type === "OTHER" ? "OTHER:" + title.normalize("NFKC").toLowerCase() : type;
  const quarantineKey = await (await quarantineStorage()).put(bytes);
  const scan = await scanDocument(bytes);
  await prisma.$transaction(async (tx) => {
    await tx.driverDocumentScan.create({
      data: {
        companyId: context.companyId,
        driverId,
        quarantineKey,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
        status: scan.status,
        engine: scan.engine,
        scannedAt: scan.scannedAt,
      },
    });
    await tx.driverAudit.create({
      data: {
        companyId: context.companyId,
        driverId,
        actorId: context.user.id,
        actorName: context.user.displayName,
        action: "DOCUMENT_SCAN_" + scan.status,
        metadata: { status: scan.status, engine: scan.engine },
      },
    });
  });
  if (scan.status === "INFECTED")
    throw new DriverValidationError(
      "Document rejected and quarantined by malware scanner.",
    );
  if (
    scan.status === "ERROR" ||
    (process.env.DRIVERS_REQUIRE_CLEAN_SCAN === "true" &&
      scan.status !== "CLEAN")
  )
    throw new DriverStorageUnavailableError(
      "Document scanning is unavailable. Upload retained in private quarantine.",
    );
  const storage = await driverStorage();
  const storageKey = await storage.put(bytes);
  // A failed commit may leave a private orphan; consistency tooling reports it without deletion.
  return await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Driver" WHERE id=${driverId} AND "companyId"=${context.companyId} FOR UPDATE`;
      if (!locked.length) throw new FleetResourceNotFoundError();
      const existing = await tx.driverDocument.findUnique({
        where: { driverId_slot: { driverId, slot } },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (
        existing &&
        (!documentId ||
          existing.id !== documentId ||
          existing.versions[0]?.id !== expectedVersionId)
      )
        throw new DriverConflictError(
          "Document already exists or was updated. Refresh and use Replace.",
        );
      if (documentId && !existing) throw new FleetResourceNotFoundError();
      const document =
        existing ||
        (await tx.driverDocument.create({
          data: { companyId: context.companyId, driverId, type, title, slot },
        }));
      const version = await tx.driverDocumentVersion.create({
        data: {
          documentId: document.id,
          version: (existing?.versions[0]?.version || 0) + 1,
          ...metadata,
          ...dateFields,
          storageKey,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          uploadedById: context.user.id,
          scanStatus: scan.status,
          scannedAt: scan.scannedAt,
          scanEngine: scan.engine,
        },
        select: versionSelect,
      });
      await tx.driverAudit.create({
        data: {
          companyId: context.companyId,
          driverId,
          actorId: context.user.id,
          actorName: context.user.displayName,
          action: existing ? "DOCUMENT_REPLACED" : "DOCUMENT_UPLOADED",
          metadata: { documentId: document.id, versionId: version.id, type },
        },
      });
      return { ...document, currentVersion: version };
    },
    { maxWait: 5000, timeout: 10000 },
  );
}
export async function updateDocumentDates(
  context: CompanyAuthorization,
  driverId: string,
  documentId: string,
  input: Record<string, unknown>,
) {
  if (context.role === "MEMBER") throw new AuthorizationDeniedError();
  const dateFields = dates(input);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Driver" WHERE id=${driverId} AND "companyId"=${context.companyId} FOR UPDATE`;
    if (!locked.length) throw new FleetResourceNotFoundError();
    const document = await tx.driverDocument.findFirst({
      where: { id: documentId, driverId, companyId: context.companyId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!document) throw new FleetResourceNotFoundError();
    const previous = document.versions[0];
    if (!previous || input.expectedVersionId !== previous.id)
      throw new DriverConflictError(
        "Document was updated. Refresh before changing dates.",
      );
    const fields = {
      documentId: previous.documentId,
      filename: previous.filename,
      mimeType: previous.mimeType,
      byteSize: previous.byteSize,
      storageKey: previous.storageKey,
      sha256: previous.sha256,
      scanStatus: previous.scanStatus,
      scannedAt: previous.scannedAt,
      scanEngine: previous.scanEngine,
    };
    const version = await tx.driverDocumentVersion.create({
      data: {
        ...fields,
        ...dateFields,
        version: previous.version + 1,
        uploadedById: context.user.id,
      },
      select: versionSelect,
    });
    await tx.driverAudit.create({
      data: {
        companyId: context.companyId,
        driverId,
        actorId: context.user.id,
        actorName: context.user.displayName,
        action: "DOCUMENT_DATES_UPDATED",
        metadata: { documentId, versionId: version.id },
      },
    });
    return version;
  });
}
