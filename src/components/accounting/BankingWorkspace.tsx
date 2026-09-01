'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { BankTransactionPeriod } from '@/lib/finance/bank-transaction-period';
import PlaidLinkButton from './PlaidLinkButton';

type Option = { id: string; name: string };
type EntityOptions = {
  activeCompanyId: string;
  companies: Option[];
  categories: Array<Option & { type: string; parentCategoryId: string | null }>;
  trucks: Array<{ id: string; unitNumber: string }>;
  trailers: Array<{ id: string; unitNumber: string }>;
  drivers: Array<{ id: string; firstName: string; lastName: string }>;
  parties: Array<Option & { type: string }>;
  accounts: Array<Option & { mask: string | null }>;
};
type Connection = {
  id: string;
  provider: string;
  institutionName: string | null;
  status: string;
  lastSync: string | null;
  lastSyncErrorMessage: string | null;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    subtype: string | null;
    mask: string | null;
    currency: string;
    currentBalanceMinor: string | null;
    availableBalanceMinor: string | null;
    isActive: boolean;
    lastSyncedAt: string | null;
  }>;
  _count: { transactions: number };
};
type Allocation = {
  id: string;
  amountMinor: string;
  category: Option;
  truck: { id: string; unitNumber: string } | null;
  trailer: { id: string; unitNumber: string } | null;
  driver: { id: string; firstName: string; lastName: string } | null;
  party: Option | null;
};
type BankTransaction = {
  id: string;
  date: string;
  authorizedDate: string | null;
  postedDate: string | null;
  amountMinor: string | null;
  currency: string;
  direction: 'INFLOW' | 'OUTFLOW' | 'TRANSFER' | null;
  originalDescription: string | null;
  merchantName: string | null;
  providerCategory: unknown;
  lifecycle: string;
  checkNumber: string | null;
  referenceNumber: string | null;
  bankAccount: { institutionName: string | null; provider: string };
  subAccount: { name: string; mask: string | null; type: string; subtype: string | null } | null;
  classification: {
    categoryId: string | null;
    scope: 'COMPANY_LEVEL' | 'ENTITY_ALLOCATED';
    reviewStatus: string;
    reconciliationStatus: string;
    notes: string | null;
    category: Option | null;
  } | null;
  allocations: Allocation[];
};
type AllocationDraft = {
  amount: string;
  categoryId: string;
  truckId: string;
  trailerId: string;
  driverId: string;
  partyId: string;
};

const panel = 'rounded-xl border border-slate-800 bg-slate-900/70 p-4';
const input = 'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';
const emptyAllocation = (): AllocationDraft => ({
  amount: '', categoryId: '', truckId: '', trailerId: '', driverId: '', partyId: '',
});

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body as T;
}

function money(value: string | null, currency = 'USD') {
  if (value === null) return 'Unavailable';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value) / 100);
}

function timestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function balanceMayBeStale(value: string | null) {
  if (!value) return true;
  return Date.now() - new Date(value).getTime() > 24 * 60 * 60 * 1000;
}

export default function BankingWorkspace() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view') === 'accounts' ? 'accounts' : 'transactions';
  const [options, setOptions] = useState<EntityOptions | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [providerEnvironment, setProviderEnvironment] = useState('unconfigured');
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('');
  const [reviewStatus, setReviewStatus] = useState('UNREVIEWED');
  const [subAccountId, setSubAccountId] = useState('');
  const [period, setPeriod] = useState<BankTransactionPeriod>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [minimumAmount, setMinimumAmount] = useState('');
  const [maximumAmount, setMaximumAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const loadOptions = useCallback(async (targetCompanyId?: string) => {
    const suffix = targetCompanyId ? `?companyId=${encodeURIComponent(targetCompanyId)}` : '';
    const next = await api<EntityOptions>(`/api/finance/bank/options${suffix}`);
    setOptions(next);
    setCompanyId(targetCompanyId ?? next.activeCompanyId);
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    const params = new URLSearchParams({ companyId });
    if (query) params.set('q', query);
    if (direction) params.set('direction', direction);
    if (reviewStatus) params.set('reviewStatus', reviewStatus);
    if (subAccountId) params.set('subAccountId', subAccountId);
    const effectivePeriod = period === 'custom' && !appliedCustomRange ? 'all' : period;
    params.set('period', effectivePeriod);
    if (period === 'custom' && appliedCustomRange) {
      params.set('from', appliedCustomRange.from);
      params.set('to', appliedCustomRange.to);
    }
    if (minimumAmount) params.set('minimumAmount', minimumAmount);
    if (maximumAmount) params.set('maximumAmount', maximumAmount);
    const [nextConnections, nextTransactions, status] = await Promise.all([
      api<Connection[]>(`/api/finance/bank/connections?companyId=${encodeURIComponent(companyId)}`),
      api<BankTransaction[]>(`/api/finance/bank/transactions?${params}`),
      api<{ liveProviderAvailable: boolean; environment: string; webhookConfigured: boolean }>('/api/finance/bank/status'),
    ]);
    setConnections(nextConnections);
    setTransactions(nextTransactions);
    setProviderAvailable(status.liveProviderAvailable);
    setProviderEnvironment(status.environment);
    setWebhookConfigured(status.webhookConfigured);
  }, [appliedCustomRange, companyId, direction, maximumAmount, minimumAmount, period, query, reviewStatus, subAccountId]);

  useEffect(() => {
    loadOptions().catch((caught: Error) => setError(caught.message));
  }, [loadOptions]);
  useEffect(() => {
    load().catch((caught: Error) => setError(caught.message));
  }, [load]);

  async function changeCompany(nextCompanyId: string) {
    setCompanyId(nextCompanyId);
    await loadOptions(nextCompanyId);
  }

  async function sync(connectionId: string) {
    setBusy(connectionId);
    setError('');
    try {
      const result = await api<{ balance?: { status: string; message?: string } }>(
        `/api/finance/bank/connections/${connectionId}/sync`,
        { method: 'POST' },
      );
      await load();
      if (result.balance?.status === 'failed') {
        setError(result.balance.message ?? 'Transactions updated, but the balance refresh failed.');
      }
    } catch (caught) {
      await load().catch(() => undefined);
      setError(caught instanceof Error ? caught.message : 'Synchronization failed.');
    } finally {
      setBusy('');
    }
  }

  function applyCustomPeriod() {
    setError('');
    if (!customFrom || !customTo) {
      setError('Choose both a start date and an end date.');
      return;
    }
    if (customFrom > customTo) {
      setError('Start date cannot be after end date.');
      return;
    }
    setAppliedCustomRange({ from: customFrom, to: customTo });
  }

  function resetPeriod() {
    setPeriod('all');
    setCustomFrom('');
    setCustomTo('');
    setAppliedCustomRange(null);
    setError('');
  }

  const totalTransactions = useMemo(
    () => connections.reduce((sum, connection) => sum + connection._count.transactions, 0),
    [connections],
  );

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Accounting</p>
          <h1 className="mt-1 text-2xl font-bold">Bank transaction ledger</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Read-only bank source data stays separate from FleetPilot classification and future accounting posting.
          </p>
        </div>
        <label className="text-xs text-slate-400">
          Company
          <select aria-label="Bank ledger company" className={`mt-1 block ${input}`} value={companyId} onChange={(event) => void changeCompany(event.target.value)}>
            {options?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </label>
      </header>
      {error ? <p role="alert" className="mb-4 rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{error}</p> : null}
      <nav className="mb-5 flex gap-2" aria-label="Bank ledger views">
        <a className={view === 'accounts' ? 'btn' : 'rounded-lg px-3 py-2 text-sm text-slate-300'} href="/accounting/banking?view=accounts">Bank Accounts</a>
        <a className={view === 'transactions' ? 'btn' : 'rounded-lg px-3 py-2 text-sm text-slate-300'} href="/accounting/banking?view=transactions">Transactions</a>
      </nav>

      {view === 'accounts' ? (
        <section className="space-y-4">
          {!providerAvailable ? (
            <div className={`${panel} border-amber-800`}>
              <h2 className="font-semibold text-amber-200">Bank provider not connected</h2>
              <p className="mt-2 text-sm text-slate-300">Configure an approved provider and encrypted token key before connecting or synchronizing live accounts.</p>
              <button disabled className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-500">Sync Transactions Now</button>
            </div>
          ) : null}
          {providerAvailable ? (
            <div className={`${panel} flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <h2 className="font-semibold">Plaid read-only connection</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Environment: {providerEnvironment}. Provider balances and transactions remain independent. {webhookConfigured ? 'Webhook configured.' : 'Webhook not configured; use manual refresh.'}
                </p>
              </div>
              <PlaidLinkButton disabled={!companyId} onComplete={load} onError={setError} />
            </div>
          ) : null}
          <p className="text-sm text-slate-400">{connections.length} connections · {totalTransactions} source transactions</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {connections.map((connection) => (
              <article className={panel} key={connection.id}>
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="font-semibold">{connection.institutionName ?? 'Unknown institution'}</h2><p className="text-xs text-slate-400">{connection.provider} · {connection.status}</p></div>
                  <button className="btn" disabled={!providerAvailable || busy === connection.id} onClick={() => void sync(connection.id)}>{busy === connection.id ? 'Refreshing…' : 'Refresh'}</button>
                </div>
                {connection.status === 'REQUIRES_REAUTH' ? <div className="mt-3"><PlaidLinkButton connectionId={connection.id} onComplete={load} onError={setError} /></div> : null}
                <p className="mt-2 text-xs text-slate-400">Transactions updated: {timestamp(connection.lastSync)}</p>
                {connection.lastSyncErrorMessage ? <p className="mt-2 text-xs text-red-300">{connection.lastSyncErrorMessage}</p> : null}
                <div className="mt-4 space-y-2">{connection.accounts.map((account) => <div className="rounded-lg bg-slate-950/70 p-3" key={account.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><span>{account.name} {account.mask ? `••${account.mask}` : ''}</span><div className="text-right"><p className="text-xs text-slate-400">Current balance</p><strong>{money(account.currentBalanceMinor, account.currency)}</strong>{account.availableBalanceMinor !== null ? <p className="mt-1 text-xs text-slate-300">Available: {money(account.availableBalanceMinor, account.currency)}</p> : null}</div></div>
                  <p className="mt-2 text-xs text-slate-500">{account.type}{account.subtype ? ` · ${account.subtype}` : ''} · {account.isActive ? 'Active' : 'Inactive'}</p>
                  <p className="mt-1 text-xs text-slate-500">Balance updated: {timestamp(account.lastSyncedAt)}</p>
                  {balanceMayBeStale(account.lastSyncedAt) ? <p className="mt-1 text-xs font-medium text-amber-300">Balance may be stale</p> : null}
                </div>)}</div>
              </article>
            ))}
          </div>
          {!connections.length ? <p className={`${panel} text-sm text-slate-400`}>No bank connections exist for this company.</p> : null}
        </section>
      ) : (
        <section className="space-y-4">
          <div className={`${panel} grid gap-3 md:grid-cols-4 lg:grid-cols-7`}>
            <input aria-label="Search bank transactions" className={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Merchant, description, reference" />
            <select aria-label="Money direction" className={input} value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">Money in and out</option><option value="INFLOW">Money in</option><option value="OUTFLOW">Money out</option><option value="TRANSFER">Transfer</option></select>
            <select aria-label="Review status" className={input} value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}><option value="">All review states</option>{['UNREVIEWED','SUGGESTED','REVIEWED','NEEDS_REVIEW','IGNORED'].map((status) => <option key={status}>{status}</option>)}</select>
            <select aria-label="Bank account" className={input} value={subAccountId} onChange={(event) => setSubAccountId(event.target.value)}><option value="">All bank accounts</option>{options?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.mask ? ` ••${account.mask}` : ''}</option>)}</select>
            <select aria-label="Transaction period" className={input} value={period} onChange={(event) => {
              const nextPeriod = event.target.value as BankTransactionPeriod;
              setPeriod(nextPeriod);
              if (nextPeriod !== 'custom') setAppliedCustomRange(null);
            }}>
              <option value="all">All time</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom</option>
            </select>
            <input aria-label="Minimum transaction amount" className={input} inputMode="decimal" value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value)} placeholder="Minimum amount" />
            <input aria-label="Maximum transaction amount" className={input} inputMode="decimal" value={maximumAmount} onChange={(event) => setMaximumAmount(event.target.value)} placeholder="Maximum amount" />
          </div>
          {period === 'custom' ? (
            <div className={`${panel} flex flex-wrap items-end gap-3`}>
              <label className="text-xs text-slate-400">From<input aria-label="Custom transaction start date" className={`mt-1 block ${input}`} type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
              <label className="text-xs text-slate-400">To<input aria-label="Custom transaction end date" className={`mt-1 block ${input}`} type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
              <button className="btn" type="button" onClick={applyCustomPeriod}>Apply</button>
              <button className="rounded-lg px-3 py-2 text-sm text-slate-300" type="button" onClick={resetPeriod}>Reset period</button>
            </div>
          ) : null}
          {transactions.map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} options={options} refresh={load} setError={setError} />)}
          {!transactions.length ? <p className={`${panel} text-sm text-slate-400`}>No transactions match this inbox view. No sample transactions are fabricated.</p> : null}
        </section>
      )}
    </main>
  );
}

function TransactionCard({ transaction, options, refresh, setError }: { transaction: BankTransaction; options: EntityOptions | null; refresh: () => Promise<void>; setError: (value: string) => void }) {
  const [scope, setScope] = useState<'COMPANY_LEVEL' | 'ENTITY_ALLOCATED'>(transaction.classification?.scope ?? 'COMPANY_LEVEL');
  const [categoryId, setCategoryId] = useState(transaction.classification?.categoryId ?? '');
  const [reviewStatus, setReviewStatus] = useState(transaction.classification?.reviewStatus ?? 'UNREVIEWED');
  const [allocations, setAllocations] = useState<AllocationDraft[]>(transaction.allocations.length ? transaction.allocations.map((allocation) => ({ amount: (Number(allocation.amountMinor) / 100).toFixed(2), categoryId: allocation.category.id, truckId: allocation.truck?.id ?? '', trailerId: allocation.trailer?.id ?? '', driverId: allocation.driver?.id ?? '', partyId: allocation.party?.id ?? '' })) : [emptyAllocation()]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api(`/api/finance/bank/transactions/${transaction.id}/classification`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: categoryId || null, scope, reviewStatus, reconciliationStatus: transaction.classification?.reconciliationStatus ?? 'UNMATCHED', allocations: scope === 'ENTITY_ALLOCATED' ? allocations : [], notes: new FormData(event.currentTarget).get('notes') }),
      });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Classification failed.'); }
  }
  function update(index: number, key: keyof AllocationDraft, value: string) { setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)); }
  const directionLabel = transaction.direction === 'INFLOW' ? 'MONEY IN' : transaction.direction === 'OUTFLOW' ? 'MONEY OUT' : transaction.direction === 'TRANSFER' ? 'TRANSFER' : 'NEUTRAL';
  const displayedAmount = `${transaction.direction === 'INFLOW' ? '+' : transaction.direction === 'OUTFLOW' ? '-' : ''}${money(transaction.amountMinor, transaction.currency)}`;
  return <article className={panel}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">{transaction.merchantName ?? transaction.originalDescription ?? 'Unknown merchant'}</h2><p className="text-xs text-slate-400">{transaction.date.slice(0,10)} · {transaction.bankAccount.institutionName ?? transaction.bankAccount.provider} · {transaction.subAccount?.name ?? 'Unknown account'} {transaction.subAccount?.mask ? `••${transaction.subAccount.mask}` : ''}</p></div><strong className={transaction.direction === 'INFLOW' ? 'text-emerald-300' : transaction.direction === 'OUTFLOW' ? 'text-red-200' : 'text-slate-300'}>{displayedAmount} · {directionLabel}</strong></div><details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-blue-300">Review transaction</summary><div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bank data</h3><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm"><dt>Description</dt><dd>{transaction.originalDescription ?? 'Not supplied'}</dd><dt>Merchant</dt><dd>{transaction.merchantName ?? 'Not supplied'}</dd><dt>Lifecycle</dt><dd>{transaction.lifecycle}</dd><dt>Authorized</dt><dd>{transaction.authorizedDate?.slice(0,10) ?? 'Not supplied'}</dd><dt>Posted</dt><dd>{transaction.postedDate?.slice(0,10) ?? 'Not supplied'}</dd><dt>Reference</dt><dd>{transaction.referenceNumber ?? transaction.checkNumber ?? 'Not supplied'}</dd><dt>Provider category</dt><dd>{transaction.providerCategory ? JSON.stringify(transaction.providerCategory) : 'Not supplied'}</dd></dl></section><form className="rounded-lg border border-blue-900/60 bg-blue-950/20 p-3" onSubmit={save}><h3 className="text-xs font-semibold uppercase tracking-wide text-blue-300">FleetPilot classification</h3><div className="mt-3 grid gap-2"><select aria-label="FleetPilot category" className={input} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{options?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select aria-label="Classification scope" className={input} value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="COMPANY_LEVEL">Company-level / overhead</option><option value="ENTITY_ALLOCATED">Equipment or person allocation</option></select><select aria-label="Transaction review status" className={input} value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>{['UNREVIEWED','SUGGESTED','REVIEWED','NEEDS_REVIEW','IGNORED'].map((status) => <option key={status}>{status}</option>)}</select><textarea aria-label="Classification notes" className={input} name="notes" defaultValue={transaction.classification?.notes ?? ''} placeholder="Review notes" />{scope === 'ENTITY_ALLOCATED' ? <div className="space-y-2"><div className="flex justify-between"><strong className="text-xs">Split allocations</strong><button type="button" className="text-xs text-emerald-300" onClick={() => setAllocations((rows) => [...rows, emptyAllocation()])}>Add line</button></div>{allocations.map((allocation, index) => <div className="grid gap-2 rounded-lg border border-slate-800 p-2 md:grid-cols-2" key={index}><input aria-label={`Allocation ${index + 1} amount`} className={input} required value={allocation.amount} onChange={(event) => update(index,'amount',event.target.value)} placeholder="Amount" /><select aria-label={`Allocation ${index + 1} category`} className={input} required value={allocation.categoryId} onChange={(event) => update(index,'categoryId',event.target.value)}><option value="">Category</option>{options?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select aria-label={`Allocation ${index + 1} truck`} className={input} value={allocation.truckId} onChange={(event) => update(index,'truckId',event.target.value)}><option value="">No truck</option>{options?.trucks.map((truck) => <option key={truck.id} value={truck.id}>Truck {truck.unitNumber}</option>)}</select><select aria-label={`Allocation ${index + 1} trailer`} className={input} value={allocation.trailerId} onChange={(event) => update(index,'trailerId',event.target.value)}><option value="">No trailer</option>{options?.trailers.map((trailer) => <option key={trailer.id} value={trailer.id}>Trailer {trailer.unitNumber}</option>)}</select><select aria-label={`Allocation ${index + 1} driver`} className={input} value={allocation.driverId} onChange={(event) => update(index,'driverId',event.target.value)}><option value="">No driver</option>{options?.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.firstName} {driver.lastName}</option>)}</select><select aria-label={`Allocation ${index + 1} contractor`} className={input} value={allocation.partyId} onChange={(event) => update(index,'partyId',event.target.value)}><option value="">No contractor</option>{options?.parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></div>)}</div> : null}<button className="btn">Save classification</button></div></form></div></details></article>;
}
