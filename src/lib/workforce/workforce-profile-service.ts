import {
  Prisma,
  type CompanyMembershipRole,
  type EmployeePayFrequency,
  type EmployeePayType,
  type EmploymentStatus,
  type EmploymentType,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { shiftDurationMinutes } from './schedule-time';
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

export type EmployeeProfileOnboardingInput = {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  employmentType?: EmploymentType;
  employmentStatus?: EmploymentStatus;
  startDate?: string | null;
  birthDate?: string | null;
  phone?: string | null;
  workLocation?: string | null;
  timezone?: string;
  managerId?: string | null;
  salary?: number | null;
  payType?: EmployeePayType;
  payFrequency?: EmployeePayFrequency;
  currency?: string;
  compensationEffectiveAt?: string | null;
  compensationNotes?: string | null;
};

const EMPLOYMENT_TYPES = new Set<EmploymentType>([
  'FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY',
]);
const EMPLOYMENT_STATUSES = new Set<EmploymentStatus>([
  'ACTIVE', 'LEAVE', 'INACTIVE', 'TERMINATED',
]);
const PAY_TYPES = new Set<EmployeePayType>(['SALARY', 'HOURLY']);
const PAY_FREQUENCIES = new Set<EmployeePayFrequency>([
  'WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY',
]);

export class WorkforceProfileService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async createForUser(
    context: CompanyAuthorization,
    userId: string,
    input: EmployeeProfileOnboardingInput,
  ) {
    this.requireManager(context.role);
    const data = this.validateOnboardingInput(input);
    try {
      return await this.database.$transaction(async (tx) => {
        const membership = await tx.companyMembership.findUnique({
          where: {
            userId_companyId: { userId, companyId: context.companyId },
          },
          select: {
            user: { select: { id: true, email: true, isActive: true } },
          },
        });
        if (!membership?.user.isActive) {
          throw new WorkforceValidationError(
            'User must be an active member of this company.',
          );
        }
        const existing = await tx.employee.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (existing) {
          throw new WorkforceValidationError(
            'User is already linked to an employee profile.',
          );
        }
        if (data.managerId) {
          const manager = await tx.employee.findFirst({
            where: { id: data.managerId, companyId: context.companyId },
            select: { id: true },
          });
          if (!manager) {
            throw new WorkforceValidationError(
              'Manager must belong to this company.',
            );
          }
        }
        return tx.employee.create({
          data: {
            ...data,
            companyId: context.companyId,
            userId: membership.user.id,
            email: membership.user.email,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        throw new WorkforceValidationError(
          'User is already linked to an employee profile.',
        );
      }
      throw error;
    }
  }

  async linkUser(context: CompanyAuthorization, employeeId: string, userId: string | null) {
    this.requireManager(context.role);
    return this.database.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, companyId: context.companyId },
        select: { id: true, userId: true },
      });
      if (!employee) throw new WorkforceResourceNotFoundError();
      if (userId) {
        if (employee.userId) {
          throw new WorkforceValidationError(
            'Employee profile is already linked to a user.',
          );
        }
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

  private validateOnboardingInput(input: EmployeeProfileOnboardingInput) {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName || !lastName) {
      throw new WorkforceValidationError(
        'First name and last name are required.',
      );
    }
    const optionalText = (value: string | null | undefined) => {
      const normalized = value?.trim();
      return normalized || null;
    };
    const date = (value: string | null | undefined, label: string) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new WorkforceValidationError(`${label} is invalid.`);
      }
      return parsed;
    };
    const employmentType = input.employmentType ?? 'FULL_TIME';
    const employmentStatus = input.employmentStatus ?? 'ACTIVE';
    const payType = input.payType ?? 'SALARY';
    const payFrequency = input.payFrequency ?? 'MONTHLY';
    if (!EMPLOYMENT_TYPES.has(employmentType)
      || !EMPLOYMENT_STATUSES.has(employmentStatus)
      || !PAY_TYPES.has(payType)
      || !PAY_FREQUENCIES.has(payFrequency)) {
      throw new WorkforceValidationError('Employee profile values are invalid.');
    }
    const timezone = input.timezone?.trim() || 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new WorkforceValidationError('Timezone is invalid.');
    }
    if (input.salary !== null && input.salary !== undefined
      && (!Number.isFinite(input.salary) || input.salary < 0)) {
      throw new WorkforceValidationError('Salary must be a non-negative number.');
    }
    return {
      firstName,
      lastName,
      preferredName: optionalText(input.preferredName),
      jobTitle: optionalText(input.jobTitle),
      department: optionalText(input.department),
      employmentType,
      employmentStatus,
      startDate: date(input.startDate, 'Start date'),
      birthDate: date(input.birthDate, 'Birth date'),
      phone: optionalText(input.phone),
      workLocation: optionalText(input.workLocation),
      timezone,
      managerId: optionalText(input.managerId),
      salary: input.salary ?? null,
      payType,
      payFrequency,
      currency: input.currency?.trim() || 'USD',
      compensationEffectiveAt: date(
        input.compensationEffectiveAt,
        'Compensation effective date',
      ),
      compensationNotes: optionalText(input.compensationNotes),
    };
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
    if (day.isWorking && day.startMinute !== null && day.endMinute !== null
      && day.breakMinutes > shiftDurationMinutes(day.startMinute, day.endMinute)) {
      throw new WorkforceValidationError('Break minutes cannot exceed the shift duration.');
    }
  }
}

export const workforceProfileService = new WorkforceProfileService();
