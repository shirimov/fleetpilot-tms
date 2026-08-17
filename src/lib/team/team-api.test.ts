import 'dotenv/config';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { authorizationService } from '@/lib/auth/authorization';
import * as TeamRoute from '@/app/api/company/team/route';

let companyId: string;
let ownerUserId: string;
let ownerMembershipId: string;
let otherUserId: string;

const originalRequire = authorizationService.requireActiveCompany.bind(authorizationService as any);

before(async () => {
  const company = await prisma.company.create({ data: { name: `team-test-${Date.now()}` } });
  companyId = company.id;
  const owner = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, displayName: 'Owner' } });
  ownerUserId = owner.id;
  const other = await prisma.user.create({ data: { email: `other-${Date.now()}@example.test`, displayName: 'Member' } });
  otherUserId = other.id;
  const m = await prisma.companyMembership.create({ data: { userId: ownerUserId, companyId, role: 'OWNER' } });
  ownerMembershipId = m.id;

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
  (authorizationService as any).requireActiveCompany = async (_minRole?: any) => ({ user: { id: ownerUserId }, companyId, role: 'OWNER' });
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
  (authorizationService as any).requireActiveCompany = async (_minRole?: any) => ({ user: { id: ownerUserId }, companyId, role: 'ADMIN' });
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
  // ensure only one owner exists
  const req = new Request('https://example.test/api/company/team', { method: 'DELETE', body: JSON.stringify({ userId: ownerUserId }), headers: { 'Content-Type': 'application/json' } });
  const res = await (TeamRoute as any).DELETE(req as any);
  // should be 400 because can't remove last owner
  assert.equal(res.status, 400);
});
