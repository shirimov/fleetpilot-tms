import { FinancialValidationError } from "./financial-control-errors";

/**
 * Provider instant, normalized to UTC with all fractional digits preserved.
 * Date is used only for whole seconds: it must never discard source precision
 * during freshness checks. Null means absent, not an invalid timestamp.
 */
export function providerInstant(value: unknown): string | null {
  if (value == null) return null;
  const match =
    typeof value === "string" &&
    value.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,100}))?(Z|[+-]\d{2}:\d{2})$/,
    );
  const fail = (): never => {
    throw new FinancialValidationError("Invalid source timestamp.");
  };
  if (!match) return fail();
  const [, day, hour, minute, second, fraction = "", zone] = match;
  const midnight = new Date(day + "T00:00:00Z");
  if (
    !Number.isFinite(midnight.getTime()) ||
    midnight.toISOString().slice(0, 10) !== day ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== "Z" &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  )
    return fail();
  const whole = new Date(day + "T" + hour + ":" + minute + ":" + second + zone);
  if (!Number.isFinite(whole.getTime())) return fail();
  const digits = fraction.replace(/0+$/, "");
  return (
    whole.toISOString().replace(/\.000Z$/, "") +
    (digits ? "." + digits : "") +
    "Z"
  );
}
