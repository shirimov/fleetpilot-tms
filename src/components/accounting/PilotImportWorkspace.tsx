'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { formatMinorUnitsDecimal } from '@/lib/finance/money';

type Row = Record<string, unknown>;
type Props = { sources: Row[]; categories: Row[]; trucks: Row[] };
const field = 'rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm';
const card = 'rounded-xl border border-white/10 bg-slate-900/70 p-4';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Pilot import request failed.');
  return body as T;
}
const money = (value: unknown) => `$${formatMinorUnitsDecimal(BigInt(String(value ?? 0)))}`;

export default function PilotImportWorkspace({ sources, categories, trucks }: Props) {
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [invoice, setInvoice] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issueFilter, setIssueFilter] = useState('OPEN');
  const [productMappings, setProductMappings] = useState<Row[]>([]);
  const fuelSources = sources.filter((source) => source.type === 'FUEL_CARD' && source.isActive);
  const activeCategories = categories.filter((category) => category.isActive);
  const directExpenseCategories = activeCategories.filter((category) => category.type === 'DIRECT_EXPENSE');

  const refreshMappings = useCallback(async () => {
    setProductMappings(await request<Row[]>('/api/finance/pilot-product-mappings'));
  }, []);

  const refresh = useCallback(async (selectedId?: string) => {
    const rows = await request<Row[]>('/api/finance/imports/pilot');
    setInvoices(rows);
    const id = selectedId ?? String(invoice?.id ?? '');
    if (id) setInvoice(await request<Row>(`/api/finance/imports/pilot/${id}`));
  }, [invoice?.id]);
  useEffect(() => {
    Promise.all([refresh(), refreshMappings()]).catch((caught) => setError(caught.message));
  }, [refresh, refreshMappings]);

  async function saveProductMapping(productCode: string, categoryId: string) {
    if (!categoryId) return;
    setBusy(true); setError('');
    try {
      await request('/api/finance/pilot-product-mappings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productCode, categoryId }) });
      await refreshMappings();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Pilot product mapping failed.'); }
    finally { setBusy(false); }
  }

  async function applyProductMappings() {
    if (!invoice || !window.confirm(`Apply current Pilot product mappings to unposted invoice ${String(invoice.invoiceNumber)}? Existing manual category decisions are preserved and this does not post the invoice.`)) return;
    setBusy(true); setError('');
    try { setInvoice(await request<Row>(`/api/finance/imports/pilot/${String(invoice.id)}/apply-product-mappings`, { method: 'POST' })); await refresh(String(invoice.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Applying product mappings failed.'); }
    finally { setBusy(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget;
    try {
      const created = await request<Row>('/api/finance/imports/pilot', { method: 'POST', body: new FormData(form) });
      form.reset(); await refresh(String(created.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Pilot import failed.'); }
    finally { setBusy(false); }
  }
  async function post() {
    if (!invoice || !window.confirm(`Post Pilot invoice ${String(invoice.invoiceNumber)}? This creates reconciled economic transactions and cannot be edited through import review afterward.`)) return;
    setBusy(true); setError('');
    try { setInvoice(await request<Row>(`/api/finance/imports/pilot/${String(invoice.id)}/post`, { method: 'POST' })); await refresh(String(invoice.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Posting failed.'); }
    finally { setBusy(false); }
  }
  async function reparse() {
    if (!invoice || !window.confirm(`Reparse Pilot invoice ${String(invoice.invoiceNumber)} from its immutable stored XLS? This replaces only the unposted review preview, retains audit provenance, and does not post the invoice.`)) return;
    setBusy(true); setError('');
    try { setInvoice(await request<Row>(`/api/finance/imports/pilot/${String(invoice.id)}/reparse`, { method: 'POST' })); await refresh(String(invoice.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Reparse failed.'); }
    finally { setBusy(false); }
  }
  async function rematchTrucks() {
    if (!invoice) return;
    setBusy(true); setError('');
    try { setInvoice(await request<Row>(`/api/finance/imports/pilot/${String(invoice.id)}/rematch`, { method: 'POST' })); await refresh(String(invoice.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Truck rematching failed.'); }
    finally { setBusy(false); }
  }
  async function resolve(issue: Row, action: string, reference?: string) {
    if (!invoice) return;
    const body = action === 'MATCH_TRUCK' ? { action, truckId: reference } : action === 'SET_CATEGORY' ? { action, categoryId: reference } : { action };
    setBusy(true); setError('');
    try { await request(`/api/finance/imports/pilot/${String(invoice.id)}/issues/${String(issue.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await refresh(String(invoice.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Resolution failed.'); }
    finally { setBusy(false); }
  }

  const events = (invoice?.events as Row[] | undefined) ?? [];
  const adjustments = (invoice?.adjustments as Row[] | undefined) ?? [];
  const issues = (invoice?.issues as Row[] | undefined) ?? [];
  const shownIssues = issues.filter((issue) => issueFilter === 'ALL' || issue.status === issueFilter);
  const openIssues = issues.filter((issue) => issue.status === 'OPEN').length;

  return <div className="space-y-4">
    {error && <p role="alert" className="rounded-lg bg-red-950/60 p-3 text-red-200">{error}</p>}
    <section className={card}>
      <div className="mb-3"><p className="text-xs uppercase text-emerald-400">Reusable accounting rules</p><h2 className="font-semibold">Pilot Product Mappings</h2><p className="text-xs text-slate-400">Map each known Pilot product code to one active Direct Expense category for this operating group. Future imports apply the rule automatically.</p></div>
      <div className="grid gap-3 lg:grid-cols-3">{productMappings.map((product) => {
        const mapping = product.mapping as Row | null;
        const mappedCategory = mapping?.category as Row | undefined;
        return <label key={String(product.productCode)} className="grid gap-1 rounded-lg bg-slate-950/60 p-3 text-sm"><span><strong>{String(product.productCode)}</strong> · {String(product.label)}</span><span className={mapping ? 'text-xs text-emerald-300' : 'text-xs text-amber-200'}>{mapping ? `Mapped to ${String(mappedCategory?.name ?? '')}` : 'Not mapped'}</span><select aria-label={`Pilot product ${String(product.productCode)} category`} className={field} value={String(mappedCategory?.id ?? '')} disabled={busy} onChange={(event) => saveProductMapping(String(product.productCode), event.target.value)}><option value="">Select Direct Expense category…</option>{directExpenseCategories.map((category) => <option key={String(category.id)} value={String(category.id)}>{String(category.path ?? category.name)}</option>)}</select></label>;
      })}</div>
      {productMappings.length === 0 && <p className="text-sm text-slate-400">Loading Pilot product mappings…</p>}
    </section>
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <form className={`${card} grid gap-3`} onSubmit={upload}>
        <h2 className="font-semibold">Upload Pilot legacy XLS</h2>
        <select aria-label="Pilot fuel-card source" className={field} name="sourceId" required><option value="">Select Pilot fuel-card source</option>{fuelSources.map((source) => <option key={String(source.id)} value={String(source.id)}>{String(source.name)}</option>)}</select>
        <input aria-label="Pilot XLS file" className={field} type="file" name="file" accept=".xls,application/vnd.ms-excel" required />
        <p className="text-xs text-slate-400">Legacy OLE/BIFF .xls only · 5 MB / 5,000-row limit · parsed server-side · no formulas, macros, or external links.</p>
        <button className="btn" disabled={busy || fuelSources.length === 0}>Parse statement</button>
        {fuelSources.length === 0 && <p className="text-xs text-amber-200">Create an active FUEL_CARD source before importing.</p>}
      </form>
      <section className={card}><h2 className="mb-3 font-semibold">Pilot invoices</h2><div className="space-y-2">{invoices.map((row) => <button type="button" key={String(row.id)} onClick={() => refresh(String(row.id)).catch((caught) => setError(caught.message))} className="flex w-full justify-between rounded-lg bg-slate-950/60 p-3 text-left"><span><strong>Invoice {String(row.invoiceNumber)}</strong><small className="block text-slate-400">{String(row.billingDate).slice(0, 10)} · {String(row.status)}</small></span><span>{money(row.invoiceTotalMinor)}</span></button>)}{invoices.length === 0 && <p className="text-sm text-slate-400">No Pilot invoices imported.</p>}</div></section>
    </div>
    {invoice && <>
      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase text-emerald-400">Pilot invoice</p><h2 className="text-xl font-semibold">{String(invoice.invoiceNumber)}</h2><p className="text-xs text-slate-400">Period {String(invoice.periodStart).slice(0, 10)} – {String(invoice.periodEnd).slice(0, 10)} · Due {invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : 'not provided'} · Parser {String(invoice.parseVersion)}</p></div><div className="flex flex-wrap gap-2">{invoice.status !== 'POSTED' && <button className="btn" disabled={busy} onClick={applyProductMappings}>Apply product mappings</button>}{invoice.canRematchTrucks === true && <button className="btn" disabled={busy} onClick={rematchTrucks}>Re-run truck matching</button>}{invoice.canReparse === true && <button className="btn" disabled={busy} onClick={reparse}>Reparse invoice</button>}<button className="btn" disabled={busy || invoice.status !== 'READY_TO_POST'} onClick={post}>Post reconciled invoice</button></div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4"><Metric label="Invoice total" value={money(invoice.invoiceTotalMinor)} /><Metric label="Parsed total" value={money(invoice.parsedTotalMinor)} /><Metric label="Difference" value={money(invoice.differenceMinor)} warn={String(invoice.differenceMinor) !== '0'} /><Metric label="Open issues" value={String(openIssues)} warn={openIssues > 0} /></div>
        <p className="mt-3 text-xs text-slate-400">Reparse reads the immutable stored XLS, replaces only an eligible unposted review preview, and retains before/after audit provenance. It never posts automatically. Posting creates one economic transaction per fueling event plus explicit adjustment transactions.</p>
      </section>
      <section className={card}><div className="mb-3 flex justify-between"><h3 className="font-semibold">Review issues</h3><select aria-label="Issue status filter" className={field} value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}><option>OPEN</option><option>RESOLVED</option><option>ALL</option></select></div><div className="space-y-2">{shownIssues.map((issue) => <Issue key={String(issue.id)} issue={issue} busy={busy} trucks={trucks} categories={activeCategories} resolve={resolve} />)}{shownIssues.length === 0 && <p className="text-sm text-emerald-300">No issues in this view.</p>}</div></section>
      <section className={card}><h3 className="mb-3 font-semibold">Fueling events and product lines</h3><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-slate-400"><tr><th className="p-2">Date</th><th>Unit / truck</th><th>Location</th><th>Product</th><th>Quantity</th><th>Category</th><th className="text-right">Amount</th></tr></thead><tbody>{events.flatMap((event) => ((event.productLines as Row[]) ?? []).map((line) => { const truck = event.truck as Row | undefined; return <tr key={String(line.id)} className="border-t border-white/10"><td className="p-2">{String(event.transactionDate).slice(0, 10)}</td><td>{String(event.sourceUnitNumber)} · {truck ? `${String(truck.unitNumber)} — ${String((truck.company as Row)?.name ?? '')}` : String(event.truckMatchStatus)}</td><td>{String(event.city ?? '')}, {String(event.state ?? '')}</td><td>{String(line.sourceProductCode)} · {String(line.productType).replaceAll('_', ' ')}</td><td>{String(line.quantity)}</td><td>{String((line.category as Row)?.name ?? 'Needs review')}</td><td className="text-right">{money(line.amountMinor)}</td></tr>; }))}</tbody></table></div></section>
      {adjustments.length > 0 && <section className={card}><h3 className="mb-3 font-semibold">Invoice adjustments</h3>{adjustments.map((row) => <div key={String(row.id)} className="flex justify-between border-t border-white/10 py-2 text-sm"><span>{String(row.description)} · {String(row.type)} · {String((row.category as Row)?.name ?? 'Needs review')}</span><strong>{money(row.signedAmountMinor)}</strong></div>)}</section>}
    </>}
  </div>;
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) { return <div className="rounded-lg bg-slate-950/60 p-3"><p className="text-xs text-slate-400">{label}</p><strong className={warn ? 'text-amber-300' : ''}>{value}</strong></div>; }

function Issue({ issue, busy, trucks, categories, resolve }: { issue: Row; busy: boolean; trucks: Row[]; categories: Row[]; resolve: (issue: Row, action: string, reference?: string) => Promise<void> }) {
  const [truckSearch, setTruckSearch] = useState('');
  const truckIssue = ['UNMATCHED_TRUCK', 'AMBIGUOUS_TRUCK'].includes(String(issue.code));
  const categoryIssue = ['MISSING_CATEGORY', 'UNKNOWN_PRODUCT', 'UNKNOWN_ADJUSTMENT'].includes(String(issue.code));
  const shownTrucks = trucks.filter((truck) => `${String(truck.unitNumber)} ${String((truck.company as Row)?.name ?? '')}`.toLowerCase().includes(truckSearch.trim().toLowerCase()));
  return <div className="rounded-lg bg-slate-950/60 p-3"><div className="flex justify-between gap-3"><div><strong className={issue.status === 'OPEN' ? 'text-amber-200' : 'text-emerald-300'}>{String(issue.code).replaceAll('_', ' ')}</strong><p className="text-xs text-slate-400">{String(issue.message)}</p></div><span className="text-xs">{String(issue.status)}</span></div>{issue.status === 'OPEN' && <div className="mt-2">{truckIssue && <div className="grid gap-2 sm:grid-cols-2"><input aria-label={`Search trucks for ${String(issue.code)}`} className={field} value={truckSearch} onChange={(event) => setTruckSearch(event.target.value)} placeholder="Search unit or company" /><select aria-label={`Resolve ${String(issue.code)}`} className={field} defaultValue="" disabled={busy} onChange={(event) => event.target.value && resolve(issue, 'MATCH_TRUCK', event.target.value)}><option value="">Match exact truck…</option>{shownTrucks.map((truck) => <option key={String(truck.id)} value={String(truck.id)}>Truck {String(truck.unitNumber)} — {String((truck.company as Row)?.name ?? '')}</option>)}</select></div>}{categoryIssue && <select aria-label={`Resolve ${String(issue.code)}`} className={field} defaultValue="" disabled={busy} onChange={(event) => event.target.value && resolve(issue, 'SET_CATEGORY', event.target.value)}><option value="">Assign accounting category…</option>{categories.map((category) => <option key={String(category.id)} value={String(category.id)}>{String(category.path ?? category.name)}</option>)}</select>}{issue.code === 'OUTSIDE_PERIOD' && <button className="btn" disabled={busy} onClick={() => resolve(issue, 'ACKNOWLEDGE')}>Acknowledge reviewed date</button>}</div>}</div>;
}
