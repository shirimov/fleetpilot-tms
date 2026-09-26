import { archiveCaptureRuns, type CaptureContext } from "./archive-capture-run";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";
import {
  FinancialConflictError,
  FinancialNotFoundError,
  FinancialValidationError,
} from "./financial-control-errors";
import {
  financialControlAuthorization,
  type FinancialAuthorization,
} from "./financial-control-authorization";
import { ArchiveService, archiveScope, json } from "./archive-service";
import { hash, object, minor } from "./archive-normalize";
import {
  validateCatalog,
  validateInventory,
  validateBundle,
  text,
  businessOnly,
  type BrowserCompany,
} from "./archive-bridge-validation";

const LEGACY_ONE_NINE_PROVENANCE = {
  canonicalCompanyId: "cdf065bb-9002-4aa6-86b1-dd66f75e8692",
  canonicalCompanyName: "1-9 Transportation Inc",
  providerCompanyId: "964e6cf7-9d60-4aba-af76-4212a6e28071",
  storedSourceCompanyId: "e28fb8ff-0822-4166-954a-52d9544c0b0c",
  action: "TRUCK_IMPORTED_FROM_QUICKMANAGE",
} as const;

type CompanyProvenanceEvent = {
  id: string;
  action: string;
  metadata: unknown;
};

export function assessArchiveCompanyProvenance(
  canonical: { id: string; name: string },
  source: Pick<BrowserCompany, "id" | "carrier_name">,
  events: CompanyProvenanceEvent[],
) {
  const providerCompanyId = source.id.toLowerCase();
  const legacyEventIds: string[] = [];
  let conflict = false;
  for (const event of events) {
    const metadata = object(event.metadata);
    if (metadata.sourceCompanyId == null) continue;
    const sourceCompanyId = String(metadata.sourceCompanyId).toLowerCase();
    if (sourceCompanyId === providerCompanyId) continue;
    const documentedLegacyShape =
      canonical.id === LEGACY_ONE_NINE_PROVENANCE.canonicalCompanyId &&
      canonical.name === LEGACY_ONE_NINE_PROVENANCE.canonicalCompanyName &&
      source.id === LEGACY_ONE_NINE_PROVENANCE.providerCompanyId &&
      source.carrier_name === LEGACY_ONE_NINE_PROVENANCE.canonicalCompanyName &&
      event.action === LEGACY_ONE_NINE_PROVENANCE.action &&
      sourceCompanyId ===
        LEGACY_ONE_NINE_PROVENANCE.storedSourceCompanyId.toLowerCase() &&
      String(metadata.sourceTruckId).toLowerCase() === providerCompanyId &&
      metadata.provider === "QUICKMANAGE" &&
      metadata.operatedBy === LEGACY_ONE_NINE_PROVENANCE.canonicalCompanyName;
    if (documentedLegacyShape) legacyEventIds.push(event.id);
    else conflict = true;
  }
  // More than one matching legacy record is itself ambiguous and must fail closed.
  if (legacyEventIds.length > 1) conflict = true;
  return { conflict, legacyEventIds: conflict ? [] : legacyEventIds };
}

/** Only archive callers receive this expanded scope; economics retain operational scope. */
export async function archiveContext(minimum: "ADMIN" | "OWNER" = "ADMIN") {
  const c = await financialControlAuthorization.requireContext(minimum);
  return expandArchiveScope(c, minimum);
}
export async function expandArchiveScope(
  c: FinancialAuthorization,
  minimum: "ADMIN" | "OWNER" = "ADMIN",
  database: PrismaClient = prisma,
) {
  const grants = await database.archiveScopeGrant.findMany({
    where: {
      operatingGroupId: c.operatingGroupId,
      company: {
        memberships: {
          some: {
            userId: c.userId,
            role: { in: minimum === "OWNER" ? ["OWNER"] : ["OWNER", "ADMIN"] },
          },
        },
      },
    },
    select: { companyId: true },
  });
  return {
    ...c,
    companyIds: [
      ...new Set([...c.companyIds, ...grants.map((g) => g.companyId)]),
    ],
  };
}
export class ArchiveBridgeService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly archive = new ArchiveService(db),
  ) {}
  private configured(c: FinancialAuthorization) {
    if (
      process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID !== c.operatingGroupId
    )
      throw new AuthorizationDeniedError();
  }
  private async owner(c: FinancialAuthorization, companyId?: string) {
    archiveScope(c);
    if (
      c.role !== "OWNER" ||
      !(await this.db.operatingGroupMembership.findFirst({
        where: {
          operatingGroupId: c.operatingGroupId,
          userId: c.userId,
          role: "OWNER",
        },
      })) ||
      !(await this.db.companyMembership.findFirst({
        where: {
          userId: c.userId,
          companyId: companyId ?? c.activeCompanyId,
          role: "OWNER",
          user: { isActive: true },
        },
      }))
    )
      throw new AuthorizationDeniedError();
  }
  async catalog(value: unknown, c: FinancialAuthorization) {
    this.configured(c);
    await this.owner(c);
    const companies = validateCatalog(value),
      fingerprint = hash(JSON.stringify(companies));
    // Account namespace is server-controlled; it is never accepted from the upload.
    const accountKey = process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY;
    if (!accountKey || !/^[a-zA-Z0-9_.-]{1,80}$/.test(accountKey))
      throw new FinancialValidationError(
        "Configure the verified QuickManage archive account namespace first.",
      );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`archive:${c.operatingGroupId}`},0))`;
      const existing = await tx.archiveBrowserCatalog.findUnique({
        where: {
          operatingGroupId_accountKey_fingerprint: {
            operatingGroupId: c.operatingGroupId,
            accountKey,
            fingerprint,
          },
        },
      });
      if (existing) return existing;
      const result = await tx.archiveBrowserCatalog.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          accountKey,
          fingerprint,
          companies: json(companies),
          submittedByUserId: c.userId,
        },
      });
      await tx.financialAuditEvent.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId: c.activeCompanyId,
          actorUserId: c.userId,
          action: "ARCHIVE_BROWSER_CATALOG_SUBMITTED",
          metadata: {
            catalogId: result.id,
            fingerprint,
            acquisition: "BROWSER_EVIDENCE_V1",
          },
        },
      });
      return result;
    });
  }
  async review(c: FinancialAuthorization) {
    archiveScope(c);
    const [catalog, canonical, bindings, provenance] = await Promise.all([
      this.db.archiveBrowserCatalog.findFirst({
        where: { operatingGroupId: c.operatingGroupId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.db.company.findMany({
        where: { memberships: { some: { userId: c.userId, role: "OWNER" } } },
        select: {
          id: true,
          name: true,
          dotNumber: true,
          mcNumber: true,
          operatingGroupLink: { select: { operatingGroupId: true } },
          archiveGrants: { select: { operatingGroupId: true } },
        },
        orderBy: { name: "asc" },
      }),
      this.db.archiveCompany.findMany({ where: archiveScope(c) }),
      this.db.truckLifecycleEvent.findMany({
        where: { companyId: { in: c.companyIds } },
        select: { id: true, action: true, companyId: true, metadata: true },
      }),
    ]);
    const normalize = (s: string) => s.trim().toLowerCase().replace(/[.]/g, "");
    const rows = (
      (catalog?.companies ?? []) as unknown as BrowserCompany[]
    ).map((source) => {
      const candidates = canonical.filter(
        (x) => normalize(x.name) === normalize(source.carrier_name),
      );
      const bound = bindings.find(
        (x) =>
          x.accountKey === catalog!.accountKey &&
          x.providerCompanyId === source.id,
      );
      const candidate = candidates.length === 1 ? candidates[0] : null;
      const provenanceAssessment = candidate
        ? assessArchiveCompanyProvenance(
            candidate,
            source,
            provenance.filter((p) => p.companyId === candidate.id),
          )
        : { conflict: false, legacyEventIds: [] };
      const ambiguous = provenanceAssessment.conflict;
      const outside =
        candidate &&
        candidate.operatingGroupLink?.operatingGroupId !== c.operatingGroupId;
      return {
        source,
        binding: bound ?? null,
        proposedCompanyId: candidate?.id ?? null,
        status: bound
          ? "OWNER_CONFIRMED"
          : candidates.length > 1 || ambiguous
            ? "AMBIGUOUS"
            : !candidate
              ? "NO_CANONICAL_COMPANY"
              : outside
                ? "OUTSIDE_SCOPE"
                : "NEEDS_CONFIRMATION",
        evidence: bound
          ? "Explicit binding recorded."
          : ambiguous
            ? "Stored source Company identity differs; resolve provenance before confirming."
            : provenanceAssessment.legacyEventIds.length
              ? "Current provider identity corroborates the documented legacy swapped-field provenance; the original event will remain unchanged and OWNER confirmation is still required."
              : "Browser-supplied identity; display-name suggestion is not verification. Review authoritative IDs and provenance before OWNER confirmation.",
      };
    });
    return {
      catalogId: catalog?.id ?? null,
      rows,
      canonical,
      canConfirm: c.role === "OWNER",
      captureRuns: await archiveCaptureRuns.list(c),
      captureEnabled: process.env.QUICKMANAGE_CAPTURE_ENABLED === "true",
      bridgeEnabled: process.env.QUICKMANAGE_BROWSER_BRIDGE_ENABLED === "true",
      accountConfigured:
        !!process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY &&
        process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID ===
          c.operatingGroupId,
    };
  }
  async bind(
    input: {
      catalogId: string;
      providerCompanyId: string;
      companyId: string;
      confirmation: string;
      reason: string;
      historical: boolean;
    },
    c: FinancialAuthorization,
  ) {
    this.configured(c);
    await this.owner(c, input.companyId);
    businessOnly(input);
    text(input.reason, 1000);
    if (input.confirmation !== "CONFIRM_COMPANY_IDENTITY")
      throw new FinancialValidationError(
        "Explicit OWNER identity confirmation required.",
      );
    const catalog = await this.db.archiveBrowserCatalog.findFirst({
      where: { id: input.catalogId, operatingGroupId: c.operatingGroupId },
    });
    if (
      !catalog ||
      catalog.accountKey !== process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY
    )
      throw new FinancialNotFoundError();
    const source = (catalog.companies as unknown as BrowserCompany[]).find(
      (x) => x.id === input.providerCompanyId,
    );
    if (!source)
      throw new FinancialValidationError(
        "Company is not in the reviewed provider catalog.",
      );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`archive-account:${catalog.accountKey}`},0))`;
      const canonical = await tx.company.findUniqueOrThrow({
        where: { id: input.companyId },
        include: { operatingGroupLink: true },
      });
      if (
        canonical.operatingGroupLink &&
        canonical.operatingGroupLink.operatingGroupId !== c.operatingGroupId
      )
        throw new AuthorizationDeniedError();
      if (!canonical.operatingGroupLink && !input.historical)
        throw new FinancialValidationError(
          "Explicit historical archive scope approval required.",
        );
      const provenance = await tx.truckLifecycleEvent.findMany({
        where: { companyId: canonical.id },
        select: { id: true, action: true, metadata: true },
      });
      const provenanceAssessment = assessArchiveCompanyProvenance(
        canonical,
        source,
        provenance,
      );
      if (provenanceAssessment.conflict)
        throw new FinancialValidationError(
          "Stored source Company identity conflicts. Resolve authoritative provenance before binding.",
        );
      const prior = await tx.archiveCompany.findUnique({
        where: {
          accountKey_providerCompanyId: {
            accountKey: catalog.accountKey,
            providerCompanyId: source.id,
          },
        },
      });
      if (prior) {
        if (
          prior.operatingGroupId !== c.operatingGroupId ||
          prior.companyId !== canonical.id
        )
          throw new FinancialConflictError(
            "Company identity is already bound.",
          );
        return prior;
      }
      await tx.archiveScopeGrant.upsert({
        where: {
          operatingGroupId_companyId: {
            operatingGroupId: c.operatingGroupId,
            companyId: canonical.id,
          },
        },
        create: {
          operatingGroupId: c.operatingGroupId,
          companyId: canonical.id,
          grantedByUserId: c.userId,
          reason: input.reason,
        },
        update: {},
      });
      const financialSource = await tx.financialSource.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId: canonical.id,
          name: `QuickManage ${source.carrier_name}`,
          type: "TMS_SETTLEMENT",
          provider: "QUICKMANAGE",
        },
      });
      const binding = await tx.archiveCompany.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId: canonical.id,
          sourceId: financialSource.id,
          accountKey: catalog.accountKey,
          providerCompanyId: source.id,
          providerCompanyName: source.carrier_name,
        },
      });
      await tx.financialAuditEvent.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId: canonical.id,
          actorUserId: c.userId,
          action: "ARCHIVE_BROWSER_COMPANY_CONFIRMED",
          metadata: {
            bindingId: binding.id,
            catalogId: catalog.id,
            catalogChecksum: catalog.fingerprint,
            providerCompanyId: source.id,
            reason: input.reason,
            historical: !canonical.operatingGroupLink,
            assurance: "OWNER_ATTESTED_BROWSER_EVIDENCE",
            legacyProvenanceCompatibility: provenanceAssessment.legacyEventIds
              .length
              ? {
                  mode: "LEGACY_SWAPPED_COMPANY_TRUCK_FIELDS_V1",
                  lifecycleEventIds: provenanceAssessment.legacyEventIds,
                  originalEventPreserved: true,
                  currentProviderIdentity:
                    "INDEPENDENTLY_VERIFIED_BROWSER_CATALOG",
                }
              : null,
          },
        },
      });
      return binding;
    });
  }
  private async binding(providerCompanyId: string, c: FinancialAuthorization) {
    this.configured(c);
    const binding = await this.db.archiveCompany.findFirst({
      where: {
        ...archiveScope(c),
        providerCompanyId,
        accountKey: process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY,
      },
    });
    if (!binding || !process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY)
      throw new FinancialNotFoundError();
    return binding;
  }
  async inventory(value: unknown, c: CaptureContext) {
    archiveScope(c);
    const result = validateInventory(value),
      binding = await this.binding(result.companyId, c);
    return this.archive.saveInventory(binding.id, result.pid, result, c);
  }
  async capture(inventoryId: string, value: unknown, c: CaptureContext) {
    archiveScope(c);
    const bundle = validateBundle(value),
      binding = await this.binding(bundle.companyId, c);
    if (bundle.carrierName !== binding.providerCompanyName)
      throw new FinancialValidationError(
        "Detail Company name does not match the confirmed provider identity.",
      );
    const item = await this.db.archiveInventoryItem.findFirst({
      where: {
        inventoryId,
        providerStatementId: bundle.statementId,
        inventory: {
          archiveCompanyId: binding.id,
          pid: bundle.pid,
          sealed: true,
        },
      },
      include: { job: true, inventory: true },
    });
    if (!item || !item.job) throw new FinancialNotFoundError();
    await this.archive.authorizeCapture(
      binding.id,
      c,
      "BROWSER",
      item.inventory.captureRunId,
    );
    if (
      item.recipientType !== bundle.normalized.header.recipientType ||
      item.recipientId !== bundle.normalized.header.recipientId ||
      item.providerVersion !== bundle.version
    )
      throw new FinancialValidationError(
        "Recipient or version differs from inventory.",
      );
    const inventoryMetadata = object(item.metadata);
    const detailPay = object(
      object(bundle.normalized.header.header).net_pay_info,
    );
    for (const key of ["gross", "net_pay", "payout"]) {
      const expected = minor(inventoryMetadata[key]),
        actual = minor(detailPay[key]);
      if (
        expected !== null && actual !== null
          ? expected !== actual
          : inventoryMetadata[key] !== detailPay[key]
      )
        throw new FinancialValidationError(
          "Statement money differs from inventory; refresh source evidence.",
        );
    }
    const token = randomUUID();
    const claimed = await this.archive.claimCapture(
      item.job.id,
      token,
      binding.id,
      c,
      "BROWSER",
    );
    if (!claimed.count) return { status: "CAPTURING", retry: true };
    try {
      return await this.archive.capture(
        binding.id,
        { ...bundle, acquisition: "BROWSER_EVIDENCE_V1" },
        c,
        {
          statementId: item.providerStatementId,
          pid: bundle.pid,
          recipientId: item.recipientId,
          providerVersion: item.providerVersion,
          updatedAt: item.providerUpdatedAt,
          deductions: object(item.metadata).deductions,
        },
        { id: item.job.id, token },
      );
    } catch {
      await this.db.$transaction(async (tx) => {
        const failed = await tx.archiveCaptureJob.updateMany({
          where: { id: item.job!.id, leaseToken: token },
          data: {
            status: "FAILED",
            errorCode: "BROWSER_CAPTURE_FAILED",
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (failed.count)
          await tx.financialAuditEvent.create({
            data: {
              operatingGroupId: c.operatingGroupId,
              companyId: binding.companyId,
              actorUserId: c.userId,
              action: "ARCHIVE_CAPTURE_FAILED",
              metadata: {
                captureRunId: c.captureRunId!,
                jobId: item.job!.id,
                code: "BROWSER_CAPTURE_FAILED",
                acquisition: "BROWSER_EVIDENCE_V1",
              },
            },
          });
      });
      throw new FinancialValidationError(
        "Capture failed; evidence preserved. Refresh inventory or retry.",
      );
    }
  }
}
export const archiveBridge = new ArchiveBridgeService();
