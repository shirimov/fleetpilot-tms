import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { FleetResourceNotFoundError } from './fleet-authorization';
import { normalizeVin } from './truck-import-service';
import { normalizeTruckUnitNumber } from './truck-normalization';

export class TruckHistoryError extends Error {}
export type CompanyPeriod = { companyId: string; effectiveFrom: string; effectiveTo: string | null };
export type HistoryResolution = { status: 'EXACT'; companyId: string } | { status: 'UNKNOWN' | 'AMBIGUOUS' | 'SPLIT_PERIOD' };

// Calendar labels only. No local timezone conversion or invented time-of-day precision.
export function historyDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TruckHistoryError('Use a calendar date (YYYY-MM-DD).');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new TruckHistoryError('Invalid calendar date.');
  return date;
}
const day = (date: Date) => date.toISOString().slice(0, 10);

export function resolveCompanyRange(periods: CompanyPeriod[], from: string, toExclusive: string): HistoryResolution {
  if (historyDate(from) >= historyDate(toExclusive)) throw new TruckHistoryError('Range end must follow start.');
  const selected = periods.filter(p => p.effectiveFrom < toExclusive && (!p.effectiveTo || p.effectiveTo > from)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 1; i < selected.length; i++) {
    if (!selected[i - 1].effectiveTo || selected[i - 1].effectiveTo! > selected[i].effectiveFrom) return { status: 'AMBIGUOUS' };
  }
  let cursor = from;
  const companies = new Set<string>();
  for (const p of selected) {
    if (p.effectiveFrom > cursor) return { status: 'UNKNOWN' };
    companies.add(p.companyId);
    cursor = p.effectiveTo && p.effectiveTo < toExclusive ? p.effectiveTo : toExclusive;
  }
  if (cursor < toExclusive) return { status: 'UNKNOWN' };
  return companies.size === 1 ? { status: 'EXACT', companyId: [...companies][0] } : { status: 'SPLIT_PERIOD' };
}

function validatePeriods(periods: CompanyPeriod[]) {
  if (!Array.isArray(periods) || !periods.length || periods.length > 200) throw new TruckHistoryError('Supply 1–200 confirmed periods.');
  const sorted = [...periods].sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
  let open = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (!p.companyId || typeof p.companyId !== 'string') throw new TruckHistoryError('Company is required.');
    historyDate(p.effectiveFrom);
    if (p.effectiveTo !== null && historyDate(p.effectiveTo) <= historyDate(p.effectiveFrom)) throw new TruckHistoryError('Period end must follow start.');
    if (p.effectiveTo === null) open++;
    if (i && (!sorted[i - 1].effectiveTo || sorted[i - 1].effectiveTo! > p.effectiveFrom)) throw new TruckHistoryError('Operating periods cannot overlap.');
  }
  if (open > 1) throw new TruckHistoryError('At most one open period is allowed.');
  if (sorted.at(-1)!.effectiveFrom > day(new Date())) throw new TruckHistoryError('Future movements and future history starts are not supported.');
  return sorted;
}

export type HistoryChange = {
  action: 'CONFIRM' | 'MOVE' | 'CORRECT'; expectedRevisionId: string | null;
  source: 'MANUAL_CONFIRMATION' | 'PROVIDER_HISTORY' | 'QUICKMANAGE_STATEMENT'; sourceReference: string; reason: string;
  periods?: CompanyPeriod[]; destinationCompanyId?: string; effectiveDate?: string;
};

export class TruckCompanyHistoryService {
  constructor(private readonly database: PrismaClient = prisma) {}

  private async companies(tx: Prisma.TransactionClient, actorId: string) {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isActive: true } });
    if (!actor?.isActive) throw new AuthorizationDeniedError();
    const memberships = await tx.companyMembership.findMany({ where: { userId: actorId, role: { in: ['OWNER', 'ADMIN'] } }, select: { companyId: true } });
    return memberships.map(m => m.companyId);
  }

  async history(truckId: string, actorId: string) {
    return this.database.$transaction(async tx => {
      const allowed = await this.companies(tx, actorId);
      const truck = await tx.truck.findFirst({ where: { id: truckId, OR: [{ companyId: { in: allowed } }, { operatingAffiliations: { some: { companyId: { in: allowed }, supersededAt: null } } }] }, select: { id: true, unitNumber: true, companyId: true } });
      if (!truck) throw new FleetResourceNotFoundError();
      const currentVisible = allowed.includes(truck.companyId);
      const periods = await tx.truckCompanyAffiliation.findMany({ where: { truckId, companyId: { in: allowed }, supersededAt: null }, include: { company: { select: { name: true } }, revision: true }, orderBy: { effectiveFrom: 'asc' } });
      const managed = await this.companies(tx, actorId);
      const allCompanies = await tx.truckCompanyAffiliation.findMany({ where: { truckId, supersededAt: null }, select: { companyId: true } });
      const canManage = managed.includes(truck.companyId) && allCompanies.every(p => managed.includes(p.companyId));
      const latest = canManage ? await tx.truckCompanyHistoryRevision.findFirst({ where: { truckId, nextRevision: { is: null } }, select: { id: true } }) : null;
      return { truckId, unitNumber: currentVisible ? truck.unitNumber : null, currentCompanyId: currentVisible ? truck.companyId : null, canManage, revisionId: latest?.id ?? null,
        periods: periods.map(p => ({ id: p.id, companyId: p.companyId, companyName: p.company.name, effectiveFrom: day(p.effectiveFrom), effectiveTo: p.effectiveTo ? day(p.effectiveTo) : null, status: 'CONFIRMED', source: p.revision.source, sourceReference: canManage ? p.revision.sourceReference : null, reason: canManage ? p.revision.reason : null })),
      };
    });
  }

  // Membership scope is applied before resolving; hidden periods produce UNKNOWN, never leak a Company.
  async resolveRange(truckId: string, from: string, toExclusive: string, actorId: string): Promise<HistoryResolution> {
    const history = await this.history(truckId, actorId);
    return resolveCompanyRange(history.periods, from, toExclusive);
  }

  async resolveTruckOperatingCompanyAt(truckId: string, date: string, actorId: string): Promise<HistoryResolution> {
    const end = historyDate(date); end.setUTCDate(end.getUTCDate() + 1);
    return this.resolveRange(truckId, date, day(end), actorId);
  }

  // Read-only future archive adapter: physical VIN and confirmed period, not current Company.
  async resolveStatementTruck(vin: string, companyId: string, from: string, toExclusive: string, actorId: string) {
    const allowed = await this.database.$transaction(tx => this.companies(tx, actorId));
    if (!allowed.includes(companyId)) throw new AuthorizationDeniedError();
    const normalized = normalizeVin(vin);
    if (!normalized) return { status: 'UNKNOWN' as const };
    const candidates = await this.database.$queryRaw<{ id: string }[]>`SELECT id FROM "Truck" WHERE "vinNormalized" = ${normalized} OR upper(regexp_replace(vin, '[[:space:]-]+', '', 'g')) = ${normalized}`;
    if (candidates.length > 1) return { status: 'AMBIGUOUS' as const };
    const truck = candidates[0];
    if (!truck) return { status: 'UNKNOWN' as const };
    const rows = await this.database.truckCompanyAffiliation.findMany({ where: { truckId: truck.id, supersededAt: null, companyId: { in: allowed } } });
    const resolution = resolveCompanyRange(rows.map(p => ({ companyId: p.companyId, effectiveFrom: day(p.effectiveFrom), effectiveTo: p.effectiveTo ? day(p.effectiveTo) : null })), from, toExclusive);
    if (resolution.status !== 'EXACT') return resolution;
    return resolution.companyId === companyId ? { status: 'EXACT' as const, truckId: truck.id, companyId } : { status: 'CONFLICT' as const };
  }

  async change(truckId: string, input: HistoryChange, actorId: string) {
    if (!['CONFIRM', 'MOVE', 'CORRECT'].includes(input.action) || !['MANUAL_CONFIRMATION', 'PROVIDER_HISTORY', 'QUICKMANAGE_STATEMENT'].includes(input.source)) throw new TruckHistoryError('Unsupported history action/source.');
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 || typeof input.sourceReference !== 'string' || !input.sourceReference.trim() || input.sourceReference.length > 2000) throw new TruckHistoryError('A reason and evidence reference are required (maximum 2000 characters each).');
    return this.database.$transaction(async tx => {
      // Lock the physical Truck before reading its current Company or timeline. All competing moves serialize.
      await tx.$queryRaw`SELECT id FROM "Truck" WHERE id = ${truckId} FOR UPDATE`;
      const truck = await tx.truck.findUnique({ where: { id: truckId } });
      const allowed = await this.companies(tx, actorId);
      if (!truck || !allowed.includes(truck.companyId)) throw new AuthorizationDeniedError();
      const existing = await tx.truckCompanyAffiliation.findMany({ where: { truckId, supersededAt: null }, orderBy: { effectiveFrom: 'asc' } });
      if (existing.some(p => !allowed.includes(p.companyId))) throw new AuthorizationDeniedError();
      const previous = await tx.truckCompanyHistoryRevision.findFirst({ where: { truckId, nextRevision: { is: null } } });
      if ((previous?.id ?? null) !== input.expectedRevisionId) throw new TruckHistoryError('History changed. Reload before submitting.');
      if (input.action === 'CONFIRM' && previous) throw new TruckHistoryError('Use a reviewed correction for existing history.');
      if (input.action === 'CORRECT' && !previous) throw new TruckHistoryError('There is no confirmed history to correct.');
      let periods = input.periods;
      if (input.action === 'MOVE') {
        const open = existing.find(p => p.effectiveTo === null);
        if (!input.effectiveDate || !input.destinationCompanyId || input.destinationCompanyId === truck.companyId) throw new TruckHistoryError('A different destination Company and effective date are required.');
        if (open && historyDate(input.effectiveDate) <= open.effectiveFrom) throw new TruckHistoryError('Move must follow the current period start. Use correction for an incorrect boundary.');
        periods = existing.map(p => ({ companyId: p.companyId, effectiveFrom: day(p.effectiveFrom), effectiveTo: p.effectiveTo ? day(p.effectiveTo) : input.effectiveDate! }));
        periods.push({ companyId: input.destinationCompanyId, effectiveFrom: input.effectiveDate, effectiveTo: null });
      }
      const confirmed = validatePeriods(periods ?? []);
      if (confirmed.some(p => !allowed.includes(p.companyId))) throw new AuthorizationDeniedError();
      const open = confirmed.find(p => p.effectiveTo === null);
      // Bounded historical evidence never changes today's operational master.
      const currentCompanyId = open?.companyId ?? truck.companyId;
      if (input.action === 'CONFIRM' && currentCompanyId !== truck.companyId) throw new TruckHistoryError('Initial history must agree with the current Company. Use an explicit move afterward.');
      if (currentCompanyId !== truck.companyId) {
        // These legacy resources derive authorization from today's Truck Company.
        // Fail closed until their own transfer/snapshot workflows are approved.
        const dependent = await tx.truck.findUniqueOrThrow({ where: { id: truckId }, select: { _count: { select: { drivers: true, settlements: true, truckInspections: true } } } });
        if (Object.values(dependent._count).some(count => count > 0)) throw new TruckHistoryError('Movement is blocked by Driver assignments or legacy settlement/inspection scope. Resolve those dependencies in a reviewed workflow first.');
      }
      const destinationTrucks = await tx.truck.findMany({ where: { companyId: currentCompanyId, id: { not: truckId } }, select: { unitNumber: true } });
      if (destinationTrucks.some(t => normalizeTruckUnitNumber(t.unitNumber) === normalizeTruckUnitNumber(truck.unitNumber))) throw new TruckHistoryError('Destination Company already has this unit number. Resolve the collision without automatic renumbering.');
      const revision = await tx.truckCompanyHistoryRevision.create({ data: { truckId, actorUserId: actorId, previousRevisionId: previous?.id, action: input.action, source: input.source, sourceReference: input.sourceReference.trim(), reason: input.reason.trim(), vinSnapshot: truck.vin } });
      await tx.truckCompanyAffiliation.updateMany({ where: { truckId, supersededAt: null }, data: { supersededAt: new Date() } });
      await tx.truckCompanyAffiliation.createMany({ data: confirmed.map(p => ({ truckId, companyId: p.companyId, effectiveFrom: historyDate(p.effectiveFrom), effectiveTo: p.effectiveTo ? historyDate(p.effectiveTo) : null, revisionId: revision.id })) });
      if (currentCompanyId !== truck.companyId) {
        await tx.truck.update({ where: { id: truckId }, data: { companyId: currentCompanyId, unitNumberNormalized: normalizeTruckUnitNumber(truck.unitNumber) } });
      }
      await tx.truckLifecycleEvent.create({ data: { truckReference: truckId, unitNumber: truck.unitNumber, companyId: truck.companyId, actorUserId: actorId, action: `TRUCK_COMPANY_${input.action}`, before: { companyId: truck.companyId, revisionId: previous?.id ?? null }, after: { companyId: currentCompanyId, revisionId: revision.id }, metadata: { source: input.source, sourceReference: input.sourceReference, reason: input.reason, vin: truck.vin, periods: confirmed } } });
      return { revisionId: revision.id, truckId, companyId: currentCompanyId };
    });
  }
}
export const truckCompanyHistoryService = new TruckCompanyHistoryService();
