import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { AuthorizationService, type TrustedSession } from '@/lib/auth/authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { CapacityService, localDayBounds, localPeriodBounds, weightedCompletion } from './capacity-service';
import { WorkforceProfileService, WorkforceValidationError, type ScheduleDayInput } from './workforce-profile-service';
import { safeExpectedTaskCapacityMinutes, safeScheduledWorkingMinutes, shiftDurationMinutes } from './schedule-time';
import { TaskService } from '@/lib/tasks/task-service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let session: TrustedSession = null;
let companyId = '';
let foreignCompanyId = '';
let ownerId = '';
let memberId = '';
let secondMemberId = '';
let foreignUserId = '';
let employeeId = '';
let secondEmployeeId = '';
let projectId = '';
const authorization = new AuthorizationService(prisma, async () => session);
const profiles = new WorkforceProfileService(prisma);
const capacity = new CapacityService(prisma);
const tasks = new TaskService(prisma);

before(async () => {
  const company = await prisma.company.create({ data: { name: `Capacity ${suffix}` } });
  const foreign = await prisma.company.create({ data: { name: `Foreign ${suffix}` } });
  companyId = company.id; foreignCompanyId = foreign.id;
  const [owner, member, secondMember, foreignUser] = await Promise.all([
    prisma.user.create({ data: { email: `owner-${suffix}@test.dev`, displayName: 'Owner', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `member-${suffix}@test.dev`, displayName: 'Julia', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `second-${suffix}@test.dev`, displayName: 'Michael', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `foreign-${suffix}@test.dev`, displayName: 'Foreign', activeCompanyId: foreignCompanyId } }),
  ]);
  ownerId = owner.id; memberId = member.id; secondMemberId = secondMember.id; foreignUserId = foreignUser.id;
  await prisma.companyMembership.createMany({ data: [
    { userId: ownerId, companyId, role: 'OWNER' }, { userId: memberId, companyId, role: 'MEMBER' },
    { userId: secondMemberId, companyId, role: 'MEMBER' }, { userId: foreignUserId, companyId: foreignCompanyId, role: 'MEMBER' },
  ] });
  const [employee, secondEmployee] = await Promise.all([
    prisma.employee.create({ data: { companyId, firstName: 'Julia', lastName: 'Worker', timezone: 'America/Chicago' } }),
    prisma.employee.create({ data: { companyId, firstName: 'Michael', lastName: 'Worker' } }),
  ]);
  employeeId = employee.id; secondEmployeeId = secondEmployee.id;
  const project = await prisma.taskProject.create({ data: { companyId, name: `Capacity project ${suffix}`, boards: { create: { name: 'To Do', status: 'TODO' } } }, include: { boards: true } });
  projectId = project.id;
});

after(async () => {
  await prisma.taskActivity.deleteMany({ where: { projectId } });
  await prisma.taskProject.deleteMany({ where: { id: projectId } });
  await prisma.employee.deleteMany({ where: { id: { in: [employeeId, secondEmployeeId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId, secondMemberId, foreignUserId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('links and safely unlinks an active same-company user', async () => {
  session = { user: { id: ownerId } };
  const context = await authorization.requireActiveCompany();
  assert.equal((await profiles.linkUser(context, employeeId, memberId)).userId, memberId);
  assert.equal((await profiles.linkUser(context, employeeId, null)).userId, null);
});

test('rejects duplicate and foreign-company links', async () => {
  session = { user: { id: ownerId } };
  const context = await authorization.requireActiveCompany();
  await profiles.linkUser(context, employeeId, memberId);
  await assert.rejects(profiles.linkUser(context, secondEmployeeId, memberId), WorkforceValidationError);
  await assert.rejects(profiles.linkUser(context, secondEmployeeId, foreignUserId), WorkforceValidationError);
});

test('member reads only own safe profile without compensation', async () => {
  session = { user: { id: memberId } };
  const context = await authorization.requireActiveCompany();
  const profile = await profiles.getProfile(context, employeeId);
  assert.equal('salary' in profile, false);
  await assert.rejects(profiles.getProfile(context, secondEmployeeId), AuthorizationDeniedError);
});

test('schedule supports weekend and overnight shifts and validates all weekdays', async () => {
  session = { user: { id: ownerId } };
  const context = await authorization.requireActiveCompany();
  const days = Array.from({ length: 7 }, (_, weekday) => ({ weekday, isWorking: weekday === 0 || weekday === 6, startMinute: weekday === 6 ? 22 * 60 : 8 * 60, endMinute: weekday === 6 ? 6 * 60 : 17 * 60, breakMinutes: 60, capacityMinutes: 390 }));
  const saved = await profiles.replaceSchedule(context, employeeId, days);
  assert.equal(saved.length, 7); assert.equal(saved[6].startMinute, 1320); assert.equal(saved[6].endMinute, 360);
  await assert.rejects(profiles.replaceSchedule(context, employeeId, days.slice(0, 6)), WorkforceValidationError);
});

test('schedule break validation covers daytime, overnight, malformed, and non-working days', async () => {
  session = { user: { id: ownerId } };
  const context = await authorization.requireActiveCompany();
  const base: ScheduleDayInput[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, isWorking: false, startMinute: null, endMinute: null, breakMinutes: 0, capacityMinutes: 0 }));
  const withDay = (changes: Partial<ScheduleDayInput>) => base.map((day) => day.weekday === 1 ? { ...day, ...changes } : day);

  for (const breakMinutes of [0, 60, 540]) {
    await profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes }));
  }
  await assert.rejects(
    profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 541 })),
    /Break minutes cannot exceed the shift duration/,
  );

  for (const breakMinutes of [30, 480]) {
    await profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: 1320, endMinute: 360, breakMinutes }));
  }
  await assert.rejects(
    profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: 1320, endMinute: 360, breakMinutes: 481 })),
    /Break minutes cannot exceed the shift duration/,
  );
  await profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: 480, endMinute: 480, breakMinutes: 1440 }));
  await assert.rejects(profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: -1 })), WorkforceValidationError);
  await assert.rejects(profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: 1440, endMinute: 1020 })), WorkforceValidationError);
  await assert.rejects(profiles.replaceSchedule(context, employeeId, withDay({ isWorking: true, startMinute: null, endMinute: 1020 })), /Working days require start and end times/);

  const nonWorking = await profiles.replaceSchedule(context, employeeId, withDay({ isWorking: false, startMinute: null, endMinute: null, breakMinutes: 60 }));
  assert.equal(nonWorking.find(({ weekday }) => weekday === 1)?.breakMinutes, 60);
});

test('capacity helpers never emit negative schedule or task capacity', () => {
  assert.equal(shiftDurationMinutes(480, 1020), 540);
  assert.equal(shiftDurationMinutes(1320, 360), 480);
  assert.equal(shiftDurationMinutes(480, 480), 1440);
  assert.equal(safeScheduledWorkingMinutes({ isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 600 }), 0);
  assert.equal(safeScheduledWorkingMinutes({ isWorking: true, startMinute: 1320, endMinute: 360, breakMinutes: 500 }), 0);
  assert.equal(safeScheduledWorkingMinutes({ isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 540 }), 0);
  assert.equal(safeScheduledWorkingMinutes({ isWorking: false, startMinute: null, endMinute: null, breakMinutes: 1440 }), 0);
  assert.equal(safeExpectedTaskCapacityMinutes({ isWorking: true, capacityMinutes: -30 }), 0);
  assert.equal(safeExpectedTaskCapacityMinutes({ isWorking: false, capacityMinutes: 390 }), 0);
});

test('skills are company-scoped and can be replaced', async () => {
  session = { user: { id: ownerId } };
  const context = await authorization.requireActiveCompany();
  const ownSkill = await prisma.employeeSkillDefinition.create({ data: { companyId, name: `Insurance ${suffix}` } });
  const foreignSkill = await prisma.employeeSkillDefinition.create({ data: { companyId: foreignCompanyId, name: `Foreign ${suffix}` } });
  assert.equal((await profiles.setSkills(context, employeeId, [ownSkill.id])).length, 1);
  await assert.rejects(profiles.setSkills(context, employeeId, [foreignSkill.id]), WorkforceValidationError);
});

test('weighted completion uses effort rather than raw task count', () => {
  const result = weightedCompletion([{ effort: 1, status: 'DONE' }, { effort: 3, status: 'DONE' }, { effort: 5, status: 'IN_PROGRESS' }, { effort: 2, status: 'DONE' }, { effort: 100, status: 'CANCELLED' }] as never);
  assert.deepEqual(result, { completedEffort: 6, totalEffort: 11, percentage: 54.5 });
});

test('employee-local period boundaries support UTC and representative IANA zones', () => {
  const instant = new Date('2026-08-23T18:00:00Z');
  assert.equal(localPeriodBounds(instant, 'UTC').today.start.toISOString(), '2026-08-23T00:00:00.000Z');
  assert.equal(localPeriodBounds(instant, 'America/Los_Angeles').today.start.toISOString(), '2026-08-23T07:00:00.000Z');
  assert.equal(localPeriodBounds(instant, 'America/New_York').today.start.toISOString(), '2026-08-23T04:00:00.000Z');
  assert.equal(localPeriodBounds(instant, 'Europe/Berlin').today.start.toISOString(), '2026-08-22T22:00:00.000Z');
  assert.equal(localPeriodBounds(instant, 'America/Los_Angeles').thisWeek.start.toISOString(), '2026-08-17T07:00:00.000Z');
  assert.equal(localPeriodBounds(instant, 'Europe/Berlin').thisMonth.start.toISOString(), '2026-07-31T22:00:00.000Z');
});

test('timezone day boundaries are DST-safe', () => {
  const spring = localDayBounds(new Date('2026-03-08T18:00:00Z'), 'America/New_York');
  assert.equal((spring.end.getTime() - spring.start.getTime()) / 3_600_000, 23);
  assert.equal(spring.weekday, 0);
  const fall = localDayBounds(new Date('2026-11-01T18:00:00Z'), 'America/New_York');
  assert.equal((fall.end.getTime() - fall.start.getTime()) / 3_600_000, 25);
});

test('capacity reports overload, due today, overdue, and weighted progress', async () => {
  const bounds = localDayBounds(new Date('2026-08-23T18:00:00Z'), 'America/Chicago');
  await prisma.employeeScheduleDay.upsert({ where: { employeeId_weekday: { employeeId, weekday: bounds.weekday } }, update: { isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 60, capacityMinutes: 390 }, create: { employeeId, weekday: bounds.weekday, isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 60, capacityMinutes: 390 } });
  const board = await prisma.taskBoard.findFirstOrThrow({ where: { projectId } });
  await prisma.taskCard.createMany({ data: [
    { projectId, boardId: board.id, title: 'Due', assigneeUserId: memberId, effort: 3, expectedDurationMinutes: 510, dueDate: new Date(bounds.start.getTime() + 3_600_000) },
    { projectId, boardId: board.id, title: 'Overdue', assigneeUserId: memberId, effort: 2, expectedDurationMinutes: 30, dueDate: new Date(bounds.start.getTime() - 1) },
    { projectId, boardId: board.id, title: 'Done', assigneeUserId: memberId, effort: 1, expectedDurationMinutes: 15, status: 'DONE' },
  ] });
  const result = await capacity.forEmployeeDay(companyId, employeeId, new Date('2026-08-23T18:00:00Z'));
  assert.equal(result.assignedRemainingExpectedMinutes, 540); assert.equal(result.freeCapacityMinutes, -150);
  assert.equal(result.utilizationPercentage, 138.5); assert.equal(result.overloaded, true);
  assert.equal(result.dueTodayCount, 1); assert.equal(result.overdueCount, 1); assert.equal(result.weightedCompletion.percentage, 16.7);
});

test('zero capacity distinguishes nonworking availability from assigned work', async () => {
  session = { user: { id: ownerId } };
  const context = await authorization.requireActiveCompany();
  await profiles.linkUser(context, secondEmployeeId, secondMemberId);
  const when = new Date('2026-08-23T18:00:00Z');
  const bounds = localDayBounds(when, 'UTC');
  const board = await prisma.taskBoard.findFirstOrThrow({ where: { projectId } });

  const empty = await capacity.forEmployeeDay(companyId, secondEmployeeId, when);
  assert.equal(empty.expectedTaskCapacityMinutes, 0);
  assert.equal(empty.utilizationPercentage, null);
  assert.equal(empty.freeCapacityMinutes, 0);
  assert.equal(empty.overloaded, false);

  const assigned = await prisma.taskCard.create({ data: { projectId, boardId: board.id, title: 'Outside schedule', assigneeUserId: secondMemberId, expectedDurationMinutes: 120, status: 'IN_PROGRESS', blockedReason: 'WAITING_ON_VENDOR', blockedSince: when } });
  const outsideSchedule = await capacity.forEmployeeDay(companyId, secondEmployeeId, when);
  assert.equal(outsideSchedule.assignedRemainingExpectedMinutes, 120);
  assert.equal(outsideSchedule.utilizationPercentage, null);
  assert.equal(outsideSchedule.freeCapacityMinutes, -120);
  assert.equal(outsideSchedule.overloaded, true);
  assert.equal(outsideSchedule.openTaskCount, 1);

  await prisma.employeeScheduleDay.upsert({ where: { employeeId_weekday: { employeeId: secondEmployeeId, weekday: bounds.weekday } }, update: { isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 60, capacityMinutes: 0 }, create: { employeeId: secondEmployeeId, weekday: bounds.weekday, isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 60, capacityMinutes: 0 } });
  const zeroProductiveCapacity = await capacity.forEmployeeDay(companyId, secondEmployeeId, when);
  assert.equal(zeroProductiveCapacity.scheduledWorkingMinutes, 480);
  assert.equal(zeroProductiveCapacity.utilizationPercentage, null);
  assert.equal(zeroProductiveCapacity.overloaded, true);
  await prisma.taskCard.delete({ where: { id: assigned.id } });
});

test('current workload uses completed and open effort in the employee-local month', async () => {
  const board = await prisma.taskBoard.findFirstOrThrow({ where: { projectId } });
  const titles = ['Done two', 'Done three', 'Open five', 'Cancelled five'];
  await prisma.taskCard.deleteMany({ where: { projectId, title: { in: titles } } });
  await prisma.taskCard.createMany({ data: [
    { projectId, boardId: board.id, title: titles[0], assigneeUserId: secondMemberId, effort: 2, status: 'DONE', completedAt: new Date('2026-08-05T12:00:00Z') },
    { projectId, boardId: board.id, title: titles[1], assigneeUserId: secondMemberId, effort: 3, status: 'DONE', completedAt: new Date('2026-08-20T12:00:00Z') },
    { projectId, boardId: board.id, title: titles[2], assigneeUserId: secondMemberId, effort: 5, status: 'IN_PROGRESS' },
    { projectId, boardId: board.id, title: titles[3], assigneeUserId: secondMemberId, effort: 5, status: 'CANCELLED' },
  ] });
  const result = await capacity.weightedPeriods(companyId, secondEmployeeId, new Date('2026-08-23T18:00:00Z'));
  assert.deepEqual(result.currentWorkload, { completedEffort: 5, totalEffort: 10, percentage: 50 });
  assert.deepEqual(result.thisMonth, result.currentWorkload);
  await prisma.taskCard.deleteMany({ where: { projectId, title: { in: titles } } });
});

test('task planning fields persist, update, and expose blocked lifecycle timestamps', async () => {
  const board = await prisma.taskBoard.findFirstOrThrow({ where: { projectId } });
  const actor = { userId: ownerId, companyId, role: 'OWNER' as const, displayName: 'Owner' };
  const defaultCard = await tasks.createCard({ projectId, boardId: board.id, title: 'Default effort' }, actor);
  assert.equal(defaultCard.effort, 3);
  const planned = await tasks.createCard({ projectId, boardId: board.id, title: 'Planned', effort: 5, expectedDurationMinutes: 120 }, actor);
  assert.equal(planned.effort, 5); assert.equal(planned.expectedDurationMinutes, 120);
  const blocked = await tasks.updateCard({ id: planned.id, effort: 4, blockedReason: 'WAITING_ON_VENDOR', blockedNote: 'Parts' }, actor);
  assert.equal(blocked.effort, 4); assert.equal(blocked.blockedReason, 'WAITING_ON_VENDOR'); assert.ok(blocked.blockedSince);
  const cleared = await tasks.updateCard({ id: planned.id, blockedReason: null }, actor);
  assert.equal(cleared.blockedReason, null); assert.ok(cleared.blockedSince); assert.ok(cleared.blockedClearedAt);
  await prisma.taskCard.deleteMany({ where: { id: { in: [defaultCard.id, planned.id] } } });
});
