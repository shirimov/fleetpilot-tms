'use client';

import { useCallback, useEffect, useState } from 'react';

type CompanySummary = { companyId: string; company: { id: string; name: string }; joinedAt?: string };
type GroupCompaniesResponse = {
  role: 'OWNER' | 'ADMIN';
  includedCompanies: CompanySummary[];
  availableCompanies: CompanySummary[];
  removalSupported: false;
};

const panel = 'rounded-xl border border-white/10 bg-slate-900/70 p-4';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body as T;
}

export default function OperatingGroupCompanies({ groupName, onChanged }: { groupName: string; onChanged: () => Promise<void> }) {
  const [state, setState] = useState<GroupCompaniesResponse | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const next = await request<GroupCompaniesResponse>('/api/finance/group/companies');
    setState(next);
    setSelectedCompanyId((current) => next.availableCompanies.some(({ companyId }) => companyId === current) ? current : '');
  }, []);
  useEffect(() => { refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Request failed.')); }, [refresh]);

  if (!state) return <section className={panel}>Loading operating-group companies…</section>;
  const selected = state.availableCompanies.find(({ companyId }) => companyId === selectedCompanyId);

  async function addCompany() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await request('/api/finance/group/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selected.companyId }),
      });
      setConfirming(false);
      await refresh();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid gap-4 lg:grid-cols-2">
    <section className={panel}>
      <h2 className="font-semibold">Included companies</h2>
      <p className="mt-1 text-sm text-slate-400">Accounting remains company-attributed while authorized companies share this operating group.</p>
      <div className="mt-4 space-y-2">
        {state.includedCompanies.map(({ company, joinedAt }) => <article key={company.id} className="rounded-lg bg-slate-950/60 p-3">
          <strong>{company.name}</strong>
          {joinedAt && <p className="text-xs text-slate-400">Included {new Date(joinedAt).toLocaleDateString()}</p>}
        </article>)}
      </div>
      <p className="mt-4 text-xs text-slate-400">Removing companies is intentionally unavailable in this version because historical Accounting relationships must remain interpretable.</p>
    </section>
    <section className={panel}>
      <h2 className="font-semibold">Add an authorized company</h2>
      {state.role !== 'OWNER' ? <p className="mt-2 text-sm text-slate-300">Only an operating-group OWNER can add companies. Your access is view-only.</p> : <>
        <p className="mt-1 text-sm text-slate-400">Only companies where you currently hold OWNER membership are eligible. Adding a company does not move or rewrite its records.</p>
        <div className="mt-4 grid gap-3">
          <select aria-label="Company to add" className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm" value={selectedCompanyId} onChange={(event) => { setSelectedCompanyId(event.target.value); setConfirming(false); }}>
            <option value="">Select company…</option>
            {state.availableCompanies.map(({ companyId, company }) => <option key={companyId} value={companyId}>{company.name}</option>)}
          </select>
          <button className="btn" disabled={!selected} onClick={() => setConfirming(true)}>Review addition</button>
          {!state.availableCompanies.length && <p className="text-sm text-slate-400">No additional OWNER-authorized companies are available.</p>}
        </div>
        {confirming && selected && <div role="dialog" aria-label="Confirm operating-group company" className="mt-4 rounded-lg border border-amber-400/40 bg-amber-950/30 p-4">
          <h3 className="font-semibold text-amber-100">Confirm company addition</h3>
          <p className="mt-2 text-sm text-amber-50">Add <strong>{selected.company.name}</strong> to <strong>{groupName}</strong>?</p>
          <p className="mt-1 text-xs text-amber-100/80">This expands authorized Accounting matching and views. It does not rematch Pilot invoices or modify company business records.</p>
          <div className="mt-3 flex gap-2"><button className="btn" disabled={busy} onClick={addCompany}>{busy ? 'Adding…' : 'Confirm add'}</button><button disabled={busy} className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => setConfirming(false)}>Cancel</button></div>
        </div>}
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  </div>;
}
