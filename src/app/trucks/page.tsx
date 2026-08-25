'use client'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Sidebar from '@/components/Sidebar'
import { TruckImportPanel } from '@/components/fleet/TruckImportPanel'

type CompanyOption = { id: string; name: string }
type TruckItem = {
  id: string; unitNumber: string; vin: string | null; year: number | null; make: string | null; model: string | null;
  status: string; companyId: string; company?: CompanyOption; cabType: string; isOwnerOp: boolean; ownerName: string | null;
}
type VinResult = { Variable?: string; Value?: string }

const defaultForm = { unitNumber: '', vin: '', year: '', make: '', model: '', status: 'ACTIVE', companyId: '', cabType: 'SLEEPER', isOwnerOp: false, ownerName: '' }

const cabTypeLabels: Record<string, string> = {
  SLEEPER: '🛏 Sleeper',
  DAYCAB: '☀️ Day Cab',
  OWNER_OP: '👤 Owner\'s Truck',
}

const cabTypeColors: Record<string, string> = {
  SLEEPER: 'bg-indigo-900/50 text-indigo-300',
  DAYCAB: 'bg-cyan-900/50 text-cyan-300',
  OWNER_OP: 'bg-purple-900/50 text-purple-300',
}

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-900/50 text-green-300',
  INACTIVE: 'bg-gray-700/50 text-gray-400',
  MAINTENANCE: 'bg-yellow-900/50 text-yellow-300',
}

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<TruckItem[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [vinLooking, setVinLooking] = useState(false)
  const [vinError, setVinError] = useState('')
  const [vinSuccess, setVinSuccess] = useState('')

  const loadData = () => fetch('/api/trucks').then(r => r.json()).then(setTrucks)
  useEffect(() => {
    loadData()
    fetch('/api/companies').then(r => r.json()).then(setCompanies)
  }, [])

  const openAdd = () => {
    setEditId(null)
    setForm(defaultForm)
    setVinError('')
    setVinSuccess('')
    setShowForm(true)
  }

  const lookupVin = async () => {
    if (form.vin.length < 17) return
    setVinLooking(true)
    setVinError('')
    setVinSuccess('')
    try {
      const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${form.vin.trim()}?format=json`)
      const data = await res.json()
      const get = (name: string) => (data.Results as VinResult[] | undefined)?.find((result) => result.Variable === name)?.Value || ''
      const make  = get('Make')
      const model = get('Model')
      const year  = get('Model Year')
      if (!make && !model) {
        setVinError('Could not decode VIN — check that it\'s 17 characters and correct.')
      } else {
        setForm(f => ({
          ...f,
          make:  make  || f.make,
          model: model || f.model,
          year:  year  || f.year,
        }))
        setVinSuccess(`Found: ${year} ${make} ${model}`)
      }
    } catch {
      setVinError('Lookup failed. Check your connection and try again.')
    }
    setVinLooking(false)
  }

  const openEdit = (t: TruckItem) => {
    setVinError('')
    setVinSuccess('')
    setEditId(t.id)
    setForm({
      unitNumber: t.unitNumber || '',
      vin: t.vin || '',
      year: t.year ? String(t.year) : '',
      make: t.make || '',
      model: t.model || '',
      status: t.status || 'ACTIVE',
      companyId: t.companyId || '',
      cabType: t.cabType || 'SLEEPER',
      isOwnerOp: t.isOwnerOp || false,
      ownerName: t.ownerName || '',
    })
    setShowForm(true)
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const url = editId ? `/api/trucks/${editId}` : '/api/trucks'
    const method = editId ? 'PATCH' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setShowForm(false)
    setForm(defaultForm)
    setEditId(null)
    loadData()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this truck? This may fail if loads are assigned to it.')) return
    await fetch(`/api/trucks/${id}`, { method: 'DELETE' })
    loadData()
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
          <button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            + Add Truck
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
            <form onSubmit={submit} className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{editId ? 'Edit Truck' : 'Add Truck'}</h3>
                <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">VIN</label>
                <div className="flex gap-2 mt-1">
                  <input value={form.vin} onChange={e => setForm({ ...form, vin: e.target.value })}
                    placeholder="1FUJGBDV..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <button
                    type="button"
                    onClick={lookupVin}
                    disabled={vinLooking || form.vin.length < 17}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
                  >
                    {vinLooking ? '...' : '🔍 Lookup'}
                  </button>
                </div>
                {vinError && <div className="text-red-400 text-xs mt-1">{vinError}</div>}
                {vinSuccess && <div className="text-green-400 text-xs mt-1">✅ {vinSuccess}</div>}
              </div>
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
                <label className="text-xs text-gray-400 uppercase">Cab Type *</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(['SLEEPER', 'DAYCAB', 'OWNER_OP'] as const).map(ct => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => setForm({ ...form, cabType: ct, isOwnerOp: ct === 'OWNER_OP' })}
                      className={`py-2 px-1 rounded-lg text-xs font-semibold border transition-all ${form.cabType === ct ? 'border-blue-500 bg-blue-600/30 text-white' : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'}`}
                    >
                      {cabTypeLabels[ct]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="MAINTENANCE">Maintenance</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">Company *</label>
                <select required value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Select company...</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {form.cabType === 'OWNER_OP' && (
                <div>
                  <label className="text-xs text-gray-400 uppercase">Owner Name</label>
                  <input value={form.ownerName} onChange={e => setForm({ ...form, ownerName: e.target.value })}
                    placeholder="Owner's full name"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm font-medium transition-colors">
                  {editId ? 'Save Changes' : 'Add Truck'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg text-sm transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <TruckImportPanel onCommitted={loadData} />

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {trucks.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">🚛</p>
              <p className="text-sm">No trucks yet. Add your first one.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs uppercase tracking-wide">
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
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${cabTypeColors[t.cabType] || 'bg-gray-700 text-gray-400'}`}>
                        {cabTypeLabels[t.cabType] || t.cabType || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[t.status]}`}>{t.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-4">
                      <button onClick={() => openEdit(t)} className="text-blue-400 hover:text-blue-300 text-xs font-medium">Edit</button>
                      <button onClick={() => del(t.id)} className="text-red-400 hover:text-red-300 text-xs font-medium">Delete</button>
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
