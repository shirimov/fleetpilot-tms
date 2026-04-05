'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const defaultForm = { name: '', dotNumber: '', mcNumber: '' }

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [dotLooking, setDotLooking] = useState(false)
  const [dotError, setDotError] = useState('')
  const [dotSuccess, setDotSuccess] = useState('')

  const loadData = () => fetch('/api/companies').then(r => r.json()).then(setCompanies)
  useEffect(() => { loadData() }, [])

  const openAdd = () => {
    setEditId(null)
    setForm(defaultForm)
    setDotError('')
    setDotSuccess('')
    setShowForm(true)
  }

  const openEdit = (c: any) => {
    setEditId(c.id)
    setDotError('')
    setDotSuccess('')
    setForm({ name: c.name, dotNumber: c.dotNumber || '', mcNumber: c.mcNumber || '' })
    setShowForm(true)
  }

  const lookupCarrier = async (type: 'dot' | 'mc') => {
    const value = type === 'dot' ? form.dotNumber.trim() : form.mcNumber.trim()
    if (!value) return
    setDotLooking(true)
    setDotError('')
    setDotSuccess('')
    try {
      const res = await fetch(`/api/lookup/dot?${type}=${value}`)
      const data = await res.json()
      if (!res.ok) {
        setDotError(data.error || 'Lookup failed')
      } else {
        setForm(f => ({
          ...f,
          name:      data.name      || f.name,
          dotNumber: data.dotNumber || f.dotNumber,
          mcNumber:  data.mcNumber  || f.mcNumber,
        }))
        setDotSuccess(`✅ Found: ${data.name}${data.status ? ` · ${data.status}` : ''}${data.address ? ` · ${data.address}` : ''}`)
      }
    } catch {
      setDotError('Lookup failed. Check your connection.')
    }
    setDotLooking(false)
  }

  const submit = async (e: any) => {
    e.preventDefault()
    if (editId) {
      await fetch(`/api/companies/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
    } else {
      await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
    }
    setShowForm(false)
    setForm(defaultForm)
    setEditId(null)
    loadData()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this company? This may fail if trucks or loads are assigned to it.')) return
    await fetch(`/api/companies/${id}`, { method: 'DELETE' })
    loadData()
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">Companies</h2>
            <p className="text-gray-400 text-sm mt-1">{companies.length} total</p>
          </div>
          <button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            + Add Company
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
            <form onSubmit={submit} className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{editId ? 'Edit Company' : 'Add Company'}</h3>
                <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wide">Company Name *</label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. 1-9 Transportation"
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wide">DOT Number</label>
                <div className="flex gap-2 mt-1">
                  <input
                    value={form.dotNumber}
                    onChange={e => { setForm({ ...form, dotNumber: e.target.value }); setDotSuccess(''); setDotError('') }}
                    placeholder="e.g. 3456789"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => lookupCarrier('dot')}
                    disabled={dotLooking || !form.dotNumber.trim()}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
                  >
                    {dotLooking ? '...' : '🔍 Lookup'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wide">MC Number</label>
                <div className="flex gap-2 mt-1">
                  <input
                    value={form.mcNumber}
                    onChange={e => { setForm({ ...form, mcNumber: e.target.value }); setDotSuccess(''); setDotError('') }}
                    placeholder="e.g. 1234567"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => lookupCarrier('mc')}
                    disabled={dotLooking || !form.mcNumber.trim()}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
                  >
                    {dotLooking ? '...' : '🔍 Lookup'}
                  </button>
                </div>
              </div>
              {dotError   && <div className="text-red-400 text-xs -mt-2">{dotError}</div>}
              {dotSuccess && <div className="text-green-400 text-xs -mt-2 leading-snug">{dotSuccess}</div>}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm font-medium transition-colors">
                  {editId ? 'Save Changes' : 'Add Company'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg text-sm transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {companies.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">🏢</p>
              <p className="text-sm">No companies yet. Add your first one.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-6 py-3">Name</th>
                  <th className="text-left px-6 py-3">DOT</th>
                  <th className="text-left px-6 py-3">MC</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, i) => (
                  <tr key={c.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${i % 2 === 0 ? '' : 'bg-gray-900/50'}`}>
                    <td className="px-6 py-4 font-medium">{c.name}</td>
                    <td className="px-6 py-4 text-gray-400">{c.dotNumber || '—'}</td>
                    <td className="px-6 py-4 text-gray-400">{c.mcNumber || '—'}</td>
                    <td className="px-6 py-4 text-right space-x-4">
                      <button onClick={() => openEdit(c)} className="text-blue-400 hover:text-blue-300 text-xs font-medium">Edit</button>
                      <button onClick={() => del(c.id)} className="text-red-400 hover:text-red-300 text-xs font-medium">Delete</button>
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
