"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMinorUnitsDecimal } from "@/lib/finance/money";

type Dimension = { id: string; name?: string; unitNumber?: string };
type Totals = { count: number; pilotActualMinor: string; expectedMinor: string; statementMinor: string; differenceMinor: string };
type Control = { key: string; label: string; count: number; filter: { status?: string; history?: string }; amounts: Array<{ amountMinor: string; amountBasis: string; amountLabel: string }> };
type CanonicalIdentityLink = {
  linkId: string; provider: string; providerTruckId: string; sourceUnit: string | null; sourceVin: string | null;
  sourceCompanyId: string; sourceCompanyName: string; canonicalTruckId: string; canonicalUnit: string; canonicalVin: string | null;
  canonicalCompanyId: string | null; canonicalCompanyName: string | null; actor: string; createdAt: string;
  reason: string; sourceReference: string; evidenceReferenceCount: number;
};
type Row = {
  key: string; status: string; companyId: string | null; companyName: string | null; pid: string | null;
  purchaseDate: string | null; statementPeriod: string | null; truckId: string | null; truckUnit: string | null;
  recipientId: string | null; recipientName: string | null; responsibility: string | null; pilotActualMinor: string;
  pilotRetailMinor: string | null; pilotSavingsMinor: string | null; expectedMinor: string | null; statementMinor: string;
  differenceMinor: string | null; observedAmountDeltaMinor: string | null; retainedDiscountMinor: string | null; policyId: string | null; policyLabel: string | null;
  historicalCompanyId: string | null; postedCompanyId: string | null; postedCompanyName: string | null; currentCompanyId: string | null; currentCompanyName: string | null;
  historyDiffersFromPosted: boolean; products: string[]; gallons: string; matchMethod: string | null;
  statementTruckUnit: string | null; statementRecipientId: string | null; statementRecipientName: string | null;
  statementProducts: string[]; productClassification: "SAME" | "DIESEL_REEFER_DIFFERENCE" | "CONFLICT" | null;
  canonicalIdentityLink: CanonicalIdentityLink | null;
  pilotInvoiceNumber: string | null;
  pilotEvidence: { eventId: string; invoiceId: string; invoiceNumber: string; transactionId: string | null } | null;
  statementEvidence: { lineIds: string[]; versionId: string; pid: string; statementNumber: string | null; description: string | null; reference: string | null } | null;
};
type Result = {
  coverage: { start: string | null; end: string | null };
  summary: Totals & { comparablePilotMinor: string; comparableStatementMinor: string; rawStatementDeductionMinor: string; rawFuelStatementMinor: string; unsupportedFuelStatementCount: number; unsupportedFuelStatementMinor: string; outsideCoverageStatementMinor: string; reeferExcludedMinor: string; providerCreditExcludedMinor: string; historicalPostedDifferences: number };
  controls: Control[];
  byStatus: Record<string, Totals>; byCompany: Array<Totals & { companyId: string; companyName: string }>;
  rows: Row[]; total: number; page: number; pageSize: number;
};
type EvidenceReference = { pilotEventId: string; purchaseDate: string; supportFrom: string; supportTo: string; statementVersionId: string; statementLineIds: string[] };
type PolicyRevision = { id: string; revision: number; before: { effectiveFrom: string; effectiveTo: string | null }; after: { effectiveFrom: string; effectiveTo: string | null }; reason: string; evidenceReferences: EvidenceReference[]; changedAt: string; actor: { displayName: string } };
type Policy = { id: string; companyId: string; truckId: string | null; providerRecipientId: string | null; responsibility: string; discountTreatment: string; companyRetentionBasisPoints: number; effectiveFrom: string; effectiveTo: string | null; sourceReference: string; reason: string; revision: number; company: { name: string }; truck: { unitNumber: string } | null; approvedBy: { displayName: string }; revisions: PolicyRevision[] };
type RevisionPreview = { policyId: string; expectedRevision: number; current: { effectiveFrom: string; effectiveTo: string; coveredRows: number; pilotMinor: string }; proposed: { effectiveFrom: string; effectiveTo: string; coveredRows: number; pilotMinor: string }; newlyCovered: { rows: number; pilotMinor: string; dates: string[] }; evidenceReferences: EvidenceReference[] };

const box = "rounded-xl border border-white/10 bg-slate-900/70 p-4";
const input = "rounded border border-white/20 bg-slate-950 p-2 max-w-full";
const money = (value: string | null | undefined) => value == null ? "—" : `$${formatMinorUnitsDecimal(BigInt(value))}`;
const statuses = ["MATCHED","UNDER_DEDUCTED","OVER_DEDUCTED","MISSING_DEDUCTION","STATEMENT_ONLY","TIMING_DIFFERENCE","NO_PILOT_DATA_IMPORTED","NEEDS_COMPANY_HISTORY","NEEDS_TRUCK_MAPPING","NEEDS_RECIPIENT_MAPPING","NEEDS_RECIPIENT_REVIEW","PRODUCT_CLASSIFICATION_REVIEW","NEEDS_POLICY","NEEDS_REVIEW"];
const matchExplanations: Record<string, string> = {
  PILOT_SUNDAY_QUICKMANAGE_SATURDAY: "Matched the Pilot Sunday date-only row to QuickManage's preceding Saturday source timestamp using Truck, recipient, card, location, geography, and product quantities.",
  HISTORICAL_CROSS_RECIPIENT_RECOVERED: "Recovered — historical cross-recipient settlement accepted under the OWNER rule through September 21, 2026. The original Pilot Truck and deducted statement recipient remain visible for audit.",
  CROSS_RECIPIENT_STRUCTURED_IDENTITY: "The same card, location, date convention, product quantity, and policy amount appear on another Truck or recipient statement. Recipient responsibility requires review.",
  DIESEL_REEFER_CLASSIFICATION_ACCEPTED: "Recovered — strong transaction identity confirms the same fuel purchase. Pilot and QuickManage Diesel/Reefer classifications remain different for audit and do not create a financial discrepancy.",
  PRODUCT_CLASSIFICATION_CONFLICT: "Pilot and QuickManage identify the same card/location transaction but assign its Diesel, DEF, or Reefer components differently. No over- or under-deduction conclusion is made.",
  AMBIGUOUS_STRUCTURED_IDENTITY: "More than one structured evidence candidate remains, so the matcher failed closed.",
  CROSS_COMPANY_RECOVERY_CONFIRMED: "Recovery is confirmed by the preceding Saturday QuickManage transaction despite its unavailable card field. The source Company remains visible and requires review.",
  WEEKEND_COMPANY_HISTORY_GAP: "The Pilot row is dated Sunday, but the preceding Saturday has no confirmed operating Company. Missing deduction is withheld until that provider-calendar boundary is resolved.",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init); const body = await response.json();
  if (!response.ok) throw Error(body.error ?? "Reconciliation request failed.");
  return body as T;
}

export default function FuelReconciliationWorkspace({ companies, trucks }: { companies: Dimension[]; trucks: Dimension[] }) {
  const params = useSearchParams(), router = useRouter(), query = params.toString();
  const [result, setResult] = useState<Result | null>(null), [policies, setPolicies] = useState<Policy[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [showPolicies, setShowPolicies] = useState(params.get("reconciliation") === "policies");
  const [revising, setRevising] = useState<string | null>(null), [revisionPreview, setRevisionPreview] = useState<RevisionPreview | null>(null);
  const page = Number(params.get("page") ?? 1);
  const go = (updates: Record<string, string>) => { const next = new URLSearchParams(query); next.set("view", "statements"); next.set("archive", "reconciliation"); if (!("page" in updates)) next.delete("page"); for (const [key, value] of Object.entries(updates)) { if (value) next.set(key, value); else next.delete(key); } router.push(`/accounting?${next}`); };
  const controlHref = (control: Control) => `/accounting?${new URLSearchParams({ view: "statements", archive: "reconciliation", ...control.filter })}`;
  useEffect(() => {
    const controller = new AbortController(); setError("");
    Promise.all([request<Result>(`/api/finance/fuel-reconciliation?${new URLSearchParams([...new URLSearchParams(query)].filter(([key]) => ["page","company","pid","date","truck","recipient","responsibility","status","policy","history"].includes(key)))}`, { signal: controller.signal }), request<Policy[]>("/api/finance/fuel-reconciliation?view=policies", { signal: controller.signal })])
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
  async function previewRevision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = event.currentTarget;
    try { setRevisionPreview(await request<RevisionPreview>("/api/finance/fuel-reconciliation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) })); }
    catch (caught) { setRevisionPreview(null); setError(caught instanceof Error ? caught.message : "Revision could not be previewed."); } finally { setBusy(false); }
  }
  async function saveRevision(form: HTMLFormElement) {
    if (!revisionPreview) return; setBusy(true); setError("");
    try {
      const body = { ...Object.fromEntries(new FormData(form)), expectedRevision: revisionPreview.expectedRevision, evidenceReferences: revisionPreview.evidenceReferences };
      await request("/api/finance/fuel-reconciliation", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setPolicies(await request<Policy[]>("/api/finance/fuel-reconciliation?view=policies")); setRevising(null); setRevisionPreview(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Policy revision could not be saved."); } finally { setBusy(false); }
  }
  if (!result) return <p role="status">Loading fuel deduction reconciliation…</p>;
  const activeControl = result.controls.find(control => control.filter.status === params.get("status") || control.filter.history === params.get("history"));
  return <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
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
      <div className="space-y-2">{policies.map(policy => <article className={box} key={policy.id}><strong>{policy.company.name}{policy.truck ? ` · Truck ${policy.truck.unitNumber}` : " · Company scope"}</strong><p>{policy.providerRecipientId ?? "All recipients"} · {policy.responsibility} · {policy.discountTreatment} · {(policy.companyRetentionBasisPoints / 100).toFixed(2)}% retained</p><p className="text-xs text-slate-400">Revision {policy.revision} · {policy.effectiveFrom.slice(0,10)} – {policy.effectiveTo?.slice(0,10) ?? "ongoing"} · {policy.sourceReference} · approved by {policy.approvedBy.displayName}</p><p className="text-xs">{policy.reason}</p>
        <button className="mt-2" type="button" onClick={() => { setRevising(revising === policy.id ? null : policy.id); setRevisionPreview(null); }}>Review range revision</button>
        {revising === policy.id && <form className="mt-3 grid gap-2 rounded border border-white/10 p-3" onSubmit={previewRevision}>
          <input type="hidden" name="policyId" value={policy.id} /><p className="text-xs"><strong>Current:</strong> {policy.effectiveFrom.slice(0,10)} – {policy.effectiveTo?.slice(0,10) ?? "ongoing"}</p>
          <label className="grid gap-1 text-xs">Proposed start<input className={input} name="effectiveFrom" type="date" defaultValue={policy.effectiveFrom.slice(0,10)} required onChange={() => setRevisionPreview(null)} /></label>
          <label className="grid gap-1 text-xs">Proposed end (exclusive)<input className={input} name="effectiveTo" type="date" defaultValue={policy.effectiveTo?.slice(0,10)} required onChange={() => setRevisionPreview(null)} /></label>
          <label className="grid gap-1 text-xs">Audited reason<textarea className={input} name="reason" minLength={10} required defaultValue="Extended effective range based on additional corroborated Pilot ↔ QuickManage fuel transactions." onChange={() => setRevisionPreview(null)} /></label>
          <button className="btn" disabled={busy}>{busy ? "Validating…" : "Preview impact"}</button>
          {revisionPreview?.policyId === policy.id && <section className="grid gap-2 rounded border border-emerald-400/30 p-3 text-sm" aria-label="Revision impact preview">
            <p><strong>Current:</strong> {revisionPreview.current.coveredRows} rows · {money(revisionPreview.current.pilotMinor)}</p><p><strong>Proposed:</strong> {revisionPreview.proposed.coveredRows} rows · {money(revisionPreview.proposed.pilotMinor)}</p><p><strong>Newly covered:</strong> {revisionPreview.newlyCovered.rows} rows · {money(revisionPreview.newlyCovered.pilotMinor)} · {revisionPreview.newlyCovered.dates.join(", ")}</p><p>{revisionPreview.evidenceReferences.length} immutable Pilot/statement evidence references will be retained.</p>
            <button className="btn" type="button" disabled={busy} onClick={event => saveRevision(event.currentTarget.closest("form")!)}>{busy ? "Saving…" : "Save audited revision"}</button>
          </section>}
        </form>}
        {!!policy.revisions.length && <details className="mt-3 text-xs"><summary className="cursor-pointer text-emerald-300">Revision history ({policy.revisions.length})</summary><div className="mt-2 space-y-2">{policy.revisions.map(revision => <div className="border-l border-white/20 pl-3" key={revision.id}><strong>Revision {revision.revision}</strong> · {new Date(revision.changedAt).toLocaleString()} · {revision.actor.displayName}<p>{revision.before.effectiveFrom} – {revision.before.effectiveTo ?? "ongoing"} → {revision.after.effectiveFrom} – {revision.after.effectiveTo ?? "ongoing"}</p><p>{revision.reason}</p><p>{revision.evidenceReferences.length} evidence references</p></div>)}</div></details>}
      </article>)}{!policies.length && <p>No fuel deduction policies are configured. Contractor recoveries remain NEEDS_POLICY.</p>}</div>
    </div> : <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{[["Pilot coverage", `${result.coverage.start ?? "—"} – ${result.coverage.end ?? "—"}`],["Comparable Pilot Diesel + Reefer + DEF", money(result.summary.comparablePilotMinor)],["Comparable statement fuel in coverage", money(result.summary.comparableStatementMinor)],["Raw statement fuel evidence", money(result.summary.rawFuelStatementMinor)],["All raw statement deductions", money(result.summary.rawStatementDeductionMinor)],["Expected deductions", money(result.summary.expectedMinor)],["Difference", money(result.summary.differenceMinor)],["Outside Pilot coverage", money(result.summary.outsideCoverageStatementMinor)],["Unsupported statement fuel excluded", `${result.summary.unsupportedFuelStatementCount} · ${money(result.summary.unsupportedFuelStatementMinor)}`],["Supported reefer excluded", money(result.summary.reeferExcludedMinor)],["Provider credit excluded", money(result.summary.providerCreditExcludedMinor)],["Historical ≠ posted", result.summary.historicalPostedDifferences]].map(([label,value]) => <article className={box} key={String(label)}><p className="text-xs text-slate-400">{label}</p><strong>{value}</strong></article>)}</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5" aria-label="Reconciliation control queues">{result.controls.map(control => <a aria-current={activeControl?.key === control.key ? "page" : undefined} aria-label={`${control.label}: ${control.count} records`} className={`${box} group min-w-0 cursor-pointer text-left transition hover:border-emerald-400/60 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 aria-[current=page]:border-emerald-400 aria-[current=page]:ring-1 aria-[current=page]:ring-emerald-400`} href={controlHref(control)} key={control.key}><span className="text-xs text-slate-300 group-hover:text-white">{control.label}</span><strong className="block text-lg">{control.count} <span className="text-xs font-normal text-slate-400">records</span></strong>{control.amounts.map(item => <span className="block break-words text-xs" key={item.amountBasis}>{money(item.amountMinor)} {item.amountLabel}</span>)}<span aria-hidden="true" className="mt-2 block text-xs text-emerald-300">Open queue →</span></a>)}</div>
      {activeControl && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-400/40 bg-emerald-950/20 p-3" role="status"><p><strong>Active queue:</strong> {activeControl.label} · {result.total} matching reconciliation rows</p><a className="text-sm text-emerald-300 underline" href="/accounting?view=statements&archive=reconciliation">Clear queue filter</a></div>}
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); go(Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>); }}>
        <select className={input} name="company" defaultValue={params.get("company") ?? ""}><option value="">All companies</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select><input className={input} name="pid" placeholder="PID" defaultValue={params.get("pid") ?? ""}/><input aria-label="Purchase or statement date" className={input} name="date" type="date" defaultValue={params.get("date") ?? ""}/><input className={input} name="truck" placeholder="Truck" defaultValue={params.get("truck") ?? ""}/><input className={input} name="recipient" placeholder="Recipient" defaultValue={params.get("recipient") ?? ""}/><select className={input} name="responsibility" defaultValue={params.get("responsibility") ?? ""}><option value="">All responsibility</option><option value="COMPANY">Company</option><option value="RECIPIENT">Recipient</option><option value="DRIVER">Driver evidence</option><option value="CONTRACTOR">Contractor evidence</option></select><select className={input} name="status" defaultValue={params.get("status") ?? ""}><option value="">All statuses</option>{statuses.map(status => <option key={status}>{status}</option>)}</select><select className={input} name="policy" defaultValue={params.get("policy") ?? ""}><option value="">All policy states</option><option value="known">Known policy</option><option value="missing">Needs policy</option></select><button className="btn">Apply filters</button>
      </form>
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr>{["Company","PID / period","Truck","Owner / Contractor","Pilot actual","Expected","Statement deducted","Difference","Status"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr className="border-t border-white/10 align-top" key={row.key}><td className="p-2">{row.companyName ?? "—"}</td><td className="p-2">{row.pid ?? "—"}<small className="block">{row.statementPeriod ?? row.purchaseDate ?? "—"}</small></td><td className="p-2">{row.truckUnit ?? "Needs mapping"}</td><td className="p-2">{row.recipientName ?? row.recipientId ?? "Needs mapping"}<small className="block">{row.responsibility ?? "—"}</small></td><td className="p-2">{money(row.pilotActualMinor)}</td><td className="p-2">{money(row.expectedMinor)}</td><td className="p-2">{money(row.statementMinor)}</td><td className="p-2">{money(row.differenceMinor)}</td><td className="p-2"><strong>{row.status.replaceAll("_", " ")}</strong>{row.status === "MATCHED" && row.differenceMinor !== null && row.differenceMinor !== "0" && <small className="block text-emerald-300">Within OWNER-approved $0.05 monetary tolerance</small>}<details className="mt-2 max-w-sm"><summary className="cursor-pointer text-emerald-300">Evidence and calculation</summary><div className="space-y-2 py-2 text-xs"><h4 className="font-semibold">SUMMARY</h4><p>Pilot {money(row.pilotActualMinor)} · Expected {money(row.expectedMinor)} · Statement {money(row.statementMinor)} · Exact difference {money(row.differenceMinor)}</p><h4 className="font-semibold">PILOT EVIDENCE</h4><p>{row.purchaseDate ?? "—"} · {row.products.join(", ") || "—"} · {row.gallons} gallons · retail {money(row.pilotRetailMinor)} · savings {money(row.pilotSavingsMinor)} · invoice {row.pilotInvoiceNumber ?? "—"}</p><p>Historical Company {row.companyName ?? "unresolved"} · Posted Company {row.postedCompanyName ?? "—"}{row.historyDiffersFromPosted ? " · REVIEW DIFFERENCE" : ""} · Current Company {row.currentCompanyName ?? "—"}</p><h4 className="font-semibold">STATEMENT EVIDENCE</h4>{row.statementEvidence ? <><p>PID {row.statementEvidence.pid} · statement {row.statementEvidence.statementNumber ?? "—"} · {row.statementEvidence.description ?? "Fuel deduction"} · <a className="text-emerald-300" href={`/api/finance/archive?download=${row.statementEvidence.versionId}`}>Source PDF</a></p><p>Deducted statement: Truck {row.statementTruckUnit ?? "unresolved"} · {row.statementRecipientName ?? row.statementRecipientId ?? "unresolved recipient"}</p></> : <p>No matched statement deduction.</p>}{row.canonicalIdentityLink && <section aria-label="Canonical identity link" className="space-y-1 rounded border border-emerald-400/30 p-2"><h4 className="font-semibold">CANONICAL IDENTITY LINK</h4><p>Canonical identity link; source evidence unchanged.</p><p><strong>Provider Truck:</strong> {row.canonicalIdentityLink.providerTruckId} · unit {row.canonicalIdentityLink.sourceUnit ?? "—"} · VIN {row.canonicalIdentityLink.sourceVin ?? "—"} · {row.canonicalIdentityLink.sourceCompanyName}</p><p><strong>Canonical Truck:</strong> {row.canonicalIdentityLink.canonicalTruckId} · unit {row.canonicalIdentityLink.canonicalUnit} · VIN {row.canonicalIdentityLink.canonicalVin ?? "—"} · {row.canonicalIdentityLink.canonicalCompanyName ?? "outside authorized Company scope"}</p><p><strong>Provenance:</strong> {row.canonicalIdentityLink.linkId} · {row.canonicalIdentityLink.actor} · {new Date(row.canonicalIdentityLink.createdAt).toLocaleString()} · {row.canonicalIdentityLink.reason}</p><p>{row.canonicalIdentityLink.sourceReference} · {row.canonicalIdentityLink.evidenceReferenceCount} evidence references</p></section>}<h4 className="font-semibold">PRODUCT CLASSIFICATION</h4><p>Pilot: {row.products.join(", ") || "—"} · QuickManage: {row.statementProducts.join(", ") || "—"} · {row.productClassification === "DIESEL_REEFER_DIFFERENCE" ? "Different / informational" : row.productClassification ?? "—"}</p><h4 className="font-semibold">POLICY</h4><p>{row.policyLabel ?? "No applicable policy"} · retained discount {money(row.retainedDiscountMinor)}</p><h4 className="font-semibold">TIMING / IDENTITY</h4><p>{matchExplanations[row.matchMethod ?? ""] ?? row.matchMethod ?? "No defensible match"}</p><p>Purchase {row.purchaseDate ?? "—"} · deduction {row.statementPeriod ?? "—"} · Pilot Truck {row.truckUnit ?? "unresolved"}</p></div></details></td></tr>)}</tbody></table></div>
      {!result.rows.length && <p>No reconciliation rows match these filters.</p>}<div className="flex gap-3"><button disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>Previous</button><span>Page {page} · {result.total} rows</span><button disabled={page * result.pageSize >= result.total} onClick={() => go({ page: String(page + 1) })}>Next</button></div>
    </>}
  </div>;
}
