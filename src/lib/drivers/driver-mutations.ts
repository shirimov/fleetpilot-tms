import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CompanyAuthorization } from "@/lib/auth/authorization";
import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";
import { FleetResourceNotFoundError } from "@/lib/fleet/fleet-authorization";
import { parseDriverInput, DriverValidationError } from "./validation";
import {
  parseEmployment,
  employmentData,
  validateEmploymentDates,
} from "./employment";
export class DriverConflictError extends Error {}
export async function saveDriver(
  context: CompanyAuthorization,
  input: unknown,
  id?: string,
) {
  if (context.role === "MEMBER") throw new AuthorizationDeniedError();
  const core = parseDriverInput(input);
  const employment = parseEmployment(input as Record<string, unknown>);
  try {
    return await prisma.$transaction(async (tx) => {
      const previous = id
        ? await tx.driver.findFirst({
            where: { id, companyId: context.companyId },
          })
        : null;
      if (id && !previous) throw new FleetResourceNotFoundError();
      const expected = (input as Record<string, unknown>).expectedUpdatedAt;
      if (
        expected !== undefined &&
        (!previous ||
          typeof expected !== "string" ||
          previous.updatedAt.toISOString() !== expected)
      )
        throw new DriverConflictError(
          "Driver was changed by another user. Close and reopen the form.",
        );
      if (
        core.truckId &&
        !(await tx.truck.findFirst({
          where: { id: core.truckId, companyId: context.companyId },
          select: { id: true },
        }))
      )
        throw new DriverValidationError(
          "Truck is not available in the selected company.",
        );
      validateEmploymentDates({
        employmentStartDate:
          employment.employmentStartDate === undefined
            ? previous?.employmentStartDate || null
            : employment.employmentStartDate,
        terminationDate:
          employment.terminationDate === undefined
            ? previous?.terminationDate || null
            : employment.terminationDate,
      });
      const fields = {
        ...core,
        ...(await employmentData(tx, context.companyId, employment)),
      };
      const driver = previous
        ? await tx.driver.update({
            where: {
              id: previous.id,
              companyId: context.companyId,
              ...(expected ? { updatedAt: previous.updatedAt } : {}),
            },
            data: fields,
          })
        : await tx.driver.create({
            data: { ...fields, companyId: context.companyId },
          });
      const changedFields = previous
        ? Object.keys(fields).filter(
            (key) =>
              String(previous[key as keyof typeof previous]) !==
              String(fields[key as keyof typeof fields]),
          )
        : Object.keys(fields);
      const employmentTransitions: Record<
        string,
        { from: string | null; to: string | null }
      > = {};
      for (const key of [
        "employmentStatus",
        "driverType",
        "employmentStartDate",
        "terminationDate",
      ] as const) {
        if (!changedFields.includes(key)) continue;
        const before = previous?.[key],
          after = driver[key];
        employmentTransitions[key] = {
          from: before instanceof Date ? before.toISOString() : before || null,
          to: after instanceof Date ? after.toISOString() : after || null,
        };
      }
      await tx.driverAudit.create({
        data: {
          companyId: context.companyId,
          driverId: driver.id,
          actorId: context.user.id,
          actorName: context.user.displayName,
          action: previous ? "DRIVER_UPDATED" : "DRIVER_CREATED",
          metadata: { changedFields, employmentTransitions },
        },
      });
      return driver;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new DriverConflictError(
        "Driver was changed by another user. Close and reopen the form.",
      );
    throw error;
  }
}
