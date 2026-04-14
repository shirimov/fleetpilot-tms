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
  LEAD_DISPATCH: 'bg-indigo-900/50 text-indigo-300',
  DISPATCHER: 'bg-blue-900/50 text-blue-300',
  UPDATER: 'bg-teal-900/50 text-teal-300',
  MANAGER: 'bg-purple-900/50 text-purple-300',
  ACCOUNTANT: 'bg-green-900/50 text-green-300',
  SAFETY: 'bg-orange-900/50 text-orange-300',
  ADMIN: 'bg-yellow-900/50 text-yellow-300',
  OTHER: 'bg-gray-700 text-gray-300',
}

const WEIGHTS: Record<string, number> = { LEAD_DISPATCH: 1700, DISPATCHER: 900, UPDATER: 600 }
const WEIGHT_OVERRIDES: Record<string, number> = {
  'Begenchmuhammet': 1800, 'ISKENDER': 1800, 'SULEYMAN': 1700,
  'KAKAJAN': 1300, 'BEGENCH': 1300, 'VEPA': 900, 'AYJEREN': 900,
  'BERDIMYRAT': 600, 'HAJY': 600, 'MUHAMMET': 600, 'SELBI': 600,
}

export default function PayrollPage() {
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dispatchPool, setDispatchPool] = useState('')
  const [fundBalance, setFundBalance] = useState<number | null>(null)
  const [savingFixed, setSavingFixed] = useState<string | null>(null)

  const now = new Date()
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [period, setPeriod] = useState(currentPeriod)

  const load = () => {
    fetch('/api/employees').then(r => r.json()).then(d => { setEmployees(d); setLoading(false) })
    fetch('/api/tmfund').then(r => r.json()).then(d => setFundBalance(d.balance))
  }
  useEffect(() => { load() }, [])

  const getWeight = (e: any) => WEIGHT_OVERRIDES[e.firstName] ?? (WEIGHTS[e.role] || 0)

  const activeEmployees = employees.filter(e => e.isActive)
  const dispatchTeam = activeEmployees.filter(e => DISPATCH_ROLES.includes(e.role))
  const fixedTeam = activeEmployees.filter(e => FIXED_ROLES.includes(e.role))

  // Dispatch pay calculation
  const totalWeight = dispatchTeam.reduce((s, e) => s + getWeight(e), 0)
  const poolAmt = parseFloat(dispatchPool) || 0
  const valuePerWeight = totalWeight > 0 && poolAmt > 0 ? poolAmt / totalWeight : 0
  const calcDispatchPay = (e: any) => poolAmt > 0 ? Math.round(valuePerWeight * getWeight(e) * 100) / 100 : null

  // Fixed salary totals
  const totalFixedSalary = fixedTeam.reduce((s, e) => s + (e.salary || 0), 0)
  const totalDispatchPay = poolAmt > 0 ? dispatchTeam.reduce((s, e) => s + (calcDispatchPay(e) || 0), 0) : 0
  const grandTotal = totalFixedSalary + totalDispatchPay

  // Payment status this period
  const paidThisPeriod = (e: any) =>
    (e.payments || []).some((p: any) => p.period === period && p.status === 'PAID')

  const markFixedPaid = async (emp: any) => {
    setSavingFixed(emp.id)
    await fetch(`/api/employees/${emp.id}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: emp.salary, currency: emp.currency || 'USD',
        period, method: 'Bank Transfer', status: 'PAID',
        paidAt: new Date().toISOString().substring(0, 10),
        notes: 'Fixed salary payment',
      }),
    })
    setSavingFixed(null)
    load()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold">💰 Payroll Overview</h2>
                <p className="text-gray-400 text-sm mt-1">All staff — fixed salary + dispatch team</p>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Period</label>
                  <input value={period} onChange={e => setPeriod(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-28" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">TM Fund</label>
                  <div className={`text-lg font-bold ${fundBalance !== null && fundBalance < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fundBalance !== null ? `$${fundBalance.toLocaleString()}` : '...'}
                  </div>
                </div>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Total Staff</p>
                <p className="text-3xl font-bold mt-2">{activeEmployees.length}</p>
                <p className="text-gray-500 text-xs mt-1">{fixedTeam.length} fixed · {dispatchTeam.length} dispatch</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Fixed Salaries</p>
                <p className="text-3xl font-bold mt-2 text-green-400">${totalFixedSalary.toLocaleString()}</p>
                <p className="text-gray-500 text-xs mt-1">{fixedTeam.length} people</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Dispatch Pool</p>
                {poolAmt > 0
                  ? <p className="text-3xl font-bold mt-2 text-blue-400">${totalDispatchPay.toLocaleString()}</p>
                  : <p className="text-3xl font-bold mt-2 text-gray-600">—</p>}
                <p className="text-gray-500 text-xs mt-1">{dispatchTeam.length} people</p>
              </div>
              <div className={`rounded-xl p-5 border ${grandTotal > 0 ? 'bg-gray-900 border-gray-800' : 'bg-gray-900 border-gray-800'}`}>
                <p className="text-gray-400 text-xs uppercase tracking-wide">Grand Total</p>
                <p className="text-3xl font-bold mt-2 text-yellow-400">{grandTotal > 0 ? `$${grandTotal.toLocaleString()}` : '—'}</p>
                <p className="text-gray-500 text-xs mt-1">this month</p>
              </div>
            </div>

            {/* ── FIXED SALARY TEAM ── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold">Fixed Salary Staff</h3>
                <span className="text-gray-500 text-sm">${totalFixedSalary.toLocaleString()}/month</span>
              </div>
              {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-800">
                    <tr className="text-gray-400 text-xs uppercase">
                      <th className="text-left px-6 py-3">Name</th>
                      <th className="text-left px-6 py-3">Role</th>
                      <th className="text-right px-6 py-3">Salary</th>
                      <th className="text-right px-6 py-3">Status</th>
                      <th className="text-right px-6 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixedTeam.map(e => {
                      const paid = paidThisPeriod(e)
                      return (
                        <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                          <td className="px-6 py-4 font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</td>
                          <td className="px-6 py-4">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {e.salary
                              ? <span className="text-green-400 font-bold">${e.salary.toLocaleString()}</span>
                              : <span className="text-gray-600">Not set</span>}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${paid ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'}`}>
                              {paid ? '✓ Paid' : 'Pending'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {!paid && e.salary ? (
                              <button
                                onClick={() => markFixedPaid(e)}
                                disabled={savingFixed === e.id}
                                className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">
                                {savingFixed === e.id ? 'Saving...' : `Mark Paid $${e.salary.toLocaleString()}`}
                              </button>
                            ) : paid ? (
                              <span className="text-gray-600 text-xs">✓ done</span>
                            ) : (
                              <span className="text-gray-600 text-xs">No salary set</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t border-gray-700 bg-gray-800/20">
                    <tr>
                      <td colSpan={2} className="px-6 py-3 text-gray-400 text-sm">Total Fixed</td>
                      <td className="px-6 py-3 text-right font-bold text-green-400">${totalFixedSalary.toLocaleString()}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* ── DISPATCH TEAM ── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Dispatch Team</h3>
                  <p className="text-gray-500 text-xs mt-0.5">Weight-based — enter pool to see individual amounts</p>
                </div>
                <div className="flex items-center gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Dispatch Pool (USD)</label>
                    <input type="number" value={dispatchPool} onChange={e => setDispatchPool(e.target.value)}
                      placeholder="e.g. 11500"
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-36 font-bold" />
                  </div>
                  <Link href="/hr/dispatch-payroll"
                    className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-2 rounded-lg self-end">
                    Full Payroll →
                  </Link>
                </div>
              </div>
              {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-800">
                    <tr className="text-gray-400 text-xs uppercase">
                      <th className="text-left px-6 py-3">Name</th>
                      <th className="text-left px-6 py-3">Role</th>
                      <th className="text-center px-4 py-3">Weight</th>
                      <th className="text-right px-6 py-3">Est. Pay</th>
                      <th className="text-right px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatchTeam.sort((a, b) => getWeight(b) - getWeight(a)).map(e => {
                      const pay = calcDispatchPay(e)
                      const paid = paidThisPeriod(e)
                      return (
                        <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                          <td className="px-6 py-4 font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</td>
                          <td className="px-6 py-4">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span>
                          </td>
                          <td className="px-4 py-4 text-center text-gray-400 font-mono text-xs">{getWeight(e)}</td>
                          <td className="px-6 py-4 text-right font-bold">
                            {pay !== null
                              ? <span className="text-blue-400">${pay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              : <span className="text-gray-600">Enter pool →</span>}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${paid ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                              {paid ? '✓ Paid' : '—'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {poolAmt > 0 && (
                    <tfoot className="border-t border-gray-700 bg-gray-800/20">
                      <tr>
                        <td colSpan={3} className="px-6 py-3 text-gray-400 text-sm">Total Dispatch</td>
                        <td className="px-6 py-3 text-right font-bold text-blue-400">${totalDispatchPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>

            {/* Grand total bar */}
            {grandTotal > 0 && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 flex items-center justify-between">
                <div className="flex gap-8">
                  <div>
                    <p className="text-gray-500 text-xs uppercase">Fixed Salaries</p>
                    <p className="text-xl font-bold text-green-400">${totalFixedSalary.toLocaleString()}</p>
                  </div>
                  <div className="text-gray-600 text-2xl self-center">+</div>
                  <div>
                    <p className="text-gray-500 text-xs uppercase">Dispatch Pool</p>
                    <p className="text-xl font-bold text-blue-400">${totalDispatchPay.toLocaleString()}</p>
                  </div>
                  <div className="text-gray-600 text-2xl self-center">=</div>
                  <div>
                    <p className="text-gray-500 text-xs uppercase">Total This Month</p>
                    <p className="text-2xl font-bold text-yellow-400">${grandTotal.toLocaleString()}</p>
                  </div>
                </div>
                {fundBalance !== null && (
                  <div className="text-right">
                    <p className="text-gray-500 text-xs uppercase">TM Fund After Payroll</p>
                    <p className={`text-xl font-bold ${(fundBalance - grandTotal) < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      ${(fundBalance - grandTotal).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  )
}
