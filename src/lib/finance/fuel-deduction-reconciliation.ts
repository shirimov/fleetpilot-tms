import { createHash } from 'node:crypto';
import type { FuelDeductionPolicy, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { historyDate, TruckCompanyHistoryService } from '@/lib/fleet/truck-company-history';
import { normalizeVin } from '@/lib/fleet/truck-import-service';
import { normalizeTruckUnitNumber } from '@/lib/fleet/truck-normalization';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';

export const reconciliationStatuses = [
  'MATCHED', 'UNDER_DEDUCTED', 'OVER_DEDUCTED', 'MISSING_DEDUCTION', 'STATEMENT_ONLY',
  'TIMING_DIFFERENCE', 'NO_PILOT_DATA_IMPORTED', 'NEEDS_COMPANY_HISTORY',
  'NEEDS_TRUCK_MAPPING', 'NEEDS_RECIPIENT_MAPPING', 'NEEDS_RECIPIENT_REVIEW',
  'PRODUCT_CLASSIFICATION_REVIEW', 'NEEDS_POLICY', 'NEEDS_REVIEW',
] as const;
export type FuelReconciliationStatus = typeof reconciliationStatuses[number];

export type ComparablePilotAmount = {
  amountMinor: bigint;
  retailMinor: bigint | null;
  savingsMinor: bigint | null;
};

export function classifyFuelDeductionLine(line: {
  sourceArray: string; kind: string; included: boolean | null; amountMinor: bigint | null; metadata?: unknown;
}) {
  if (line.sourceArray !== 'fuel_transactions' || line.kind !== 'DEDUCTION' || line.included === false || line.amountMinor === null) return false;
  if (!line.metadata || typeof line.metadata !== 'object' || Array.isArray(line.metadata)) return false;
  const metadata = line.metadata as Record<string, unknown>;
  if (!('diesel_amount' in metadata) || !('def_amount' in metadata) || !('reefer_amount' in metadata)) return false;
  const positive = (value: unknown) => typeof value === 'number' || typeof value === 'string' ? Number(value) > 0 : false;
  return positive(metadata.diesel_amount) || positive(metadata.reefer_amount) || positive(metadata.def_amount);
}

export function expectedFuelDeduction(pilot: ComparablePilotAmount, policy: Pick<FuelDeductionPolicy, 'responsibility' | 'discountTreatment' | 'companyRetentionBasisPoints'>) {
  if (policy.responsibility === 'COMPANY') return { expectedMinor: BigInt(0), retainedDiscountMinor: BigInt(0) };
  if (policy.discountTreatment === 'FULL_PASS_THROUGH') return { expectedMinor: pilot.amountMinor, retainedDiscountMinor: BigInt(0) };
  const savings = pilot.savingsMinor ?? (pilot.retailMinor === null ? null : pilot.retailMinor - pilot.amountMinor);
  if (savings === null || savings < BigInt(0)) return null;
  // QuickManage settles fractional cents by truncating the retained share. Its
  // displayed recipient discount is independently truncated, so deriving the
  // charge as retail minus that display value can differ by one cent.
  const retainedDiscountMinor = (savings * BigInt(policy.companyRetentionBasisPoints)) / BigInt(10000);
  return { expectedMinor: pilot.amountMinor + retainedDiscountMinor, retainedDiscountMinor };
}

export function expectedFuelDeductionForComponents(components: ComparablePilotAmount[], policy: Pick<FuelDeductionPolicy, 'responsibility' | 'discountTreatment' | 'companyRetentionBasisPoints'>) {
  const calculations = components.map(component => expectedFuelDeduction(component, policy));
  if (!calculations.every(value => value !== null)) return null;
  return {
    expectedMinor: calculations.reduce((sum, value) => sum + value!.expectedMinor, BigInt(0)),
    retainedDiscountMinor: calculations.reduce((sum, value) => sum + value!.retainedDiscountMinor, BigInt(0)),
  };
}

export const fuelMonetaryToleranceMinor = BigInt(5);

export function fuelAmountsWithinOwnerTolerance(expectedMinor: bigint, actualMinor: bigint) {
  const difference = actualMinor - expectedMinor;
  return (difference < BigInt(0) ? -difference : difference) <= fuelMonetaryToleranceMinor;
}

export function discrepancyStatus(expectedMinor: bigint, actualMinor: bigint, timing: boolean): FuelReconciliationStatus {
  if (timing) return 'TIMING_DIFFERENCE';
  if (actualMinor === BigInt(0) && expectedMinor > BigInt(0)) return 'MISSING_DEDUCTION';
  if (fuelAmountsWithinOwnerTolerance(expectedMinor, actualMinor)) return 'MATCHED';
  return actualMinor < expectedMinor ? 'UNDER_DEDUCTED' : 'OVER_DEDUCTED';
}

const day = (value: Date) => value.toISOString().slice(0, 10);
const nextDay = (value: string) => { const date = historyDate(value); date.setUTCDate(date.getUTCDate() + 1); return day(date); };
const pilotReferenceHash = (value: string) => createHash('sha256').update(value).digest('hex');
const absolute = (value: bigint) => value < BigInt(0) ? -value : value;
const validDate = (value: string | null) => {
  if (!value) return null;
  const candidate = value.slice(0, 10);
  try { historyDate(candidate); return candidate; } catch { return null; }
};

const fixedTwoMinor = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? '').padEnd(2, '0'));
};

export type FuelProductIdentity = {
  dieselFamilyQuantityHundredths: bigint;
  defAmountMinor: bigint;
};

export function corroboratesFuelProducts(pilot: FuelProductIdentity, statement: FuelProductIdentity) {
  return pilot.dieselFamilyQuantityHundredths === statement.dieselFamilyQuantityHundredths
    && pilot.defAmountMinor === statement.defAmountMinor;
}

const dieselFamilyProducts = new Set(['TRUCK_DIESEL', 'REEFER_FUEL']);
export function isDieselReeferClassificationDifference(pilotProducts: string[], statementProducts: string[]) {
  const pilot = new Set(pilotProducts);
  const statement = new Set(statementProducts);
  const sameDef = pilot.has('DEF') === statement.has('DEF');
  const pilotFuel = [...pilot].filter(product => dieselFamilyProducts.has(product));
  const statementFuel = [...statement].filter(product => dieselFamilyProducts.has(product));
  return sameDef && pilotFuel.length > 0 && statementFuel.length > 0
    && (pilot.has('TRUCK_DIESEL') !== statement.has('TRUCK_DIESEL') || pilot.has('REEFER_FUEL') !== statement.has('REEFER_FUEL'));
}

export const historicalFuelRoutingCutoff = '2026-09-22';
export function acceptsHistoricalCrossRecipientRouting(purchaseDate: string) {
  return purchaseDate < historicalFuelRoutingCutoff;
}

export function quickManageDateRelation(pilotDate: string, statementTimestamp: string | null) {
  const statementDate = validDate(statementTimestamp);
  if (!statementDate) return null;
  if (statementDate === pilotDate) return 'EXACT' as const;
  // Pilot's weekly XLS is authoritative as a date-only settlement source. For
  // Saturday purchases it labels the row with the following Sunday, while the
  // QuickManage fuel object retains the actual Saturday UTC timestamp. This is
  // a provider calendar convention, not a timezone conversion or a ±1-day
  // tolerance, so only the observed Sunday -> immediately preceding Saturday
  // boundary is eligible.
  if (!statementTimestamp?.includes('T')) return null;
  const pilot = historyDate(pilotDate);
  if (pilot.getUTCDay() !== 0) return null;
  const prior = new Date(pilot); prior.setUTCDate(prior.getUTCDate() - 1);
  return day(prior) === statementDate ? 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY' as const : null;
}

type PolicyCandidate = Pick<FuelDeductionPolicy, 'id' | 'companyId' | 'truckId' | 'providerRecipientId' | 'responsibility' | 'discountTreatment' | 'companyRetentionBasisPoints' | 'effectiveFrom' | 'effectiveTo'>;

export function resolveApplicableFuelPolicy(policies: PolicyCandidate[], companyId: string, truckId: string, recipientId: string, date: string) {
  const applicable = policies.filter(policy => policy.companyId === companyId && (!policy.truckId || policy.truckId === truckId) && (!policy.providerRecipientId || policy.providerRecipientId === recipientId) && day(policy.effectiveFrom) <= date && (!policy.effectiveTo || day(policy.effectiveTo) > date));
  if (!applicable.length) return { policy: null, ambiguous: false };
  const specificity = (policy: PolicyCandidate) => Number(!!policy.truckId) + Number(!!policy.providerRecipientId);
  const highest = Math.max(...applicable.map(specificity));
  const controlling = applicable.filter(policy => specificity(policy) === highest);
  return controlling.length === 1 ? { policy: controlling[0], ambiguous: false } : { policy: null, ambiguous: true };
}

type EvidenceLine = {
  id: string; evidenceIds: string[]; companyId: string; companyName: string; versionId: string;
  pid: string; statementNumber: string | null; recipientId: string; recipientName: string | null;
  recipientType: string; role: string | null; workStart: string; workEnd: string; truckId: string | null;
  truckUnit: string | null; amountMinor: bigint; sourceDate: string | null; reference: string | null;
  description: string | null; providerLineId: string | null;
  currentCompanyId: string | null; currentCompanyName: string | null;
  cardLastFour: string | null; locationNumber: string | null; city: string | null; state: string | null;
  sourceTimestamp: string | null; products: FuelProductIdentity; productClassifications: string[];
};

type FuelIdentity = { cardLastFour: string | null; locationNumber: string | null; city: string | null; state: string | null };
const identityToken = (value: string | null) => value?.trim().toUpperCase() || null;
export function corroboratesFuelIdentity(pilot: FuelIdentity, statement: FuelIdentity) {
  const comparisons = (['cardLastFour', 'locationNumber', 'city', 'state'] as const)
    .map(key => [identityToken(pilot[key]), identityToken(statement[key])] as const)
    .filter((values): values is readonly [string, string] => values[0] !== null && values[1] !== null);
  return comparisons.length >= 2 && comparisons.every(([left, right]) => left === right);
}

const compatibleCity = (left: string | null, right: string | null) => {
  const a = identityToken(left)?.replace(/[^A-Z0-9]/g, '') ?? null;
  const b = identityToken(right)?.replace(/[^A-Z0-9]/g, '') ?? null;
  if (!a || !b) return true;
  return a === b || (Math.min(a.length, b.length) >= 8 && (a.startsWith(b) || b.startsWith(a)));
};

export function corroboratesFuelIdentityStrict(pilot: FuelIdentity, statement: FuelIdentity) {
  const card = [identityToken(pilot.cardLastFour), identityToken(statement.cardLastFour)];
  const location = [identityToken(pilot.locationNumber), identityToken(statement.locationNumber)];
  if (!card[0] || !card[1] || card[0] !== card[1] || !location[0] || !location[1] || location[0] !== location[1]) return false;
  const states = [identityToken(pilot.state), identityToken(statement.state)];
  if (states[0] && states[1] && states[0] !== states[1]) return false;
  return compatibleCity(pilot.city, statement.city);
}

export type FuelReconciliationRow = {
  key: string; status: FuelReconciliationStatus; companyId: string | null; companyName: string | null;
  pid: string | null; purchaseDate: string | null; statementPeriod: string | null; truckId: string | null;
  truckUnit: string | null; recipientId: string | null; recipientName: string | null; responsibility: string | null;
  pilotEventId: string | null; pilotInvoiceId: string | null; pilotInvoiceNumber: string | null;
  pilotActualMinor: bigint; pilotRetailMinor: bigint | null; pilotSavingsMinor: bigint | null;
  expectedMinor: bigint | null; statementMinor: bigint; differenceMinor: bigint | null;
  observedAmountDeltaMinor: bigint | null;
  retainedDiscountMinor: bigint | null; policyId: string | null; policyLabel: string | null;
  historicalCompanyId: string | null; postedCompanyId: string | null; postedCompanyName: string | null;
  currentCompanyId: string | null; currentCompanyName: string | null;
  historyDiffersFromPosted: boolean; products: string[]; gallons: string; matchMethod: string | null;
  statementTruckUnit: string | null; statementRecipientId: string | null; statementRecipientName: string | null;
  statementProducts: string[]; productClassification: 'SAME' | 'DIESEL_REEFER_DIFFERENCE' | 'CONFLICT' | null;
  pilotEvidence: { eventId: string; invoiceId: string; invoiceNumber: string; transactionId: string | null } | null;
  statementEvidence: { lineIds: string[]; versionId: string; pid: string; statementNumber: string | null; description: string | null; reference: string | null } | null;
};

export type FuelReconciliationAmountBasis = 'DISCREPANCY' | 'PILOT' | 'STATEMENT' | 'EXPECTED';
export type FuelReconciliationControl = {
  key: FuelReconciliationStatus | 'HISTORICAL_POSTED_MISMATCH';
  label: string;
  count: number;
  filter: { status?: FuelReconciliationStatus; history?: 'posted-mismatch' };
  amounts: Array<{ amountMinor: bigint; amountBasis: FuelReconciliationAmountBasis; amountLabel: string }>;
};

const controlLabels: Record<FuelReconciliationStatus, string> = {
  MATCHED: 'Matched',
  UNDER_DEDUCTED: 'Under-deduction',
  OVER_DEDUCTED: 'Over-deduction',
  MISSING_DEDUCTION: 'Missing deduction',
  STATEMENT_ONLY: 'Statement-only within Pilot coverage',
  TIMING_DIFFERENCE: 'Timing difference',
  NO_PILOT_DATA_IMPORTED: 'No Pilot data imported',
  NEEDS_COMPANY_HISTORY: 'Needs Company history',
  NEEDS_TRUCK_MAPPING: 'Needs Truck mapping',
  NEEDS_RECIPIENT_MAPPING: 'Needs recipient mapping',
  NEEDS_RECIPIENT_REVIEW: 'Needs recipient routing review',
  PRODUCT_CLASSIFICATION_REVIEW: 'Needs fuel product review',
  NEEDS_POLICY: 'Needs policy',
  NEEDS_REVIEW: 'Needs review',
};

const sumRows = (rows: FuelReconciliationRow[], value: (row: FuelReconciliationRow) => bigint) => rows.reduce((sum, row) => sum + value(row), BigInt(0));
const controlAmount = (amountMinor: bigint, amountBasis: FuelReconciliationAmountBasis, amountLabel: string) => ({ amountMinor, amountBasis, amountLabel });
const affectedAmounts = (rows: FuelReconciliationRow[], fallbackLabel = 'affected') => {
  const pilotMinor = sumRows(rows, row => row.pilotActualMinor);
  const statementMinor = sumRows(rows, row => row.statementMinor);
  if (pilotMinor !== BigInt(0) && statementMinor !== BigInt(0)) return [controlAmount(pilotMinor, 'PILOT', 'Pilot affected'), controlAmount(statementMinor, 'STATEMENT', 'statement affected')];
  if (pilotMinor !== BigInt(0)) return [controlAmount(pilotMinor, 'PILOT', `Pilot ${fallbackLabel}`)];
  if (statementMinor !== BigInt(0)) return [controlAmount(statementMinor, 'STATEMENT', `statement ${fallbackLabel}`)];
  return [controlAmount(BigInt(0), 'PILOT', fallbackLabel)];
};

/** Server-owned count and money semantics for every reconciliation control card. */
export function buildFuelReconciliationControls(rows: FuelReconciliationRow[]): FuelReconciliationControl[] {
  const statusControl = (status: FuelReconciliationStatus): FuelReconciliationControl => {
    const matches = rows.filter(row => row.status === status);
    let amounts: FuelReconciliationControl['amounts'];
    if (status === 'UNDER_DEDUCTED') amounts = [controlAmount(sumRows(matches, row => absolute(row.differenceMinor ?? BigInt(0))), 'DISCREPANCY', 'short')];
    else if (status === 'OVER_DEDUCTED') amounts = [controlAmount(sumRows(matches, row => absolute(row.differenceMinor ?? BigInt(0))), 'DISCREPANCY', 'excess')];
    else if (status === 'MISSING_DEDUCTION') amounts = [controlAmount(sumRows(matches, row => absolute(row.differenceMinor ?? BigInt(0))), 'DISCREPANCY', 'potential missing')];
    else if (status === 'MATCHED') amounts = [controlAmount(sumRows(matches, row => row.expectedMinor ?? BigInt(0)), 'EXPECTED', 'reconciled')];
    else if (status === 'TIMING_DIFFERENCE') amounts = [controlAmount(sumRows(matches, row => row.expectedMinor ?? BigInt(0)), 'EXPECTED', 'timing amount')];
    else if (status === 'STATEMENT_ONLY') amounts = [controlAmount(sumRows(matches, row => row.statementMinor), 'STATEMENT', 'statement amount')];
    else if (status === 'NO_PILOT_DATA_IMPORTED') amounts = [controlAmount(sumRows(matches, row => row.statementMinor), 'STATEMENT', 'outside Pilot coverage')];
    else if (status === 'NEEDS_TRUCK_MAPPING') amounts = [controlAmount(sumRows(matches, row => row.statementMinor), 'STATEMENT', 'statement affected')];
    else if (['NEEDS_POLICY', 'NEEDS_COMPANY_HISTORY'].includes(status)) amounts = [controlAmount(sumRows(matches, row => row.pilotActualMinor), 'PILOT', 'Pilot affected')];
    else amounts = affectedAmounts(matches, status === 'NEEDS_REVIEW' ? 'under review' : 'affected');
    return { key: status, label: controlLabels[status], count: matches.length, filter: { status }, amounts };
  };
  const controls = reconciliationStatuses.map(statusControl);
  const historical = rows.filter(row => row.historyDiffersFromPosted);
  controls.push({
    key: 'HISTORICAL_POSTED_MISMATCH', label: 'Historical ≠ posted Company', count: historical.length,
    filter: { history: 'posted-mismatch' },
    amounts: [controlAmount(sumRows(historical, row => row.pilotActualMinor), 'PILOT', 'Pilot affected')],
  });
  return controls;
}

export type FuelReconciliationFilters = { page?: number; pageSize?: number; companyId?: string; pid?: string; date?: string; truck?: string; recipient?: string; responsibility?: string; status?: string; policy?: string; history?: string };

export type HistoricalTruckMappingEvidenceReference = {
  pilotEventId: string;
  statementVersionId: string;
  statementLineIds: string[];
};

export function fuelReconciliationRowMatches(row: FuelReconciliationRow, filters: FuelReconciliationFilters) {
  return (!filters.companyId || row.companyId === filters.companyId)
    && (!filters.pid || row.pid === filters.pid)
    && (!filters.date || row.purchaseDate === filters.date || !!row.statementPeriod && row.statementPeriod.slice(0, 10) <= filters.date && row.statementPeriod.slice(-10) >= filters.date)
    && (!filters.truck || row.truckUnit?.toLowerCase().includes(filters.truck.toLowerCase()))
    && (!filters.recipient || row.recipientName?.toLowerCase().includes(filters.recipient.toLowerCase()) || row.recipientId === filters.recipient)
    && (!filters.responsibility || row.responsibility === filters.responsibility)
    && (!filters.status || row.status === filters.status)
    && (!filters.history || filters.history === 'posted-mismatch' && row.historyDiffersFromPosted)
    && (!filters.policy || (filters.policy === 'known' ? !!row.policyId || row.responsibility === 'COMPANY' : row.status === 'NEEDS_POLICY'));
}

export type FuelPolicyEvidenceReference = {
  pilotEventId: string;
  purchaseDate: string;
  supportFrom: string;
  supportTo: string;
  statementVersionId: string;
  statementLineIds: string[];
};

type RevisionRange = { effectiveFrom: string; effectiveTo: string };

const policyState = (policy: Pick<FuelDeductionPolicy, 'id' | 'operatingGroupId' | 'companyId' | 'truckId' | 'providerRecipientId' | 'responsibility' | 'discountTreatment' | 'companyRetentionBasisPoints' | 'effectiveFrom' | 'effectiveTo' | 'sourceReference' | 'reason' | 'approvedByUserId' | 'approvedAt' | 'revision' | 'updatedAt'>, range?: RevisionRange, revision = policy.revision) => ({
  policyId: policy.id,
  operatingGroupId: policy.operatingGroupId,
  companyId: policy.companyId,
  truckId: policy.truckId,
  providerRecipientId: policy.providerRecipientId,
  responsibility: policy.responsibility,
  discountTreatment: policy.discountTreatment,
  companyRetentionBasisPoints: policy.companyRetentionBasisPoints,
  effectiveFrom: range?.effectiveFrom ?? day(policy.effectiveFrom),
  effectiveTo: range?.effectiveTo ?? (policy.effectiveTo ? day(policy.effectiveTo) : null),
  sourceReference: policy.sourceReference,
  reason: policy.reason,
  approvedByUserId: policy.approvedByUserId,
  approvedAt: policy.approvedAt.toISOString(),
  updatedAt: policy.updatedAt.toISOString(),
  revision,
});

function parseRevisionRange(input: Record<string, unknown>, policy: Pick<FuelDeductionPolicy, 'effectiveFrom' | 'effectiveTo'>) {
  const effectiveFrom = typeof input.effectiveFrom === 'string' ? input.effectiveFrom : '';
  const effectiveTo = typeof input.effectiveTo === 'string' ? input.effectiveTo : '';
  const from = historyDate(effectiveFrom), to = historyDate(effectiveTo);
  if (to <= from) throw new FinancialValidationError('Policy end must follow start.');
  const currentFrom = day(policy.effectiveFrom), currentTo = policy.effectiveTo ? day(policy.effectiveTo) : null;
  if (!currentTo) throw new FinancialValidationError('Open-ended policies cannot be range-extended.');
  if (effectiveFrom > currentFrom || effectiveTo < currentTo) throw new FinancialValidationError('A range revision may only extend the current evidence-bounded range.');
  if (effectiveFrom === currentFrom && effectiveTo === currentTo) throw new FinancialValidationError('The proposed range does not change the policy.');
  return { effectiveFrom, effectiveTo, from, to, currentFrom, currentTo };
}

const evidenceKey = (reference: FuelPolicyEvidenceReference) => `${reference.pilotEventId}:${reference.purchaseDate}:${reference.supportFrom}:${reference.supportTo}:${reference.statementVersionId}:${[...reference.statementLineIds].sort().join(',')}`;

const evidenceSupport = (row: Pick<FuelReconciliationRow, 'purchaseDate' | 'statementPeriod'>) => {
  const purchaseDate = row.purchaseDate!;
  const period = row.statementPeriod?.match(/^(\d{4}-\d{2}-\d{2})–(\d{4}-\d{2}-\d{2})$/);
  const periodFrom = period?.[1] ?? purchaseDate, periodTo = period?.[2] ? nextDay(period[2]) : nextDay(purchaseDate);
  return { supportFrom: periodFrom < purchaseDate ? periodFrom : purchaseDate, supportTo: periodTo > nextDay(purchaseDate) ? periodTo : nextDay(purchaseDate) };
};

export function validateFuelPolicyRevisionEvidence(range: { currentFrom: string; currentTo: string; effectiveFrom: string; effectiveTo: string }, support: Array<{ supportFrom: string; supportTo: string }>, unsupportedNewRows: number) {
  if (unsupportedNewRows) throw new FinancialConflictError('Observed statement evidence contradicts the unchanged policy formula.');
  if (!support.some(item => item.supportFrom < range.currentTo && item.supportTo > range.currentFrom)) throw new FinancialConflictError('Supporting evidence is disjoint from the current policy range; create a separate policy after review.');
  if (range.effectiveFrom < range.currentFrom && !support.some(item => item.supportFrom <= range.effectiveFrom && item.supportTo > range.effectiveFrom)) throw new FinancialConflictError('The proposed start is not bounded by exact corroborated evidence.');
  if (range.effectiveTo > range.currentTo && !support.some(item => item.supportFrom < range.effectiveTo && item.supportTo >= range.effectiveTo)) throw new FinancialConflictError('The proposed end is not bounded by exact corroborated evidence.');
}

export class FuelDeductionReconciliationService {
  private readonly history: TruckCompanyHistoryService;
  constructor(private readonly database: PrismaClient = prisma) { this.history = new TruckCompanyHistoryService(database); }

  async createHistoricalTruckMapping(input: Record<string, unknown>, context: FinancialAuthorization) {
    const providerTruckId = typeof input.providerTruckId === 'string' ? input.providerTruckId.trim() : '';
    const truckId = typeof input.truckId === 'string' ? input.truckId : '';
    const sourceReference = typeof input.sourceReference === 'string' ? input.sourceReference.trim() : '';
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(providerTruckId)
      || !truckId || sourceReference.length < 10 || sourceReference.length > 2000 || reason.length < 10 || reason.length > 2000
      || !Array.isArray(input.evidenceReferences) || input.evidenceReferences.length < 2 || input.evidenceReferences.length > 100) {
      throw new FinancialValidationError('A provider Truck UUID, canonical Truck, reason, source reference, and at least two evidence references are required.');
    }
    const references = input.evidenceReferences.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FinancialValidationError('Invalid mapping evidence reference.');
      const reference = value as Record<string, unknown>;
      if (typeof reference.pilotEventId !== 'string' || typeof reference.statementVersionId !== 'string'
        || !Array.isArray(reference.statementLineIds) || !reference.statementLineIds.length
        || !reference.statementLineIds.every(lineId => typeof lineId === 'string')) throw new FinancialValidationError('Invalid mapping evidence reference.');
      return { pilotEventId: reference.pilotEventId, statementVersionId: reference.statementVersionId, statementLineIds: [...new Set(reference.statementLineIds as string[])].sort() };
    }).sort((left, right) => `${left.pilotEventId}|${left.statementVersionId}|${left.statementLineIds.join(',')}`.localeCompare(`${right.pilotEventId}|${right.statementVersionId}|${right.statementLineIds.join(',')}`)) as HistoricalTruckMappingEvidenceReference[];
    if (new Set(references.map(reference => reference.pilotEventId)).size < 2) throw new FinancialValidationError('At least two distinct Pilot events must corroborate a historical Truck mapping.');
    if (new Set(references.map(reference => `${reference.statementVersionId}|${reference.statementLineIds.join(',')}`)).size < 2) throw new FinancialValidationError('At least two distinct QuickManage observations must corroborate a historical Truck mapping.');
    const referencedLines = references.flatMap(reference => reference.statementLineIds.map(lineId => `${reference.statementVersionId}|${lineId}`));
    if (new Set(referencedLines).size !== referencedLines.length) throw new FinancialValidationError('A QuickManage statement line cannot be reused as separate mapping evidence.');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(async tx => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`historical-truck:${context.operatingGroupId}:QUICKMANAGE:${providerTruckId}`}, 0))::text AS lock_result`;
          const actors = await tx.$queryRaw<Array<{ isActive: boolean }>>`SELECT "isActive" FROM "User" WHERE id=${context.userId} FOR UPDATE`;
          const groupMemberships = await tx.$queryRaw<Array<{ role: string }>>`SELECT role::text FROM "OperatingGroupMembership" WHERE "operatingGroupId"=${context.operatingGroupId} AND "userId"=${context.userId} FOR UPDATE`;
          const groupCompanies = await tx.$queryRaw<Array<{ companyId: string }>>`SELECT "companyId" FROM "OperatingGroupCompany" WHERE "operatingGroupId"=${context.operatingGroupId} FOR UPDATE`;
          const ownerMemberships = await tx.$queryRaw<Array<{ companyId: string }>>`SELECT "companyId" FROM "CompanyMembership" WHERE "userId"=${context.userId} AND role='OWNER'::"CompanyMembershipRole" FOR UPDATE`;
          if (!actors[0]?.isActive || groupMemberships[0]?.role !== 'OWNER') throw new FinancialNotFoundError();
          const groupCompanyIds = new Set(groupCompanies.map(company => company.companyId));
          const allowedCompanyIds = ownerMemberships.map(membership => membership.companyId).filter(companyId => groupCompanyIds.has(companyId));
          if (!allowedCompanyIds.includes(context.activeCompanyId)) throw new FinancialNotFoundError();
          const truck = await tx.truck.findFirst({
            where: { id: truckId, companyId: { in: allowedCompanyIds } },
            select: { id: true, unitNumber: true, companyId: true, vin: true, vinNormalized: true },
          });
          if (!truck) throw new FinancialNotFoundError();
          const archiveTrucks = await tx.archiveTruck.findMany({
            where: { providerTruckId, version: { sealed: true, statement: { company: { operatingGroupId: context.operatingGroupId, companyId: { in: allowedCompanyIds } } } } },
            select: { id: true, unit: true, vin: true, truckId: true, versionId: true, version: { select: { statement: { select: { acceptedProviderVersion: true } }, providerVersion: true } } },
          });
          const acceptedArchiveTrucks = archiveTrucks.filter(item => item.version.providerVersion === item.version.statement.acceptedProviderVersion);
          if (!acceptedArchiveTrucks.length || acceptedArchiveTrucks.some(item => item.truckId && item.truckId !== truck.id)) throw new FinancialConflictError('Provider Truck identity is absent or conflicts with an existing canonical mapping.');
          const providerUnits = new Set(acceptedArchiveTrucks.map(item => normalizeTruckUnitNumber(item.unit ?? '')).filter(Boolean));
          if (providerUnits.size !== 1 || !providerUnits.has(normalizeTruckUnitNumber(truck.unitNumber))) throw new FinancialConflictError('Provider Truck unit does not uniquely agree with the canonical Truck.');
          const providerVins = new Set(acceptedArchiveTrucks.map(item => item.vin ? normalizeVin(item.vin) : '').filter(Boolean));
          const canonicalVin = truck.vinNormalized ?? (truck.vin ? normalizeVin(truck.vin) : '');
          if (providerVins.size > 1 || providerVins.size === 1 && (!canonicalVin || !providerVins.has(canonicalVin))) throw new FinancialConflictError('Provider Truck VIN conflicts with the canonical Truck.');
          const normalizedUnit = normalizeTruckUnitNumber(truck.unitNumber);
          const competingTrucks = await tx.truck.findMany({ where: { id: { not: truck.id }, companyId: { in: [...groupCompanyIds] } }, select: { unitNumber: true, unitNumberNormalized: true } });
          if (competingTrucks.some(candidate => (candidate.unitNumberNormalized ?? normalizeTruckUnitNumber(candidate.unitNumber)) === normalizedUnit)) throw new FinancialConflictError('Another canonical Truck shares this provider unit in the Operating Group.');

          const existing = await tx.historicalTruckMapping.findUnique({ where: { operatingGroupId_provider_providerTruckId: { operatingGroupId: context.operatingGroupId, provider: 'QUICKMANAGE', providerTruckId } } });
          if (existing) {
            const existingEvidence = Array.isArray(existing.evidenceReferences) ? existing.evidenceReferences.map(value => {
              const reference = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
              return `${String(reference.pilotEventId)}|${String(reference.statementVersionId)}|${Array.isArray(reference.statementLineIds) ? reference.statementLineIds.map(String).sort().join(',') : ''}`;
            }).sort() : [];
            const requestedEvidence = references.map(reference => `${reference.pilotEventId}|${reference.statementVersionId}|${reference.statementLineIds.join(',')}`).sort();
            if (existing.truckId === truck.id && existing.sourceReference === sourceReference && existing.reason === reason
              && JSON.stringify(existingEvidence) === JSON.stringify(requestedEvidence)) return existing;
            throw new FinancialConflictError('Provider Truck identity already has a different canonical mapping decision.');
          }

          for (const reference of references) {
            const event = await tx.pilotFuelingEvent.findFirst({
              where: { id: reference.pilotEventId, truckId: truck.id, invoice: { operatingGroupId: context.operatingGroupId, status: 'POSTED' } },
              include: { productLines: true },
            });
            const version = await tx.archiveVersion.findFirst({
              where: { id: reference.statementVersionId, sealed: true, statement: { company: { operatingGroupId: context.operatingGroupId, companyId: { in: allowedCompanyIds } } }, trucks: { some: { providerTruckId } } },
              include: { statement: { select: { acceptedProviderVersion: true } }, trucks: { select: { providerTruckId: true, unit: true } }, lines: { where: { id: { in: reference.statementLineIds } } } },
            });
            if (!event || !version || version.providerVersion !== version.statement.acceptedProviderVersion || version.lines.length !== reference.statementLineIds.length) throw new FinancialConflictError('Mapping evidence is unavailable in posted Pilot or the accepted immutable statement version.');
            if (version.lines.some(line => !line.sourceUnit || normalizeTruckUnitNumber(line.sourceUnit) !== normalizedUnit)) throw new FinancialConflictError('Mapping evidence line does not belong to the provider Truck unit.');
            const providerIdentitiesForUnit = new Set(version.trucks.filter(candidate => normalizeTruckUnitNumber(candidate.unit ?? '') === normalizedUnit).map(candidate => candidate.providerTruckId).filter(Boolean));
            if (providerIdentitiesForUnit.size !== 1 || !providerIdentitiesForUnit.has(providerTruckId)) throw new FinancialConflictError('Mapping evidence line is ambiguous between provider Truck identities.');
            const pilotProducts: FuelProductIdentity = {
              dieselFamilyQuantityHundredths: event.productLines.filter(line => dieselFamilyProducts.has(line.productType)).reduce((sum, line) => sum + BigInt(Math.round(Number(line.quantity) * 100)), BigInt(0)),
              defAmountMinor: event.productLines.filter(line => line.productType === 'DEF').reduce((sum, line) => sum + (line.retailAmountMinor ?? line.amountMinor), BigInt(0)),
            };
            const statementProducts = version.lines.reduce<FuelProductIdentity>((sum, line) => {
              if (!classifyFuelDeductionLine(line)) throw new FinancialConflictError('Mapping evidence must reference structured fuel-deduction lines.');
              const metadata = line.metadata as Record<string, unknown>;
              const value = (key: string) => typeof metadata[key] === 'string' || typeof metadata[key] === 'number' ? String(metadata[key]) : null;
              const diesel = fixedTwoMinor(value('diesel_qty')), reefer = fixedTwoMinor(value('reefer_qty')), def = fixedTwoMinor(value('def_amount'));
              if (diesel === null || reefer === null || def === null) throw new FinancialConflictError('Mapping evidence lacks structured product identity.');
              const statementIdentity = { cardLastFour: value('card_number')?.slice(-4) ?? null, locationNumber: value('merchant'), city: value('city'), state: value('state') };
              const statementTimestamp = value('date') ?? line.sourceDate;
              if (!quickManageDateRelation(day(event.transactionDate), statementTimestamp)
                || !corroboratesFuelIdentityStrict({ cardLastFour: event.cardLastFour, locationNumber: event.locationNumber, city: event.city, state: event.state }, statementIdentity)) {
                throw new FinancialConflictError('Mapping evidence does not have exact date/card/location identity.');
              }
              return { dieselFamilyQuantityHundredths: sum.dieselFamilyQuantityHundredths + diesel + reefer, defAmountMinor: sum.defAmountMinor + def };
            }, { dieselFamilyQuantityHundredths: BigInt(0), defAmountMinor: BigInt(0) });
            if (!corroboratesFuelProducts(pilotProducts, statementProducts)) throw new FinancialConflictError('Mapping evidence product identity conflicts with Pilot.');
          }
          const mapping = await tx.historicalTruckMapping.create({ data: { operatingGroupId: context.operatingGroupId, provider: 'QUICKMANAGE', providerTruckId, truckId: truck.id, evidenceReferences: references, sourceReference, reason, createdByUserId: context.userId } });
          await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: truck.companyId, actorUserId: context.userId, action: 'HISTORICAL_TRUCK_MAPPING_CREATED', after: { mappingId: mapping.id, provider: mapping.provider, providerTruckId, truckId: truck.id }, metadata: { sourceReference, reason, evidenceReferences: references } } });
          return mapping;
        }, { isolationLevel: 'Serializable' });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (['P2002', 'P2034'].includes(code ?? '') && attempt < 2) continue;
        if (['P2002', 'P2034'].includes(code ?? '')) throw new FinancialConflictError('Historical Truck mapping could not be serialized safely.');
        throw error;
      }
    }
    throw new FinancialConflictError('Historical Truck mapping could not be serialized safely.');
  }

  async preview(context: FinancialAuthorization, filters: FuelReconciliationFilters = {}) {
    const page = Number(filters.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new FinancialValidationError('Invalid page.');
    const pageSize = Number(filters.pageSize ?? 50);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000) throw new FinancialValidationError('Invalid page size.');
    if (filters.status && !reconciliationStatuses.includes(filters.status as FuelReconciliationStatus)) throw new FinancialValidationError('Invalid reconciliation status.');
    if (filters.policy && !['known', 'missing'].includes(filters.policy)) throw new FinancialValidationError('Invalid policy filter.');
    if (filters.responsibility && !['COMPANY', 'RECIPIENT', 'DRIVER', 'CONTRACTOR'].includes(filters.responsibility)) throw new FinancialValidationError('Invalid responsibility filter.');
    if (filters.date) historyDate(filters.date);
    for (const value of [filters.companyId, filters.pid, filters.truck, filters.recipient]) if (value && value.length > 200) throw new FinancialValidationError('Filter too long.');
    const [events, versions, policies, companies, historicalMappings] = await Promise.all([
      this.database.pilotFuelingEvent.findMany({
        where: { invoice: { operatingGroupId: context.operatingGroupId, status: 'POSTED' } },
        include: {
          invoice: { select: { id: true, invoiceNumber: true } },
          truck: { select: { id: true, unitNumber: true, companyId: true, company: { select: { name: true } } } },
          transaction: { select: { id: true, companyId: true, company: { select: { name: true } } } },
          productLines: { select: { productType: true, quantity: true, amountMinor: true, retailAmountMinor: true, savingsMinor: true, discountMinor: true } },
        },
        orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
      }),
      this.database.archiveVersion.findMany({
        where: { sealed: true, statement: { company: { operatingGroupId: context.operatingGroupId, companyId: { in: context.companyIds } } } },
        include: {
          statement: { include: { company: { include: { company: { select: { name: true } } } } } },
          lines: { where: { kind: 'DEDUCTION' }, orderBy: [{ sourceArray: 'asc' }, { sourceOrder: 'asc' }] },
          trucks: { include: { truck: { select: { unitNumber: true, companyId: true, company: { select: { name: true } } } } } },
        },
        orderBy: [{ pid: 'asc' }, { id: 'asc' }],
      }),
      this.database.fuelDeductionPolicy.findMany({ where: { operatingGroupId: context.operatingGroupId, companyId: { in: context.companyIds } }, orderBy: [{ effectiveFrom: 'asc' }, { approvedAt: 'asc' }] }),
      this.database.company.findMany({ where: { id: { in: context.companyIds } }, select: { id: true, name: true } }),
      this.database.historicalTruckMapping.findMany({
        where: { operatingGroupId: context.operatingGroupId, provider: 'QUICKMANAGE' },
        include: { truck: { select: { id: true, unitNumber: true, companyId: true, company: { select: { name: true } } } } },
      }),
    ]);
    const companyNames = new Map(companies.map(company => [company.id, company.name]));
    const comparableEvents = events.map(event => ({ event, lines: event.productLines.filter(line => line.productType === 'TRUCK_DIESEL' || line.productType === 'REEFER_FUEL' || line.productType === 'DEF') }));
    const dated = comparableEvents.filter(item => item.lines.length);
    const coverageStart = dated.length ? day(dated[0].event.transactionDate) : null;
    const coverageEnd = dated.length ? day(dated.at(-1)!.event.transactionDate) : null;
    // Resolve every posted event so the historical-vs-posted control remains complete even
    // when an event contains only an excluded product such as reefer fuel.
    const historyRequests = events.filter(event => event.truckId).map(event => ({ key: event.id, truckId: event.truckId!, timestamp: day(event.transactionDate) }));
    const historyResults = historyRequests.length ? await this.history.resolveTruckOperatingCompaniesAt(historyRequests, context.userId) : [];
    const historyByEvent = new Map(historyResults.map(result => [result.key, result]));

    const acceptedVersions = versions.filter(version => version.providerVersion === version.statement.acceptedProviderVersion);
    const historicalMappingByProviderTruck = new Map(historicalMappings.map(mapping => [mapping.providerTruckId, mapping]));
    const resolvedTrucksByVersion = new Map<string, Array<(typeof acceptedVersions)[number]['trucks'][number]>>();
    for (const version of acceptedVersions) {
      const resolved = version.trucks.map(archiveTruck => {
        if (archiveTruck.truckId && archiveTruck.mappingStatus !== 'NEEDS_REVIEW') return archiveTruck;
        const mapping = archiveTruck.providerTruckId ? historicalMappingByProviderTruck.get(archiveTruck.providerTruckId) : null;
        return mapping ? { ...archiveTruck, truckId: mapping.truckId, mappingStatus: 'AUDITED_PROVIDER_IDENTITY', truck: mapping.truck } : archiveTruck;
      });
      const unique = new Map<string, (typeof resolved)[number]>();
      for (const truck of resolved) {
        const key = truck.truckId && truck.mappingStatus !== 'NEEDS_REVIEW' ? `canonical:${truck.truckId}` : `archive:${truck.id}`;
        const prior = unique.get(key);
        if (!prior || prior.mappingStatus === 'AUDITED_PROVIDER_IDENTITY' && truck.mappingStatus !== 'AUDITED_PROVIDER_IDENTITY') unique.set(key, truck);
      }
      resolvedTrucksByVersion.set(version.id, [...unique.values()]);
    }
    const evidence: EvidenceLine[] = [];
    for (const version of acceptedVersions) {
      const mapped = resolvedTrucksByVersion.get(version.id)!.filter(truck => truck.truckId && truck.mappingStatus !== 'NEEDS_REVIEW');
      for (const line of version.lines.filter(classifyFuelDeductionLine)) {
        const metadata = line.metadata as Record<string, unknown>;
        const metadataText = (key: string) => typeof metadata[key] === 'string' || typeof metadata[key] === 'number' ? String(metadata[key]) : null;
        const cardNumber = metadataText('card_number');
        const dieselQuantityHundredths = fixedTwoMinor(metadataText('diesel_qty'));
        const reeferQuantityHundredths = fixedTwoMinor(metadataText('reefer_qty'));
        const defAmountMinor = fixedTwoMinor(metadataText('def_amount'));
        const productClassifications = [
          Number(metadataText('diesel_amount') ?? 0) > 0 ? 'TRUCK_DIESEL' : null,
          Number(metadataText('reefer_amount') ?? 0) > 0 ? 'REEFER_FUEL' : null,
          Number(metadataText('def_amount') ?? 0) > 0 ? 'DEF' : null,
        ].filter((product): product is string => product !== null);
        const sourceUnit = line.sourceUnit?.trim().toUpperCase() ?? null;
        const candidates = mapped.filter(truck => !sourceUnit || truck.unit?.trim().toUpperCase() === sourceUnit);
        const truck = candidates.length === 1 ? candidates[0] : mapped.length === 1 ? mapped[0] : null;
        evidence.push({
          id: line.id, evidenceIds: [line.id], companyId: version.statement.company.companyId,
          companyName: version.statement.company.company.name, versionId: version.id, pid: version.pid,
          statementNumber: version.statementNumber, recipientId: version.recipientId, recipientName: version.recipientName,
          recipientType: version.recipientType, role: version.role, workStart: day(version.workStart), workEnd: day(version.workEnd),
          truckId: truck?.truckId ?? null, truckUnit: truck?.truck?.unitNumber ?? line.sourceUnit,
          amountMinor: absolute(line.amountMinor!), sourceDate: validDate(line.sourceDate), reference: line.reference,
          description: line.description, providerLineId: line.providerLineId,
          currentCompanyId: truck?.truck?.companyId && context.companyIds.includes(truck.truck.companyId) ? truck.truck.companyId : null,
          currentCompanyName: truck?.truck?.companyId && context.companyIds.includes(truck.truck.companyId) ? truck.truck.company?.name ?? null : null,
          cardLastFour: cardNumber?.slice(-4) ?? null, locationNumber: metadataText('merchant'), city: metadataText('city'), state: metadataText('state'),
          sourceTimestamp: metadataText('date') ?? line.sourceDate,
          products: {
            dieselFamilyQuantityHundredths: dieselQuantityHundredths === null || reeferQuantityHundredths === null ? BigInt(-1) : dieselQuantityHundredths + reeferQuantityHundredths,
            defAmountMinor: defAmountMinor ?? BigInt(-1),
          },
          productClassifications,
        });
      }
    }
    // Paired Driver/Contractor evidence for the same recovery remains one economic deduction with both line IDs retained.
    const deduplicated = new Map<string, EvidenceLine>();
    for (const line of evidence) {
      const identity = [line.companyId, line.truckId ?? line.truckUnit ?? '', line.reference ?? line.providerLineId ?? '', line.sourceDate ?? '', line.amountMinor.toString()].join('|');
      const prior = deduplicated.get(identity);
      if (!prior) deduplicated.set(identity, line);
      else {
        prior.evidenceIds.push(line.id);
        if (prior.recipientType !== 'CONTRACTOR' && line.recipientType === 'CONTRACTOR') deduplicated.set(identity, { ...line, evidenceIds: prior.evidenceIds });
      }
    }
    const statementLines = [...deduplicated.values()];
    const byTruckReference = new Map<string, EvidenceLine[]>();
    const byTruckDate = new Map<string, EvidenceLine[]>();
    const byTruckWeekendDate = new Map<string, EvidenceLine[]>();
    const byCompanyCandidateDate = new Map<string, EvidenceLine[]>();
    const byCandidateDate = new Map<string, EvidenceLine[]>();
    const versionsByTruck = new Map<string, typeof acceptedVersions>();
    const index = (target: Map<string, EvidenceLine[]>, key: string, line: EvidenceLine) => target.set(key, [...(target.get(key) ?? []), line]);
    for (const version of acceptedVersions) for (const truck of resolvedTrucksByVersion.get(version.id)!) if (truck.truckId) {
      const indexedVersions = versionsByTruck.get(truck.truckId) ?? [];
      if (!indexedVersions.some(indexed => indexed.id === version.id)) versionsByTruck.set(truck.truckId, [...indexedVersions, version]);
    }
    for (const line of statementLines) {
      if (line.truckId && line.reference) index(byTruckReference, `${line.truckId}|${pilotReferenceHash(line.reference)}`, line);
      if (line.truckId && line.sourceDate) index(byTruckDate, `${line.truckId}|${line.sourceDate}`, line);
      const timestampDate = validDate(line.sourceTimestamp);
      if (!timestampDate) continue;
      index(byCandidateDate, timestampDate, line);
      index(byCompanyCandidateDate, `${line.companyId}|${timestampDate}`, line);
      if (!line.sourceTimestamp?.includes('T')) continue;
      const timestamp = historyDate(timestampDate);
      if (timestamp.getUTCDay() !== 6) continue;
      timestamp.setUTCDate(timestamp.getUTCDate() + 1);
      const followingSunday = day(timestamp);
      if (line.truckId) index(byTruckWeekendDate, `${line.truckId}|${followingSunday}`, line);
      index(byCandidateDate, followingSunday, line);
      index(byCompanyCandidateDate, `${line.companyId}|${followingSunday}`, line);
    }
    const consumed = new Set<string>();
    const rows: FuelReconciliationRow[] = [];
    const statementEvidence = (matched: EvidenceLine[]) => matched.length ? {
      lineIds: matched.flatMap(line => line.evidenceIds), versionId: matched[0].versionId, pid: matched[0].pid,
      statementNumber: matched[0].statementNumber, description: matched.map(line => line.description).filter(Boolean).join(' + ') || null,
      reference: matched.map(line => line.reference).filter(Boolean).join(' + ') || null,
    } : null;
    const statementAudit = (matched: EvidenceLine[]) => ({
      statementTruckUnit: matched[0]?.truckUnit ?? null,
      statementRecipientId: matched[0]?.recipientId ?? null,
      statementRecipientName: matched[0]?.recipientName ?? null,
      statementProducts: [...new Set(matched.flatMap(line => line.productClassifications))],
    });
    const consume = (matched: EvidenceLine[]) => matched.forEach(line => consumed.add(line.id));
    for (const { event, lines } of dated) {
      const purchaseDate = day(event.transactionDate), history = historyByEvent.get(event.id);
      const pilotActualMinor = lines.reduce((sum, line) => sum + line.amountMinor, BigInt(0));
      const retailValues = lines.map(line => line.retailAmountMinor);
      const savingsValues = lines.map(line => line.savingsMinor ?? line.discountMinor);
      const pilotRetailMinor = retailValues.every(value => value !== null) ? retailValues.reduce<bigint>((sum, value) => sum + value!, BigInt(0)) : null;
      const pilotSavingsMinor = savingsValues.every(value => value !== null) ? savingsValues.reduce<bigint>((sum, value) => sum + value!, BigInt(0)) : null;
      const pilotProducts: FuelProductIdentity = {
        dieselFamilyQuantityHundredths: event.productLines.filter(line => line.productType === 'TRUCK_DIESEL' || line.productType === 'REEFER_FUEL').reduce((sum, line) => sum + BigInt(Math.round(Number(line.quantity) * 100)), BigInt(0)),
        defAmountMinor: event.productLines.filter(line => line.productType === 'DEF').reduce((sum, line) => sum + (line.retailAmountMinor ?? line.amountMinor), BigInt(0)),
      };
      const pilotProductClassifications = [...new Set(lines.map(line => line.productType))];
      const pilotIdentity = { cardLastFour: event.cardLastFour, locationNumber: event.locationNumber, city: event.city, state: event.state };
      const base = {
        key: `pilot:${event.id}`, companyId: history?.status === 'EXACT' ? history.companyId : null,
        companyName: history?.status === 'EXACT' ? companyNames.get(history.companyId) ?? null : null,
        pid: null, purchaseDate, statementPeriod: null, truckId: event.truckId, truckUnit: event.truck?.unitNumber ?? event.sourceUnitNumber,
        pilotEventId: event.id, pilotInvoiceId: event.invoice.id, pilotInvoiceNumber: event.invoice.invoiceNumber,
        pilotActualMinor, pilotRetailMinor, pilotSavingsMinor, postedCompanyId: event.transaction?.companyId ?? null,
        postedCompanyName: event.transaction?.company?.name ?? null, historicalCompanyId: history?.status === 'EXACT' ? history.companyId : null,
        currentCompanyId: event.truck?.companyId && context.companyIds.includes(event.truck.companyId) ? event.truck.companyId : null,
        currentCompanyName: event.truck?.companyId && context.companyIds.includes(event.truck.companyId) ? event.truck.company?.name ?? null : null,
        historyDiffersFromPosted: history?.status === 'EXACT' && !!event.transaction?.companyId && history.companyId !== event.transaction.companyId,
        products: pilotProductClassifications, gallons: lines.reduce((sum, line) => sum + Number(line.quantity), 0).toFixed(2),
        statementTruckUnit: null, statementRecipientId: null, statementRecipientName: null, statementProducts: [] as string[], productClassification: null,
        pilotEvidence: { eventId: event.id, invoiceId: event.invoice.id, invoiceNumber: event.invoice.invoiceNumber, transactionId: event.transaction?.id ?? null },
      };
      if (!event.truckId) { rows.push({ ...base, status: 'NEEDS_TRUCK_MAPPING', recipientId: null, recipientName: null, responsibility: null, expectedMinor: null, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: null, matchMethod: null, statementEvidence: null }); continue; }
      const assignments = (versionsByTruck.get(event.truckId) ?? []).filter(version => day(version.workStart) <= purchaseDate && day(version.workEnd) >= purchaseDate);
      const periodAssignment = (() => {
        const version = assignments.find(item => item.recipientType === 'CONTRACTOR') ?? (assignments.length === 1 ? assignments[0] : null);
        return version ? { recipientId: version.recipientId, recipientName: version.recipientName, recipientType: version.recipientType, role: version.role } : null;
      })();
      const referenceMatch = [...new Map([event.ticketHash, event.authorizationHash].filter(Boolean).flatMap(reference => (byTruckReference.get(`${event.truckId}|${reference}`) ?? []).map(line => [line.id, line] as const))).values()].filter(line => !consumed.has(line.id));
      const sameTruckDate = (byTruckDate.get(`${event.truckId}|${purchaseDate}`) ?? []).filter(line => !consumed.has(line.id));
      const dateIdentityCandidates = sameTruckDate.filter(line => corroboratesFuelIdentity(
        pilotIdentity,
        { cardLastFour: line.cardLastFour, locationNumber: line.locationNumber, city: line.city, state: line.state },
      ));
      const dateMatch = dateIdentityCandidates.length === 1 ? dateIdentityCandidates : [];
      const weekendMatch = (byTruckWeekendDate.get(`${event.truckId}|${purchaseDate}`) ?? []).filter(line => !consumed.has(line.id)
        && history?.status === 'EXACT' && line.companyId === history.companyId
        && (!periodAssignment || line.recipientId === periodAssignment.recipientId)
        && quickManageDateRelation(purchaseDate, line.sourceTimestamp) === 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY'
        && corroboratesFuelIdentityStrict(pilotIdentity, { cardLastFour: line.cardLastFour, locationNumber: line.locationNumber, city: line.city, state: line.state })
        && corroboratesFuelProducts(pilotProducts, line.products));
      const candidates = referenceMatch.length ? referenceMatch : dateMatch.length ? dateMatch : weekendMatch;
      const matched = candidates.length === 1 ? candidates[0] : null;
      const matchedEvidence = matched ? statementEvidence([matched]) : null;
      const unresolvedDateEvidence = !referenceMatch.length && !matched && (dateIdentityCandidates.length > 1 || weekendMatch.length > 1 || (sameTruckDate.length > 0 && !dateMatch.length));
      const matchMethod = matched ? (referenceMatch.length ? 'REFERENCE' : dateMatch.length ? 'TRUCK_DATE_CORROBORATED' : 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY') : unresolvedDateEvidence ? 'INSUFFICIENT_TRUCK_DATE_CORROBORATION' : null;
      if (!history || history.status !== 'EXACT') {
        rows.push({ ...base, ...statementAudit(matched ? [matched] : []), status: 'NEEDS_COMPANY_HISTORY', recipientId: matched?.recipientId ?? null, recipientName: matched?.recipientName ?? null, responsibility: null, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: null, policyLabel: null, pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence: matchedEvidence });
        if (matched) consume([matched]);
        continue;
      }
      if (unresolvedDateEvidence) {
        rows.push({ ...base, status: 'NEEDS_REVIEW', recipientId: null, recipientName: null, responsibility: null, expectedMinor: null, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: 'Truck/date candidates lack unique structured corroboration', matchMethod: 'INSUFFICIENT_TRUCK_DATE_CORROBORATION', statementEvidence: null });
        continue;
      }
      const assignment = periodAssignment ?? matched;
      if (!assignment) { rows.push({ ...base, status: 'NEEDS_RECIPIENT_MAPPING', recipientId: null, recipientName: null, responsibility: null, expectedMinor: null, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: null, matchMethod, statementEvidence: null }); continue; }
      const companyDriver = assignment.recipientType === 'DRIVER' && /company\s*driver/i.test(assignment.role ?? '');
      const policyResolution = companyDriver ? { policy: null, ambiguous: false } : resolveApplicableFuelPolicy(policies, history.companyId, event.truckId, assignment.recipientId, purchaseDate);
      if (policyResolution.ambiguous) {
        rows.push({ ...base, ...statementAudit(matched ? [matched] : []), status: 'NEEDS_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility: null, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: null, policyLabel: 'Ambiguous applicable policies', pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence: matchedEvidence });
        if (matched) consume([matched]);
        continue;
      }
      const policy = policyResolution.policy;
      const responsibility = companyDriver ? 'COMPANY' : policy?.responsibility ?? null;
      if (!companyDriver && !policy) { rows.push({ ...base, ...statementAudit(matched ? [matched] : []), status: 'NEEDS_POLICY', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: null, policyLabel: null, pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence: matchedEvidence }); if (matched) consume([matched]); continue; }
      const controllingPolicy = policy ?? { responsibility: 'COMPANY', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0 };
      const calculation = pilotProductClassifications.includes('REEFER_FUEL')
        ? expectedFuelDeductionForComponents(lines.map(line => ({ amountMinor: line.amountMinor, retailMinor: line.retailAmountMinor, savingsMinor: line.savingsMinor ?? line.discountMinor })), controllingPolicy)
        : expectedFuelDeduction({ amountMinor: pilotActualMinor, retailMinor: pilotRetailMinor, savingsMinor: pilotSavingsMinor }, controllingPolicy);
      if (!calculation) { rows.push({ ...base, ...statementAudit(matched ? [matched] : []), status: 'NEEDS_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: policy?.id ?? null, policyLabel: 'Discount evidence unavailable', pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence: matchedEvidence }); if (matched) consume([matched]); continue; }
      const policyLabel = companyDriver ? 'Company-driver fuel; no recipient recovery' : `${policy!.discountTreatment} · ${policy!.companyRetentionBasisPoints / 100}% retained`;
      const matchedProductDifference = !!matched && isDieselReeferClassificationDifference(pilotProductClassifications, matched.productClassifications);
      const matchedProductIdentityIsStrong = !!matched && (matchMethod === 'REFERENCE' || corroboratesFuelIdentityStrict(
        pilotIdentity,
        { cardLastFour: matched.cardLastFour, locationNumber: matched.locationNumber, city: matched.city, state: matched.state },
      ));
      if (matched && matchedProductDifference && matchedProductIdentityIsStrong && corroboratesFuelProducts(pilotProducts, matched.products) && fuelAmountsWithinOwnerTolerance(calculation.expectedMinor, matched.amountMinor)) {
        consume([matched]);
        rows.push({ ...base, ...statementAudit([matched]), productClassification: 'DIESEL_REEFER_DIFFERENCE', status: 'MATCHED', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor: matched.amountMinor, differenceMinor: matched.amountMinor - calculation.expectedMinor, observedAmountDeltaMinor: matched.amountMinor - pilotActualMinor, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: `${policyLabel} · Diesel/Reefer classification differs; recovery confirmed`, pid: matched.pid, statementPeriod: `${matched.workStart}–${matched.workEnd}`, matchMethod: 'DIESEL_REEFER_CLASSIFICATION_ACCEPTED', statementEvidence: matchedEvidence });
        continue;
      }
      if (matched && !corroboratesFuelProducts(pilotProducts, matched.products)) {
        consume([matched]);
        rows.push({ ...base, ...statementAudit([matched]), productClassification: 'CONFLICT', status: 'PRODUCT_CLASSIFICATION_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor: matched.amountMinor, differenceMinor: null, observedAmountDeltaMinor: matched.amountMinor - pilotActualMinor, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: `${policyLabel} · Pilot and QuickManage product composition differs`, pid: matched.pid, statementPeriod: `${matched.workStart}–${matched.workEnd}`, matchMethod: 'PRODUCT_CLASSIFICATION_CONFLICT', statementEvidence: matchedEvidence });
        continue;
      }
      if (!matched) {
        const exceptionCandidates = (byCompanyCandidateDate.get(`${history.companyId}|${purchaseDate}`) ?? []).filter(line => !consumed.has(line.id)
          && quickManageDateRelation(purchaseDate, line.sourceTimestamp)
          && corroboratesFuelIdentityStrict(pilotIdentity, { cardLastFour: line.cardLastFour, locationNumber: line.locationNumber, city: line.city, state: line.state }));
        const crossRecipientIdentity = exceptionCandidates.filter(line => corroboratesFuelProducts(pilotProducts, line.products)
          && (line.truckId !== event.truckId || line.recipientId !== assignment.recipientId));
        const crossRecipient = crossRecipientIdentity.length === 1 && fuelAmountsWithinOwnerTolerance(calculation.expectedMinor, crossRecipientIdentity[0].amountMinor) ? crossRecipientIdentity : [];
        if (crossRecipient.length === 1) {
          const review = crossRecipient[0]; consume([review]);
          const historical = acceptsHistoricalCrossRecipientRouting(purchaseDate);
          const crossProductDifference = isDieselReeferClassificationDifference(pilotProductClassifications, review.productClassifications);
          rows.push({ ...base, ...statementAudit([review]), productClassification: crossProductDifference ? 'DIESEL_REEFER_DIFFERENCE' : 'SAME', status: historical ? 'MATCHED' : 'NEEDS_RECIPIENT_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor: review.amountMinor, differenceMinor: historical ? review.amountMinor - calculation.expectedMinor : null, observedAmountDeltaMinor: review.amountMinor - pilotActualMinor, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: `${policyLabel} · statement routed to ${review.recipientName ?? review.recipientId} / Truck ${review.truckUnit ?? 'unresolved'}${historical ? ' · historical routing accepted' : ' · OWNER review required'}`, pid: review.pid, statementPeriod: `${review.workStart}–${review.workEnd}`, matchMethod: historical ? 'HISTORICAL_CROSS_RECIPIENT_RECOVERED' : 'CROSS_RECIPIENT_STRUCTURED_IDENTITY', statementEvidence: statementEvidence([review]) });
          continue;
        }
        const identityConflicts = (byCandidateDate.get(purchaseDate) ?? []).filter(line => !consumed.has(line.id)
          && line.companyId !== history.companyId
          && quickManageDateRelation(purchaseDate, line.sourceTimestamp)
          && corroboratesFuelIdentityStrict(pilotIdentity, { cardLastFour: line.cardLastFour, locationNumber: line.locationNumber, city: line.city, state: line.state })
          && corroboratesFuelProducts(pilotProducts, line.products)
          && fuelAmountsWithinOwnerTolerance(calculation.expectedMinor, line.amountMinor));
        if (identityConflicts.length === 1) {
          const review = identityConflicts[0]; consume([review]);
          rows.push({ ...base, ...statementAudit([review]), productClassification: isDieselReeferClassificationDifference(pilotProductClassifications, review.productClassifications) ? 'DIESEL_REEFER_DIFFERENCE' : 'SAME', status: 'NEEDS_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor: review.amountMinor, differenceMinor: null, observedAmountDeltaMinor: review.amountMinor - pilotActualMinor, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: `${policyLabel} · exact recovery evidence is assigned to ${review.companyName} / Truck ${review.truckUnit ?? 'unresolved'}; Company and Truck identity require OWNER review`, pid: review.pid, statementPeriod: `${review.workStart}–${review.workEnd}`, matchMethod: 'CROSS_COMPANY_IDENTITY_REVIEW', statementEvidence: statementEvidence([review]) });
          continue;
        }
        if (identityConflicts.length > 1) {
          rows.push({ ...base, status: 'NEEDS_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: 'Multiple cross-Company recoveries share the structured fuel identity', matchMethod: 'AMBIGUOUS_STRUCTURED_IDENTITY', statementEvidence: null });
          continue;
        }
        const productCandidates = exceptionCandidates.filter(line => line.truckId === event.truckId && line.recipientId === assignment.recipientId);
        const candidateProductGroups = new Map<string, EvidenceLine[]>();
        for (const line of productCandidates) {
          const key = [line.versionId, line.sourceTimestamp, line.cardLastFour, line.locationNumber].join('|');
          candidateProductGroups.set(key, [...(candidateProductGroups.get(key) ?? []), line]);
        }
        const groupProducts = (group: EvidenceLine[]) => ({
          dieselFamilyQuantityHundredths: group.reduce((sum, line) => sum + line.products.dieselFamilyQuantityHundredths, BigInt(0)),
          defAmountMinor: group.reduce((sum, line) => sum + line.products.defAmountMinor, BigInt(0)),
        });
        const acceptedProductGroups = [...candidateProductGroups.values()].filter(group => {
          const statementProducts = [...new Set(group.flatMap(line => line.productClassifications))];
          const statementMinor = group.reduce((sum, line) => sum + line.amountMinor, BigInt(0));
          return corroboratesFuelProducts(pilotProducts, groupProducts(group))
            && isDieselReeferClassificationDifference(pilotProductClassifications, statementProducts)
            && fuelAmountsWithinOwnerTolerance(calculation.expectedMinor, statementMinor);
        });
        if (acceptedProductGroups.length === 1 && candidateProductGroups.size === 1) {
          const accepted = acceptedProductGroups[0];
          const statementMinor = accepted.reduce((sum, line) => sum + line.amountMinor, BigInt(0)); consume(accepted);
          rows.push({ ...base, ...statementAudit(accepted), productClassification: 'DIESEL_REEFER_DIFFERENCE', status: 'MATCHED', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor, differenceMinor: statementMinor - calculation.expectedMinor, observedAmountDeltaMinor: statementMinor - pilotActualMinor, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: `${policyLabel} · Diesel/Reefer classification differs; recovery confirmed`, pid: accepted[0].pid, statementPeriod: `${accepted[0].workStart}–${accepted[0].workEnd}`, matchMethod: 'DIESEL_REEFER_CLASSIFICATION_ACCEPTED', statementEvidence: statementEvidence(accepted) });
          continue;
        }
        const productGroups = new Map([...candidateProductGroups].filter(([, group]) => !corroboratesFuelProducts(pilotProducts, groupProducts(group))));
        // Multiple same-day statement candidates were already an explicit review state.
        // Preserve that behavior unless the immutable provider timestamp shows the audited
        // Sunday/Saturday boundary. A single incompatible line is also reviewable (the
        // known reefer-as-diesel shape); broader exact-day split inference stays closed.
        const reviewableProductGroups = [...productGroups.values()].filter(group => group.length === 1 || group.every(line => quickManageDateRelation(purchaseDate, line.sourceTimestamp) === 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY'));
        if (reviewableProductGroups.length === 1 && productGroups.size === 1) {
          const review = reviewableProductGroups[0];
          const statementMinor = review.reduce((sum, line) => sum + line.amountMinor, BigInt(0)); consume(review);
          rows.push({ ...base, ...statementAudit(review), productClassification: 'CONFLICT', status: 'PRODUCT_CLASSIFICATION_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor, differenceMinor: null, observedAmountDeltaMinor: statementMinor - pilotActualMinor, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: `${policyLabel} · Pilot and QuickManage product composition differs`, pid: review[0].pid, statementPeriod: `${review[0].workStart}–${review[0].workEnd}`, matchMethod: 'PRODUCT_CLASSIFICATION_CONFLICT', statementEvidence: statementEvidence(review) });
          continue;
        }
        if (crossRecipient.length > 1 || productGroups.size > 1 || unresolvedDateEvidence) {
          rows.push({ ...base, status: 'NEEDS_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: 'Multiple or incomplete structured fuel candidates require review', matchMethod: 'AMBIGUOUS_STRUCTURED_IDENTITY', statementEvidence: null });
          continue;
        }
      }
      const statementMinor = matched?.amountMinor ?? BigInt(0);
      const timingDate = matchMethod === 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY' ? matched?.sourceDate ?? purchaseDate : purchaseDate;
      const timing = !!matched && !(matched.workStart <= timingDate && matched.workEnd >= timingDate);
      if (matched) consume([matched]);
      rows.push({ ...base, ...statementAudit(matched ? [matched] : []), productClassification: matchedProductDifference ? 'DIESEL_REEFER_DIFFERENCE' : matched ? 'SAME' : null, status: discrepancyStatus(calculation.expectedMinor, statementMinor, timing), recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor, differenceMinor: statementMinor - calculation.expectedMinor, observedAmountDeltaMinor: matched ? statementMinor - pilotActualMinor : null, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel, pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence: matchedEvidence });
    }
    for (const line of statementLines.filter(line => !consumed.has(line.id))) {
      const outside = !coverageStart || !coverageEnd || line.workEnd < coverageStart || line.workStart > coverageEnd;
      rows.push({
        key: `statement:${line.id}`, status: outside ? 'NO_PILOT_DATA_IMPORTED' : !line.truckId ? 'NEEDS_TRUCK_MAPPING' : !line.recipientId ? 'NEEDS_RECIPIENT_MAPPING' : 'STATEMENT_ONLY',
        companyId: line.companyId, companyName: line.companyName, pid: line.pid, purchaseDate: line.sourceDate,
        statementPeriod: `${line.workStart}–${line.workEnd}`, truckId: line.truckId, truckUnit: line.truckUnit,
        recipientId: line.recipientId, recipientName: line.recipientName, responsibility: line.recipientType,
        pilotEventId: null, pilotInvoiceId: null, pilotInvoiceNumber: null, pilotActualMinor: BigInt(0), pilotRetailMinor: null, pilotSavingsMinor: null,
        expectedMinor: null, statementMinor: line.amountMinor, differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: null,
        historicalCompanyId: null, postedCompanyId: null, postedCompanyName: null, historyDiffersFromPosted: false,
        currentCompanyId: line.currentCompanyId, currentCompanyName: line.currentCompanyName,
        products: [], gallons: '0.00', matchMethod: null, pilotEvidence: null,
        statementTruckUnit: line.truckUnit, statementRecipientId: line.recipientId, statementRecipientName: line.recipientName,
        statementProducts: line.productClassifications, productClassification: null,
        statementEvidence: { lineIds: line.evidenceIds, versionId: line.versionId, pid: line.pid, statementNumber: line.statementNumber, description: line.description, reference: line.reference },
      });
    }
    // Reefer fuel participates in reconciliation under the OWNER's Diesel/Reefer
    // equivalence rule. Keep the legacy summary field for API compatibility; zero
    // proves that no supported reefer amount was excluded.
    const reeferMinor = BigInt(0);
    const providerCreditMinor = events.length ? await this.database.pilotInvoiceAdjustment.aggregate({ where: { invoice: { operatingGroupId: context.operatingGroupId, status: 'POSTED' } }, _sum: { signedAmountMinor: true } }).then(result => result._sum.signedAmountMinor ?? BigInt(0)) : BigInt(0);
    const filtered = rows.filter(row => fuelReconciliationRowMatches(row, filters));
    const start = (page - 1) * pageSize;
    const totals = (items: FuelReconciliationRow[]) => ({ count: items.length, pilotActualMinor: items.reduce((sum, row) => sum + row.pilotActualMinor, BigInt(0)), expectedMinor: items.reduce((sum, row) => sum + (row.expectedMinor ?? BigInt(0)), BigInt(0)), statementMinor: items.reduce((sum, row) => sum + row.statementMinor, BigInt(0)), differenceMinor: items.reduce((sum, row) => sum + (row.differenceMinor ?? BigInt(0)), BigInt(0)) });
    const byStatus = Object.fromEntries(reconciliationStatuses.map(status => [status, totals(rows.filter(row => row.status === status))]));
    const byCompany = [...new Set(rows.map(row => row.companyId).filter(Boolean))].map(companyId => {
      const companyRows = rows.filter(row => row.companyId === companyId);
      return { companyId, companyName: companyNames.get(companyId!) ?? companyRows[0]?.companyName ?? 'Unknown', ...totals(companyRows), withinCoverageStatementMinor: companyRows.filter(row => row.status !== 'NO_PILOT_DATA_IMPORTED').reduce((sum, row) => sum + row.statementMinor, BigInt(0)), outsideCoverageStatementMinor: companyRows.filter(row => row.status === 'NO_PILOT_DATA_IMPORTED').reduce((sum, row) => sum + row.statementMinor, BigInt(0)), unknownPolicyPilotMinor: companyRows.filter(row => row.status === 'NEEDS_POLICY').reduce((sum, row) => sum + row.pilotActualMinor, BigInt(0)) };
    });
    const allTotals = totals(rows);
    const outsideCoverageStatementMinor = rows.filter(row => row.status === 'NO_PILOT_DATA_IMPORTED').reduce((sum, row) => sum + row.statementMinor, BigInt(0));
    const acceptedDeductionLines = acceptedVersions.flatMap(version => version.lines).filter(line => line.included !== false && line.amountMinor !== null);
    const rawStatementDeductionMinor = acceptedDeductionLines.reduce((sum, line) => sum + absolute(line.amountMinor!), BigInt(0));
    const rawFuelStatementLines = acceptedDeductionLines.filter(line => line.sourceArray === 'fuel_transactions');
    const rawFuelStatementMinor = rawFuelStatementLines.reduce((sum, line) => sum + absolute(line.amountMinor!), BigInt(0));
    const unsupportedFuelStatementLines = rawFuelStatementLines.filter(line => !classifyFuelDeductionLine(line));
    const unsupportedFuelStatementMinor = unsupportedFuelStatementLines.reduce((sum, line) => sum + absolute(line.amountMinor!), BigInt(0));
    const historicalPostedDifferences = events.filter(event => {
      const history = historyByEvent.get(event.id);
      return history?.status === 'EXACT' && !!event.transaction?.companyId && history.companyId !== event.transaction.companyId;
    }).length;
    return { coverage: { start: coverageStart, end: coverageEnd }, summary: { ...allTotals, statementMinor: allTotals.statementMinor - outsideCoverageStatementMinor, comparableStatementMinor: allTotals.statementMinor - outsideCoverageStatementMinor, outsideCoverageStatementMinor, rawStatementDeductionMinor, rawFuelStatementMinor, unsupportedFuelStatementCount: unsupportedFuelStatementLines.length, unsupportedFuelStatementMinor, comparablePilotMinor: dated.reduce((sum, item) => sum + item.lines.reduce((part, line) => part + line.amountMinor, BigInt(0)), BigInt(0)), reeferExcludedMinor: reeferMinor, providerCreditExcludedMinor: providerCreditMinor, historicalPostedDifferences }, controls: buildFuelReconciliationControls(rows), byStatus, byCompany, rows: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize };
  }

  async policies(context: FinancialAuthorization) {
    return this.database.fuelDeductionPolicy.findMany({ where: { operatingGroupId: context.operatingGroupId, companyId: { in: context.companyIds } }, include: { company: { select: { name: true } }, truck: { select: { unitNumber: true } }, approvedBy: { select: { displayName: true } }, revisions: { include: { actor: { select: { displayName: true } } }, orderBy: [{ revision: 'desc' }] } }, orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }] });
  }

  async previewPolicyRevision(policyId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    const policy = await this.database.fuelDeductionPolicy.findFirst({ where: { id: policyId, operatingGroupId: context.operatingGroupId, companyId: { in: context.companyIds } } });
    if (!policy) throw new FinancialNotFoundError();
    const range = parseRevisionRange(input, policy);
    const result = await this.preview(context, { companyId: policy.companyId, pageSize: 10000 });
    const scoped = result.rows.filter(row => row.pilotEventId && row.purchaseDate && row.companyId === policy.companyId
      && (!policy.truckId || row.truckId === policy.truckId)
      && (!policy.providerRecipientId || row.recipientId === policy.providerRecipientId));
    const proposed = scoped.filter(row => row.purchaseDate! >= range.effectiveFrom && row.purchaseDate! < range.effectiveTo);
    const current = scoped.filter(row => row.purchaseDate! >= range.currentFrom && row.purchaseDate! < range.currentTo);
    const newlyCovered = proposed.filter(row => row.purchaseDate! < range.currentFrom || row.purchaseDate! >= range.currentTo);
    const reeferEventIds = proposed.filter(row => row.products.includes('REEFER_FUEL')).map(row => row.pilotEventId!);
    const reeferEvents = reeferEventIds.length ? await this.database.pilotFuelingEvent.findMany({
      where: { id: { in: reeferEventIds }, invoice: { operatingGroupId: context.operatingGroupId, status: 'POSTED' } },
      select: { id: true, productLines: { where: { productType: { in: ['TRUCK_DIESEL', 'REEFER_FUEL', 'DEF'] } }, select: { amountMinor: true, retailAmountMinor: true, savingsMinor: true, discountMinor: true } } },
    }) : [];
    const reeferComponents = new Map(reeferEvents.map(event => [event.id, event.productLines.map(line => ({ amountMinor: line.amountMinor, retailMinor: line.retailAmountMinor, savingsMinor: line.savingsMinor ?? line.discountMinor }))]));
    const clean = proposed.filter(row => {
      if (!row.statementEvidence || !row.pilotEventId || !row.purchaseDate) return false;
      const components = reeferComponents.get(row.pilotEventId);
      const calculated = components
        ? expectedFuelDeductionForComponents(components, policy)
        : expectedFuelDeduction({ amountMinor: row.pilotActualMinor, retailMinor: row.pilotRetailMinor, savingsMinor: row.pilotSavingsMinor }, policy);
      return calculated !== null && fuelAmountsWithinOwnerTolerance(calculated.expectedMinor, row.statementMinor);
    });
    const cleanIds = new Set(clean.map(row => row.pilotEventId));
    const contradictions = newlyCovered.filter(row => row.statementEvidence && !cleanIds.has(row.pilotEventId!));
    validateFuelPolicyRevisionEvidence(range, clean.map(evidenceSupport), contradictions.length);
    const evidenceReferences = clean.map(row => ({
      pilotEventId: row.pilotEventId!, purchaseDate: row.purchaseDate!, ...evidenceSupport(row), statementVersionId: row.statementEvidence!.versionId,
      statementLineIds: [...row.statementEvidence!.lineIds].sort(),
    })).sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right)));
    return {
      policyId: policy.id, expectedRevision: policy.revision,
      current: { effectiveFrom: range.currentFrom, effectiveTo: range.currentTo, coveredRows: current.length, pilotMinor: current.reduce((sum, row) => sum + row.pilotActualMinor, BigInt(0)) },
      proposed: { effectiveFrom: range.effectiveFrom, effectiveTo: range.effectiveTo, coveredRows: proposed.length, pilotMinor: proposed.reduce((sum, row) => sum + row.pilotActualMinor, BigInt(0)) },
      newlyCovered: { rows: newlyCovered.length, pilotMinor: newlyCovered.reduce((sum, row) => sum + row.pilotActualMinor, BigInt(0)), dates: [...new Set(newlyCovered.map(row => row.purchaseDate!))].sort() },
      evidenceReferences,
    };
  }

  async revisePolicy(policyId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    const expectedRevision = Number(input.expectedRevision);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new FinancialValidationError('Expected policy revision is required.');
    if (reason.length < 10 || reason.length > 2000) throw new FinancialValidationError('A meaningful revision reason is required.');
    if (!Array.isArray(input.evidenceReferences) || !input.evidenceReferences.length) throw new FinancialValidationError('Supporting evidence references are required.');
    const preview = await this.previewPolicyRevision(policyId, input, context);
    const supplied = input.evidenceReferences.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FinancialValidationError('Invalid supporting evidence reference.');
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.pilotEventId !== 'string' || typeof candidate.purchaseDate !== 'string' || typeof candidate.supportFrom !== 'string' || typeof candidate.supportTo !== 'string' || typeof candidate.statementVersionId !== 'string' || !Array.isArray(candidate.statementLineIds) || !candidate.statementLineIds.length || !candidate.statementLineIds.every(id => typeof id === 'string')) throw new FinancialValidationError('Invalid supporting evidence reference.');
      historyDate(candidate.purchaseDate); historyDate(candidate.supportFrom); historyDate(candidate.supportTo);
      return { pilotEventId: candidate.pilotEventId, purchaseDate: candidate.purchaseDate, supportFrom: candidate.supportFrom, supportTo: candidate.supportTo, statementVersionId: candidate.statementVersionId, statementLineIds: [...candidate.statementLineIds].sort() } as FuelPolicyEvidenceReference;
    }).sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right)));
    if (supplied.map(evidenceKey).join('|') !== preview.evidenceReferences.map(evidenceKey).join('|')) throw new FinancialConflictError('Supporting evidence changed; run the revision preview again.');
    try {
      return await this.database.$transaction(async tx => {
        const policy = await tx.fuelDeductionPolicy.findFirst({ where: { id: policyId, operatingGroupId: context.operatingGroupId, companyId: { in: context.companyIds } } });
        if (!policy) throw new FinancialNotFoundError();
        const actor = await tx.user.findFirst({ where: { id: context.userId, isActive: true, memberships: { some: { companyId: policy.companyId, role: { in: ['OWNER', 'ADMIN'] } } } }, select: { id: true } });
        if (!actor) throw new FinancialNotFoundError();
        if (policy.revision !== expectedRevision || preview.expectedRevision !== expectedRevision) throw new FinancialConflictError('This policy was revised by another user. Refresh and preview again.');
        const range = parseRevisionRange(input, policy);
        const pilotIds = [...new Set(supplied.map(reference => reference.pilotEventId))];
        const versionIds = [...new Set(supplied.map(reference => reference.statementVersionId))];
        const [pilotCount, versions] = await Promise.all([
          tx.pilotFuelingEvent.count({ where: { id: { in: pilotIds }, invoice: { operatingGroupId: policy.operatingGroupId, status: 'POSTED' } } }),
          tx.archiveVersion.findMany({ where: { id: { in: versionIds }, sealed: true, statement: { company: { operatingGroupId: policy.operatingGroupId, companyId: policy.companyId } } }, select: { id: true, lines: { select: { id: true } } } }),
        ]);
        const linesByVersion = new Map(versions.map(version => [version.id, new Set(version.lines.map(line => line.id))]));
        if (pilotCount !== pilotIds.length || versions.length !== versionIds.length || supplied.some(reference => reference.statementLineIds.some(lineId => !linesByVersion.get(reference.statementVersionId)?.has(lineId)))) throw new FinancialConflictError('Supporting evidence is no longer available in the immutable source record.');
        const overlap = await tx.fuelDeductionPolicy.findFirst({ where: {
          id: { not: policy.id }, operatingGroupId: policy.operatingGroupId, companyId: policy.companyId,
          truckId: policy.truckId, providerRecipientId: policy.providerRecipientId,
          effectiveFrom: { lt: range.to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: range.from } }],
        }, select: { id: true } });
        if (overlap) throw new FinancialConflictError('The revised range overlaps another policy at the same scope.');
        const before = policyState(policy);
        const nextRevision = policy.revision + 1;
        const updated = await tx.fuelDeductionPolicy.updateMany({ where: { id: policy.id, revision: expectedRevision }, data: { effectiveFrom: range.from, effectiveTo: range.to, revision: nextRevision } });
        if (updated.count !== 1) throw new FinancialConflictError('This policy was revised by another user. Refresh and preview again.');
        const active = await tx.fuelDeductionPolicy.findUniqueOrThrow({ where: { id: policy.id } });
        const after = policyState(active, { effectiveFrom: range.effectiveFrom, effectiveTo: range.effectiveTo }, nextRevision);
        const history = await tx.fuelDeductionPolicyRevision.create({ data: { policyId: policy.id, revision: nextRevision, before, after, reason, evidenceReferences: supplied, actorUserId: context.userId } });
        await tx.financialAuditEvent.create({ data: { operatingGroupId: policy.operatingGroupId, companyId: policy.companyId, actorUserId: context.userId, action: 'FUEL_DEDUCTION_POLICY_REVISED', before, after, metadata: { policyRevisionId: history.id, reason, evidenceReferences: supplied } } });
        return tx.fuelDeductionPolicy.findUniqueOrThrow({ where: { id: policy.id }, include: { revisions: { include: { actor: { select: { displayName: true } } }, orderBy: { revision: 'desc' } } } });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof FinancialConflictError || error instanceof FinancialNotFoundError || error instanceof FinancialValidationError) throw error;
      const code = (error as { code?: string; meta?: { code?: string } }).code ?? (error as { meta?: { code?: string } }).meta?.code;
      if (code === 'P2034' || code === '23P01') throw new FinancialConflictError('The policy changed or overlaps another policy; refresh and preview again.');
      throw error;
    }
  }

  async createPolicy(input: Record<string, unknown>, context: FinancialAuthorization) {
    const companyId = typeof input.companyId === 'string' ? input.companyId : '';
    const truckId = typeof input.truckId === 'string' && input.truckId ? input.truckId : null;
    const providerRecipientId = typeof input.providerRecipientId === 'string' && input.providerRecipientId ? input.providerRecipientId : null;
    const responsibility = input.responsibility === 'COMPANY' ? 'COMPANY' : input.responsibility === 'RECIPIENT' ? 'RECIPIENT' : null;
    const discountTreatment = input.discountTreatment === 'FULL_PASS_THROUGH' ? 'FULL_PASS_THROUGH' : input.discountTreatment === 'COMPANY_RETENTION' ? 'COMPANY_RETENTION' : null;
    const retention = Number(input.companyRetentionBasisPoints);
    const effectiveFrom = typeof input.effectiveFrom === 'string' ? input.effectiveFrom : '';
    const effectiveTo = typeof input.effectiveTo === 'string' && input.effectiveTo ? input.effectiveTo : null;
    const sourceReference = typeof input.sourceReference === 'string' ? input.sourceReference.trim() : '';
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!context.companyIds.includes(companyId) || !responsibility || !discountTreatment || !Number.isInteger(retention) || retention < 0 || retention > 10000 || !sourceReference || sourceReference.length > 2000 || !reason || reason.length > 2000) throw new FinancialValidationError('Valid policy scope, rule, evidence reference, and reason are required.');
    const from = historyDate(effectiveFrom), to = effectiveTo ? historyDate(effectiveTo) : null;
    if (to && to <= from) throw new FinancialValidationError('Policy end must follow start.');
    if (discountTreatment === 'FULL_PASS_THROUGH' && retention !== 0) throw new FinancialValidationError('Full pass-through cannot retain a discount share.');
    return this.database.$transaction(async tx => {
      const actor = await tx.user.findFirst({ where: { id: context.userId, isActive: true, memberships: { some: { companyId, role: { in: ['OWNER', 'ADMIN'] } } } }, select: { id: true } });
      if (!actor) throw new FinancialNotFoundError();
      if (truckId) {
        const truck = await tx.truck.findFirst({ where: { id: truckId, OR: [{ companyId }, { operatingAffiliations: { some: { companyId, supersededAt: null } } }] }, select: { id: true } });
        if (!truck) throw new FinancialNotFoundError();
      }
      const policy = await tx.fuelDeductionPolicy.create({ data: { operatingGroupId: context.operatingGroupId, companyId, truckId, providerRecipientId, responsibility, discountTreatment, companyRetentionBasisPoints: retention, effectiveFrom: from, effectiveTo: to, sourceReference, reason, approvedByUserId: context.userId } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId, actorUserId: context.userId, action: 'FUEL_DEDUCTION_POLICY_CREATED', after: { policyId: policy.id, truckId, providerRecipientId, responsibility, discountTreatment, companyRetentionBasisPoints: retention, effectiveFrom, effectiveTo }, metadata: { sourceReference, reason } } });
      return policy;
    });
  }
}

export const fuelDeductionReconciliation = new FuelDeductionReconciliationService();
