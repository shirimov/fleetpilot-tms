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
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
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
  )
}
