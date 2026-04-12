'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const TX_TYPES = ['DEPOSIT', 'PAYMENT', 'EXPENSE', 'ADJUSTMENT']
const TX_LABELS: Record<string, string> = {
  DEPOSIT: '⬆ Deposit', PAYMENT: '💸 Payment', EXPENSE: '🧾 Expense', ADJUSTMENT: '🔧 Adjustment'
}
const TX_COLORS: Record<string, string> = {
  DEPOSIT: 'text-green-400', PAYMENT: 'text-red-400', EXPENSE: 'text-orange-400', ADJUSTMENT: 'text-blue-400'
}

const emptyTx = { type: 'DEPOSIT', amount: '', description: '', date: '', notes: '' }

export default function TmFundPage() {
  const [fund, setFund] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<any>(emptyTx)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('ALL')

  const load = () => {
    fetch('/api/tmfund').then(r => r.json()).then(d => { setFund(d); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const openAdd = (type = 'DEPOSIT') => {
    setForm({ ...emptyTx, type, date: new Date().toISOString().substring(0, 10) })
    setShowModal(true)
  }

  const save = async () => {
    setSaving(true)
    await fetch('/api/tmfund', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false); setShowModal(false); load()
  }

  const txs = fund?.transactions || []
  const filtered = filter === 'ALL' ? txs : txs.filter((t: any) => t.type === filter)

  const totalIn = txs.filter((t: any) => t.type === 'DEPOSIT').reduce((s: number, t: any) => s + t.amount, 0)
  const totalOut = txs.filter((t: any) => t.type !== 'DEPOSIT').reduce((s: number, t: any) => s + t.amount, 0)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold">🇹🇲 Turkmenistan Fund</h2>
                <p className="text-gray-400 text-sm mt-1">Track money sent to Turkmenistan and how it's used</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openAdd('EXPENSE')} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  + Log Expense
                </button>
                <button onClick={() => openAdd('DEPOSIT')} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  + Send Money
                </button>
              </div>
            </div>

            {/* Balance cards */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className={`rounded-xl p-6 border ${fund?.balance < 0 ? 'bg-red-900/20 border-red-800' : 'bg-blue-900/20 border-blue-800'}`}>
                <p className="text-gray-400 text-xs uppercase tracking-wide">Current Balance</p>
                <p className={`text-4xl font-bold mt-2 ${fund?.balance < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {loading ? '...' : `$${(fund?.balance || 0).toLocaleString()}`}
                </p>
                <p className="text-gray-500 text-xs mt-1">{fund?.currency || 'USD'}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Total Sent</p>
                <p className="text-3xl font-bold mt-2 text-green-400">${totalIn.toLocaleString()}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Total Used</p>
                <p className="text-3xl font-bold mt-2 text-red-400">${totalOut.toLocaleString()}</p>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 mb-4">
              {['ALL', ...TX_TYPES].map(t => (
                <button key={t} onClick={() => setFilter(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                  {t === 'ALL' ? 'All' : TX_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Transactions */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-gray-500">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <p className="text-4xl mb-3">🇹🇲</p>
                  <p>No transactions yet. Send some money to get started!</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-800">
                    <tr className="text-gray-400 text-xs uppercase">
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-6 py-3">Type</th>
                      <th className="text-left px-6 py-3">Description</th>
                      <th className="text-right px-6 py-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t: any) => (
                      <tr key={t.id} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="px-6 py-4 text-gray-400 text-xs whitespace-nowrap">
                          {new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs font-medium ${TX_COLORS[t.type]}`}>{TX_LABELS[t.type]}</span>
                        </td>
                        <td className="px-6 py-4 text-gray-300">
                          {t.description}
                          {t.notes && <div className="text-gray-500 text-xs mt-0.5">{t.notes}</div>}
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${t.type === 'DEPOSIT' ? 'text-green-400' : 'text-red-400'}`}>
                          {t.type === 'DEPOSIT' ? '+' : '-'}${t.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Add Transaction Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold text-lg">
                {form.type === 'DEPOSIT' ? '💸 Send Money to TM' : form.type === 'PAYMENT' ? '💸 Log Payment' : form.type === 'EXPENSE' ? '🧾 Log Expense' : '🔧 Adjustment'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Type</label>
                <select value={form.type} onChange={e => setForm((f: any) => ({ ...f, type: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {TX_TYPES.map(t => <option key={t} value={t}>{TX_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Amount (USD) *</label>
                <input type="number" value={form.amount} onChange={e => setForm((f: any) => ({ ...f, amount: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Description *</label>
                <input value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Sent via Western Union" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Date</label>
                <input type="date" value={form.date} onChange={e => setForm((f: any) => ({ ...f, date: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
            <div className="p-6 border-t border-gray-800 flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={save} disabled={saving || !form.amount || !form.description}
                className={`px-4 py-2 disabled:opacity-50 text-white text-sm rounded-lg font-medium ${form.type === 'DEPOSIT' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
