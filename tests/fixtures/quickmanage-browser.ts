import { BRIDGE_FORMAT } from "@/lib/finance/archive-bridge-validation";
import { hash } from "@/lib/finance/archive-normalize";
import { statementFixture } from "./quickmanage";
export const catalogEvidence = (id: string) => ({
  format: BRIDGE_FORMAT,
  kind: "companies",
  provider: "QUICKMANAGE",
  companies: [
    {
      id,
      carrier_name: "Synthetic Carrier",
      status: "active",
      statementCount: 5,
      earliestPid: "2025-42",
      latestPid: "2026-37",
      dot_number: "1234567",
      mc_number: "123456",
    },
  ],
});
export function bundleEvidence(
  companyId: string,
  f: ReturnType<typeof statementFixture>,
) {
  return {
    format: BRIDGE_FORMAT,
    kind: "statement",
    provider: "QUICKMANAGE",
    companyId,
    pid: f.pid,
    statementId: f.id,
    version: f.payload.data.version,
    detailBase64: f.bundle.detail.toString("base64"),
    pdfBase64: f.bundle.pdf.toString("base64"),
    detailAfterSha256: hash(f.bundle.detail),
    pdfSha256: hash(f.bundle.pdf),
    mimeType: "application/pdf",
  };
}
export function inventoryEvidence(
  companyId: string,
  fixtures: ReturnType<typeof statementFixture>[],
) {
  return {
    format: BRIDGE_FORMAT,
    kind: "inventory",
    provider: "QUICKMANAGE",
    companyId,
    pid: fixtures[0]?.pid ?? "2026-37",
    verifiedTwice: true,
    items: fixtures.map((f) => ({
      carrier_id: companyId,
      statement_id: f.id,
      version: String(f.payload.data.version),
      batch_id: f.pid.replace("-", ""),
      driver_id: f.recipientId,
      contractor: f.payload.data.header.driver.contractor,
      first_name: "Synthetic",
      last_name: "Recipient",
      truck_unit_id: "8558",
      role: "CD",
      status: "settled",
      gross: "1000.01",
      deductions: "200.25",
      net_pay: "-20.25",
      payout: "0",
      updated_date: f.payload.data.updated_date,
      start_date: f.payload.data.header.period_info.start_date,
      end_date: f.payload.data.header.period_info.end_date,
    })),
  };
}
