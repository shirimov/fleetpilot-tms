import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { CompanyMembershipRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { TaskDeleteProtectedError, TaskNotFoundError } from './task-errors';
import { TaskService } from './task-service';
import type { TaskCompanyActor } from './task-types';
import { validateCreateTaskCardInput } from './task-validation';

const service = new TaskService();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let companyId = '';
let foreignCompanyId = '';
let projectId = '';
let boardId = '';
let foreignProjectId = '';
let foreignBoardId = '';
const users: Record<'owner' | 'creator' | 'assignee' | 'member' | 'admin' | 'adminCreator' | 'foreignCreator', string> = {
  owner: '', creator: '', assignee: '', member: '', admin: '', adminCreator: '', foreignCreator: '',
};

function actor(name: keyof typeof users, role: CompanyMembershipRole, actorCompanyId = companyId): TaskCompanyActor {
  return { userId: users[name], displayName: name, companyId: actorCompanyId, role };
}

async function createSafeCard(creator: TaskCompanyActor, assigneeUserId?: string) {
  return service.createCard({
    projectId: creator.companyId === companyId ? projectId : foreignProjectId,
    boardId: creator.companyId === companyId ? boardId : foreignBoardId,
    title: `Delete authorization ${suffix}`,
    assigneeUserId,
  }, creator);
}

before(async () => {
  const [company, foreignCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Delete auth ${suffix}` } }),
    prisma.company.create({ data: { name: `Delete auth foreign ${suffix}` } }),
  ]);
  companyId = company.id;
  foreignCompanyId = foreignCompany.id;

  for (const name of Object.keys(users) as Array<keyof typeof users>) {
    users[name] = (await prisma.user.create({
      data: { email: `${name}-${suffix}@example.test`, displayName: name, activeCompanyId: name === 'foreignCreator' ? foreignCompanyId : companyId },
    })).id;
  }
  await prisma.companyMembership.createMany({ data: [
    { userId: users.owner, companyId, role: 'OWNER' },
    { userId: users.creator, companyId, role: 'MEMBER' },
    { userId: users.assignee, companyId, role: 'MEMBER' },
    { userId: users.member, companyId, role: 'MEMBER' },
    { userId: users.admin, companyId, role: 'ADMIN' },
    { userId: users.adminCreator, companyId, role: 'ADMIN' },
    { userId: users.foreignCreator, companyId: foreignCompanyId, role: 'MEMBER' },
  ] });

  const project = await service.createProject({ name: `Delete project ${suffix}`, companyId });
  const foreignProject = await service.createProject({ name: `Foreign delete project ${suffix}`, companyId: foreignCompanyId });
  projectId = project.id;
  boardId = project.boards[0].id;
  foreignProjectId = foreignProject.id;
  foreignBoardId = foreignProject.boards[0].id;
});

after(async () => {
  await prisma.taskActivity.deleteMany({ where: { projectId: { in: [projectId, foreignProjectId] } } });
  await prisma.taskProject.deleteMany({ where: { id: { in: [projectId, foreignProjectId] } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('OWNER deletes a safe task created by another user', async () => {
  const card = await createSafeCard(actor('creator', 'MEMBER'));
  await service.deleteCard(card.id, actor('owner', 'OWNER'));
  assert.equal(await prisma.taskCard.count({ where: { id: card.id } }), 0);
  const deletion = await prisma.taskActivity.findFirstOrThrow({
    where: { entityType: 'TASK_CARD', entityId: card.id, action: 'TASK_DELETED' },
  });
  assert.equal(deletion.cardId, null);
  assert.equal(deletion.actorUserId, users.owner);
});

test('creator deletes their own safe task', async () => {
  const card = await createSafeCard(actor('creator', 'MEMBER'));
  await service.deleteCard(card.id, actor('creator', 'MEMBER'));
  assert.equal(await prisma.taskCard.count({ where: { id: card.id } }), 0);
});

test('assignee cannot delete a task created by another user', async () => {
  const card = await createSafeCard(actor('creator', 'MEMBER'), users.assignee);
  await assert.rejects(service.deleteCard(card.id, actor('assignee', 'MEMBER')), AuthorizationDeniedError);
});

test('unrelated MEMBER cannot delete another employee task', async () => {
  const card = await createSafeCard(actor('creator', 'MEMBER'));
  await assert.rejects(service.deleteCard(card.id, actor('member', 'MEMBER')), AuthorizationDeniedError);
});

test('ADMIN who did not create the task cannot permanently delete it', async () => {
  const card = await createSafeCard(actor('creator', 'MEMBER'));
  await assert.rejects(service.deleteCard(card.id, actor('admin', 'ADMIN')), AuthorizationDeniedError);
});

test('ADMIN original creator deletes their own safe task', async () => {
  const card = await createSafeCard(actor('adminCreator', 'ADMIN'));
  await service.deleteCard(card.id, actor('adminCreator', 'ADMIN'));
  assert.equal(await prisma.taskCard.count({ where: { id: card.id } }), 0);
});

test('cross-company creator cannot delete', async () => {
  const card = await createSafeCard(actor('creator', 'MEMBER'));
  await assert.rejects(
    service.deleteCard(card.id, actor('foreignCreator', 'MEMBER', foreignCompanyId)),
    TaskNotFoundError,
  );
});

test('spoofed client createdByUserId is ignored in favor of server actor', async () => {
  const input = validateCreateTaskCardInput({ projectId, boardId, title: 'Spoof attempt', createdByUserId: users.admin });
  assert.equal(Object.hasOwn(input, 'createdByUserId'), false);
  const card = await service.createCard(input, actor('creator', 'MEMBER'));
  const stored = await prisma.taskCard.findUniqueOrThrow({ where: { id: card.id }, select: { createdByUserId: true } });
  assert.equal(stored.createdByUserId, users.creator);
  await assert.rejects(service.deleteCard(card.id, actor('admin', 'ADMIN')), AuthorizationDeniedError);
});

test('creator cannot delete a protected history-bearing task', async () => {
  const creator = actor('creator', 'MEMBER');
  const card = await createSafeCard(creator);
  await service.updateCard({ id: card.id, priority: 'HIGH' }, creator);
  await assert.rejects(service.deleteCard(card.id, creator), TaskDeleteProtectedError);
  assert.equal(await prisma.taskCard.count({ where: { id: card.id } }), 1);
});

test('legacy creator-null safe task is OWNER-only', async () => {
  const card = await prisma.taskCard.create({
    data: { projectId, boardId, title: `Legacy creator-null ${suffix}` },
  });
  await assert.rejects(service.deleteCard(card.id, actor('creator', 'MEMBER')), AuthorizationDeniedError);
  await service.deleteCard(card.id, actor('owner', 'OWNER'));
  assert.equal(await prisma.taskCard.count({ where: { id: card.id } }), 0);
});

test('current collaboration and Telegram dependencies each protect permanent deletion', async (t) => {
  const creator = actor('creator', 'MEMBER');
  const cases: Array<[string, (cardId: string) => Promise<unknown>]> = [
    ['label', (cardId) => prisma.taskLabel.create({ data: { cardId, name: 'Protected' } })],
    ['comment', (cardId) => prisma.taskComment.create({ data: { cardId, author: 'Creator', authorUserId: users.creator, content: 'History' } })],
    ['checklist', (cardId) => prisma.taskChecklistItem.create({ data: { cardId, content: 'History', createdByUserId: users.creator } })],
    ['attachment', (cardId) => prisma.taskAttachment.create({ data: { cardId, name: 'proof.pdf', url: '/private/proof.pdf', uploadedBy: 'Creator', uploaderUserId: users.creator } })],
    ['mention', (cardId) => prisma.taskMention.create({ data: { cardId, mentionedUserId: users.member, mentionedDisplayName: 'member', sourceType: 'DESCRIPTION', createdByUserId: users.creator } })],
    ['Telegram delivery history', (cardId) => prisma.telegramDelivery.create({ data: { companyId, userId: users.creator, taskCardId: cardId, type: 'COMMAND_RESPONSE', telegramChatId: BigInt(1001), payload: {} } })],
    ['pending Telegram action', (cardId) => prisma.telegramPendingAction.create({ data: { companyId, userId: users.creator, taskCardId: cardId, telegramChatId: BigInt(1002), type: 'OPEN_TASK', expiresAt: new Date('2035-01-01') } })],
    ['Request Update history', (cardId) => prisma.telegramUpdateRequest.create({ data: { companyId, taskCardId: cardId, requestedByUserId: users.creator, assigneeUserId: users.assignee, expiresAt: new Date('2035-01-01') } })],
  ];

  for (const [name, addDependency] of cases) {
    await t.test(name, async () => {
      const card = await createSafeCard(creator);
      await addDependency(card.id);
      const policy = await service.getCardDeletePolicy(card.id, creator);
      assert.deepEqual(policy, {
        canPermanentlyDelete: true,
        isProtected: true,
        explanation: 'This task has activity or collaboration history and cannot be permanently deleted.',
      });
      await assert.rejects(service.deleteCard(card.id, creator), TaskDeleteProtectedError);
    });
  }
});
