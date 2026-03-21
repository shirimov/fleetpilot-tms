'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const defaultForm = {
  weekEnding: '',
  truckId: '',
  driverId: '',
  loadId: '',
  grossRevenue: '',
  driverPay: '',
  fuelDeduction: '0',
  otherDeductions: '0',
  notes: '',
}

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<any[]>([])
  const [loads, setLoads] = useState<any[]>([])
  const [trucks, setTrucks] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(defaultForm)
  const [loadPreview, setLoadPreview] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const loadData = () => fetch('/api/settlements').then(r => r.json()).then(setSettlements)
  useEffect(() => {
    loadData()
    fetch('/api/trucks').then(r => r.json()).then(setTrucks)
    fetch('/api/drivers').then(r => r.json()).then(setDrivers)
    // Only show delivered loads without a settlement
    fetch('/api/loads').then(r => r.json()).then((all: any[]) =>
      setLoads(all.filter((l: any) => l.status === 'DELIVERED' && !l.settlement))
    )
  }, [])

  // When a load is selected, auto-populate fields
  const handleLoadSelect = (loadId: string) => {
    const l = loads.find(x => x.id === loadId)
    if (!l) {
      setLoadPreview(null)
      setForm(f => ({ ...f, loadId: '', truckId: '', driverId: '', grossRevenue: '', driverPay: '' }))
      return
    }
    setLoadPreview(l)
    const gross = (l.rate || 0) + (l.fuelSurcharge || 0)
    let pay = 0
    if (l.driver) {
      if (l.driver.payType === 'PERCENTAGE') pay = gross * (l.driver.payRate / 100)
      else if (l.driver.payType === 'PER_MILE') pay = (l.miles || 0) * l.driver.payRate
      else pay = l.driver.payRate
    }
    setForm(f => ({
      ...f,
      loadId,
      truckId: l.truckId || '',
      driverId: l.driverId || '',
      grossRevenue: String(gross),
      driverPay: String(Math.round(pay * 100) / 100),
    }))
  }

  const submit = async (e: any) => {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setShowForm(false)
      setForm(defaultForm)
      setLoadPreview(null)
      loadData()
      // Refresh available loads
      fetch('/api/loads').then(r => r.json()).then((all: any[]) =>
        setLoads(all.filter((l: any) => l.status === 'DELIVERED' && !l.settlement))
      )
    } finally {
      setSaving(false)
    }
  }

  const markPaid = async (id: string, isPaid: boolean) => {
    await fetch(`/api/settlements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPaid }),
    })
    loadData()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this settlement?')) return
    await fetch(`/api/settlements/${id}`, { method: 'DELETE' })
    loadData()
    fetch('/api/loads').then(r => r.json()).then((all: any[]) =>
      setLoads(all.filter((l: any) => l.status === 'DELIVERED' && !l.settlement))
    )
  }

  const netPay = () => {
    const dp = parseFloat(form.driverPay) || 0
    const fuel = parseFloat(form.fuelDeduction) || 0
    const other = parseFloat(form.otherDeductions) || 0
    return dp - fuel - other
  }

  const pendingCount = settlements.filter(s => !s.isPaid).length
  const pendingAmount = settlements.filter(s => !s.isPaid).reduce((sum, s) => sum + s.netPay, 0)

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Settlements</h2>
            <p className="text-gray-400 text-sm mt-1">
              {settlements.length} total ·{' '}
              <span className="text-yellow-400">{pendingCount} pending (${pendingAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
            </p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-green-700 hover:bg-green-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            + Generate Settlement
          </button>
        </div>

        {loads.length > 0 && (
          <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-4 mb-6 flex items-center gap-3">
            <span className="text-yellow-400 text-lg">⚠️</span>
            <p className="text-yellow-300 text-sm">
              <strong>{loads.length}</strong> delivered load{loads.length !== 1 ? 's' : ''} waiting for settlement
            </p>
            <button onClick={() => setShowForm(true)} className="ml-auto text-yellow-400 hover:text-yellow-300 text-sm font-medium underline">
              Generate now →
            </button>
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
            <form onSubmit={submit} className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Generate Settlement</h3>
                <button type="button" onClick={() => { setShowForm(false); setLoadPreview(null) }} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
              </div>

              <div>
                <label className="text-xs text-gray-400 uppercase">Generate from Delivered Load</label>
                <select value={form.loadId} onChange={e => handleLoadSelect(e.target.value)}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">— Manual entry —</option>
                  {loads.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.loadNumber} · {l.origin} → {l.destination} · ${(l.rate + (l.fuelSurcharge || 0)).toLocaleString()}
                      {l.driver ? ` · ${l.driver.firstName} ${l.driver.lastName}` : ''}
                    </option>
                  ))}
                </select>
                {loads.length === 0 && <p className="text-xs text-gray-500 mt-1">No unprocessed delivered loads. Mark a load as DELIVERED first.</p>}
              </div>

              {loadPreview && (
                <div className="bg-gray-800 rounded-lg p-3 text-xs space-y-1 border border-gray-700">
                  <p className="text-gray-300 font-medium">Load: <span className="text-blue-400">{loadPreview.loadNumber}</span></p>
                  <p className="text-gray-400">{loadPreview.origin} → {loadPreview.destination}</p>
                  {loadPreview.driver && (
                    <p className="text-gray-400">Driver: {loadPreview.driver.firstName} {loadPreview.driver.lastName} ({loadPreview.driver.payType === 'PERCENTAGE' ? `${loadPreview.driver.payRate}%` : loadPreview.driver.payType === 'PER_MILE' ? `$${loadPreview.driver.payRate}/mi` : `$${loadPreview.driver.payRate} flat`})</p>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs text-gray-400 uppercase">Week Ending Date *</label>
                <input required type="date" value={form.weekEnding} onChange={e => setForm({ ...form, weekEnding: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Truck *</label>
                  <select required value={form.truckId} onChange={e => setForm({ ...form, truckId: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="">Select truck...</option>
                    {trucks.map(t => <option key={t.id} value={t.id}>{t.unitNumber}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Driver</label>
                  <select value={form.driverId} onChange={e => setForm({ ...form, driverId: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="">Unassigned</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Gross Revenue ($) *</label>
                  <input required type="number" step="0.01" min="0" value={form.grossRevenue} onChange={e => setForm({ ...form, grossRevenue: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Driver Pay ($) *</label>
                  <input required type="number" step="0.01" min="0" value={form.driverPay} onChange={e => setForm({ ...form, driverPay: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Fuel Deduction ($)</label>
                  <input type="number" step="0.01" min="0" value={form.fuelDeduction} onChange={e => setForm({ ...form, fuelDeduction: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Other Deductions ($)</label>
                  <input type="number" step="0.01" min="0" value={form.otherDeductions} onChange={e => setForm({ ...form, otherDeductions: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              {/* Net pay preview */}
              <div className="bg-gray-800 rounded-lg p-3 flex items-center justify-between border border-gray-700">
                <span className="text-sm text-gray-400">Net Pay to Driver</span>
                <span className={`text-lg font-bold ${netPay() >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${netPay().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div>
                <label className="text-xs text-gray-400 uppercase">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 py-2 rounded-lg text-sm font-medium transition-colors">
                  {saving ? 'Saving...' : 'Generate Settlement'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setLoadPreview(null) }} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg text-sm transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {settlements.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">💰</p>
              <p className="text-sm">No settlements yet.</p>
              <p className="text-xs mt-1">Mark a load as Delivered, then generate a settlement.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-6 py-3">Week Ending</th>
                  <th className="text-left px-6 py-3">Driver</th>
                  <th className="text-left px-6 py-3">Truck</th>
                  <th className="text-left px-6 py-3">Load</th>
                  <th className="text-right px-6 py-3">Gross Rev</th>
                  <th className="text-right px-6 py-3">Driver Pay</th>
                  <th className="text-right px-6 py-3">Deductions</th>
                  <th className="text-right px-6 py-3">Net Pay</th>
                  <th className="text-left px-6 py-3">Status</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s, i) => (
                  <tr key={s.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/50'}`}>
                    <td className="px-6 py-4 text-gray-300">{new Date(s.weekEnding).toLocaleDateString()}</td>
                    <td className="px-6 py-4 font-medium">{s.driver ? `${s.driver.firstName} ${s.driver.lastName}` : <span className="text-gray-500">—</span>}</td>
                    <td className="px-6 py-4 text-gray-400">{s.truck?.unitNumber || '—'}</td>
                    <td className="px-6 py-4 font-mono text-blue-400 text-xs">{s.load?.loadNumber || '—'}</td>
                    <td className="px-6 py-4 text-right text-gray-300">${s.grossRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-right text-gray-300">${s.driverPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-right text-red-400 text-xs">
                      {(s.fuelDeduction + s.otherDeductions) > 0
                        ? `-$${(s.fuelDeduction + s.otherDeductions).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-green-400">${s.netPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4">
                      {s.isPaid
                        ? <span className="bg-green-900/50 text-green-300 px-2 py-1 rounded-full text-xs font-medium">Paid</span>
                        : <span className="bg-yellow-900/50 text-yellow-300 px-2 py-1 rounded-full text-xs font-medium">Pending</span>}
                    </td>
                    <td className="px-6 py-4 text-right space-x-3">
                      {!s.isPaid ? (
                        <button onClick={() => markPaid(s.id, true)} className="text-green-400 hover:text-green-300 text-xs font-medium">Mark Paid</button>
                      ) : (
                        <button onClick={() => markPaid(s.id, false)} className="text-gray-400 hover:text-gray-300 text-xs">Unpay</button>
                      )}
                      <button onClick={() => del(s.id)} className="text-red-400 hover:text-red-300 text-xs font-medium">Delete</button>
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
