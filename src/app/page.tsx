export default function Home() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="flex h-screen">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="p-6 border-b border-gray-800">
            <h1 className="text-xl font-bold text-white">✈️ FleetPilot</h1>
            <p className="text-xs text-gray-400 mt-1">Fleet Management</p>
          </div>
          <nav className="flex-1 p-4 space-y-1">
            <a href="/" className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">
              📊 Dashboard
            </a>
            <a href="/loads" className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 text-sm">
              📦 Loads
            </a>
            <a href="/trucks" className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 text-sm">
              🚛 Trucks
            </a>
            <a href="/drivers" className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 text-sm">
              👤 Drivers
            </a>
            <a href="/settlements" className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 text-sm">
              💰 Settlements
            </a>
            <a href="/companies" className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800 text-sm">
              🏢 Companies
            </a>
          </nav>
        </aside>

        {/* Main content */}
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
                <p className="text-3xl font-bold mt-2">0</p>
                <p className="text-gray-500 text-xs mt-1">of 0 total</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Loads This Week</p>
                <p className="text-3xl font-bold mt-2">0</p>
                <p className="text-gray-500 text-xs mt-1">+0 from last week</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Revenue This Week</p>
                <p className="text-3xl font-bold mt-2 text-green-400">$0</p>
                <p className="text-gray-500 text-xs mt-1">gross</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-gray-400 text-xs uppercase tracking-wide">Pending Settlements</p>
                <p className="text-3xl font-bold mt-2 text-yellow-400">0</p>
                <p className="text-gray-500 text-xs mt-1">drivers unpaid</p>
              </div>
            </div>

            {/* Quick actions */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
              <h3 className="font-semibold mb-4">Quick Actions</h3>
              <div className="flex gap-3">
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  + New Load
                </button>
                <button className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  + Add Truck
                </button>
                <button className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  + Add Driver
                </button>
                <button className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  Generate Settlements
                </button>
              </div>
            </div>

            {/* Recent loads placeholder */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="font-semibold mb-4">Recent Loads</h3>
              <div className="text-center py-12 text-gray-500">
                <p className="text-4xl mb-3">📦</p>
                <p className="text-sm">No loads yet. Add your first load to get started.</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
