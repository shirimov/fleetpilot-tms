import React from 'react';
import {driverMetricDefinitions} from '@/lib/fleet/driver-performance';

const groups=['Profitability','Payments','Availability','Load performance','Fuel efficiency','Communication'];
// No real financial values are sent to this view yet. Future connectors must enforce
// finance/HR authorization on the server before adding any monetary DTO fields.
export default function DriverPerformancePreparation() {
 return <section aria-labelledby="driver-performance-heading" className="rounded-xl border border-slate-700 bg-slate-900 p-5">
  <h2 id="driver-performance-heading" className="text-xl">Driver profitability &amp; performance</h2>
  <p className="mt-2 text-slate-400">Preparation view — business data sources are not connected. No driver ranking or financial conclusion is available.</p>
  <dl className="grid gap-4 py-4 sm:grid-cols-2">
   <div><dt>Overall driver score</dt><dd>Not calculated — weights and scoring rules await approval.</dd></div>
   <div><dt>Week and operational timezone</dt><dd>Not configured — no reporting cutoff is assumed.</dd></div>
   {['Contribution profit','Contribution margin','Gross per worked day','Contribution per worked day','Contribution per mile','Fuel cost per mile','Miles per gallon'].map(label=><div key={label}><dt>{label}</dt><dd>Not calculated — evidence required.</dd></div>)}
  </dl>
  <p>Contribution profit is attributed gross revenue minus earned driver compensation, fuel cost, and other direct costs. It is not final net profit. Missing costs are not treated as zero.</p>
  <div className="my-5 grid gap-5 lg:grid-cols-2">
   {groups.map(group=><section key={group} className="rounded border border-slate-700 p-4" aria-label={group}>
    <h3 className="font-semibold">{group}</h3>
    <dl className="mt-3 space-y-2">
     {Object.entries(driverMetricDefinitions).filter(([,definition])=>definition.group===group).map(([key,definition])=><div key={key} className="flex flex-wrap justify-between gap-2"><dt>{definition.label}</dt><dd className="text-slate-400">Not connected</dd></div>)}
    </dl>
   </section>)}
  </div>
  <ul className="list-disc space-y-2 pl-5 text-slate-300">
   <li>Earned compensation is a work-period cost. Payments and advances are separate cash-flow evidence, not additional deductions from the same profit.</li>
   <li>Balance owed requires reviewed settlement, payment, and advance allocations; it is not inferred from these totals.</li>
   <li>Approved time off, unplanned absences, and required rest remain separate. No absence penalty is configured.</li>
   <li>Pickup and delivery performance stay separate. Unknown timing is disclosed, and driver responsibility requires review.</li>
   <li>Communication requires a consistent review rubric; missing messages are not automatic failures.</li>
   <li>Fuel purchases alone do not establish fuel consumed. Route, equipment, load, and assignment differences remain relevant to comparisons.</li>
   <li>Safety findings remain visible independently of profitability. This is an internal company framework, not an official FMCSA rating.</li>
  </ul>
 </section>;
}
