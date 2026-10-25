import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  authorizationService,
  type CompanyAuthorization,
} from "@/lib/auth/authorization";
import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";

export type DriverAccess = {
  canRead: boolean;
  canEdit: boolean;
  canViewCompensation: boolean;
  canReadDocuments: boolean;
};

// Job roles grant Drivers reads only, never company administration or writes.
const DRIVER_READER_ROLES = [
  "DISPATCHER",
  "LEAD_DISPATCH",
  "UPDATER",
  "MANAGER",
  "SAFETY",
  "ADMIN",
] as const;
export class DriverAuthorizationService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorization: AuthorizationService = authorizationService,
  ) {}

  async accessFor(context: CompanyAuthorization): Promise<DriverAccess> {
    if (context.role === "ADMIN" || context.role === "OWNER") {
      return {
        canRead: true,
        canEdit: true,
        canViewCompensation: true,
        canReadDocuments: true,
      };
    }
    const employee = await this.database.employee.findFirst({
      where: {
        userId: context.user.id,
        companyId: context.companyId,
        isActive: true,
        employmentStatus: "ACTIVE",
        role: { in: [...DRIVER_READER_ROLES] },
      },
      select: { id: true, role: true },
    });
    return {
      canRead: !!employee,
      canEdit: false,
      canViewCompensation: false,
      canReadDocuments:
        !!employee && ["MANAGER", "SAFETY", "ADMIN"].includes(employee.role),
    };
  }

  async requireRead() {
    const context = await this.authorization.requireActiveCompany();
    const access = await this.accessFor(context);
    if (!access.canRead) throw new AuthorizationDeniedError();
    return { ...context, access };
  }
}
export function isDriverReadPath(pathname: string) {
  return (
    pathname === "/drivers" ||
    pathname === "/api/drivers" ||
    /^\/api\/drivers\/[^/]+(?:\/(?:documents(?:\/[^/]+(?:\/versions\/[^/]+)?)?|qualification|activity))?\/?$/.test(
      pathname,
    )
  );
}
export const driverAuthorizationService = new DriverAuthorizationService();
