'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ unitNumber: '', vin: '', year: '', make: '', model: '', companyId: '', isOwnerOp: false, ownerName: '' })

  const load = () => fetch('/api/trucks').then(r => r.json()).then(setTrucks)
  useEffect(() => {
    load()
    fetch('/api/companies').then(r => r.json()).then(setCompanies)
  }, [])

  const submit = async (e: any) => {
    e.preventDefault()
    await fetch('/api/trucks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setForm({ unitNumber: '', vin: '', year: '', make: '', model: '', companyId: '', isOwnerOp: false, ownerName: '' })
    setShowForm(false)
    load()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this truck?')) return
    await fetch(`/api/trucks/${id}`, { method: 'DELETE' })
    load()
  }

  const statusColor: Record<string, string> = {
    ACTIVE: 'text-green-400',
    INACTIVE: 'text-gray-400',
    MAINTENANCE: 'text-yellow-400',
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">Trucks</h2>
            <p className="text-gray-400 text-sm mt-1">{trucks.length} total</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium">
            + Add Truck
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <form onSubmit={submit} className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
              <h3 className="font-bold text-lg">Add Truck</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Unit # *</label>
                  <input required value={form.unitNumber} onChange={e => setForm({ ...form, unitNumber: e.target.value })}
                    placeholder="e.g. T-101"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Year</label>
                  <input value={form.year} onChange={e => setForm({ ...form, year: e.target.value })}
                    placeholder="2022"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Make</label>
                  <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })}
                    placeholder="Freightliner"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Model</label>
                  <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                    placeholder="Cascadia"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">VIN</label>
                <input value={form.vin} onChange={e => setForm({ ...form, vin: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">Company *</label>
                <select required value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Select company...</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="ownerOp" checked={form.isOwnerOp} onChange={e => setForm({ ...form, isOwnerOp: e.target.checked })}
                  className="rounded" />
                <label htmlFor="ownerOp" className="text-sm text-gray-300">Owner-Operator</label>
              </div>
              {form.isOwnerOp && (
                <div>
                  <label className="text-xs text-gray-400 uppercase">Owner Name</label>
                  <input value={form.ownerName} onChange={e => setForm({ ...form, ownerName: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm font-medium">Save</button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {trucks.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">🚛</p>
              <p className="text-sm">No trucks yet. Add your first one.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs uppercase">
                  <th className="text-left px-6 py-3">Unit #</th>
                  <th className="text-left px-6 py-3">Year / Make / Model</th>
                  <th className="text-left px-6 py-3">Company</th>
                  <th className="text-left px-6 py-3">Type</th>
                  <th className="text-left px-6 py-3">Status</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {trucks.map((t, i) => (
                  <tr key={t.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/50'}`}>
                    <td className="px-6 py-4 font-bold">{t.unitNumber}</td>
                    <td className="px-6 py-4 text-gray-300">{[t.year, t.make, t.model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-6 py-4 text-gray-400">{t.company?.name || '—'}</td>
                    <td className="px-6 py-4">{t.isOwnerOp ? <span className="text-purple-400 text-xs">Owner-Op</span> : <span className="text-blue-400 text-xs">Company</span>}</td>
                    <td className={`px-6 py-4 text-xs font-medium ${statusColor[t.status]}`}>{t.status}</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => del(t.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}
