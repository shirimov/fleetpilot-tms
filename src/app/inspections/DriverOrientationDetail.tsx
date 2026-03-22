'use client'
import { useState, useEffect } from 'react'

interface OrientationData {
  id: string
  completedBy: string
  completedAt: string
  signature: string
  notes?: string
  driver: { firstName: string; lastName: string; phone?: string }
  checklist: Record<string, boolean>
}

const CHECKLIST_LABELS: Record<string, string> = {
  drugAlcohol: 'Drug & Alcohol policy signed',
  cellPhone: 'Cell phone / distracted driving policy',
  speedLimit: 'Speed limit policy',
  noLeftLane: 'No driving in left lane policy',
  weightStation: 'Weight station rules & procedure',
  accidentReporting: 'Accident reporting procedure',
  dispatchCommunication: 'Communication with dispatchers',
  amazonOnTime: 'On-time pickup & delivery requirements',
  amazonYardRules: 'Amazon yard rules reviewed',
  amazonAppTraining: 'Amazon app usage & training',
  eldTraining: 'ELD training completed',
  hosPolicy: 'Hours of Service (HOS) policy reviewed',
  inspectionProcedure: 'Inspection procedure reviewed',
  driverUnderstandsChecks: 'Driver understands what to check before & after every load',
  driverUnderstandsDefects: 'Driver understands how to report defects',
  truckWalkthrough: 'Assigned truck walkthrough completed',
  prepassExplained: 'PrePass explained',
  breakdownProcedure: 'Breakdown procedure reviewed',
  emergencyContacts: 'Accident & emergency contacts provided',
  driverFileComplete: 'Driver file complete (CDL, medical card, MVR)',
  leaseAgreementSigned: 'Lease agreement signed (if owner-op)',
}

const SECTIONS = [
  { title: '📋 Company Policies', keys: ['drugAlcohol','cellPhone','speedLimit','noLeftLane','weightStation','accidentReporting','dispatchCommunication'] },
  { title: '📦 Amazon Specific', keys: ['amazonOnTime','amazonYardRules','amazonAppTraining'] },
  { title: '📱 ELD & Compliance', keys: ['eldTraining','hosPolicy'] },
  { title: '🔍 Pre-Trip & Post-Trip', keys: ['inspectionProcedure','driverUnderstandsChecks','driverUnderstandsDefects'] },
  { title: '🚛 Truck & Equipment', keys: ['truckWalkthrough','prepassExplained'] },
  { title: '🚨 Emergency Procedures', keys: ['breakdownProcedure','emergencyContacts'] },
  { title: '📄 Documentation', keys: ['driverFileComplete','leaseAgreementSigned'] },
]

export default function DriverOrientationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<OrientationData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/inspections/driver/${id}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-center text-gray-400">Loading...</div>
  if (!data) return <div className="p-8 text-center text-red-400">Orientation not found</div>

  const totalItems = Object.keys(CHECKLIST_LABELS).length
  const checkedCount = Object.values(data.checklist).filter(Boolean).length

  return (
    <div className="min-h-screen bg-gray-900 p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-2xl">←</button>
        <h1 className="text-xl font-bold text-white">Orientation Details</h1>
      </div>

      {/* Summary card */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-4">
        <div className="font-semibold text-white text-lg">{data.driver.firstName} {data.driver.lastName}</div>
        {data.driver.phone && <div className="text-gray-400 text-sm">{data.driver.phone}</div>}
        <div className="mt-2 text-gray-400 text-sm">Completed By: <span className="text-white">{data.completedBy}</span></div>
        <div className="text-gray-400 text-sm">Date: <span className="text-white">{new Date(data.completedAt).toLocaleString()}</span></div>
        <div className="mt-2">
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${checkedCount === totalItems ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
            {checkedCount === totalItems ? '✅' : '⚠️'} {checkedCount}/{totalItems} items completed
          </div>
        </div>
      </div>

      {/* Checklist by section */}
      {SECTIONS.map(section => (
        <div key={section.title} className="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-3">
          <h3 className="font-bold text-white mb-3">{section.title}</h3>
          {section.keys.map(key => (
            <div key={key} className="flex items-center gap-3 py-2 border-b border-gray-700 last:border-0">
              <span className={data.checklist[key] ? 'text-green-400' : 'text-gray-600'}>{data.checklist[key] ? '✅' : '⬜'}</span>
              <span className={`text-sm ${data.checklist[key] ? 'text-gray-300' : 'text-gray-500'}`}>{CHECKLIST_LABELS[key]}</span>
            </div>
          ))}
        </div>
      ))}

      {/* Signature */}
      <div className="bg-gray-800 rounded-xl p-4 border border-blue-800 mb-3">
        <h3 className="font-bold text-white mb-2">✍️ Driver Signature</h3>
        <div className="text-blue-300 text-xl italic" style={{ fontFamily: 'cursive' }}>{data.signature}</div>
        <div className="text-gray-500 text-xs mt-1">{new Date(data.completedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>

      {data.notes && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-3">
          <h3 className="font-bold text-white mb-1">Notes</h3>
          <div className="text-gray-300 text-sm">{data.notes}</div>
        </div>
      )}
    </div>
  )
}
