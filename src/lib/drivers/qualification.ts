export const documentLabels = {
  CDL_FRONT: "CDL — front",
  CDL_BACK: "CDL — back",
  MEDICAL_CERTIFICATE: "Medical Examiner’s Certificate",
  MVR: "Motor Vehicle Record",
  APPLICATION: "Driver application",
  EMPLOYMENT_AGREEMENT: "Employment agreement",
  ROAD_TEST: "Road test documentation",
  OTHER: "Other qualification document",
} as const;
export type DocumentKind = keyof typeof documentLabels;
export const requiredDocumentTypes = Object.keys(documentLabels).filter(
  (type) => type !== "OTHER",
) as DocumentKind[];
const dayMs = 86400000;
export function expirationState(
  expiresAt: Date | string | null,
  now = new Date(),
) {
  if (!expiresAt) return { status: "NO_EXPIRATION" as const, days: null };
  const date = new Date(expiresAt);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const days = Math.round((date.getTime() - today) / dayMs);
  const status =
    days < 0
      ? "EXPIRED"
      : days <= 30
        ? "EXPIRING_30"
        : days <= 60
          ? "EXPIRING_60"
          : days <= 90
            ? "EXPIRING_90"
            : "ON_FILE";
  return { status, days };
}
export function documentAlerts(
  documents: {
    type: string;
    versions: { expiresAt: Date | string | null }[];
  }[],
  now = new Date(),
) {
  const current = documents.flatMap((document) =>
    document.versions.slice(0, 1).map((version) => ({
      ...expirationState(version.expiresAt, now),
      type: document.type,
    })),
  );
  return {
    expired: current.filter(
      (version) => version.days !== null && version.days < 0,
    ).length,
    within30: current.filter(
      (version) =>
        version.days !== null && version.days >= 0 && version.days <= 30,
    ).length,
    within60: current.filter(
      (version) =>
        version.days !== null && version.days >= 0 && version.days <= 60,
    ).length,
    within90: current.filter(
      (version) =>
        version.days !== null && version.days >= 0 && version.days <= 90,
    ).length,
    unknownExpiry: current.filter((version) => version.days === null).length,
    missingRequired: requiredDocumentTypes.filter(
      (type) => !current.some((version) => version.type === type),
    ),
  };
}
export function parseDateOnly(value: unknown, field: string): Date | null {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`${field} must be YYYY-MM-DD.`);
  const date = new Date(value + "T00:00:00.000Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    value < "1900-01-01" ||
    value > "2200-12-31"
  )
    throw new Error(`${field} is invalid.`);
  return date;
}
