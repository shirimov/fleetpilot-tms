import { Prisma, type PrismaClient, type TaskCard } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  defaultActivityService,
  type ActivityService,
} from './task-activity-service';
import type {
  CreateTaskCardInput,
  CreateTaskProjectInput,
  MoveTaskCardInput,
  TaskActivityEvent,
  TaskMutationActor,
  UpdateTaskCardInput,
} from './task-types';
import {
  InvalidTaskDestinationIndexError,
  TaskBoardNotFoundError,
  TaskBoardProjectMismatchError,
  TaskBoardStatusUnmappedError,
  TaskMoveConflictError,
  TaskNotFoundError,
  TaskProjectNotFoundError,
} from './task-errors';
import { TaskValidationError } from './task-validation';

const cardInclude = {
  labels: true,
  comments: true,
} satisfies Prisma.TaskCardInclude;

const projectInclude = {
  boards: {
    orderBy: { order: 'asc' as const },
    include: {
      cards: {
        orderBy: { order: 'asc' as const },
        include: cardInclude,
      },
    },
  },
} satisfies Prisma.TaskProjectInclude;

export { TaskNotFoundError } from './task-errors';

const boardCardSelect = {
  id: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  assignedTo: true,
  dueDate: true,
  order: true,
  updatedAt: true,
  labels: {
    select: {
      id: true,
      name: true,
      color: true,
    },
  },
} satisfies Prisma.TaskCardSelect;

const projectBoardSelect = {
  id: true,
  name: true,
  description: true,
  boards: {
    orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      name: true,
      color: true,
      order: true,
      status: true,
      cards: {
        orderBy: [
          { order: 'asc' as const },
          { createdAt: 'asc' as const },
          { id: 'asc' as const },
        ],
        select: boardCardSelect,
      },
    },
  },
} satisfies Prisma.TaskProjectSelect;

export class TaskService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly activityService: ActivityService = defaultActivityService,
  ) {}

  async getProjects(projectId?: string, companyId?: string) {
    return this.database.taskProject.findMany({
      where: {
        ...(projectId ? { id: projectId } : {}),
        ...(companyId ? { companyId } : {}),
      },
      include: projectInclude,
    });
  }

  async createProject(input: CreateTaskProjectInput, actor?: TaskMutationActor) {
    return this.database.$transaction(async (transaction) => {
      if (input.companyId) {
        const company = await transaction.company.findUnique({
          where: { id: input.companyId },
          select: { id: true },
        });
        if (!company) {
          throw new TaskValidationError('companyId does not reference a company.');
        }
      }

      const project = await transaction.taskProject.create({
        data: {
          name: input.name,
          description: input.description,
          color: input.color || '#3b82f6',
          companyId: input.companyId,
          boards: {
            create: [
              { name: 'To Do', order: 0, status: 'TODO' },
              { name: 'In Progress', order: 1, status: 'IN_PROGRESS' },
              { name: 'In Review', order: 2, status: 'IN_REVIEW' },
              { name: 'Done', order: 3, status: 'DONE' },
            ],
          },
        },
        include: { boards: true },
      });

      await this.activityService.record(transaction, {
        action: 'PROJECT_CREATED',
        projectId: project.id,
        entityType: 'PROJECT',
        entityId: project.id,
        entityTitle: project.name,
        ...this.activityActor(actor),
      });

      return project;
    });
  }

  async createCard(input: CreateTaskCardInput, actor?: TaskMutationActor) {
    return this.database.$transaction(async (transaction) => {
      await this.validateBoardProject(transaction, input.boardId, input.projectId);

      const order =
        input.order ??
        (
          await transaction.taskCard.aggregate({
            where: { boardId: input.boardId },
            _max: { order: true },
          })
        )._max.order ??
        -1;

      const card = await transaction.taskCard.create({
        data: {
          projectId: input.projectId,
          boardId: input.boardId,
          title: input.title,
          description: input.description,
          priority: input.priority || 'MEDIUM',
          order: input.order === undefined ? order + 1 : order,
        },
        include: cardInclude,
      });

      await this.activityService.record(transaction, {
        action: 'TASK_CREATED',
        projectId: card.projectId,
        cardId: card.id,
        entityType: 'TASK_CARD',
        entityId: card.id,
        entityTitle: card.title,
        ...this.activityActor(actor),
        metadata: {
          boardId: card.boardId,
          order: card.order,
          priority: card.priority,
          status: card.status,
        },
      });

      return card;
    });
  }

  async getProjectBoard(projectId: string, companyId?: string) {
    const project = await this.database.taskProject.findFirst({
      where: { id: projectId, ...(companyId ? { companyId } : {}) },
      select: projectBoardSelect,
    });

    if (!project) throw new TaskProjectNotFoundError();
    return project;
  }

  async moveCard(input: MoveTaskCardInput, actor?: TaskMutationActor) {
    try {
      return await this.database.$transaction(
        async (transaction) => {
          const existing = await transaction.taskCard.findUnique({
            where: { id: input.cardId },
          });
          if (!existing) throw new TaskNotFoundError();

          if (existing.boardId !== input.sourceBoardId) {
            throw new TaskMoveConflictError(
              'Task card no longer belongs to the expected source board.',
            );
          }
          if (
            input.expectedUpdatedAt &&
            existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
          ) {
            throw new TaskMoveConflictError(
              'Task card was updated after the board state was loaded.',
            );
          }

          const boardIds = Array.from(
            new Set([input.sourceBoardId, input.destinationBoardId]),
          );
          const boards = await transaction.taskBoard.findMany({
            where: { id: { in: boardIds } },
            select: { id: true, projectId: true, status: true },
          });
          const sourceBoard = boards.find(({ id }) => id === input.sourceBoardId);
          const destinationBoard = boards.find(
            ({ id }) => id === input.destinationBoardId,
          );

          if (!sourceBoard) throw new TaskBoardNotFoundError('Source task board not found.');
          if (!destinationBoard) {
            throw new TaskBoardNotFoundError('Destination task board not found.');
          }
          if (
            sourceBoard.projectId !== existing.projectId ||
            destinationBoard.projectId !== existing.projectId
          ) {
            throw new TaskBoardProjectMismatchError();
          }
          if (!destinationBoard.status) throw new TaskBoardStatusUnmappedError();
          const destinationStatus = destinationBoard.status;

          const orderedCards = await transaction.taskCard.findMany({
            where: { boardId: { in: boardIds } },
            orderBy: [
              { order: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
          });
          const sourceCards = orderedCards.filter(
            ({ boardId, id }) =>
              boardId === input.sourceBoardId && id !== existing.id,
          );
          const destinationCards =
            input.sourceBoardId === input.destinationBoardId
              ? sourceCards
              : orderedCards.filter(
                  ({ boardId, id }) =>
                    boardId === input.destinationBoardId && id !== existing.id,
                );

          if (input.destinationIndex > destinationCards.length) {
            throw new InvalidTaskDestinationIndexError();
          }

          destinationCards.splice(input.destinationIndex, 0, existing);

          const normalizedCards =
            input.sourceBoardId === input.destinationBoardId
              ? destinationCards.map((card, order) => ({
                  card,
                  boardId: destinationBoard.id,
                  status:
                    card.id === existing.id ? destinationStatus : card.status,
                  order,
                }))
              : [
                  ...sourceCards.map((card, order) => ({
                    card,
                    boardId: sourceBoard.id,
                    status: card.status,
                    order,
                  })),
                  ...destinationCards.map((card, order) => ({
                    card,
                    boardId: destinationBoard.id,
                    status:
                      card.id === existing.id ? destinationStatus : card.status,
                    order,
                  })),
                ];

          for (const normalized of normalizedCards) {
            if (
              normalized.card.boardId === normalized.boardId &&
              normalized.card.status === normalized.status &&
              normalized.card.order === normalized.order
            ) {
              continue;
            }

            const updated = await transaction.taskCard.update({
              where: { id: normalized.card.id },
              data: {
                boardId: normalized.boardId,
                status: normalized.status,
                order: normalized.order,
              },
            });

            for (const activity of this.describeChanges(
              normalized.card,
              updated,
              actor,
            )) {
              await this.activityService.record(transaction, activity);
            }
          }

          const project = await transaction.taskProject.findUnique({
            where: { id: existing.projectId },
            select: projectBoardSelect,
          });
          if (!project) throw new TaskProjectNotFoundError();
          return project;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new TaskMoveConflictError();
      }
      throw error;
    }
  }

  async updateCard(input: UpdateTaskCardInput, actor?: TaskMutationActor) {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.taskCard.findUnique({
        where: { id: input.id },
      });
      if (!existing) throw new TaskNotFoundError();

      if (input.boardId && input.boardId !== existing.boardId) {
        await this.validateBoardProject(transaction, input.boardId, existing.projectId);
      }

      const card = await transaction.taskCard.update({
        where: { id: input.id },
        data: {
          boardId: input.boardId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          status: input.status,
          assignedTo: input.assignedTo,
          dueDate: input.dueDate,
          order: input.order,
        },
        include: cardInclude,
      });

      for (const activity of this.describeChanges(existing, card, actor)) {
        await this.activityService.record(transaction, activity);
      }

      return card;
    });
  }

  async deleteCard(
    cardId: string,
    actor?: TaskMutationActor,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const existing = await transaction.taskCard.findUnique({
        where: { id: cardId },
      });
      if (!existing) throw new TaskNotFoundError();

      await this.activityService.record(transaction, {
        action: 'TASK_DELETED',
        projectId: existing.projectId,
        cardId: existing.id,
        entityType: 'TASK_CARD',
        entityId: existing.id,
        entityTitle: existing.title,
        ...this.activityActor(actor),
        metadata: {
          boardId: existing.boardId,
          priority: existing.priority,
          status: existing.status,
        },
      });

      await transaction.taskCard.delete({ where: { id: cardId } });
    });
  }

  async getCardActivity(cardId: string, companyId?: string) {
    const activities = await this.database.taskActivity.findMany({
      where: {
        entityType: 'TASK_CARD',
        entityId: cardId,
        ...(companyId ? { project: { companyId } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });

    if (activities.length === 0) {
      const card = await this.database.taskCard.findFirst({
        where: {
          id: cardId,
          ...(companyId ? { project: { companyId } } : {}),
        },
        select: { id: true },
      });
      if (!card) throw new TaskNotFoundError();
    }

    return activities;
  }

  private async validateBoardProject(
    transaction: Prisma.TransactionClient,
    boardId: string,
    projectId: string,
  ): Promise<void> {
    const board = await transaction.taskBoard.findUnique({
      where: { id: boardId },
      select: { projectId: true },
    });

    if (!board) {
      throw new TaskValidationError('boardId does not reference a task board.');
    }
    if (board.projectId !== projectId) {
      throw new TaskValidationError('boardId must belong to projectId.');
    }
  }

  private describeChanges(
    before: TaskCard,
    after: TaskCard,
    actor?: TaskMutationActor,
  ): TaskActivityEvent[] {
    const changes: Array<{
      field: keyof TaskCard;
      action: TaskActivityEvent['action'];
    }> = [
      { field: 'title', action: 'TITLE_CHANGED' },
      { field: 'description', action: 'DESCRIPTION_CHANGED' },
      { field: 'status', action: 'STATUS_CHANGED' },
      { field: 'boardId', action: 'BOARD_CHANGED' },
      { field: 'priority', action: 'PRIORITY_CHANGED' },
      { field: 'assignedTo', action: 'ASSIGNEE_CHANGED' },
      { field: 'dueDate', action: 'DUE_DATE_CHANGED' },
      { field: 'order', action: 'ORDER_CHANGED' },
    ];

    return changes
      .filter(
        ({ field }) =>
          this.serializeActivityValue(before[field]) !==
          this.serializeActivityValue(after[field]),
      )
      .map(({ field, action }) => ({
        action,
        projectId: after.projectId,
        cardId: after.id,
        entityType: 'TASK_CARD',
        entityId: after.id,
        entityTitle: after.title,
        ...this.activityActor(actor),
        metadata: {
          field,
          from: this.serializeActivityValue(before[field]),
          to: this.serializeActivityValue(after[field]),
        },
      }));
  }

  private activityActor(
    actor?: TaskMutationActor,
  ): Pick<TaskActivityEvent, 'actorType' | 'actorUserId'> | object {
    return actor
      ? { actorType: 'USER' as const, actorUserId: actor.userId }
      : {};
  }

  private serializeActivityValue(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    return String(value);
  }
}

export const taskService = new TaskService();
