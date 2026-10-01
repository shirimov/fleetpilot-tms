import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { FinancialAuthorization } from '@/lib/finance/financial-control-authorization';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from '@/lib/finance/financial-control-errors';
import { validateOwnerPeriods, type OwnerPeriod } from './truck-owner-resolution';

const day = (value: Date) => value.toISOString().slice(0, 10);
export type OwnerHistoryChange = { expectedRevisionId: string | null; sourceReference: string; reason: string; periods: OwnerPeriod[] };

export class TruckOwnerHistoryService {
  constructor(private readonly database: PrismaClient = prisma) {}

  private async authorize(tx: Prisma.TransactionClient, truckId: string, context: FinancialAuthorization, write: boolean) {
    const roles: Array<'OWNER' | 'ADMIN'> = write ? ['OWNER'] : ['OWNER', 'ADMIN'];
    const actor = await tx.user.findFirst({ where: { id: context.userId, isActive: true, operatingGroupMemberships: { some: { operatingGroupId: context.operatingGroupId, role: { in: roles } } } } });
    if (!actor) throw new AuthorizationDeniedError();
    const memberships = await tx.companyMembership.findMany({ where: { userId: context.userId, role: { in: roles }, companyId: { in: context.companyIds }, company: { operatingGroupLink: { operatingGroupId: context.operatingGroupId } } }, select: { companyId: true } });
    const allowed = memberships.map(item => item.companyId);
    if (!allowed.includes(context.activeCompanyId)) throw new AuthorizationDeniedError();
    const truck = await tx.truck.findFirst({ where: { id: truckId, companyId: { in: allowed } }, select: { id: true, companyId: true, unitNumber: true } });
    if (!truck) throw new FinancialNotFoundError();
    const periods = await tx.truckOwnerPeriod.findMany({ where: { truckId, supersededAt: null }, include: { ownerParty: { select: { name: true, companyId: true, operatingGroupId: true } }, revision: true }, orderBy: { effectiveFrom: 'asc' } });
    // Never present a partial timeline that could hide an overlap or erase a foreign period.
    if (periods.some(p => !allowed.includes(p.companyId) || p.revision.operatingGroupId !== context.operatingGroupId || p.ownerParty.operatingGroupId !== context.operatingGroupId || p.ownerParty.companyId && !allowed.includes(p.ownerParty.companyId))) throw new AuthorizationDeniedError();
    const revision = await tx.truckOwnerHistoryRevision.findFirst({ where: { truckId, nextRevision: { is: null } } });
    if (revision && revision.operatingGroupId !== context.operatingGroupId) throw new AuthorizationDeniedError();
    return { allowed, truck, periods, revision };
  }

  // Minimal read-only selector: dimensions lacks party Company scope and the
  // paginated archive browser is not a complete scoped Contractor lookup.
  async options(truckId: string, context: FinancialAuthorization) {
    return this.database.$transaction(async tx => {
      const readable = await this.authorize(tx, truckId, context, false);
      let allowed = readable.allowed;
      let canManage = false;
      try {
        const writable = await this.authorize(tx, truckId, context, true);
        allowed = writable.allowed;
        canManage = true;
      } catch (error) {
        if (!(error instanceof AuthorizationDeniedError) && !(error instanceof FinancialNotFoundError)) throw error;
      }
      const [companies, owners, versions] = await Promise.all([
        tx.company.findMany({ where: { id: { in: allowed } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        tx.financialParty.findMany({ where: { operatingGroupId: context.operatingGroupId, type: 'OWNER_OPERATOR', isActive: true, OR: [{ companyId: null }, { companyId: { in: allowed } }] }, select: { id: true, name: true, companyId: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
        tx.archiveVersion.findMany({ where: { sealed: true, recipientType: 'CONTRACTOR', statement: { company: { operatingGroupId: context.operatingGroupId, companyId: { in: allowed } } } }, distinct: ['statementId', 'recipientId'], select: { recipientId: true, recipientName: true, statement: { select: { company: { select: { companyId: true } } } } }, orderBy: [{ capturedAt: 'desc' }, { id: 'asc' }] }),
      ]);
      const recipients = new Map<string, { id: string; name: string | null; companyId: string }>();
      for (const version of versions) {
        const companyId = version.statement.company.companyId;
        const key = JSON.stringify([companyId, version.recipientId]);
        if (!recipients.has(key)) recipients.set(key, { id: version.recipientId, name: version.recipientName, companyId });
      }
      return { canManage, companies, owners, recipients: [...recipients.values()].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id) || a.id.localeCompare(b.id)) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async history(truckId: string, context: FinancialAuthorization) {
    return this.database.$transaction(async tx => {
      const { truck, periods, revision } = await this.authorize(tx, truckId, context, false);
      return { truckId, unitNumber: truck.unitNumber, revisionId: revision?.id ?? null, periods: periods.map(p => ({
        id: p.id, ownerPartyId: p.ownerPartyId, ownerName: p.ownerParty.name, companyId: p.companyId,
        providerRecipientId: p.providerRecipientId, effectiveFrom: day(p.effectiveFrom), effectiveTo: p.effectiveTo ? day(p.effectiveTo) : null,
        revisionId: p.revisionId, sourceReference: p.revision.sourceReference, reason: p.revision.reason,
        actorUserId: p.revision.actorUserId, createdAt: p.revision.createdAt,
      })) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async replace(truckId: string, input: OwnerHistoryChange, context: FinancialAuthorization) {
    if (!input || (input.expectedRevisionId !== null && (typeof input.expectedRevisionId !== 'string' || !input.expectedRevisionId))) throw new FinancialValidationError('Expected revision ID (or null for first confirmation) is required.');
    for (const value of [input.sourceReference, input.reason]) if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new FinancialValidationError('Reason and evidence reference are required (maximum 2000 characters).');
    const confirmed = validateOwnerPeriods(input.periods);
    return this.database.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Truck" WHERE id = ${truckId} FOR UPDATE`;
      const { allowed, truck, revision } = await this.authorize(tx, truckId, context, true);
      if ((revision?.id ?? null) !== input.expectedRevisionId) throw new FinancialConflictError('Owner history changed. Reload before submitting.');
      for (const period of confirmed) {
        if (!allowed.includes(period.companyId)) throw new AuthorizationDeniedError();
        const owner = await tx.financialParty.findFirst({ where: { id: period.ownerPartyId, operatingGroupId: context.operatingGroupId, type: 'OWNER_OPERATOR', isActive: true, OR: [{ companyId: null }, { companyId: period.companyId }] }, select: { id: true } });
        if (!owner) throw new FinancialValidationError('Owner is not an active owner party in this scope.');
        const recipient = await tx.archiveVersion.findFirst({ where: { recipientId: period.providerRecipientId, recipientType: 'CONTRACTOR', sealed: true, statement: { company: { operatingGroupId: context.operatingGroupId, companyId: period.companyId } } }, select: { id: true } });
        if (!recipient) throw new FinancialValidationError('Confirmed QM Contractor recipient must exist in the selected Company archive.');
      }
      const next = await tx.truckOwnerHistoryRevision.create({ data: { truckId, operatingGroupId: context.operatingGroupId, actorUserId: context.userId, previousRevisionId: revision?.id ?? null, sourceReference: input.sourceReference.trim(), reason: input.reason.trim() } });
      await tx.truckOwnerPeriod.updateMany({ where: { truckId, supersededAt: null }, data: { supersededAt: new Date() } });
      await tx.truckOwnerPeriod.createMany({ data: confirmed.map(period => ({ truckId, ownerPartyId: period.ownerPartyId, companyId: period.companyId, providerRecipientId: period.providerRecipientId, effectiveFrom: new Date(`${period.effectiveFrom}T00:00:00Z`), effectiveTo: period.effectiveTo ? new Date(`${period.effectiveTo}T00:00:00Z`) : null, revisionId: next.id })) });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: truck.companyId, actorUserId: context.userId, action: 'TRUCK_OWNER_HISTORY_CONFIRMED', metadata: { truckId, previousRevisionId: revision?.id ?? null, revisionId: next.id, sourceReference: input.sourceReference.trim(), reason: input.reason.trim(), periods: confirmed } } });
      return { truckId, revisionId: next.id };
    });
  }
}
export const truckOwnerHistoryService = new TruckOwnerHistoryService();
