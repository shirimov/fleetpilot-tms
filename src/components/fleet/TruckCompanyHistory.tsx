'use client';
import { useEffect, useState } from 'react';

type History = { currentCompanyId: string | null; canManage: boolean; revisionId: string | null; periods: { id: string; companyName: string; effectiveFrom: string; effectiveTo: string | null; source: string; status: string }[] };
export function TruckCompanyHistory({ truck, companies, onClose, onChanged }: {
  truck: { id: string; unitNumber: string; companyId: string };
  companies: { id: string; name: string; canManage: boolean }[];
  onClose: () => void; onChanged: () => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [destination, setDestination] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const res = await fetch(`/api/trucks/${truck.id}/company-history`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    setHistory(body);
  }
  useEffect(() => { load().catch(e => setError(e.message)); /* Load the selected Truck only. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truck.id]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const input = history?.revisionId ? { action: 'MOVE', destinationCompanyId: destination, effectiveDate: date } : { action: 'CONFIRM', periods: [{ companyId: truck.companyId, effectiveFrom: date, effectiveTo: null }] };
      const response = await fetch(`/api/trucks/${truck.id}/company-history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, expectedRevisionId: history?.revisionId ?? null, source: 'MANUAL_CONFIRMATION', sourceReference: reference, reason }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      await load(); onChanged(); setDate(''); setReason(''); setReference('');
    } catch (e) { setError(e instanceof Error ? e.message : 'History change failed.'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
    <section role="dialog" aria-modal="true" aria-label="Operating Company History" className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-6 text-white">
      <div className="flex justify-between"><h3 className="text-lg font-bold">Truck {truck.unitNumber} · Operating Company History</h3><button onClick={onClose} aria-label="Close history">Close</button></div>
      <p className="my-3 text-sm text-gray-400">Current operating Company: {companies.find(c => c.id === history?.currentCompanyId)?.name ?? 'Not available in your scope'}. History records operation, not legal ownership or fuel policy.</p>
      {error && <p role="alert" className="my-3 text-red-300">{error}</p>}
      {!history ? <p>Loading history…</p> : <>
        {!history.periods.length ? <p>No confirmed history in your authorized scope. Historical dates remain unknown.</p> : <table className="my-4 w-full text-left text-sm"><thead><tr>{['Company', 'From (inclusive)', 'To (exclusive)', 'Source', 'Status'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{history.periods.map(p => <tr key={p.id}><td className="p-2">{p.companyName}</td><td>{p.effectiveFrom}</td><td>{p.effectiveTo ?? 'Present'}</td><td>{p.source.replaceAll('_', ' ')}</td><td>{p.status}</td></tr>)}</tbody></table>}
        {history.canManage && <form onSubmit={save} className="mt-5 space-y-3 border-t border-gray-700 pt-4">
          <h4 className="font-semibold">{history.revisionId ? 'Move operating Company' : 'Confirm current affiliation'}</h4>
          <p className="text-sm text-gray-400">Enter an evidenced calendar date. Leave unknown history unrecorded. This action preserves the Truck ID, VIN, and historical evidence.</p>
          {history.revisionId && <label className="block">Destination Company<select required aria-label="Destination Company" value={destination} onChange={e => setDestination(e.target.value)} className="ml-3 rounded bg-gray-800 p-2"><option value="">Select Company</option>{companies.filter(c => c.canManage && c.id !== history.currentCompanyId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label className="block">Effective date<input required type="date" aria-label="Effective date" value={date} onChange={e => setDate(e.target.value)} className="ml-3 rounded bg-gray-800 p-2" /></label>
          <label className="block">Evidence reference<input required maxLength={2000} value={reference} onChange={e => setReference(e.target.value)} className="mt-1 block w-full rounded bg-gray-800 p-2" /></label>
          <label className="block">Reason<input required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded bg-gray-800 p-2" /></label>
          <button disabled={busy} className="rounded bg-blue-600 px-4 py-2 disabled:opacity-50">{busy ? 'Saving…' : history.revisionId ? 'Confirm Company movement' : 'Confirm evidenced start date'}</button>
        </form>}
      </>}
    </section>
  </div>;
}
