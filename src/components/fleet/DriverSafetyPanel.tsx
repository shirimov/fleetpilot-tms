'use client';
/* eslint-disable @next/next/no-img-element -- Private photos use the viewer's authorized request, not an image-optimization proxy. */
import React, { useEffect, useRef, useState } from 'react';
import type { DriverSafetyService } from '@/lib/fleet/driver-safety-service';
import { photoCommitMatches, type PhotoCommit } from '@/lib/fleet/driver-safety-photo-commit';

type Snapshot = Awaited<ReturnType<DriverSafetyService['get']>>;
type Inspection = Snapshot['inspections'][number];
const panel = 'rounded-2xl border border-slate-700/70 bg-[var(--alpha-panel)] p-5 sm:p-6';
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-50';
const input = 'mt-1 block min-h-11 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-blue-400';
const label = 'block text-sm text-slate-300';
async function payload(response: Response): Promise<Snapshot & { photoCommit?: PhotoCommit }> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The operation could not be confirmed. Reload before trying again.');
  return body;
}
export default function DriverSafetyPanel({ driverId }: { driverId: string }) {
  const endpoint = `/api/drivers/pool/${encodeURIComponent(driverId)}`;
  const [snapshot,setSnapshot] = useState<Snapshot|null>(null);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const [reload,setReload] = useState(0);
  const [review,setReview] = useState<Inspection|null>(null);
  const [photoFailed,setPhotoFailed] = useState(false);
  const reportForm = useRef<HTMLFormElement>(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`${endpoint}/safety`,{cache:'no-store',signal:controller.signal}).then(payload).then(state=>{if(!controller.signal.aborted){setSnapshot(state);setError('');}}).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[endpoint,reload]);
  async function mutate(path: string, init: RequestInit) {
    if(!snapshot || busy || error)return;
    setBusy(true);setMessage('');
    try {
      const written=await payload(await fetch(path,{...init,headers:{...init.headers,'if-match':snapshot.revision},cache:'no-store'}));
      const readback=await payload(await fetch(`${endpoint}/safety`,{cache:'no-store'}));
      if(init.method==='PUT' && path===`${endpoint}/photo` && (!photoCommitMatches(written.photoCommit,written) || !photoCommitMatches(written.photoCommit,readback)))throw new Error('Photo changed after saving. Reload and review the latest record.');
      if(readback.revision!==written.revision)throw new Error('Records changed after saving. Reload and review the latest record.');
      setSnapshot(readback);setReview(null);setPhotoFailed(false);reportForm.current?.reset();setMessage('Saved and verified.');
      window.dispatchEvent(new CustomEvent('driver-safety-updated',{detail:{driverId,photoVersion:readback.photoVersion}}));
    } catch(error) { setError(error instanceof Error?error.message:'Unable to confirm the operation. Reload before retrying.'); }
    finally {setBusy(false);}
  }
  async function saveReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget), raw=form.get('violations');
    const metadata={source:form.get('source'),reportIdentifier:form.get('reportIdentifier'),inspectionDate:form.get('inspectionDate'),violations:raw===''?null:Number(raw),outOfService:form.get('outOfService')==='unknown'?null:form.get('outOfService')==='yes',reviewed:form.get('reviewed')==='on'};
    const body=new FormData();body.set('metadata',JSON.stringify(metadata));
    const file=form.get('report');if(file instanceof File&&file.size)body.set('report',file);
    if(review)body.set('supersedes',review.id);
    await mutate(`${endpoint}/safety`,{method:'POST',body});
  }
  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);
    const policy={label:form.get('label'),enabled:form.get('enabled')==='on',maximum:Number(form.get('maximum')),minimum:Number(form.get('minimum')),violationPenalty:Number(form.get('violationPenalty')),outOfServicePenalty:Number(form.get('outOfServicePenalty')),windowStart:form.get('windowStart'),windowEnd:form.get('windowEnd')};
    await mutate(`${endpoint}/safety`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'policy',policy})});
  }
  const policy=snapshot?.policy;
  const current=snapshot?.inspections.filter(record=>record.current)??[];
  return <div className="space-y-5" aria-busy={busy}>
    {error&&<section role="alert" className={panel}><h2 className="font-semibold">Safety records need attention</h2><p className="mt-2 text-sm leading-6 text-slate-300">{error}</p><p className="mt-2 text-xs text-slate-400">Saving is paused until a fresh read succeeds. An error does not prove that a previous save was rolled back.</p><button type="button" className={`${button} mt-4`} disabled={busy} onClick={()=>setReload(value=>value+1)}>Reload safety records</button></section>}
    {message&&<p role="status" className="text-sm text-emerald-200">{message}</p>}
    {!snapshot&&!error&&<p role="status" className="text-sm text-slate-400">Loading private safety records…</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
      <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Inspection history</h2><span className="text-xs text-slate-400">Private original reports</span></div>
        {!current.length&&<div className="mt-5 rounded-xl border border-dashed border-slate-600 bg-slate-950/40 p-5"><p className="font-medium">Awaiting inspection evidence</p><p className="mt-2 text-sm leading-6 text-slate-400">Inspection counts, violations and outcomes remain unknown—not zero. Upload an original report, then enter and review its findings. Nothing is automatically extracted.</p></div>}
        {snapshot&&<ul className="mt-4 divide-y divide-slate-700">{snapshot.inspections.map(record=><li key={record.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words text-sm font-semibold">{record.reportIdentifier}</h3><span className="text-xs text-slate-400">{!record.current?'Superseded · retained':record.reviewed?'Reviewed entry':'Awaiting review'}</span></div><p className="mt-1 break-words text-xs text-slate-400">{record.source} · {record.inspectionDate}</p><p className="mt-3 text-sm text-slate-300">Violations: {record.violations??'Unknown'} · Out of service: {record.outOfService===null?'Unknown':record.outOfService?'Yes':'No'}</p><div className="mt-3 flex flex-wrap gap-2"><a href={`${endpoint}/safety/${encodeURIComponent(record.id)}`} className={button}>Download original</a>{record.current&&<button type="button" className={button} disabled={busy||!!error} onClick={()=>{setReview(record);reportForm.current?.querySelector<HTMLInputElement>('input')?.focus();}}>Review / correct</button>}</div><details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer py-2">Integrity &amp; provenance</summary><p className="break-all leading-5">SHA-256: {record.sha256}</p><p className="mt-2">{record.bytes} bytes · Recorded {record.createdAt}. Hash confirms retained bytes, not authenticity or malware safety.</p></details></li>)}</ul>}
        <details className="mt-5 border-t border-slate-700 pt-4" open={review?true:undefined}><summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium text-blue-200 focus-visible:outline-2 focus-visible:outline-blue-400">{review?'Review the selected report':'Add inspection evidence'}</summary>
          <form key={review?.id??'new'} ref={reportForm} onSubmit={saveReport} className="mt-3 space-y-4"><fieldset disabled={!snapshot||busy||!!error} className="space-y-4 disabled:opacity-50">
            <label className={label}>Report source<input name="source" required maxLength={160} defaultValue={review?.source??''} className={input} placeholder="Issuing agency or reviewed report source"/></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className={label}>Report identifier<input name="reportIdentifier" required maxLength={160} defaultValue={review?.reportIdentifier??''} className={input}/></label><label className={label}>Inspection date<input name="inspectionDate" type="date" required defaultValue={review?.inspectionDate??''} className={input}/></label></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className={label}>Violation count<input name="violations" type="number" min={0} max={10000} step={1} defaultValue={review?.violations??''} placeholder="Unknown" className={input}/></label><label className={label}>Out-of-service outcome<select name="outOfService" defaultValue={review?.outOfService===true?'yes':review?.outOfService===false?'no':'unknown'} className={input}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label></div>
            <label className={label}>{review?'Replacement original (optional)':'Original inspection report'}<input name="report" type="file" required={!review} className="mt-2 block min-h-11 w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-3 file:text-slate-100"/></label><p className="text-xs leading-5 text-slate-400">Up to 10 MB. Unknown formats are preserved unchanged and downloaded privately; no parsing or malware-safety claim. Do not upload unrelated sensitive documents.</p>
            <label className="flex items-start gap-3 text-sm leading-6 text-slate-300"><input type="checkbox" name="reviewed" defaultChecked={review?.reviewed??false} className="mt-1 h-5 w-5"/>I reviewed the original report and verified the company, driver, date and entered findings.</label>
            <div className="flex flex-wrap gap-2"><button type="submit" className={`${button} border-blue-500/60 bg-blue-500/15 text-blue-200`}>{busy?'Saving…':review?'Save reviewed revision':'Save evidence'}</button>{review&&<button type="button" className={button} onClick={()=>setReview(null)}>Cancel review</button>}</div>
          </fieldset></form>
        </details>
      </section>
      <div className="space-y-5">
        <section className={panel}><p className="text-xs font-medium uppercase tracking-widest text-slate-400">Evidence before assessment</p><h2 className="mt-4 text-xl font-semibold">{snapshot?.rating.score!==null&&snapshot?.rating.score!==undefined?`Internal rating: ${snapshot.rating.score}`:'Safety rating: Not rated'}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{snapshot?.rating.state==='RATED'?'Calculated only from current, reviewed reports in the configured date window. This is not a complete driving-history assessment.':'Awaiting inspection history and an approved scoring policy. Missing history is not evidence of safe driving.'}</p><dl className="mt-5 space-y-3 border-t border-slate-700 pt-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-400">Inspection evidence</dt><dd>{!snapshot?'Not loaded':snapshot.rating.state==='EVIDENCE_PENDING'?'Missing or unreviewed':current.length?'Available for review':'Pending'}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-400">Scoring policy</dt><dd>{policy?.enabled?policy.label:'Not configured / disabled'}</dd></div></dl><p className="mt-4 text-xs leading-5 text-slate-400">No official score or hiring recommendation. A missing rating is not a negative rating.</p>
          {policy&&<details className="mt-4 text-sm"><summary className="cursor-pointer py-2 text-blue-200">Calculation &amp; policy version</summary><p className="mt-2 leading-6 text-slate-400">Start at {policy.maximum}. Subtract {policy.violationPenalty} per violation and {policy.outOfServicePenalty} per out-of-service report. Floor: {policy.minimum}. Only {policy.windowStart} through {policy.windowEnd} (inclusive). Every current report in that window must be reviewed with known outcomes; at least one is required.</p><p className="mt-2 break-all text-xs text-slate-400">Version {policy.id}</p></details>}
          {snapshot?.canConfigurePolicy&&<details className="mt-4 border-t border-slate-700 pt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-blue-200">Configure company rating policy</summary><p className="mb-4 text-xs leading-5 text-slate-400">Owner-only. No recommended weights are supplied. Saving creates a retained version for the entire selected company, not just this driver. Explicitly enable it only after review.</p><form key={policy?.id??'no-policy'} onSubmit={savePolicy}><fieldset disabled={busy||!!error} className="space-y-4 disabled:opacity-50"><label className={label}>Policy name<input name="label" required maxLength={160} defaultValue={policy?.label??''} className={input}/></label>{([['maximum','Starting score'],['minimum','Minimum score'],['violationPenalty','Penalty per violation'],['outOfServicePenalty','Penalty per out-of-service report']] as const).map(([name,title])=><label key={name} className={label}>{title}<input name={name} required type="number" min={0} max={100000} step="any" defaultValue={policy?.[name]??''} className={input}/></label>)}<label className={label}>Window start<input name="windowStart" type="date" required defaultValue={policy?.windowStart??''} className={input}/></label><label className={label}>Window end<input name="windowEnd" type="date" required defaultValue={policy?.windowEnd??''} className={input}/></label><label className="flex items-start gap-3 text-sm leading-6"><input name="enabled" type="checkbox" defaultChecked={policy?.enabled??false} className="mt-1 h-5 w-5"/>Enable this explicitly reviewed internal policy for this company.</label><button className={button} type="submit">Save policy version</button></fieldset></form><ul className="mt-4 space-y-2 text-xs text-slate-400">{snapshot.policyVersions.map(version=><li key={version.id}>{version.label} · {version.enabled?'Enabled':'Disabled'} · {version.createdAt}</li>)}</ul></details>}
        </section>
        <section className={panel}><h2 className="font-semibold">Profile photo</h2><p className="mt-2 text-sm leading-6 text-slate-400">Upload a supplied portrait—not a license crop. Stored privately, separate from imported source evidence.</p>{snapshot?.photoVersion&&!photoFailed?<img src={`${endpoint}/photo?v=${snapshot.photoVersion}`} alt="Supplied driver profile photo" className="mt-4 h-24 w-24 rounded-xl object-cover" onError={()=>setPhotoFailed(true)}/>:<p className="mt-4 text-sm text-slate-400">{photoFailed?'Photo unavailable. Reload to check its status.':'Photo not supplied'}</p>}<form className="mt-4" onSubmit={async event=>{event.preventDefault();const file=new FormData(event.currentTarget).get('photo');if(file instanceof File&&file.size)await mutate(`${endpoint}/photo`,{method:'PUT',headers:{'content-type':file.type},body:file});}}><fieldset disabled={!snapshot||busy||!!error} className="space-y-3 disabled:opacity-50"><label className={label}>JPEG, PNG or WebP · up to 5 MB<input name="photo" type="file" required accept="image/jpeg,image/png,image/webp" className="mt-2 block min-h-11 w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-3 file:text-slate-100"/></label><button className={button} type="submit">{snapshot?.photoVersion?'Replace photo':'Upload photo'}</button>{snapshot?.photoVersion&&<button className={`${button} ml-2`} type="button" onClick={()=>{if(window.confirm('Remove this supplied profile photo?'))void mutate(`${endpoint}/photo`,{method:'DELETE'});}}>Remove photo</button>}</fieldset></form></section>
      </div>
    </div>
  </div>;
}
