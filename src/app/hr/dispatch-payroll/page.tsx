'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const WEIGHTS: Record<string, number> = {
  LEAD_DISPATCH: 18,
  DISPATCHER: 11,
  UPDATER: 7,
}

// Individual overrides by firstName (exact match)
const WEIGHT_OVERRIDES: Record<string, number> = {
  'Begenchmuhammet': 20,
  'BEGENCH': 16,
}

const ROLE_LABELS: Record<string, string> = {
  LEAD_DISPATCH: 'Lead Dispatch',
  DISPATCHER: 'Dispatcher',
  UPDATER: 'Updater',
}

const ROLE_COLORS: Record<string, string> = {
  LEAD_DISPATCH: 'bg-indigo-900/50 text-indigo-300',
  DISPATCHER: 'bg-blue-900/50 text-blue-300',
  UPDATER: 'bg-teal-900/50 text-teal-300',
}

const REGION_COLORS: Record<string, string> = {
  Mary: 'bg-purple-900/50 text-purple-300',
  Ashgabat: 'bg-blue-900/50 text-blue-300',
  Balkan: 'bg-cyan-900/50 text-cyan-300',
  Dashoguz: 'bg-orange-900/50 text-orange-300',
  Lebap: 'bg-green-900/50 text-green-300',
}

export default function DispatchPayrollPage() {
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [pool, setPool] = useState('')
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [deductFund, setDeductFund] = useState(true)
  const [fundBalance, setFundBalance] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then(d => {
        const dispatch = d.filter((e: any) =>
          ['LEAD_DISPATCH', 'DISPATCHER', 'UPDATER'].includes(e.role) && e.isActive
        )
        setEmployees(dispatch)
        setLoading(false)
      })
    fetch('/api/tmfund').then(r => r.json()).then(d => setFundBalance(d.balance))
  }, [])

  const poolAmt = parseFloat(pool) || 0

  // Calculate weights
  const getWeight = (e: any) => WEIGHT_OVERRIDES[e.firstName] ?? (WEIGHTS[e.role] || 0)
  const totalWeight = employees.reduce((s, e) => s + getWeight(e), 0)
  const valuePerWeight = totalWeight > 0 ? poolAmt / totalWeight : 0

  const calcPay = (e: any) => {
    const w = getWeight(e)
    return Math.round(valuePerWeight * w * 100) / 100
  }

  // Group by role for summary
  const roleGroups = ['LEAD_DISPATCH', 'DISPATCHER', 'UPDATER'].map(role => {
    const members = employees.filter(e => e.role === role)
    const pay = valuePerWeight * (WEIGHTS[role] || 0)
    return { role, members, weight: WEIGHTS[role], pay }
  }).filter(g => g.members.length > 0)

  const totalCalc = employees.reduce((s, e) => s + calcPay(e), 0)

  const handleRun = async () => {
    if (!poolAmt || !period) return
    setSaving(true)

    // Log payment for each employee
    for (const emp of employees) {
      const amount = calcPay(emp)
      await fetch(`/api/employees/${emp.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency: 'USD',
          period,
          method: 'Bank Transfer',
          status: 'PAID',
          paidAt: new Date().toISOString().substring(0, 10),
          notes: `Dispatch payroll — pool $${poolAmt.toLocaleString()} — weight ${WEIGHTS[emp.role]}`,
        }),
      })
    }

    // Deduct from TM Fund
    if (deductFund) {
      await fetch('/api/tmfund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'PAYMENT',
          amount: totalCalc,
          description: `Dispatch payroll — ${period} (${employees.length} people)`,
          date: new Date().toISOString().substring(0, 10),
          notes: `Pool: $${poolAmt.toLocaleString()} | Weight: ${totalWeight} | $/weight: $${valuePerWeight.toFixed(2)}`,
        }),
      })
    }

    setSaving(false)
    setSaved(true)
    // Refresh fund balance
    fetch('/api/tmfund').then(r => r.json()).then(d => setFundBalance(d.balance))
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold">📊 Dispatch Payroll Calculator</h2>
              <p className="text-gray-400 text-sm mt-1">Weight-based pay split for Lead Dispatch, Dispatchers &amp; Updaters</p>
            </div>

            {/* Input row */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
              <div className="grid grid-cols-4 gap-6 items-end">
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">Period (YYYY-MM)</label>
                  <input
                    value={period}
                    onChange={e => { setPeriod(e.target.value); setSaved(false) }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="2026-04"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">Total Pay Pool (USD)</label>
                  <input
                    type="number"
                    value={pool}
                    onChange={e => { setPool(e.target.value); setSaved(false) }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3 text-lg text-white font-bold"
                    placeholder="e.g. 12000"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">TM Fund Balance</label>
                  <div className={`text-xl font-bold ${fundBalance !== null && fundBalance < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fundBalance !== null ? `$${fundBalance.toLocaleString()}` : '...'}
                  </div>
                </div>
              </div>

              {poolAmt > 0 && (
                <div className="mt-6 pt-5 border-t border-gray-800 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-gray-500 text-xs uppercase tracking-wide">Total Weight</p>
                    <p className="text-2xl font-bold mt-1">{totalWeight}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs uppercase tracking-wide">Value per Weight</p>
                    <p className="text-2xl font-bold mt-1 text-green-400">${valuePerWeight.toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs uppercase tracking-wide">Total Payout</p>
                    <p className="text-2xl font-bold mt-1 text-green-400">${totalCalc.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Role weight summary */}
            {poolAmt > 0 && (
              <div className="grid grid-cols-3 gap-4 mb-6">
                {roleGroups.map(g => (
                  <div key={g.role} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${ROLE_COLORS[g.role]}`}>{ROLE_LABELS[g.role]}</span>
                      <span className="text-gray-500 text-xs">weight {g.weight} each</span>
                    </div>
                    <p className="text-2xl font-bold text-green-400">${g.pay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-gray-500 text-xs mt-1">{g.members.length} person{g.members.length !== 1 ? 's' : ''} × weight {g.weight}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Per-person breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold">Per-Person Breakdown</h3>
                {poolAmt > 0 && <span className="text-gray-500 text-sm">{employees.length} people</span>}
              </div>
              {loading ? (
                <div className="p-12 text-center text-gray-500">Loading...</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-800">
                    <tr className="text-gray-400 text-xs uppercase">
                      <th className="text-left px-6 py-3">Name</th>
                      <th className="text-left px-6 py-3">Role</th>
                      <th className="text-left px-6 py-3">Region</th>
                      <th className="text-center px-6 py-3">Weight</th>
                      <th className="text-right px-6 py-3">Pay This Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees
                      .sort((a, b) => (WEIGHTS[b.role] || 0) - (WEIGHTS[a.role] || 0))
                      .map(e => (
                        <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                          <td className="px-6 py-4 font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</td>
                          <td className="px-6 py-4">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span>
                          </td>
                          <td className="px-6 py-4">
                            {e.region
                              ? <span className={`text-xs px-2 py-0.5 rounded-full ${REGION_COLORS[e.region] || 'bg-gray-800 text-gray-300'}`}>{e.region}</span>
                              : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-6 py-4 text-center text-gray-400 font-mono">
                            {getWeight(e)}
                            {WEIGHT_OVERRIDES[e.firstName] !== undefined && <span className="text-xs text-yellow-500 ml-1">(custom)</span>}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-green-400 text-base">
                            {poolAmt > 0
                              ? `$${calcPay(e).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : <span className="text-gray-600">—</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  {poolAmt > 0 && (
                    <tfoot className="border-t-2 border-gray-700">
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-gray-400 font-medium">Total</td>
                        <td className="px-6 py-4 text-right font-bold text-green-400 text-lg">${totalCalc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>

            {/* Run payroll button */}
            {poolAmt > 0 && !saved && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Run Payroll for {period}</h3>
                    <p className="text-gray-400 text-sm mt-1">This will log payments for all {employees.length} dispatch staff and optionally deduct from TM Fund.</p>
                    <div className="flex items-center gap-3 mt-3">
                      <input type="checkbox" id="deductFund" checked={deductFund} onChange={e => setDeductFund(e.target.checked)} className="w-4 h-4" />
                      <label htmlFor="deductFund" className="text-sm text-gray-300 cursor-pointer">
                        Deduct ${totalCalc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from TM Fund
                        {fundBalance !== null && <span className="text-gray-500 ml-2">(balance: ${fundBalance.toLocaleString()} → ${(fundBalance - totalCalc).toLocaleString()})</span>}
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={handleRun}
                    disabled={saving}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-8 py-3 rounded-xl font-bold text-base transition-colors"
                  >
                    {saving ? 'Processing...' : `✓ Run Payroll — $${totalCalc.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                  </button>
                </div>
              </div>
            )}

            {saved && (
              <div className="bg-green-900/30 border border-green-700 rounded-xl p-6 text-center">
                <p className="text-green-400 text-xl font-bold">✅ Payroll Complete!</p>
                <p className="text-gray-400 text-sm mt-2">All {employees.length} payments logged for {period}. Check payment history in Employees.</p>
                <button onClick={() => setSaved(false)} className="mt-4 text-sm text-blue-400 hover:underline">Run another month</button>
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  )
}
