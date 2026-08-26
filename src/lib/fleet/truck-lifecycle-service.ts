import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import type { PrismaClient, TruckStatus } from '@prisma/client';

export class TruckLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TruckLifecycleError';
  }
}

const protectedRelations = [
  'drivers', 'loads', 'settlements', 'truckInspections', 'financialAllocations',
  'financialExpectations', 'adminFeeAgreements', 'pilotFuelingEvents', 'importRows',
] as const;

export class TruckLifecycleService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async changeStatus(truckId: string, status: TruckStatus, context: CompanyAuthorization) {
    if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new TruckLifecycleError('Unsupported lifecycle status.');
    return this.database.$transaction(async (tx) => {
      const truck = await tx.truck.findFirst({ where: { id: truckId, companyId: context.companyId } });
      if (!truck) throw new TruckLifecycleError('Truck not found.');
      if (status === 'INACTIVE' && truck.status === 'INACTIVE') return truck;
      if (status === 'ACTIVE' && truck.status !== 'INACTIVE') throw new TruckLifecycleError('Only an inactive Truck can be reactivated.');
      const updated = await tx.truck.update({ where: { id: truck.id }, data: { status } });
      await tx.truckLifecycleEvent.create({ data: {
        companyId: context.companyId, actorUserId: context.user.id, truckReference: truck.id,
        unitNumber: truck.unitNumber, action: status === 'INACTIVE' ? 'TRUCK_DEACTIVATED' : 'TRUCK_REACTIVATED',
        before: { status: truck.status }, after: { status },
      } });
      return updated;
    });
  }

  async deleteUnused(truckId: string, context: CompanyAuthorization) {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`truck-delete:${truckId}`}))`;
      const truck = await tx.truck.findFirst({
        where: { id: truckId, companyId: context.companyId },
        include: { _count: { select: {
          drivers: true, loads: true, settlements: true, truckInspections: true,
          financialAllocations: true, financialExpectations: true, adminFeeAgreements: true,
          pilotFuelingEvents: true, importRows: true,
        } } },
      });
      if (!truck) throw new TruckLifecycleError('Truck not found.');
      const dependencies = protectedRelations.filter((relation) => truck._count[relation] > 0);
      if (dependencies.length) throw new TruckLifecycleError('This Truck has protected history and cannot be deleted. Deactivate it instead.');
      await tx.truckLifecycleEvent.create({ data: {
        companyId: context.companyId, actorUserId: context.user.id, truckReference: truck.id,
        unitNumber: truck.unitNumber, action: 'TRUCK_DELETED', before: { status: truck.status },
        metadata: { reason: 'unused-erroneous-record' },
      } });
      await tx.truck.delete({ where: { id: truck.id } });
      return { ok: true };
    });
  }
}

export const truckLifecycleService = new TruckLifecycleService();
