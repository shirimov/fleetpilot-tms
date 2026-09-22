import { createHash } from 'node:crypto';
import type { FuelDeductionPolicy, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { historyDate, TruckCompanyHistoryService } from '@/lib/fleet/truck-company-history';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';

export const reconciliationStatuses = [
  'MATCHED', 'UNDER_DEDUCTED', 'OVER_DEDUCTED', 'MISSING_DEDUCTION', 'STATEMENT_ONLY',
  'TIMING_DIFFERENCE', 'NO_PILOT_DATA_IMPORTED', 'NEEDS_COMPANY_HISTORY',
  'NEEDS_TRUCK_MAPPING', 'NEEDS_RECIPIENT_MAPPING', 'NEEDS_POLICY', 'NEEDS_REVIEW',
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
  return !positive(metadata.reefer_amount) && (positive(metadata.diesel_amount) || positive(metadata.def_amount));
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

export function discrepancyStatus(expectedMinor: bigint, actualMinor: bigint, timing: boolean): FuelReconciliationStatus {
  if (timing) return 'TIMING_DIFFERENCE';
  if (actualMinor === expectedMinor) return 'MATCHED';
  if (actualMinor === BigInt(0) && expectedMinor > BigInt(0)) return 'MISSING_DEDUCTION';
  return actualMinor < expectedMinor ? 'UNDER_DEDUCTED' : 'OVER_DEDUCTED';
}

const day = (value: Date) => value.toISOString().slice(0, 10);
const pilotReferenceHash = (value: string) => createHash('sha256').update(value).digest('hex');
const absolute = (value: bigint) => value < BigInt(0) ? -value : value;
const validDate = (value: string | null) => {
  if (!value) return null;
  const candidate = value.slice(0, 10);
  try { historyDate(candidate); return candidate; } catch { return null; }
};

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
};

type FuelIdentity = { cardLastFour: string | null; locationNumber: string | null; city: string | null; state: string | null };
const identityToken = (value: string | null) => value?.trim().toUpperCase() || null;
export function corroboratesFuelIdentity(pilot: FuelIdentity, statement: FuelIdentity) {
  const comparisons = (['cardLastFour', 'locationNumber', 'city', 'state'] as const)
    .map(key => [identityToken(pilot[key]), identityToken(statement[key])] as const)
    .filter((values): values is readonly [string, string] => values[0] !== null && values[1] !== null);
  return comparisons.length >= 2 && comparisons.every(([left, right]) => left === right);
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
  pilotEvidence: { eventId: string; invoiceId: string; invoiceNumber: string; transactionId: string | null } | null;
  statementEvidence: { lineIds: string[]; versionId: string; pid: string; statementNumber: string | null; description: string | null; reference: string | null } | null;
};

type Filters = { page?: number; pageSize?: number; companyId?: string; pid?: string; date?: string; truck?: string; recipient?: string; responsibility?: string; status?: string; policy?: string };

export class FuelDeductionReconciliationService {
  private readonly history: TruckCompanyHistoryService;
  constructor(private readonly database: PrismaClient = prisma) { this.history = new TruckCompanyHistoryService(database); }

  async preview(context: FinancialAuthorization, filters: Filters = {}) {
    const page = Number(filters.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new FinancialValidationError('Invalid page.');
    const pageSize = Number(filters.pageSize ?? 50);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000) throw new FinancialValidationError('Invalid page size.');
    if (filters.status && !reconciliationStatuses.includes(filters.status as FuelReconciliationStatus)) throw new FinancialValidationError('Invalid reconciliation status.');
    if (filters.policy && !['known', 'missing'].includes(filters.policy)) throw new FinancialValidationError('Invalid policy filter.');
    if (filters.responsibility && !['COMPANY', 'RECIPIENT', 'DRIVER', 'CONTRACTOR'].includes(filters.responsibility)) throw new FinancialValidationError('Invalid responsibility filter.');
    if (filters.date) historyDate(filters.date);
    for (const value of [filters.companyId, filters.pid, filters.truck, filters.recipient]) if (value && value.length > 200) throw new FinancialValidationError('Filter too long.');
    const [events, versions, policies, companies] = await Promise.all([
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
    ]);
    const companyNames = new Map(companies.map(company => [company.id, company.name]));
    const comparableEvents = events.map(event => ({ event, lines: event.productLines.filter(line => line.productType === 'TRUCK_DIESEL' || line.productType === 'DEF') }));
    const dated = comparableEvents.filter(item => item.lines.length);
    const coverageStart = dated.length ? day(dated[0].event.transactionDate) : null;
    const coverageEnd = dated.length ? day(dated.at(-1)!.event.transactionDate) : null;
    // Resolve every posted event so the historical-vs-posted control remains complete even
    // when an event contains only an excluded product such as reefer fuel.
    const historyRequests = events.filter(event => event.truckId).map(event => ({ key: event.id, truckId: event.truckId!, timestamp: day(event.transactionDate) }));
    const historyResults = historyRequests.length ? await this.history.resolveTruckOperatingCompaniesAt(historyRequests, context.userId) : [];
    const historyByEvent = new Map(historyResults.map(result => [result.key, result]));

    const acceptedVersions = versions.filter(version => version.providerVersion === version.statement.acceptedProviderVersion);
    const evidence: EvidenceLine[] = [];
    for (const version of acceptedVersions) {
      const mapped = version.trucks.filter(truck => truck.truckId && truck.mappingStatus !== 'NEEDS_REVIEW');
      for (const line of version.lines.filter(classifyFuelDeductionLine)) {
        const metadata = line.metadata as Record<string, unknown>;
        const metadataText = (key: string) => typeof metadata[key] === 'string' || typeof metadata[key] === 'number' ? String(metadata[key]) : null;
        const cardNumber = metadataText('card_number');
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
    const consumed = new Set<string>();
    const rows: FuelReconciliationRow[] = [];
    for (const { event, lines } of dated) {
      const purchaseDate = day(event.transactionDate), history = historyByEvent.get(event.id);
      const pilotActualMinor = lines.reduce((sum, line) => sum + line.amountMinor, BigInt(0));
      const retailValues = lines.map(line => line.retailAmountMinor);
      const savingsValues = lines.map(line => line.savingsMinor ?? line.discountMinor);
      const pilotRetailMinor = retailValues.every(value => value !== null) ? retailValues.reduce<bigint>((sum, value) => sum + value!, BigInt(0)) : null;
      const pilotSavingsMinor = savingsValues.every(value => value !== null) ? savingsValues.reduce<bigint>((sum, value) => sum + value!, BigInt(0)) : null;
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
        products: [...new Set(lines.map(line => line.productType))], gallons: lines.reduce((sum, line) => sum + Number(line.quantity), 0).toFixed(2),
        pilotEvidence: { eventId: event.id, invoiceId: event.invoice.id, invoiceNumber: event.invoice.invoiceNumber, transactionId: event.transaction?.id ?? null },
      };
      if (!event.truckId) { rows.push({ ...base, status: 'NEEDS_TRUCK_MAPPING', recipientId: null, recipientName: null, responsibility: null, expectedMinor: null, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: null, matchMethod: null, statementEvidence: null }); continue; }
      const referenceMatch = statementLines.filter(line => !consumed.has(line.id) && line.truckId === event.truckId && line.reference && [event.ticketHash, event.authorizationHash].includes(pilotReferenceHash(line.reference)));
      const sameTruckDate = statementLines.filter(line => !consumed.has(line.id) && line.truckId === event.truckId && line.sourceDate === purchaseDate);
      const dateMatch = sameTruckDate.filter(line => corroboratesFuelIdentity(
        { cardLastFour: event.cardLastFour, locationNumber: event.locationNumber, city: event.city, state: event.state },
        { cardLastFour: line.cardLastFour, locationNumber: line.locationNumber, city: line.city, state: line.state },
      ));
      const candidates = referenceMatch.length ? referenceMatch : dateMatch;
      const matched = candidates.length === 1 ? candidates[0] : null;
      const statementEvidence = matched ? { lineIds: matched.evidenceIds, versionId: matched.versionId, pid: matched.pid, statementNumber: matched.statementNumber, description: matched.description, reference: matched.reference } : null;
      const unresolvedDateEvidence = !referenceMatch.length && sameTruckDate.length > 0 && dateMatch.length !== 1;
      const matchMethod = matched ? (referenceMatch.length ? 'REFERENCE' : 'TRUCK_DATE_CORROBORATED') : unresolvedDateEvidence ? 'INSUFFICIENT_TRUCK_DATE_CORROBORATION' : null;
      if (!history || history.status !== 'EXACT') {
        rows.push({ ...base, status: 'NEEDS_COMPANY_HISTORY', recipientId: matched?.recipientId ?? null, recipientName: matched?.recipientName ?? null, responsibility: null, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: null, policyLabel: null, pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence });
        if (matched) consumed.add(matched.id);
        continue;
      }
      if (unresolvedDateEvidence) {
        rows.push({ ...base, status: 'NEEDS_REVIEW', recipientId: null, recipientName: null, responsibility: null, expectedMinor: null, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: 'Truck/date candidates lack unique structured corroboration', matchMethod, statementEvidence: null });
        continue;
      }
      const assignments = acceptedVersions.filter(version => version.trucks.some(truck => truck.truckId === event.truckId) && day(version.workStart) <= purchaseDate && day(version.workEnd) >= purchaseDate);
      const assignment = matched ?? (() => {
        const version = assignments.find(item => item.recipientType === 'CONTRACTOR') ?? (assignments.length === 1 ? assignments[0] : null);
        return version ? { recipientId: version.recipientId, recipientName: version.recipientName, recipientType: version.recipientType, role: version.role } : null;
      })();
      if (!assignment) { rows.push({ ...base, status: 'NEEDS_RECIPIENT_MAPPING', recipientId: null, recipientName: null, responsibility: null, expectedMinor: null, statementMinor: BigInt(0), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: null, matchMethod, statementEvidence: null }); continue; }
      const companyDriver = assignment.recipientType === 'DRIVER' && /company\s*driver/i.test(assignment.role ?? '');
      const policyResolution = companyDriver ? { policy: null, ambiguous: false } : resolveApplicableFuelPolicy(policies, history.companyId, event.truckId, assignment.recipientId, purchaseDate);
      if (policyResolution.ambiguous) {
        rows.push({ ...base, status: 'NEEDS_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility: null, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: null, policyLabel: 'Ambiguous applicable policies', pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence });
        if (matched) consumed.add(matched.id);
        continue;
      }
      const policy = policyResolution.policy;
      const responsibility = companyDriver ? 'COMPANY' : policy?.responsibility ?? null;
      if (!companyDriver && !policy) { rows.push({ ...base, status: 'NEEDS_POLICY', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: null, policyLabel: null, pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence }); if (matched) consumed.add(matched.id); continue; }
      const calculation = expectedFuelDeduction({ amountMinor: pilotActualMinor, retailMinor: pilotRetailMinor, savingsMinor: pilotSavingsMinor }, policy ?? { responsibility: 'COMPANY', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0 });
      if (!calculation) { rows.push({ ...base, status: 'NEEDS_REVIEW', recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: null, statementMinor: matched?.amountMinor ?? BigInt(0), differenceMinor: null, observedAmountDeltaMinor: matched ? matched.amountMinor - pilotActualMinor : null, retainedDiscountMinor: null, policyId: policy?.id ?? null, policyLabel: 'Discount evidence unavailable', pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence }); if (matched) consumed.add(matched.id); continue; }
      const statementMinor = matched?.amountMinor ?? BigInt(0), timing = !!matched && !(matched.workStart <= purchaseDate && matched.workEnd >= purchaseDate);
      if (matched) consumed.add(matched.id);
      rows.push({ ...base, status: discrepancyStatus(calculation.expectedMinor, statementMinor, timing), recipientId: assignment.recipientId, recipientName: assignment.recipientName, responsibility, expectedMinor: calculation.expectedMinor, statementMinor, differenceMinor: statementMinor - calculation.expectedMinor, observedAmountDeltaMinor: matched ? statementMinor - pilotActualMinor : null, retainedDiscountMinor: calculation.retainedDiscountMinor, policyId: policy?.id ?? null, policyLabel: companyDriver ? 'Company-driver fuel; no recipient recovery' : `${policy!.discountTreatment} · ${policy!.companyRetentionBasisPoints / 100}% retained`, pid: matched?.pid ?? null, statementPeriod: matched ? `${matched.workStart}–${matched.workEnd}` : null, matchMethod, statementEvidence });
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
        statementEvidence: { lineIds: line.evidenceIds, versionId: line.versionId, pid: line.pid, statementNumber: line.statementNumber, description: line.description, reference: line.reference },
      });
    }
    const reeferMinor = events.flatMap(event => event.productLines).filter(line => line.productType === 'REEFER_FUEL').reduce((sum, line) => sum + line.amountMinor, BigInt(0));
    const providerCreditMinor = events.length ? await this.database.pilotInvoiceAdjustment.aggregate({ where: { invoice: { operatingGroupId: context.operatingGroupId, status: 'POSTED' } }, _sum: { signedAmountMinor: true } }).then(result => result._sum.signedAmountMinor ?? BigInt(0)) : BigInt(0);
    const filtered = rows.filter(row => (!filters.companyId || row.companyId === filters.companyId) && (!filters.pid || row.pid === filters.pid) && (!filters.date || row.purchaseDate === filters.date || !!row.statementPeriod && row.statementPeriod.slice(0, 10) <= filters.date && row.statementPeriod.slice(-10) >= filters.date) && (!filters.truck || row.truckUnit?.toLowerCase().includes(filters.truck.toLowerCase())) && (!filters.recipient || row.recipientName?.toLowerCase().includes(filters.recipient.toLowerCase()) || row.recipientId === filters.recipient) && (!filters.responsibility || row.responsibility === filters.responsibility) && (!filters.status || row.status === filters.status) && (!filters.policy || (filters.policy === 'known' ? !!row.policyId || row.responsibility === 'COMPANY' : row.status === 'NEEDS_POLICY')));
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
    return { coverage: { start: coverageStart, end: coverageEnd }, summary: { ...allTotals, statementMinor: allTotals.statementMinor - outsideCoverageStatementMinor, comparableStatementMinor: allTotals.statementMinor - outsideCoverageStatementMinor, outsideCoverageStatementMinor, rawStatementDeductionMinor, rawFuelStatementMinor, unsupportedFuelStatementCount: unsupportedFuelStatementLines.length, unsupportedFuelStatementMinor, comparablePilotMinor: dated.reduce((sum, item) => sum + item.lines.reduce((part, line) => part + line.amountMinor, BigInt(0)), BigInt(0)), reeferExcludedMinor: reeferMinor, providerCreditExcludedMinor: providerCreditMinor, historicalPostedDifferences }, byStatus, byCompany, rows: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize };
  }

  async policies(context: FinancialAuthorization) {
    return this.database.fuelDeductionPolicy.findMany({ where: { operatingGroupId: context.operatingGroupId, companyId: { in: context.companyIds } }, include: { company: { select: { name: true } }, truck: { select: { unitNumber: true } }, approvedBy: { select: { displayName: true } } }, orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }] });
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
