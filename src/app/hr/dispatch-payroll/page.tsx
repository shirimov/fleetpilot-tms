'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const WEIGHTS: Record<string, number> = {
  LEAD_DISPATCH: 1700, DISPATCHER: 900, UPDATER: 600,
}
const WEIGHT_OVERRIDES: Record<string, number> = {
  'Begenchmuhammet': 1800, 'ISKENDER': 1800, 'SULEYMAN': 1700,
  'KAKAJAN': 1300, 'BEGENCH': 1300, 'VEPA': 900, 'AYJEREN': 900,
  'BERDIMYRAT': 600, 'HAJY': 600, 'MUHAMMET': 600, 'SELBI': 600,
}
const ROLE_LABELS: Record<string, string> = {
  LEAD_DISPATCH: 'Lead Dispatch', DISPATCHER: 'Dispatcher', UPDATER: 'Updater',
}
const ROLE_COLORS: Record<string, string> = {
  LEAD_DISPATCH: 'bg-indigo-900/50 text-indigo-300',
  DISPATCHER: 'bg-blue-900/50 text-blue-300',
  UPDATER: 'bg-teal-900/50 text-teal-300',
}
const REGION_COLORS: Record<string, string> = {
  Mary: 'bg-purple-900/50 text-purple-300', Ashgabat: 'bg-blue-900/50 text-blue-300',
  Balkan: 'bg-cyan-900/50 text-cyan-300', Dashoguz: 'bg-orange-900/50 text-orange-300',
  Lebap: 'bg-green-900/50 text-green-300',
}

const BASE_POOL = 11500

type Deduction = {
  id: string
  employeeId: string | 'ALL'  // ALL = applies to whole pool before split
  type: 'ESCROW' | 'PENALTY' | 'OTHER'
  amount: string
  description: string
}

export default function DispatchPayrollPage() {
  const [employees, setEmployees] = useState<any[]>([])
  const [escrows, setEscrows] = useState<any[]>([])
  const [reserve, setReserve] = useState<{ total: number; records: any[] }>({ total: 0, records: [] })
  const [loading, setLoading] = useState(true)
  const [pool, setPool] = useState('')
  const [basePool, setBasePool] = useState(String(BASE_POOL))
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [deductFund, setDeductFund] = useState(true)
  const [fundBalance, setFundBalance] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'payroll' | 'escrow'>('payroll')
  const [deductions, setDeductions] = useState<Deduction[]>([])

  // Escrow modal
  const [escrowModal, setEscrowModal] = useState<any>(null)
  const [escrowForm, setEscrowForm] = useState({ type: 'DEPOSIT', amount: '', description: '', date: '' })
  const [escrowSaving, setEscrowSaving] = useState(false)

  const loadAll = () => {
    fetch('/api/employees').then(r => r.json()).then(d => {
      setEmployees(d.filter((e: any) => ['LEAD_DISPATCH', 'DISPATCHER', 'UPDATER'].includes(e.role) && e.isActive))
      setLoading(false)
    })
    fetch('/api/escrow').then(r => r.json()).then(setEscrows)
    fetch('/api/reserve').then(r => r.json()).then(setReserve)
    fetch('/api/tmfund').then(r => r.json()).then(d => setFundBalance(d.balance))
  }
  useEffect(() => { loadAll() }, [])

  const getWeight = (e: any) => WEIGHT_OVERRIDES[e.firstName] ?? (WEIGHTS[e.role] || 0)
  const totalWeight = employees.reduce((s, e) => s + getWeight(e), 0)

  const poolAmt = parseFloat(pool) || 0
  const basePoolAmt = parseFloat(basePool) || BASE_POOL

  // Global deductions (apply to whole pool before split)
  const globalDeductions = deductions.filter(d => d.employeeId === 'ALL')
  const totalGlobalDeductions = globalDeductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0)

  // Per-person deductions
  const getPersonDeductions = (empId: string) =>
    deductions.filter(d => d.employeeId === empId)
  const getPersonDeductionTotal = (empId: string) =>
    getPersonDeductions(empId).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0)

  // After global deductions, what's available to split
  const availableForSplit = Math.max(0, poolAmt - totalGlobalDeductions)
  const reserveAmt = availableForSplit > basePoolAmt ? availableForSplit - basePoolAmt : 0
  const splitPool = availableForSplit - reserveAmt

  const valuePerWeight = totalWeight > 0 ? splitPool / totalWeight : 0

  const calcGrossPay = (e: any) => Math.round(valuePerWeight * getWeight(e) * 100) / 100
  const calcNetPay = (e: any) => Math.max(0, calcGrossPay(e) - getPersonDeductionTotal(e.id))

  const totalGross = employees.reduce((s, e) => s + calcGrossPay(e), 0)
  const totalPersonDeductions = employees.reduce((s, e) => s + getPersonDeductionTotal(e.id), 0)
  const totalNet = employees.reduce((s, e) => s + calcNetPay(e), 0)
  const totalDeductions = totalGlobalDeductions + totalPersonDeductions

  // Add deduction row
  const addDeduction = (empId = 'ALL') => {
    setDeductions(prev => [...prev, {
      id: Math.random().toString(36).slice(2),
      employeeId: empId,
      type: 'ESCROW',
      amount: '',
      description: '',
    }])
  }
  const updateDeduction = (id: string, field: keyof Deduction, value: string) => {
    setDeductions(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d))
  }
  const removeDeduction = (id: string) => setDeductions(prev => prev.filter(d => d.id !== id))

  const handleRun = async () => {
    if (!poolAmt || !period) return
    setSaving(true)

    for (const emp of employees) {
      const gross = calcGrossPay(emp)
      const net = calcNetPay(emp)
      const empDeductions = getPersonDeductions(emp.id)

      // Log payment (net amount)
      await fetch(`/api/employees/${emp.id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: net, currency: 'USD', period, method: 'Bank Transfer', status: 'PAID',
          paidAt: new Date().toISOString().substring(0, 10),
          notes: `Gross: $${gross.toFixed(2)} | Deductions: $${getPersonDeductionTotal(emp.id).toFixed(2)} | Net: $${net.toFixed(2)}`,
        }),
      })

      // Handle per-person escrow deductions
      for (const ded of empDeductions) {
        if (ded.type === 'ESCROW' && parseFloat(ded.amount) > 0) {
          let escrow = escrows.find(es => es.employeeId === emp.id)
          if (!escrow) {
            const res = await fetch('/api/escrow', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ employeeId: emp.id, target: getWeight(emp) }),
            })
            escrow = await res.json()
          }
          await fetch(`/api/escrow/${escrow.id}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'DEPOSIT', amount: ded.amount, description: ded.description || 'Escrow from payroll', date: new Date().toISOString().substring(0, 10) }),
          })
        }
      }
    }

    // Reserve
    if (reserveAmt > 0) {
      await fetch('/api/reserve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: reserveAmt, description: `Reserve from ${period} (pool $${poolAmt} − base $${basePoolAmt})`, period }),
      })
    }

    // TM Fund deduction
    if (deductFund) {
      await fetch('/api/tmfund', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'PAYMENT', amount: totalNet,
          description: `Dispatch payroll net — ${period} (${employees.length} people)`,
          date: new Date().toISOString().substring(0, 10),
          notes: `Pool: $${poolAmt} | Deductions: $${totalDeductions} | Reserve: $${reserveAmt} | Net paid: $${totalNet}`,
        }),
      })
    }

    setSaving(false); setSaved(true); loadAll()
  }

  const openEscrowModal = (emp: any) => {
    setEscrowModal(emp)
    setEscrowForm({ type: 'DEPOSIT', amount: '', description: '', date: new Date().toISOString().substring(0, 10) })
  }

  const saveEscrowTx = async () => {
    setEscrowSaving(true)
    let escrow = escrows.find(es => es.employeeId === escrowModal.id)
    if (!escrow) {
      const res = await fetch('/api/escrow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: escrowModal.id, target: getWeight(escrowModal) }),
      })
      escrow = await res.json()
    }
    await fetch(`/api/escrow/${escrow.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(escrowForm),
    })
    setEscrowSaving(false); setEscrowModal(null); loadAll()
  }

  const getEscrow = (empId: string) => escrows.find(es => es.employeeId === empId)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold">📊 Dispatch Payroll</h2>
              <p className="text-gray-400 text-sm mt-1">Weight-based pay + deductions + reserve + escrow</p>
            </div>

            <div className="flex gap-2 mb-6">
              {(['payroll', 'escrow'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                  {t === 'payroll' ? '💰 Run Payroll' : '🔒 Escrow Accounts'}
                </button>
              ))}
            </div>

            {/* ── PAYROLL TAB ── */}
            {tab === 'payroll' && (
              <>
                {/* Pool inputs */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
                  <div className="grid grid-cols-4 gap-6 items-end">
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">Period</label>
                      <input value={period} onChange={e => { setPeriod(e.target.value); setSaved(false) }}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">Total Pool (USD)</label>
                      <input type="number" value={pool} onChange={e => { setPool(e.target.value); setSaved(false) }}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3 text-lg text-white font-bold" placeholder="e.g. 12645" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">Base Pay Pool <span className="text-gray-600 normal-case">(reserve threshold)</span></label>
                      <input type="number" value={basePool} onChange={e => setBasePool(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3 text-lg text-white font-bold" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">TM Fund</label>
                      <div className={`text-xl font-bold ${fundBalance !== null && fundBalance < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {fundBalance !== null ? `$${fundBalance.toLocaleString()}` : '...'}
                      </div>
                    </div>
                  </div>

                  {/* Summary bar */}
                  {poolAmt > 0 && (
                    <div className="mt-6 pt-5 border-t border-gray-800 grid grid-cols-5 gap-4">
                      <div>
                        <p className="text-gray-500 text-xs uppercase">Total Pool</p>
                        <p className="text-xl font-bold mt-1">${poolAmt.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs uppercase">All Deductions</p>
                        <p className="text-xl font-bold mt-1 text-red-400">−${totalDeductions.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs uppercase">→ Reserve</p>
                        <p className={`text-xl font-bold mt-1 ${reserveAmt > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                          −${reserveAmt.toLocaleString()}
                          <span className="text-xs text-gray-500 ml-1">(total: ${(reserve.total + reserveAmt).toLocaleString()})</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs uppercase">Net Paid Out</p>
                        <p className="text-xl font-bold mt-1 text-green-400">${totalNet.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs uppercase">$/Weight</p>
                        <p className="text-xl font-bold mt-1">${valuePerWeight.toFixed(2)}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Global deductions */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold">Pool-Level Deductions</h3>
                      <p className="text-gray-500 text-xs mt-0.5">Deducted from total pool before splitting among staff</p>
                    </div>
                    <button onClick={() => addDeduction('ALL')} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">+ Add</button>
                  </div>
                  {globalDeductions.length === 0 ? (
                    <p className="text-gray-600 text-sm">No pool-level deductions.</p>
                  ) : (
                    <div className="space-y-2">
                      {globalDeductions.map(d => (
                        <div key={d.id} className="flex gap-3 items-center">
                          <select value={d.type} onChange={e => updateDeduction(d.id, 'type', e.target.value)}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white w-28">
                            <option value="ESCROW">Escrow</option>
                            <option value="PENALTY">Penalty</option>
                            <option value="OTHER">Other</option>
                          </select>
                          <input type="number" placeholder="Amount" value={d.amount} onChange={e => updateDeduction(d.id, 'amount', e.target.value)}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white w-28" />
                          <input placeholder="Description" value={d.description} onChange={e => updateDeduction(d.id, 'description', e.target.value)}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white flex-1" />
                          <button onClick={() => removeDeduction(d.id)} className="text-red-500 hover:text-red-400 text-lg leading-none px-1">×</button>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-gray-800 text-right text-red-400 font-bold text-sm">
                        Total pool deductions: −${totalGlobalDeductions.toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>

                {/* Per-person breakdown */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
                  <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                    <h3 className="font-semibold">Per-Person Breakdown</h3>
                    <p className="text-gray-500 text-sm">{employees.length} people · split pool: ${splitPool.toLocaleString()}</p>
                  </div>
                  {loading ? <div className="p-12 text-center text-gray-500">Loading...</div> : (
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-800">
                        <tr className="text-gray-400 text-xs uppercase">
                          <th className="text-left px-6 py-3">Name</th>
                          <th className="text-left px-6 py-3">Role</th>
                          <th className="text-center px-4 py-3">Weight</th>
                          <th className="text-right px-4 py-3">Gross</th>
                          <th className="text-right px-4 py-3">Deductions</th>
                          <th className="text-right px-6 py-3">Net Pay</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.sort((a, b) => getWeight(b) - getWeight(a)).map(e => {
                          const empDeds = getPersonDeductions(e.id)
                          const dedTotal = getPersonDeductionTotal(e.id)
                          return (
                            <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                              <td className="px-6 py-3">
                                <div className="font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</div>
                                {e.region && <span className={`text-xs px-1.5 py-0.5 rounded-full ${REGION_COLORS[e.region] || ''}`}>{e.region}</span>}
                              </td>
                              <td className="px-6 py-3">
                                <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span>
                              </td>
                              <td className="px-4 py-3 text-center text-gray-400 font-mono text-xs">{getWeight(e)}</td>
                              <td className="px-4 py-3 text-right text-gray-300">
                                {poolAmt > 0 ? `$${calcGrossPay(e).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex flex-col items-end gap-1">
                                  {empDeds.map(d => (
                                    <div key={d.id} className="flex items-center gap-1">
                                      <span className="text-xs text-gray-500">{d.description || d.type}</span>
                                      <span className="text-red-400 text-xs font-medium">−${parseFloat(d.amount || '0').toLocaleString()}</span>
                                      <button onClick={() => removeDeduction(d.id)} className="text-gray-600 hover:text-red-400 text-xs">×</button>
                                    </div>
                                  ))}
                                  <button onClick={() => addDeduction(e.id)}
                                    className="text-xs text-blue-500 hover:text-blue-400 mt-0.5">+ deduct</button>
                                </div>
                              </td>
                              <td className="px-6 py-3 text-right font-bold text-green-400 text-base">
                                {poolAmt > 0 ? `$${calcNetPay(e).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {poolAmt > 0 && (
                        <tfoot className="border-t-2 border-gray-700 bg-gray-800/30">
                          <tr>
                            <td colSpan={3} className="px-6 py-4 text-gray-400 font-medium">Totals</td>
                            <td className="px-4 py-4 text-right text-gray-300 font-bold">${totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="px-4 py-4 text-right text-red-400 font-bold">−${totalPersonDeductions.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right font-bold text-green-400 text-lg">${totalNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                          {reserveAmt > 0 && (
                            <tr className="bg-yellow-900/10">
                              <td colSpan={5} className="px-6 py-2 text-yellow-400 text-sm">+ Reserve saved (not paid out)</td>
                              <td className="px-6 py-2 text-right font-bold text-yellow-400">${reserveAmt.toLocaleString()}</td>
                            </tr>
                          )}
                        </tfoot>
                      )}
                    </table>
                  )}
                </div>

                {/* Run button */}
                {poolAmt > 0 && !saved && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">Run Payroll for {period}</h3>
                        <div className="text-sm text-gray-400 mt-1 space-y-0.5">
                          <p>Pool: <span className="text-white">${poolAmt.toLocaleString()}</span> → Deductions: <span className="text-red-400">−${totalDeductions.toLocaleString()}</span> → Reserve: <span className="text-yellow-400">−${reserveAmt.toLocaleString()}</span> → <span className="text-green-400 font-bold">Net ${totalNet.toLocaleString()}</span></p>
                        </div>
                        <div className="flex items-center gap-3 mt-3">
                          <input type="checkbox" id="deductFund" checked={deductFund} onChange={e => setDeductFund(e.target.checked)} className="w-4 h-4" />
                          <label htmlFor="deductFund" className="text-sm text-gray-300 cursor-pointer">
                            Deduct $<b>{totalNet.toLocaleString()}</b> from TM Fund
                            {fundBalance !== null && <span className="text-gray-500 ml-2">(→ ${(fundBalance - totalNet).toLocaleString()})</span>}
                          </label>
                        </div>
                      </div>
                      <button onClick={handleRun} disabled={saving}
                        className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-8 py-3 rounded-xl font-bold text-base whitespace-nowrap">
                        {saving ? 'Processing...' : `✓ Run — $${totalNet.toLocaleString()}`}
                      </button>
                    </div>
                  </div>
                )}

                {saved && (
                  <div className="bg-green-900/30 border border-green-700 rounded-xl p-6 text-center">
                    <p className="text-green-400 text-xl font-bold">✅ Payroll Complete!</p>
                    <p className="text-gray-400 text-sm mt-2">
                      {employees.length} payments logged · Net paid: ${totalNet.toLocaleString()}
                      {reserveAmt > 0 && ` · $${reserveAmt.toLocaleString()} added to reserve`}
                    </p>
                    <button onClick={() => { setSaved(false); setDeductions([]) }} className="mt-4 text-sm text-blue-400 hover:underline">Run another month</button>
                  </div>
                )}
              </>
            )}

            {/* ── ESCROW TAB ── */}
            {tab === 'escrow' && (
              <>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">🔒 Escrow Accounts</h3>
                    <p className="text-gray-400 text-sm mt-1">Each person holds a balance equal to their pay weight. Deduct when needed.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-500 text-xs uppercase">Total Held</p>
                    <p className="text-2xl font-bold text-blue-400">${escrows.reduce((s, e) => s + e.balance, 0).toLocaleString()}</p>
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-800">
                      <tr className="text-gray-400 text-xs uppercase">
                        <th className="text-left px-6 py-3">Name</th>
                        <th className="text-left px-6 py-3">Role</th>
                        <th className="text-right px-6 py-3">Target</th>
                        <th className="text-right px-6 py-3">Balance</th>
                        <th className="text-right px-6 py-3">Status</th>
                        <th className="text-right px-6 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.sort((a, b) => getWeight(b) - getWeight(a)).map(e => {
                        const escrow = getEscrow(e.id)
                        const target = getWeight(e)
                        const balance = escrow?.balance || 0
                        const pct = target > 0 ? (balance / target) * 100 : 0
                        const status = balance <= 0 ? 'none' : pct >= 100 ? 'full' : 'partial'
                        return (
                          <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="px-6 py-4 font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</td>
                            <td className="px-6 py-4">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span>
                            </td>
                            <td className="px-6 py-4 text-right text-gray-400">${target.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right font-bold">${balance.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${status === 'full' ? 'bg-green-900/50 text-green-300' : status === 'partial' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-red-900/50 text-red-300'}`}>
                                {status === 'full' ? '✓ Full' : status === 'partial' ? `${Math.round(pct)}%` : 'Empty'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button onClick={() => openEscrowModal(e)} className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded">+ / −</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* Escrow modal */}
      {escrowModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold">Escrow — {escrowModal.firstName} {escrowModal.lastName || ''}</h3>
              <button onClick={() => setEscrowModal(null)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-3">
                {['DEPOSIT', 'DEDUCTION'].map(t => (
                  <button key={t} onClick={() => setEscrowForm(f => ({ ...f, type: t }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      escrowForm.type === t
                        ? t === 'DEPOSIT' ? 'bg-green-700 border-green-600 text-white' : 'bg-red-700 border-red-600 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
                    {t === 'DEPOSIT' ? '⬆ Deposit' : '⬇ Deduct'}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Amount *</label>
                <input type="number" value={escrowForm.amount} onChange={e => setEscrowForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Description *</label>
                <input value={escrowForm.description} onChange={e => setEscrowForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder={escrowForm.type === 'DEPOSIT' ? 'Initial deposit' : 'Reason for deduction'} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Date</label>
                <input type="date" value={escrowForm.date} onChange={e => setEscrowForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              {getEscrow(escrowModal.id) && (
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  <p className="text-gray-400">Current: <span className="text-white font-bold">${getEscrow(escrowModal.id).balance.toLocaleString()}</span></p>
                  <p className="text-gray-400 mt-1">After: <span className={`font-bold ${escrowForm.type === 'DEPOSIT' ? 'text-green-400' : 'text-red-400'}`}>
                    ${(getEscrow(escrowModal.id).balance + (escrowForm.type === 'DEPOSIT' ? 1 : -1) * parseFloat(escrowForm.amount || '0')).toLocaleString()}
                  </span></p>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-gray-800 flex gap-3 justify-end">
              <button onClick={() => setEscrowModal(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={saveEscrowTx} disabled={escrowSaving || !escrowForm.amount || !escrowForm.description}
                className={`px-4 py-2 disabled:opacity-50 text-white text-sm rounded-lg font-medium ${escrowForm.type === 'DEPOSIT' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                {escrowSaving ? 'Saving...' : escrowForm.type === 'DEPOSIT' ? 'Deposit' : 'Deduct'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
