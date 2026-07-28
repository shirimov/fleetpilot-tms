import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { ActivityService } from './task-activity-service';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { prisma } from '@/lib/prisma';
import { TaskNotFoundError } from './task-errors';
import { TaskService } from './task-service';
import type { TaskCompanyActor } from './task-types';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const service = new TaskService();
let companyId = '';
let otherCompanyId = '';
let userId = '';
let otherUserId = '';
let cardId = '';
let foreignCardId = '';
let actor: TaskCompanyActor;
let otherActor: TaskCompanyActor;

before(async () => {
  const [company, otherCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Collaboration ${suffix}` } }),
    prisma.company.create({ data: { name: `Foreign collaboration ${suffix}` } }),
  ]);
  companyId = company.id;
  otherCompanyId = otherCompany.id;
  const [user, otherUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: `collaboration-${suffix}@example.test`,
        displayName: 'Task author',
      },
    }),
    prisma.user.create({
      data: {
        email: `other-collaboration-${suffix}@example.test`,
        displayName: 'Other member',
      },
    }),
  ]);
  userId = user.id;
  otherUserId = otherUser.id;
  actor = {
    userId,
    companyId,
    displayName: user.displayName,
    role: 'MEMBER',
  };
  otherActor = {
    userId: otherUserId,
    companyId,
    displayName: otherUser.displayName,
    role: 'MEMBER',
  };

  const [project, foreignProject] = await Promise.all([
    service.createProject({ name: `Project ${suffix}`, companyId }),
    service.createProject({
      name: `Foreign project ${suffix}`,
      companyId: otherCompanyId,
    }),
  ]);
  cardId = (
    await service.createCard({
      projectId: project.id,
      boardId: project.boards[0].id,
      title: `Task ${suffix}`,
    })
  ).id;
  foreignCardId = (
    await service.createCard({
      projectId: foreignProject.id,
      boardId: foreignProject.boards[0].id,
      title: `Foreign task ${suffix}`,
    })
  ).id;
});

after(async () => {
  await prisma.taskActivity.deleteMany({
    where: { project: { companyId: { in: [companyId, otherCompanyId] } } },
  });
  await prisma.taskProject.deleteMany({
    where: { companyId: { in: [companyId, otherCompanyId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.company.deleteMany({
    where: { id: { in: [companyId, otherCompanyId] } },
  });
  await prisma.$disconnect();
});

test('checklist CRUD preserves deterministic ordering and progress', async () => {
  const first = await service.createChecklistItem(
    { cardId, content: 'Inspect tires' },
    actor,
  );
  const second = await service.createChecklistItem(
    { cardId, content: 'Record mileage' },
    actor,
  );
  const completed = await service.updateChecklistItem(
    { cardId, itemId: second.id, isCompleted: true },
    actor,
  );
  assert.equal(completed.isCompleted, true);

  const reordered = await service.reorderChecklist(
    { cardId, itemIds: [second.id, first.id] },
    actor,
  );
  assert.deepEqual(
    reordered.map(({ id, order }) => [id, order]),
    [
      [second.id, 0],
      [first.id, 1],
    ],
  );

  await service.deleteChecklistItem(cardId, second.id, actor);
  const remaining = await service.getChecklist(cardId, companyId);
  assert.deepEqual(
    remaining.map(({ id, order, isCompleted }) => [id, order, isCompleted]),
    [[first.id, 0, false]],
  );

  const actions = await prisma.taskActivity.findMany({
    where: {
      entityId: cardId,
      action: {
        in: [
          'CHECKLIST_ITEM_CREATED',
          'CHECKLIST_ITEM_COMPLETED',
          'CHECKLIST_ITEM_REORDERED',
          'CHECKLIST_ITEM_DELETED',
        ],
      },
    },
    select: { action: true, actorUserId: true },
  });
  assert.ok(actions.every(({ actorUserId }) => actorUserId === userId));
  assert.deepEqual(
    new Set(actions.map(({ action }) => action)),
    new Set([
      'CHECKLIST_ITEM_CREATED',
      'CHECKLIST_ITEM_COMPLETED',
      'CHECKLIST_ITEM_REORDERED',
      'CHECKLIST_ITEM_DELETED',
    ]),
  );
});

test('comments use verified authors and enforce edit and delete permissions', async () => {
  const comment = await service.createComment(
    { cardId, content: 'Ready for review.' },
    actor,
  );
  assert.equal(comment.authorUserId, userId);
  assert.equal(comment.author, actor.displayName);

  await assert.rejects(
    service.updateComment(
      { cardId, commentId: comment.id, content: 'Spoofed edit' },
      otherActor,
    ),
    AuthorizationDeniedError,
  );
  const edited = await service.updateComment(
    { cardId, commentId: comment.id, content: 'Review completed.' },
    actor,
  );
  assert.equal(edited.content, 'Review completed.');

  const legacy = await prisma.taskComment.create({
    data: {
      cardId,
      author: 'Legacy dispatcher',
      content: 'Historical note',
    },
  });
  const thread = await service.getComments(cardId, actor);
  assert.equal(
    thread.find(({ id }) => id === legacy.id)?.authorUserId,
    null,
  );
  assert.equal(thread.find(({ id }) => id === legacy.id)?.canEdit, false);

  await service.deleteComment(cardId, comment.id, actor);
  const activityActions = await prisma.taskActivity.findMany({
    where: {
      entityId: cardId,
      action: { in: ['COMMENT_ADDED', 'COMMENT_EDITED', 'COMMENT_DELETED'] },
    },
    select: { action: true },
  });
  assert.deepEqual(
    new Set(activityActions.map(({ action }) => action)),
    new Set(['COMMENT_ADDED', 'COMMENT_EDITED', 'COMMENT_DELETED']),
  );
});

test('collaboration methods hide foreign-company cards', async () => {
  await assert.rejects(
    service.getChecklist(foreignCardId, companyId),
    TaskNotFoundError,
  );
  await assert.rejects(
    service.createComment(
      { cardId: foreignCardId, content: 'Cross-company write' },
      actor,
    ),
    TaskNotFoundError,
  );
  assert.equal(
    await prisma.taskComment.count({
      where: { cardId: foreignCardId, content: 'Cross-company write' },
    }),
    0,
  );
});

test('activity failure rolls checklist mutations back atomically', async () => {
  const failingActivity: ActivityService = {
    async record() {
      throw new Error('activity unavailable');
    },
  };
  const failingService = new TaskService(prisma, failingActivity);
  await assert.rejects(
    failingService.createChecklistItem(
      { cardId, content: 'Must roll back' },
      actor,
    ),
    /activity unavailable/,
  );
  assert.equal(
    await prisma.taskChecklistItem.count({
      where: { cardId, content: 'Must roll back' },
    }),
    0,
  );
});
