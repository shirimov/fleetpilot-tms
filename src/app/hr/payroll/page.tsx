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
  const [savingId, setSavingId] = useState<string | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [shareModal, setShareModal] = useState(false)
  const [copied, setCopied] = useState(false)

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
  const dispatchTeam = activeEmployees.filter(e => DISPATCH_ROLES.includes(e.role)).sort((a, b) => getWeight(b) - getWeight(a))
  const fixedTeam = activeEmployees.filter(e => FIXED_ROLES.includes(e.role))

  const totalWeight = dispatchTeam.reduce((s, e) => s + getWeight(e), 0)
  const poolAmt = parseFloat(dispatchPool) || 0
  const valuePerWeight = totalWeight > 0 && poolAmt > 0 ? poolAmt / totalWeight : 0
  const calcDispatchPay = (e: any): number | null =>
    poolAmt > 0 ? Math.round(valuePerWeight * getWeight(e) * 100) / 100 : null

  const totalFixedSalary = fixedTeam.reduce((s, e) => s + (e.salary || 0), 0)
  // Use approved amounts from DB if available, otherwise use pool calculation
  const getDispatchAmount = (e: any): number => {
    const approved = getPayment(e)?.amount
    if (approved) return approved
    return calcDispatchPay(e) || 0
  }
  const totalDispatchPay = dispatchTeam.reduce((s, e) => s + getDispatchAmount(e), 0)
  const grandTotal = totalFixedSalary + totalDispatchPay

  // Payment lookup for current period
  const getPayment = (e: any) => (e.payments || []).find((p: any) => p.period === period)
  const isPaid = (e: any) => getPayment(e)?.status === 'PAID'
  const isApproved = (e: any) => !!getPayment(e) // has a payment record = approved

  // For dispatch: approved amount comes from payment record if exists, else from calc
  const getApprovedAmount = (e: any) => getPayment(e)?.amount ?? calcDispatchPay(e)

  const logPayment = async (emp: any, amount: number, status: 'PENDING' | 'PAID') => {
    await fetch(`/api/employees/${emp.id}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount, currency: emp.currency || 'USD', period,
        method: 'Bank Transfer', status,
        paidAt: status === 'PAID' ? new Date().toISOString().substring(0, 10) : null,
        notes: DISPATCH_ROLES.includes(emp.role) ? `Dispatch payroll | weight ${getWeight(emp)}` : 'Fixed salary',
      }),
    })
  }

  const approveAll = async () => {
    setApprovingAll(true)
    for (const emp of fixedTeam) {
      if (!isApproved(emp) && emp.salary) await logPayment(emp, emp.salary, 'PENDING')
    }
    if (poolAmt > 0) {
      for (const emp of dispatchTeam) {
        const pay = calcDispatchPay(emp)
        if (!isApproved(emp) && pay) await logPayment(emp, pay, 'PENDING')
      }
    }
    setApprovingAll(false)
    load()
  }

  const markPaid = async (emp: any) => {
    setSavingId(emp.id)
    const existing = getPayment(emp)
    if (existing) {
      // PATCH existing payment to PAID
      await fetch(`/api/employees/${emp.id}/payments/${existing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAID', paidAt: new Date().toISOString().substring(0, 10) }),
      })
    } else {
      const amount = DISPATCH_ROLES.includes(emp.role) ? calcDispatchPay(emp) : emp.salary
      if (amount) await logPayment(emp, amount, 'PAID')
    }
    setSavingId(null)
    load()
  }

  // Build share list
  const buildShareList = () => {
    const all = [
      ...fixedTeam.map(e => ({ name: `${e.firstName}${e.lastName ? ' ' + e.lastName : ''}`, amount: getApprovedAmount(e) ?? e.salary ?? 0, city: e.city || e.region || '—' })),
      ...dispatchTeam.map(e => ({ name: `${e.firstName}${e.lastName ? ' ' + e.lastName : ''}`, amount: getApprovedAmount(e) ?? 0, city: e.city || e.region || '—' })),
    ].filter(e => e.amount > 0)
    return [
      `📋 Salary List — ${period}`, '',
      ...all.map((e, i) => `${i + 1}. ${e.name}  |  $${e.amount.toLocaleString()}  |  ${e.city}`),
      '', `Total: $${all.reduce((s, e) => s + e.amount, 0).toLocaleString()}`,
    ].join('\n')
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(buildShareList())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const allApproved = [...fixedTeam, ...dispatchTeam].every(e => isApproved(e))
  const anyApproved = [...fixedTeam, ...dispatchTeam].some(e => isApproved(e))

  const EmployeeRow = ({ e, amount }: { e: any; amount: number | null }) => {
    const paid = isPaid(e)
    const approved = isApproved(e)
    const approvedAmt = getApprovedAmount(e) ?? amount
    return (
      <tr className="border-b border-gray-800/40 hover:bg-gray-800/20">
        <td className="px-6 py-4 font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</td>
        <td className="px-6 py-4">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[e.role]}`}>{ROLE_LABELS[e.role]}</span>
        </td>
        <td className="px-6 py-4 text-gray-400 text-sm">{e.city || e.region || '—'}</td>
        <td className="px-6 py-4 text-right">
          {approvedAmt
            ? <span className="text-green-400 font-bold">${(approvedAmt as number).toLocaleString()}</span>
            : <span className="text-gray-600">{poolAmt === 0 && DISPATCH_ROLES.includes(e.role) ? 'Enter pool →' : 'Not set'}</span>}
        </td>
        <td className="px-6 py-4 text-right">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            paid ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'
          }`}>
            {paid ? '✓ Paid' : 'Pending'}
          </span>
        </td>
        <td className="px-6 py-4 text-right">
          {paid ? (
            <span className="text-gray-600 text-xs">✓ done</span>
          ) : (
            <button onClick={() => markPaid(e)} disabled={savingId === e.id}
              className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">
              {savingId === e.id ? '...' : 'Mark Paid'}
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold">💰 Payroll</h2>
                <p className="text-gray-400 text-sm mt-1">All staff — fixed + dispatch</p>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Period</label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const [y, m] = period.split('-').map(Number)
                        const d = new Date(y, m - 2, 1)
                        setPeriod(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                      }}
                      className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white px-2 py-1.5 rounded-lg text-sm">
                      ‹
                    </button>
                    <input value={period} onChange={e => setPeriod(e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white w-24 text-center" />
                    <button
                      onClick={() => {
                        const [y, m] = period.split('-').map(Number)
                        const d = new Date(y, m, 1)
                        setPeriod(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                      }}
                      className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white px-2 py-1.5 rounded-lg text-sm">
                      ›
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Dispatch Pool</label>
                  <input type="number" value={dispatchPool} onChange={e => setDispatchPool(e.target.value)}
                    placeholder="e.g. 11500"
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-32 font-bold" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">TM Fund</label>
                  <div className={`text-lg font-bold ${fundBalance !== null && fundBalance < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fundBalance !== null ? `$${fundBalance.toLocaleString()}` : '...'}
                  </div>
                </div>
                <button onClick={() => setShareModal(true)}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium self-end">
                  📤 Share
                </button>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Total Staff</p>
                <p className="text-3xl font-bold mt-2">{activeEmployees.length}</p>
                <p className="text-gray-500 text-xs mt-1">{fixedTeam.length} fixed · {dispatchTeam.length} dispatch</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Fixed Salaries</p>
                <p className="text-3xl font-bold mt-2 text-green-400">${totalFixedSalary.toLocaleString()}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Dispatch Pool</p>
                <p className="text-3xl font-bold mt-2 text-blue-400">
                  {totalDispatchPay > 0 ? `$${totalDispatchPay.toLocaleString()}` : '—'}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase">Grand Total</p>
                <p className={`text-3xl font-bold mt-2 ${grandTotal > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                  {grandTotal > 0 ? `$${grandTotal.toLocaleString()}` : '—'}
                </p>
              </div>
            </div>

            {/* Approve All banner */}
            {!allApproved && (
              <div className="bg-gray-900 border border-blue-800/50 rounded-xl p-4 mb-6 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Ready to approve payroll for <span className="text-blue-400">{period}</span>?</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    This locks in all amounts. After approval, mark each person paid individually as you send money.
                    {poolAmt === 0 && dispatchTeam.some(e => !isApproved(e)) && <span className="text-yellow-400"> Add dispatch pool above to also approve dispatch team.</span>}
                  </p>
                </div>
                <button onClick={approveAll} disabled={approvingAll}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-6 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap ml-6">
                  {approvingAll ? 'Approving...' : '✓ Approve All'}
                </button>
              </div>
            )}

            {/* Combined table */}
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
                  {/* Fixed salary group header */}
                  <tr className="bg-gray-800/40">
                    <td colSpan={6} className="px-6 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Fixed Salary — ${totalFixedSalary.toLocaleString()}/month
                    </td>
                  </tr>
                  {loading ? (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
                  ) : fixedTeam.map(e => (
                    <EmployeeRow key={e.id} e={e} amount={e.salary} />
                  ))}

                  {/* Dispatch group header */}
                  <tr className="bg-gray-800/40">
                    <td colSpan={6} className="px-6 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Dispatch Team — {poolAmt > 0 ? `$${totalDispatchPay.toLocaleString()} pool` : 'Enter pool amount above'}
                      <Link href="/hr/dispatch-payroll" className="ml-3 text-blue-500 hover:text-blue-400 normal-case font-normal">
                        Advanced payroll →
                      </Link>
                    </td>
                  </tr>
                  {loading ? null : dispatchTeam.map(e => (
                    <EmployeeRow key={e.id} e={e} amount={getDispatchAmount(e) || calcDispatchPay(e)} />
                  ))}
                </tbody>
                {grandTotal > 0 && (
                  <tfoot className="border-t-2 border-gray-700 bg-gray-800/30">
                    <tr>
                      <td colSpan={3} className="px-6 py-4 font-semibold text-gray-300">Total This Month</td>
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

      {/* Share Modal */}
      {shareModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold">📤 Salary List — {period}</h3>
              <button onClick={() => setShareModal(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6">
              <pre className="bg-gray-800 rounded-lg p-4 text-sm text-gray-200 whitespace-pre-wrap font-mono leading-relaxed overflow-y-auto max-h-96">
                {buildShareList()}
              </pre>
              <div className="flex gap-3 mt-4">
                <button onClick={copyToClipboard}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                  {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
                </button>
                <button onClick={() => setShareModal(false)}
                  className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">
                  Close
                </button>
              </div>
              <p className="text-gray-600 text-xs mt-3 text-center">Paste into WhatsApp, Telegram, or any messaging app</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
