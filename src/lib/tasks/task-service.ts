import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  defaultActivityService,
  type ActivityService,
} from './task-activity-service';
import type {
  CreateTaskCardInput,
  CreateTaskProjectInput,
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
    const project = await this.database.$transaction(async (transaction) => {
      if (input.companyId) {
        const company = await transaction.company.findUnique({
          where: { id: input.companyId },
          select: { id: true },
        });
        if (!company) {
          throw new TaskValidationError('companyId does not reference a company.');
        }
      }

      return transaction.taskProject.create({
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
    });

    await this.activityService.record({
      action: 'PROJECT_CREATED',
      projectId: project.id,
      metadata: { name: project.name },
      occurredAt: new Date(),
    });

    return project;
  }

  async createCard(input: CreateTaskCardInput) {
    const card = await this.database.$transaction(async (transaction) => {
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

      return transaction.taskCard.create({
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
    });

    await this.activityService.record({
      action: 'TASK_CREATED',
      projectId: card.projectId,
      cardId: card.id,
      metadata: {
        boardId: card.boardId,
        order: card.order,
        title: card.title,
      },
      occurredAt: new Date(),
    });

    return card;
  }

  async updateCard(input: UpdateTaskCardInput) {
    const result = await this.database.$transaction(async (transaction) => {
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

      return { card, existing };
    });

    await this.activityService.record({
      action: 'TASK_UPDATED',
      projectId: result.card.projectId,
      cardId: result.card.id,
      metadata: {
        changes: this.describeChanges(result.existing, result.card),
      },
      occurredAt: new Date(),
    });

    return result.card;
  }

  async deleteCard(cardId: string): Promise<void> {
    const deleted = await this.database.$transaction(async (transaction) => {
      const existing = await transaction.taskCard.findUnique({
        where: { id: cardId },
      });
      if (!existing) throw new TaskNotFoundError();

      await transaction.taskCard.delete({ where: { id: cardId } });
      return existing;
    });

    await this.activityService.record({
      action: 'TASK_DELETED',
      projectId: deleted.projectId,
      cardId: deleted.id,
      metadata: {
        boardId: deleted.boardId,
        title: deleted.title,
      },
      occurredAt: new Date(),
    });
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
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Record<string, { from: unknown; to: unknown }> {
    const trackedFields = [
      'boardId',
      'title',
      'description',
      'priority',
      'status',
      'assignedTo',
      'dueDate',
      'order',
    ];

    return Object.fromEntries(
      trackedFields
        .filter((field) => String(before[field] ?? '') !== String(after[field] ?? ''))
        .map((field) => [
          field,
          { from: before[field] ?? null, to: after[field] ?? null },
        ]),
    );
  }
}

export const taskService = new TaskService();
