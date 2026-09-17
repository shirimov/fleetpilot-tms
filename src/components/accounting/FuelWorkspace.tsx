'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PilotImportWorkspace from './PilotImportWorkspace';
import { formatMinorUnitsDecimal } from '@/lib/finance/money';
import type { FuelReadService } from '@/lib/finance/fuel-read-service';
type Fuel = Awaited<ReturnType<FuelReadService['overview']>>;
type Row = Record<string, unknown>;
const money = (value: string) => `$${formatMinorUnitsDecimal(BigInt(value))}`;
const products = [['TRUCK_DIESEL', 'Truck Diesel'], ['REEFER_FUEL', 'Reefer Fuel'], ['DEF', 'DEF']];
export default function FuelWorkspace({ sources, categories, trucks }: { sources: Row[]; categories: Row[]; trucks: Row[] }) {
  const params = useSearchParams();
  const section = ['invoices', 'by-truck', 'imports'].includes(params.get('section') ?? '') ? params.get('section')! : 'overview';
  const page = params.get('page') ?? '1';
  const [data, setData] = useState<Fuel | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    if (!['overview', 'by-truck'].includes(section)) return;
    const controller = new AbortController();
    fetch(`/api/finance/fuel?page=${page}`, { signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [section, page]);
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Fuel</h2><a href="/accounting?view=fuel&section=imports" className="btn">Import Pilot XLS</a></div>
    <nav aria-label="Fuel sections" className="flex flex-wrap gap-2">{[['overview','Overview'],['invoices','Invoices'],['by-truck','By Truck'],['imports','Imports']].map(([key,label]) => <button aria-current={section === key ? 'page' : undefined} className={`rounded-lg px-3 py-2 ${section === key ? 'bg-emerald-700' : 'bg-slate-800'}`} key={key} onClick={() => window.history.pushState(null, '', `/accounting?view=fuel&section=${key}`)}>{label}</button>)}</nav>
    {error && <p role="alert">{error}</p>}
    {['invoices','imports'].includes(section) ? <PilotImportWorkspace mode={section as 'invoices' | 'imports'} selectedId={params.get('invoice') ?? undefined} sources={sources} categories={categories} trucks={trucks} /> : !data ? <p>Loading posted fuel activity…</p> : section === 'overview' ? <>
      <p className="text-sm text-slate-400">All posted Pilot invoices · Source purchase dates are preserved · Provider adjustments remain separate from Truck expense.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Net expense',money(data.netExpenseMinor)],['Posted invoices',data.invoices],['Fueling events',data.events],['Canonical Trucks',data.trucks]].map(([label,value]) => <article key={label} className="rounded-xl bg-slate-900 p-4"><p>{label}</p><strong className="text-2xl">{value}</strong></article>)}</div>
      <div className="grid gap-3 sm:grid-cols-3">{products.map(([key,label]) => <article className="rounded-xl bg-slate-900 p-4" key={key}><h3>{label}</h3><strong>{money(data.products[key]?.amountMinor ?? '0')}</strong><p className="text-sm text-slate-400">Quantity {data.products[key]?.quantity ?? '0.00'}</p></article>)}</div>
      <p>Provider adjustments / credits: {money(data.adjustmentsMinor)}</p><p>Payments settled: {data.settled} / {data.invoices}</p><a className="text-emerald-300" href="/accounting?view=settings&section=fuel-rules">Fuel product rules</a>
    </> : <><p>Posted Pilot expense by canonical Truck. Provider-level credits are excluded.</p><div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full text-left text-sm"><thead><tr>{['Truck','Company','Events',...products.map(([,name]) => `${name} quantity / amount`),'Total Pilot expense'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{data.byTruck.rows.map(row => <tr className="border-t border-white/10" key={row.id}><td className="p-3">{row.unitNumber}<small className="block">{row.status}</small></td><td className="p-3">{row.company}</td><td className="p-3">{row.events}</td>{products.map(([key]) => <td className="p-3" key={key}>{row.products[key]?.quantity ?? '0.00'}<br />{money(row.products[key]?.amountMinor ?? '0')}</td>)}<td className="p-3">{money(row.amountMinor)}</td></tr>)}</tbody></table></div><div className="flex gap-3"><button disabled={data.byTruck.page === 1} onClick={() => window.history.pushState(null, '', `/accounting?view=fuel&section=by-truck&page=${data.byTruck.page-1}`)}>Previous</button><span>Page {data.byTruck.page} · {data.byTruck.total} Trucks</span><button disabled={data.byTruck.page*25 >= data.byTruck.total} onClick={() => window.history.pushState(null, '', `/accounting?view=fuel&section=by-truck&page=${data.byTruck.page+1}`)}>Next</button></div></>}
  </section>;
}
