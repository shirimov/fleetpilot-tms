import React from 'react';
import {driverMetricDefinitions} from '@/lib/fleet/driver-performance';
import type {DriverPerformanceResult} from '@/lib/fleet/driver-performance-report';

// DTO presentation only: no server singleton or source facts in the client graph.
export default function DriverPerformanceReportView({result}:{result:DriverPerformanceResult}) {
  const scope=result.status==='SOURCES_NOT_CONNECTED'?result.scope:result.report?.scope;
  const localBoundary=(instant:string)=>new Intl.DateTimeFormat('en-US',{timeZone:scope!.timeZone,year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(instant));
  const week=scope?<><p>Sunday 00:00 to next Sunday 00:00 · Pacific local time · start inclusive, end exclusive</p><p>{localBoundary(scope.start)} to {localBoundary(scope.end)} · {scope.timeZone}</p><p>UTC boundaries: {scope.start} to {scope.end}</p></>:null;
  if(!result.report) return <section aria-label="Driver performance report"><h2>Driver profitability &amp; performance</h2>{week}<p>{result.status==='REPORTING_NOT_CONFIGURED'?'Reporting configuration is not confirmed.':'Business sources are not connected.'}</p><p>No financial result or driver ranking is available.</p>{result.status==='SOURCES_NOT_CONNECTED'&&<dl>{Object.entries(driverMetricDefinitions).map(([key,definition])=><div key={key}><dt>{definition.label}</dt><dd>Not connected</dd></div>)}</dl>}</section>;
  const report=result.report;
  // Exact minor-unit display; never convert monetary amounts through Number.
  const money=(value:string|null)=>{
   if(value===null)return 'Not calculated';
   const integer=BigInt(value),negative=integer<BigInt(0),absolute=negative?-integer:integer;
   return `USD ${negative?'-':''}${absolute/BigInt(100)}.${(absolute%BigInt(100)).toString().padStart(2,'0')}`;
  };
  return <section aria-label="Driver performance report" className="rounded-xl border border-slate-700 p-5">
   <h2>Driver profitability &amp; performance</h2>
   {week}
   <h3>{report.profitLabel}</h3><p>{money(report.contributionMinor)}</p>
   <dl>
    <div><dt>Contribution margin</dt><dd>{report.contributionMarginPercent===null?'Not calculated':`${report.contributionMarginPercent}%`}</dd></div>
    <div><dt>Miles per gallon</dt><dd>{report.milesPerGallon??'Not calculated — verified consumption required'}</dd></div>
    <div><dt>Balance owed</dt><dd>Not calculated — reviewed settlement allocations required</dd></div>
   </dl>
   {result.status==='INCOMPLETE'&&<p>Incomplete contribution inputs: {report.missingContributionInputs.map(key=>driverMetricDefinitions[key].label).join(', ')}. Missing costs are not zero.</p>}
   <dl>{Object.entries(report.metrics).map(([key,metric])=>{
    const definition=driverMetricDefinitions[key as keyof typeof driverMetricDefinitions];
    return <div key={key}><dt>{definition.label}</dt><dd>{metric.value===null?'Not connected':definition.unit==='USD cents'?money(metric.value):`${metric.value} ${definition.unit}`} · {metric.coverage}</dd></div>;
   })}</dl>
   <p>Earned compensation is a cost. Payments excluding advances and advances are separate cash flows, not additional profit deductions.</p>
   <p>Overall score: Not calculated — scoring policy is not configured. No driver ranking.</p>
  </section>;
}
