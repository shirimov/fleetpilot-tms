'use client'
import { useState, useEffect } from 'react'

interface Driver {
  id: string
  firstName: string
  lastName: string
}

interface ChecklistState {
  // Company Policies
  drugAlcohol: boolean
  cellPhone: boolean
  speedLimit: boolean
  noLeftLane: boolean
  weightStation: boolean
  accidentReporting: boolean
  dispatchCommunication: boolean
  // Amazon Specific
  amazonOnTime: boolean
  amazonYardRules: boolean
  amazonAppTraining: boolean
  // ELD & Compliance
  eldTraining: boolean
  hosPolicy: boolean
  // Pre-Trip & Post-Trip
  inspectionProcedure: boolean
  driverUnderstandsChecks: boolean
  driverUnderstandsDefects: boolean
  // Truck & Equipment
  truckWalkthrough: boolean
  prepassExplained: boolean
  // Emergency Procedures
  breakdownProcedure: boolean
  emergencyContacts: boolean
  // Documentation
  driverFileComplete: boolean
  leaseAgreementSigned: boolean
}

const defaultChecklist = (): ChecklistState => ({
  drugAlcohol: false, cellPhone: false, speedLimit: false, noLeftLane: false,
  weightStation: false, accidentReporting: false, dispatchCommunication: false,
  amazonOnTime: false, amazonYardRules: false, amazonAppTraining: false,
  eldTraining: false, hosPolicy: false,
  inspectionProcedure: false, driverUnderstandsChecks: false, driverUnderstandsDefects: false,
  truckWalkthrough: false, prepassExplained: false,
  breakdownProcedure: false, emergencyContacts: false,
  driverFileComplete: false, leaseAgreementSigned: false,
})

function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-full text-left flex items-center gap-3 px-4 py-4 rounded-xl transition-all border ${
        checked ? 'bg-green-900/40 border-green-700 text-green-200' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
      }`}
    >
      <span className={`text-2xl flex-shrink-0 ${checked ? 'text-green-400' : 'text-gray-600'}`}>
        {checked ? '✅' : '⬜'}
      </span>
      <span className="text-base">{label}</span>
    </button>
  )
}

function SectionHeader({ title }: { title: string }) {
  return <h3 className="text-blue-400 font-bold text-sm uppercase tracking-wider mt-6 mb-2 px-1">{title}</h3>
}

export default function DriverOrientationForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [driverId, setDriverId] = useState('')
  const [completedBy, setCompletedBy] = useState('')
  const [checklist, setChecklist] = useState<ChecklistState>(defaultChecklist())
  const [signature, setSignature] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState(0) // 0=setup, 1=checklist, 2=sign

  useEffect(() => {
    fetch('/api/drivers').then(r => r.json()).then(setDrivers).catch(console.error)
  }, [])

  const toggle = (key: keyof ChecklistState) => setChecklist(c => ({ ...c, [key]: !c[key] }))

  const totalItems = Object.keys(checklist).length
  const checkedCount = Object.values(checklist).filter(Boolean).length

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/inspections/driver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId, completedBy, checklist, signature, notes }),
      })
      if (!res.ok) throw new Error('Failed to save')
      onSaved()
    } catch {
      setError('Failed to save orientation. Please try again.')
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-gray-900 p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onCancel} className="text-gray-400 hover:text-white text-2xl">←</button>
        <h1 className="text-xl font-bold text-white">Driver Safety Orientation</h1>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-6">
        {['Setup', 'Checklist', 'Sign'].map((label, i) => (
          <div key={i} className="flex-1 text-center">
            <div className={`h-2 rounded-full mb-1 ${i <= step ? 'bg-blue-500' : 'bg-gray-700'}`} />
            <div className={`text-xs ${i === step ? 'text-blue-400 font-semibold' : 'text-gray-600'}`}>{label}</div>
          </div>
        ))}
      </div>

      {/* Step 0: Setup */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className="text-gray-300 font-semibold block mb-2">Select Driver</label>
            <select
              value={driverId}
              onChange={e => setDriverId(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 rounded-xl text-white text-base border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="">-- Choose a driver --</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-300 font-semibold block mb-2">Completed By</label>
            <input
              type="text"
              value={completedBy}
              onChange={e => setCompletedBy(e.target.value)}
              placeholder="Your name (dispatcher / manager)"
              className="w-full px-4 py-3 bg-gray-800 rounded-xl text-white text-base border border-gray-600 focus:border-blue-500 focus:outline-none placeholder-gray-500"
            />
          </div>
          <button
            onClick={() => setStep(1)}
            disabled={!driverId || !completedBy.trim()}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl text-lg transition-colors mt-4"
          >
            Start Orientation →
          </button>
        </div>
      )}

      {/* Step 1: Checklist */}
      {step === 1 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Safety Orientation Checklist</h2>
            <span className="text-sm text-blue-400 font-semibold">{checkedCount}/{totalItems}</span>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-gray-700 rounded-full mb-6">
            <div className="h-2 bg-blue-500 rounded-full transition-all" style={{ width: `${(checkedCount / totalItems) * 100}%` }} />
          </div>

          <div className="space-y-2">
            <SectionHeader title="📋 Company Policies" />
            <CheckItem label="Drug & Alcohol policy signed" checked={checklist.drugAlcohol} onChange={() => toggle('drugAlcohol')} />
            <CheckItem label="Cell phone / distracted driving policy" checked={checklist.cellPhone} onChange={() => toggle('cellPhone')} />
            <CheckItem label="Speed limit policy" checked={checklist.speedLimit} onChange={() => toggle('speedLimit')} />
            <CheckItem label="No driving in left lane policy" checked={checklist.noLeftLane} onChange={() => toggle('noLeftLane')} />
            <CheckItem label="Weight station rules & procedure" checked={checklist.weightStation} onChange={() => toggle('weightStation')} />
            <CheckItem label="Accident reporting procedure" checked={checklist.accidentReporting} onChange={() => toggle('accidentReporting')} />
            <CheckItem label="Communication with dispatchers" checked={checklist.dispatchCommunication} onChange={() => toggle('dispatchCommunication')} />

            <SectionHeader title="📦 Amazon Specific" />
            <CheckItem label="On-time pickup & delivery requirements" checked={checklist.amazonOnTime} onChange={() => toggle('amazonOnTime')} />
            <CheckItem label="Amazon yard rules reviewed" checked={checklist.amazonYardRules} onChange={() => toggle('amazonYardRules')} />
            <CheckItem label="Amazon app usage & training" checked={checklist.amazonAppTraining} onChange={() => toggle('amazonAppTraining')} />

            <SectionHeader title="📱 ELD & Compliance" />
            <CheckItem label="ELD training completed" checked={checklist.eldTraining} onChange={() => toggle('eldTraining')} />
            <CheckItem label="Hours of Service (HOS) policy reviewed" checked={checklist.hosPolicy} onChange={() => toggle('hosPolicy')} />

            <SectionHeader title="🔍 Pre-Trip & Post-Trip Inspection" />
            <CheckItem label="Inspection procedure reviewed" checked={checklist.inspectionProcedure} onChange={() => toggle('inspectionProcedure')} />
            <CheckItem label="Driver understands what to check before & after every load" checked={checklist.driverUnderstandsChecks} onChange={() => toggle('driverUnderstandsChecks')} />
            <CheckItem label="Driver understands how to report defects" checked={checklist.driverUnderstandsDefects} onChange={() => toggle('driverUnderstandsDefects')} />

            <SectionHeader title="🚛 Truck & Equipment" />
            <CheckItem label="Assigned truck walkthrough completed" checked={checklist.truckWalkthrough} onChange={() => toggle('truckWalkthrough')} />
            <CheckItem label="PrePass explained" checked={checklist.prepassExplained} onChange={() => toggle('prepassExplained')} />

            <SectionHeader title="🚨 Emergency Procedures" />
            <CheckItem label="Breakdown procedure reviewed" checked={checklist.breakdownProcedure} onChange={() => toggle('breakdownProcedure')} />
            <CheckItem label="Accident & emergency contacts provided" checked={checklist.emergencyContacts} onChange={() => toggle('emergencyContacts')} />

            <SectionHeader title="📄 Documentation" />
            <CheckItem label="Driver file complete (CDL, medical card, MVR)" checked={checklist.driverFileComplete} onChange={() => toggle('driverFileComplete')} />
            <CheckItem label="Lease agreement signed (if owner-op)" checked={checklist.leaseAgreementSigned} onChange={() => toggle('leaseAgreementSigned')} />
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={() => setStep(0)} className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors">← Back</button>
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
            >
              Sign & Finish →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Signature */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">✍️ Sign Off</h2>

          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">Completed By: <span className="text-white">{completedBy}</span></div>
            <div className="text-gray-400 text-sm mt-1">
              Driver: <span className="text-white">{drivers.find(d => d.id === driverId)?.firstName} {drivers.find(d => d.id === driverId)?.lastName}</span>
            </div>
            <div className="text-gray-400 text-sm mt-1">
              Items Completed: <span className={checkedCount === totalItems ? 'text-green-400' : 'text-yellow-400'}>{checkedCount}/{totalItems}</span>
            </div>
          </div>

          <div>
            <label className="text-gray-300 font-semibold block mb-2">Driver Signature <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={signature}
              onChange={e => setSignature(e.target.value)}
              placeholder="Driver types full name to sign"
              className="w-full px-4 py-4 bg-gray-800 rounded-xl text-white text-lg font-light border-2 border-blue-600 focus:border-blue-400 focus:outline-none placeholder-gray-500 italic"
              style={{ fontFamily: 'cursive' }}
            />
            <p className="text-gray-500 text-xs mt-1">By typing your name, you confirm this orientation was completed.</p>
          </div>

          <div>
            <label className="text-gray-300 font-semibold block mb-2">Date</label>
            <div className="px-4 py-3 bg-gray-800 rounded-xl text-white border border-gray-700">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>

          <div>
            <label className="text-gray-300 font-semibold block mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={3}
              className="w-full px-4 py-3 bg-gray-800 rounded-xl text-white text-base border border-gray-600 focus:border-blue-500 focus:outline-none placeholder-gray-500 resize-none"
            />
          </div>

          {error && <div className="bg-red-900 text-red-300 rounded-xl p-3 text-sm">{error}</div>}

          <div className="flex gap-3 mt-4">
            <button onClick={() => setStep(1)} className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors">← Back</button>
            <button
              onClick={handleSave}
              disabled={saving || !signature.trim()}
              className="flex-1 py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl transition-colors"
            >
              {saving ? 'Saving...' : '💾 Save Orientation'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
