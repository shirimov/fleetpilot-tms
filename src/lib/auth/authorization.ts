import type {
  CompanyMembershipRole,
  PrismaClient,
  User,
} from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
} from './auth-errors';
import {
  roleCanAccessModule,
  type FleetPilotModule,
} from './module-permissions';

export type TrustedSession = { user?: { id?: string } } | null;

export type AuthenticatedUser = Pick<
  User,
  'id' | 'email' | 'displayName' | 'isActive' | 'activeCompanyId'
>;

export type CompanyAuthorization = {
  user: AuthenticatedUser;
  companyId: string;
  role: CompanyMembershipRole;
};

type SessionResolver = () => Promise<TrustedSession>;

const roleWeight: Record<CompanyMembershipRole, number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

export class AuthorizationService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly resolveSession: SessionResolver = auth,
  ) {}

  async requireUser(): Promise<AuthenticatedUser> {
    const session = await this.resolveSession();
    const userId = session?.user?.id;
    if (!userId) throw new AuthenticationRequiredError();

    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        isActive: true,
        activeCompanyId: true,
      },
    });
    if (!user?.isActive) throw new AuthenticationRequiredError();
    return user;
  }

  async requireActiveCompany(
    minimumRole: CompanyMembershipRole = 'MEMBER',
  ): Promise<CompanyAuthorization> {
    const user = await this.requireUser();
    const membership = await this.database.companyMembership.findFirst({
      where: {
        userId: user.id,
        ...(user.activeCompanyId ? { companyId: user.activeCompanyId } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { companyId: true, role: true },
    });
    if (!membership || roleWeight[membership.role] < roleWeight[minimumRole]) {
      throw new AuthorizationDeniedError();
    }

    return { user, companyId: membership.companyId, role: membership.role };
  }

  async requireCompanyMembership(
    companyId: string,
    minimumRole: CompanyMembershipRole = 'MEMBER',
  ): Promise<CompanyAuthorization> {
    const user = await this.requireUser();
    const membership = await this.database.companyMembership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
      select: { companyId: true, role: true },
    });
    if (!membership || roleWeight[membership.role] < roleWeight[minimumRole]) {
      throw new AuthorizationDeniedError();
    }
    return { user, companyId: membership.companyId, role: membership.role };
  }

  async requireModule(module: FleetPilotModule): Promise<CompanyAuthorization> {
    const context = await this.requireActiveCompany();
    if (!roleCanAccessModule(context.role, module)) {
      throw new AuthorizationDeniedError();
    }
    return context;
  }

  async setActiveCompany(companyId: string): Promise<CompanyAuthorization> {
    const context = await this.requireCompanyMembership(companyId);
    await this.database.user.update({
      where: { id: context.user.id },
      data: { activeCompanyId: context.companyId },
    });
    return {
      ...context,
      user: { ...context.user, activeCompanyId: context.companyId },
    };
  }
}

export const authorizationService = new AuthorizationService();
