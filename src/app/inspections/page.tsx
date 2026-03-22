'use client'
import { useState, useEffect } from 'react'
import TruckInspectionForm from './TruckInspectionForm'
import DriverOrientationForm from './DriverOrientationForm'
import TruckInspectionDetail from './TruckInspectionDetail'
import DriverOrientationDetail from './DriverOrientationDetail'

type Tab = 'truck' | 'driver'

interface TruckInspection {
  id: string
  inspectedBy: string
  inspectedAt: string
  passed: boolean
  truck: { unitNumber: string; make?: string; model?: string; year?: number }
}

interface DriverOrientation {
  id: string
  completedBy: string
  completedAt: string
  signature: string
  driver: { firstName: string; lastName: string }
}

export default function InspectionsPage() {
  const [tab, setTab] = useState<Tab>('truck')
  const [truckInspections, setTruckInspections] = useState<TruckInspection[]>([])
  const [driverOrientations, setDriverOrientations] = useState<DriverOrientation[]>([])
  const [showTruckForm, setShowTruckForm] = useState(false)
  const [showDriverForm, setShowDriverForm] = useState(false)
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null)
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchTruck = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inspections/truck')
      const data = await res.json()
      setTruckInspections(data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const fetchDriver = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inspections/driver')
      const data = await res.json()
      setDriverOrientations(data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => {
    fetchTruck()
    fetchDriver()
  }, [])

  const handleTruckSaved = () => {
    setShowTruckForm(false)
    fetchTruck()
  }

  const handleDriverSaved = () => {
    setShowDriverForm(false)
    fetchDriver()
  }

  if (showTruckForm) {
    return <TruckInspectionForm onSaved={handleTruckSaved} onCancel={() => setShowTruckForm(false)} />
  }
  if (showDriverForm) {
    return <DriverOrientationForm onSaved={handleDriverSaved} onCancel={() => setShowDriverForm(false)} />
  }
  if (selectedTruckId) {
    return <TruckInspectionDetail id={selectedTruckId} onBack={() => setSelectedTruckId(null)} />
  }
  if (selectedDriverId) {
    return <DriverOrientationDetail id={selectedDriverId} onBack={() => setSelectedDriverId(null)} />
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">📋 Inspections</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('truck')}
          className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-colors ${tab === 'truck' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
        >
          🚛 Truck Inspections
        </button>
        <button
          onClick={() => setTab('driver')}
          className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-colors ${tab === 'driver' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
        >
          👤 Driver Orientations
        </button>
      </div>

      {/* Truck Inspections Tab */}
      {tab === 'truck' && (
        <div>
          <button
            onClick={() => setShowTruckForm(true)}
            className="w-full mb-4 py-4 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl text-lg transition-colors"
          >
            + New Truck Inspection
          </button>
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : truckInspections.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <div className="text-4xl mb-2">🔍</div>
              <div>No truck inspections yet</div>
            </div>
          ) : (
            <div className="space-y-3">
              {truckInspections.map((ins) => (
                <button
                  key={ins.id}
                  onClick={() => setSelectedTruckId(ins.id)}
                  className="w-full text-left bg-gray-800 rounded-xl p-4 hover:bg-gray-700 transition-colors border border-gray-700"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-lg">
                        Truck #{ins.truck.unitNumber}
                        {ins.truck.make && <span className="text-gray-400 text-sm ml-2">{ins.truck.year} {ins.truck.make} {ins.truck.model}</span>}
                      </div>
                      <div className="text-gray-400 text-sm mt-1">
                        By {ins.inspectedBy} · {new Date(ins.inspectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${ins.passed ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                      {ins.passed ? '✅ PASS' : '❌ FAIL'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Driver Orientations Tab */}
      {tab === 'driver' && (
        <div>
          <button
            onClick={() => setShowDriverForm(true)}
            className="w-full mb-4 py-4 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl text-lg transition-colors"
          >
            + New Driver Orientation
          </button>
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : driverOrientations.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <div className="text-4xl mb-2">📝</div>
              <div>No driver orientations yet</div>
            </div>
          ) : (
            <div className="space-y-3">
              {driverOrientations.map((ori) => (
                <button
                  key={ori.id}
                  onClick={() => setSelectedDriverId(ori.id)}
                  className="w-full text-left bg-gray-800 rounded-xl p-4 hover:bg-gray-700 transition-colors border border-gray-700"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-lg">
                        {ori.driver.firstName} {ori.driver.lastName}
                      </div>
                      <div className="text-gray-400 text-sm mt-1">
                        By {ori.completedBy} · {new Date(ori.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full text-sm font-bold bg-blue-900 text-blue-300">
                      ✅ Complete
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
