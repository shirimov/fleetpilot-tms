'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const defaultForm = { firstName: '', lastName: '', phone: '', email: '', licenseNum: '', payType: 'PERCENTAGE', payRate: '', truckId: '' }

export default function DriversPage() {
  const [drivers, setDrivers] = useState<any[]>([])
  const [trucks, setTrucks] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(defaultForm)

  const loadData = () => fetch('/api/drivers').then(r => r.json()).then(setDrivers)
  useEffect(() => {
    loadData()
    fetch('/api/trucks').then(r => r.json()).then(setTrucks)
  }, [])

  const openAdd = () => {
    setEditId(null)
    setForm(defaultForm)
    setShowForm(true)
  }

  const openEdit = (d: any) => {
    setEditId(d.id)
    setForm({
      firstName: d.firstName || '',
      lastName: d.lastName || '',
      phone: d.phone || '',
      email: d.email || '',
      licenseNum: d.licenseNum || '',
      payType: d.payType || 'PERCENTAGE',
      payRate: d.payRate != null ? String(d.payRate) : '',
      truckId: d.truckId || '',
    })
    setShowForm(true)
  }

  const submit = async (e: any) => {
    e.preventDefault()
    const url = editId ? `/api/drivers/${editId}` : '/api/drivers'
    const method = editId ? 'PATCH' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setShowForm(false)
    setForm(defaultForm)
    setEditId(null)
    loadData()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this driver?')) return
    await fetch(`/api/drivers/${id}`, { method: 'DELETE' })
    loadData()
  }

  const payLabel = (type: string, rate: number) => {
    if (type === 'PERCENTAGE') return `${rate}%`
    if (type === 'PER_MILE') return `$${rate}/mi`
    return `$${rate.toLocaleString()} flat`
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">Drivers</h2>
            <p className="text-gray-400 text-sm mt-1">{drivers.length} total</p>
          </div>
          <button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            + Add Driver
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
            <form onSubmit={submit} className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{editId ? 'Edit Driver' : 'Add Driver'}</h3>
                <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">First Name *</label>
                  <input required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Last Name *</label>
                  <input required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 uppercase">Phone</label>
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="(555) 000-0000"
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">CDL License #</label>
                <input value={form.licenseNum} onChange={e => setForm({ ...form, licenseNum: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">Assign to Truck</label>
                <select value={form.truckId} onChange={e => setForm({ ...form, truckId: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Unassigned</option>
                  {trucks.map(t => <option key={t.id} value={t.id}>{t.unitNumber}{t.make ? ` — ${t.make}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">Pay Type *</label>
                <select value={form.payType} onChange={e => setForm({ ...form, payType: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="PERCENTAGE">Percentage of Load</option>
                  <option value="PER_MILE">Per Mile</option>
                  <option value="FLAT">Flat Rate</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">
                  {form.payType === 'PERCENTAGE' ? 'Rate (%)' : form.payType === 'PER_MILE' ? 'Rate ($/mile)' : 'Flat Amount ($)'} *
                </label>
                <input required type="number" step="0.01" min="0" value={form.payRate} onChange={e => setForm({ ...form, payRate: e.target.value })}
                  placeholder={form.payType === 'PERCENTAGE' ? '25' : form.payType === 'PER_MILE' ? '0.55' : '1500'}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm font-medium transition-colors">
                  {editId ? 'Save Changes' : 'Add Driver'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg text-sm transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {drivers.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">👤</p>
              <p className="text-sm">No drivers yet. Add your first one.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-6 py-3">Name</th>
                  <th className="text-left px-6 py-3">Phone</th>
                  <th className="text-left px-6 py-3">CDL</th>
                  <th className="text-left px-6 py-3">Truck</th>
                  <th className="text-left px-6 py-3">Pay</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d, i) => (
                  <tr key={d.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/50'}`}>
                    <td className="px-6 py-4 font-medium">{d.firstName} {d.lastName}</td>
                    <td className="px-6 py-4 text-gray-400">{d.phone || '—'}</td>
                    <td className="px-6 py-4 text-gray-400 font-mono text-xs">{d.licenseNum || '—'}</td>
                    <td className="px-6 py-4 text-gray-400">{d.truck?.unitNumber || <span className="text-gray-600">Unassigned</span>}</td>
                    <td className="px-6 py-4 text-green-400 font-medium">{payLabel(d.payType, d.payRate)}</td>
                    <td className="px-6 py-4 text-right space-x-4">
                      <button onClick={() => openEdit(d)} className="text-blue-400 hover:text-blue-300 text-xs font-medium">Edit</button>
                      <button onClick={() => del(d.id)} className="text-red-400 hover:text-red-300 text-xs font-medium">Delete</button>
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
