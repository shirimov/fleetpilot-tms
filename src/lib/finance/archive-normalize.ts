import { providerInstant } from "./archive-time";
import { createHash } from "node:crypto";
import { FinancialValidationError } from "./financial-control-errors";

export type SourceObject = { [key: string]: unknown };
export const object = (v: unknown): SourceObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as SourceObject) : {};
export const str = (v: unknown): string | null =>
  typeof v === "string" ? v : null;
export const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
export function uuid(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v) ||
    /^0{8}-/.test(v)
  )
    throw new FinancialValidationError("Valid provider UUID required.");
  return v.toLowerCase();
}
export function integer(v: unknown) {
  if (!/^\d{1,9}$/.test(String(v)))
    throw new FinancialValidationError("Invalid provider integer.");
  return Number(v);
}
/** Preserve number tokens before JSON.parse. Money never passes through a JS number. */
export function parseSource(bytes: Uint8Array): SourceObject {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new FinancialValidationError("Source JSON size is invalid.");
  const input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let out = "",
    quoted = false,
    escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
      out += c;
    } else if (c === "-" || /\d/.test(c)) {
      const token = input
        .slice(i)
        .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
      if (!token) throw new FinancialValidationError("Invalid JSON number.");
      out += JSON.stringify(token);
      i += token.length - 1;
    } else out += c;
  }
  try {
    return object(JSON.parse(out));
  } catch {
    throw new FinancialValidationError("Invalid source JSON.");
  }
}
/** Fractional cents are retained as raw source and require review, never silently rounded. */
export function minor(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !/^-?\d+(?:\.\d{1,2})?$/.test(v)) return null;
  const [whole, fraction = ""] = v.replace(/^-/, "").split(".");
  const result =
    (BigInt(whole) * BigInt("100") + BigInt(fraction.padEnd(2, "0"))) *
    (v.startsWith("-") ? -BigInt("1") : BigInt("1"));
  return result >= -BigInt("9223372036854775808") &&
    result <= BigInt("9223372036854775807")
    ? result
    : null;
}
export function dateOnly(v: unknown) {
  const text = str(v)?.slice(0, 10);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new FinancialValidationError("Explicit source period required.");
  const date = new Date(text + "T00:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  )
    throw new FinancialValidationError("Invalid source date.");
  return date;
}
// Millisecond projection for display/storage only; never provider identity.
export const optionalTime = (v: unknown) => {
  const instant = providerInstant(v);
  return instant === null ? null : new Date(instant);
};
/** Manifest equality uses instant semantics; source metadata and evidence stay raw. */
export const inventoryFingerprint = (items: SourceObject[]) =>
  hash(
    items
      .map((x) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries({
              ...x,
              updated_date: providerInstant(x.updated_date),
            }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
        ),
      )
      .sort()
      .join("\n"),
  );
export function normalizeStatement(bytes: Uint8Array) {
  const d = object(parseSource(bytes).data),
    h = object(d.header),
    recipient = object(h.driver),
    period = object(h.period_info),
    pay = object(h.net_pay_info);
  const providerStatementId = uuid(d.statement_id),
    providerVersion = integer(d.version),
    recipientId = uuid(d.driver_id);
  const pid = str(period.batch_id);
  if (
    !pid ||
    !/^\d{4}-\d{2}$/.test(pid) ||
    pid.replace("-", "") !== String(d.batch_id)
  )
    throw new FinancialValidationError("Source PID mismatch.");
  const workStart = dateOnly(period.start_date),
    workEnd = dateOnly(period.end_date);
  if (workEnd < workStart || typeof recipient.contractor !== "boolean")
    throw new FinancialValidationError("Invalid statement header.");
  const issues: string[] = [];
  const money = (v: unknown, field: string) => {
    const n = minor(v);
    if (v != null && n === null) issues.push(`Unresolved precision: ${field}`);
    return n;
  };
  const arrays: [string, string, string][] = [
    ["trips", "TRIP", "net_amount"],
    ["earnings", "EARNING", "amount"],
    ["fuel_transactions", "DEDUCTION", "pay_amount"],
    ["toll_transactions", "DEDUCTION", "amount"],
    ["advance_deductions", "DEDUCTION", "charge"],
    ["deductions", "DEDUCTION", "charge"],
    ["accessorials", "OTHER", "amount"],
    ["fixed_pays", "OTHER", "amount"],
    ["salary_deductions", "OTHER", "amount"],
  ];
  const lines = arrays.flatMap(([sourceArray, kind, amountField]) => {
    const values = d[sourceArray];
    if (values == null) return [];
    if (!Array.isArray(values) || values.length > 5000)
      throw new FinancialValidationError("Invalid source lines.");
    return values.map((v, sourceOrder) => {
      const x = object(v),
        rawAmount = str(x[amountField]);
      return {
        kind,
        sourceArray,
        sourceOrder,
        providerLineId: str(x.id),
        description: str(x.name) ?? str(x.merchant),
        sourceType: str(x.type),
        amountMinor: money(rawAmount, `${sourceArray}[${sourceOrder}]`),
        rawAmount,
        sourceDate: str(x.date),
        reference: str(x.fuel_transaction_id) ?? str(x.trip_ref_number),
        sourceUnit: str(x.truck_unit) ?? str(x.unit_id),
        included:
          x.excluded === true || x.skipped === true || x.chargeable === false
            ? false
            : x.excluded === false || x.skipped === false
              ? true
              : null,
        metadata: x,
      };
    });
  });
  const ti = object(recipient.truck_info);
  const sourceTrucks = [
    ...(Object.keys(ti).length
      ? [
          {
            sourceKey: "header",
            providerTruckId: str(ti.id),
            unit: str(ti.unit),
            vin: str(ti.vin),
          },
        ]
      : []),
    ...(Array.isArray(d.contracts)
      ? d.contracts.map((v, i) => {
          const x = object(v);
          return {
            sourceKey: `contracts:${i}`,
            providerTruckId: str(x.truck_id),
            unit: str(x.truck_unit_id),
            vin: str(x.vin),
          };
        })
      : []),
  ];
  const ytd = object(h.ytd_info);
  const normalized = {
    totalTrips: str(period.total_trips),
    loadedMiles: str(period.total_loaded),
    deadheadMiles: str(period.total_deadhead),
    totalMiles: str(period.total_miles),
    ytdGrossMinor: money(ytd.gross, "ytd_gross"),
    ytdNetPayMinor: money(ytd.net_pay, "ytd_net"),
    ytdPayoutMinor: money(ytd.payout, "ytd_payout"),
  };
  const header = {
    pid,
    statementNumber: str(period.statement_number),
    recipientId,
    recipientName: str(recipient.name),
    recipientType: recipient.contractor ? "CONTRACTOR" : "DRIVER",
    recipientStatus: str(recipient.status),
    role: str(recipient.role),
    contract: str(recipient.contract_info),
    sourceStatus: str(d.status),
    workStart,
    workEnd,
    grossMinor: money(pay.gross, "gross"),
    deductionsMinor: money(pay.deductions, "deductions"),
    netPayMinor: money(pay.net_pay, "net_pay"),
    payoutMinor: money(pay.payout, "payout"),
    earningMinor: money(pay.earning, "earning"),
    header: { ...h, normalized },
    parserVersion: "quickmanage-evidence-v1",
    providerCreatedAt: optionalTime(d.created_date),
    providerUpdatedAt: optionalTime(d.updated_date),
  };
  return {
    providerStatementId,
    providerVersion,
    header,
    lines,
    sourceTrucks,
    issues,
  };
}
export function displayFilename(
  company: string,
  n: ReturnType<typeof normalizeStatement>,
) {
  return (
    [
      company,
      `PID_${n.header.pid}`,
      n.header.statementNumber && `Statement_${n.header.statementNumber}`,
      n.sourceTrucks.length === 1 &&
        n.sourceTrucks[0].unit &&
        `Truck_${n.sourceTrucks[0].unit}`,
      n.header.recipientName,
    ]
      .filter(Boolean)
      .join("__")
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(0, 220) + ".pdf"
  );
}
