'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type Tab = 'overview' | 'audit' | 'statements' | 'transactions' | 'sources' | 'categories';
type Row = Record<string, unknown>;
type Overview = { inflowMinor: string; outflowMinor: string; reconciledMinor: string; unresolvedMinor: string; reconciliationBasisPoints: number | null; unresolvedTransactionCount: number; statementsImported: number; exceptions: Record<string, number> };
const tabs: Array<[Tab, string]> = [['overview', 'Overview'], ['audit', 'Audit Center'], ['statements', 'Statements'], ['transactions', 'Transactions'], ['sources', 'Sources'], ['categories', 'Categories']];
const input = 'rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm';
const panel = 'rounded-xl border border-white/10 bg-slate-900/70 p-4';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body as T;
}
function dollars(minor: unknown) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(BigInt(String(minor ?? 0))) / 100); }

export default function AccountingWorkspace() {
  const [tab, setTab] = useState<Tab>('overview');
  const [group, setGroup] = useState<Row | null>();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sources, setSources] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [statements, setStatements] = useState<Row[]>([]);
  const [transactions, setTransactions] = useState<Row[]>([]);
  const [records, setRecords] = useState<Row[]>([]);
  const [expectations, setExpectations] = useState<Row[]>([]);
  const [trucks, setTrucks] = useState<Row[]>([]);
  const [exceptionFilter, setExceptionFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await api<{ group: Row | null }>('/api/finance/group');
    setGroup(response.group);
    if (!response.group) return;
    const results = await Promise.all([
      api<Overview>('/api/finance/overview'), api<Row[]>('/api/finance/sources'), api<Row[]>('/api/finance/categories'),
      api<Row[]>('/api/finance/statements'), api<Row[]>('/api/finance/transactions'), api<Row[]>('/api/finance/import-records'),
      api<Row[]>('/api/trucks').catch(() => []), api<Row[]>('/api/finance/expectations'),
    ]);
    setOverview(results[0]); setSources(results[1]); setCategories(results[2]); setStatements(results[3]); setTransactions(results[4]); setRecords(results[5]); setTrucks(results[6]); setExpectations(results[7]);
  }, []);
  useEffect(() => { refresh().catch((caught) => setError(caught.message)); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, url: string, multipart = false) {
    event.preventDefault(); setBusy(true); setError('');
    const formElement = event.currentTarget;
    try {
      const form = new FormData(formElement);
      await api(url, { method: 'POST', body: multipart ? form : JSON.stringify(Object.fromEntries(form)), headers: multipart ? undefined : { 'Content-Type': 'application/json' } });
      formElement.reset(); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Request failed.'); }
    finally { setBusy(false); }
  }

  if (group === undefined) return <div className="p-6">Loading Financial Control…</div>;
  if (!group) return <div className="mx-auto max-w-xl p-6"><form className={`${panel} space-y-4`} onSubmit={(event) => submit(event, '/api/finance/group')}><h1 className="text-2xl font-semibold">Financial Control &amp; Reconciliation</h1><p className="text-sm text-slate-400">Create an operating group while preserving each record’s legal company.</p><input className={`${input} w-full`} name="name" required placeholder="Marybeg Group" /><button disabled={busy} className="btn">Create operating group</button>{error && <p role="alert" className="text-red-300">{error}</p>}</form></div>;

  return <main className="space-y-5 p-4 md:p-6">
    <header><p className="text-xs uppercase tracking-[.2em] text-emerald-400">{String(group.name)}</p><h1 className="text-2xl font-semibold">Financial Control &amp; Reconciliation</h1><p className="text-sm text-slate-400">Auditable evidence and exceptions. Not tax accounting or final P&amp;L.</p></header>
    <nav aria-label="Accounting sections" className="flex gap-2 overflow-x-auto">{tabs.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${tab === key ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800'}`}>{label}</button>)}</nav>
    {error && <p role="alert" className="rounded-lg bg-red-950/60 p-3 text-red-200">{error}</p>}
    {tab === 'overview' && overview && <OverviewView overview={overview} />}
    {tab === 'audit' && overview && <AuditView overview={overview} expectations={expectations} busy={busy} submit={submit} onDrill={(filter) => { if (filter !== 'missingExpected') { setExceptionFilter(filter); setTab('transactions'); } }} />}
    {tab === 'sources' && <SourceView rows={sources} busy={busy} submit={submit} />}
    {tab === 'categories' && <CategoryView rows={categories} busy={busy} submit={submit} />}
    {tab === 'statements' && <StatementView rows={statements} sources={sources} busy={busy} submit={submit} />}
    {tab === 'transactions' && <TransactionView rows={transactions} records={records} categories={categories} sources={sources} trucks={trucks} busy={busy} submit={submit} refresh={refresh} setError={setError} exceptionFilter={exceptionFilter} />}
  </main>;
}

function OverviewView({ overview }: { overview: Overview }) {
  const cards = [['Imported inflows', dollars(overview.inflowMinor)], ['Imported outflows', dollars(overview.outflowMinor)], ['Reconciled', dollars(overview.reconciledMinor)], ['Unresolved', dollars(overview.unresolvedMinor)], ['Coverage', overview.reconciliationBasisPoints === null ? 'No verified data' : `${(overview.reconciliationBasisPoints / 100).toFixed(2)}%`], ['Statements', overview.statementsImported]];
  return <section><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <article className={panel} key={label}><p className="text-xs uppercase text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></article>)}</div><p className="mt-4 text-sm text-amber-200">{overview.unresolvedTransactionCount} unresolved transactions. These figures are not profit.</p></section>;
}
function AuditView({ overview, expectations, busy, submit, onDrill }: { overview: Overview; expectations: Row[]; busy: boolean; submit: AccountingWorkspaceSubmit; onDrill: (filter: string) => void }) {
  const labels: Record<string, string> = { unmatchedInflows: 'Unmatched inflows', unmatchedOutflows: 'Unmatched outflows', missingExpected: 'Expected money missing', partialMatches: 'Partially matched', possibleDuplicates: 'Possible duplicates', uncategorizedExpenses: 'Uncategorized expenses', missingAssignments: 'Missing operational assignment', ownerRecovery: 'Owner recovery outstanding' };
  return <div className="space-y-4"><section className="grid gap-3 md:grid-cols-2">{Object.entries(labels).map(([key, label]) => <button key={key} onClick={() => onDrill(key)} className={`${panel} text-left hover:border-emerald-500`}><span>{label}</span><strong className="float-right text-xl">{overview.exceptions[key] ?? 0}</strong></button>)}</section><div className="grid gap-4 lg:grid-cols-[1fr_2fr]"><form className={`${panel} grid gap-3`} onSubmit={(event) => submit(event, '/api/finance/expectations')}><h2 className="font-semibold">Add expected money</h2><input className={input} name="description" required placeholder="Expected settlement" /><input className={input} name="amount" required placeholder="Expected amount" /><select className={input} name="direction"><option>INFLOW</option><option>OUTFLOW</option></select><input className={input} type="date" name="expectedDateStart" required /><input className={input} type="date" name="expectedDateEnd" required /><input type="hidden" name="currency" value="USD" /><button disabled={busy} className="btn">Add expectation</button></form><List rows={expectations} title="Expected money" render={(row) => <><strong>{String(row.description)}</strong><p className="text-xs text-slate-400">{dollars(row.expectedAmountMinor)} · {String(row.status)}</p></>} /></div></div>;
}

function SourceView({ rows, busy, submit }: { rows: Row[]; busy: boolean; submit: AccountingWorkspaceSubmit }) {
  return <Split form={<form className="grid gap-3" onSubmit={(event) => submit(event, '/api/finance/sources')}><h2 className="font-semibold">Add source</h2><input className={input} name="name" required placeholder="Bank of America Operating" /><select className={input} name="type">{['BANK_ACCOUNT','CREDIT_CARD','FUEL_CARD','TOLL_ACCOUNT','TMS_SETTLEMENT','CUSTOMER_SETTLEMENT','OWNER_SETTLEMENT','CASH','OTHER'].map((value) => <option key={value}>{value}</option>)}</select><input className={input} name="institution" placeholder="Institution / provider" /><input className={input} name="lastFour" maxLength={4} placeholder="Last four" /><input type="hidden" name="currency" value="USD" /><button disabled={busy} className="btn">Add source</button></form>} list={<List rows={rows} title="Sources" render={(row) => <><strong>{String(row.name)}</strong><p className="text-xs text-slate-400">{String(row.type).replaceAll('_', ' ')} · {String((row._count as Row)?.statements ?? 0)} statements</p></>} />} />;
}
function CategoryView({ rows, busy, submit }: { rows: Row[]; busy: boolean; submit: AccountingWorkspaceSubmit }) {
  return <Split form={<form className="grid gap-3" onSubmit={(event) => submit(event, '/api/finance/categories')}><h2 className="font-semibold">Add category</h2><input className={input} name="name" required placeholder="Operational category" /><select className={input} name="type">{['INCOME','DIRECT_EXPENSE','EQUIPMENT_FINANCING','OVERHEAD','OTHER'].map((value) => <option key={value}>{value}</option>)}</select><button disabled={busy} className="btn">Add category</button></form>} list={<List rows={rows} title="Categories" render={(row) => <><strong>{String(row.name)}</strong><p className="text-xs text-slate-400">{String(row.type).replaceAll('_', ' ')}</p></>} />} />;
}
function StatementView({ rows, sources, busy, submit }: { rows: Row[]; sources: Row[]; busy: boolean; submit: AccountingWorkspaceSubmit }) {
  return <Split form={<form className="grid gap-3" onSubmit={(event) => submit(event, '/api/finance/statements', true)}><h2 className="font-semibold">Upload statement</h2><select className={input} name="sourceId" required><option value="">Select source</option>{sources.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select><select className={input} name="type">{['BANK_STATEMENT','CREDIT_CARD_STATEMENT','FUEL_STATEMENT','TOLL_STATEMENT','TMS_SETTLEMENT','CUSTOMER_SETTLEMENT','OWNER_SETTLEMENT','REPAIR_INVOICE','INSURANCE_STATEMENT','OTHER'].map((value) => <option key={value}>{value}</option>)}</select><input className={input} type="date" name="periodStart" required /><input className={input} type="date" name="periodEnd" required /><input className={input} type="file" name="file" accept=".csv,.xlsx,.pdf" required /><input type="hidden" name="currency" value="USD" /><p className="text-xs text-slate-400">CSV imports now. XLSX/PDF originals are stored privately for later adapters.</p><button disabled={busy || !sources.length} className="btn">Upload</button></form>} list={<List rows={rows} title="Statements" render={(row) => <><div className="flex justify-between"><strong>{String(row.originalFilename)}</strong><a className="text-emerald-400" href={`/api/finance/statements/${String(row.id)}/download`}>Original</a></div><p className="text-xs text-slate-400">{String((row.source as Row)?.name)} · {String(row.importStatus)} · {String(row.unresolvedRowCount)} unresolved</p></>} />} />;
}

type AccountingWorkspaceSubmit = (event: FormEvent<HTMLFormElement>, url: string, multipart?: boolean) => Promise<void>;
function TransactionView({ rows, records, categories, sources, trucks, busy, submit, refresh, setError, exceptionFilter }: { rows: Row[]; records: Row[]; categories: Row[]; sources: Row[]; trucks: Row[]; busy: boolean; submit: AccountingWorkspaceSubmit; refresh: () => Promise<void>; setError: (message: string) => void; exceptionFilter: string }) {
  async function action(event: FormEvent<HTMLFormElement>, url: string, allocations = false) { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const body = allocations ? { allocations: [{ amount: values.amount, categoryId: values.categoryId, truckId: values.truckId || null }] } : values; try { await api(url, { method: allocations ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Request failed.'); } }
  const visible = rows.filter((row) => !exceptionFilter || exceptionFilter === 'unmatchedInflows' && row.direction === 'INFLOW' && ['UNREVIEWED','UNMATCHED','NEEDS_REVIEW'].includes(String(row.reconciliationStatus)) || exceptionFilter === 'unmatchedOutflows' && row.direction === 'OUTFLOW' && ['UNREVIEWED','UNMATCHED','NEEDS_REVIEW'].includes(String(row.reconciliationStatus)) || exceptionFilter === 'partialMatches' && row.reconciliationStatus === 'PARTIALLY_MATCHED' || exceptionFilter === 'possibleDuplicates' && row.reconciliationStatus === 'DUPLICATE_SUSPECTED' || exceptionFilter === 'uncategorizedExpenses' && row.direction === 'OUTFLOW' && !row.category || exceptionFilter === 'missingAssignments' && row.direction === 'OUTFLOW' && row.allocatedMinor === '0' || exceptionFilter === 'ownerRecovery' && row.recoverableFromOwner === true && row.recoveryStatus !== 'RECOVERED');
  return <div className="space-y-4"><form className={`${panel} grid gap-3 md:grid-cols-3`} onSubmit={(event) => submit(event, '/api/finance/transactions')}><h2 className="font-semibold md:col-span-3">Add normalized transaction</h2><input className={input} type="date" name="transactionDate" required /><input className={input} name="description" required placeholder="Description" /><input className={input} name="amount" required placeholder="48320.00" /><select className={input} name="direction"><option>INFLOW</option><option>OUTFLOW</option></select><select className={input} name="sourceId"><option value="">No source</option>{sources.map(option)}</select><select className={input} name="categoryId"><option value="">Uncategorized</option>{categories.map(option)}</select><input type="hidden" name="currency" value="USD" /><button disabled={busy} className="btn md:col-span-3">Add transaction</button></form>{exceptionFilter && <p className="text-sm text-emerald-300">Filtered exception: {exceptionFilter} <button className="underline" onClick={() => location.reload()}>clear</button></p>}{visible.map((row) => <article className={panel} key={String(row.id)}><div className="flex justify-between gap-3"><div><strong>{String(row.description)}</strong><p className="text-xs text-slate-400">{String(row.direction)} · {String(row.reconciliationStatus)} · {String((row.category as Row)?.name ?? 'Uncategorized')}</p></div><strong>{dollars(row.amountMinor)}</strong></div><div className="mt-3 grid gap-2 xl:grid-cols-2"><form className="flex gap-2" onSubmit={(event) => action(event, `/api/finance/transactions/${String(row.id)}/evidence`)}><select className={`${input} min-w-0 flex-1`} name="importRecordId" required><option value="">Match evidence…</option>{records.filter((record) => record.status !== 'MATCHED').map((record) => <option key={String(record.id)} value={String(record.id)}>{String(record.rawDescription)} ({String(record.rawAmount)})</option>)}</select><input className={`${input} w-28`} name="amount" required placeholder="Amount" /><input type="hidden" name="method" value="MANUAL" /><button className="btn">Match</button></form><form className="flex gap-2" onSubmit={(event) => action(event, `/api/finance/transactions/${String(row.id)}/allocations`, true)}><select className={`${input} min-w-0 flex-1`} name="categoryId" required><option value="">Category…</option>{categories.map(option)}</select><select className={input} name="truckId"><option value="">Overhead</option>{trucks.map((truck) => <option key={String(truck.id)} value={String(truck.id)}>Truck {String(truck.unitNumber)}</option>)}</select><input type="hidden" name="amount" value={(Number(BigInt(String(row.amountMinor))) / 100).toFixed(2)} /><button className="btn">Allocate</button></form></div></article>)}</div>;
}
function option(row: Row) { return <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>; }
function Split({ form, list }: { form: React.ReactNode; list: React.ReactNode }) { return <div className="grid gap-4 lg:grid-cols-[1fr_2fr]"><section className={panel}>{form}</section>{list}</div>; }
function List({ rows, title, render }: { rows: Row[]; title: string; render: (row: Row) => React.ReactNode }) { return <section className={panel}><h2 className="mb-3 font-semibold">{title}</h2><div className="space-y-2">{rows.map((row) => <article className="rounded-lg bg-slate-950/60 p-3" key={String(row.id)}>{render(row)}</article>)}{!rows.length && <p className="text-sm text-slate-400">Nothing recorded yet.</p>}</div></section>; }
