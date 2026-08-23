import type { PrismaClient, TaskCard } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const completeStatuses = new Set(['DONE', 'CANCELLED']);

export function weightedCompletion(tasks: Pick<TaskCard, 'effort' | 'status'>[]) {
  const totalEffort = tasks.reduce((sum, task) => sum + task.effort, 0);
  const completedEffort = tasks.reduce((sum, task) => sum + (task.status === 'DONE' ? task.effort : 0), 0);
  return { completedEffort, totalEffort, percentage: totalEffort ? Math.round((completedEffort / totalEffort) * 1000) / 10 : 0 };
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')), weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(value('weekday')) };
}

export function localDayBounds(date: Date, timeZone: string) {
  const local = zonedParts(date, timeZone);
  const utcGuess = Date.UTC(local.year, local.month - 1, local.day);
  const offsetAt = (instant: number) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(p.find((part) => part.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant;
  };
  let startMs = utcGuess - offsetAt(utcGuess);
  startMs = utcGuess - offsetAt(startMs);
  const nextGuess = Date.UTC(local.year, local.month - 1, local.day + 1);
  let endMs = nextGuess - offsetAt(nextGuess);
  endMs = nextGuess - offsetAt(endMs);
  return { start: new Date(startMs), end: new Date(endMs), weekday: local.weekday };
}

export class CapacityService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async forEmployeeDay(companyId: string, employeeId: string, date = new Date()) {
    const employee = await this.database.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true, userId: true, timezone: true } });
    if (!employee) throw new Error('Employee not found.');
    const bounds = localDayBounds(date, employee.timezone);
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
      timezone: employee.timezone,
      scheduledWorkingMinutes: schedule?.isWorking && schedule.startMinute !== null && schedule.endMinute !== null
        ? ((schedule.endMinute - schedule.startMinute + 1440) % 1440 || 1440) - schedule.breakMinutes : 0,
      expectedTaskCapacityMinutes: capacityMinutes,
      assignedRemainingExpectedMinutes: assignedRemainingMinutes,
      dueTodayExpectedMinutes: dueToday.reduce((sum, task) => sum + (task.expectedDurationMinutes ?? 0), 0),
      overdueExpectedMinutes: overdue.reduce((sum, task) => sum + (task.expectedDurationMinutes ?? 0), 0),
      freeCapacityMinutes: capacityMinutes - assignedRemainingMinutes,
      utilizationPercentage: capacityMinutes ? Math.round((assignedRemainingMinutes / capacityMinutes) * 1000) / 10 : 0,
      taskCount: { complete: tasks.filter((task) => task.status === 'DONE').length, total: tasks.length },
      openTaskCount: open.length,
      completedThisWeekCount: completedThisWeek.length,
      weightedEffortCompletedThisWeek: completedThisWeek.reduce((sum, task) => sum + task.effort, 0),
      weightedCompletion: weightedCompletion(tasks),
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
    };
  }

  async weightedPeriods(companyId: string, userId: string, now = new Date()) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const week = new Date(today); week.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const tasks = await this.database.taskCard.findMany({
      where: { assigneeUserId: userId, project: { companyId } },
      select: { effort: true, status: true, completedAt: true },
    });
    const forPeriod = (start: Date | null) => weightedCompletion(tasks.filter((task) => !start || task.status !== 'DONE' || (task.completedAt !== null && task.completedAt >= start)) as Pick<TaskCard, 'effort' | 'status'>[]);
    return { today: forPeriod(today), thisWeek: forPeriod(week), thisMonth: forPeriod(month), currentWorkload: weightedCompletion(tasks.filter((task) => !completeStatuses.has(task.status)) as Pick<TaskCard, 'effort' | 'status'>[]) };
  }

  async dailyPlanner(companyId: string, date = new Date()) {
    const employees = await this.database.employee.findMany({ where: { companyId, employmentStatus: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, skills: { include: { skill: true } } } });
    return Promise.all(employees.map(async (employee) => ({ employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}`.trim(), skills: employee.skills.filter(({ skill }) => skill.isActive).map(({ skill }) => skill.name) }, ...(await this.forEmployeeDay(companyId, employee.id, date)) })));
  }
}

export const capacityService = new CapacityService();
