'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'

const statusColor: Record<string, string> = {
  PENDING: 'bg-yellow-900/50 text-yellow-300',
  IN_TRANSIT: 'bg-blue-900/50 text-blue-300',
  DELIVERED: 'bg-green-900/50 text-green-300',
  CANCELLED: 'bg-red-900/50 text-red-300',
}

export default function Home() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold">Dashboard</h2>
              <p className="text-gray-400 text-sm mt-1">Welcome back, Sha</p>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Active Trucks</p>
                <p className="text-3xl font-bold mt-2">{loading ? '...' : stats?.activeTrucks ?? 0}</p>
                <p className="text-gray-500 text-xs mt-1">of {loading ? '...' : stats?.totalTrucks ?? 0} total</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Loads This Week</p>
                <p className="text-3xl font-bold mt-2">{loading ? '...' : stats?.loadsThisWeek ?? 0}</p>
                <p className="text-gray-500 text-xs mt-1">since Sunday</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Revenue This Week</p>
                <p className="text-3xl font-bold mt-2 text-green-400">
                  {loading ? '...' : `$${(stats?.revenueThisWeek ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                </p>
                <p className="text-gray-500 text-xs mt-1">gross</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Pending Settlements</p>
                <p className="text-3xl font-bold mt-2 text-yellow-400">{loading ? '...' : stats?.pendingSettlements ?? 0}</p>
                <p className="text-gray-500 text-xs mt-1">drivers unpaid</p>
              </div>
            </div>

            {/* Quick actions */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
              <h3 className="font-semibold mb-4">Quick Actions</h3>
              <div className="flex gap-3">
                <Link href="/loads" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  + New Load
                </Link>
                <Link href="/trucks" className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  + Add Truck
                </Link>
                <Link href="/drivers" className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  + Add Driver
                </Link>
                <Link href="/settlements" className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  Settlements
                </Link>
              </div>
            </div>

            {/* Recent loads */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="font-semibold mb-4">Recent Loads</h3>
              {loading ? (
                <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>
              ) : !stats?.recentLoads?.length ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">📦</p>
                  <p className="text-sm">No loads yet. <Link href="/loads" className="text-blue-400 hover:underline">Add your first load</Link> to get started.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-800">
                    <tr className="text-gray-400 text-xs uppercase">
                      <th className="text-left pb-3">Load #</th>
                      <th className="text-left pb-3">Route</th>
                      <th className="text-left pb-3">Truck</th>
                      <th className="text-left pb-3">Driver</th>
                      <th className="text-left pb-3">Rate</th>
                      <th className="text-left pb-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentLoads.map((l: any) => (
                      <tr key={l.id} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="py-3 font-mono font-bold text-blue-400">{l.loadNumber}</td>
                        <td className="py-3 text-gray-300 text-xs">{l.origin} → {l.destination}</td>
                        <td className="py-3 text-gray-400">{l.truck?.unitNumber || '—'}</td>
                        <td className="py-3 text-gray-400">{l.driver ? `${l.driver.firstName} ${l.driver.lastName}` : '—'}</td>
                        <td className="py-3 text-green-400 font-medium">${l.rate.toLocaleString()}</td>
                        <td className="py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[l.status]}`}>{l.status}</span>
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
    </div>
  )
}
