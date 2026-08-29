'use client';

import { useMemo, useState } from 'react';

type Resource = 'trucks' | 'trailers' | 'drivers' | 'customers' | 'trips' | 'users' | 'reports';
type ExplorerResponse = {
  resource: string;
  fetchedAt: string;
  items?: Array<Record<string, unknown>>;
  item?: unknown;
  total?: number | null;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  warning?: string | null;
  links?: Record<string, { linked: true; entityId?: string | null }>;
  audit?: FinancialAudit;
};
type FinancialAudit = {
  reportType: string;
  interpretation: 'PARTIALLY_VERIFIED' | 'UNVERIFIED';
  columns: Array<{ cid: string; name: string; description: string | null; systemName: string | null; groupName: string | null; dataType: string | null; currency: string | null; decimalScale: number | null; unit: string | null; aggregation: string | null; signSemantics: string | null }>;
  rowCount: number;
  suppliedSummaryPresent: boolean;
  exactTotals: Array<{ column: string; currency: string | null; scale: number; calculated: string; supplied: string | null; matches: boolean | null }>;
  relationshipColumns: Array<{ column: string; resource: string }>;
  relationshipReferences: Array<{ column: string; resource: string; externalId: string; rowIndexes: number[] }>;
  findings: Array<{ severity: 'INFO' | 'WARNING' | 'ERROR'; code: string; message: string; rowIndexes?: number[]; column?: string }>;
};

const resources: Array<{ id: Resource; label: string }> = [
  { id: 'trucks', label: 'Trucks' }, { id: 'trailers', label: 'Trailers' },
  { id: 'drivers', label: 'Drivers' }, { id: 'customers', label: 'Customers' },
  { id: 'trips', label: 'Trips / Loads' }, { id: 'users', label: 'Users' },
  { id: 'reports', label: 'Financial Reports / Audit' },
];
const reportTypes = [
  ['trip', 'Trip'], ['fuel', 'Fuel'], ['toll', 'Tolls'], ['statement', 'Statements'], ['receivable', 'Receivables'],
  ['1099', '1099'], ['adjustment', 'Adjustments'], ['maintenance', 'Maintenance'], ['inspection', 'Inspections'],
  ['account-resource-employee', 'Account Resource · Employee'], ['account-resource-site-user', 'Account Resource · Site User'],
  ['account-resource-equipment', 'Account Resource · Equipment'], ['account-resource-address', 'Account Resource · Address'],
  ['account-resource-vendor', 'Account Resource · Vendor'], ['account-resource-customer', 'Account Resource · Customer'],
  ['account-resource-attachment', 'Account Resource · Attachment'], ['driver-perf', 'Driver Performance'],
] as const;
const filters: Record<Resource, Array<{ field: string; label: string; operator?: string }>> = {
  trucks: [{ field: 'unit_number', label: 'Unit' }, { field: 'vin', label: 'VIN' }, { field: 'plate_number', label: 'Plate' }, { field: 'id', label: 'QuickManage ID', operator: 'eq' }],
  trailers: [{ field: 'unit_number', label: 'Unit' }, { field: 'vin', label: 'VIN' }, { field: 'plate_number', label: 'Plate' }, { field: 'id', label: 'QuickManage ID', operator: 'eq' }],
  drivers: [{ field: 'first_name', label: 'First name' }, { field: 'last_name', label: 'Last name' }, { field: 'email', label: 'Email' }, { field: 'status', label: 'Status' }, { field: 'id', label: 'QuickManage ID', operator: 'eq' }],
  customers: [{ field: 'name', label: 'Name' }, { field: 'mc_number', label: 'MC number' }, { field: 'status', label: 'Status' }, { field: 'id', label: 'QuickManage ID', operator: 'eq' }],
  trips: [{ field: 'ref_number', label: 'Reference', operator: 'eq' }, { field: 'number', label: 'Trip number', operator: 'eq' }, { field: 'status', label: 'Status', operator: 'eq' }, { field: 'schedule_date', label: 'Schedule date', operator: 'date_is_on' }, { field: 'assigned_truck_ids', label: 'Truck ID', operator: 'in' }, { field: 'assigned_driver_ids', label: 'Driver ID', operator: 'in' }, { field: 'assigned_trailer_ids', label: 'Trailer ID', operator: 'in' }, { field: 'assigned_customer_ids', label: 'Customer ID', operator: 'in' }, { field: 'id', label: 'QuickManage ID', operator: 'eq' }],
  users: [{ field: 'first_name', label: 'First name' }, { field: 'last_name', label: 'Last name' }, { field: 'email', label: 'Email' }, { field: 'role', label: 'Role' }, { field: 'status', label: 'Status' }, { field: 'id', label: 'QuickManage ID', operator: 'eq' }],
  reports: [],
};

const display = (value: unknown) => value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const titleFor = (record: Record<string, unknown>) => display(record.unit ?? record.trip_num ?? record.number ?? record.name ?? [record.first_name, record.last_name].filter(Boolean).join(' ') ?? record.id);
const reverseTripFilter: Partial<Record<Resource, string>> = {
  trucks: 'assigned_truck_ids', trailers: 'assigned_trailer_ids', drivers: 'assigned_driver_ids', customers: 'assigned_customer_ids',
};
function tripRelationships(record: Record<string, unknown>) {
  const stops = Array.isArray(record.stops) ? record.stops : [];
  const relationships: Array<{ resource: Resource; field: string; id: string; label: string }> = [];
  const add = (resource: Resource, field: string, value: unknown, label: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string') relationships.push({ resource, field, id: String((value as { id: string }).id), label });
  };
  add('customers', 'id', record.customer_id ? { id: record.customer_id } : null, 'Customer');
  for (const rawStop of stops) {
    if (!rawStop || typeof rawStop !== 'object' || Array.isArray(rawStop)) continue;
    const stop = rawStop as Record<string, unknown>;
    add('trucks', 'id', stop.assigned_truck, 'Truck'); add('trailers', 'id', stop.assigned_trailer, 'Trailer'); add('customers', 'id', stop.assigned_customer, 'Customer');
    for (const driver of Array.isArray(stop.assigned_drivers) ? stop.assigned_drivers : []) add('drivers', 'id', driver, 'Driver');
  }
  return [...new Map(relationships.map((entry) => [`${entry.resource}:${entry.id}`, entry])).values()];
}

export default function QuickManageExplorer() {
  const [resource, setResource] = useState<Resource>('trucks');
  const [filterField, setFilterField] = useState(filters.trucks[0].field);
  const [filterValue, setFilterValue] = useState('');
  const [reportType, setReportType] = useState('trip');
  const [reportSubtype, setReportSubtype] = useState('');
  const [result, setResult] = useState<ExplorerResponse | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [selectedReport, setSelectedReport] = useState<Record<string, unknown> | null>(null);
  const [audit, setAudit] = useState<FinancialAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const activeFilter = useMemo(() => filters[resource].find((entry) => entry.field === filterField) ?? filters[resource][0], [filterField, resource]);

  async function load(page = 0, explicitResource: Resource = resource, relationship?: { field: string; value: string }) {
    setLoading(true); setError(''); setSelected(null); setSelectedReport(null); setAudit(null);
    try {
      const params = new URLSearchParams({ resource: explicitResource, page: String(page), pageSize: '20' });
      if (explicitResource === 'reports') { params.set('reportType', reportType); params.set('reportSubtype', reportSubtype || 'ignore'); }
      else {
        const field = relationship?.field ?? filterField;
        const value = relationship?.value ?? filterValue.trim();
        const definition = filters[explicitResource].find((entry) => entry.field === field);
        if (value && definition) { params.set('field', field); params.set('operator', definition.operator ?? 'match'); params.set('value', value); }
      }
      const response = await fetch(`/api/integrations/quickmanage/explorer?${params}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'QuickManage request failed.');
      setResource(explicitResource); setFilterField(filters[explicitResource][0]?.field ?? ''); setFilterValue(''); setResult(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'QuickManage request failed.'); }
    finally { setLoading(false); }
  }

  async function openReport(record: Record<string, unknown>) {
    if (typeof record.id !== 'string') return;
    const type = typeof record.type === 'string' ? record.type : reportType;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ resource: 'report-content', id: record.id, reportType: type });
      const response = await fetch(`/api/integrations/quickmanage/explorer?${params}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Report content request failed.');
      setSelected(body.item as Record<string, unknown>);
      setSelectedReport(record);
      setAudit(body.audit as FinancialAudit);
      setResult((current) => current ? { ...current, links: body.links ?? {} } : current);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Report content request failed.'); }
    finally { setLoading(false); }
  }

  function chooseResource(next: Resource) {
    setResource(next); setFilterField(filters[next][0]?.field ?? ''); setFilterValue(''); setResult(null); setSelected(null); setSelectedReport(null); setAudit(null); setError('');
  }

  const rows = result?.items ?? [];
  return (
    <section className="mt-8 border-t border-gray-800 pt-8" aria-labelledby="quickmanage-explorer-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="quickmanage-explorer-heading" className="text-xl font-semibold">QuickManage Data Explorer</h2><p className="mt-1 text-sm text-gray-400">Live, read-only data. Nothing shown here is imported automatically.</p></div>
        {result?.fetchedAt && <p className="text-xs text-gray-500">Fetched from QuickManage: {new Date(result.fetchedAt).toLocaleString()}</p>}
      </div>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="QuickManage resources">
        {resources.map((entry) => <button key={entry.id} type="button" onClick={() => chooseResource(entry.id)} className={`rounded-full px-3 py-1.5 text-sm ${resource === entry.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>{entry.label}</button>)}
      </nav>
      {resource === 'reports' && <div className="mt-4 rounded-lg border border-blue-950 bg-blue-950/20 p-4"><h3 className="font-semibold">Financial Reports / Audit</h3><p className="mt-1 text-sm text-gray-400">Previously generated QuickManage reports, fetched on demand. Vendor semantics stay marked unverified until official metadata or representative data proves them.</p></div>}
      <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-gray-800 bg-gray-950 p-4">
        {resource === 'reports' ? <><label className="text-sm text-gray-400">Type<select aria-label="Financial report type" value={reportType} onChange={(event) => setReportType(event.target.value)} className="ml-2 rounded border border-gray-700 bg-gray-900 p-2 text-white">{reportTypes.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label><label className="text-sm text-gray-400">Subtype<input value={reportSubtype} onChange={(event) => setReportSubtype(event.target.value)} placeholder="ignore" className="ml-2 rounded border border-gray-700 bg-gray-900 p-2 text-white" /></label></> : <><select aria-label="QuickManage filter" value={filterField} onChange={(event) => setFilterField(event.target.value)} className="rounded border border-gray-700 bg-gray-900 p-2 text-sm">{filters[resource].map((entry) => <option key={entry.field} value={entry.field}>{entry.label}</option>)}</select><input aria-label={activeFilter?.label ?? 'Search'} value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder={`Filter by ${activeFilter?.label ?? 'value'}`} className="min-w-56 rounded border border-gray-700 bg-gray-900 p-2 text-sm" /></>}
        <button type="button" onClick={() => void load(0)} disabled={loading} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold disabled:bg-gray-700">{loading ? 'Loading…' : result ? 'Refresh' : 'Fetch live data'}</button>
      </div>
      {error && <p role="alert" className="mt-4 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {result?.warning && <p className="mt-4 rounded border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">{result.warning}</p>}
      {result && <div className="mt-4 flex items-center justify-between text-sm text-gray-400"><span>{result.total == null ? `${rows.length} on this report page` : `${rows.length} shown · ${result.total} available`}</span><div className="flex gap-2"><button type="button" disabled={!result.page} onClick={() => void load((result.page ?? 0) - 1)} className="rounded border border-gray-700 px-3 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={result.hasMore === false || (result.total != null && ((result.page ?? 0) + 1) * (result.pageSize ?? 20) >= result.total)} onClick={() => void load((result.page ?? 0) + 1)} className="rounded border border-gray-700 px-3 py-1 disabled:opacity-40">Next</button></div></div>}
      {result && rows.length === 0 && <p className="mt-4 rounded border border-gray-800 p-4 text-sm text-gray-400">QuickManage returned no records for this request.</p>}
      {rows.length > 0 && <div className="mt-4 grid gap-3 lg:grid-cols-2">{rows.map((record, index) => { const id = typeof record.id === 'string' ? record.id : String(index); const linked = result?.links?.[id]; return <article key={id} className="rounded-lg border border-gray-800 bg-gray-950 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{titleFor(record)}</h3><p className="mt-1 font-mono text-xs text-gray-500">{id}</p></div><span className={`text-xs ${linked ? 'text-green-300' : 'text-gray-500'}`}>{linked ? 'Linked to FleetPilot' : 'Not imported / not linked'}</span></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">{Object.entries(record).filter(([key, value]) => key !== 'id' && typeof value !== 'object').slice(0, 8).map(([key, value]) => <div key={key} className="contents"><dt className="text-gray-500">{key}</dt><dd className="truncate">{display(value)}</dd></div>)}</dl><button type="button" onClick={() => resource === 'reports' ? void openReport(record) : setSelected(record)} className="mt-3 text-sm font-semibold text-blue-300 hover:text-blue-200">View details</button></article>; })}</div>}
      {selected && <div className="mt-5 rounded-lg border border-blue-900 bg-gray-950 p-4"><div className="flex justify-between"><h3 className="font-semibold">{resource === 'reports' ? 'QuickManage financial report detail' : 'Live QuickManage detail'}</h3><button type="button" onClick={() => { setSelected(null); setSelectedReport(null); setAudit(null); }} className="text-sm text-gray-400">Close</button></div>{resource === 'reports' && selectedReport && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{['id', 'type', 'subtype', 'number', 'start_date', 'end_date', 'created_at', 'updated_at'].map((key) => selectedReport[key] == null ? null : <div key={key}><dt className="text-gray-500">{key}</dt><dd>{display(selectedReport[key])}</dd></div>)}</dl>}{reverseTripFilter[resource] && typeof selected.id === 'string' && <button type="button" onClick={() => void load(0, 'trips', { field: reverseTripFilter[resource]!, value: String(selected.id) })} className="mt-3 rounded border border-blue-800 px-2 py-1 text-xs text-blue-300">Find related Trips</button>}{resource === 'trips' && tripRelationships(selected).length > 0 && <div className="mt-3 flex flex-wrap gap-2"><span className="text-sm text-gray-400">Related:</span>{tripRelationships(selected).map((entry) => <button key={`${entry.resource}:${entry.id}`} type="button" onClick={() => void load(0, entry.resource, { field: entry.field, value: entry.id })} className="rounded border border-blue-800 px-2 py-1 text-xs text-blue-300">{entry.label}</button>)}</div>}{resource === 'reports' && audit && <div className="mt-4 space-y-4"><div className="rounded border border-amber-900 bg-amber-950/20 p-3"><p className="font-semibold">{audit.interpretation === 'UNVERIFIED' ? 'QuickManage semantics not yet verified' : 'QuickManage semantics partially verified'}</p><p className="mt-1 text-sm text-gray-400">{audit.rowCount} rows · {audit.columns.length} dynamic columns · supplied structured summary: {audit.suppliedSummaryPresent ? 'yes' : 'no'}</p></div><div><h4 className="text-sm font-semibold">Column definitions</h4><div className="mt-2 overflow-auto"><table className="w-full min-w-[48rem] text-left text-xs"><thead className="text-gray-500"><tr><th className="p-2">Column</th><th className="p-2">Provider field</th><th className="p-2">Type / unit / scale</th><th className="p-2">Sign</th></tr></thead><tbody>{audit.columns.map((column) => <tr key={column.cid} className="border-t border-gray-800"><td className="p-2">{column.name}</td><td className="p-2">{column.systemName ?? '—'}</td><td className="p-2">{[column.dataType, column.unit, column.decimalScale == null ? null : `scale ${column.decimalScale}`, column.aggregation].filter(Boolean).join(' · ') || 'Unspecified'}</td><td className="p-2">{column.signSemantics ?? 'Unknown'}</td></tr>)}</tbody></table></div></div>{audit.relationshipReferences.length > 0 && <div><h4 className="text-sm font-semibold">Verified ID relationships</h4><ul className="mt-2 space-y-1 text-sm">{audit.relationshipReferences.map((reference) => <li key={`${reference.resource}:${reference.externalId}`}>{reference.resource} · {reference.externalId} · {result?.links?.[`${reference.resource}:${reference.externalId}`] ? 'linked to FleetPilot' : 'not linked to FleetPilot'}</li>)}</ul></div>}<div><h4 className="text-sm font-semibold">Financial totals</h4>{audit.exactTotals.length === 0 ? <p className="mt-1 text-sm text-gray-400">No safe total calculated. Currency, precision, and sum semantics must be explicit.</p> : <div className="mt-2 space-y-2">{audit.exactTotals.map((total) => <div key={total.column} className="rounded border border-gray-800 p-3 text-sm"><p>{total.column} · {total.currency ?? 'currency unspecified'}</p><p>FleetPilot calculated total: {total.calculated}</p><p>QuickManage supplied total: {total.supplied ?? 'not supplied'}</p></div>)}</div>}</div><div><h4 className="text-sm font-semibold">Audit findings</h4><ul className="mt-2 space-y-2">{audit.findings.map((finding, index) => <li key={`${finding.code}:${index}`} className="rounded border border-gray-800 p-3 text-sm"><span className={finding.severity === 'ERROR' ? 'text-red-300' : finding.severity === 'WARNING' ? 'text-amber-300' : 'text-blue-300'}>{finding.severity}</span> · {finding.message}</li>)}</ul></div></div>}{resource === 'reports' && selected.content != null && typeof selected.content === 'object' && !Array.isArray(selected.content) && Array.isArray((selected.content as { rows?: unknown }).rows) && <div className="mt-4"><h4 className="text-sm font-semibold">Report line items</h4><div className="mt-2 max-h-80 overflow-auto rounded border border-gray-800">{((selected.content as { rows: unknown[] }).rows).map((row, index) => <pre key={index} className="border-b border-gray-800 p-3 text-xs text-gray-300">{JSON.stringify(row, null, 2)}</pre>)}</div></div>}<details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-blue-300">Sanitized raw QuickManage data</summary><pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded bg-black p-3 text-xs text-gray-300">{JSON.stringify(selected, null, 2)}</pre></details></div>}
    </section>
  );
}
