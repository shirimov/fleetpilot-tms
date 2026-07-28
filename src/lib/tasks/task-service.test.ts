import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ActivityService } from './task-activity-service';
import { prisma } from '@/lib/prisma';
import { TaskService } from './task-service';

const taskService = new TaskService();
const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let projectId: string | undefined;

after(async () => {
  if (projectId) {
    await prisma.taskActivity.deleteMany({ where: { projectId } });
    await prisma.taskProject.deleteMany({ where: { id: projectId } });
  }
  await prisma.$disconnect();
});

test('TaskService persists activity atomically and serves a stable timeline', async (t) => {
  const project = await taskService.createProject({
    name: `Activity test ${testSuffix}`,
  });
  projectId = project.id;

  const [firstBoard, secondBoard] = project.boards.sort((left, right) => {
    return left.order - right.order;
  });
  assert.ok(firstBoard);
  assert.ok(secondBoard);

  let cardId = '';

  await t.test('task creation activity', async () => {
    const card = await taskService.createCard({
      projectId: project.id,
      boardId: firstBoard.id,
      title: `Activity card ${testSuffix}`,
    });
    cardId = card.id;

    const activity = await prisma.taskActivity.findFirst({
      where: { entityType: 'TASK_CARD', entityId: card.id },
    });

    assert.equal(activity?.action, 'TASK_CREATED');
    assert.equal(activity?.cardId, card.id);
    assert.equal(activity?.entityTitle, card.title);
  });

  await t.test(
    'status, board, priority, assignee, and due-date changes',
    async () => {
      const dueDate = new Date('2030-01-15T12:00:00.000Z');
      await taskService.updateCard({
        id: cardId,
        status: 'IN_PROGRESS',
        boardId: secondBoard.id,
        priority: 'HIGH',
        assignedTo: `employee-${testSuffix}`,
        dueDate,
      });

      const activities = await prisma.taskActivity.findMany({
        where: {
          entityType: 'TASK_CARD',
          entityId: cardId,
          action: {
            in: [
              'STATUS_CHANGED',
              'BOARD_CHANGED',
              'PRIORITY_CHANGED',
              'ASSIGNEE_CHANGED',
              'DUE_DATE_CHANGED',
            ],
          },
        },
      });

      assert.deepEqual(
        new Set(activities.map((activity) => activity.action)),
        new Set([
          'STATUS_CHANGED',
          'BOARD_CHANGED',
          'PRIORITY_CHANGED',
          'ASSIGNEE_CHANGED',
          'DUE_DATE_CHANGED',
        ]),
      );
    },
  );

  await t.test('transaction rollback when activity persistence fails', async () => {
    const failingActivityService: ActivityService = {
      async record() {
        throw new Error('simulated activity failure');
      },
    };
    const failingTaskService = new TaskService(prisma, failingActivityService);
    const rollbackTitle = `Rolled back ${testSuffix}`;

    await assert.rejects(
      failingTaskService.createCard({
        projectId: project.id,
        boardId: firstBoard.id,
        title: rollbackTitle,
      }),
      /simulated activity failure/,
    );

    assert.equal(
      await prisma.taskCard.count({ where: { title: rollbackTitle } }),
      0,
    );
  });

  await t.test('newest-first ordering uses id as a tie-breaker', async () => {
    const changedActivities = await prisma.taskActivity.findMany({
      where: {
        entityType: 'TASK_CARD',
        entityId: cardId,
        action: { not: 'TASK_CREATED' },
      },
      select: { id: true },
    });
    const tiedTimestamp = new Date('2035-01-01T00:00:00.000Z');

    await prisma.taskActivity.updateMany({
      where: { id: { in: changedActivities.map(({ id }) => id) } },
      data: { occurredAt: tiedTimestamp },
    });

    const timeline = await taskService.getCardActivity(cardId);
    const expectedIds = changedActivities
      .map(({ id }) => id)
      .sort((left, right) => right.localeCompare(left));

    assert.deepEqual(
      timeline.slice(0, expectedIds.length).map(({ id }) => id),
      expectedIds,
    );
  });

  await t.test('deletion preserves activity after cardId is set null', async () => {
    await taskService.deleteCard(cardId);

    const deletionActivity = await prisma.taskActivity.findFirstOrThrow({
      where: {
        action: 'TASK_DELETED',
        entityType: 'TASK_CARD',
        entityId: cardId,
      },
    });

    assert.equal(deletionActivity.cardId, null);
    assert.equal(deletionActivity.entityId, cardId);
    assert.match(deletionActivity.entityTitle ?? '', /Activity card/);

    const deletedCardTimeline = await taskService.getCardActivity(cardId);
    assert.ok(deletedCardTimeline.length > 0);
  });
});
