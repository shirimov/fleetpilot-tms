import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { POST as moveCardRoute } from '@/app/api/tasks/cards/[id]/move/route';
import { GET as projectBoardRoute } from '@/app/api/tasks/projects/[id]/board/route';
import { prisma } from '@/lib/prisma';
import type { ActivityService } from './task-activity-service';
import {
  InvalidTaskDestinationIndexError,
  TaskBoardProjectMismatchError,
  TaskBoardStatusUnmappedError,
  TaskMoveConflictError,
} from './task-errors';
import { moveCardInBoardState } from './kanban-state';
import type { KanbanColumn } from './kanban-types';
import { TaskService } from './task-service';

const taskService = new TaskService();
const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const projectIds: string[] = [];

after(async () => {
  if (projectIds.length > 0) {
    await prisma.taskActivity.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.taskProject.deleteMany({
      where: { id: { in: projectIds } },
    });
  }
  await prisma.$disconnect();
});

test('TaskService supports deterministic Kanban movement', async (t) => {
  const project = await taskService.createProject({
    name: `Kanban test ${testSuffix}`,
  });
  projectIds.push(project.id);

  const boards = project.boards.sort((left, right) => left.order - right.order);
  const [todoBoard, progressBoard, reviewBoard, doneBoard] = boards;
  assert.ok(todoBoard);
  assert.ok(progressBoard);
  assert.ok(reviewBoard);
  assert.ok(doneBoard);

  await t.test('new default boards have explicit status mappings', () => {
    assert.deepEqual(
      boards.map(({ status }) => status),
      ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'],
    );
  });

  const tiedCreatedAt = new Date('2031-01-01T00:00:00.000Z');
  const deterministicIds = [
    `kanban-a-${testSuffix}`,
    `kanban-b-${testSuffix}`,
    `kanban-c-${testSuffix}`,
  ];
  await prisma.taskCard.createMany({
    data: deterministicIds
      .slice()
      .reverse()
      .map((id) => ({
        id,
        projectId: project.id,
        boardId: todoBoard.id,
        title: id,
        order: 0,
        createdAt: tiedCreatedAt,
        updatedAt: tiedCreatedAt,
      })),
  });

  await t.test('board retrieval uses deterministic ordering and a narrow shape', async () => {
    const board = await taskService.getProjectBoard(project.id);
    const todo = board.boards.find(({ id }) => id === todoBoard.id);
    assert.ok(todo);
    assert.deepEqual(
      todo.cards.map(({ id }) => id),
      deterministicIds,
    );
    assert.equal('comments' in todo.cards[0], false);

    const response = await projectBoardRoute(new Request('http://local.test'), {
      params: Promise.resolve({ id: project.id }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, project.id);
  });

  await t.test('same-board reorder normalizes order and emits only changed order activity', async () => {
    await taskService.moveCard({
      cardId: deterministicIds[2],
      sourceBoardId: todoBoard.id,
      destinationBoardId: todoBoard.id,
      destinationIndex: 0,
    });

    let cards = await prisma.taskCard.findMany({
      where: { boardId: todoBoard.id },
      orderBy: { order: 'asc' },
    });
    assert.deepEqual(
      cards.map(({ id }) => id),
      [deterministicIds[2], deterministicIds[0], deterministicIds[1]],
    );

    await taskService.moveCard({
      cardId: deterministicIds[2],
      sourceBoardId: todoBoard.id,
      destinationBoardId: todoBoard.id,
      destinationIndex: 2,
    });
    cards = await prisma.taskCard.findMany({
      where: { boardId: todoBoard.id },
      orderBy: { order: 'asc' },
    });
    assert.deepEqual(
      cards.map(({ id }) => id),
      deterministicIds,
    );

    await taskService.moveCard({
      cardId: deterministicIds[0],
      sourceBoardId: todoBoard.id,
      destinationBoardId: todoBoard.id,
      destinationIndex: 2,
    });
    cards = await prisma.taskCard.findMany({
      where: { boardId: todoBoard.id },
      orderBy: { order: 'asc' },
    });
    assert.deepEqual(
      cards.map(({ id }) => id),
      [deterministicIds[1], deterministicIds[2], deterministicIds[0]],
    );
    assert.deepEqual(
      cards.map(({ order }) => order),
      [0, 1, 2],
    );

    const activities = await prisma.taskActivity.findMany({
      where: {
        entityId: { in: deterministicIds },
        action: { in: ['ORDER_CHANGED', 'BOARD_CHANGED', 'STATUS_CHANGED'] },
      },
    });
    assert.ok(activities.some(({ action }) => action === 'ORDER_CHANGED'));
    assert.equal(activities.some(({ action }) => action === 'BOARD_CHANGED'), false);
    assert.equal(activities.some(({ action }) => action === 'STATUS_CHANGED'), false);
  });

  await t.test('cross-board move normalizes both boards and applies mapped status', async () => {
    await taskService.createCard({
      projectId: project.id,
      boardId: progressBoard.id,
      title: `Existing destination card ${testSuffix}`,
    });

    const firstMoveResponse = await taskService.moveCard({
      cardId: deterministicIds[1],
      sourceBoardId: todoBoard.id,
      destinationBoardId: progressBoard.id,
      destinationIndex: 0,
    });
    const canonicalMovedCard = firstMoveResponse.boards
      .find(({ id }) => id === progressBoard.id)
      ?.cards.find(({ id }) => id === deterministicIds[1]);
    assert.ok(canonicalMovedCard);

    const secondMoveResponse = await taskService.moveCard({
      cardId: deterministicIds[1],
      sourceBoardId: progressBoard.id,
      destinationBoardId: progressBoard.id,
      destinationIndex: 1,
      expectedUpdatedAt: canonicalMovedCard.updatedAt,
    });
    const twiceMovedCard = secondMoveResponse.boards
      .find(({ id }) => id === progressBoard.id)
      ?.cards.find(({ id }) => id === deterministicIds[1]);
    assert.ok(twiceMovedCard);
    assert.equal(
      twiceMovedCard.updatedAt.getTime(),
      (
        await prisma.taskCard.findUniqueOrThrow({
          where: { id: deterministicIds[1] },
        })
      ).updatedAt.getTime(),
    );

    const [sourceCards, destinationCards, movedCard] = await Promise.all([
      prisma.taskCard.findMany({
        where: { boardId: todoBoard.id },
        orderBy: { order: 'asc' },
      }),
      prisma.taskCard.findMany({
        where: { boardId: progressBoard.id },
        orderBy: { order: 'asc' },
      }),
      prisma.taskCard.findUniqueOrThrow({
        where: { id: deterministicIds[1] },
      }),
    ]);

    assert.deepEqual(
      sourceCards.map(({ order }) => order),
      [0, 1],
    );
    assert.deepEqual(
      destinationCards.map(({ order }) => order),
      [0, 1],
    );
    assert.equal(movedCard.boardId, progressBoard.id);
    assert.equal(movedCard.status, 'IN_PROGRESS');

    const actions = await prisma.taskActivity.findMany({
      where: { entityId: deterministicIds[1] },
      select: { action: true },
    });
    assert.ok(actions.some(({ action }) => action === 'BOARD_CHANGED'));
    assert.ok(actions.some(({ action }) => action === 'STATUS_CHANGED'));
  });

  await t.test('unchanged move produces no activity', async () => {
    const current = await prisma.taskCard.findUniqueOrThrow({
      where: { id: deterministicIds[1] },
    });
    const before = await prisma.taskActivity.count({
      where: { entityId: current.id },
    });

    await taskService.moveCard({
      cardId: current.id,
      sourceBoardId: current.boardId,
      destinationBoardId: current.boardId,
      destinationIndex: current.order,
      expectedUpdatedAt: current.updatedAt,
    });

    assert.equal(
      await prisma.taskActivity.count({ where: { entityId: current.id } }),
      before,
    );
  });

  const secondProject = await taskService.createProject({
    name: `Other Kanban project ${testSuffix}`,
  });
  projectIds.push(secondProject.id);
  const otherBoard = secondProject.boards[0];
  assert.ok(otherBoard);

  await t.test('cross-project destination is rejected', async () => {
    const card = await prisma.taskCard.findUniqueOrThrow({
      where: { id: deterministicIds[0] },
    });
    await assert.rejects(
      taskService.moveCard({
        cardId: card.id,
        sourceBoardId: card.boardId,
        destinationBoardId: otherBoard.id,
        destinationIndex: 0,
      }),
      TaskBoardProjectMismatchError,
    );
  });

  await t.test('source-board mismatch and stale timestamp are conflicts', async () => {
    const card = await prisma.taskCard.findUniqueOrThrow({
      where: { id: deterministicIds[0] },
    });
    await assert.rejects(
      taskService.moveCard({
        cardId: card.id,
        sourceBoardId: progressBoard.id,
        destinationBoardId: todoBoard.id,
        destinationIndex: 0,
      }),
      TaskMoveConflictError,
    );
    await assert.rejects(
      taskService.moveCard({
        cardId: card.id,
        sourceBoardId: card.boardId,
        destinationBoardId: card.boardId,
        destinationIndex: 0,
        expectedUpdatedAt: new Date(0),
      }),
      TaskMoveConflictError,
    );

    const serializationConflictDatabase = {
      async $transaction() {
        throw new Prisma.PrismaClientKnownRequestError(
          'simulated serialization conflict',
          {
            code: 'P2034',
            clientVersion: '7.5.0',
          },
        );
      },
    } as unknown as PrismaClient;
    await assert.rejects(
      new TaskService(serializationConflictDatabase).moveCard({
        cardId: card.id,
        sourceBoardId: card.boardId,
        destinationBoardId: card.boardId,
        destinationIndex: 0,
      }),
      TaskMoveConflictError,
    );
  });

  const unmappedBoard = await prisma.taskBoard.create({
    data: {
      projectId: project.id,
      name: `Legacy unmapped ${testSuffix}`,
      order: 99,
    },
  });

  await t.test('unmapped destination and invalid index are rejected', async () => {
    const legacyCard = await prisma.taskCard.create({
      data: {
        projectId: project.id,
        boardId: unmappedBoard.id,
        title: `Legacy board card ${testSuffix}`,
        status: 'TODO',
      },
    });
    const readableProject = await taskService.getProjectBoard(project.id);
    const readableLegacyBoard = readableProject.boards.find(
      ({ id }) => id === unmappedBoard.id,
    );
    assert.equal(readableLegacyBoard?.status, null);
    assert.equal(readableLegacyBoard?.cards[0]?.id, legacyCard.id);

    const card = await prisma.taskCard.findUniqueOrThrow({
      where: { id: deterministicIds[0] },
    });
    await assert.rejects(
      taskService.moveCard({
        cardId: card.id,
        sourceBoardId: card.boardId,
        destinationBoardId: unmappedBoard.id,
        destinationIndex: 0,
      }),
      TaskBoardStatusUnmappedError,
    );
    await assert.rejects(
      taskService.moveCard({
        cardId: card.id,
        sourceBoardId: card.boardId,
        destinationBoardId: reviewBoard.id,
        destinationIndex: 999,
      }),
      InvalidTaskDestinationIndexError,
    );
  });

  await t.test('activity failure rolls back every affected order update', async () => {
    const failingActivityService: ActivityService = {
      async record() {
        throw new Error('simulated move activity failure');
      },
    };
    const failingTaskService = new TaskService(prisma, failingActivityService);
    const before = await taskService.getProjectBoard(project.id);

    await assert.rejects(
      failingTaskService.moveCard({
        cardId: deterministicIds[0],
        sourceBoardId: todoBoard.id,
        destinationBoardId: reviewBoard.id,
        destinationIndex: 0,
      }),
      /simulated move activity failure/,
    );

    assert.deepEqual(
      await taskService.getProjectBoard(project.id),
      before,
    );
  });

  await t.test('move API returns success, conflict, and unmapped-board responses', async () => {
    const card = await prisma.taskCard.findUniqueOrThrow({
      where: { id: deterministicIds[0] },
    });
    const successResponse = await moveCardRoute(
      new Request(`http://local.test/api/tasks/cards/${card.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceBoardId: card.boardId,
          destinationBoardId: doneBoard.id,
          destinationIndex: 0,
          expectedUpdatedAt: card.updatedAt.toISOString(),
        }),
      }),
      { params: Promise.resolve({ id: card.id }) },
    );
    assert.equal(successResponse.status, 200);

    const conflictResponse = await moveCardRoute(
      new Request(`http://local.test/api/tasks/cards/${card.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceBoardId: todoBoard.id,
          destinationBoardId: doneBoard.id,
          destinationIndex: 0,
        }),
      }),
      { params: Promise.resolve({ id: card.id }) },
    );
    assert.equal(conflictResponse.status, 409);

    const movedCard = await prisma.taskCard.findUniqueOrThrow({
      where: { id: card.id },
    });
    const unmappedResponse = await moveCardRoute(
      new Request(`http://local.test/api/tasks/cards/${card.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceBoardId: movedCard.boardId,
          destinationBoardId: unmappedBoard.id,
          destinationIndex: 0,
        }),
      }),
      { params: Promise.resolve({ id: card.id }) },
    );
    assert.equal(unmappedResponse.status, 409);
  });
});

test('optimistic move is immutable so a failed request can restore its snapshot', () => {
  const boards: KanbanColumn[] = [
    {
      id: 'todo',
      name: 'To Do',
      color: null,
      order: 0,
      status: 'TODO',
      cards: [
        {
          id: 'card',
          title: 'Card',
          description: null,
          priority: 'MEDIUM',
          status: 'TODO',
          assignedTo: null,
          dueDate: null,
          order: 0,
          updatedAt: new Date(0).toISOString(),
          labels: [],
        },
      ],
    },
    {
      id: 'done',
      name: 'Done',
      color: null,
      order: 1,
      status: 'DONE',
      cards: [],
    },
  ];
  const snapshot = structuredClone(boards);

  const optimistic = moveCardInBoardState(boards, {
    cardId: 'card',
    destinationBoardId: 'done',
    destinationIndex: 0,
  });

  assert.equal(boards[0].cards.length, 1);
  assert.equal(boards[1].cards.length, 0);
  assert.equal(optimistic[0].cards.length, 0);
  assert.equal(optimistic[1].cards[0].status, 'DONE');
  assert.deepEqual(boards, snapshot);
});
