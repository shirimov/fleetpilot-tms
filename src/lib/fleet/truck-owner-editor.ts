import { validateOwnerPeriods, type OwnerPeriod } from './truck-owner-resolution';

export type OwnerHistoryOptions = {
  canManage: boolean;
  companies: { id: string; name: string }[];
  owners: { id: string; name: string; companyId: string | null }[];
  recipients: { id: string; companyId: string; name: string | null }[];
};
export type OwnerHistorySnapshot = {
  truckId: string; unitNumber: string; revisionId: string | null;
  periods: (OwnerPeriod & { id: string; ownerName: string; revisionId: string; sourceReference: string; reason: string; actorUserId: string; createdAt: string })[];
};

export function buildOwnerHistoryChange(expectedRevisionId: string | null, periods: (OwnerPeriod & { id?: string })[], sourceReference: string, reason: string, options: OwnerHistoryOptions) {
  if (!options.canManage) throw new Error('Owner history is read-only in your scope.');
  if (!sourceReference.trim() || sourceReference.length > 2000 || !reason.trim() || reason.length > 2000) throw new Error('Evidence reference and reason are required (maximum 2000 characters).');
  const confirmed = validateOwnerPeriods(periods);
  for (const period of confirmed) {
    if (!options.companies.some(company => company.id === period.companyId)) throw new Error('Select a verified Company.');
    if (!options.owners.some(owner => owner.id === period.ownerPartyId && (owner.companyId === null || owner.companyId === period.companyId))) throw new Error('Select a verified owner party in the binding Company scope.');
    if (!options.recipients.some(recipient => recipient.companyId === period.companyId && recipient.id === period.providerRecipientId)) throw new Error('Select a verified QM Contractor in the binding Company.');
  }
  return {
    expectedRevisionId, sourceReference: sourceReference.trim(), reason: reason.trim(),
    periods: confirmed.map(({ ownerPartyId, companyId, providerRecipientId, effectiveFrom, effectiveTo }) => ({ ownerPartyId, companyId, providerRecipientId, effectiveFrom, effectiveTo })),
  };
}

export async function ownerHistoryRequest<T>(url: string, init?: RequestInit, transport: typeof fetch = fetch): Promise<T> {
  const response = await transport(url, { ...init, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Owner history request failed.');
  return body as T;
}

export async function saveOwnerHistory(truckId: string, change: ReturnType<typeof buildOwnerHistoryChange>, transport: typeof fetch = fetch) {
  const url = `/api/trucks/${encodeURIComponent(truckId)}/owner-history`;
  const saved = await ownerHistoryRequest<{ truckId: string; revisionId: string }>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) }, transport);
  // A successful POST is not a verified save. Do not retry an uncertain write.
  const readback = await ownerHistoryRequest<OwnerHistorySnapshot>(url, undefined, transport);
  if (saved.truckId !== truckId || !saved.revisionId || saved.revisionId === change.expectedRevisionId || readback.truckId !== truckId || readback.revisionId !== saved.revisionId
    || readback.periods.length !== change.periods.length || readback.periods.some((period, index) => {
      const expected = change.periods[index];
      return (Object.keys(expected) as (keyof OwnerPeriod)[]).some(key => period[key] !== expected[key])
        || period.revisionId !== saved.revisionId || period.sourceReference !== change.sourceReference || period.reason !== change.reason || !period.actorUserId || !period.id || !period.createdAt;
    })) throw new Error('Save readback differs from the reviewed timeline. Reload and review; do not resubmit blindly.');
  return readback;
}
