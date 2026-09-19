import { businessOnly } from "./archive-browser-evidence";
export { businessOnly } from "./archive-browser-evidence";
import { FinancialValidationError } from "./financial-control-errors";
import {
  hash,
  integer,
  minor,
  normalizeStatement,
  parseSource,
  uuid,
  type SourceObject,
} from "./archive-normalize";

export const BRIDGE_FORMAT = "fleetpilot.quickmanage.v1";
export const BRIDGE_UPLOAD_LIMIT = 42 * 1024 * 1024;
export const BRIDGE_BATCH_LIMIT = 10;
const fail = (message = "Invalid browser evidence."): never => {
  throw new FinancialValidationError(message);
};
export function record(v: unknown): SourceObject {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail();
  return v as SourceObject;
}
export function exact(v: unknown, keys: string[]) {
  const x = record(v);
  if (Object.keys(x).some((k) => !keys.includes(k)))
    fail("Unexpected evidence field. Credentials and URLs are not accepted.");
  return x;
}
export function text(v: unknown, max = 200): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    /[\x00-\x1f]/.test(v)
  )
    fail();
  return v as string;
}
export function pidValue(v: unknown) {
  const p = text(v, 7);
  if (!/^\d{4}-(0[1-9]|[1-4]\d|5[0-3])$/.test(p)) fail("Invalid PID.");
  return p;
}
function envelope(v: unknown, kind: string, keys: string[]) {
  const x = exact(v, ["format", "kind", "provider", ...keys]);
  if (
    x.format !== BRIDGE_FORMAT ||
    x.kind !== kind ||
    x.provider !== "QUICKMANAGE"
  )
    fail("Unsupported evidence format/provider.");
  return x;
}
export type BrowserCompany = {
  id: string;
  carrier_name: string;
  status: string;
  statementCount: number;
  earliestPid: string | null;
  latestPid: string | null;
  dot_number: string | null;
  mc_number: string | null;
};
export function validateCatalog(value: unknown): BrowserCompany[] {
  const e = envelope(value, "companies", ["companies"]);
  businessOnly(e);
  if (
    !Array.isArray(e.companies) ||
    !e.companies.length ||
    e.companies.length > 100
  )
    fail();
  const companies = (e.companies as unknown[]).map((v) => {
    const c = exact(v, [
      "id",
      "carrier_name",
      "status",
      "statementCount",
      "earliestPid",
      "latestPid",
      "dot_number",
      "mc_number",
    ]);
    const result = {
      id: uuid(c.id),
      carrier_name: text(c.carrier_name),
      status: text(c.status, 30),
      statementCount: integer(c.statementCount),
      earliestPid: c.earliestPid == null ? null : pidValue(c.earliestPid),
      latestPid: c.latestPid == null ? null : pidValue(c.latestPid),
      dot_number: c.dot_number == null ? null : text(c.dot_number, 30),
      mc_number: c.mc_number == null ? null : text(c.mc_number, 30),
    };
    if (
      result.earliestPid &&
      result.latestPid &&
      result.earliestPid > result.latestPid
    )
      fail();
    return result;
  });
  if (new Set(companies.map((c) => c.id)).size !== companies.length)
    fail("Duplicate Company identity.");
  return companies.sort((a, b) => a.id.localeCompare(b.id));
}
const itemKeys = [
  "carrier_id",
  "statement_id",
  "version",
  "batch_id",
  "driver_id",
  "contractor",
  "first_name",
  "last_name",
  "truck_unit_id",
  "role",
  "status",
  "gross",
  "deductions",
  "net_pay",
  "payout",
  "updated_date",
  "start_date",
  "end_date",
];
function money(v: unknown) {
  if (typeof v !== "string" || v.length > 40 || !/^-?\d+(\.\d+)?$/.test(v))
    fail("Invalid money.");
  // Source fractional cents remain explicit parser issues; malformed/overflow amounts cannot enter the archive.
  const integerPart = (v as string).split(".")[0];
  if (minor(integerPart) === null) fail("Money exceeds supported range.");
}
export function validateInventory(value: unknown) {
  const e = envelope(value, "inventory", [
    "companyId",
    "pid",
    "items",
    "verifiedTwice",
  ]);
  businessOnly(e);
  const companyId = uuid(e.companyId),
    pid = pidValue(e.pid);
  if (
    e.verifiedTwice !== true ||
    !Array.isArray(e.items) ||
    e.items.length > 2000
  )
    fail("A bounded, twice-read inventory is required.");
  const items = (e.items as unknown[])
    .map((v) => {
      const x = exact(v, itemKeys);
      const clean: SourceObject = {};
      for (const k of itemKeys) if (x[k] !== undefined) clean[k] = x[k];
      clean.carrier_id = uuid(x.carrier_id);
      clean.statement_id = uuid(x.statement_id);
      clean.driver_id = uuid(x.driver_id);
      clean.version = String(integer(x.version));
      if (
        clean.carrier_id !== companyId ||
        String(x.batch_id) !== pid.replace("-", "") ||
        typeof x.contractor !== "boolean"
      )
        fail("Inventory scope mismatch.");
      clean.batch_id = pid.replace("-", "");
      for (const k of ["gross", "deductions", "net_pay", "payout"]) money(x[k]);
      for (const k of [
        "first_name",
        "last_name",
        "role",
        "status",
        "truck_unit_id",
      ])
        if (
          x[k] != null &&
          (typeof x[k] !== "string" || (x[k] as string).length > 200)
        )
          fail();
      if (
        typeof x.updated_date !== "string" ||
        !Number.isFinite(Date.parse(x.updated_date))
      )
        fail("Source timestamp required.");
      return clean;
    })
    .sort((a, b) =>
      String(a.statement_id).localeCompare(String(b.statement_id)),
    );
  if (new Set(items.map((x) => x.statement_id)).size !== items.length)
    fail("Duplicate statement identity.");
  return {
    companyId,
    pid,
    items,
    fingerprint: hash(
      items
        .map((x) => JSON.stringify(x))
        .sort()
        .join("\n"),
    ),
    metadata: {
      verifiedTwice: true,
      acquisition: "BROWSER_EVIDENCE_V1",
      companyId,
      pid,
    },
  };
}
function decode(v: unknown, max: number) {
  if (
    typeof v !== "string" ||
    v.length > Math.ceil(max / 3) * 4 ||
    !v.length ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)
  )
    fail("Invalid bounded evidence encoding.");
  const b = Buffer.from(v as string, "base64");
  if (!b.length || b.length > max) fail("Evidence too large.");
  return b;
}
export function validateBundle(value: unknown) {
  const e = envelope(value, "statement", [
    "companyId",
    "pid",
    "statementId",
    "version",
    "detailBase64",
    "pdfBase64",
    "detailAfterSha256",
    "pdfSha256",
    "mimeType",
  ]);
  const companyId = uuid(e.companyId),
    pid = pidValue(e.pid),
    statementId = uuid(e.statementId),
    version = integer(e.version);
  const detail = decode(e.detailBase64, 10 * 1024 * 1024),
    pdf = decode(e.pdfBase64, 20 * 1024 * 1024);
  if (
    e.mimeType !== "application/pdf" ||
    pdf.subarray(0, 5).toString() !== "%PDF-" ||
    !pdf.subarray(-1024).includes(Buffer.from("%%EOF"))
  )
    fail("Invalid original PDF.");
  if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(pdf.toString("latin1")))
    fail("Active PDF content is not accepted.");
  if (hash(pdf) !== e.pdfSha256 || hash(detail) !== e.detailAfterSha256)
    fail("Evidence checksum or source stability mismatch.");
  const raw = parseSource(detail);
  businessOnly(raw);
  const d = record(raw.data),
    h = record(d.header),
    pay = record(h.net_pay_info),
    recipient = record(h.driver);
  text(record(h.carrier).name);
  text(recipient.name);
  integer(record(h.period_info).statement_number);
  for (const k of ["gross", "deductions", "net_pay", "payout"]) money(pay[k]);
  if (d.carrier_id != null && uuid(d.carrier_id) !== companyId)
    fail("Detail Company UUID mismatch.");
  for (const k of [
    "earning",
    "fuel_transactions",
    "toll_transactions",
    "cash_advance",
    "reimbursement",
  ])
    if (pay[k] != null) money(pay[k]);
  for (const [key, field] of [
    ["trips", "net_amount"],
    ["earnings", "amount"],
    ["fuel_transactions", "pay_amount"],
    ["toll_transactions", "amount"],
    ["advance_deductions", "charge"],
    ["deductions", "charge"],
    ["accessorials", "amount"],
    ["fixed_pays", "amount"],
    ["salary_deductions", "amount"],
  ]) {
    if (d[key] != null) {
      if (!Array.isArray(d[key])) fail("Invalid source lines.");
      for (const line of d[key] as unknown[]) {
        const r = record(line);
        if (r[field] != null) money(r[field]);
      }
    }
  }
  const normalized = normalizeStatement(detail);
  for (const truck of normalized.sourceTrucks)
    if (truck.providerTruckId) uuid(truck.providerTruckId);
  for (const line of normalized.lines)
    if (line.rawAmount != null) money(line.rawAmount);
  if (
    normalized.providerStatementId !== statementId ||
    normalized.providerVersion !== version ||
    normalized.header.pid !== pid
  )
    fail("Envelope/detail identity mismatch.");
  return {
    companyId,
    pid,
    statementId,
    version,
    detail,
    pdf,
    normalized,
    carrierName: String(record(h.carrier).name),
  };
}
