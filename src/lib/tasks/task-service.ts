import type { Prisma, PrismaClient, TaskCard } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  defaultActivityService,
  type ActivityService,
} from './task-activity-service';
import type {
  CreateTaskCardInput,
  CreateTaskProjectInput,
  TaskActivityEvent,
  UpdateTaskCardInput,
} from './task-types';
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

export class TaskNotFoundError extends Error {
  constructor(message = 'Task card not found.') {
    super(message);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly activityService: ActivityService = defaultActivityService,
  ) {}

  async getProjects(projectId?: string) {
    return this.database.taskProject.findMany({
      where: projectId ? { id: projectId } : {},
      include: projectInclude,
    });
  }

  async createProject(input: CreateTaskProjectInput) {
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
              { name: 'To Do', order: 0 },
              { name: 'In Progress', order: 1 },
              { name: 'In Review', order: 2 },
              { name: 'Done', order: 3 },
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
      });

      return project;
    });
  }

  async createCard(input: CreateTaskCardInput) {
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

  async updateCard(input: UpdateTaskCardInput) {
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

      for (const activity of this.describeChanges(existing, card)) {
        await this.activityService.record(transaction, activity);
      }

      return card;
    });
  }

  async deleteCard(cardId: string): Promise<void> {
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
        metadata: {
          boardId: existing.boardId,
          priority: existing.priority,
          status: existing.status,
        },
      });

      await transaction.taskCard.delete({ where: { id: cardId } });
    });
  }

  async getCardActivity(cardId: string) {
    const activities = await this.database.taskActivity.findMany({
      where: {
        entityType: 'TASK_CARD',
        entityId: cardId,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });

    if (activities.length === 0) {
      const card = await this.database.taskCard.findUnique({
        where: { id: cardId },
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

  private describeChanges(before: TaskCard, after: TaskCard): TaskActivityEvent[] {
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
        metadata: {
          field,
          from: this.serializeActivityValue(before[field]),
          to: this.serializeActivityValue(after[field]),
        },
      }));
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
