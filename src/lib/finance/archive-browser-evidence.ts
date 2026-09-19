// Browser-safe transport guard. Runs before upload AND again on the server.
import { FinancialValidationError } from "./financial-control-errors";
const fail = (): never => {
  throw new FinancialValidationError(
    "Only QuickManage business evidence exports are accepted. Credentials, browser exports and URLs must never be uploaded.",
  );
};
export function businessOnly(value: unknown, depth = 0): void {
  if (depth > 30) fail();
  if (
    typeof value === "string" &&
    (/https?:\/\/|Bearer\s+|\beyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(value) ||
      value.length > 20000)
  )
    fail();
  if (Array.isArray(value)) {
    if (value.length > 5000) fail();
    value.forEach((v) => businessOnly(v, depth + 1));
  } else if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      if (
        /cookie|token|authorization|password|secret|csrf|headers|storage|(?:^|_)url$|__proto__|constructor|prototype/i.test(
          key,
        )
      )
        fail();
      businessOnly(v, depth + 1);
    }
}
export function browserEvidenceGuard(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const x = value as Record<string, unknown>;
  if (x.format !== "fleetpilot.quickmanage.v1" || x.provider !== "QUICKMANAGE")
    fail();
  const fields: Record<string, string[]> = {
    companies: ["companies"],
    inventory: ["companyId", "pid", "items", "verifiedTwice"],
    statement: [
      "companyId",
      "pid",
      "statementId",
      "version",
      "detailBase64",
      "pdfBase64",
      "detailAfterSha256",
      "pdfSha256",
      "mimeType",
    ],
  };
  if (!["companies", "inventory", "statement"].includes(String(x.kind))) fail();
  const allowed = fields[String(x.kind)];
  if (
    !allowed ||
    Object.keys(x).some(
      (k) => !["format", "kind", "provider", ...allowed].includes(k),
    )
  )
    fail();
  if (x.kind !== "statement") {
    businessOnly(x);
    return;
  }
  const { detailBase64, pdfBase64, ...safe } = x;
  businessOnly(safe);
  if (
    typeof detailBase64 !== "string" ||
    detailBase64.length > 14 * 1024 * 1024 ||
    typeof pdfBase64 !== "string" ||
    pdfBase64.length > 28 * 1024 * 1024
  )
    fail();
  try {
    const decoded = atob(detailBase64 as string);
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    const detail = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    businessOnly(detail);
    const pdf = atob(pdfBase64 as string);
    if (
      !pdf.startsWith("%PDF-") ||
      /Bearer\s+|\beyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(pdf)
    )
      fail();
  } catch {
    fail();
  }
}
