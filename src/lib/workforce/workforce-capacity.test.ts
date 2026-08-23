import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { AuthorizationService, type TrustedSession } from '@/lib/auth/authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { CapacityService, localDayBounds, weightedCompletion } from './capacity-service';
import { WorkforceProfileService, WorkforceValidationError } from './workforce-profile-service';
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

test('skills are company-scoped and can be replaced', async () => {
  session = { user: { id: ownerId } };
  const context = await authorization.requireActiveCompany();
  const ownSkill = await prisma.employeeSkillDefinition.create({ data: { companyId, name: `Insurance ${suffix}` } });
  const foreignSkill = await prisma.employeeSkillDefinition.create({ data: { companyId: foreignCompanyId, name: `Foreign ${suffix}` } });
  assert.equal((await profiles.setSkills(context, employeeId, [ownSkill.id])).length, 1);
  await assert.rejects(profiles.setSkills(context, employeeId, [foreignSkill.id]), WorkforceValidationError);
});

test('weighted completion uses effort rather than raw task count', () => {
  const result = weightedCompletion([{ effort: 1, status: 'DONE' }, { effort: 3, status: 'DONE' }, { effort: 5, status: 'IN_PROGRESS' }, { effort: 2, status: 'DONE' }] as never);
  assert.deepEqual(result, { completedEffort: 6, totalEffort: 11, percentage: 54.5 });
});

test('timezone day boundaries handle DST and remain ordered', () => {
  const spring = localDayBounds(new Date('2026-03-08T18:00:00Z'), 'America/Chicago');
  assert.equal((spring.end.getTime() - spring.start.getTime()) / 3_600_000, 23);
  assert.equal(spring.weekday, 0);
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
  assert.equal(result.dueTodayCount, 1); assert.equal(result.overdueCount, 1); assert.equal(result.weightedCompletion.percentage, 16.7);
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
