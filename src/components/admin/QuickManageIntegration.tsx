'use client';

import { useEffect, useState } from 'react';

type Status = { configured: boolean };

export default function QuickManageIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);

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
      setMessage('Connection successful. QuickManage returned a valid access token.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Administration · Integrations</p>
          <h1 className="mt-2 text-2xl font-bold">QuickManage</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-400">
            Test the protected server-side API credentials. This read-only check does not fetch or change Trucks.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm ${status?.configured ? 'bg-green-950 text-green-300' : 'bg-gray-800 text-gray-300'}`}>
          {status === null ? 'Checking…' : status.configured ? 'Configured' : 'Not configured'}
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
      {message && <p role="status" className="mt-4 text-sm text-gray-300">{message}</p>}
    </section>
  );
}
