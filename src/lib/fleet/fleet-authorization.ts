import type { CompanyMembershipRole, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  AuthorizationService,
  authorizationService,
  type CompanyAuthorization,
} from '@/lib/auth/authorization';

export class FleetResourceNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'FleetResourceNotFoundError';
  }
}

export class FleetAuthorizationService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorization: AuthorizationService = authorizationService,
  ) {}

  requireCompany(
    minimumRole: CompanyMembershipRole = 'MEMBER',
  ): Promise<CompanyAuthorization> {
    return this.authorization.requireActiveCompany(minimumRole);
  }

  async requireTruck(
    truckId: string,
    minimumRole: CompanyMembershipRole = 'MEMBER',
  ): Promise<CompanyAuthorization> {
    const context = await this.requireCompany(minimumRole);
    const truck = await this.database.truck.findFirst({
      where: { id: truckId, companyId: context.companyId },
      select: { id: true },
    });
    if (!truck) throw new FleetResourceNotFoundError();
    return context;
  }

  async requireTruckInspection(
    inspectionId: string,
  ): Promise<CompanyAuthorization> {
    const context = await this.requireCompany();
    const inspection = await this.database.truckInspection.findFirst({
      where: { id: inspectionId, truck: { companyId: context.companyId } },
      select: { id: true },
    });
    if (!inspection) throw new FleetResourceNotFoundError();
    return context;
  }

  async requireDriver(driverId: string): Promise<CompanyAuthorization> {
    const context = await this.requireCompany();
    const driver = await this.database.driver.findFirst({
      where: {
        id: driverId,
        truck: { is: { companyId: context.companyId } },
      },
      select: { id: true },
    });
    if (!driver) throw new FleetResourceNotFoundError();
    return context;
  }

  async requireDriverOrientation(
    orientationId: string,
  ): Promise<CompanyAuthorization> {
    const context = await this.requireCompany();
    const orientation = await this.database.driverOrientation.findFirst({
      where: {
        id: orientationId,
        driver: { truck: { is: { companyId: context.companyId } } },
      },
      select: { id: true },
    });
    if (!orientation) throw new FleetResourceNotFoundError();
    return context;
  }
}

export const fleetAuthorizationService = new FleetAuthorizationService();
