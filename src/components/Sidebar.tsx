'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const nav = [
  { href: '/', label: '📊 Dashboard' },
  { href: '/loads', label: '📦 Loads' },
  { href: '/trucks', label: '🚛 Trucks' },
  { href: '/settlements', label: '💰 Settlements' },
  { href: '/companies', label: '🏢 Companies' },
  { href: '/inspections', label: '📋 Inspections' },
  { href: '/finance', label: '💳 Finance' },
  { href: '/inbox', label: '📬 Inbox' },
]

const hrNav = [
  { href: '/hr/employees', label: '👥 Employees' },
  { href: '/drivers', label: '🚛 Drivers' },
  { href: '/hr/payroll', label: '💵 Payroll' },
  { href: '/hr/tmfund', label: '🇹🇲 TM Fund' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const isHrActive = hrNav.some(n => pathname === n.href) || pathname.startsWith('/hr/')
  const [hrOpen, setHrOpen] = useState(isHrActive)

  const linkClass = (href: string) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      pathname === href
        ? 'bg-blue-600 text-white'
        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
    }`

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-gray-900 border-r border-gray-800 flex-col shrink-0">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold text-white">✈️ FleetPilot</h1>
          <p className="text-xs text-gray-400 mt-1">Fleet Management</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {nav.map(({ href, label }) => (
            <Link key={href} href={href} className={linkClass(href)}>
              {label}
            </Link>
          ))}

          {/* HR Section */}
          <div className="pt-3">
            <button
              onClick={() => setHrOpen(o => !o)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                isHrActive ? 'text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <span>🏢 HR Department</span>
              <span className="text-gray-600 text-xs">{hrOpen ? '▾' : '▸'}</span>
            </button>
            {hrOpen && (
              <div className="mt-1 ml-3 space-y-1 border-l border-gray-700 pl-3">
                {hrNav.map(({ href, label }) => (
                  <Link key={href} href={href} className={linkClass(href)}>
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800 flex justify-around items-center px-1 py-2">
        {[
          { href: '/', emoji: '📊', short: 'Dash' },
          { href: '/loads', emoji: '📦', short: 'Loads' },
          { href: '/trucks', emoji: '🚛', short: 'Trucks' },
          { href: '/drivers', emoji: '👤', short: 'Drivers' },
          { href: '/hr/employees', emoji: '👥', short: 'HR' },
          { href: '/settlements', emoji: '💰', short: 'Pay' },
        ].map(({ href, emoji, short }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              pathname === href ? 'text-blue-400' : 'text-gray-500 hover:text-white'
            }`}
          >
            <span className="text-lg leading-none">{emoji}</span>
            <span>{short}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}
