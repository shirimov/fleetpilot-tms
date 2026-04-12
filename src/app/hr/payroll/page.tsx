'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function PayrollPage() {
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then(d => { setEmployees(d); setLoading(false) })
  }, [])

  const now = new Date()
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const lastPeriod = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()

  const activeEmployees = employees.filter(e => e.isActive)
  const totalMonthly = activeEmployees.reduce((s, e) => s + e.salary, 0)

  // Check who has been paid this month
  const paidThisMonth = (e: any) =>
    (e.payments || []).some((p: any) => p.period === currentPeriod && p.status === 'PAID')

  const unpaidThisMonth = activeEmployees.filter(e => !paidThisMonth(e))
  const paidThisMonthList = activeEmployees.filter(e => paidThisMonth(e))

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold">💰 Payroll</h2>
              <p className="text-gray-400 text-sm mt-1">Monthly payroll overview — {currentPeriod}</p>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Monthly Total</p>
                <p className="text-3xl font-bold mt-2 text-green-400">${totalMonthly.toLocaleString()}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Active Employees</p>
                <p className="text-3xl font-bold mt-2">{activeEmployees.length}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Paid This Month</p>
                <p className="text-3xl font-bold mt-2 text-blue-400">{paidThisMonthList.length}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Pending Payment</p>
                <p className="text-3xl font-bold mt-2 text-yellow-400">{unpaidThisMonth.length}</p>
                <p className="text-gray-500 text-xs mt-1">${unpaidThisMonth.reduce((s, e) => s + e.salary, 0).toLocaleString()} owed</p>
              </div>
            </div>

            {/* Unpaid this month */}
            {unpaidThisMonth.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-6 mb-6">
                <h3 className="font-semibold text-yellow-300 mb-4">⚠️ Not Yet Paid — {currentPeriod}</h3>
                <div className="space-y-3">
                  {unpaidThisMonth.map(e => (
                    <div key={e.id} className="flex items-center justify-between bg-gray-900/50 rounded-lg p-4">
                      <div>
                        <p className="font-medium">{e.firstName} {e.lastName}</p>
                        <p className="text-gray-400 text-xs">{e.role} • {e.country}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-green-400 font-bold">${e.salary.toLocaleString()} <span className="text-gray-500 text-xs">{e.currency}</span></p>
                        <p className="text-gray-500 text-xs">{e.paymentMethod}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-yellow-800/30">
                  <a href="/hr/employees" className="text-blue-400 text-sm hover:underline">→ Go to Employees to log payments</a>
                </div>
              </div>
            )}

            {/* Paid this month */}
            {paidThisMonthList.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
                <h3 className="font-semibold text-green-400 mb-4">✅ Paid — {currentPeriod}</h3>
                <div className="space-y-3">
                  {paidThisMonthList.map(e => {
                    const payment = (e.payments || []).find((p: any) => p.period === currentPeriod && p.status === 'PAID')
                    return (
                      <div key={e.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg p-4">
                        <div>
                          <p className="font-medium">{e.firstName} {e.lastName}</p>
                          <p className="text-gray-400 text-xs">{e.role} • {e.country}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-green-400 font-bold">${payment?.amount?.toLocaleString() || e.salary.toLocaleString()} <span className="text-gray-500 text-xs">{e.currency}</span></p>
                          <p className="text-gray-500 text-xs">{payment?.method} • {payment?.paidAt ? new Date(payment.paidAt).toLocaleDateString() : ''}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {loading && <div className="text-center text-gray-500 py-12">Loading...</div>}
            {!loading && activeEmployees.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                <p className="text-4xl mb-3">💰</p>
                <p>No active employees yet. <a href="/hr/employees" className="text-blue-400 hover:underline">Add employees first.</a></p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
