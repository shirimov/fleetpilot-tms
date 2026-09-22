"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMinorUnitsDecimal } from "@/lib/finance/money";

type Dimension = { id: string; name?: string; unitNumber?: string };
type Totals = { count: number; pilotActualMinor: string; expectedMinor: string; statementMinor: string; differenceMinor: string };
type Row = {
  key: string; status: string; companyId: string | null; companyName: string | null; pid: string | null;
  purchaseDate: string | null; statementPeriod: string | null; truckId: string | null; truckUnit: string | null;
  recipientId: string | null; recipientName: string | null; responsibility: string | null; pilotActualMinor: string;
  pilotRetailMinor: string | null; pilotSavingsMinor: string | null; expectedMinor: string | null; statementMinor: string;
  differenceMinor: string | null; observedAmountDeltaMinor: string | null; retainedDiscountMinor: string | null; policyId: string | null; policyLabel: string | null;
  historicalCompanyId: string | null; postedCompanyId: string | null; postedCompanyName: string | null;
  historyDiffersFromPosted: boolean; products: string[]; gallons: string; matchMethod: string | null;
  pilotInvoiceNumber: string | null;
  pilotEvidence: { eventId: string; invoiceId: string; invoiceNumber: string; transactionId: string | null } | null;
  statementEvidence: { lineIds: string[]; versionId: string; pid: string; statementNumber: string | null; description: string | null; reference: string | null } | null;
};
type Result = {
  coverage: { start: string | null; end: string | null };
  summary: Totals & { comparablePilotMinor: string; outsideCoverageStatementMinor: string; reeferExcludedMinor: string; providerCreditExcludedMinor: string; historicalPostedDifferences: number };
  byStatus: Record<string, Totals>; byCompany: Array<Totals & { companyId: string; companyName: string }>;
  rows: Row[]; total: number; page: number; pageSize: number;
};
type Policy = { id: string; companyId: string; truckId: string | null; providerRecipientId: string | null; responsibility: string; discountTreatment: string; companyRetentionBasisPoints: number; effectiveFrom: string; effectiveTo: string | null; sourceReference: string; reason: string; company: { name: string }; truck: { unitNumber: string } | null; approvedBy: { displayName: string } };

const box = "rounded-xl border border-white/10 bg-slate-900/70 p-4";
const input = "rounded border border-white/20 bg-slate-950 p-2 max-w-full";
const money = (value: string | null | undefined) => value == null ? "—" : `$${formatMinorUnitsDecimal(BigInt(value))}`;
const statuses = ["MATCHED","UNDER_DEDUCTED","OVER_DEDUCTED","MISSING_DEDUCTION","STATEMENT_ONLY","TIMING_DIFFERENCE","NO_PILOT_DATA_IMPORTED","NEEDS_COMPANY_HISTORY","NEEDS_TRUCK_MAPPING","NEEDS_RECIPIENT_MAPPING","NEEDS_POLICY","NEEDS_REVIEW"];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init); const body = await response.json();
  if (!response.ok) throw Error(body.error ?? "Reconciliation request failed.");
  return body as T;
}

export default function FuelReconciliationWorkspace({ companies, trucks }: { companies: Dimension[]; trucks: Dimension[] }) {
  const params = useSearchParams(), router = useRouter(), query = params.toString();
  const [result, setResult] = useState<Result | null>(null), [policies, setPolicies] = useState<Policy[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [showPolicies, setShowPolicies] = useState(params.get("reconciliation") === "policies");
  const page = Number(params.get("page") ?? 1);
  const go = (updates: Record<string, string>) => { const next = new URLSearchParams(query); next.set("view", "statements"); next.set("archive", "reconciliation"); next.delete("page"); for (const [key, value] of Object.entries(updates)) { if (value) next.set(key, value); else next.delete(key); } router.push(`/accounting?${next}`); };
  useEffect(() => {
    const controller = new AbortController(); setError("");
    Promise.all([request<Result>(`/api/finance/fuel-reconciliation?${new URLSearchParams([...new URLSearchParams(query)].filter(([key]) => ["page","company","pid","date","truck","recipient","responsibility","status","policy"].includes(key)))}`, { signal: controller.signal }), request<Policy[]>("/api/finance/fuel-reconciliation?view=policies", { signal: controller.signal })])
      .then(([preview, configured]) => { if (!controller.signal.aborted) { setResult(preview); setPolicies(configured); } })
      .catch(caught => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [query]);
  useEffect(() => setShowPolicies(params.get("reconciliation") === "policies"), [params]);
  async function createPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = event.currentTarget;
    try { await request("/api/finance/fuel-reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); const configured = await request<Policy[]>("/api/finance/fuel-reconciliation?view=policies"); setPolicies(configured); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Policy could not be saved."); } finally { setBusy(false); }
  }
  if (!result) return <p role="status">Loading fuel deduction reconciliation…</p>;
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3"><button aria-current={!showPolicies ? "page" : undefined} onClick={() => { setShowPolicies(false); go({ reconciliation: "" }); }}>Results</button><button aria-current={showPolicies ? "page" : undefined} onClick={() => { setShowPolicies(true); go({ reconciliation: "policies" }); }}>Policies</button></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {showPolicies ? <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <form className={`${box} grid gap-3`} onSubmit={createPolicy}><h3 className="font-semibold">Add effective-dated fuel deduction policy</h3>
        <select className={input} name="companyId" required><option value="">Company</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select>
        <select className={input} name="truckId"><option value="">All Trucks in Company</option>{trucks.map(truck => <option key={truck.id} value={truck.id}>Truck {truck.unitNumber}</option>)}</select>
        <input className={input} name="providerRecipientId" placeholder="QuickManage recipient ID (optional)" />
        <select className={input} name="responsibility"><option value="RECIPIENT">Recipient responsible</option><option value="COMPANY">Company responsible</option></select>
        <select className={input} name="discountTreatment"><option value="FULL_PASS_THROUGH">Full discount pass-through</option><option value="COMPANY_RETENTION">Company retains discount share</option></select>
        <label className="grid gap-1 text-xs">Company retention basis points<input className={input} name="companyRetentionBasisPoints" type="number" min="0" max="10000" defaultValue="0" /></label>
        <label className="grid gap-1 text-xs">Effective from<input className={input} name="effectiveFrom" type="date" required /></label><label className="grid gap-1 text-xs">Effective to (exclusive)<input className={input} name="effectiveTo" type="date" /></label>
        <input className={input} name="sourceReference" required placeholder="Agreement/evidence reference" /><textarea className={input} name="reason" required placeholder="Reviewed business reason" />
        <p className="text-xs text-slate-400">Policies calculate control expectations only. They never post expenses, receivables, or recoveries.</p><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save reviewed policy"}</button>
      </form>
      <div className="space-y-2">{policies.map(policy => <article className={box} key={policy.id}><strong>{policy.company.name}{policy.truck ? ` · Truck ${policy.truck.unitNumber}` : " · Company scope"}</strong><p>{policy.providerRecipientId ?? "All recipients"} · {policy.responsibility} · {policy.discountTreatment} · {(policy.companyRetentionBasisPoints / 100).toFixed(2)}% retained</p><p className="text-xs text-slate-400">{policy.effectiveFrom.slice(0,10)} – {policy.effectiveTo?.slice(0,10) ?? "ongoing"} · {policy.sourceReference} · approved by {policy.approvedBy.displayName}</p><p className="text-xs">{policy.reason}</p></article>)}{!policies.length && <p>No fuel deduction policies are configured. Contractor recoveries remain NEEDS_POLICY.</p>}</div>
    </div> : <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{[["Pilot coverage", `${result.coverage.start ?? "—"} – ${result.coverage.end ?? "—"}`],["Comparable Diesel + DEF", money(result.summary.comparablePilotMinor)],["Expected deductions", money(result.summary.expectedMinor)],["Statement deducted in coverage", money(result.summary.statementMinor)],["Difference", money(result.summary.differenceMinor)],["Outside coverage", money(result.summary.outsideCoverageStatementMinor)],["Reefer excluded", money(result.summary.reeferExcludedMinor)],["Provider credit excluded", money(result.summary.providerCreditExcludedMinor)],["Historical ≠ posted", result.summary.historicalPostedDifferences]].map(([label,value]) => <article className={box} key={String(label)}><p className="text-xs text-slate-400">{label}</p><strong>{value}</strong></article>)}</div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{statuses.map(status => <button className={`${box} text-left`} key={status} onClick={() => go({ status })}><span className="text-xs">{status.replaceAll("_", " ")}</span><strong className="block text-lg">{result.byStatus[status]?.count ?? 0}</strong><span className="text-xs">{money(result.byStatus[status]?.differenceMinor ?? "0")}</span></button>)}</div>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); go(Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>); }}>
        <select className={input} name="company" defaultValue={params.get("company") ?? ""}><option value="">All companies</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select><input className={input} name="pid" placeholder="PID" defaultValue={params.get("pid") ?? ""}/><input aria-label="Purchase or statement date" className={input} name="date" type="date" defaultValue={params.get("date") ?? ""}/><input className={input} name="truck" placeholder="Truck" defaultValue={params.get("truck") ?? ""}/><input className={input} name="recipient" placeholder="Recipient" defaultValue={params.get("recipient") ?? ""}/><select className={input} name="responsibility" defaultValue={params.get("responsibility") ?? ""}><option value="">All responsibility</option><option value="COMPANY">Company</option><option value="RECIPIENT">Recipient</option><option value="DRIVER">Driver evidence</option><option value="CONTRACTOR">Contractor evidence</option></select><select className={input} name="status" defaultValue={params.get("status") ?? ""}><option value="">All statuses</option>{statuses.map(status => <option key={status}>{status}</option>)}</select><select className={input} name="policy" defaultValue={params.get("policy") ?? ""}><option value="">All policy states</option><option value="known">Known policy</option><option value="missing">Needs policy</option></select><button className="btn">Apply filters</button>
      </form>
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr>{["Company","PID / period","Truck","Owner / Contractor","Pilot actual","Expected","Statement deducted","Difference","Status"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr className="border-t border-white/10 align-top" key={row.key}><td className="p-2">{row.companyName ?? "—"}</td><td className="p-2">{row.pid ?? "—"}<small className="block">{row.statementPeriod ?? row.purchaseDate ?? "—"}</small></td><td className="p-2">{row.truckUnit ?? "Needs mapping"}</td><td className="p-2">{row.recipientName ?? row.recipientId ?? "Needs mapping"}<small className="block">{row.responsibility ?? "—"}</small></td><td className="p-2">{money(row.pilotActualMinor)}</td><td className="p-2">{money(row.expectedMinor)}</td><td className="p-2">{money(row.statementMinor)}</td><td className="p-2">{money(row.differenceMinor)}</td><td className="p-2"><strong>{row.status.replaceAll("_", " ")}</strong><details className="mt-2 max-w-sm"><summary className="cursor-pointer text-emerald-300">Evidence and calculation</summary><div className="space-y-2 py-2 text-xs"><h4 className="font-semibold">SUMMARY</h4><p>Pilot {money(row.pilotActualMinor)} · Expected {money(row.expectedMinor)} · Statement {money(row.statementMinor)} · Difference {money(row.differenceMinor)}</p><h4 className="font-semibold">PILOT EVIDENCE</h4><p>{row.purchaseDate ?? "—"} · {row.products.join(", ") || "—"} · {row.gallons} gallons · retail {money(row.pilotRetailMinor)} · savings {money(row.pilotSavingsMinor)} · invoice {row.pilotInvoiceNumber ?? "—"}</p><p>Historical Company {row.companyName ?? "unresolved"} · Posted Company {row.postedCompanyName ?? "—"}{row.historyDiffersFromPosted ? " · REVIEW DIFFERENCE" : ""}</p><h4 className="font-semibold">STATEMENT EVIDENCE</h4>{row.statementEvidence ? <p>PID {row.statementEvidence.pid} · statement {row.statementEvidence.statementNumber ?? "—"} · {row.statementEvidence.description ?? "Fuel deduction"} · <a className="text-emerald-300" href={`/api/finance/archive?download=${row.statementEvidence.versionId}`}>Source PDF</a></p> : <p>No matched statement deduction.</p>}<h4 className="font-semibold">POLICY</h4><p>{row.policyLabel ?? "No applicable policy"} · retained discount {money(row.retainedDiscountMinor)}</p><h4 className="font-semibold">TIMING / IDENTITY</h4><p>{row.matchMethod ?? "No defensible match"} · purchase {row.purchaseDate ?? "—"} · deduction {row.statementPeriod ?? "—"} · Truck {row.truckUnit ?? "unresolved"}</p></div></details></td></tr>)}</tbody></table></div>
      {!result.rows.length && <p>No reconciliation rows match these filters.</p>}<div className="flex gap-3"><button disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>Previous</button><span>Page {page} · {result.total} rows</span><button disabled={page * result.pageSize >= result.total} onClick={() => go({ page: String(page + 1) })}>Next</button></div>
    </>}
  </div>;
}
