import { statementBusinessFingerprint } from "./archive-business-fingerprint";
import { providerInstant } from "./archive-time";
import { businessOnly } from "./archive-browser-evidence";
export { businessOnly } from "./archive-browser-evidence";
import { FinancialValidationError } from "./financial-control-errors";
import {
  dateOnly,
  hash,
  integer,
  inventoryFingerprint,
  minor,
  normalizeStatement,
  parseSource,
  uuid,
  type SourceObject,
} from "./archive-normalize";

export const BRIDGE_FORMAT = "fleetpilot.quickmanage.v1";
export { BRIDGE_UPLOAD_LIMIT } from "./archive-browser-evidence";
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
  if (
    minor(integerPart) === null ||
    (/^-?\d+(?:\.\d{1,2})?$/.test(v as string) && minor(v) === null)
  )
    fail("Money exceeds supported range.");
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
      if (providerInstant(x.updated_date) === null)
        fail("Source timestamp required.");
      if (dateOnly(x.end_date) < dateOnly(x.start_date))
        fail("Invalid inventory period.");
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
    fingerprint: inventoryFingerprint(items),
    metadata: {
      verifiedTwice: true,
      acquisition: "BROWSER_EVIDENCE_V1",
      completenessBasis: "CAPTURED_INVENTORY_SNAPSHOT",
      assurance: "USER_ATTESTED_CHECKSUM_SEALED",
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

// These four immutable provider PDFs were independently parsed with Poppler and
// contain no JavaScript. Their only `/JS` byte sequence occurs inside compressed
// stream data. Both statement identity and exact PDF checksum must match; every
// other active-content match remains rejected.
const REVIEWED_QUICKMANAGE_PDF_STREAM_FALSE_POSITIVES = new Map([
  [
    "e599c860-01e9-4b26-bc93-e98b7d1292f9",
    "8cf7ec575510de5b69897161e0d667b2ce45b53c3df95c5ecf96480c3f6a89a9",
  ],
  [
    "ffd2ba43-3f04-41f2-82e7-b01289f40a73",
    "3d9546d72fb3d09d3a0e487676a0a2cc67d02760b8b4b240a0b95b0a950ca197",
  ],
  [
    "13468020-624c-4f76-9840-8cdce9eec9af",
    "22629d24d31705db944dda6a1dc7510058d74f91d4712926d01ff95923a971a4",
  ],
  [
    "e4640af4-f0e4-4fbc-af16-cf358451dd5e",
    "763eb2552d341aa650f3b7b5817104fd063aacf63da19508ae8921a400b6549e",
  ],
]);

export function reviewedPdfStreamFalsePositive(
  statementId: string,
  pdfChecksum: string,
) {
  return (
    REVIEWED_QUICKMANAGE_PDF_STREAM_FALSE_POSITIVES.get(statementId) ===
    pdfChecksum
  );
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
    "detailAfterBase64",
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
  const pdfChecksum = hash(pdf);
  if (
    /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(pdf.toString("latin1")) &&
    !reviewedPdfStreamFalsePositive(statementId, pdfChecksum)
  )
    fail("Active PDF content is not accepted.");
  const after =
    e.detailAfterBase64 === undefined
      ? detail // Legacy exports remain accepted only with exact raw equality.
      : decode(e.detailAfterBase64, 10 * 1024 * 1024);
  if (pdfChecksum !== e.pdfSha256 || hash(after) !== e.detailAfterSha256)
    fail("Evidence checksum or source stability mismatch.");
  businessOnly(parseSource(after));
  if (
    statementBusinessFingerprint(detail) !== statementBusinessFingerprint(after)
  )
    fail("Statement business content changed during acquisition.");
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
  if (h.ytd_info != null) {
    const ytd = record(h.ytd_info);
    for (const key of ["gross", "net_pay", "payout"])
      if (ytd[key] != null) money(ytd[key]);
  }
  for (const key of ["created_date", "updated_date"]) providerInstant(d[key]);
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
