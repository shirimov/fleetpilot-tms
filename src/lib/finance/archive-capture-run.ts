import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";
import { FinancialValidationError } from "./financial-control-errors";
import type { FinancialAuthorization } from "./financial-control-authorization";
import { uuid } from "./archive-normalize";

export type CaptureContext = FinancialAuthorization & { captureRunId?: string };
export type AcquisitionChannel = "BROWSER" | "SERVER";
export const lockArchive = (tx: Prisma.TransactionClient, group: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`archive:${group}`},0))`;

export function captureGate(channel: AcquisitionChannel) {
  if (
    process.env.QUICKMANAGE_CAPTURE_ENABLED !== "true" ||
    process.env[
      channel === "BROWSER"
        ? "QUICKMANAGE_BROWSER_BRIDGE_ENABLED"
        : "QUICKMANAGE_ARCHIVE_ENABLED"
    ] !== "true"
  )
    throw new AuthorizationDeniedError();
}
async function owner(tx: Prisma.TransactionClient, c: FinancialAuthorization) {
  if (
    c.role !== "OWNER" ||
    !c.companyIds.includes(c.activeCompanyId) ||
    !(await tx.operatingGroupMembership.findFirst({
      where: {
        operatingGroupId: c.operatingGroupId,
        userId: c.userId,
        role: "OWNER",
        user: { isActive: true },
      },
    }))
  )
    throw new AuthorizationDeniedError();
}
async function bindings(
  tx: Prisma.TransactionClient,
  ids: string[],
  accountKey: string,
  c: FinancialAuthorization,
) {
  const found = await tx.archiveCompany.findMany({
    where: {
      operatingGroupId: c.operatingGroupId,
      accountKey,
      provider: "QUICKMANAGE",
      providerCompanyId: { in: ids },
      companyId: { in: c.companyIds },
      company: {
        memberships: {
          some: { userId: c.userId, role: "OWNER", user: { isActive: true } },
        },
      },
    },
  });
  if (found.length !== ids.length) throw new AuthorizationDeniedError();
  return found;
}
/** Call under the shared archive transaction lock immediately before every acquisition write. */
export async function requireCaptureRun(
  tx: Prisma.TransactionClient,
  c: CaptureContext,
  bindingId: string,
  channel: AcquisitionChannel,
  inventoryRunId?: string | null,
) {
  captureGate(channel);
  await owner(tx, c);
  if (
    !c.captureRunId ||
    process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID !== c.operatingGroupId
  )
    throw new AuthorizationDeniedError();
  const run = await tx.archiveCaptureRun.findFirst({
    where: {
      id: c.captureRunId,
      status: "ACTIVE",
      provider: "QUICKMANAGE",
      operatingGroupId: c.operatingGroupId,
      createdByUserId: c.userId,
      accountKey: process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY || "",
    },
  });
  if (!run || (inventoryRunId !== undefined && inventoryRunId !== run.id))
    throw new AuthorizationDeniedError();
  const bound = await bindings(
    tx,
    run.allowedProviderCompanyIds,
    run.accountKey,
    c,
  );
  const company = bound.find((x) => x.id === bindingId);
  if (!company) throw new AuthorizationDeniedError();
  return { run, company };
}
export class ArchiveCaptureRunService {
  constructor(private readonly db: PrismaClient = prisma) {}
  async list(c: FinancialAuthorization) {
    return this.db.archiveCaptureRun.findMany({
      where: {
        operatingGroupId: c.operatingGroupId,
        createdByUserId: c.userId,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
  async create(ids: unknown, label: unknown, c: FinancialAuthorization) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 50 ||
      ids.some((x) => typeof x !== "string") ||
      new Set(ids).size !== ids.length ||
      (label != null && (typeof label !== "string" || label.length > 200))
    )
      throw new FinancialValidationError(
        "Choose one to fifty distinct provider Company IDs and a short label.",
      );
    const allowed = ids.map(uuid).sort();
    return this.db.$transaction(async (tx) => {
      await lockArchive(tx, c.operatingGroupId);
      await owner(tx, c);
      const accountKey = process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY;
      if (
        !accountKey ||
        process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID !==
          c.operatingGroupId
      )
        throw new AuthorizationDeniedError();
      const companies = await bindings(tx, allowed, accountKey, c);
      const run = await tx.archiveCaptureRun.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          accountKey,
          createdByUserId: c.userId,
          allowedProviderCompanyIds: allowed,
          label: typeof label === "string" ? label : null,
        },
      });
      await tx.financialAuditEvent.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId: companies[0].companyId,
          actorUserId: c.userId,
          action: "ARCHIVE_CAPTURE_RUN_CREATED",
          metadata: {
            captureRunId: run.id,
            provider: run.provider,
            allowedProviderCompanyIds: allowed,
          },
        },
      });
      return run;
    });
  }
  async transition(
    id: string,
    status: "ACTIVE" | "COMPLETED" | "CLOSED" | "FAILED",
    c: FinancialAuthorization,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await lockArchive(tx, c.operatingGroupId);
        await owner(tx, c);
        const run = await tx.archiveCaptureRun.findFirst({
          where: {
            id,
            operatingGroupId: c.operatingGroupId,
            createdByUserId: c.userId,
          },
        });
        if (
          !run ||
          !(
            (run.status === "DRAFT" && ["ACTIVE", "CLOSED"].includes(status)) ||
            (run.status === "ACTIVE" &&
              ["COMPLETED", "CLOSED", "FAILED"].includes(status))
          )
        )
          throw new AuthorizationDeniedError();
        // Activation grants authority and revalidates every binding. Closing is
        // a reduction of authority: a still-authorized group OWNER can close
        // their own run even after losing access to one scoped Company.
        if (
          status === "ACTIVE" &&
          (process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID !==
            c.operatingGroupId ||
            process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY !== run.accountKey)
        )
          throw new AuthorizationDeniedError();
        const auditCompanyId =
          status === "ACTIVE"
            ? (
                await bindings(
                  tx,
                  run.allowedProviderCompanyIds,
                  run.accountKey,
                  c,
                )
              )[0].companyId
            : c.activeCompanyId;
        const updated = await tx.archiveCaptureRun.update({
          where: { id },
          data: {
            status,
            ...(status === "ACTIVE"
              ? { startedAt: new Date() }
              : { closedAt: new Date() }),
          },
        });
        await tx.financialAuditEvent.create({
          data: {
            operatingGroupId: c.operatingGroupId,
            companyId: auditCompanyId,
            actorUserId: c.userId,
            action: "ARCHIVE_CAPTURE_RUN_" + status,
            metadata: {
              captureRunId: id,
              allowedProviderCompanyIds: run.allowedProviderCompanyIds,
            },
          },
        });
        return updated;
      },
      { timeout: 60_000, maxWait: 60_000 },
    );
  }
}
export const archiveCaptureRuns = new ArchiveCaptureRunService();

/** Best-effort denial audit only for a recognized owner and their own run. Never log payloads. */
export async function auditCaptureDenial(
  db: PrismaClient,
  c: CaptureContext,
  bindingId: string,
) {
  try {
    await db.$transaction(async (tx) => {
      await owner(tx, c);
      if (!c.captureRunId) return;
      const run = await tx.archiveCaptureRun.findFirst({
        where: {
          id: c.captureRunId,
          operatingGroupId: c.operatingGroupId,
          createdByUserId: c.userId,
        },
      });
      if (!run) return;
      const binding = await tx.archiveCompany.findFirst({
        where: {
          id: bindingId,
          operatingGroupId: c.operatingGroupId,
          companyId: { in: c.companyIds },
        },
      });
      await tx.financialAuditEvent.create({
        data: {
          operatingGroupId: c.operatingGroupId,
          companyId: binding?.companyId ?? c.activeCompanyId,
          actorUserId: c.userId,
          action: "ARCHIVE_CAPTURE_RUN_DENIED",
          metadata: {
            captureRunId: run.id,
            providerCompanyId: binding?.providerCompanyId ?? null,
          },
        },
      });
    });
  } catch {
    /* Denial remains fail-closed if audit storage is unavailable. */
  }
}
