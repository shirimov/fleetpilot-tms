'use client'
import { useState, useEffect, useCallback } from 'react'

interface Truck {
  id: string
  unitNumber: string
  make?: string
  model?: string
  year?: number
  cabType?: 'DAYCAB' | 'SLEEPER' | 'OWNER_OP'
}

type PassFail = 'pass' | 'fail' | null

interface Phase1Data {
  cabCard: PassFail; cabCardNotes: string
  iftaLicense: PassFail; iftaLicenseNotes: string
  coi: PassFail; coiNotes: string
  operatingAuthority: PassFail; operatingAuthorityNotes: string
  annualInspectionReport: PassFail; annualInspectionDate: string; annualInspectionReportNotes: string
  ucr: PassFail; ucrNotes: string
  eldUserManual: PassFail; eldUserManualNotes: string
  leaseAgreement: PassFail; leaseAgreementNotes: string
}

interface Phase2Data {
  eldPaperLogs: PassFail; eldPaperLogsNotes: string
  prepass: PassFail; prepassNumber: string; prepassNotes: string
  tablet: PassFail; tabletImei: string; tabletPhone: string; tabletNotes: string
  tabletHolder: PassFail; tabletHolderNotes: string
  eldDevice: PassFail; eldDeviceNotes: string
  dashCam: PassFail; dashCamNotes: string
  microwave: PassFail; microwaveNotes: string
  fridge: PassFail; fridgeNotes: string
  airTag: PassFail; airTagNotes: string
  lastOilChange: PassFail; oilChangeDate: string; oilChangeMileage: string; lastOilChangeNotes: string
}

interface Phase3Data {
  fireExtinguisher: PassFail; fireExtinguisherNotes: string
  reflectiveTriangles: PassFail; reflectiveTrianglesNotes: string
  companyDecal: PassFail; companyDecalNotes: string
  truckNumberSign: PassFail; truckNumberSignNotes: string
  iftaStickers: PassFail; iftaStickersNotes: string
  mudFlaps: PassFail; mudFlapsNotes: string
  deerGuard: PassFail; deerGuardNotes: string
  plateSticker: PassFail; plateStickerNotes: string
  chains: PassFail; chainsNotes: string
  tireConditions: PassFail; tireConditionsNotes: string
  lastSafetyOrientation: PassFail; safetyOrientationDate: string; lastSafetyOrientationNotes: string
}

const defaultPhase1 = (): Phase1Data => ({
  cabCard: null, cabCardNotes: '',
  iftaLicense: null, iftaLicenseNotes: '',
  coi: null, coiNotes: '',
  operatingAuthority: null, operatingAuthorityNotes: '',
  annualInspectionReport: null, annualInspectionDate: '', annualInspectionReportNotes: '',
  ucr: null, ucrNotes: '',
  eldUserManual: null, eldUserManualNotes: '',
  leaseAgreement: null, leaseAgreementNotes: '',
})

const defaultPhase2 = (): Phase2Data => ({
  eldPaperLogs: null, eldPaperLogsNotes: '',
  prepass: null, prepassNumber: '', prepassNotes: '',
  tablet: null, tabletImei: '', tabletPhone: '', tabletNotes: '',
  tabletHolder: null, tabletHolderNotes: '',
  eldDevice: null, eldDeviceNotes: '',
  dashCam: null, dashCamNotes: '',
  microwave: null, microwaveNotes: '',
  fridge: null, fridgeNotes: '',
  airTag: null, airTagNotes: '',
  lastOilChange: null, oilChangeDate: '', oilChangeMileage: '', lastOilChangeNotes: '',
})

const defaultPhase3 = (): Phase3Data => ({
  fireExtinguisher: null, fireExtinguisherNotes: '',
  reflectiveTriangles: null, reflectiveTrianglesNotes: '',
  companyDecal: null, companyDecalNotes: '',
  truckNumberSign: null, truckNumberSignNotes: '',
  iftaStickers: null, iftaStickersNotes: '',
  mudFlaps: null, mudFlapsNotes: '',
  deerGuard: null, deerGuardNotes: '',
  plateSticker: null, plateStickerNotes: '',
  chains: null, chainsNotes: '',
  tireConditions: null, tireConditionsNotes: '',
  lastSafetyOrientation: null, safetyOrientationDate: '', lastSafetyOrientationNotes: '',
})

function PassFailToggle({ value, onChange }: { value: PassFail; onChange: (v: PassFail) => void }) {
  return (
    <div className="flex gap-2 mt-2">
      <button
        type="button"
        onClick={() => onChange(value === 'pass' ? null : 'pass')}
        className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${value === 'pass' ? 'bg-green-500 text-white shadow-lg scale-105' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
      >
        ✅ Pass
      </button>
      <button
        type="button"
        onClick={() => onChange(value === 'fail' ? null : 'fail')}
        className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${value === 'fail' ? 'bg-red-500 text-white shadow-lg scale-105' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
      >
        ❌ Fail
      </button>
    </div>
  )
}

function NotesInput({ value, onChange, placeholder = 'Notes (optional)' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full mt-2 px-3 py-2 bg-gray-700 rounded-lg text-white text-sm placeholder-gray-500 border border-gray-600 focus:border-blue-500 focus:outline-none"
    />
  )
}

function ItemCard({ label, children, unrated }: { label: string; children: React.ReactNode; unrated?: boolean }) {
  return (
    <div className={`bg-gray-800 rounded-xl p-4 border transition-colors ${unrated ? 'border-red-500/70 bg-red-950/20' : 'border-gray-700'}`}>
      <div className="flex items-center justify-between">
        <div className="font-semibold text-white text-base">{label}</div>
        {unrated && <span className="text-red-400 text-xs font-bold">⚠ Required</span>}
      </div>
      {children}
    </div>
  )
}

function SmallInput({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div className="mt-2">
      <label className="text-gray-400 text-xs">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 bg-gray-700 rounded-lg text-white text-sm placeholder-gray-500 border border-gray-600 focus:border-blue-500 focus:outline-none"
      />
    </div>
  )
}

const DRAFT_KEY = 'tms_inspection_draft'

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
}

export default function TruckInspectionForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const draft = typeof window !== 'undefined' ? loadDraft() : null

  const [step, setStep] = useState(draft?.step ?? 0)
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [truckId, setTruckId] = useState(draft?.truckId ?? '')
  const selectedTruck = trucks.find(t => t.id === truckId)
  const cabType = selectedTruck?.cabType ?? 'SLEEPER'
  const hasBunk = cabType === 'SLEEPER' || cabType === 'OWNER_OP'
  const [inspectedBy, setInspectedBy] = useState(draft?.inspectedBy ?? '')
  const [currentMileage, setCurrentMileage] = useState(draft?.currentMileage ?? '')
  const [showSetupErrors, setShowSetupErrors] = useState(false)
  const [lastInspection, setLastInspection] = useState<any>(null)
  const [lastOrientation, setLastOrientation] = useState<any>(null)
  const [prefillApplied, setPrefillApplied] = useState(false)

  const [showPhase1Errors, setShowPhase1Errors] = useState(false)
  const [showPhase2Errors, setShowPhase2Errors] = useState(false)
  const [showPhase3Errors, setShowPhase3Errors] = useState(false)
  const [phase1, setPhase1] = useState<Phase1Data>(draft?.phase1 ?? defaultPhase1())
  const [phase2, setPhase2] = useState<Phase2Data>(draft?.phase2 ?? defaultPhase2())
  const [phase3, setPhase3] = useState<Phase3Data>(draft?.phase3 ?? defaultPhase3())
  const [notes, setNotes] = useState(draft?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Record<string, File | null>>({ front: null, driver: null, passenger: null, rear: null })
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [draftRestored, setDraftRestored] = useState(!!draft)

  // Auto-save draft on every change
  useEffect(() => {
    if (savedId) return // don't save draft after submission
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, truckId, inspectedBy, currentMileage, phase1, phase2, phase3, notes }))
    } catch {}
  }, [step, truckId, inspectedBy, currentMileage, phase1, phase2, phase3, notes, savedId])

  useEffect(() => {
    fetch('/api/trucks').then(r => r.json()).then(setTrucks).catch(console.error)
  }, [])

  useEffect(() => {
    if (!truckId) { setLastInspection(null); setLastOrientation(null); setPrefillApplied(false); return }
    setPrefillApplied(false)
    Promise.all([
      fetch(`/api/inspections/truck/latest/${truckId}`).then(r => r.json()),
      fetch(`/api/inspections/driver/latest-by-truck/${truckId}`).then(r => r.json()),
    ]).then(([insp, ori]) => {
      setLastInspection(insp && !insp.error ? insp : null)
      setLastOrientation(ori && !ori.error ? ori : null)
    }).catch(console.error)
  }, [truckId])

  // Prefill Phase2 details from last inspection when truck is selected
  useEffect(() => {
    if (!lastInspection || prefillApplied) return
    const p2 = lastInspection.phase2 as any
    if (!p2) return
    setPrefillApplied(true)
    setPhase2(prev => ({
      ...prev,
      prepassNumber: p2.prepassNumber || prev.prepassNumber,
      tabletImei:    p2.tabletImei    || prev.tabletImei,
      tabletPhone:   p2.tabletPhone   || prev.tabletPhone,
    }))
  }, [lastInspection, prefillApplied])

  const p1 = (key: keyof Phase1Data, val: PassFail) => setPhase1(p => ({ ...p, [key]: val }))
  const p1n = (key: keyof Phase1Data, val: string) => setPhase1(p => ({ ...p, [key]: val }))
  const p2 = (key: keyof Phase2Data, val: PassFail) => setPhase2(p => ({ ...p, [key]: val }))
  const p2n = (key: keyof Phase2Data, val: string) => setPhase2(p => ({ ...p, [key]: val }))
  const p3 = (key: keyof Phase3Data, val: PassFail) => setPhase3(p => ({ ...p, [key]: val }))
  const p3n = (key: keyof Phase3Data, val: string) => setPhase3(p => ({ ...p, [key]: val }))

  const allPhase1 = Object.entries(phase1).filter(([k]) => !k.endsWith('Notes')).every(([, v]) => v !== null)
  const allPhase2 = [
    phase2.eldPaperLogs, phase2.prepass, phase2.tablet, phase2.tabletHolder,
    phase2.eldDevice, phase2.dashCam, phase2.airTag, phase2.lastOilChange,
    ...(hasBunk ? [phase2.microwave, phase2.fridge] : []),
  ].every(v => v !== null)
  const allPhase3 = [phase3.fireExtinguisher, phase3.reflectiveTriangles, phase3.companyDecal, phase3.truckNumberSign, phase3.iftaStickers, phase3.mudFlaps, phase3.deerGuard, phase3.plateSticker, phase3.chains, phase3.tireConditions, phase3.lastSafetyOrientation].every(v => v !== null)

  const computePassed = () => {
    // These items do NOT count toward overall pass/fail
    const p1vals = ['cabCard','iftaLicense','coi','operatingAuthority','annualInspectionReport','ucr','eldUserManual','leaseAgreement'] as const
    // tablet, tabletHolder, microwave, fridge excluded — tablet/holder: driver may use phone; microwave/fridge: optional
    const p2vals = ['eldPaperLogs','prepass','eldDevice','dashCam','airTag','lastOilChange'] as const
    // truckNumberSign, deerGuard excluded — cosmetic/optional
    const p3vals = ['fireExtinguisher','reflectiveTriangles','companyDecal','iftaStickers','mudFlaps','plateSticker','chains','tireConditions','lastSafetyOrientation'] as const
    const allFails = [
      ...p1vals.map(k => phase1[k]),
      ...p2vals.map(k => phase2[k]),
      ...p3vals.map(k => phase3[k]),
    ]
    return !allFails.includes('fail')
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/inspections/truck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truckId, inspectedBy, currentMileage: currentMileage ? parseInt(currentMileage) : null, phase1, phase2, phase3, notes, passed: computePassed() }),
      })
      if (!res.ok) throw new Error('Failed to save')
      const data = await res.json()
      clearDraft()
      setSavedId(data.id)
      setStep(5)
    } catch (e) {
      setError('Failed to save inspection. Please try again.')
    }
    setSaving(false)
  }

  const handlePhotoCapture = (side: string, file: File) => {
    setPhotos(p => ({ ...p, [side]: file }))
  }

  const handleUploadPhotos = async () => {
    if (!savedId) return
    setPhotoUploading(true)
    setPhotoError('')
    try {
      const formData = new FormData()
      for (const [side, file] of Object.entries(photos)) {
        if (file) formData.append(side, file)
      }
      const res = await fetch(`/api/inspections/truck/${savedId}/photos`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Upload failed')
      onSaved()
    } catch (e) {
      setPhotoError('Failed to upload photos. You can skip and add them later.')
    }
    setPhotoUploading(false)
  }

  const stepLabels = ['Setup', 'Phase 1', 'Phase 2', 'Phase 3', 'Summary', 'Photos']

  return (
    <div className="min-h-screen bg-gray-900 p-4 pb-24 md:pb-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onCancel} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 text-white px-3 py-2 rounded-lg text-sm font-semibold transition-colors">
          ← Back
        </button>
        <h1 className="text-xl font-bold text-white">New Truck Inspection</h1>
      </div>

      {/* Draft restored banner */}
      {draftRestored && (
        <div className="flex items-center justify-between bg-yellow-900/40 border border-yellow-700/50 rounded-xl px-4 py-3 mb-4 text-sm">
          <span className="text-yellow-300">⚡ Draft restored — pick up where you left off</span>
          <button
            type="button"
            onClick={() => {
              clearDraft()
              setStep(0); setTruckId(''); setInspectedBy(''); setCurrentMileage('')
              setPhase1(defaultPhase1()); setPhase2(defaultPhase2()); setPhase3(defaultPhase3()); setNotes('')
              setDraftRestored(false)
            }}
            className="text-yellow-500 hover:text-white ml-3 text-xs underline whitespace-nowrap"
          >
            Start fresh
          </button>
        </div>
      )}

      {/* Step Indicator */}
      <div className="flex gap-1 mb-6">
        {stepLabels.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { if (i < step) setStep(i) }}
            className={`flex-1 text-center ${i < step ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className={`h-2 rounded-full mb-1 ${i <= step ? 'bg-blue-500' : 'bg-gray-700'}`} />
            <div className={`text-xs ${i === step ? 'text-blue-400 font-semibold' : i < step ? 'text-gray-400 hover:text-white' : 'text-gray-600'}`}>{label}</div>
          </button>
        ))}
      </div>

      {/* Step 0: Setup */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className="text-gray-300 font-semibold block mb-2">
              Select Truck {showSetupErrors && !truckId && <span className="text-red-400 text-sm font-normal">← required</span>}
            </label>
            <select
              value={truckId}
              onChange={e => { setTruckId(e.target.value); setShowSetupErrors(false) }}
              className={`w-full px-4 py-3 bg-gray-800 rounded-xl text-white text-base focus:outline-none transition-colors ${showSetupErrors && !truckId ? 'border-2 border-red-500' : 'border border-gray-600 focus:border-blue-500'}`}
            >
              <option value="">-- Choose a truck --</option>
              {trucks.map(t => (
                <option key={t.id} value={t.id}>#{t.unitNumber} {t.year} {t.make} {t.model}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-300 font-semibold block mb-2">
              Inspector Name {showSetupErrors && !inspectedBy.trim() && <span className="text-red-400 text-sm font-normal">← required</span>}
            </label>
            <input
              type="text"
              value={inspectedBy}
              onChange={e => setInspectedBy(e.target.value)}
              placeholder="Your name"
              className={`w-full px-4 py-3 bg-gray-800 rounded-xl text-white text-base focus:outline-none placeholder-gray-500 transition-colors ${showSetupErrors && !inspectedBy.trim() ? 'border-2 border-red-500' : 'border border-gray-600 focus:border-blue-500'}`}
            />
          </div>
          {selectedTruck && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">{cabType === 'DAYCAB' ? '☀️' : cabType === 'OWNER_OP' ? '👤' : '🛏'}</span>
              <div>
                <div className="text-white font-semibold text-sm">
                  {cabType === 'DAYCAB' ? 'Day Cab' : cabType === 'OWNER_OP' ? "Owner's Truck" : 'Sleeper'}
                </div>
                <div className="text-gray-400 text-xs">
                  {cabType === 'DAYCAB' ? 'Microwave & fridge checks will be skipped' : 'Full inspection including bunk equipment'}
                </div>
              </div>
            </div>
          )}
          {lastInspection && (
            <div className="bg-blue-950/40 border border-blue-700/40 rounded-xl px-4 py-3">
              <div className="text-blue-300 font-semibold text-sm mb-1">📋 Previous Inspection Found</div>
              <div className="text-gray-400 text-xs">
                {new Date(lastInspection.inspectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {' · '}{lastInspection.inspectedBy}
                {' · '}<span className={lastInspection.passed ? 'text-green-400' : 'text-red-400'}>{lastInspection.passed ? '✅ Passed' : '❌ Failed'}</span>
              </div>
              <div className="text-gray-500 text-xs mt-1">PrePass # and tablet info will be pre-filled</div>
            </div>
          )}
          {lastOrientation && (
            <div className="bg-purple-950/40 border border-purple-700/40 rounded-xl px-4 py-3">
              <div className="text-purple-300 font-semibold text-sm mb-1">👤 Last Driver Orientation</div>
              <div className="text-gray-400 text-xs">
                {lastOrientation.driver?.firstName} {lastOrientation.driver?.lastName}
                {' · '}{new Date(lastOrientation.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="text-gray-500 text-xs mt-1">Once drivers are assigned to trucks, you'll be prompted to re-do orientation here</div>
            </div>
          )}
          <div>
            <label className="text-gray-300 font-semibold block mb-2">
              Current Mileage
            </label>
            <input
              type="number"
              value={currentMileage}
              onChange={e => setCurrentMileage(e.target.value)}
              placeholder="e.g. 245000"
              className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-xl text-white text-base focus:outline-none focus:border-blue-500 placeholder-gray-500"
            />
          </div>
          <button
            onClick={() => {
              if (!truckId || !inspectedBy.trim()) {
                setShowSetupErrors(true)
                return
              }
              setStep(1)
            }}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-lg transition-colors mt-4"
          >
            Start Inspection →
          </button>
        </div>
      )}

      {/* Step 1: Phase 1 — Binder Documents */}
      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-white mb-4">📁 Phase 1 — Binder Documents</h2>
          <p className="text-gray-400 text-sm mb-4">Mark each document as Present ✅ or Missing ❌</p>

          <ItemCard label="Cab Card (Registration / IRP)" unrated={showPhase1Errors && phase1.cabCard === null}>
            <PassFailToggle value={phase1.cabCard} onChange={v => p1('cabCard', v)} />
            <NotesInput value={phase1.cabCardNotes} onChange={v => p1n('cabCardNotes', v)} />
          </ItemCard>
          <ItemCard label="IFTA License" unrated={showPhase1Errors && phase1.iftaLicense === null}>
            <PassFailToggle value={phase1.iftaLicense} onChange={v => p1('iftaLicense', v)} />
            <NotesInput value={phase1.iftaLicenseNotes} onChange={v => p1n('iftaLicenseNotes', v)} />
          </ItemCard>
          <ItemCard label="COI (Certificate of Insurance)" unrated={showPhase1Errors && phase1.coi === null}>
            <PassFailToggle value={phase1.coi} onChange={v => p1('coi', v)} />
            <NotesInput value={phase1.coiNotes} onChange={v => p1n('coiNotes', v)} />
          </ItemCard>
          <ItemCard label="Operating Authority" unrated={showPhase1Errors && phase1.operatingAuthority === null}>
            <PassFailToggle value={phase1.operatingAuthority} onChange={v => p1('operatingAuthority', v)} />
            <NotesInput value={phase1.operatingAuthorityNotes} onChange={v => p1n('operatingAuthorityNotes', v)} />
          </ItemCard>
          <ItemCard label="Annual Inspection Report" unrated={showPhase1Errors && phase1.annualInspectionReport === null}>
            <PassFailToggle value={phase1.annualInspectionReport} onChange={v => p1('annualInspectionReport', v)} />
            <SmallInput label="Annual Inspection Date" type="date" value={phase1.annualInspectionDate} onChange={v => p1n('annualInspectionDate', v)} />
            <NotesInput value={phase1.annualInspectionReportNotes} onChange={v => p1n('annualInspectionReportNotes', v)} />
          </ItemCard>
          <ItemCard label="UCR" unrated={showPhase1Errors && phase1.ucr === null}>
            <PassFailToggle value={phase1.ucr} onChange={v => p1('ucr', v)} />
            <NotesInput value={phase1.ucrNotes} onChange={v => p1n('ucrNotes', v)} />
          </ItemCard>
          <ItemCard label="ELD User Manual" unrated={showPhase1Errors && phase1.eldUserManual === null}>
            <PassFailToggle value={phase1.eldUserManual} onChange={v => p1('eldUserManual', v)} />
            <NotesInput value={phase1.eldUserManualNotes} onChange={v => p1n('eldUserManualNotes', v)} />
          </ItemCard>
          <ItemCard label="Lease Agreement" unrated={showPhase1Errors && phase1.leaseAgreement === null}>
            <PassFailToggle value={phase1.leaseAgreement} onChange={v => p1('leaseAgreement', v)} />
            <NotesInput value={phase1.leaseAgreementNotes} onChange={v => p1n('leaseAgreementNotes', v)} />
          </ItemCard>

          <div className="flex gap-3 mt-6">
            <button onClick={() => setStep(0)} className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors">← Back</button>
            <button
              onClick={() => { if (!allPhase1) { setShowPhase1Errors(true); return } setShowPhase1Errors(false); setStep(2) }}
              className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
            >
              Phase 2 →
            </button>
          </div>
          {showPhase1Errors && !allPhase1 && <p className="text-red-400 text-sm text-center font-semibold">⚠ Please rate all highlighted items</p>}
        </div>
      )}

      {/* Step 2: Phase 2 — Equipment Inside */}
      {step === 2 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-white mb-4">🚛 Phase 2 — Equipment Inside Cab</h2>

          <ItemCard label="ELD Paper Logs" unrated={showPhase2Errors && phase2.eldPaperLogs === null}>
            <PassFailToggle value={phase2.eldPaperLogs} onChange={v => p2('eldPaperLogs', v)} />
            <NotesInput value={phase2.eldPaperLogsNotes} onChange={v => p2n('eldPaperLogsNotes', v)} />
          </ItemCard>
          <ItemCard label="PrePass" unrated={showPhase2Errors && phase2.prepass === null}>
            <PassFailToggle value={phase2.prepass} onChange={v => p2('prepass', v)} />
            <SmallInput label="PrePass #" value={phase2.prepassNumber} onChange={v => p2n('prepassNumber', v)} placeholder="PrePass number" />
            <NotesInput value={phase2.prepassNotes} onChange={v => p2n('prepassNotes', v)} />
          </ItemCard>
          <ItemCard label="Tablet / Device" unrated={showPhase2Errors && phase2.tablet === null}>
            <div className="text-gray-500 text-xs mt-1 mb-1">Driver's phone is acceptable — does not affect overall result</div>
            <PassFailToggle value={phase2.tablet} onChange={v => p2('tablet', v)} />
            <SmallInput label="IMEI" value={phase2.tabletImei} onChange={v => p2n('tabletImei', v)} placeholder="IMEI number" />
            <SmallInput label="Phone # (with area code)" value={phase2.tabletPhone} onChange={v => p2n('tabletPhone', v)} placeholder="e.g. (555) 867-5309" />
            <NotesInput value={phase2.tabletNotes} onChange={v => p2n('tabletNotes', v)} />
          </ItemCard>
          <ItemCard label="Tablet Holder" unrated={showPhase2Errors && phase2.tabletHolder === null}>
            <div className="text-gray-500 text-xs mt-1 mb-1">Does not affect overall result</div>
            <PassFailToggle value={phase2.tabletHolder} onChange={v => p2('tabletHolder', v)} />
            <NotesInput value={phase2.tabletHolderNotes} onChange={v => p2n('tabletHolderNotes', v)} />
          </ItemCard>
          <ItemCard label="ELD Device" unrated={showPhase2Errors && phase2.eldDevice === null}>
            <PassFailToggle value={phase2.eldDevice} onChange={v => p2('eldDevice', v)} />
            <NotesInput value={phase2.eldDeviceNotes} onChange={v => p2n('eldDeviceNotes', v)} />
          </ItemCard>
          <ItemCard label="Dash Cam" unrated={showPhase2Errors && phase2.dashCam === null}>
            <PassFailToggle value={phase2.dashCam} onChange={v => p2('dashCam', v)} />
            <NotesInput value={phase2.dashCamNotes} onChange={v => p2n('dashCamNotes', v)} />
          </ItemCard>
          {hasBunk && (
            <ItemCard label="Microwave" unrated={showPhase2Errors && phase2.microwave === null}>
              <div className="text-gray-500 text-xs mt-1 mb-1">Does not affect overall result</div>
              <PassFailToggle value={phase2.microwave} onChange={v => p2('microwave', v)} />
              <NotesInput value={phase2.microwaveNotes} onChange={v => p2n('microwaveNotes', v)} />
            </ItemCard>
          )}
          {hasBunk && (
            <ItemCard label="Fridge" unrated={showPhase2Errors && phase2.fridge === null}>
              <div className="text-gray-500 text-xs mt-1 mb-1">Does not affect overall result</div>
              <PassFailToggle value={phase2.fridge} onChange={v => p2('fridge', v)} />
              <NotesInput value={phase2.fridgeNotes} onChange={v => p2n('fridgeNotes', v)} />
            </ItemCard>
          )}
          <ItemCard label="Apple AirTag" unrated={showPhase2Errors && phase2.airTag === null}>
            <PassFailToggle value={phase2.airTag} onChange={v => p2('airTag', v)} />
            <NotesInput value={phase2.airTagNotes} onChange={v => p2n('airTagNotes', v)} />
          </ItemCard>
          <ItemCard label="Last Oil Change" unrated={showPhase2Errors && phase2.lastOilChange === null}>
            <PassFailToggle value={phase2.lastOilChange} onChange={v => p2('lastOilChange', v)} />
            <SmallInput label="Date" type="date" value={phase2.oilChangeDate} onChange={v => p2n('oilChangeDate', v)} />
            <SmallInput label="Mileage" value={phase2.oilChangeMileage} onChange={v => p2n('oilChangeMileage', v)} placeholder="e.g. 125000" />
            <NotesInput value={phase2.lastOilChangeNotes} onChange={v => p2n('lastOilChangeNotes', v)} />
          </ItemCard>

          <div className="flex gap-3 mt-6">
            <button onClick={() => setStep(1)} className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors">← Back</button>
            <button
              onClick={() => { if (!allPhase2) { setShowPhase2Errors(true); return } setShowPhase2Errors(false); setStep(3) }}
              className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
            >
              Phase 3 →
            </button>
          </div>
          {showPhase2Errors && !allPhase2 && <p className="text-red-400 text-sm text-center font-semibold">⚠ Please rate all highlighted items</p>}
        </div>
      )}

      {/* Step 3: Phase 3 — Equipment Outside */}
      {step === 3 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-white mb-4">🔧 Phase 3 — Equipment Outside</h2>

          <ItemCard label="Fire Extinguisher" unrated={showPhase3Errors && phase3.fireExtinguisher === null}>
            <PassFailToggle value={phase3.fireExtinguisher} onChange={v => p3('fireExtinguisher', v)} />
            <NotesInput value={phase3.fireExtinguisherNotes} onChange={v => p3n('fireExtinguisherNotes', v)} />
          </ItemCard>
          <ItemCard label="Reflective Triangles (3)" unrated={showPhase3Errors && phase3.reflectiveTriangles === null}>
            <PassFailToggle value={phase3.reflectiveTriangles} onChange={v => p3('reflectiveTriangles', v)} />
            <NotesInput value={phase3.reflectiveTrianglesNotes} onChange={v => p3n('reflectiveTrianglesNotes', v)} />
          </ItemCard>
          <ItemCard label="Company Name Decal" unrated={showPhase3Errors && phase3.companyDecal === null}>
            <PassFailToggle value={phase3.companyDecal} onChange={v => p3('companyDecal', v)} />
            <NotesInput value={phase3.companyDecalNotes} onChange={v => p3n('companyDecalNotes', v)} />
          </ItemCard>
          <ItemCard label="Truck Number Sign" unrated={showPhase3Errors && phase3.truckNumberSign === null}>
            <div className="text-gray-500 text-xs mt-1 mb-1">Does not affect overall result</div>
            <PassFailToggle value={phase3.truckNumberSign} onChange={v => p3('truckNumberSign', v)} />
            <NotesInput value={phase3.truckNumberSignNotes} onChange={v => p3n('truckNumberSignNotes', v)} />
          </ItemCard>
          <ItemCard label="IFTA Stickers" unrated={showPhase3Errors && phase3.iftaStickers === null}>
            <PassFailToggle value={phase3.iftaStickers} onChange={v => p3('iftaStickers', v)} />
            <NotesInput value={phase3.iftaStickersNotes} onChange={v => p3n('iftaStickersNotes', v)} />
          </ItemCard>
          <ItemCard label="Mud Flaps" unrated={showPhase3Errors && phase3.mudFlaps === null}>
            <PassFailToggle value={phase3.mudFlaps} onChange={v => p3('mudFlaps', v)} />
            <NotesInput value={phase3.mudFlapsNotes} onChange={v => p3n('mudFlapsNotes', v)} />
          </ItemCard>
          <ItemCard label="Deer Guard" unrated={showPhase3Errors && phase3.deerGuard === null}>
            <div className="text-gray-500 text-xs mt-1 mb-1">Does not affect overall result</div>
            <PassFailToggle value={phase3.deerGuard} onChange={v => p3('deerGuard', v)} />
            <NotesInput value={phase3.deerGuardNotes} onChange={v => p3n('deerGuardNotes', v)} />
          </ItemCard>
          <ItemCard label="Plate / Sticker (current)" unrated={showPhase3Errors && phase3.plateSticker === null}>
            <PassFailToggle value={phase3.plateSticker} onChange={v => p3('plateSticker', v)} />
            <NotesInput value={phase3.plateStickerNotes} onChange={v => p3n('plateStickerNotes', v)} />
          </ItemCard>
          <ItemCard label="Chains" unrated={showPhase3Errors && phase3.chains === null}>
            <PassFailToggle value={phase3.chains} onChange={v => p3('chains', v)} />
            <NotesInput value={phase3.chainsNotes} onChange={v => p3n('chainsNotes', v)} />
          </ItemCard>
          <ItemCard label="Tire Conditions" unrated={showPhase3Errors && phase3.tireConditions === null}>
            <PassFailToggle value={phase3.tireConditions} onChange={v => p3('tireConditions', v)} />
            <NotesInput value={phase3.tireConditionsNotes} onChange={v => p3n('tireConditionsNotes', v)} />
          </ItemCard>
          <ItemCard label="Last Safety Orientation with Driver" unrated={showPhase3Errors && phase3.lastSafetyOrientation === null}>
            <PassFailToggle value={phase3.lastSafetyOrientation} onChange={v => p3('lastSafetyOrientation', v)} />
            <SmallInput label="Date of Last Orientation" type="date" value={phase3.safetyOrientationDate} onChange={v => p3n('safetyOrientationDate', v)} />
            <NotesInput value={phase3.lastSafetyOrientationNotes} onChange={v => p3n('lastSafetyOrientationNotes', v)} />
          </ItemCard>

          <div className="flex gap-3 mt-6">
            <button onClick={() => setStep(2)} className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors">← Back</button>
            <button
              onClick={() => { if (!allPhase3) { setShowPhase3Errors(true); return } setShowPhase3Errors(false); setStep(4) }}
              className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
            >
              Review →
            </button>
          </div>
          {showPhase3Errors && !allPhase3 && <p className="text-red-400 text-sm text-center font-semibold">⚠ Please rate all highlighted items</p>}
        </div>
      )}

      {/* Step 4: Summary */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white mb-2">📋 Summary</h2>
          <div className={`p-4 rounded-xl text-center text-2xl font-bold ${computePassed() ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {computePassed() ? '✅ INSPECTION PASSED' : '❌ INSPECTION HAS FAILURES'}
          </div>

          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-300"><span className="text-gray-500">Truck:</span> #{trucks.find(t => t.id === truckId)?.unitNumber}</div>
            <div className="text-gray-300 mt-1"><span className="text-gray-500">Inspector:</span> {inspectedBy}</div>
            {currentMileage && <div className="text-gray-300 mt-1"><span className="text-gray-500">Mileage:</span> {parseInt(currentMileage).toLocaleString()} mi</div>}
          </div>

          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="font-semibold text-gray-300 mb-2">Phase 1 — Binder Docs</div>
            {[
              ['Cab Card', phase1.cabCard], ['IFTA License', phase1.iftaLicense], ['COI', phase1.coi],
              ['Operating Authority', phase1.operatingAuthority],
              [`Annual Inspection${phase1.annualInspectionDate ? ` (${phase1.annualInspectionDate})` : ''}`, phase1.annualInspectionReport],
              ['UCR', phase1.ucr], ['ELD Manual', phase1.eldUserManual], ['Lease Agreement', phase1.leaseAgreement],
            ].map(([label, val]) => (
              <div key={label as string} className="flex justify-between py-1 border-b border-gray-700 last:border-0">
                <span className="text-gray-400 text-sm">{label as string}</span>
                <span className={val === 'pass' ? 'text-green-400' : 'text-red-400'}>{val === 'pass' ? '✅' : '❌'}</span>
              </div>
            ))}
          </div>

          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="font-semibold text-gray-300 mb-2">Phase 2 — Inside</div>
            {[
              ['ELD Paper Logs', phase2.eldPaperLogs], ['PrePass', phase2.prepass], ['Tablet', phase2.tablet],
              ['Tablet Holder', phase2.tabletHolder], ['ELD Device', phase2.eldDevice], ['Dash Cam', phase2.dashCam],
              ...(hasBunk ? [['Microwave', phase2.microwave], ['Fridge', phase2.fridge]] : []),
              ['Apple AirTag', phase2.airTag],
              ['Last Oil Change', phase2.lastOilChange],
            ].map(([label, val]) => (
              <div key={label as string} className="flex justify-between py-1 border-b border-gray-700 last:border-0">
                <span className="text-gray-400 text-sm">{label as string}</span>
                <span className={val === 'pass' ? 'text-green-400' : 'text-red-400'}>{val === 'pass' ? '✅' : '❌'}</span>
              </div>
            ))}
          </div>

          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="font-semibold text-gray-300 mb-2">Phase 3 — Outside</div>
            {[
              ['Fire Extinguisher', phase3.fireExtinguisher], ['Reflective Triangles', phase3.reflectiveTriangles],
              ['Company Decal', phase3.companyDecal], ['Truck Number Sign', phase3.truckNumberSign],
              ['IFTA Stickers', phase3.iftaStickers], ['Mud Flaps', phase3.mudFlaps],
              ['Deer Guard', phase3.deerGuard], ['Plate / Sticker', phase3.plateSticker],
              ['Chains', phase3.chains], ['Tire Conditions', phase3.tireConditions],
              ['Safety Orientation', phase3.lastSafetyOrientation],
            ].map(([label, val]) => (
              <div key={label as string} className="flex justify-between py-1 border-b border-gray-700 last:border-0">
                <span className="text-gray-400 text-sm">{label as string}</span>
                <span className={val === 'pass' ? 'text-green-400' : 'text-red-400'}>{val === 'pass' ? '✅' : '❌'}</span>
              </div>
            ))}
          </div>

          <div>
            <label className="text-gray-300 font-semibold block mb-2">Additional Notes</label>
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
            <button onClick={() => setStep(3)} className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors">← Back</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white font-bold rounded-xl transition-colors"
            >
              {saving ? 'Saving...' : '💾 Save Inspection'}
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Photos */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="text-center mb-2">
            <div className="text-4xl mb-2">📸</div>
            <h2 className="text-xl font-bold text-white">Truck Photos</h2>
            <p className="text-gray-400 text-sm mt-1">Take a photo from each side of the truck</p>
          </div>

          {(
            [
              { side: 'front',     label: 'Front',           emoji: '⬆️', hint: 'Face the front of the truck' },
              { side: 'driver',    label: 'Driver Side',     emoji: '◀️', hint: 'Stand on the driver\'s left side' },
              { side: 'passenger', label: 'Passenger Side',  emoji: '▶️', hint: 'Stand on the passenger\'s right side' },
              { side: 'rear',      label: 'Rear',            emoji: '⬇️', hint: 'Face the back of the truck' },
            ] as const
          ).map(({ side, label, emoji, hint }) => {
            const file = photos[side]
            const preview = file ? URL.createObjectURL(file) : null
            return (
              <div key={side} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
                  <span className="text-xl">{emoji}</span>
                  <div>
                    <div className="font-semibold text-white text-sm">{label}</div>
                    <div className="text-gray-500 text-xs">{hint}</div>
                  </div>
                  {file && <span className="ml-auto text-green-400 text-sm font-bold">✅ Ready</span>}
                </div>
                {preview && (
                  <img src={preview} alt={label} className="w-full h-40 object-cover" />
                )}
                <div className="p-3">
                  <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm cursor-pointer transition-all ${file ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                    <span>{file ? '🔄 Retake' : '📷 Take Photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoCapture(side, f) }}
                    />
                  </label>
                </div>
              </div>
            )
          })}

          {photoError && <div className="bg-red-900 text-red-300 rounded-xl p-3 text-sm">{photoError}</div>}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleUploadPhotos}
              disabled={photoUploading || Object.values(photos).every(f => f === null)}
              className="flex-1 py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl transition-colors"
            >
              {photoUploading ? 'Uploading...' : '✅ Done — Save Photos'}
            </button>
          </div>
          <button
            onClick={onSaved}
            className="w-full py-3 text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            Skip photos →
          </button>
        </div>
      )}
    </div>
  )
}
