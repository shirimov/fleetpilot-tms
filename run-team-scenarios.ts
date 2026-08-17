import { prisma } from '@/lib/prisma';
import { authorizationService } from '@/lib/auth/authorization';
import * as TeamRoute from '@/app/api/company/team/route';

async function setup() {
  const company = await prisma.company.create({ data: { name: `scenario-${Date.now()}` } });
  const owner = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, displayName: 'Owner' } });
  const other = await prisma.user.create({ data: { email: `other-${Date.now()}@example.test`, displayName: 'Other' } });
  await prisma.companyMembership.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
  // project/board/cards
  const project = await prisma.taskProject.create({ data: { name: 'proj', companyId: company.id } });
  const board = await prisma.taskBoard.create({ data: { projectId: project.id, name: 'b', status: 'TODO' } });
  await prisma.taskCard.create({ data: { projectId: project.id, boardId: board.id, title: 'overdue', assigneeUserId: owner.id, dueDate: new Date(Date.now() - 24*60*60*1000) } });
  const todayNoon = new Date(); todayNoon.setUTCHours(12,0,0,0);
  await prisma.taskCard.create({ data: { projectId: project.id, boardId: board.id, title: 'today', assigneeUserId: owner.id, dueDate: todayNoon } });
  await prisma.taskCard.create({ data: { projectId: project.id, boardId: board.id, title: 'open', assigneeUserId: owner.id } });
  return { companyId: company.id, ownerId: owner.id, otherId: other.id };
}

async function run() {
  const ctx = await setup();
  const companyId = ctx.companyId;
  const ownerId = ctx.ownerId;
  console.log('setup company', companyId, 'owner', ownerId);

  (authorizationService as any).requireActiveCompany = async (_minRole?: any) => ({ user: { id: ownerId }, companyId, role: 'OWNER' });

  // only start
  const startOnly = new Request(`https://example.test/api/company/team?start=${new Date().toISOString()}`);
  const r1 = await (TeamRoute as any).GET(startOnly as any);
  console.log('only start ->', r1.status, await safeJson(r1));

  // start >= end
  const s = new Date().toISOString();
  const e = new Date(s).toISOString();
  const r2 = await (TeamRoute as any).GET(new Request(`https://example.test/api/company/team?start=${s}&end=${e}`) as any);
  console.log('start>=end ->', r2.status, await safeJson(r2));

  // valid start/end
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start); end.setUTCDate(start.getUTCDate()+1);
  const r3 = await (TeamRoute as any).GET(new Request(`https://example.test/api/company/team?start=${start.toISOString()}&end=${end.toISOString()}`) as any);
  console.log('valid start/end ->', r3.status, await safeJson(r3));

  // POST create user
  const payload = { displayName: 'New', email: `new-${Date.now()}@example.test`, role: 'MEMBER' };
  const r4 = await (TeamRoute as any).POST(new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }) as any);
  console.log('POST create ->', r4.status, await safeJson(r4));

  // duplicate membership
  const r5 = await (TeamRoute as any).POST(new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }) as any);
  console.log('POST duplicate ->', r5.status, await safeJson(r5));

  // DELETE last owner
  const r6 = await (TeamRoute as any).DELETE(new Request('https://example.test/api/company/team', { method: 'DELETE', body: JSON.stringify({ userId: ownerId }), headers: { 'Content-Type': 'application/json' } }) as any);
  console.log('DELETE last owner ->', r6.status, await safeJson(r6));

  // cleanup
  await prisma.taskCard.deleteMany({ where: { project: { companyId } } });
  await prisma.taskProject.deleteMany({ where: { companyId } });
  await prisma.companyMembership.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, ctx.otherId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
}

async function safeJson(res: any) {
  try { return await res.json(); } catch(e) { return { noJson: true }; }
}

run().catch(err=>{ console.error('run error', err); process.exit(1); });
