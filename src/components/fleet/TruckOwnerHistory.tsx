'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { buildOwnerHistoryChange, ownerHistoryRequest, saveOwnerHistory, type OwnerHistoryOptions, type OwnerHistorySnapshot } from '@/lib/fleet/truck-owner-editor';
import type { OwnerPeriod } from '@/lib/fleet/truck-owner-resolution';

const input = 'mt-1 block w-full rounded border border-gray-600 bg-gray-950 p-2';
const emptyPeriod = (): OwnerPeriod => ({ companyId: '', ownerPartyId: '', providerRecipientId: '', effectiveFrom: '', effectiveTo: null });
type Change = ReturnType<typeof buildOwnerHistoryChange>;

export function TruckOwnerHistory({ truck, onClose, onChanged, previewStatus }: {
  truck: { id: string; unitNumber: string }; onClose: () => void; onChanged?: () => void; previewStatus?: ReactNode;
}) {
  const [history, setHistory] = useState<OwnerHistorySnapshot | null>(null);
  const [options, setOptions] = useState<OwnerHistoryOptions | null>(null);
  const [periods, setPeriods] = useState<OwnerPeriod[]>([]);
  const [source, setSource] = useState(''), [reason, setReason] = useState('');
  const [review, setReview] = useState<Change | null>(null), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [blocked, setBlocked] = useState(false), [dirty, setDirty] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const url = `/api/trucks/${encodeURIComponent(truck.id)}/owner-history`;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setOptions(null);
    try {
      const current = await ownerHistoryRequest<OwnerHistorySnapshot>(url, { signal });
      if (signal?.aborted) return;
      setHistory(current);
      const choices = await ownerHistoryRequest<OwnerHistoryOptions>(`${url}/options`, { signal });
      if (signal?.aborted) return;
      setOptions(choices); setPeriods(current.periods); setReview(null); setConfirmed(false);
      setSource(''); setReason(''); setBlocked(false); setDirty(false);
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Unable to load owner history.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [url]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => prior?.focus();
  }, []);

  const close = () => { if (!busy && (!dirty || window.confirm('Discard unsaved owner-history draft?'))) onClose(); };
  const reload = () => {
    if (dirty && !window.confirm('Discard this draft and reload the full saved timeline?')) return;
    setNotice(''); void load();
  };
  const changed = () => { setDirty(true); setNotice(''); setReview(null); setConfirmed(false); };
  const update = (index: number, patch: Partial<OwnerPeriod>) => { changed(); setPeriods(previous => previous.map((period, i) => i === index ? { ...period, ...patch } : period)); };
  function prepare(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!history || !options || blocked) return;
    try { setReview(buildOwnerHistoryChange(history.revisionId, periods, source, reason, options)); setConfirmed(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Review the timeline.'); }
  }
  async function save() {
    if (!review || !confirmed || blocked || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const current = await saveOwnerHistory(truck.id, review);
      setHistory(current); setPeriods(current.periods); setDirty(false); setReview(null); setConfirmed(false); setSource(''); setReason('');
      setNotice(`Saved and read back revision ${current.revisionId}. Actor, evidence and reason are shown below. Fuel preview refresh is separate from this verified save; unresolved dates remain in review.`);
      onChanged?.();
    } catch (e) {
      setBlocked(true);
      setError(`${e instanceof Error ? e.message : 'Save could not be verified.'} Reload the saved timeline before any further save. The draft is retained; a failed response does not prove the write failed.`);
    } finally { setBusy(false); }
  }
  const companyName = (id: string) => options?.companies.find(c => c.id === id)?.name ?? id;
  const ownerName = (id: string) => options?.owners.find(o => o.id === id)?.name ?? history?.periods.find(p => p.ownerPartyId === id)?.ownerName ?? id;
  const recipientName = (companyId: string, id: string) => options?.recipients.find(r => r.companyId === companyId && r.id === id)?.name ?? 'QM Contractor';

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Beneficial owner history" className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-6 text-white" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
        const first = focusable?.[0], last = focusable?.[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="flex justify-between gap-3"><h3 className="text-lg font-bold">Truck {truck.unitNumber} · Beneficial owner history</h3><button disabled={busy} onClick={close}>Close owner history</button></div>
      <p className="my-3 text-sm text-gray-300">Beneficial ownership is separate from operating Company. Company below is the QM recipient namespace, not the owner. Dates are calendar labels: from inclusive, to exclusive; blank end means no confirmed end. No timezone or unknown start date is inferred.</p>
      <p className="text-sm text-gray-300">Gaps remain unknown. Ownership alone does not resolve an uncertain fuel purchase date, change policy, or rewrite source transactions, manual matches or all accounting income and expenses.</p>
      {error && <p role="alert" className="my-3 text-red-300">{error}</p>}
      {notice && <p role="status" className="my-3 text-green-300">{notice}</p>}
      {previewStatus}
      <button type="button" disabled={busy || loading} className="my-3 text-blue-300 underline disabled:opacity-50" onClick={reload}>Reload saved timeline</button>
      {loading && <p>Loading owner history and verified selectors…</p>}
      {history && <>
        <h4 className="font-semibold">Saved full effective timeline</h4>
        <p className="break-all text-xs">Current revision: {history.revisionId ?? 'None — first confirmation'}</p>
        {!history.periods.length && <p className="my-3">No confirmed owner history. Earlier ownership and start dates remain unknown.</p>}
        <ol className="my-3 space-y-3">{history.periods.map(period => <li key={period.id} className="rounded border border-gray-700 p-3 text-sm">
          <p><strong>{period.ownerName}</strong> · {period.effectiveFrom} → {period.effectiveTo ?? 'Open-ended'} (end exclusive)</p>
          <p>Owner party: {period.ownerPartyId}</p><p>Binding Company: {companyName(period.companyId)} · {period.companyId}</p>
          <p>{recipientName(period.companyId, period.providerRecipientId)} · Contractor ID: {period.providerRecipientId}</p>
          <dl className="mt-2 break-words"><dt>Evidence</dt><dd>{period.sourceReference}</dd><dt>Reason</dt><dd>{period.reason}</dd></dl>
          <p>Actor: {period.actorUserId}</p><p>Recorded at (ISO timestamp): {period.createdAt}</p><p className="break-all text-xs">Period: {period.id} · Revision: {period.revisionId}</p>
        </li>)}</ol>
      </>}
      {!loading && !options && <p>Selectors unavailable. Editing is disabled; reload to retry. No IDs can be entered manually.</p>}
      {options && !options.canManage && <p>Read-only: OWNER authority across the full timeline is required to edit. ADMIN access does not permit ownership writes.</p>}
      {history && options?.canManage && !loading && <form onSubmit={prepare} className="space-y-4 border-t border-gray-700 pt-4">
        <h4 className="font-semibold">Edit full effective timeline</h4>
        <p className="text-sm">Every saved period is included. Removing a row removes it from the new effective timeline; prior revisions remain auditable. Select verified identities explicitly. Missing parties must be created through the existing financial-party workflow; missing Contractors require scoped sealed archive evidence.</p>
        <fieldset disabled={busy || blocked || !!review} className="space-y-4 disabled:opacity-60">
          {periods.map((period, index) => {
            const owners = options.owners.filter(o => o.companyId === null || o.companyId === period.companyId);
            const recipients = options.recipients.filter(r => r.companyId === period.companyId);
            return <fieldset key={index} className="rounded border border-gray-700 p-3"><legend>Period {index + 1}</legend><div className="grid gap-3 md:grid-cols-3">
              <label>Binding Company {index + 1}<select className={input} required value={period.companyId} onChange={e => update(index, { companyId: e.target.value, ownerPartyId: '', providerRecipientId: '' })}><option value="">Select Company</option>{period.companyId && !options.companies.some(c => c.id === period.companyId) && <option value={period.companyId} disabled>Unavailable · {period.companyId}</option>}{options.companies.map(c => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></label>
              <label>Owner party {index + 1}<select className={input} required disabled={!period.companyId} value={period.ownerPartyId} onChange={e => update(index, { ownerPartyId: e.target.value })}><option value="">Select FinancialParty owner</option>{period.ownerPartyId && !owners.some(o => o.id === period.ownerPartyId) && <option value={period.ownerPartyId} disabled>Unavailable · {ownerName(period.ownerPartyId)} · {period.ownerPartyId}</option>}{owners.map(o => <option key={o.id} value={o.id}>{o.name} · {o.id}</option>)}</select></label>
              <label>QM Contractor {index + 1}<select className={input} required disabled={!period.companyId} value={period.providerRecipientId} onChange={e => update(index, { providerRecipientId: e.target.value })}><option value="">Select scoped Contractor</option>{period.providerRecipientId && !recipients.some(r => r.id === period.providerRecipientId) && <option value={period.providerRecipientId} disabled>Unavailable · {period.providerRecipientId}</option>}{recipients.map(r => <option key={r.id} value={r.id}>{r.name ?? 'Unnamed Contractor'} · {r.id}</option>)}</select></label>
              <label>From (inclusive) {index + 1}<input className={input} type="date" required value={period.effectiveFrom} onChange={e => update(index, { effectiveFrom: e.target.value })} /></label>
              <label>To (exclusive) {index + 1}<input className={input} type="date" value={period.effectiveTo ?? ''} onChange={e => update(index, { effectiveTo: e.target.value || null })} /></label>
              <button type="button" className="text-red-300" onClick={() => { changed(); setPeriods(periods.filter((_, i) => i !== index)); }}>Remove period {index + 1}</button>
            </div>{period.companyId && (!owners.length || !recipients.length) && <p className="mt-2 text-amber-300">Verified owner or Contractor choices are missing for this Company. No identity is inferred.</p>}</fieldset>;
          })}
          <button type="button" disabled={periods.length >= 200} className="text-blue-300" onClick={() => { changed(); setPeriods([...periods, emptyPeriod()]); }}>Add owner period</button>
          <label className="block">Evidence reference<input className={input} required maxLength={2000} value={source} onChange={e => { changed(); setSource(e.target.value); }} /></label>
          <label className="block">Reason<textarea className={input} required maxLength={2000} value={reason} onChange={e => { changed(); setReason(e.target.value); }} /></label>
          <button className="rounded bg-blue-600 px-4 py-2">Review full timeline</button>
        </fieldset>
        {review && <section className="space-y-3 rounded border border-amber-500 p-4" aria-label="Confirm owner timeline">
          <h4 className="font-semibold">Review replacement before saving</h4><p className="break-all">Replacing revision: {review.expectedRevisionId ?? 'None — first confirmation'}</p>
          <p>This saves the entire timeline, not only the changed row. Dates outside these periods stay unresolved. Later QM posting does not establish a different owner.</p>
          <ol className="space-y-2">{review.periods.map((period, index) => <li key={index} className="break-words">{period.effectiveFrom} → {period.effectiveTo ?? 'Open-ended'} (end exclusive) · {ownerName(period.ownerPartyId)} [{period.ownerPartyId}] · {companyName(period.companyId)} [{period.companyId}] · {recipientName(period.companyId, period.providerRecipientId)} [{period.providerRecipientId}]</li>)}</ol>
          <p>Evidence: {review.sourceReference}</p><p>Reason: {review.reason}</p>
          <label className="flex gap-2"><input type="checkbox" disabled={busy || blocked} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed every period and its owner / Company / Contractor binding.</label>
          <div className="flex gap-4"><button type="button" disabled={busy || blocked || !confirmed} className="rounded bg-blue-600 px-4 py-2 disabled:opacity-50" onClick={() => void save()}>{busy ? 'Saving and verifying…' : 'Save audited owner history'}</button><button type="button" disabled={busy || blocked} onClick={() => { setReview(null); setConfirmed(false); }}>Back to edit</button></div>
        </section>}
      </form>}
    </section>
  </div>;
}
