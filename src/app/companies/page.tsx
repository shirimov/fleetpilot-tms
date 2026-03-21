'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', dotNumber: '', mcNumber: '' })

  const load = () => fetch('/api/companies').then(r => r.json()).then(setCompanies)
  useEffect(() => { load() }, [])

  const submit = async (e: any) => {
    e.preventDefault()
    await fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setForm({ name: '', dotNumber: '', mcNumber: '' })
    setShowForm(false)
    load()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this company?')) return
    await fetch(`/api/companies/${id}`, { method: 'DELETE' })
    load()
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
          <button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium">
            + Add Company
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <form onSubmit={submit} className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4">
              <h3 className="font-bold text-lg">Add Company</h3>
              <div>
                <label className="text-xs text-gray-400 uppercase">Company Name *</label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">DOT Number</label>
                <input value={form.dotNumber} onChange={e => setForm({ ...form, dotNumber: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase">MC Number</label>
                <input value={form.mcNumber} onChange={e => setForm({ ...form, mcNumber: e.target.value })}
                  className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm font-medium">Save</button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg text-sm">Cancel</button>
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
                <tr className="text-gray-400 text-xs uppercase">
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
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => del(c.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
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
