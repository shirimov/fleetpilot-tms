'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const statusColor: Record<string, string> = {
  PENDING: 'bg-yellow-900/50 text-yellow-300',
  IN_TRANSIT: 'bg-blue-900/50 text-blue-300',
  DELIVERED: 'bg-green-900/50 text-green-300',
  CANCELLED: 'bg-red-900/50 text-red-300',
}

export default function LoadsPage() {
  const [loads, setLoads] = useState<any[]>([])
  const [trucks, setTrucks] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    loadNumber: '', referenceNum: '', status: 'PENDING',
    origin: '', destination: '', pickupDate: '', deliveryDate: '',
    miles: '', rate: '', fuelSurcharge: '',
    truckId: '', driverId: '', companyId: ''
  })

  const load = () => fetch('/api/loads').then(r => r.json()).then(setLoads)
  useEffect(() => {
    load()
    fetch('/api/trucks').then(r => r.json()).then(setTrucks)
    fetch('/api/drivers').then(r => r.json()).then(setDrivers)
    fetch('/api/companies').then(r => r.json()).then(setCompanies)
  }, [])

  const submit = async (e: any) => {
    e.preventDefault()
    await fetch('/api/loads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setForm({ loadNumber: '', referenceNum: '', status: 'PENDING', origin: '', destination: '', pickupDate: '', deliveryDate: '', miles: '', rate: '', fuelSurcharge: '', truckId: '', driverId: '', companyId: '' })
    setShowForm(false)
    load()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this load?')) return
    await fetch(`/api/loads/${id}`, { method: 'DELETE' })
    load()
  }

  const totalRevenue = loads.reduce((sum, l) => sum + l.rate, 0)

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Loads</h2>
            <p className="text-gray-400 text-sm mt-1">{loads.length} total · <span className="text-green-400">${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })} gross</span></p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium">
            + New Load
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <form onSubmit={submit} className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
              <h3 className="font-bold text-lg">New Load</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Load # *</label>
                  <input required value={form.loadNumber} onChange={e => setForm({ ...form, loadNumber: e.target.value })}
                    placeholder="L-001"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Amazon Ref #</label>
                  <input value={form.referenceNum} onChange={e => setForm({ ...form, referenceNum: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Origin *</label>
                  <input required value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })}
                    placeholder="City, ST"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Destination *</label>
                  <input required value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })}
                    placeholder="City, ST"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Rate ($) *</label>
                  <input required type="number" step="0.01" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })}
                    placeholder="2500"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Fuel Surcharge</label>
                  <input type="number" step="0.01" value={form.fuelSurcharge} onChange={e => setForm({ ...form, fuelSurcharge: e.target.value })}
                    placeholder="0"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Miles</label>
                  <input type="number" value={form.miles} onChange={e => setForm({ ...form, miles: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Pickup Date</label>
                  <input type="date" value={form.pickupDate} onChange={e => setForm({ ...form, pickupDate: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Delivery Date</label>
                  <input type="date" value={form.deliveryDate} onChange={e => setForm({ ...form, deliveryDate: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">Company *</label>
                <select required value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Select company...</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">Truck *</label>
                <select required value={form.truckId} onChange={e => setForm({ ...form, truckId: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Select truck...</option>
                  {trucks.map(t => <option key={t.id} value={t.id}>{t.unitNumber} {t.make ? `— ${t.make}` : ''}</option>)}
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
              <div>
                <label className="text-xs text-gray-400 uppercase">Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="PENDING">Pending</option>
                  <option value="IN_TRANSIT">In Transit</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm font-medium">Save</button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {loads.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">📦</p>
              <p className="text-sm">No loads yet. Add your first one.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs uppercase">
                  <th className="text-left px-6 py-3">Load #</th>
                  <th className="text-left px-6 py-3">Route</th>
                  <th className="text-left px-6 py-3">Truck</th>
                  <th className="text-left px-6 py-3">Driver</th>
                  <th className="text-left px-6 py-3">Rate</th>
                  <th className="text-left px-6 py-3">Status</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loads.map((l, i) => (
                  <tr key={l.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/50'}`}>
                    <td className="px-6 py-4 font-mono font-bold text-blue-400">{l.loadNumber}</td>
                    <td className="px-6 py-4 text-gray-300 text-xs">{l.origin} → {l.destination}</td>
                    <td className="px-6 py-4 text-gray-400">{l.truck?.unitNumber || '—'}</td>
                    <td className="px-6 py-4 text-gray-400">{l.driver ? `${l.driver.firstName} ${l.driver.lastName}` : '—'}</td>
                    <td className="px-6 py-4 text-green-400 font-medium">${l.rate.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[l.status]}`}>{l.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => del(l.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
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
