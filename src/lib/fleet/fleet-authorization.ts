import type { CompanyMembershipRole, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  AuthorizationService,
  authorizationService,
  type CompanyAuthorization,
} from '@/lib/auth/authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';

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
    const user = await this.authorization.requireUser();
    const truck = await this.database.truck.findUnique({
      where: { id: truckId },
      select: { companyId: true },
    });
    if (!truck) throw new FleetResourceNotFoundError();
    try {
      return await this.authorization.requireCompanyMembership(
        truck.companyId,
        minimumRole,
      );
    } catch (error) {
      if (error instanceof AuthorizationDeniedError && await this.database.companyMembership.findUnique({
        where: { userId_companyId: { userId: user.id, companyId: truck.companyId } },
        select: { id: true },
      })) throw error;
      throw new FleetResourceNotFoundError();
    }
  }

  async requireTrailer(
    trailerId: string,
    minimumRole: CompanyMembershipRole = 'MEMBER',
  ): Promise<CompanyAuthorization> {
    const user = await this.authorization.requireUser();
    const trailer = await this.database.trailer.findUnique({
      where: { id: trailerId },
      select: { companyId: true },
    });
    if (!trailer) throw new FleetResourceNotFoundError();
    try {
      return await this.authorization.requireCompanyMembership(
        trailer.companyId,
        minimumRole,
      );
    } catch (error) {
      if (error instanceof AuthorizationDeniedError && await this.database.companyMembership.findUnique({
        where: { userId_companyId: { userId: user.id, companyId: trailer.companyId } },
        select: { id: true },
      })) throw error;
      throw new FleetResourceNotFoundError();
    }
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
      where: { id: driverId, companyId: context.companyId },
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
        driver: { companyId: context.companyId },
      },
      select: { id: true },
    });
    if (!orientation) throw new FleetResourceNotFoundError();
    return context;
  }

  async requireLoad(loadId: string): Promise<CompanyAuthorization> {
    const context = await this.requireCompany();
    const load = await this.database.load.findFirst({
      where: { id: loadId, companyId: context.companyId },
      select: { id: true },
    });
    if (!load) throw new FleetResourceNotFoundError();
    return context;
  }
}

export const fleetAuthorizationService = new FleetAuthorizationService();
