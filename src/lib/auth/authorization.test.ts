import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
} from './auth-errors';
import { AuthorizationService, type TrustedSession } from './authorization';
import { TaskAuthorizationService } from '@/lib/tasks/task-authorization';
import { TaskProjectNotFoundError } from '@/lib/tasks/task-errors';
import { TaskService } from '@/lib/tasks/task-service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let activeSession: TrustedSession = null;
let userId = '';
let inactiveUserId = '';
let firstCompanyId = '';
let secondCompanyId = '';
let firstProjectId = '';
let secondProjectId = '';
let legacyCardId = '';

const authorization = new AuthorizationService(prisma, async () => activeSession);
const taskAuthorization = new TaskAuthorizationService(prisma, authorization);

before(async () => {
  const [firstCompany, secondCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Auth first ${suffix}` } }),
    prisma.company.create({ data: { name: `Auth second ${suffix}` } }),
  ]);
  firstCompanyId = firstCompany.id;
  secondCompanyId = secondCompany.id;

  const [user, inactiveUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: `auth-${suffix}@example.test`,
        displayName: 'Authorized user',
      },
    }),
    prisma.user.create({
      data: {
        email: `inactive-${suffix}@example.test`,
        displayName: 'Inactive user',
        isActive: false,
      },
    }),
  ]);
  userId = user.id;
  inactiveUserId = inactiveUser.id;

  await prisma.companyMembership.createMany({
    data: [
      {
        id: `membership-first-${suffix}`,
        userId,
        companyId: firstCompanyId,
        role: 'MEMBER',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: `membership-second-${suffix}`,
        userId,
        companyId: secondCompanyId,
        role: 'ADMIN',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ],
  });

  const [firstProject, secondProject] = await Promise.all([
    prisma.taskProject.create({
      data: { name: `First project ${suffix}`, companyId: firstCompanyId },
    }),
    prisma.taskProject.create({
      data: { name: `Second project ${suffix}`, companyId: secondCompanyId },
    }),
  ]);
  firstProjectId = firstProject.id;
  secondProjectId = secondProject.id;

  const legacyBoard = await prisma.taskBoard.create({
    data: {
      projectId: firstProjectId,
      name: `Legacy board ${suffix}`,
      status: 'TODO',
    },
  });
  const legacyCard = await prisma.taskCard.create({
    data: {
      projectId: firstProjectId,
      boardId: legacyBoard.id,
      title: `Legacy task ${suffix}`,
      comments: {
        create: {
          author: 'Legacy dispatcher',
          content: 'Preserve this unverified author.',
        },
      },
    },
  });
  legacyCardId = legacyCard.id;
  await prisma.taskActivity.create({
    data: {
      projectId: firstProjectId,
      cardId: legacyCardId,
      entityType: 'TASK_CARD',
      entityId: legacyCardId,
      entityTitle: legacyCard.title,
      action: 'TASK_CREATED',
      actorId: 'legacy-actor',
    },
  });
});

after(async () => {
  await prisma.taskActivity.deleteMany({
    where: { projectId: { in: [firstProjectId, secondProjectId] } },
  });
  await prisma.taskProject.deleteMany({
    where: { id: { in: [firstProjectId, secondProjectId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, inactiveUserId] } },
  });
  await prisma.company.deleteMany({
    where: { id: { in: [firstCompanyId, secondCompanyId] } },
  });
  await prisma.$disconnect();
});

test('rejects unauthenticated and inactive sessions', async () => {
  activeSession = null;
  await assert.rejects(
    authorization.requireUser(),
    AuthenticationRequiredError,
  );

  activeSession = { user: { id: inactiveUserId } };
  await assert.rejects(
    authorization.requireUser(),
    AuthenticationRequiredError,
  );
});

test('selects a deterministic active company and enforces minimum roles', async () => {
  activeSession = { user: { id: userId } };
  const defaultContext = await authorization.requireActiveCompany();
  assert.equal(defaultContext.companyId, firstCompanyId);
  assert.equal(defaultContext.role, 'MEMBER');

  await assert.rejects(
    authorization.requireActiveCompany('ADMIN'),
    AuthorizationDeniedError,
  );
  const adminContext = await authorization.requireCompanyMembership(
    secondCompanyId,
    'ADMIN',
  );
  assert.equal(adminContext.role, 'ADMIN');
  await assert.rejects(
    authorization.requireCompanyMembership('not-a-membership'),
    AuthorizationDeniedError,
  );
});

test('preserves legacy task author and actor display values without attribution', async () => {
  const [comment, activity] = await Promise.all([
    prisma.taskComment.findFirstOrThrow({ where: { cardId: legacyCardId } }),
    prisma.taskActivity.findFirstOrThrow({
      where: { entityId: legacyCardId },
    }),
  ]);
  assert.equal(comment.author, 'Legacy dispatcher');
  assert.equal(comment.authorUserId, null);
  assert.equal(activity.actorId, 'legacy-actor');
  assert.equal(activity.actorUserId, null);
});

test('records authenticated task mutation actors from trusted context', async () => {
  await new TaskService().updateCard(
    { id: legacyCardId, priority: 'HIGH' },
    { userId },
  );
  const activity = await prisma.taskActivity.findFirstOrThrow({
    where: {
      entityId: legacyCardId,
      action: 'PRIORITY_CHANGED',
    },
  });
  assert.equal(activity.actorType, 'USER');
  assert.equal(activity.actorUserId, userId);
});

test('does not trust custom identity headers or caller-provided tenant identity', async () => {
  activeSession = null;
  const spoofedRequest = new Request('http://local.test/api/tasks', {
    headers: {
      'x-user-id': userId,
      'x-company-id': firstCompanyId,
      'x-employee-id': 'spoofed',
      'x-actor-id': 'spoofed',
    },
  });
  assert.ok(spoofedRequest.headers.get('x-user-id'));
  await assert.rejects(
    authorization.requireActiveCompany(),
    AuthenticationRequiredError,
  );
});

test('hides wrong-company task records without revealing their existence', async () => {
  activeSession = { user: { id: userId } };
  await prisma.user.update({
    where: { id: userId },
    data: { activeCompanyId: firstCompanyId },
  });

  assert.equal(
    (await taskAuthorization.requireProject(firstProjectId)).companyId,
    firstCompanyId,
  );
  await assert.rejects(
    taskAuthorization.requireProject(secondProjectId),
    TaskProjectNotFoundError,
  );
});
