'use client';

import { useState } from 'react';
import { formatMinorUnitsDecimal } from '@/lib/finance/money';

type Row = Record<string, unknown>;
type Candidate = {
  id: string;
  name: string;
  merchantName: string | null;
  date: string;
  amountMinor: string;
  availableAmountMinor: string;
  amountDifferenceMinor: string;
  eligible: boolean;
  ineligibleReason: string | null;
};

function dollars(value: unknown) { return `$${formatMinorUnitsDecimal(BigInt(String(value ?? 0)))}`; }

export default function ExpectationBankReconciliation({ expectations, refresh }: { expectations: Row[]; refresh: () => Promise<void> }) {
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load(expectationId: string) {
    setBusy(expectationId); setError('');
    try {
      const response = await fetch(`/api/finance/expectations/${expectationId}/bank-matches`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Candidate search failed.');
      setCandidates((current) => ({ ...current, [expectationId]: body }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Candidate search failed.'); }
    finally { setBusy(''); }
  }

  async function match(expectation: Row, candidate: Candidate) {
    const message = `Match ${candidate.merchantName ?? candidate.name} ${dollars(candidate.amountMinor)} to ${String(expectation.description)}?\n\nThis records settlement of an existing expected payment. It does not create another expense.`;
    if (!window.confirm(message)) return;
    setBusy(String(expectation.id)); setError('');
    try {
      const response = await fetch(`/api/finance/expectations/${String(expectation.id)}/bank-matches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bankTransactionId: candidate.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Bank match failed.');
      await refresh();
      setCandidates((current) => { const next = { ...current }; delete next[String(expectation.id)]; return next; });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Bank match failed.'); }
    finally { setBusy(''); }
  }

  return <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
    <h2 className="mb-3 font-semibold">Expected money</h2>
    {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
    <div className="space-y-3">{expectations.map((expectation) => {
      const expected = BigInt(String(expectation.expectedAmountMinor));
      const matched = BigInt(String(expectation.matchedAmountMinor));
      const remaining = expected - matched;
      const settled = expectation.status === 'MATCHED';
      const bankMatches = Array.isArray(expectation.bankMatches) ? expectation.bankMatches as Row[] : [];
      return <article key={String(expectation.id)} className="rounded-lg border border-white/10 p-3">
        <div className="flex flex-wrap justify-between gap-3"><div><strong>{String(expectation.description)}</strong><p className="text-xs text-slate-400">Due {String(expectation.expectedDateEnd).slice(0, 10)} · {String(expectation.direction)} · {String(expectation.currency)}</p></div><span className={settled ? 'text-emerald-300' : 'text-amber-200'}>{settled ? 'Settled' : String(expectation.status)}</span></div>
        <p className="mt-2 text-sm">Expected {dollars(expected)} · Matched {dollars(matched)} · Remaining {dollars(remaining)}</p>
        {bankMatches.map((bankMatch) => <p key={String(bankMatch.id)} className="mt-2 text-xs text-emerald-300">Reconciled → {String((bankMatch.bankTransaction as Row)?.merchantName ?? (bankMatch.bankTransaction as Row)?.name)} · {dollars(bankMatch.matchedAmountMinor)}</p>)}
        {!settled && <button className="btn mt-3" disabled={busy === expectation.id} onClick={() => load(String(expectation.id))}>Find bank candidates</button>}
        {candidates[String(expectation.id)]?.map((candidate) => <div key={candidate.id} className="mt-3 rounded-lg bg-slate-950 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><div><strong>{candidate.merchantName ?? candidate.name}</strong><p className="text-xs text-slate-400">{candidate.date.slice(0, 10)} · Posted · Available {dollars(candidate.availableAmountMinor)}</p></div><div className="text-right"><strong>{dollars(candidate.amountMinor)}</strong><p className="text-xs text-slate-400">Difference {dollars(candidate.amountDifferenceMinor)}</p></div></div>{candidate.eligible ? <button className="btn mt-2" disabled={busy === expectation.id} onClick={() => match(expectation, candidate)}>Match bank transaction</button> : <p className="mt-2 text-xs text-amber-200">{candidate.ineligibleReason}</p>}</div>)}
      </article>;
    })}</div>
  </section>;
}
