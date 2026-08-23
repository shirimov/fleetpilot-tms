import type { CompanyMembershipRole, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { WorkforceResourceNotFoundError } from './workforce-authorization';

export class WorkforceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkforceValidationError';
  }
}

export type ScheduleDayInput = {
  weekday: number;
  isWorking: boolean;
  startMinute: number | null;
  endMinute: number | null;
  breakMinutes: number;
  capacityMinutes: number;
};

export class WorkforceProfileService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async linkUser(context: CompanyAuthorization, employeeId: string, userId: string | null) {
    this.requireManager(context.role);
    return this.database.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, companyId: context.companyId },
        select: { id: true },
      });
      if (!employee) throw new WorkforceResourceNotFoundError();
      if (userId) {
        const membership = await tx.companyMembership.findUnique({
          where: { userId_companyId: { userId, companyId: context.companyId } },
          select: { user: { select: { isActive: true } } },
        });
        if (!membership?.user.isActive) throw new WorkforceValidationError('User must be an active member of this company.');
        const duplicate = await tx.employee.findFirst({ where: { userId, id: { not: employeeId } }, select: { id: true } });
        if (duplicate) throw new WorkforceValidationError('User is already linked to an employee.');
      }
      return tx.employee.update({ where: { id: employeeId }, data: { userId } });
    });
  }

  async getProfile(context: CompanyAuthorization, employeeId: string) {
    const employee = await this.database.employee.findFirst({
      where: { id: employeeId, companyId: context.companyId },
      include: {
        user: { select: { id: true, displayName: true, email: true, image: true, isActive: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        scheduleDays: { orderBy: { weekday: 'asc' } },
        skills: { include: { skill: true }, orderBy: { skill: { name: 'asc' } } },
      },
    });
    if (!employee) throw new WorkforceResourceNotFoundError();
    const ownProfile = employee.userId === context.user.id;
    if (context.role === 'MEMBER' && !ownProfile) throw new AuthorizationDeniedError();
    const telegram = employee.userId
      ? await this.database.telegramUserLink.findUnique({
          where: { companyId_userId: { companyId: context.companyId, userId: employee.userId } },
          select: { enabled: true, telegramUsername: true },
        })
      : null;
    const safe: Partial<typeof employee> & {
      photoUrl: string | null;
      telegram: { connected: boolean; username: string | null };
    } = {
      ...employee,
      photoUrl: employee.photoStorageKey ? `/api/workforce/employees/${employee.id}/photo` : null,
      telegram: { connected: Boolean(telegram?.enabled), username: telegram?.telegramUsername ?? null },
    };
    delete safe.photoStorageKey;
    if (context.role !== 'MEMBER') return safe;
    const publicProfile: Partial<typeof safe> = { ...safe };
    delete publicProfile.salary; delete publicProfile.payType; delete publicProfile.payFrequency;
    delete publicProfile.compensationEffectiveAt; delete publicProfile.compensationNotes;
    delete publicProfile.birthDate; delete publicProfile.address; delete publicProfile.emergencyContact;
    delete publicProfile.privateNotes; delete publicProfile.notes;
    return publicProfile;
  }

  async replaceSchedule(context: CompanyAuthorization, employeeId: string, days: ScheduleDayInput[]) {
    this.requireSelfOrManager(context);
    if (days.length !== 7 || new Set(days.map((day) => day.weekday)).size !== 7) {
      throw new WorkforceValidationError('Schedule must contain each weekday exactly once.');
    }
    for (const day of days) this.validateScheduleDay(day);
    return this.database.$transaction(async (tx) => {
      await this.requireEmployee(tx, context.companyId, employeeId, context.role === 'MEMBER' ? context.user.id : undefined);
      await tx.employeeScheduleDay.deleteMany({ where: { employeeId } });
      await tx.employeeScheduleDay.createMany({ data: days.map((day) => ({ employeeId, ...day })) });
      return tx.employeeScheduleDay.findMany({ where: { employeeId }, orderBy: { weekday: 'asc' } });
    });
  }

  async setSkills(context: CompanyAuthorization, employeeId: string, skillIds: string[]) {
    this.requireManager(context.role);
    const uniqueIds = [...new Set(skillIds)];
    return this.database.$transaction(async (tx) => {
      await this.requireEmployee(tx, context.companyId, employeeId);
      const count = await tx.employeeSkillDefinition.count({ where: { id: { in: uniqueIds }, companyId: context.companyId } });
      if (count !== uniqueIds.length) throw new WorkforceValidationError('Every skill must belong to this company.');
      await tx.employeeSkill.deleteMany({ where: { employeeId } });
      await tx.employeeSkill.createMany({ data: uniqueIds.map((skillId) => ({ employeeId, skillId })) });
      return tx.employeeSkill.findMany({ where: { employeeId }, include: { skill: true } });
    });
  }

  private requireManager(role: CompanyMembershipRole) {
    if (role === 'MEMBER') throw new AuthorizationDeniedError();
  }

  private requireSelfOrManager(context: CompanyAuthorization) {
    if (!context.user.id) throw new AuthorizationDeniedError();
  }

  private async requireEmployee(tx: Prisma.TransactionClient, companyId: string, employeeId: string, userId?: string) {
    const employee = await tx.employee.findFirst({ where: { id: employeeId, companyId, ...(userId ? { userId } : {}) }, select: { id: true } });
    if (!employee) throw new WorkforceResourceNotFoundError();
  }

  private validateScheduleDay(day: ScheduleDayInput) {
    const minute = (value: number | null) => value === null || (Number.isInteger(value) && value >= 0 && value < 1440);
    if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6 || !minute(day.startMinute) || !minute(day.endMinute)
      || !Number.isInteger(day.breakMinutes) || day.breakMinutes < 0 || day.breakMinutes > 1440
      || !Number.isInteger(day.capacityMinutes) || day.capacityMinutes < 0 || day.capacityMinutes > 1440) {
      throw new WorkforceValidationError('Schedule values are invalid.');
    }
    if (day.isWorking && (day.startMinute === null || day.endMinute === null)) {
      throw new WorkforceValidationError('Working days require start and end times.');
    }
  }
}

export const workforceProfileService = new WorkforceProfileService();
