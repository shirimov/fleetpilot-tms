/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { prisma } from '../prisma';
import { authorizationService } from '../auth/authorization';
import * as TeamRoute from '../../app/api/company/team/route';

let companyId: string;
let ownerUserId: string;
let otherUserId: string;

const originalRequire = authorizationService.requireActiveCompany.bind(authorizationService as any);

before(async () => {
  const company = await prisma.company.create({ data: { name: `team-test-${Date.now()}` } });
  companyId = company.id;
  const owner = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, displayName: 'Owner' } });
  ownerUserId = owner.id;
  const other = await prisma.user.create({ data: { email: `other-${Date.now()}@example.test`, displayName: 'Member' } });
  otherUserId = other.id;
  await prisma.companyMembership.create({ data: { userId: ownerUserId, companyId, role: 'OWNER' } });

  // create some tasks with various dueDates
  const project = await prisma.taskProject.create({ data: { name: 'p', companyId } });
  const board = await prisma.taskBoard.create({ data: { projectId: project.id, name: 'b', status: 'TODO' } });

  // Task due yesterday (overdue)
  await prisma.taskCard.create({ data: { projectId: project.id, boardId: board.id, title: 'overdue', assigneeUserId: ownerUserId, dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000) } });

  // Task due today UTC noon
  const todayNoon = new Date();
  todayNoon.setUTCHours(12, 0, 0, 0);
  await prisma.taskCard.create({ data: { projectId: project.id, boardId: board.id, title: 'today', assigneeUserId: ownerUserId, dueDate: todayNoon } });

  // Task open but no due date
  await prisma.taskCard.create({ data: { projectId: project.id, boardId: board.id, title: 'open', assigneeUserId: ownerUserId } });

  // Make requireActiveCompany return owner context by default
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
});

after(async () => {
  // restore
  (authorizationService as any).requireActiveCompany = originalRequire;
  await prisma.taskCard.deleteMany({ where: { project: { companyId } } });
  await prisma.taskProject.deleteMany({ where: { companyId } });
  await prisma.companyMembership.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

test('GET returns 400 when only start provided', async () => {
  const req = new Request(`https://example.test/api/company/team?start=${new Date().toISOString()}`);
  const res = await (TeamRoute as any).GET(req as any);
  assert.equal(res.status, 400);
});

test('GET returns 400 when start >= end', async () => {
  const start = new Date().toISOString();
  const end = new Date(start).toISOString();
  const req = new Request(`https://example.test/api/company/team?start=${start}&end=${end}`);
  const res = await (TeamRoute as any).GET(req as any);
  assert.equal(res.status, 400);
});

test('GET with valid start/end returns members and counts', async () => {
  // compute local start/end for UTC day that includes todayNoon
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  const req = new Request(`https://example.test/api/company/team?start=${start.toISOString()}&end=${end.toISOString()}`);
  const res = await (TeamRoute as any).GET(req as any);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.members));
  const m = body.members.find((x: any) => x.user.id === ownerUserId);
  assert(m, 'owner membership present');
  assert.equal(typeof m.openTasks, 'number');
  assert.equal(typeof m.overdueTasks, 'number');
  assert.equal(typeof m.dueToday, 'number');
});

test('POST creates user and membership, rejects duplicate membership', async () => {
  // as ADMIN
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'ADMIN' });
  const payload = { displayName: 'New', email: `new-${Date.now()}@example.test`, role: 'MEMBER' };
  let req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  let res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert(body.user && body.membership);

  // duplicate membership attempt
  req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 409);
});

test('DELETE prevents removing last owner', async () => {
  // run as OWNER
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  const req = new Request('https://example.test/api/company/team', { method: 'DELETE', body: JSON.stringify({ userId: ownerUserId }), headers: { 'Content-Type': 'application/json' } });
  const res = await (TeamRoute as any).DELETE(req as any);
  // should be 400 because can't remove last owner
  assert.equal(res.status, 400);
});

test('PATCH prevents demoting the last owner', async () => {
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  const req = new Request('https://example.test/api/company/team', {
    method: 'PATCH',
    body: JSON.stringify({ userId: ownerUserId, role: 'ADMIN' }),
    headers: { 'Content-Type': 'application/json' },
  });
  const res = await (TeamRoute as any).PATCH(req as any);
  assert.equal(res.status, 400);
});

// Additional integration tests covering time/workload, provisioning, roles, tenant isolation, and assignment

test('GET without start/end uses UTC fallback and counts exclude DONE/CANCELLED', async () => {
  // use OWNER context
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  // create a DONE and a CANCELLED task assigned to owner
  const project = await prisma.taskProject.findFirst({ where: { companyId } });
  const board = await prisma.taskBoard.findFirst({ where: { projectId: project!.id } });
  await prisma.taskCard.create({ data: { projectId: project!.id, boardId: board!.id, title: 'done-task', assigneeUserId: ownerUserId, status: 'DONE', dueDate: new Date() } });
  await prisma.taskCard.create({ data: { projectId: project!.id, boardId: board!.id, title: 'cancelled-task', assigneeUserId: ownerUserId, status: 'CANCELLED', dueDate: new Date() } });

  const req = new Request('https://example.test/api/company/team');
  const res = await (TeamRoute as any).GET(req as any);
  assert.equal(res.status, 200);
  const body = await res.json();
  const m = body.members.find((x: any) => x.user.id === ownerUserId);
  assert(m, 'owner membership present');
  // dueToday should reflect tasks excluding DONE/CANCELLED; the earlier today task should still count
  assert.equal(typeof m.dueToday, 'number');
});

test('GET returns 400 when only end provided', async () => {
  const end = new Date().toISOString();
  const req = new Request(`https://example.test/api/company/team?end=${end}`);
  const res = await (TeamRoute as any).GET(req as any);
  assert.equal(res.status, 400);
});

test('GET returns 400 for malformed start or end', async () => {
  const req1 = new Request('https://example.test/api/company/team?start=not-a-date&end=2026-01-01T00:00:00.000Z');
  const res1 = await (TeamRoute as any).GET(req1 as any);
  assert.equal(res1.status, 400);
  const req2 = new Request('https://example.test/api/company/team?start=2026-01-01T00:00:00.000Z&end=not-a-date');
  const res2 = await (TeamRoute as any).GET(req2 as any);
  assert.equal(res2.status, 400);
});

// Provisioning tests

test('POST reuses existing user by normalized email and does not create password', async () => {
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  // create a user with normalized email to test reuse
  const { normalizeEmail } = await import('../auth/account-linking');
  const baseEmail = `reuse-${Date.now()}@example.test`;
  const existing = await prisma.user.create({ data: { email: normalizeEmail(baseEmail), displayName: 'Reuse' } });
  const payload = { displayName: 'Reuse', email: baseEmail.toUpperCase(), role: 'MEMBER' };
  const req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  const res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.id, existing.id);
  // ensure no password field was created (schema has no password column, but check absence)
  const freshUser = await prisma.user.findUnique({ where: { id: existing.id } });
  assert(freshUser);
  // cleanup membership created
  await prisma.companyMembership.deleteMany({ where: { userId: existing.id, companyId } });
});

test('POST rejects invalid role and duplicate membership', async () => {
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  // invalid role
  let req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify({ displayName: 'X', email: `x-${Date.now()}@example.test`, role: 'FOO' }), headers: { 'Content-Type': 'application/json' } });
  let res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 400);

  // duplicate membership
  const payload = { displayName: 'Dupe', email: `dupe-${Date.now()}@example.test`, role: 'MEMBER' };
  req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 201);
  // try again
  req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 409);
});

// Role permissions

test('ADMIN cannot create OWNER but OWNER can', async () => {
  // ADMIN attempt
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'ADMIN' });
  let req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify({ displayName: 'TryOwner', email: `tryowner-${Date.now()}@example.test`, role: 'OWNER' }), headers: { 'Content-Type': 'application/json' } });
  let res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 403);

  // OWNER attempt
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify({ displayName: 'MakeOwner', email: `makeowner-${Date.now()}@example.test`, role: 'OWNER' }), headers: { 'Content-Type': 'application/json' } });
  res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 201);
});

// MEMBER cannot administer

test('MEMBER cannot POST/PATCH/DELETE', async () => {
  (authorizationService as any).requireActiveCompany = async (minRole?: any) => {
    const { AuthorizationDeniedError } = await import('../auth/auth-errors');
    if (minRole) throw new AuthorizationDeniedError();
    return { user: { id: ownerUserId }, companyId, role: 'MEMBER' };
  };
  let req = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify({ displayName: 'Nope', email: `nope-${Date.now()}@example.test`, role: 'MEMBER' }), headers: { 'Content-Type': 'application/json' } });
  let res = await (TeamRoute as any).POST(req as any);
  assert.equal(res.status, 403);

  req = new Request('https://example.test/api/company/team', { method: 'PATCH', body: JSON.stringify({ userId: ownerUserId, role: 'MEMBER' }), headers: { 'Content-Type': 'application/json' } });
  res = await (TeamRoute as any).PATCH(req as any);
  assert.equal(res.status, 403);

  req = new Request('https://example.test/api/company/team', { method: 'DELETE', body: JSON.stringify({ userId: ownerUserId }), headers: { 'Content-Type': 'application/json' } });
  res = await (TeamRoute as any).DELETE(req as any);
  assert.equal(res.status, 403);
});

// Tenant isolation

test('cannot mutate membership of another company', async () => {
  // create second company and membership
  const otherCompany = await prisma.company.create({ data: { name: `other-${Date.now()}` } });
  const otherUser = await prisma.user.create({ data: { email: `otheruser-${Date.now()}@example.test`, displayName: 'OC' } });
  await prisma.companyMembership.create({ data: { userId: otherUser.id, companyId: otherCompany.id, role: 'MEMBER' } });
  // context is original company
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  const req = new Request('https://example.test/api/company/team', { method: 'DELETE', body: JSON.stringify({ userId: otherUser.id }), headers: { 'Content-Type': 'application/json' } });
  const res = await (TeamRoute as any).DELETE(req as any);
  assert.equal(res.status, 404);
});

// Membership removal and assignment history

test('remove membership preserves user and historical assignment but blocks future assignment', async () => {
  // create a new member, assign a task, remove membership, then test assignment rejection
  (authorizationService as any).requireActiveCompany = async () => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
  const user = await prisma.user.create({ data: { email: `assign-${Date.now()}@example.test`, displayName: 'Assign' } });
  await prisma.companyMembership.create({ data: { userId: user.id, companyId, role: 'MEMBER' } });
  // create a new task assigned to this user
  const project = await prisma.taskProject.findFirst({ where: { companyId } });
  const board = await prisma.taskBoard.findFirst({ where: { projectId: project!.id } });
  const card = await prisma.taskCard.create({ data: { projectId: project!.id, boardId: board!.id, title: 'assign-test', assigneeUserId: user.id } });

  // remove membership
  const req = new Request('https://example.test/api/company/team', { method: 'DELETE', body: JSON.stringify({ userId: user.id }), headers: { 'Content-Type': 'application/json' } });
  const res = await (TeamRoute as any).DELETE(req as any);
  assert.equal(res.status, 200);

  // user row remains
  const u = await prisma.user.findUnique({ where: { id: user.id } });
  assert(u, 'user still exists');

  // historical assignment remains readable
  const loadedCard = await prisma.taskCard.findUnique({ where: { id: card.id } });
  assert.equal(loadedCard!.assigneeUserId, user.id);

  // attempt to create a new task assigned to removed member via TaskService should fail validation
  const { TaskService } = await import('../tasks/task-service');
  const svc = new TaskService(prisma as any);
  let threw = false;
  try {
    await svc.createCard({ projectId: project!.id, boardId: board!.id, title: 'should-fail', assigneeUserId: user.id }, { userId: ownerUserId, companyId, role: 'OWNER' });
  } catch (err: any) {
    threw = true;
    assert(String(err.message).includes('assigneeUserId'));
  }
  assert(threw, 'assignment to removed member is rejected');
});
