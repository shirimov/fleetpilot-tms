'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

const REGIONS = ['Mary', 'Ashgabat', 'Balkan', 'Dashoguz', 'Lebap']
const REGION_COLORS: Record<string, string> = {
  Mary: 'bg-purple-900/50 text-purple-300',
  Ashgabat: 'bg-blue-900/50 text-blue-300',
  Balkan: 'bg-cyan-900/50 text-cyan-300',
  Dashoguz: 'bg-orange-900/50 text-orange-300',
  Lebap: 'bg-green-900/50 text-green-300',
}

const ROLES = ['DISPATCHER', 'LEAD_DISPATCH', 'UPDATER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'SAFETY', 'OTHER']
const ROLE_LABELS: Record<string, string> = {
  DISPATCHER: 'Dispatcher', LEAD_DISPATCH: 'Lead Dispatch', UPDATER: 'Updater',
  ACCOUNTANT: 'Accountant', MANAGER: 'Manager', ADMIN: 'Admin', SAFETY: 'Safety', OTHER: 'Other',
}
const ROLE_COLORS: Record<string, string> = {
  DISPATCHER: 'bg-blue-900/50 text-blue-300', LEAD_DISPATCH: 'bg-indigo-900/50 text-indigo-300',
  UPDATER: 'bg-teal-900/50 text-teal-300', ACCOUNTANT: 'bg-green-900/50 text-green-300',
  MANAGER: 'bg-purple-900/50 text-purple-300', ADMIN: 'bg-yellow-900/50 text-yellow-300',
  SAFETY: 'bg-orange-900/50 text-orange-300', OTHER: 'bg-gray-800 text-gray-300',
}

const empty = {
  firstName: '', lastName: '', role: 'DISPATCHER', roleCustom: '',
  phone: '', email: '', country: 'Turkmenistan', city: '',
  salary: '', currency: 'USD', paymentMethod: 'Bank Transfer',
  startDate: '', notes: '', isActive: true, region: '',
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>(empty)
  const [saving, setSaving] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [payTarget, setPayTarget] = useState<any>(null)
  const [payForm, setPayForm] = useState({ amount: '', currency: 'USD', period: '', method: 'Bank Transfer', notes: '', status: 'PAID', paidAt: '', deductFromFund: false, region: '' })
  const [payHistory, setPayHistory] = useState<any[]>([])
  const [historyEmp, setHistoryEmp] = useState<any>(null)
  const [fundBalance, setFundBalance] = useState<number | null>(null)

  const load = () => {
    fetch('/api/employees').then(r => r.json()).then(d => { setEmployees(d); setLoading(false) })
    fetch('/api/tmfund').then(r => r.json()).then(d => setFundBalance(d.balance))
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setEditing(null); setForm(empty); setShowModal(true) }
  const openEdit = (e: any) => {
    setEditing(e)
    setForm({
      firstName: e.firstName, lastName: e.lastName || '', role: e.role, roleCustom: e.roleCustom || '',
      phone: e.phone || '', email: e.email || '', country: e.country, city: e.city || '',
      salary: e.salary ?? '', currency: e.currency, paymentMethod: e.paymentMethod,
      startDate: e.startDate ? e.startDate.substring(0, 10) : '', notes: e.notes || '', isActive: e.isActive, region: e.region || '',
    })
    setShowModal(true)
  }

  const save = async () => {
    setSaving(true)
    const url = editing ? `/api/employees/${editing.id}` : '/api/employees'
    const method = editing ? 'PUT' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false); setShowModal(false); load()
  }

  const openPayModal = (e: any) => {
    setPayTarget(e)
    const now = new Date()
    setPayForm({
      amount: e.salary ? String(e.salary) : '',
      currency: e.currency, period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      method: e.paymentMethod, notes: '', status: 'PAID',
      paidAt: now.toISOString().substring(0, 10), deductFromFund: false, region: e.region || '',
    })
    setShowPayModal(true)
  }

  const savePay = async () => {
    setSaving(true)
    // Log employee payment
    await fetch(`/api/employees/${payTarget.id}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payForm),
    })
    // Optionally deduct from TM Fund
    if (payForm.deductFromFund) {
      await fetch('/api/tmfund', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'PAYMENT',
          amount: payForm.amount,
          description: `Salary — ${payTarget.firstName} ${payTarget.lastName || ''} (${payForm.period})`,
          employeeId: payTarget.id,
          region: payForm.region || null,
          date: payForm.paidAt,
          notes: payForm.notes,
        }),
      })
    }
    setSaving(false); setShowPayModal(false); load()
  }

  const openHistory = async (e: any) => {
    setHistoryEmp(e)
    const r = await fetch(`/api/employees/${e.id}/payments`)
    setPayHistory(await r.json())
  }

  const activeEmployees = employees.filter(e => e.isActive)
  const totalMonthly = activeEmployees.reduce((s, e) => s + (e.salary || 0), 0)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold">👥 Employees</h2>
                <p className="text-gray-400 text-sm mt-1">Office &amp; dispatch staff</p>
              </div>
              <button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                + Add Employee
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Active Employees</p>
                <p className="text-3xl font-bold mt-2">{activeEmployees.length}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Monthly Payroll</p>
                <p className="text-3xl font-bold mt-2 text-green-400">${totalMonthly.toLocaleString()}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Countries</p>
                <p className="text-3xl font-bold mt-2">{new Set(activeEmployees.map(e => e.country)).size}</p>
              </div>
              <div
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 cursor-pointer hover:border-blue-600 transition-colors"
                onClick={() => window.location.href = '/hr/tmfund'}
              >
                <p className="text-gray-400 text-xs uppercase tracking-wide">🇹🇲 TM Fund</p>
                <p className={`text-3xl font-bold mt-2 ${fundBalance !== null && fundBalance < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fundBalance !== null ? `$${fundBalance.toLocaleString()}` : '...'}
                </p>
                <p className="text-gray-500 text-xs mt-1">click to manage →</p>
              </div>
            </div>

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-gray-500">Loading...</div>
              ) : employees.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <p className="text-4xl mb-3">👥</p>
                  <p>No employees yet. Add your first one!</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-800">
                    <tr className="text-gray-400 text-xs uppercase">
                      <th className="text-left px-6 py-3">Name</th>
                      <th className="text-left px-6 py-3">Role</th>
                      <th className="text-left px-6 py-3">Location</th>
                      <th className="text-left px-6 py-3">Salary / Month</th>
                      <th className="text-left px-6 py-3">Payment Method</th>
                      <th className="text-left px-6 py-3">Status</th>
                      <th className="text-left px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(e => (
                      <tr key={e.id} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="px-6 py-4">
                          <div className="font-medium">{e.firstName}{e.lastName ? ` ${e.lastName}` : ''}</div>
                          {e.email && <div className="text-gray-500 text-xs">{e.email}</div>}
                          {e.phone && <div className="text-gray-500 text-xs">{e.phone}</div>}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[e.role]}`}>
                            {e.role === 'OTHER' && e.roleCustom ? e.roleCustom : ROLE_LABELS[e.role]}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-300">
                          {e.region && <span className={`text-xs px-2 py-0.5 rounded-full mr-1 ${REGION_COLORS[e.region] || 'bg-gray-800 text-gray-300'}`}>{e.region}</span>}
                          {e.city ? `${e.city}, ` : ''}{e.country}
                        </td>
                        <td className="px-6 py-4 text-green-400 font-medium">
                          {e.salary ? <>${e.salary.toLocaleString()} <span className="text-gray-500 text-xs">{e.currency}</span></> : <span className="text-gray-500">—</span>}
                        </td>
                        <td className="px-6 py-4 text-gray-300">{e.paymentMethod}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${e.isActive ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                            {e.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button onClick={() => openPayModal(e)} className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded">Pay</button>
                            <button onClick={() => openHistory(e)} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded">History</button>
                            <button onClick={() => openEdit(e)} className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded">Edit</button>
                          </div>
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold text-lg">{editing ? 'Edit Employee' : 'Add Employee'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">First Name *</label>
                  <input value={form.firstName} onChange={e => setForm((f: any) => ({ ...f, firstName: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Last Name</label>
                  <input value={form.lastName} onChange={e => setForm((f: any) => ({ ...f, lastName: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Role *</label>
                  <select value={form.role} onChange={e => setForm((f: any) => ({ ...f, role: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                {form.role === 'OTHER' && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Custom Role</label>
                    <input value={form.roleCustom} onChange={e => setForm((f: any) => ({ ...f, roleCustom: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. IT Support" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Phone</label>
                  <input value={form.phone} onChange={e => setForm((f: any) => ({ ...f, phone: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Email</label>
                  <input value={form.email} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Country</label>
                  <input value={form.country} onChange={e => setForm((f: any) => ({ ...f, country: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">City</label>
                  <input value={form.city} onChange={e => setForm((f: any) => ({ ...f, city: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-2">Region (Turkmenistan)</label>
                <div className="grid grid-cols-5 gap-2">
                  {REGIONS.map(r => (
                    <button key={r} type="button"
                      onClick={() => setForm((f: any) => ({ ...f, region: f.region === r ? '' : r }))}
                      className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                        form.region === r ? REGION_COLORS[r] + ' border-current' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 block mb-1">Monthly Salary <span className="text-gray-600">(optional)</span></label>
                  <input type="number" value={form.salary} onChange={e => setForm((f: any) => ({ ...f, salary: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="Leave blank if variable" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Currency</label>
                  <select value={form.currency} onChange={e => setForm((f: any) => ({ ...f, currency: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option>USD</option><option>TMT</option><option>EUR</option><option>RUB</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Payment Method</label>
                <select value={form.paymentMethod} onChange={e => setForm((f: any) => ({ ...f, paymentMethod: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option>Bank Transfer</option><option>Western Union</option><option>MoneyGram</option><option>Cash</option><option>Wise</option><option>Crypto</option><option>Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Start Date</label>
                <input type="date" value={form.startDate} onChange={e => setForm((f: any) => ({ ...f, startDate: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              {editing && (
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => setForm((f: any) => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4" />
                  <label htmlFor="isActive" className="text-sm text-gray-300">Active employee</label>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
              </div>
            </div>
            <div className="p-6 border-t border-gray-800 flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={save} disabled={saving || !form.firstName} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Employee'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {showPayModal && payTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold text-lg">Log Payment — {payTarget.firstName} {payTarget.lastName || ''}</h3>
              <button onClick={() => setShowPayModal(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 block mb-1">Amount *</label>
                  <input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Currency</label>
                  <select value={payForm.currency} onChange={e => setPayForm(f => ({ ...f, currency: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option>USD</option><option>TMT</option><option>EUR</option><option>RUB</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Period (YYYY-MM)</label>
                  <input value={payForm.period} onChange={e => setPayForm(f => ({ ...f, period: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="2026-04" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Date Paid</label>
                  <input type="date" value={payForm.paidAt} onChange={e => setPayForm(f => ({ ...f, paidAt: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Method</label>
                <select value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option>Bank Transfer</option><option>Western Union</option><option>MoneyGram</option><option>Cash</option><option>Wise</option><option>Crypto</option><option>Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              {/* Region */}
              <div>
                <label className="text-xs text-gray-400 block mb-2">Region</label>
                <div className="grid grid-cols-5 gap-2">
                  {REGIONS.map(r => (
                    <button key={r} type="button"
                      onClick={() => setPayForm(f => ({ ...f, region: f.region === r ? '' : r }))}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        payForm.region === r ? REGION_COLORS[r] + ' border-current' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {/* TM Fund deduction */}
              <div className={`rounded-lg p-3 border ${payForm.deductFromFund ? 'border-blue-600 bg-blue-900/20' : 'border-gray-700 bg-gray-800/50'}`}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="deductFund" checked={payForm.deductFromFund} onChange={e => setPayForm(f => ({ ...f, deductFromFund: e.target.checked }))} className="w-4 h-4" />
                  <label htmlFor="deductFund" className="text-sm text-gray-300 cursor-pointer">
                    Deduct from TM Fund
                    {fundBalance !== null && <span className="text-gray-500 ml-2">(balance: ${fundBalance.toLocaleString()})</span>}
                  </label>
                </div>
                {payForm.deductFromFund && (
                  <p className="text-xs text-blue-400 mt-2">This payment will be recorded and deducted from the Turkmenistan Fund balance.</p>
                )}
              </div>
            </div>
            <div className="p-6 border-t border-gray-800 flex gap-3 justify-end">
              <button onClick={() => setShowPayModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={savePay} disabled={saving || !payForm.amount} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
                {saving ? 'Saving...' : 'Log Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {historyEmp && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold text-lg">Payment History — {historyEmp.firstName} {historyEmp.lastName || ''}</h3>
              <button onClick={() => setHistoryEmp(null)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {payHistory.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">No payments recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {payHistory.map((p: any) => (
                    <div key={p.id} className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{p.period}</p>
                        <p className="text-gray-400 text-xs">{p.method} • {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : 'No date'}</p>
                        {p.notes && <p className="text-gray-500 text-xs mt-1">{p.notes}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-green-400 font-bold">${parseFloat(p.amount).toLocaleString()} <span className="text-xs text-gray-500">{p.currency}</span></p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'PAID' ? 'bg-green-900/50 text-green-300' : p.status === 'PENDING' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-red-900/50 text-red-300'}`}>{p.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
