'use client';

import { useEffect, useState } from 'react';

type Status = {
  configured: boolean;
  connectedAccountName: string | null;
  mappedCompanyName: string;
  identityStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';
  applyEnabled: boolean;
  identityMessage: string;
};
type ResourceType = 'TRUCK' | 'TRAILER' | 'DRIVER' | 'CUSTOMER';
type Disposition = 'NEW' | 'MATCHED' | 'UNCHANGED' | 'CONFLICT' | 'INVALID';
type CarrierMapping = { carrierId:string; carrierName:string|null; truckCount:number; companyId:string|null; status:'VERIFIED'|'UNMAPPED' };
type CompanyOption = {id:string;name:string};
type SyncRow = { id: string; resourceType: ResourceType; disposition: Disposition; message: string | null };
type SyncBatch = {
  id: string;
  status: 'PREVIEWED' | 'PARTIALLY_APPLIED' | 'APPLIED';
  totalRows: number;
  newRows: number;
  matchedRows: number;
  unchangedRows: number;
  conflictRows: number;
  invalidRows: number;
  rows: SyncRow[];
  resourceType: 'TRUCK';
  fleetPilotRecordCount: number;
};

export default function QuickManageIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [batch, setBatch] = useState<SyncBatch | null>(null);
  const [carriers, setCarriers] = useState<CarrierMapping[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  useEffect(() => {
    fetch('/api/integrations/quickmanage', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Unable to load integration status.');
        setStatus(body);
      })
      .catch(() => setMessage('Unable to load QuickManage configuration status.'));
    fetch('/api/integrations/quickmanage/mappings',{cache:'no-store'})
      .then(async response => response.ok ? response.json() : {carriers:[],companies:[]})
      .then(body=>{setCarriers(body.carriers);setCompanies(body.companies)}).catch(()=>setCarriers([]));
  }, []);

  async function testConnection() {
    setTesting(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/quickmanage', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Connection test failed.');
      setStatus((current) => current ? { ...current, configured: true } : current);
      setConnected(true);
      setMessage('Connection successful. QuickManage returned a valid access token.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  }

  async function previewSync() {
    setSyncing(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/quickmanage/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceType: 'TRUCK' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Fleet preview failed.');
      setBatch(body);
      setConnected(true);
      setMessage('Fleet preview is ready. No FleetPilot records have been changed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fleet preview failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function applySync() {
    if (!batch || !window.confirm('Apply safe NEW, MATCHED, and UNCHANGED records? Conflicts and invalid records will remain unchanged.')) return;
    setApplying(true);
    setMessage('');
    try {
      const response = await fetch(`/api/integrations/quickmanage/sync/${batch.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceType: 'TRUCK' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Fleet apply failed.');
      setBatch(body);
      setMessage('Safe QuickManage fleet records were applied. Conflicts and invalid records were not changed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fleet apply failed.');
    } finally {
      setApplying(false);
    }
  }

  async function mapCarrier(carrier:CarrierMapping,companyId:string){
    if(!companyId||!window.confirm(`Map ${carrier.carrierName} to the selected FleetPilot company?`)) return;
    const response=await fetch('/api/integrations/quickmanage/mappings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({carrierId:carrier.carrierId,carrierName:carrier.carrierName,companyId})});
    const body=await response.json(); if(!response.ok){setMessage(body.error??'Mapping failed.');return;}
    setCarriers(current=>current.map(item=>item.carrierId===carrier.carrierId?{...item,companyId,status:'VERIFIED'}:item));
    setMessage('Carrier mapping verified. Staged rows were reclassified; Apply was not started.');
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Administration · Integrations</p>
          <h1 className="mt-2 text-2xl font-bold">QuickManage</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-400">
            Test the protected credentials, then fetch a review-only fleet preview. Applying is always explicit and never overwrites conflicts.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm ${status?.configured ? 'bg-green-950 text-green-300' : 'bg-gray-800 text-gray-300'}`}>
          {status === null ? 'Checking…' : connected ? 'Connected' : status.configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void testConnection()}
        disabled={testing || !status?.configured}
        className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
      >
        {testing ? 'Testing…' : 'Test Connection'}
      </button>
      <button
        type="button"
        onClick={() => void previewSync()}
        disabled={syncing || !status?.configured}
        className="ml-3 mt-6 rounded-lg border border-blue-500 px-4 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-950 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
      >
        {syncing ? 'Fetching preview…' : 'Fetch / Preview Trucks'}
      </button>
      {status && (
        <dl className="mt-6 grid gap-2 rounded-lg border border-gray-800 bg-gray-950 p-4 text-sm md:grid-cols-[14rem_1fr]">
          <dt className="text-gray-500">Connected QuickManage account</dt>
          <dd>{status.connectedAccountName ?? 'Unavailable from official API'}</dd>
          <dt className="text-gray-500">Mapped FleetPilot company</dt>
          <dd>{status.mappedCompanyName}</dd>
          <dt className="text-gray-500">Identity status</dt>
          <dd className={status.identityStatus === 'VERIFIED' ? 'text-green-300' : 'text-amber-300'}>{status.identityStatus}</dd>
          <dt className="text-gray-500">Resource</dt><dd>Trucks</dd>
          <dt className="text-gray-500">Apply gate</dt><dd>{status.applyEnabled ? 'Enabled' : 'Blocked until identity is verified'}</dd>
          <dt className="text-gray-500">Identity note</dt><dd>{status.identityMessage}</dd>
        </dl>
      )}
      {message && <p role="status" className="mt-4 text-sm text-gray-300">{message}</p>}
      <section className="mt-6 rounded-lg border border-gray-800 bg-gray-950 p-4">
        <h2 className="font-semibold">Company Mappings</h2>
        <p className="mt-1 text-sm text-gray-400">Mappings require an exact QuickManage carrier UUID. Names are supporting context and are never matched automatically.</p>
        {carriers.length === 0 ? <p className="mt-3 text-sm text-gray-500">No staged Equipment carriers discovered.</p> : (
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-gray-500"><th>Carrier</th><th>Carrier UUID</th><th>Trucks</th><th>FleetPilot company</th><th>Status</th></tr></thead><tbody>
            {carriers.map(carrier=><tr key={carrier.carrierId} className="border-t border-gray-800"><td className="py-2">{carrier.carrierName}</td><td className="font-mono text-xs">{carrier.carrierId}</td><td>{carrier.truckCount}</td><td><select aria-label={`FleetPilot company for ${carrier.carrierName}`} value={carrier.companyId??''} onChange={event=>void mapCarrier(carrier,event.target.value)} className="rounded border border-gray-700 bg-gray-900 p-1"><option value="">Select explicitly…</option>{companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></td><td>{carrier.status}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
      {batch && (
        <div className="mt-6 space-y-4 border-t border-gray-800 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Truck sync preview</h2>
              <p className="text-sm text-gray-400">{batch.totalRows} QuickManage trucks · {batch.fleetPilotRecordCount} FleetPilot trucks · {batch.status.toLowerCase()}</p>
            </div>
            <button
              type="button"
              onClick={() => void applySync()}
              disabled={applying || batch.status === 'APPLIED' || !status?.applyEnabled}
              className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-700"
            >
              {applying ? 'Applying…' : batch.status === 'APPLIED' ? 'Applied' : 'Apply Safe Trucks'}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <article className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <h3 className="font-semibold">Trucks</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-gray-500">Total</dt><dd>{batch.totalRows}</dd>
                    <dt className="text-gray-500">New</dt><dd>{batch.newRows}</dd>
                    <dt className="text-gray-500">Matched</dt><dd>{batch.matchedRows}</dd>
                    <dt className="text-gray-500">Unchanged</dt><dd>{batch.unchangedRows}</dd>
                    <dt className="text-gray-500">Conflict</dt><dd className="text-amber-300">{batch.conflictRows}</dd>
                    <dt className="text-gray-500">Invalid</dt><dd className="text-red-300">{batch.invalidRows}</dd>
                  </dl>
            </article>
            <article className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <h3 className="font-semibold">Review reasons</h3>
              <ul className="mt-3 space-y-2 text-sm text-gray-300">
                {batch.rows.filter((row) => row.message).slice(0, 12).map((row) => (
                  <li key={row.id}><span className="text-gray-500">{row.disposition}:</span> {row.message}</li>
                ))}
              </ul>
            </article>
          </div>
          {(batch.conflictRows > 0 || batch.invalidRows > 0) && (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
              {batch.conflictRows} conflicts and {batch.invalidRows} invalid records will not be applied. Create a new preview after resolving source or FleetPilot data.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
