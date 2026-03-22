'use client'
import { useState, useEffect } from 'react'

interface InspectionData {
  id: string
  inspectedBy: string
  inspectedAt: string
  passed: boolean
  notes?: string
  truck: { unitNumber: string; make?: string; model?: string; year?: number }
  phase1: Record<string, string>
  phase2: Record<string, string>
  phase3: Record<string, string>
}

function ResultRow({ label, value, notes }: { label: string; value: string; notes?: string }) {
  const isPass = value === 'pass'
  const isFail = value === 'fail'
  return (
    <div className="py-2 border-b border-gray-700 last:border-0">
      <div className="flex justify-between items-center">
        <span className="text-gray-300 text-sm">{label}</span>
        <span className={`font-bold ${isPass ? 'text-green-400' : isFail ? 'text-red-400' : 'text-gray-500'}`}>
          {isPass ? '✅ Pass' : isFail ? '❌ Fail' : '—'}
        </span>
      </div>
      {notes && <div className="text-gray-500 text-xs mt-0.5 italic">{notes}</div>}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex justify-between py-1">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-gray-300 text-sm">{value}</span>
    </div>
  )
}

export default function TruckInspectionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<InspectionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/inspections/truck/${id}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-center text-gray-400">Loading...</div>
  if (!data) return <div className="p-8 text-center text-red-400">Inspection not found</div>

  const p1 = data.phase1
  const p2 = data.phase2
  const p3 = data.phase3

  return (
    <div className="min-h-screen bg-gray-900 p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-2xl">←</button>
        <h1 className="text-xl font-bold text-white">Inspection Details</h1>
      </div>

      {/* Summary */}
      <div className={`p-4 rounded-xl text-center text-xl font-bold mb-4 ${data.passed ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
        {data.passed ? '✅ PASSED' : '❌ FAILED'}
      </div>

      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-4">
        <div className="font-semibold text-white text-lg">Truck #{data.truck.unitNumber}</div>
        {data.truck.make && <div className="text-gray-400 text-sm">{data.truck.year} {data.truck.make} {data.truck.model}</div>}
        <div className="mt-2 text-gray-400 text-sm">Inspector: <span className="text-white">{data.inspectedBy}</span></div>
        <div className="text-gray-400 text-sm">Date: <span className="text-white">{new Date(data.inspectedAt).toLocaleString()}</span></div>
        {data.notes && <div className="mt-2 text-gray-300 text-sm italic">{data.notes}</div>}
      </div>

      {/* Phase 1 */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-3">
        <h3 className="font-bold text-white mb-3">📁 Phase 1 — Binder Documents</h3>
        <ResultRow label="Cab Card (Registration / IRP)" value={p1.cabCard} notes={p1.cabCardNotes} />
        <ResultRow label="IFTA License" value={p1.iftaLicense} notes={p1.iftaLicenseNotes} />
        <ResultRow label="COI (Certificate of Insurance)" value={p1.coi} notes={p1.coiNotes} />
        <ResultRow label="Operating Authority" value={p1.operatingAuthority} notes={p1.operatingAuthorityNotes} />
        <ResultRow label="Annual Inspection Report" value={p1.annualInspectionReport} notes={p1.annualInspectionReportNotes} />
        <ResultRow label="UCR" value={p1.ucr} notes={p1.ucrNotes} />
        <ResultRow label="ELD User Manual" value={p1.eldUserManual} notes={p1.eldUserManualNotes} />
        <ResultRow label="Lease Agreement" value={p1.leaseAgreement} notes={p1.leaseAgreementNotes} />
      </div>

      {/* Phase 2 */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-3">
        <h3 className="font-bold text-white mb-3">🚛 Phase 2 — Equipment Inside</h3>
        <ResultRow label="ELD Paper Logs" value={p2.eldPaperLogs} notes={p2.eldPaperLogsNotes} />
        <ResultRow label="PrePass" value={p2.prepass} notes={p2.prepassNotes} />
        {p2.prepassNumber && <InfoRow label="PrePass #" value={p2.prepassNumber} />}
        <ResultRow label="Tablet" value={p2.tablet} notes={p2.tabletNotes} />
        {p2.tabletImei && <InfoRow label="IMEI" value={p2.tabletImei} />}
        {p2.tabletPhone && <InfoRow label="Phone #" value={p2.tabletPhone} />}
        <ResultRow label="Tablet Holder" value={p2.tabletHolder} notes={p2.tabletHolderNotes} />
        <ResultRow label="ELD Device" value={p2.eldDevice} notes={p2.eldDeviceNotes} />
        <ResultRow label="Dash Cam" value={p2.dashCam} notes={p2.dashCamNotes} />
        <ResultRow label="Microwave" value={p2.microwave} notes={p2.microwaveNotes} />
        <ResultRow label="Fridge" value={p2.fridge} notes={p2.fridgeNotes} />
        <ResultRow label="Apple AirTag" value={p2.airTag} notes={p2.airTagNotes} />
        <ResultRow label="Last Oil Change" value={p2.lastOilChange} notes={p2.lastOilChangeNotes} />
        {p2.oilChangeDate && <InfoRow label="Oil Change Date" value={p2.oilChangeDate} />}
        {p2.oilChangeMileage && <InfoRow label="Oil Change Mileage" value={p2.oilChangeMileage} />}
      </div>

      {/* Phase 3 */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-3">
        <h3 className="font-bold text-white mb-3">🔧 Phase 3 — Equipment Outside</h3>
        <ResultRow label="Fire Extinguisher" value={p3.fireExtinguisher} notes={p3.fireExtinguisherNotes} />
        <ResultRow label="Reflective Triangles (3)" value={p3.reflectiveTriangles} notes={p3.reflectiveTrianglesNotes} />
        <ResultRow label="Company Name Decal" value={p3.companyDecal} notes={p3.companyDecalNotes} />
        <ResultRow label="Truck Number Sign" value={p3.truckNumberSign} notes={p3.truckNumberSignNotes} />
        <ResultRow label="IFTA Stickers" value={p3.iftaStickers} notes={p3.iftaStickersNotes} />
        <ResultRow label="Mud Flaps" value={p3.mudFlaps} notes={p3.mudFlapsNotes} />
        <ResultRow label="Deer Guard" value={p3.deerGuard} notes={p3.deerGuardNotes} />
        <ResultRow label="Plate / Sticker (current)" value={p3.plateSticker} notes={p3.plateStickerNotes} />
        <ResultRow label="Chains" value={p3.chains} notes={p3.chainsNotes} />
        <ResultRow label="Tire Conditions" value={p3.tireConditions} notes={p3.tireConditionsNotes} />
        <ResultRow label="Last Safety Orientation with Driver" value={p3.lastSafetyOrientation} notes={p3.lastSafetyOrientationNotes} />
        {p3.safetyOrientationDate && <InfoRow label="Orientation Date" value={p3.safetyOrientationDate} />}
      </div>
    </div>
  )
}
