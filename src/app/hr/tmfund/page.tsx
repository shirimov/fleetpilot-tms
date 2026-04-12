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

const REGIONS = ['Mary', 'Ashgabat', 'Balkan', 'Dashoguz', 'Lebap']
const REGION_COLORS: Record<string, string> = {
  Mary: 'bg-purple-900/50 text-purple-300',
  Ashgabat: 'bg-blue-900/50 text-blue-300',
  Balkan: 'bg-cyan-900/50 text-cyan-300',
  Dashoguz: 'bg-orange-900/50 text-orange-300',
  Lebap: 'bg-green-900/50 text-green-300',
}

const emptyTx = { type: 'DEPOSIT', amount: '', description: '', region: '', date: '', notes: '' }

export default function TmFundPage() {
  const [fund, setFund] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<any>(emptyTx)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('ALL')
  const [regionFilter, setRegionFilter] = useState('ALL')

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

  const txs: any[] = fund?.transactions || []

  // Filter
  let filtered = txs
  if (filter !== 'ALL') filtered = filtered.filter(t => t.type === filter)
  if (regionFilter !== 'ALL') filtered = filtered.filter(t => t.region === regionFilter)

  const totalIn = txs.filter(t => t.type === 'DEPOSIT').reduce((s, t) => s + t.amount, 0)
  const totalOut = txs.filter(t => t.type !== 'DEPOSIT').reduce((s, t) => s + t.amount, 0)

  // Per-region breakdown
  const regionStats = REGIONS.map(r => {
    const deposits = txs.filter(t => t.type === 'DEPOSIT' && t.region === r).reduce((s, t) => s + t.amount, 0)
    const spent = txs.filter(t => t.type !== 'DEPOSIT' && t.region === r).reduce((s, t) => s + t.amount, 0)
    return { region: r, deposits, spent, balance: deposits - spent }
  }).filter(r => r.deposits > 0 || r.spent > 0)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold">🇹🇲 Turkmenistan Fund</h2>
                <p className="text-gray-400 text-sm mt-1">Track money sent to Turkmenistan by region</p>
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

            {/* Top balance cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className={`rounded-xl p-6 border ${(fund?.balance || 0) < 0 ? 'bg-red-900/20 border-red-800' : 'bg-blue-900/20 border-blue-800'}`}>
                <p className="text-gray-400 text-xs uppercase tracking-wide">Total Balance</p>
                <p className={`text-4xl font-bold mt-2 ${(fund?.balance || 0) < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {loading ? '...' : `$${(fund?.balance || 0).toLocaleString()}`}
                </p>
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

            {/* Per-region breakdown */}
            {regionStats.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">By Region</h3>
                <div className="grid grid-cols-5 gap-3">
                  {REGIONS.map(r => {
                    const stat = regionStats.find(s => s.region === r)
                    if (!stat) return (
                      <div key={r} className="bg-gray-800/50 rounded-lg p-3 opacity-40">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${REGION_COLORS[r]}`}>{r}</span>
                        <p className="text-gray-600 text-xs mt-2">No activity</p>
                      </div>
                    )
                    return (
                      <div key={r} className="bg-gray-800 rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-blue-600 transition-all"
                        onClick={() => setRegionFilter(regionFilter === r ? 'ALL' : r)}>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${REGION_COLORS[r]}`}>{r}</span>
                        <p className="text-green-400 font-bold mt-2 text-sm">+${stat.deposits.toLocaleString()}</p>
                        <p className="text-red-400 text-xs">-${stat.spent.toLocaleString()}</p>
                        <p className={`text-xs font-bold mt-1 ${stat.balance < 0 ? 'text-red-300' : 'text-blue-300'}`}>
                          ${stat.balance.toLocaleString()} left
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Filter row */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex gap-2">
                {['ALL', ...TX_TYPES].map(t => (
                  <button key={t} onClick={() => setFilter(t)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {t === 'ALL' ? 'All Types' : TX_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 border-l border-gray-700 pl-4">
                <button onClick={() => setRegionFilter('ALL')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${regionFilter === 'ALL' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                  All Regions
                </button>
                {REGIONS.map(r => (
                  <button key={r} onClick={() => setRegionFilter(regionFilter === r ? 'ALL' : r)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${regionFilter === r ? REGION_COLORS[r] : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Transactions table */}
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
                      <th className="text-left px-6 py-3">Region</th>
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
                        <td className="px-6 py-4">
                          {t.region
                            ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${REGION_COLORS[t.region] || 'bg-gray-800 text-gray-300'}`}>{t.region}</span>
                            : <span className="text-gray-600 text-xs">—</span>}
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
                {form.type === 'DEPOSIT' ? '💸 Send Money' : form.type === 'PAYMENT' ? '💸 Log Payment' : form.type === 'EXPENSE' ? '🧾 Log Expense' : '🔧 Adjustment'}
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
                <label className="text-xs text-gray-400 block mb-1">Region</label>
                <div className="grid grid-cols-5 gap-2">
                  {REGIONS.map(r => (
                    <button key={r} type="button"
                      onClick={() => setForm((f: any) => ({ ...f, region: f.region === r ? '' : r }))}
                      className={`py-2 rounded-lg text-xs font-medium transition-colors border ${form.region === r ? REGION_COLORS[r] + ' border-current' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Amount (USD) *</label>
                <input type="number" value={form.amount} onChange={e => setForm((f: any) => ({ ...f, amount: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Description *</label>
                <input value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder={form.type === 'DEPOSIT' ? 'e.g. Sent via Western Union' : 'e.g. Office rent'} />
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
