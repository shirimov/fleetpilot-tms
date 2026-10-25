import { createHash } from "node:crypto";
import type { DriverDocumentType, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { documentLabels, expirationState } from "./qualification";

export function reminderKind(due: Date, now: Date) {
  const { days } = expirationState(due, now);
  return days! < 0
    ? "EXPIRED"
    : days! <= 30
      ? "DAYS_30"
      : days! <= 60
        ? "DAYS_60"
        : days! <= 90
          ? "DAYS_90"
          : null;
}
export function parseReminderPolicy(input: unknown) {
  if (!input || typeof input !== "object")
    throw new Error("Invalid reminder policy.");
  const policy = input as Record<string, unknown>;
  const types = (value: unknown) => {
    if (
      !Array.isArray(value) ||
      value.some(
        (type) =>
          typeof type !== "string" || !Object.hasOwn(documentLabels, type),
      )
    )
      throw new Error("Invalid policy document types.");
    return [...new Set(value)] as DriverDocumentType[];
  };
  if (
    typeof policy.enabled !== "boolean" ||
    (policy.mvrReviewDays != null &&
      (!Number.isInteger(policy.mvrReviewDays) ||
        Number(policy.mvrReviewDays) < 1 ||
        Number(policy.mvrReviewDays) > 3650))
  )
    throw new Error("Invalid reminder policy settings.");
  return {
    enabled: policy.enabled,
    requiredTypes: types(policy.requiredTypes),
    trackedTypes: types(policy.trackedTypes),
    mvrReviewDays:
      policy.mvrReviewDays == null ? null : Number(policy.mvrReviewDays),
  };
}
export async function configureReminderPolicy(
  companyId: string,
  input: unknown,
  database: PrismaClient = prisma,
) {
  const policy = parseReminderPolicy(input);
  return database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
    const previous = await tx.driverReminderPolicy.findUnique({
      where: { companyId },
    });
    if (
      previous &&
      previous.enabled === policy.enabled &&
      previous.mvrReviewDays === policy.mvrReviewDays &&
      JSON.stringify([...previous.requiredTypes].sort()) ===
        JSON.stringify([...policy.requiredTypes].sort()) &&
      JSON.stringify([...previous.trackedTypes].sort()) ===
        JSON.stringify([...policy.trackedTypes].sort())
    )
      return previous;
    const saved = await tx.driverReminderPolicy.upsert({
      where: { companyId },
      create: { companyId, ...policy },
      update: { ...policy, revision: (previous?.revision || 0) + 1 },
    });
    const drivers = await tx.driver.findMany({
      where: { companyId },
      select: { id: true },
    });
    if (drivers.length)
      await tx.driverAudit.createMany({
        data: drivers.map((driver) => ({
          companyId,
          driverId: driver.id,
          actorName: "Drivers policy operator",
          action: "REMINDER_POLICY_UPDATED",
          metadata: { revision: saved.revision, enabled: saved.enabled },
        })),
      });
    return saved;
  });
}
export async function runDriverReminders(
  companyId: string,
  now = new Date(),
  database: PrismaClient = prisma,
) {
  if (process.env.DRIVERS_REMINDERS_ENABLED !== "true")
    return { enabled: false, created: 0 };
  const policy = await database.driverReminderPolicy.findUnique({
    where: { companyId },
  });
  if (!policy?.enabled) return { enabled: false, created: 0 };
  let created = 0,
    cursor: string | undefined;
  try {
    for (;;) {
      const drivers = await database.driver.findMany({
        where: { companyId },
        orderBy: { id: "asc" },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          documents: {
            select: {
              type: true,
              versions: {
                take: 1,
                orderBy: { version: "desc" },
                select: { id: true, expiresAt: true, issuedAt: true },
              },
            },
          },
        },
      });
      if (!drivers.length) break;
      for (const driver of drivers) {
        const alerts: {
          type: DriverDocumentType;
          kind: string;
          versionId: string | null;
          dueAt: Date | null;
        }[] = [];
        for (const type of policy.requiredTypes)
          if (
            !driver.documents.some(
              (document) => document.type === type && document.versions.length,
            )
          )
            alerts.push({
              type,
              kind: "MISSING",
              versionId: null,
              dueAt: null,
            });
        for (const document of driver.documents) {
          const version = document.versions[0];
          if (!version || !policy.trackedTypes.includes(document.type))
            continue;
          const reviewDue =
            document.type === "MVR" && policy.mvrReviewDays && version.issuedAt
              ? new Date(
                  version.issuedAt.getTime() + policy.mvrReviewDays * 86400000,
                )
              : null;
          const dueAt =
            version.expiresAt && reviewDue
              ? new Date(
                  Math.min(version.expiresAt.getTime(), reviewDue.getTime()),
                )
              : version.expiresAt || reviewDue;
          const kind = dueAt ? reminderKind(dueAt, now) : null;
          if (kind)
            alerts.push({
              type: document.type,
              kind,
              versionId: version.id,
              dueAt,
            });
        }
        for (const alert of alerts) {
          const dedupeKey = createHash("sha256")
            .update(
              JSON.stringify([
                companyId,
                driver.id,
                alert.type,
                alert.versionId || `policy-${policy.revision}`,
                alert.kind,
              ]),
            )
            .digest("hex");
          created += await database.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "companyId" FROM "DriverReminderPolicy" WHERE "companyId"=${companyId} FOR SHARE`;
            const current = await tx.driverReminderPolicy.findUnique({
              where: { companyId },
            });
            if (!current?.enabled || current.revision !== policy.revision)
              return 0;
            const inserted = await tx.driverReminder.createMany({
              data: [
                {
                  companyId,
                  driverId: driver.id,
                  dedupeKey,
                  kind: alert.kind,
                  documentType: alert.type,
                  versionId: alert.versionId,
                  dueAt: alert.dueAt,
                  createdAt: now,
                },
              ],
              skipDuplicates: true,
            });
            if (inserted.count)
              await tx.driverAudit.create({
                data: {
                  companyId,
                  driverId: driver.id,
                  actorName: "Drivers reminder worker",
                  action: "REMINDER_CREATED",
                  metadata: {
                    kind: alert.kind,
                    documentType: alert.type,
                    dedupeKey,
                  },
                },
              });
            return inserted.count;
          });
        }
      }
      cursor = drivers.at(-1)!.id;
    }
    await database.driverReminderPolicy.update({
      where: { companyId },
      data: { lastSuccessAt: new Date() },
    });
    return { enabled: true, created };
  } catch (error) {
    await database.driverReminderPolicy
      .update({ where: { companyId }, data: { lastFailureAt: new Date() } })
      .catch(() => undefined);
    throw error;
  }
}
