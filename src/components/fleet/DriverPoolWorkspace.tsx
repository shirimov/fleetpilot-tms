'use client';
/* eslint-disable @next/next/no-img-element -- Private photos use the viewer's authorized request, not an image-optimization proxy. */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import DriverSafetyPanel from './DriverSafetyPanel';
import DriverPerformancePanel from './DriverPerformancePanel';
import type { DriverPoolService } from '@/lib/fleet/driver-pool-service';

type Pool = Omit<Awaited<ReturnType<DriverPoolService['list']>>, 'search'> & { search?: string };
type Detail = Awaited<ReturnType<DriverPoolService['detail']>>;
type Identity = { id?: string; photoVersion?: string | null; fullName: string | null; firstName: string | null; lastName: string | null };
const panel = 'rounded-2xl border border-slate-700/70 bg-[var(--alpha-panel)]';
const control = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-200 hover:border-slate-400 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400';
const displayName = (driver: Identity) => driver.fullName || [driver.firstName, driver.lastName].filter(Boolean).join(' ') || 'Name not recorded';
const ratingLabel=(driver:{internalRating?:number|null;safetyDataUnavailable?:boolean})=>driver.safetyDataUnavailable?'Unavailable':driver.internalRating==null?'Not rated':`Internal · ${driver.internalRating}`;
const filters = [['ALL', 'All drivers'], ['active', 'Active'], ['terminated', 'Former'], ['invited', 'Invited'], ['UNKNOWN', 'Unknown']] as const;
function poolHref(page: number, status: string, search = '') {
  return `/drivers/pool?${new URLSearchParams({ page: String(page), status, ...(search ? { q: search } : {}) })}`;
}

export function DriverIdentityAvatar({ driver, large = false }: { driver: Identity; large?: boolean }) {
  const name = displayName(driver);
  const [version,setVersion]=useState(driver.photoVersion);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const update=(event:Event)=>{const detail=(event as CustomEvent<{driverId:string;photoVersion:string|null}>).detail;if(detail.driverId===driver.id){setVersion(detail.photoVersion);setFailed(false);}};
    window.addEventListener('driver-safety-updated',update);return ()=>window.removeEventListener('driver-safety-updated',update);
  },[driver.id]);
  const initials = name === 'Name not recorded' ? '?' : name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase();
  if(version&&driver.id&&!failed) return <img src={`/api/drivers/pool/${encodeURIComponent(driver.id)}/photo?v=${encodeURIComponent(version)}`} alt={`${name} supplied profile photo`} className={`shrink-0 rounded-2xl border border-slate-600/60 object-cover ${large?'h-24 w-24':'h-14 w-14'}`} onError={()=>setFailed(true)}/>;
  return <div role="img" aria-label={`${name}: ${failed?'photo unavailable':'photo not supplied'}, initials shown`} className={`grid shrink-0 place-items-center rounded-2xl border border-slate-600/60 bg-slate-800 font-semibold tracking-wide text-slate-300 ${large ? 'h-24 w-24 text-3xl' : 'h-14 w-14 text-lg'}`}>{initials}</div>;
}

function Lifecycle({ status }: { status: string }) {
  const label = filters.find(([value]) => value === status)?.[1] ?? status;
  return <span title={`Source lifecycle: ${status}`} className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${status === 'active' ? 'border-emerald-800 bg-emerald-950/50 text-emerald-200' : 'border-slate-600 bg-slate-800/60 text-slate-300'}`}>{label === 'Unknown' ? 'Status unknown' : label}</span>;
}

export function DriverPoolList({ result }: { result: Pool }) {
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const search = result.search ?? '';
  return <>
    <section aria-label="Find drivers" className={`${panel} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form action="/drivers/pool" method="get" className="w-full sm:max-w-lg">
          <label htmlFor="driver-search" className="mb-2 block text-sm font-medium text-slate-200">Search drivers</label>
          <div className="flex gap-2"><input key={search} id="driver-search" name="q" type="search" defaultValue={search} maxLength={120} placeholder="Search by name in this company…" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950/70 px-3 text-sm text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-400" /><input type="hidden" name="status" value={result.status} /><button className={`${control} bg-slate-800`} type="submit">Search</button></div>
        </form>
        <div role="group" aria-label="Roster view" className="flex gap-1 rounded-xl bg-slate-950/60 p-1">{(['cards', 'table'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={`${control} ${view === mode ? 'border-slate-500 bg-slate-700 text-white' : 'border-transparent'}`}>{mode === 'cards' ? 'Cards' : 'Table'}</button>)}</div>
      </div>
      <nav aria-label="Lifecycle filters" className="mt-5 flex flex-wrap gap-2 border-t border-slate-700/70 pt-4">{filters.map(([status, label]) => <Link prefetch={false} key={status} href={poolHref(1, status, search)} aria-current={result.status === status ? 'page' : undefined} className={`${control} ${result.status === status ? 'border-blue-400/60 bg-blue-500/15 text-blue-200' : 'border-transparent'}`}>{label}</Link>)}</nav>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p role="status" className="text-slate-300">{result.drivers.length} {result.drivers.length === 1 ? 'driver' : 'drivers'} on this page{search && <> matching <strong className="text-slate-100">“{search}”</strong></>}</p><span className="text-slate-400">Ratings await verified evidence</span></div>
    {result.drivers.length === 0 ? <section className={`${panel} px-6 py-12 text-center`}><h2 className="text-lg font-semibold">{search ? 'No matching drivers' : result.page > 1 ? 'No drivers on this page' : 'No drivers in this view'}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">Try another name or lifecycle filter. This view only includes records available to your selected company.</p><Link prefetch={false} href="/drivers/pool" className={`${control} mt-5`}>Reset filters</Link></section> : view === 'cards' ?
      <ul aria-label="Company driver roster" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{result.drivers.map(driver => <li key={driver.id} className={`${panel} flex flex-col p-5`}>
        <div className="flex items-start gap-4"><DriverIdentityAvatar driver={driver} /><div className="min-w-0 flex-1"><h2 className="break-words text-base font-semibold leading-6"><Link prefetch={false} href={`/drivers/pool/${encodeURIComponent(driver.id)}`} className="rounded text-slate-100 hover:text-blue-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400">{displayName(driver)}</Link></h2><p className="mt-1 text-xs text-slate-400">{driver.id.startsWith('source:') ? 'Source-backed profile' : 'FleetPilot driver'}</p></div></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><Lifecycle status={driver.employmentStatus} /><span className="text-xs text-slate-400">{driver.photoVersion?'Private photo':'Photo not supplied'}</span></div>
        <div className="mt-5 flex items-center justify-between border-t border-slate-700/70 pt-4"><span className="text-xs text-slate-400">Safety rating</span><span className="text-sm font-medium text-slate-300">{ratingLabel(driver)}</span></div>
      </li>)}</ul> :
      <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Selected company driver pool</caption><thead className="border-b border-slate-700 text-xs text-slate-400"><tr><th scope="col" className="px-5 py-4">Driver</th><th scope="col" className="px-5 py-4">Source lifecycle</th><th scope="col" className="px-5 py-4">Safety rating</th></tr></thead><tbody className="divide-y divide-slate-700/60">{result.drivers.map(driver => <tr key={driver.id} className="hover:bg-slate-800/40"><td className="px-5 py-4"><div className="flex items-center gap-3"><DriverIdentityAvatar driver={driver} /><Link prefetch={false} href={`/drivers/pool/${encodeURIComponent(driver.id)}`} className="rounded font-medium text-slate-100 hover:text-blue-300 focus-visible:outline-2 focus-visible:outline-blue-400">{displayName(driver)}</Link></div></td><td className="px-5 py-4"><Lifecycle status={driver.employmentStatus} /></td><td className="px-5 py-4 text-slate-300">{ratingLabel(driver)}</td></tr>)}</tbody></table></div>}
    <nav aria-label="Pool pages" className="flex items-center justify-between gap-3"><div>{result.page > 1 && <Link prefetch={false} className={control} href={poolHref(result.page - 1, result.status, search)}>Previous</Link>}</div><span className="text-sm text-slate-400">Page {result.page}</span><div>{result.hasMore && <Link prefetch={false} className={control} href={poolHref(result.page + 1, result.status, search)}>Next</Link>}</div></nav>
    <p className="text-xs leading-5 text-slate-400">Lifecycle reflects the captured source, not recent loads or truck assignments. Former means source status “terminated”; legacy Driver lifecycle remains unknown. No people are merged by name.</p>
  </>;
}

export function DriverPoolDetail({ driver }: { driver: Detail }) {
  const configuredPay = driver.id.startsWith('driver:');
  return <>
    <Link prefetch={false} className={`${control} w-fit`} href="/drivers/pool"><span aria-hidden="true" className="mr-2">←</span>Back to pool</Link>
    <section className={`${panel} p-5 sm:p-7`} aria-label="Driver profile">
      <div className="flex flex-wrap items-center gap-5"><DriverIdentityAvatar driver={driver} large /><div className="min-w-0 flex-1"><p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-400">{configuredPay ? 'FleetPilot driver' : 'Source-backed profile'}</p><h2 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{displayName(driver)}</h2><div className="mt-3 flex flex-wrap items-center gap-3"><Lifecycle status={driver.employmentStatus} /><span className="text-xs text-slate-400">Private portrait managed below</span></div></div></div>
      <dl className="mt-6 grid gap-5 border-t border-slate-700/70 pt-5 sm:grid-cols-2">{[['Phone', driver.phone], ['Email', driver.email]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm text-slate-200">{value || 'Not recorded'}</dd></div>)}</dl>
    </section>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
      <div className="space-y-5">
        <section className={`${panel} p-5 sm:p-6`}><h2 className="text-base font-semibold">Employment record</h2><p className="mt-1 text-sm text-slate-400">Dates are retained exactly as supplied by the source.</p><dl className="mt-5 divide-y divide-slate-700/60">{[['Employment status', driver.employmentStatus], ['Hire date · source string', driver.hireDate], ['Termination date · source string', driver.terminationDate], ['Rehire date · source string', driver.rehireDate]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><dt className="text-slate-400">{label}</dt><dd className="break-words text-slate-200">{value || 'Not recorded'}</dd></div>)}</dl></section>

      </div>
      <div className="space-y-5">

        {driver.compensation && <section className={`${panel} p-5 sm:p-6`}><h2 className="text-base font-semibold">{configuredPay ? 'Configured settlement pay' : 'Source compensation'} <span className="mt-1 block text-xs font-normal text-slate-400">restricted HR access</span></h2><div className="mt-4 space-y-3 text-sm text-slate-200"><p>{configuredPay ? 'Configured type' : 'Source type'}: {driver.compensation.type}</p><p>{driver.compensation.amount === null ? 'Amount not recorded' : `${configuredPay ? 'Configured rate' : 'Source amount'}: ${driver.compensation.amount}`}</p><p>Frequency: {driver.compensation.frequency || 'Not recorded'}</p><p>Currency: {driver.compensation.currency || 'Not recorded'}</p></div><p className="mt-4 border-t border-slate-700/70 pt-4 text-xs leading-5 text-slate-400">{configuredPay ? 'Existing Driver settlement configuration, shown without conversion. This is not Employee salary; the import does not change it.' : 'Provider codes and amounts are evidence, not a salary or configured settlement pay. No settlement rate is created by this import.'}</p></section>}
      </div>
    </div>
    <DriverSafetyPanel driverId={driver.id} />
    <DriverPerformancePanel key={driver.id} driverId={driver.id} />
  </>;
}

export default function DriverPoolWorkspace({ driverId, page = '1', status = 'ALL', search = '' }: { driverId?: string; page?: string; status?: string; search?: string }) {
  const [result, setResult] = useState<{ key: string; pool?: Pool; driver?: Detail; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const endpoint = driverId ? `/api/drivers/pool/${encodeURIComponent(driverId)}` : `/api/drivers/pool?${new URLSearchParams({ page, status, q: search })}`;
  const key = `${endpoint}:${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 403 ? 'You do not have access to this company’s driver pool.' : response.status === 404 ? 'This driver is not available in your selected company.' : 'Unable to load driver records. Please retry.');
      return response.json();
    }).then(data => { if (!controller.signal.aborted) setResult(driverId ? { key, driver: data } : { key, pool: data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : 'Unable to load driver records.' }); });
    return () => controller.abort();
  }, [endpoint, key, driverId]);
  const current = result?.key === key ? result : null;
  return <main className="alpha-page space-y-5 text-slate-100" style={{ maxWidth: 1440 }}>
    <header className="flex flex-wrap items-start justify-between gap-4 pb-1"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-300">Safety / People</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{driverId ? 'Driver profile' : 'Driver pool'}</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">{driverId ? 'Inspect the source record, employment history and safety evidence.' : 'Explore your roster. Review the evidence behind each driver.'}</p></div><span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">Selected company only</span></header>
    {!current && <section role="status" aria-live="polite" className={`${panel} p-6`}><p className="text-sm text-slate-300">Loading driver records…</p><div aria-hidden="true" className="mt-5 grid gap-4 md:grid-cols-3">{[1, 2, 3].map(item => <div key={item} className="h-32 rounded-xl bg-slate-800/70" />)}</div></section>}
    {current?.error && <section role="alert" className={`${panel} p-6`}><h2 className="font-semibold">Driver records unavailable</h2><p className="mt-2 text-sm text-slate-300">{current.error}</p><button type="button" className={`${control} mt-4`} onClick={() => setAttempt(value => value + 1)}>Retry</button></section>}
    {current?.pool && <DriverPoolList key={endpoint} result={current.pool} />}
    {current?.driver && <DriverPoolDetail key={driverId} driver={current.driver} />}
  </main>;
}
