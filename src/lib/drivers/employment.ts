import type { Prisma } from "@prisma/client";
import { DriverValidationError } from "./validation";
import { parseDateOnly } from "./qualification";
export const employmentStatuses = [
  "ACTIVE",
  "INACTIVE",
  "TERMINATED",
  "ON_LEAVE",
] as const;
export const driverTypes = [
  "COMPANY",
  "OWNER_OPERATOR",
  "LEASE_OPERATOR",
] as const;
export function parseEmployment(input: Record<string, unknown>) {
  const fields: {
    employmentStatus?: (typeof employmentStatuses)[number] | null;
    driverType?: (typeof driverTypes)[number] | null;
    employmentStartDate?: Date | null;
    terminationDate?: Date | null;
    homeTerminal?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelation?: string | null;
    teamName?: string | null;
  } = {};
  for (const key of ["employmentStatus", "driverType"] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    const allowed: readonly string[] =
      key === "employmentStatus" ? employmentStatuses : driverTypes;
    if (
      value != null &&
      value !== "" &&
      (typeof value !== "string" || !allowed.includes(value))
    )
      throw new DriverValidationError(`Invalid ${key}.`);
    Object.assign(fields, { [key]: value || null });
  }
  for (const key of [
    "homeTerminal",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
    "teamName",
  ] as const) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "string" && input[key] !== null)
      throw new DriverValidationError(`Invalid ${key}.`);
    const value = (input[key] as string | null)?.trim() || null;
    if (
      value &&
      (value.length > (key === "emergencyContactPhone" ? 50 : 100) ||
        /[\u0000-\u001f]/.test(value))
    )
      throw new DriverValidationError(`Invalid ${key}.`);
    fields[key] = value;
  }
  for (const key of ["employmentStartDate", "terminationDate"] as const) {
    if (!(key in input)) continue;
    try {
      fields[key] = parseDateOnly(input[key], key);
    } catch (error) {
      throw new DriverValidationError((error as Error).message);
    }
  }
  return fields;
}
export function validateEmploymentDates(driver: {
  employmentStartDate: Date | null;
  terminationDate: Date | null;
}) {
  if (
    driver.employmentStartDate &&
    driver.terminationDate &&
    driver.terminationDate < driver.employmentStartDate
  )
    throw new DriverValidationError(
      "Termination date cannot precede employment start date.",
    );
}
export async function employmentData(
  tx: Prisma.TransactionClient,
  companyId: string,
  parsed: ReturnType<typeof parseEmployment>,
) {
  const { teamName, ...fields } = parsed;
  if (teamName === undefined) return fields;
  const team = teamName
    ? await tx.driverTeam.upsert({
        where: { companyId_name: { companyId, name: teamName } },
        create: { companyId, name: teamName },
        update: {},
      })
    : null;
  return { ...fields, teamId: team?.id || null };
}
