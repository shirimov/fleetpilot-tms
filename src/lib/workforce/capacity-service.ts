import type { PrismaClient, TaskCard } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const completeStatuses = new Set(['DONE', 'CANCELLED']);

export function weightedCompletion(tasks: Pick<TaskCard, 'effort' | 'status'>[]) {
  const eligibleTasks = tasks.filter((task) => task.status !== 'CANCELLED');
  const totalEffort = eligibleTasks.reduce((sum, task) => sum + task.effort, 0);
  const completedEffort = eligibleTasks.reduce((sum, task) => sum + (task.status === 'DONE' ? task.effort : 0), 0);
  return { completedEffort, totalEffort, percentage: totalEffort ? Math.round((completedEffort / totalEffort) * 1000) / 10 : 0 };
}

type LocalDate = { year: number; month: number; day: number };

function localMidnight({ year, month, day }: LocalDate, timeZone: string) {
  const utcGuess = Date.UTC(year, month - 1, day);
  const offsetAt = (instant: number) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(p.find((part) => part.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant;
  };
  let result = utcGuess - offsetAt(utcGuess);
  result = utcGuess - offsetAt(result);
  return new Date(result);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')), weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(value('weekday')) };
}

export function localDayBounds(date: Date, timeZone: string) {
  const local = zonedParts(date, timeZone);
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return { start: localMidnight(local, timeZone), end: localMidnight({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, timeZone), weekday: local.weekday };
}

export function localPeriodBounds(date: Date, timeZone: string) {
  const local = zonedParts(date, timeZone);
  const day = localDayBounds(date, timeZone);
  const calendarDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const weekStartDate = new Date(calendarDate);
  weekStartDate.setUTCDate(calendarDate.getUTCDate() - ((local.weekday + 6) % 7));
  const monthStartDate = new Date(Date.UTC(local.year, local.month - 1, 1));
  const monthEndDate = new Date(Date.UTC(local.year, local.month, 1));
  const asLocalDate = (value: Date): LocalDate => ({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() });
  const weekStart = localMidnight(asLocalDate(weekStartDate), timeZone);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 7);
  return {
    today: { start: day.start, end: day.end },
    thisWeek: { start: weekStart, end: localMidnight(asLocalDate(weekEndDate), timeZone) },
    thisMonth: { start: localMidnight(asLocalDate(monthStartDate), timeZone), end: localMidnight(asLocalDate(monthEndDate), timeZone) },
  };
}

export class CapacityService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async forEmployeeDay(companyId: string, employeeId: string, date = new Date()) {
    const employee = await this.database.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true, userId: true, timezone: true } });
    if (!employee) throw new Error('Employee not found.');
    const timeZone = employee.timezone || 'UTC';
    const bounds = localDayBounds(date, timeZone);
    const [schedule, tasks] = await Promise.all([
      this.database.employeeScheduleDay.findUnique({ where: { employeeId_weekday: { employeeId, weekday: bounds.weekday } } }),
      employee.userId ? this.database.taskCard.findMany({ where: { assigneeUserId: employee.userId, project: { companyId } }, select: { effort: true, status: true, expectedDurationMinutes: true, dueDate: true, completedAt: true } }) : [],
    ]);
    const open = tasks.filter((task) => !completeStatuses.has(task.status));
    const dueToday = open.filter((task) => task.dueDate && task.dueDate >= bounds.start && task.dueDate < bounds.end);
    const overdue = open.filter((task) => task.dueDate && task.dueDate < bounds.start);
    const assignedRemainingMinutes = open.reduce((sum, task) => sum + (task.expectedDurationMinutes ?? 0), 0);
    const capacityMinutes = schedule?.isWorking ? schedule.capacityMinutes : 0;
    const weekStart = new Date(bounds.start); weekStart.setUTCDate(weekStart.getUTCDate() - ((bounds.weekday + 6) % 7));
    const completedThisWeek = tasks.filter((task) => task.status === 'DONE' && task.completedAt && task.completedAt >= weekStart && task.completedAt < bounds.end);
    return {
      employeeId,
      date: bounds.start.toISOString(),
      timezone: timeZone,
      scheduledWorkingMinutes: schedule?.isWorking && schedule.startMinute !== null && schedule.endMinute !== null
        ? ((schedule.endMinute - schedule.startMinute + 1440) % 1440 || 1440) - schedule.breakMinutes : 0,
      expectedTaskCapacityMinutes: capacityMinutes,
      assignedRemainingExpectedMinutes: assignedRemainingMinutes,
      dueTodayExpectedMinutes: dueToday.reduce((sum, task) => sum + (task.expectedDurationMinutes ?? 0), 0),
      overdueExpectedMinutes: overdue.reduce((sum, task) => sum + (task.expectedDurationMinutes ?? 0), 0),
      freeCapacityMinutes: capacityMinutes - assignedRemainingMinutes,
      utilizationPercentage: capacityMinutes > 0 ? Math.round((assignedRemainingMinutes / capacityMinutes) * 1000) / 10 : null,
      overloaded: assignedRemainingMinutes > capacityMinutes,
      taskCount: { complete: tasks.filter((task) => task.status === 'DONE').length, total: tasks.length },
      openTaskCount: open.length,
      completedThisWeekCount: completedThisWeek.length,
      weightedEffortCompletedThisWeek: completedThisWeek.reduce((sum, task) => sum + task.effort, 0),
      weightedCompletion: weightedCompletion(tasks),
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
    };
  }

  async weightedPeriods(companyId: string, employeeId: string, now = new Date()) {
    const employee = await this.database.employee.findFirst({ where: { id: employeeId, companyId }, select: { userId: true, timezone: true } });
    if (!employee) throw new Error('Employee not found.');
    if (!employee.userId) {
      const empty = weightedCompletion([]);
      return { today: empty, thisWeek: empty, thisMonth: empty, currentWorkload: empty };
    }
    const periods = localPeriodBounds(now, employee.timezone || 'UTC');
    const forPeriod = async ({ start, end }: { start: Date; end: Date }) => weightedCompletion(await this.database.taskCard.findMany({
      where: {
        assigneeUserId: employee.userId,
        status: { not: 'CANCELLED' },
        project: { companyId, isArchived: false },
        OR: [{ status: { not: 'DONE' } }, { status: 'DONE', completedAt: { gte: start, lt: end } }],
      },
      select: { effort: true, status: true },
    }));
    const [today, thisWeek, thisMonth] = await Promise.all([forPeriod(periods.today), forPeriod(periods.thisWeek), forPeriod(periods.thisMonth)]);
    // Current workload is the active monthly window: unfinished assigned work plus
    // work completed this employee-local month. Cancelled and archived work is excluded.
    return { today, thisWeek, thisMonth, currentWorkload: thisMonth };
  }

  async dailyPlanner(companyId: string, date = new Date()) {
    const employees = await this.database.employee.findMany({ where: { companyId, employmentStatus: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, skills: { include: { skill: true } } } });
    return Promise.all(employees.map(async (employee) => ({ employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}`.trim(), skills: employee.skills.filter(({ skill }) => skill.isActive).map(({ skill }) => skill.name) }, ...(await this.forEmployeeDay(companyId, employee.id, date)) })));
  }
}

export const capacityService = new CapacityService();
