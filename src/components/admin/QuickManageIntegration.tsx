'use client';

import { useEffect, useState } from 'react';

type Status = { configured: boolean };
type ResourceType = 'TRUCK' | 'TRAILER' | 'DRIVER' | 'CUSTOMER' | 'TRIP';
type Disposition = 'NEW' | 'MATCHED' | 'UNCHANGED' | 'CONFLICT' | 'INVALID';
type SyncRow = { id: string; externalId: string; resourceType: ResourceType; disposition: Disposition; message: string | null };
type SyncBatch = {
  id: string;
  status: 'PREVIEWED' | 'APPLIED';
  totalRows: number;
  newRows: number;
  matchedRows: number;
  unchangedRows: number;
  conflictRows: number;
  invalidRows: number;
  rows: SyncRow[];
  createdAt?: string;
  appliedAt?: string | null;
};

const resources: Array<{ type: ResourceType; label: string }> = [
  { type: 'TRUCK', label: 'Trucks' },
  { type: 'TRAILER', label: 'Trailers' },
  { type: 'DRIVER', label: 'Drivers' },
  { type: 'CUSTOMER', label: 'Customers' },
];

export default function QuickManageIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [batch, setBatch] = useState<SyncBatch | null>(null);
  const [tripBatch, setTripBatch] = useState<SyncBatch | null>(null);
  const [tripSyncing, setTripSyncing] = useState(false);
  const [tripApplying, setTripApplying] = useState(false);

  useEffect(() => {
    fetch('/api/integrations/quickmanage', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Unable to load integration status.');
        setStatus(body);
      })
      .catch(() => setMessage('Unable to load QuickManage configuration status.'));
  }, []);

  async function testConnection() {
    setTesting(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/quickmanage', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Connection test failed.');
      setStatus({ configured: true });
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
      const response = await fetch('/api/integrations/quickmanage/sync', { method: 'POST' });
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
      const response = await fetch(`/api/integrations/quickmanage/sync/${batch.id}/apply`, { method: 'POST' });
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

  async function previewTrips() {
    setTripSyncing(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/quickmanage/sync/trips', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Trip preview failed.');
      setTripBatch(body);
      setConnected(true);
      setMessage('Trip preview is ready. No FleetPilot Loads have been changed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Trip preview failed.'); }
    finally { setTripSyncing(false); }
  }

  async function applyTrips() {
    if (!tripBatch || !window.confirm('Apply safe reviewed QuickManage Trips as FleetPilot Loads? Conflicts and invalid records remain unchanged.')) return;
    setTripApplying(true);
    setMessage('');
    try {
      const response = await fetch(`/api/integrations/quickmanage/sync/trips/${tripBatch.id}/apply`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Trip apply failed.');
      setTripBatch(body);
      setMessage('Safe QuickManage Trips were applied. No Accounting records were created.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Trip apply failed.'); }
    finally { setTripApplying(false); }
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
        {syncing ? 'Fetching preview…' : 'Sync Fleet Data'}
      </button>
      <button
        type="button"
        onClick={() => void previewTrips()}
        disabled={tripSyncing || !status?.configured}
        className="ml-3 mt-6 rounded-lg border border-purple-500 px-4 py-2 text-sm font-semibold text-purple-200 hover:bg-purple-950 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
      >
        {tripSyncing ? 'Fetching Trips…' : 'Preview Trips / Loads'}
      </button>
      {message && <p role="status" className="mt-4 text-sm text-gray-300">{message}</p>}
      {batch && (
        <div className="mt-6 space-y-4 border-t border-gray-800 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Fleet sync preview</h2>
              <p className="text-sm text-gray-400">{batch.totalRows} records reviewed · {batch.status.toLowerCase()}</p>
            </div>
            <button
              type="button"
              onClick={() => void applySync()}
              disabled={applying || batch.status === 'APPLIED'}
              className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-700"
            >
              {applying ? 'Applying…' : batch.status === 'APPLIED' ? 'Applied' : 'Apply Safe Records'}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {resources.map((resource) => {
              const rows = batch.rows.filter((row) => row.resourceType === resource.type);
              const count = (disposition: Disposition) => rows.filter((row) => row.disposition === disposition).length;
              return (
                <article key={resource.type} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <h3 className="font-semibold">{resource.label}</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-gray-500">Total</dt><dd>{rows.length}</dd>
                    <dt className="text-gray-500">New</dt><dd>{count('NEW')}</dd>
                    <dt className="text-gray-500">Matched</dt><dd>{count('MATCHED')}</dd>
                    <dt className="text-gray-500">Unchanged</dt><dd>{count('UNCHANGED')}</dd>
                    <dt className="text-gray-500">Conflict</dt><dd className="text-amber-300">{count('CONFLICT')}</dd>
                    <dt className="text-gray-500">Invalid</dt><dd className="text-red-300">{count('INVALID')}</dd>
                  </dl>
                </article>
              );
            })}
          </div>
          {(batch.conflictRows > 0 || batch.invalidRows > 0) && (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
              {batch.conflictRows} conflicts and {batch.invalidRows} invalid records will not be applied. Create a new preview after resolving source or FleetPilot data.
            </p>
          )}
        </div>
      )}
      {tripBatch && (
        <div className="mt-6 space-y-4 border-t border-gray-800 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Trip / Load sync preview</h2>
              <p className="text-sm text-gray-400">
                {tripBatch.totalRows} fetched · {tripBatch.status.toLowerCase()}
                {tripBatch.createdAt ? ` · last fetch ${new Date(tripBatch.createdAt).toLocaleString()}` : ''}
                {tripBatch.appliedAt ? ` · last apply ${new Date(tripBatch.appliedAt).toLocaleString()}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => void applyTrips()} disabled={tripApplying || tripBatch.status === 'APPLIED'} className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold hover:bg-purple-600 disabled:cursor-not-allowed disabled:bg-gray-700">
              {tripApplying ? 'Applying…' : tripBatch.status === 'APPLIED' ? 'Applied' : 'Apply Safe Trips'}
            </button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([['Fetched', tripBatch.totalRows], ['New', tripBatch.newRows], ['Matched', tripBatch.matchedRows], ['Unchanged', tripBatch.unchangedRows], ['Conflict', tripBatch.conflictRows], ['Invalid', tripBatch.invalidRows]] as const).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-gray-800 bg-gray-950 p-3"><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 text-lg font-semibold">{value}</dd></div>
            ))}
          </dl>
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-800">
            <table className="w-full text-left text-sm"><thead className="bg-gray-950 text-gray-400"><tr><th className="p-3">QuickManage Trip ID</th><th className="p-3">Review</th><th className="p-3">Reason</th></tr></thead><tbody>
              {tripBatch.rows.map((row) => <tr key={row.id} className="border-t border-gray-800"><td className="p-3 font-mono text-xs">{row.externalId}</td><td className="p-3">{row.disposition}</td><td className="p-3 text-gray-400">{row.message ?? '—'}</td></tr>)}
            </tbody></table>
          </div>
          <p className="text-xs text-gray-500">Webhook processing remains disabled because QuickManage does not document the delivery signature algorithm, payload, retry, duplicate, or ordering contract.</p>
        </div>
      )}
    </section>
  );
}
