'use client';

import { FormEvent, useState } from 'react';

type Participant = { id: string; firstName?: string; lastName?: string; name?: string };
const components = ['miles', 'rate', 'grossRevenue', 'earning', 'reimbursement', 'advances', 'fuel', 'toll', 'recurring', 'deductions', 'escrow', 'payout'] as const;
const inputClass = 'rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm';
async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'Request failed.');
  return result;
}

export default function RealPayrollCaseEntry({ periodId, drivers, contractors, onCreated }: { periodId: string; drivers: Participant[]; contractors: Participant[]; onCreated: () => Promise<void> }) {
  const [participantType, setParticipantType] = useState<'COMPANY_DRIVER' | 'CONTRACTOR'>('COMPANY_DRIVER');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const participants = participantType === 'COMPANY_DRIVER' ? drivers : contractors;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await post('/api/payroll/references', {
        periodId, participantType, participantId: values.participantId, provider: 'MANUAL_AUDIT_REFERENCE',
        externalStatementRef: values.externalStatementRef, miles: values.miles, ratePerMile: values.rate,
        grossRevenue: values.grossRevenue, earning: values.earning, reimbursement: values.reimbursement,
        advances: values.advances, fuel: values.fuel, toll: values.toll, recurring: values.recurring,
        deductions: values.deductions, escrow: values.escrow, payout: values.payout, currency: 'USD', notes: values.referenceNotes,
      });
      const inputSources = Object.fromEntries(components.map((name) => [name, values[`source_${name}`]]));
      await post('/api/payroll/reconciliation-cases', { periodId, participantType, participantId: values.participantId, caseType: values.caseType, truckUnitReference: values.truckUnitReference, inputSources, notes: values.caseNotes });
      setMessage('Audit case captured and readiness recalculated.'); await onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3 rounded-xl border border-white/10 bg-slate-900/70 p-4">
    <div><p className="text-xs uppercase tracking-[.2em] text-amber-300">Real historical reference</p><h2 className="font-semibold">Payroll audit case entry</h2><p className="text-xs text-slate-400">Reference data only. This creates no payroll, Accounting entry, payment, or balance change.</p></div>
    <div className="grid gap-2 md:grid-cols-3"><select aria-label="Audit participant type" className={inputClass} name="participantType" value={participantType} onChange={(event) => setParticipantType(event.target.value as typeof participantType)}><option value="COMPANY_DRIVER">Company driver</option><option value="CONTRACTOR">Contractor</option></select><select aria-label="Audit participant" className={inputClass} name="participantId" required>{participants.map((item) => <option key={item.id} value={item.id}>{item.name ?? `${item.firstName} ${item.lastName}`}</option>)}</select><select aria-label="Audit case type" className={inputClass} name="caseType"><option value="SOLO_DRIVER">Solo company driver</option><option value="DRIVER_WITH_DEDUCTIONS">Driver with deductions</option><option value="CONTRACTOR">Contractor</option><option value="TEAM_DRIVER">Team driver</option><option value="COMPLEX_CONTRACTOR">Complex contractor</option><option value="OTHER">Other</option></select><input className={inputClass} name="truckUnitReference" placeholder="Truck/unit reference" /><input className={inputClass} name="externalStatementRef" placeholder="Statement/reference" required /></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-1">Component</th><th className="p-1">Known external value</th><th className="p-1">Input source</th></tr></thead><tbody>{components.map((name) => <tr key={name}><td className="p-1 capitalize">{name === 'grossRevenue' ? 'Gross / revenue (when relevant)' : name === 'deductions' ? 'Other deductions' : name}</td><td className="p-1"><input className={`${inputClass} w-full`} name={name} placeholder="Enter 0 explicitly when verified zero" required={name !== 'grossRevenue'} /></td><td className="p-1"><select className={`${inputClass} w-full`} name={`source_${name}`} defaultValue={name === 'miles' || name === 'rate' || name === 'earning' || name === 'payout' ? 'CANONICAL_FLEETPILOT' : 'UNAVAILABLE'}><option value="CANONICAL_FLEETPILOT">Canonical FleetPilot</option><option value="MANUAL_AUDIT_INPUT">Manual audit input</option><option value="EXTERNAL_REFERENCE">External reference</option><option value="DERIVED">Derived</option><option value="UNAVAILABLE">Unavailable</option></select></td></tr>)}</tbody></table></div>
    <textarea className={`${inputClass} w-full`} name="referenceNotes" placeholder="External statement context" /><textarea className={`${inputClass} w-full`} name="caseNotes" placeholder="Case analysis and known business context" />{message && <p role="status" className="text-sm text-amber-200">{message}</p>}<button className="btn" disabled={busy}>{busy ? 'Comparing…' : 'Capture and compare case'}</button>
  </form>;
}
