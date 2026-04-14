'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'

const DISPATCH_ROLES = ['LEAD_DISPATCH', 'DISPATCHER', 'UPDATER']
const FIXED_ROLES = ['MANAGER', 'ACCOUNTANT', 'SAFETY', 'ADMIN', 'OTHER']
const ROLE_LABELS: Record<string, string> = {
  LEAD_DISPATCH: 'Lead Dispatch', DISPATCHER: 'Dispatcher', UPDATER: 'Updater',
  MANAGER: 'Manager', ACCOUNTANT: 'Accountant', SAFETY: 'Safety', ADMIN: 'Admin', OTHER: 'Other',
}
const ROLE_COLORS: Record<string, string> = {
  LEAD_DISPATCH: 'bg-indigo-900/50 text-indigo-300', DISPATCHER: 'bg-blue-900/50 text-blue-300',
  UPDATER: 'bg-teal-900/50 text-teal-300', MANAGER: 'bg-purple-900/50 text-purple-300',
  ACCOUNTANT: 'bg-green-900/50 text-green-300', SAFETY: 'bg-orange-900/50 text-orange-300',
  ADMIN: 'bg-yellow-900/50 text-yellow-300', OTHER: 'bg-gray-700 text-gray-300',
}
const WEIGHT_OVERRIDES: Record<string, number> = {
  'Begenchmuhammet': 1800, 'ISKENDER': 1800, 'SULEYMAN': 1700,
  'KAKAJAN': 1300, 'BEGENCH': 1300, 'VEPA': 900, 'AYJEREN': 900,
  'BERDIMYRAT': 600, 'HAJY': 600, 'MUHAMMET': 600, 'SELBI': 600,
}
const BASE_WEIGHTS: Record<string, number> = { LEAD_DISPATCH: 1700, DISPATCHER: 900, UPDATER: 600 }

function getWeight(e: any) {
  return WEIGHT_OVERRIDES[e.firstName] ?? (BASE_WEIGHTS[e.role] || 0)
}

function prevPeriod(p: string) {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextPeriod(p: string) {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function PayrollPage() {
  const now = new Date()
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(defaultPeriod)
  const [dispatchPool, setDispatchPool] = useState('')
  const [fundBalance, setFundBalance] = useState<number | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadData = (p: string) => {
    setLoading(true)
    fetch('/api/employees').then(r => r.json()).then(d => {
      setEmployees(d)
      setLoading(false)
      const dispatch = d.filter((e: any) => DISPATCH_ROLES.includes(e.role) && e.isActive)
      const total = dispatch.reduce((s: number, e: any) => {
        const pay = (e.payments || []).find((x: any) => x.period === p)
        return s + (pay?.amount || 0)
      }, 0)
      if (total > 0) setDispatchPool(String(total))
    })
    fetch('/api/tmfund').then(r => r.json()).then(d => setFundBalance(d.balance))
  }

  useEffect(() => { loadData(period) }, [])

  const changePeriod = (p: string) => {
    setPeriod(p)
    setDispatchPool('')
    loadData(p)
  }

  const active = employees.filter(e => e.isActive)
  const fixed = active.filter(e => FIXED_ROLES.includes(e.role))
  const dispatch = active.filter(e => DISPATCH_ROLES.includes(e.role)).sort((a, b) => getWeight(b) - getWeight(a))

  const totalWeight = dispatch.reduce((s, e) => s + getWeight(e), 0)
  const pool = parseFloat(dispatchPool) || 0
  const vpw = totalWeight > 0 && pool > 0 ? pool / totalWeight : 0

  function getPayment(e: any) {
    return (e.payments || []).find((p: any) => p.period === period)
  }
  function getAmount(e: any): number {
    const pay = getPayment(e)
    if (pay) return pay.amount
    if (DISPATCH_ROLES.includes(e.role)) return pool > 0 ? Math.round(vpw * getWeight(e) * 100) / 100 : 0
    return e.salary || 0
  }
  function isPaid(e: any) { return getPayment(e)?.status === 'PAID' }

  const totalFixed = fixed.reduce((s, e) => s + (e.salary || 0), 0)
  const totalDispatch = dispatch.reduce((s, e) => s + getAmount(e), 0)
  const grandTotal = totalFixed + totalDispatch

  async function approveAll() {
    setApproving(true)
    for (const e of [...fixed, ...dispatch]) {
      if (getPayment(e)) continue
      const amt = getAmount(e)
      if (!amt) continue
      await fetch(`/api/employees/${e.id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, currency: 'USD', period, method: 'Bank Transfer', status: 'PENDING', paidAt: null, notes: '' }),
      })
    }
    setApproving(false)
    loadData(period)
  }

  async function markPaid(e: any) {
    setSavingId(e.id)
    const existing = getPayment(e)
    if (existing) {
      await fetch(`/api/employees/${e.id}/payments/${existing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAID', paidAt: new Date().toISOString().substring(0, 10) }),
      })
    } else {
      const amt = getAmount(e)
      await fetch(`/api/employees/${e.id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, currency: 'USD', period, method: 'Bank Transfer', status: 'PAID', paidAt: new Date().toISOString().substring(0, 10), notes: '' }),
      })
    }
    setSavingId(null)
    loadData(period)
  }

  const allApproved = [...fixed, ...dispatch].every(e => !!getPayment(e))

  function buildShareText() {
    const rows = [...fixed, ...dispatch].map((e, i) => {
      const amt = getAmount(e)
      const city = e.city || e.region || '—'
      return `${i + 1}. ${e.firstName}${e.lastName ? ' ' + e.lastName : ''}  |  $${amt.toLocaleString()}  |  ${city}`
    })
    const total = [...fixed, ...dispatch].reduce((s, e) => s + getAmount(e), 0)
    return `📋 Salary List — ${period}\n\n${rows.join('\n')}\n\nTotal: $${total.toLocaleString()}`
  }

  function copy() {
    navigator.clipboard.writeText(buildShareText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">💰 Payroll</h2>
                <p className="text-gray-400 text-sm mt-1">All staff — fixed + dispatch</p>
              </div>
              <div className="flex items-center gap-4">
                {/* Period */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Period</label>
                  <div className="flex items-center gap-1">
                    <button onClick={() => changePeriod(prevPeriod(period))} className="bg-gray-800 hover:bg-gray-700 text-white px-2 py-1.5 rounded-lg text-sm">‹</button>
                    <input value={period} onChange={e => changePeriod(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white w-24 text-center" />
                    <button onClick={() => changePeriod(nextPeriod(period))} className="bg-gray-800 hover:bg-gray-700 text-white px-2 py-1.5 rounded-lg text-sm">›</button>
                  </div>
                </div>
                {/* Pool */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Dispatch Pool</label>
                  <input type="number" value={dispatchPool} onChange={e => setDispatchPool(e.target.value)} placeholder="e.g. 11500" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-32 font-bold" />
                </div>
                {/* TM Fund */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">TM Fund</label>
                  <div className={`text-lg font-bold ${fundBalance !== null && fundBalance < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fundBalance !== null ? `$${fundBalance.toLocaleString()}` : '...'}
                  </div>
                </div>
                <button onClick={() => setShareOpen(true)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium self-end">📤 Share</button>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Total Staff</p>
                <p className="text-3xl font-bold mt-2">{active.length}</p>
                <p className="text-gray-500 text-xs mt-1">{fixed.length} fixed · {dispatch.length} dispatch</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Fixed Salaries</p>
                <p className="text-3xl font-bold mt-2 text-green-400">${totalFixed.toLocaleString()}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Dispatch</p>
                <p className={`text-3xl font-bold mt-2 ${totalDispatch > 0 ? 'text-blue-400' : 'text-gray-600'}`}>{totalDispatch > 0 ? `$${totalDispatch.toLocaleString()}` : '—'}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Grand Total</p>
                <p className={`text-3xl font-bold mt-2 ${grandTotal > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>{grandTotal > 0 ? `$${grandTotal.toLocaleString()}` : '—'}</p>
              </div>
            </div>

            {/* Approve All */}
            {!allApproved && (
              <div className="bg-gray-900 border border-blue-800/50 rounded-xl p-4 mb-6 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Approve payroll for <span className="text-blue-400">{period}</span></p>
                  <p className="text-gray-500 text-xs mt-0.5">Locks in amounts as Pending. Then mark each person paid individually.
                    {pool === 0 && dispatch.some(e => !getPayment(e)) && <span className="text-yellow-400"> Enter dispatch pool to include dispatch team.</span>}
                  </p>
                </div>
                <button onClick={approveAll} disabled={approving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-bold ml-6 whitespace-nowrap">
                  {approving ? 'Approving...' : '✓ Approve All'}
                </button>
              </div>
            )}

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-800">
                  <tr className="text-gray-400 text-xs uppercase">
                    <th className="text-left px-6 py-3">Name</th>
                    <th className="text-left px-6 py-3">Role</th>
                    <th className="text-left px-6 py-3">City</th>
                    <th className="text-right px-6 py-3">Amount</th>
                    <th className="text-right px-6 py-3">Status</th>
                    <th className="text-right px-6 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-gray-800/40">
                    <td colSpan={6} className="px-6 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Fixed Salary — ${totalFixed.toLocaleString()}/month</td>
                  </tr>
                  {loading ? (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
                  ) : fixed.map(e => {
                    const paid = isPaid(e)
                    const amt = getAmount(e)
                    return (
                      <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="px-6 py-4 font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</td>
                        <td className="px-6 py-4"><span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span></td>
                        <td className="px-6 py-4 text-gray-400 text-sm">{e.city || e.region || '—'}</td>
                        <td className="px-6 py-4 text-right font-bold text-green-400">{amt ? `$${amt.toLocaleString()}` : <span className="text-gray-600">Not set</span>}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${paid ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'}`}>{paid ? '✓ Paid' : 'Pending'}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {paid ? <span className="text-gray-600 text-xs">✓</span> : (
                            <button onClick={() => markPaid(e)} disabled={savingId === e.id} className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
                              {savingId === e.id ? '...' : 'Mark Paid'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}

                  <tr className="bg-gray-800/40">
                    <td colSpan={6} className="px-6 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Dispatch Team — {totalDispatch > 0 ? `$${totalDispatch.toLocaleString()}` : 'Enter pool above'}
                      <Link href="/hr/dispatch-payroll" className="ml-3 text-blue-500 hover:text-blue-400 normal-case font-normal">Run dispatch payroll →</Link>
                    </td>
                  </tr>
                  {!loading && dispatch.map(e => {
                    const paid = isPaid(e)
                    const amt = getAmount(e)
                    return (
                      <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="px-6 py-4 font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</td>
                        <td className="px-6 py-4"><span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span></td>
                        <td className="px-6 py-4 text-gray-400 text-sm">{e.city || e.region || '—'}</td>
                        <td className="px-6 py-4 text-right font-bold text-blue-400">{amt ? `$${amt.toLocaleString()}` : <span className="text-gray-600">—</span>}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${paid ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'}`}>{paid ? '✓ Paid' : 'Pending'}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {paid ? <span className="text-gray-600 text-xs">✓</span> : (
                            <button onClick={() => markPaid(e)} disabled={savingId === e.id} className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
                              {savingId === e.id ? '...' : 'Mark Paid'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {grandTotal > 0 && (
                  <tfoot className="border-t-2 border-gray-700 bg-gray-800/20">
                    <tr>
                      <td colSpan={3} className="px-6 py-4 font-semibold text-gray-300">Grand Total</td>
                      <td className="px-6 py-4 text-right font-bold text-yellow-400 text-lg">${grandTotal.toLocaleString()}</td>
                      <td colSpan={2} className="px-6 py-4 text-right text-gray-500 text-xs">
                        {fundBalance !== null && `TM Fund after: $${(fundBalance - grandTotal).toLocaleString()}`}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

          </div>
        </main>
      </div>

      {/* Share modal */}
      {shareOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold">📤 Salary List — {period}</h3>
              <button onClick={() => setShareOpen(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6">
              <pre className="bg-gray-800 rounded-lg p-4 text-sm text-gray-200 whitespace-pre-wrap font-mono leading-relaxed overflow-y-auto max-h-96">{buildShareText()}</pre>
              <div className="flex gap-3 mt-4">
                <button onClick={copy} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                  {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
                </button>
                <button onClick={() => setShareOpen(false)} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
