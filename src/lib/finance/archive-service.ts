import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";
import {
  FilesystemPrivateFileStorage,
  type PrivateFileStorage,
} from "@/lib/storage/private-file-storage";
import { financialStatementStorage } from "./financial-statement-storage";
import type { FinancialAuthorization } from "./financial-control-authorization";
import {
  FinancialConflictError,
  FinancialNotFoundError,
  FinancialValidationError,
} from "./financial-control-errors";
import {
  displayFilename,
  hash,
  integer,
  minor,
  normalizeStatement,
  object,
  str,
  uuid,
} from "./archive-normalize";
import {
  ArchiveProviderError,
  type ArchiveProvider,
  type InventoryResult,
} from "./archive-provider";

export const json = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)),
  ) as Prisma.InputJsonValue;
export const archiveScope = (context: FinancialAuthorization) => {
  if (
    !["OWNER", "ADMIN"].includes(context.role) ||
    !context.companyIds.includes(context.activeCompanyId)
  )
    throw new AuthorizationDeniedError();
  return {
    operatingGroupId: context.operatingGroupId,
    companyId: { in: context.companyIds },
  };
};
export const archiveDocumentScope = (
  context: FinancialAuthorization,
): Prisma.FinancialStatementWhereInput => ({
  operatingGroupId: context.operatingGroupId,
  OR: [
    { archiveVersions: { none: {} }, archiveConflicts: { none: {} } },
    {
      archiveVersions: {
        some: { statement: { company: archiveScope(context) } },
      },
    },
    {
      archiveConflicts: {
        some: { statement: { company: archiveScope(context) } },
      },
    },
  ],
});

export class ArchiveService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly pdfStorage: PrivateFileStorage = financialStatementStorage,
    private readonly detailStorage: PrivateFileStorage = new FilesystemPrivateFileStorage(
      "quickmanage-details",
    ),
  ) {}
  async company(id: string, c: FinancialAuthorization) {
    const x = await this.db.archiveCompany.findFirst({
      where: { id, ...archiveScope(c) },
    });
    if (!x) throw new FinancialNotFoundError();
    return x;
  }
  private audit(
    tx: Prisma.TransactionClient,
    c: FinancialAuthorization,
    companyId: string,
    action: string,
    metadata: unknown,
  ) {
    return tx.financialAuditEvent.create({
      data: {
        operatingGroupId: c.operatingGroupId,
        companyId,
        actorUserId: c.userId,
        action,
        metadata: json(metadata),
      },
    });
  }
  async bind(
    companyId: string,
    providerCompanyId: string,
    provider: ArchiveProvider,
    c: FinancialAuthorization,
  ) {
    archiveScope(c);
    if (
      c.role !== "OWNER" ||
      !(await this.db.companyMembership.findFirst({
        where: {
          companyId,
          userId: c.userId,
          role: "OWNER",
          user: { isActive: true },
        },
      }))
    )
      throw new AuthorizationDeniedError();
    uuid(providerCompanyId);
    if (
      !c.companyIds.includes(companyId) ||
      !(await this.db.operatingGroupCompany.findFirst({
        where: { companyId, operatingGroupId: c.operatingGroupId },
      }))
    )
      throw new FinancialNotFoundError();
    const bound = await this.db.archiveCompany.findUnique({
      where: {
        accountKey_providerCompanyId: {
          accountKey: provider.accountKey,
          providerCompanyId,
        },
      },
    });
    if (bound && bound.operatingGroupId !== c.operatingGroupId)
      throw new FinancialNotFoundError();
    const source = (await provider.companies()).find(
      (x) => x.id === providerCompanyId,
    );
    if (!source || !str(source.carrier_name))
      throw new FinancialValidationError("Provider Company was not found.");
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(provider.accountKey))
      throw new FinancialValidationError("Invalid account namespace.");
    return this.db.$transaction(async (tx) => {
      const existing = await tx.archiveCompany.findUnique({
        where: {
          operatingGroupId_accountKey_providerCompanyId: {
            operatingGroupId: c.operatingGroupId,
            accountKey: provider.accountKey,
            providerCompanyId,
          },
        },
      });
      if (existing) {
        if (existing.companyId !== companyId)
          throw new FinancialConflictError(
            "Provider Company is already mapped.",
          );
        return existing;
      }
      await tx.archiveScopeGrant.upsert({
        where: {
          operatingGroupId_companyId: {
            operatingGroupId: c.operatingGroupId,
            companyId,
          },
        },
        create: {
          operatingGroupId: c.operatingGroupId,
          companyId,
          grantedByUserId: c.userId,
          reason: "Operational Company archive binding",
        },
        update: {},
      });
      const financialSource = await tx.financialSource.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId,
          name: `QuickManage ${source.carrier_name} (${providerCompanyId})`,
          type: "TMS_SETTLEMENT",
          provider: "QUICKMANAGE",
        },
      });
      const binding = await tx.archiveCompany.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId,
          sourceId: financialSource.id,
          accountKey: provider.accountKey,
          providerCompanyId,
          providerCompanyName: String(source.carrier_name),
        },
      });
      await this.audit(tx, c, companyId, "ARCHIVE_COMPANY_BOUND", {
        bindingId: binding.id,
        providerCompanyId,
      });
      return binding;
    });
  }
  async discover(
    id: string,
    pid: string,
    provider: ArchiveProvider,
    c: FinancialAuthorization,
  ) {
    const company = await this.company(id, c);
    if (provider.accountKey !== company.accountKey)
      throw new FinancialValidationError(
        "Archive connection does not match this Company.",
      );
    return this.saveInventory(
      id,
      pid,
      await provider.inventory(company.providerCompanyId, pid),
      c,
    );
  }
  async saveInventory(
    id: string,
    pid: string,
    result: InventoryResult,
    c: FinancialAuthorization,
  ) {
    const company = await this.company(id, c);
    if (
      !/^\d{4}-\d{2}$/.test(pid) ||
      result.items.length > 2000 ||
      new Set(result.items.map((x) => uuid(x.statement_id))).size !==
        result.items.length ||
      result.metadata.verifiedTwice !== true
    )
      throw new FinancialValidationError(
        "Verified unique Company/PID inventory required.",
      );
    for (const x of result.items) {
      uuid(x.statement_id);
      uuid(x.driver_id);
      integer(x.version);
      if (
        x.updated_date != null &&
        !Number.isFinite(Date.parse(String(x.updated_date)))
      )
        throw new FinancialValidationError("Invalid source updated timestamp.");
      if (
        x.carrier_id !== company.providerCompanyId ||
        String(x.batch_id) !== pid.replace("-", "") ||
        typeof x.contractor !== "boolean"
      )
        throw new FinancialValidationError("Inventory scope mismatch.");
    }
    const fingerprint = hash(
      result.items
        .map((x) => JSON.stringify(x))
        .sort()
        .join("\n"),
    );
    if (fingerprint !== result.fingerprint)
      throw new FinancialValidationError("Inventory checksum mismatch.");
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`archive:${c.operatingGroupId}`},0))`;
      const prior = await tx.archiveInventory.findFirst({
        where: { archiveCompanyId: id, pid, sealed: true },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      });
      if (prior?.fingerprint === fingerprint) return prior;
      const snapshot = await tx.archiveInventory.create({
        data: {
          archiveCompanyId: id,
          observedAt: new Date(
            Math.max(Date.now(), (prior?.observedAt.getTime() ?? 0) + 1),
          ),
          pid,
          expectedCount: result.items.length,
          fingerprint,
          capturedByUserId: c.userId,
          metadata: json(result.metadata),
          items: {
            create: result.items.map((x) => ({
              providerStatementId: uuid(x.statement_id),
              providerVersion: integer(x.version),
              recipientId: uuid(x.driver_id),
              recipientName:
                [str(x.first_name), str(x.last_name)]
                  .filter(Boolean)
                  .join(" ") || null,
              recipientType: x.contractor ? "CONTRACTOR" : "DRIVER",
              providerUpdatedAt: str(x.updated_date),
              metadata: json(x),
              job: { create: {} },
            })),
          },
        },
      });
      await tx.archiveInventory.update({
        where: { id: snapshot.id },
        data: { sealed: true },
      });
      await this.audit(tx, c, company.companyId, "ARCHIVE_INVENTORY_CAPTURED", {
        inventoryId: snapshot.id,
        pid,
        count: result.items.length,
        fingerprint,
        acquisition: result.metadata.acquisition ?? "SERVER_PROVIDER",
        completenessBasis: "CAPTURED_INVENTORY_SNAPSHOT",
      });
      return snapshot;
    });
  }
  async capture(
    bindingId: string,
    bundle: {
      detail: Uint8Array;
      pdf: Uint8Array;
      originalFilename?: string;
      acquisition?: "BROWSER_EVIDENCE_V1";
    },
    c: FinancialAuthorization,
    expected?: {
      statementId: string;
      pid: string;
      recipientId: string;
      providerVersion: number;
      updatedAt: string | null;
      deductions: unknown;
    },
    lease?: { id: string; token: string },
  ) {
    const company = await this.company(bindingId, c),
      n = normalizeStatement(bundle.detail);
    if (
      !bundle.pdf.length ||
      bundle.pdf.length > 20 * 1024 * 1024 ||
      Buffer.from(bundle.pdf.slice(0, 5)).toString() !== "%PDF-"
    )
      throw new FinancialValidationError(
        "Valid bounded original PDF required.",
      );
    if (
      expected &&
      (n.providerStatementId !== expected.statementId ||
        n.header.pid !== expected.pid ||
        n.header.recipientId !== expected.recipientId)
    )
      throw new FinancialValidationError(
        "Statement does not match inventory identity.",
      );
    if (
      expected &&
      (n.providerVersion !== expected.providerVersion ||
        (expected.updatedAt &&
          n.header.providerUpdatedAt?.getTime() !==
            Date.parse(expected.updatedAt)))
    )
      throw new ArchiveProviderError("INVENTORY_STALE_REFRESH_REQUIRED");
    // Detail deductions excludes some fuel/advance components. Only the inventory total is the total deduction field.
    n.header.deductionsMinor = expected ? minor(expected.deductions) : null;
    const pdfChecksum = hash(bundle.pdf),
      detailChecksum = hash(bundle.detail),
      bundleChecksum = hash(`${pdfChecksum}:${detailChecksum}`);
    const written: { storage: PrivateFileStorage; key: string }[] = [];
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`archive:${c.operatingGroupId}`},0))`;
          // Keep the claimed job locked until evidence and completion commit together.
          // A replacement worker must not change the lease after this validation.
          if (lease)
            await tx.$queryRaw`SELECT id FROM "ArchiveCaptureJob" WHERE id=${lease.id} FOR UPDATE`;
          if (
            lease &&
            !(await tx.archiveCaptureJob.findFirst({
              where: {
                id: lease.id,
                leaseToken: lease.token,
                status: "CAPTURING",
                leaseExpiresAt: { gt: new Date() },
              },
            }))
          )
            throw new ArchiveProviderError("CAPTURE_LEASE_LOST");
          let statement = await tx.archiveStatement.findUnique({
            where: {
              archiveCompanyId_providerStatementId: {
                archiveCompanyId: bindingId,
                providerStatementId: n.providerStatementId,
              },
            },
          });
          if (!statement)
            statement = await tx.archiveStatement.create({
              data: {
                archiveCompanyId: bindingId,
                providerStatementId: n.providerStatementId,
                latestProviderVersion: n.providerVersion,
                acceptedProviderVersion: n.providerVersion,
              },
            });
          const prior = await tx.archiveVersion.findUnique({
            where: {
              statementId_providerVersion: {
                statementId: statement.id,
                providerVersion: n.providerVersion,
              },
            },
          });
          if (prior?.bundleChecksum === bundleChecksum) {
            await this.audit(
              tx,
              c,
              company.companyId,
              "ARCHIVE_CAPTURE_DUPLICATE",
              {
                statementId: statement.id,
                providerVersion: n.providerVersion,
                acquisition: bundle.acquisition ?? "SERVER_PROVIDER",
              },
            );
            const original = await this.pdfStorage.get(
              prior.documentId
                ? (
                    await tx.financialStatement.findUniqueOrThrow({
                      where: { id: prior.documentId },
                    })
                  ).storageKey
                : "",
            );
            if (
              hash(original) !== pdfChecksum ||
              hash(await this.detailStorage.get(prior.detailStorageKey)) !==
                detailChecksum
            )
              throw new ArchiveProviderError("ARCHIVE_CHECKSUM_MISMATCH");
            if (lease)
              await tx.archiveCaptureJob.update({
                where: { id: lease.id },
                data: {
                  status:
                    statement.status === "NEEDS_REVIEW"
                      ? "NEEDS_REVIEW"
                      : "PARSED",
                  errorCode: null,
                  leaseToken: null,
                  leaseExpiresAt: null,
                },
              });
            return {
              statementId: statement.id,
              versionId: prior.id,
              status: statement.status,
              idempotent: true,
            };
          }
          const knownConflict = prior
            ? await tx.archiveConflict.findUnique({
                where: {
                  statementId_providerVersion_bundleChecksum: {
                    statementId: statement.id,
                    providerVersion: n.providerVersion,
                    bundleChecksum,
                  },
                },
              })
            : null;
          if (knownConflict) {
            if (lease)
              await tx.archiveCaptureJob.update({
                where: { id: lease.id },
                data: {
                  status: "NEEDS_REVIEW",
                  leaseToken: null,
                  leaseExpiresAt: null,
                  errorCode: "CONTENT_CONFLICT",
                },
              });
            return {
              statementId: statement.id,
              status: "NEEDS_REVIEW",
              idempotent: true,
            };
          }
          let document = await tx.financialStatement.findUnique({
            where: {
              operatingGroupId_checksumSha256: {
                operatingGroupId: c.operatingGroupId,
                checksumSha256: pdfChecksum,
              },
            },
          });
          if (
            document &&
            hash(await this.pdfStorage.get(document.storageKey)) !== pdfChecksum
          )
            throw new ArchiveProviderError("ARCHIVE_CHECKSUM_MISMATCH");
          if (!document) {
            const key = await this.pdfStorage.put(bundle.pdf);
            written.push({ storage: this.pdfStorage, key });
            const filename = displayFilename(company.providerCompanyName, n);
            document = await tx.financialStatement.create({
              data: {
                operatingGroupId: c.operatingGroupId,
                sourceId: company.sourceId,
                type: "TMS_SETTLEMENT",
                periodStart: n.header.workStart,
                periodEnd: n.header.workEnd,
                originalFilename:
                  bundle.originalFilename
                    ?.replace(/[\r\n]/g, "")
                    .slice(0, 255) || filename,
                displayFilename: filename,
                mimeType: "application/pdf",
                byteSize: bundle.pdf.length,
                storageKey: key,
                checksumSha256: pdfChecksum,
                importedByUserId: c.userId,
              },
            });
          }
          const detailStorageKey = await this.detailStorage.put(bundle.detail);
          written.push({ storage: this.detailStorage, key: detailStorageKey });
          const common = {
            statementId: statement.id,
            providerVersion: n.providerVersion,
            documentId: document.id,
            detailStorageKey,
            detailChecksum,
            pdfChecksum,
            bundleChecksum,
            capturedByUserId: c.userId,
          };
          if (prior) {
            await tx.archiveConflict.create({ data: common });
            await tx.archiveStatement.update({
              where: { id: statement.id },
              data: { status: "NEEDS_REVIEW" },
            });
            await this.audit(
              tx,
              c,
              company.companyId,
              "ARCHIVE_CONTENT_CONFLICT",
              {
                statementId: statement.id,
                providerVersion: n.providerVersion,
                bundleChecksum,
                acquisition: bundle.acquisition ?? "SERVER_PROVIDER",
              },
            );
            if (lease)
              await tx.archiveCaptureJob.update({
                where: { id: lease.id },
                data: {
                  status: "NEEDS_REVIEW",
                  leaseToken: null,
                  leaseExpiresAt: null,
                  errorCode: "CONTENT_CONFLICT",
                },
              });
            return {
              statementId: statement.id,
              status: "NEEDS_REVIEW",
              idempotent: false,
            };
          }
          const trucks = [];
          for (const sourceTruck of n.sourceTrucks) {
            const vin = sourceTruck.vin
              ?.replace(/[^a-zA-Z0-9]/g, "")
              .toUpperCase();
            const unit = sourceTruck.unit
              ?.normalize("NFKC")
              .trim()
              .toUpperCase();
            const byVin = vin
              ? await tx.truck.findFirst({
                  where: { vinNormalized: vin, companyId: company.companyId },
                })
              : null;
            const byUnit = unit
              ? await tx.truck.findFirst({
                  where: {
                    companyId: company.companyId,
                    unitNumberNormalized: unit,
                  },
                })
              : null;
            // Conflicting exact identifiers are ambiguous historical evidence.
            const truck = vin
              ? byVin && (!byUnit || byUnit.id === byVin.id)
                ? byVin
                : null
              : byUnit;
            trucks.push({
              ...sourceTruck,
              truckId: truck?.id ?? null,
              mappingStatus: truck
                ? vin
                  ? "VIN"
                  : "COMPANY_UNIT"
                : "NEEDS_REVIEW",
            });
          }
          const version = await tx.archiveVersion.create({
            data: {
              ...common,
              ...n.header,
              header: json({
                ...n.header.header,
                archiveProvenance: {
                  acquisition: bundle.acquisition ?? "SERVER_PROVIDER",
                  assurance: bundle.acquisition
                    ? "USER_ATTESTED_CHECKSUM_SEALED"
                    : "SERVER_RETRIEVED",
                },
              }),
              issues: json(n.issues),
              lines: {
                create: n.lines.map((x) => ({
                  ...x,
                  metadata: json(x.metadata),
                })),
              },
              trucks: { create: trucks },
            },
          });
          await tx.archiveVersion.update({
            where: { id: version.id },
            data: { sealed: true },
          });
          const latest = Math.max(
            statement.latestProviderVersion,
            n.providerVersion,
          );
          const status =
            statement.status === "NEEDS_REVIEW"
              ? "NEEDS_REVIEW"
              : latest !== statement.acceptedProviderVersion
                ? "SOURCE_CHANGED"
                : "PARSED";
          await tx.archiveStatement.update({
            where: { id: statement.id },
            data: { latestProviderVersion: latest, status },
          });
          if (lease)
            await tx.archiveCaptureJob.update({
              where: { id: lease.id },
              data: {
                status: "PARSED",
                errorCode: null,
                leaseToken: null,
                leaseExpiresAt: null,
              },
            });
          await this.audit(
            tx,
            c,
            company.companyId,
            status === "SOURCE_CHANGED"
              ? "ARCHIVE_SOURCE_CHANGED"
              : "ARCHIVE_VERSION_CAPTURED",
            {
              statementId: statement.id,
              versionId: version.id,
              providerVersion: n.providerVersion,
              bundleChecksum,
              acquisition: bundle.acquisition ?? "SERVER_PROVIDER",
            },
          );
          return {
            statementId: statement.id,
            versionId: version.id,
            status,
            idempotent: false,
          };
        },
        { timeout: 60_000, maxWait: 60_000 },
      );
    } catch (error) {
      for (const x of written) {
        try {
          const references =
            x.storage === this.pdfStorage
              ? await this.db.financialStatement.count({
                  where: { storageKey: x.key },
                })
              : (await this.db.archiveVersion.count({
                  where: { detailStorageKey: x.key },
                })) +
                (await this.db.archiveConflict.count({
                  where: { detailStorageKey: x.key },
                }));
          if (!references) await x.storage.delete(x.key);
        } catch {
          /* An uncertain commit or unavailable database must never delete possibly committed evidence. */
        }
      }
      throw error;
    }
  }
  async run(
    inventoryId: string,
    itemIds: string[],
    provider: ArchiveProvider,
    c: FinancialAuthorization,
  ) {
    if (
      !itemIds.length ||
      itemIds.length > 5 ||
      new Set(itemIds).size !== itemIds.length
    )
      throw new FinancialValidationError(
        "Select one to five distinct statements.",
      );
    const inventory = await this.db.archiveInventory.findFirst({
      where: { id: inventoryId, company: archiveScope(c) },
      include: {
        company: true,
        items: { where: { id: { in: itemIds } }, include: { job: true } },
      },
    });
    if (!inventory || inventory.items.length !== itemIds.length)
      throw new FinancialNotFoundError();
    if (provider.accountKey !== inventory.company.accountKey)
      throw new FinancialValidationError("Archive connection mismatch.");
    const results = [];
    for (const item of inventory.items) {
      const job = item.job!;
      if (["PARSED", "NEEDS_REVIEW"].includes(job.status)) {
        results.push({ itemId: item.id, status: job.status, skipped: true });
        continue;
      }
      const token = randomUUID();
      const claimed = await this.db.archiveCaptureJob.updateMany({
        where: {
          id: job.id,
          OR: [
            { status: { in: ["DISCOVERED", "FAILED"] } },
            { status: "CAPTURING", leaseExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          status: "CAPTURING",
          leaseToken: token,
          leaseExpiresAt: new Date(Date.now() + 180_000),
          attempts: { increment: 1 },
          errorCode: null,
        },
      });
      if (!claimed.count) {
        results.push({ itemId: item.id, status: "CAPTURING" });
        continue;
      }
      try {
        const bundle = await provider.bundle(
          inventory.company.providerCompanyId,
          item.providerStatementId,
        );
        const result = await this.capture(
          inventory.archiveCompanyId,
          bundle,
          c,
          {
            statementId: item.providerStatementId,
            pid: inventory.pid,
            recipientId: item.recipientId,
            providerVersion: item.providerVersion,
            updatedAt: item.providerUpdatedAt,
            deductions: object(item.metadata).deductions,
          },
          { id: job.id, token },
        );
        results.push({ itemId: item.id, ...result });
      } catch (error) {
        const code =
          error instanceof ArchiveProviderError
            ? error.code
            : error instanceof FinancialValidationError
              ? "INVALID_SOURCE"
              : "CAPTURE_FAILED";
        await this.db.$transaction(async (tx) => {
          const failed = await tx.archiveCaptureJob.updateMany({
            where: { id: job.id, leaseToken: token },
            data: {
              status: "FAILED",
              leaseToken: null,
              leaseExpiresAt: null,
              errorCode: code,
            },
          });
          if (failed.count)
            await this.audit(
              tx,
              c,
              inventory.company.companyId,
              "ARCHIVE_CAPTURE_FAILED",
              { jobId: job.id, attempt: job.attempts + 1, code },
            );
        });
        results.push({ itemId: item.id, status: "FAILED", code });
        if (code === "AUTHENTICATION_REQUIRED") break;
      }
    }
    return results;
  }
  async accept(statementId: string, c: FinancialAuthorization) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`archive:${c.operatingGroupId}`},0))`;
      const statement = await tx.archiveStatement.findFirst({
        where: { id: statementId, company: archiveScope(c) },
        include: { company: true, _count: { select: { conflicts: true } } },
      });
      if (!statement) throw new FinancialNotFoundError();
      if (statement._count.conflicts)
        throw new FinancialConflictError(
          "Content conflicts require investigation; original versions cannot be replaced.",
        );
      const accepted = await tx.archiveStatement.update({
        where: { id: statement.id },
        data: {
          acceptedProviderVersion: statement.latestProviderVersion,
          status: "PARSED",
        },
      });
      await this.audit(
        tx,
        c,
        statement.company.companyId,
        "ARCHIVE_VERSION_ACCEPTED",
        { statementId, providerVersion: statement.latestProviderVersion },
      );
      return accepted;
    });
  }
  async original(versionId: string, c: FinancialAuthorization) {
    const v = await this.db.archiveVersion.findFirst({
      where: { id: versionId, statement: { company: archiveScope(c) } },
      include: { document: true },
    });
    if (!v) throw new FinancialNotFoundError();
    const bytes = await this.pdfStorage.get(v.document.storageKey);
    if (hash(bytes) !== v.pdfChecksum)
      throw new ArchiveProviderError("ARCHIVE_CHECKSUM_MISMATCH");
    return { bytes, filename: v.document.displayFilename };
  }
}
export const archiveService = new ArchiveService();
