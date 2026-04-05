'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/', label: '📊 Dashboard' },
  { href: '/loads', label: '📦 Loads' },
  { href: '/trucks', label: '🚛 Trucks' },
  { href: '/drivers', label: '👤 Drivers' },
  { href: '/settlements', label: '💰 Settlements' },
  { href: '/companies', label: '🏢 Companies' },
  { href: '/inspections', label: '📋 Inspections' },
  { href: '/finance', label: '💳 Finance' },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-64 bg-gray-900 border-r border-gray-800 flex-col shrink-0">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold text-white">✈️ FleetPilot</h1>
          <p className="text-xs text-gray-400 mt-1">Fleet Management</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {nav.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === href
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Mobile bottom nav — visible only on mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800 flex justify-around items-center px-1 py-2">
        {[
          { href: '/', emoji: '📊', short: 'Dash' },
          { href: '/loads', emoji: '📦', short: 'Loads' },
          { href: '/trucks', emoji: '🚛', short: 'Trucks' },
          { href: '/drivers', emoji: '👤', short: 'Drivers' },
          { href: '/inspections', emoji: '📋', short: 'Inspect' },
          { href: '/settlements', emoji: '💰', short: 'Pay' },
        ].map(({ href, emoji, short }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              pathname === href
                ? 'text-blue-400'
                : 'text-gray-500 hover:text-white'
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
