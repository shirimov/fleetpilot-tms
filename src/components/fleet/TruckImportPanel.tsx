'use client';

import { useState } from 'react';

type ImportRow = {
  id: string; rowNumber: number; disposition: 'NEW' | 'MATCHED' | 'CONFLICT' | 'REJECTED';
  unitNumber: string | null; vin: string | null; year: number | null; make: string | null; model: string | null; message: string | null;
};
type ImportBatch = {
  id: string; status: 'PREVIEWED' | 'COMMITTED'; totalRows: number; newRows: number; matchedRows: number; conflictRows: number; rejectedRows: number; rows: ImportRow[];
};

export function TruckImportPanel({ onCommitted }: { onCommitted: () => void }) {
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function preview(file: File) {
    setBusy(true); setError(''); setBatch(null);
    const form = new FormData(); form.set('file', file);
    const response = await fetch('/api/trucks/imports', { method: 'POST', body: form });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Import preview failed.'); else setBatch(body);
    setBusy(false);
  }

  async function commit() {
    if (!batch || !window.confirm(`Create ${batch.newRows} new canonical trucks? Existing trucks will not be changed.`)) return;
    setBusy(true); setError('');
    const response = await fetch(`/api/trucks/imports/${batch.id}/commit`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Truck import failed.'); else { setBatch(body); onCommitted(); }
    setBusy(false);
  }

  return <section className="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-5" data-testid="truck-import-panel">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h3 className="font-semibold">Import truck master data</h3><p className="mt-1 text-sm text-gray-400">CSV/XLSX headers: Unit Number, VIN, Status, Year, Make, Model. Preview never overwrites trucks.</p></div>
      <label className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">
        {busy ? 'Working…' : 'Choose CSV/XLSX'}
        <input className="hidden" type="file" accept=".csv,.xlsx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void preview(file); }} />
      </label>
    </div>
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
    {batch && <div className="mt-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[['Rows', batch.totalRows], ['New', batch.newRows], ['Matched', batch.matchedRows], ['Conflicts', batch.conflictRows], ['Rejected', batch.rejectedRows]].map(([label, value]) => <div key={label} className="rounded-lg bg-gray-950 p-3"><div className="text-xs uppercase text-gray-500">{label}</div><div className="text-xl font-bold">{value}</div></div>)}
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-gray-950 text-xs uppercase text-gray-500"><tr><th className="p-3">Row</th><th className="p-3">Result</th><th className="p-3">Unit</th><th className="p-3">VIN</th><th className="p-3">Details</th></tr></thead>
          <tbody>{batch.rows.map((row) => <tr key={row.id} className="border-t border-gray-800"><td className="p-3">{row.rowNumber}</td><td className="p-3 font-semibold">{row.disposition}</td><td className="p-3">{row.unitNumber ?? '—'}</td><td className="p-3 font-mono text-xs">{row.vin ?? '—'}</td><td className="p-3 text-gray-400">{row.message ?? [row.year, row.make, row.model].filter(Boolean).join(' ')}</td></tr>)}</tbody>
        </table>
      </div>
      {batch.status === 'COMMITTED' ? <p className="text-sm font-medium text-green-400">Import committed. Existing trucks were not modified.</p> : <button onClick={() => void commit()} disabled={busy || batch.conflictRows > 0 || batch.rejectedRows > 0} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-gray-700">Commit {batch.newRows} new trucks</button>}
      {(batch.conflictRows > 0 || batch.rejectedRows > 0) && <p className="text-sm text-amber-300">Remove or correct every conflict/rejected row and upload a new file before commit.</p>}
    </div>}
  </section>;
}
