import { Prisma, type PrismaClient, type TaskCard } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  CreateTaskChecklistItemInput,
  CreateTaskCardInput,
  CreateTaskCommentInput,
  CreateTaskProjectInput,
  MoveTaskCardInput,
  ReorderTaskChecklistInput,
  TaskActivityEvent,
  TaskCompanyActor,
  TaskMutationActor,
  UpdateTaskCardInput,
  UpdateTaskChecklistItemInput,
  UpdateTaskCommentInput,
} from './task-types';
import type { ActivityService } from './task-activity-service';
import { defaultActivityService } from './task-activity-service';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import {
  taskAttachmentStorage,
  type TaskAttachmentStorage,
} from './task-storage';
import {
  MAX_TASK_ATTACHMENTS,
  type ValidatedTaskFile,
} from './task-file-policy';
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
import { telegramDeliveryService } from '@/lib/integrations/telegram-delivery-service';

const cardInclude = {
  labels: true,
  comments: true,
  assigneeUser: {
    select: { id: true, displayName: true, image: true },
  },
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
  assigneeUserId: true,
  assigneeUser: {
    select: { id: true, displayName: true, image: true },
  },
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
  checklistItems: {
    orderBy: [{ order: 'asc' as const }, { id: 'asc' as const }],
    select: { id: true, isCompleted: true },
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
    private readonly attachmentStorage: TaskAttachmentStorage = taskAttachmentStorage,
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

  async createCard(
    input: CreateTaskCardInput,
    actor?: TaskMutationActor | TaskCompanyActor,
  ) {
    return this.database.$transaction(async (transaction) => {
      const destinationBoard = await this.validateBoardProject(
        transaction,
        input.boardId,
        input.projectId,
      );
      if (!destinationBoard.status) {
        throw new TaskBoardStatusUnmappedError();
      }
      if (input.assigneeUserId !== undefined) {
        if (!actor || !('companyId' in actor)) throw new AuthorizationDeniedError();
        await this.validateVerifiedAssignee(
          transaction,
          input.assigneeUserId,
          actor.companyId,
        );
      }

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
          assigneeUserId: input.assigneeUserId,
          status: destinationBoard.status,
          dueDate: input.dueDate,
          order: input.order === undefined ? order + 1 : order,
        },
        include: cardInclude,
      });
      const project = await transaction.taskProject.findUniqueOrThrow({
        where: { id: card.projectId },
        select: { name: true },
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
          dueDate: card.dueDate?.toISOString() ?? null,
          assigneeUserId: card.assigneeUserId,
        },
      });
      if (card.assigneeUserId && actor && 'companyId' in actor) {
        await telegramDeliveryService.queueAssignmentDelivery(transaction, {
          companyId: actor.companyId,
          userId: card.assigneeUserId,
          taskCardId: card.id,
          title: card.title,
          description: card.description,
          priority: card.priority,
          status: card.status,
          dueDate: card.dueDate,
          projectName: project.name,
          dedupeKey: `assignment:${card.id}:${card.assigneeUserId}:${card.updatedAt.toISOString()}`,
        });
      }

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

  async updateCard(
    input: UpdateTaskCardInput,
    actor?: TaskMutationActor | TaskCompanyActor,
  ) {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.taskCard.findUnique({
        where: { id: input.id },
      });
      if (!existing) throw new TaskNotFoundError();
      if (
        input.expectedUpdatedAt &&
        existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        if (this.isIdempotentCardUpdate(existing, input)) {
          return transaction.taskCard.findUniqueOrThrow({
            where: { id: input.id },
            include: cardInclude,
          });
        }
        throw new TaskMoveConflictError(
          'Task card was updated after the editor was loaded.',
        );
      }

      if (input.boardId && input.boardId !== existing.boardId) {
        await this.validateBoardProject(transaction, input.boardId, existing.projectId);
      }
      if (input.assigneeUserId !== undefined) {
        if (!actor || !('companyId' in actor)) throw new AuthorizationDeniedError();
        await this.validateVerifiedAssignee(
          transaction,
          input.assigneeUserId,
          actor.companyId,
        );
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
          assigneeUserId: input.assigneeUserId,
          dueDate: input.dueDate,
          order: input.order,
        },
        include: cardInclude,
      });
      const project = await transaction.taskProject.findUniqueOrThrow({
        where: { id: card.projectId },
        select: { name: true },
      });

      for (const activity of this.describeChanges(existing, card, actor)) {
        await this.activityService.record(transaction, activity);
      }
      if (
        actor &&
        'companyId' in actor &&
        card.assigneeUserId &&
        existing.assigneeUserId !== card.assigneeUserId
      ) {
        await telegramDeliveryService.queueAssignmentDelivery(transaction, {
          companyId: actor.companyId,
          userId: card.assigneeUserId,
          taskCardId: card.id,
          title: card.title,
          description: card.description,
          priority: card.priority,
          status: card.status,
          dueDate: card.dueDate,
          projectName: project.name,
          dedupeKey: `assignment:${card.id}:${card.assigneeUserId}:${card.updatedAt.toISOString()}`,
        });
      }
      if (input.mentionUserIds !== undefined) {
        if (!actor || !('companyId' in actor)) {
          throw new AuthorizationDeniedError();
        }
        await this.syncMentions(
          transaction,
          card,
          actor as TaskCompanyActor,
          'DESCRIPTION',
          input.mentionUserIds,
        );
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
      include: {
        actorUser: {
          select: { id: true, displayName: true, image: true },
        },
      },
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

  async getChecklist(cardId: string, companyId: string) {
    await this.requireCompanyCard(this.database, cardId, companyId);
    return this.database.taskChecklistItem.findMany({
      where: { cardId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: {
        createdByUser: {
          select: { id: true, displayName: true },
        },
      },
    });
  }

  async createChecklistItem(
    input: CreateTaskChecklistItemInput,
    actor: TaskCompanyActor,
  ) {
    return this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        input.cardId,
        actor.companyId,
      );
      const maximum = await transaction.taskChecklistItem.aggregate({
        where: { cardId: input.cardId },
        _max: { order: true },
      });
      const item = await transaction.taskChecklistItem.create({
        data: {
          cardId: input.cardId,
          content: input.content,
          order: (maximum._max.order ?? -1) + 1,
          createdByUserId: actor.userId,
        },
        include: {
          createdByUser: { select: { id: true, displayName: true } },
        },
      });
      await this.recordCardActivity(transaction, card, actor, {
        action: 'CHECKLIST_ITEM_CREATED',
        metadata: { checklistItemId: item.id, content: item.content },
      });
      return item;
    });
  }

  async updateChecklistItem(
    input: UpdateTaskChecklistItemInput,
    actor: TaskCompanyActor,
  ) {
    return this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        input.cardId,
        actor.companyId,
      );
      const existing = await transaction.taskChecklistItem.findFirst({
        where: { id: input.itemId, cardId: input.cardId },
      });
      if (!existing) throw new TaskNotFoundError();
      const item = await transaction.taskChecklistItem.update({
        where: { id: existing.id },
        data: {
          content: input.content,
          isCompleted: input.isCompleted,
        },
        include: {
          createdByUser: { select: { id: true, displayName: true } },
        },
      });
      if (input.content !== undefined && input.content !== existing.content) {
        await this.recordCardActivity(transaction, card, actor, {
          action: 'CHECKLIST_ITEM_UPDATED',
          metadata: {
            checklistItemId: item.id,
            from: existing.content,
            to: item.content,
          },
        });
      }
      if (
        input.isCompleted !== undefined &&
        input.isCompleted !== existing.isCompleted
      ) {
        await this.recordCardActivity(transaction, card, actor, {
          action: input.isCompleted
            ? 'CHECKLIST_ITEM_COMPLETED'
            : 'CHECKLIST_ITEM_REOPENED',
          metadata: { checklistItemId: item.id, content: item.content },
        });
      }
      return item;
    });
  }

  async reorderChecklist(
    input: ReorderTaskChecklistInput,
    actor: TaskCompanyActor,
  ) {
    return this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        input.cardId,
        actor.companyId,
      );
      const existing = await transaction.taskChecklistItem.findMany({
        where: { cardId: input.cardId },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (
        existing.length !== input.itemIds.length ||
        existing.some(({ id }) => !input.itemIds.includes(id))
      ) {
        throw new TaskValidationError(
          'itemIds must contain every checklist item exactly once.',
        );
      }
      for (const [order, id] of input.itemIds.entries()) {
        await transaction.taskChecklistItem.update({
          where: { id },
          data: { order },
        });
      }
      await this.recordCardActivity(transaction, card, actor, {
        action: 'CHECKLIST_ITEM_REORDERED',
        metadata: { itemIds: input.itemIds },
      });
      return transaction.taskChecklistItem.findMany({
        where: { cardId: input.cardId },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        include: {
          createdByUser: { select: { id: true, displayName: true } },
        },
      });
    });
  }

  async deleteChecklistItem(
    cardId: string,
    itemId: string,
    actor: TaskCompanyActor,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        cardId,
        actor.companyId,
      );
      const item = await transaction.taskChecklistItem.findFirst({
        where: { id: itemId, cardId },
      });
      if (!item) throw new TaskNotFoundError();
      await transaction.taskChecklistItem.delete({ where: { id: item.id } });
      await this.normalizeChecklistOrder(transaction, cardId);
      await this.recordCardActivity(transaction, card, actor, {
        action: 'CHECKLIST_ITEM_DELETED',
        metadata: { checklistItemId: item.id, content: item.content },
      });
    });
  }

  async getComments(cardId: string, actor: TaskCompanyActor) {
    await this.requireCompanyCard(this.database, cardId, actor.companyId);
    const comments = await this.database.taskComment.findMany({
      where: { cardId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        authorUser: {
          select: { id: true, displayName: true, image: true },
        },
      },
    });
    return comments.map((comment) => ({
      ...comment,
      canEdit:
        comment.authorUserId === actor.userId ||
        actor.role === 'OWNER' ||
        actor.role === 'ADMIN',
    }));
  }

  async createComment(input: CreateTaskCommentInput, actor: TaskCompanyActor) {
    return this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        input.cardId,
        actor.companyId,
      );
      const comment = await transaction.taskComment.create({
        data: {
          cardId: input.cardId,
          author: actor.displayName,
          authorUserId: actor.userId,
          content: input.content,
        },
        include: {
          authorUser: {
            select: { id: true, displayName: true, image: true },
          },
        },
      });
      await this.recordCardActivity(transaction, card, actor, {
        action: 'COMMENT_ADDED',
        metadata: { commentId: comment.id },
      });
      await this.syncMentions(
        transaction,
        card,
        actor,
        'COMMENT',
        input.mentionUserIds ?? [],
        comment.id,
      );
      return comment;
    });
  }

  async updateComment(input: UpdateTaskCommentInput, actor: TaskCompanyActor) {
    return this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        input.cardId,
        actor.companyId,
      );
      const existing = await transaction.taskComment.findFirst({
        where: { id: input.commentId, cardId: input.cardId },
      });
      if (!existing) throw new TaskNotFoundError();
      this.requireCommentMutationPermission(existing.authorUserId, actor);
      const comment = await transaction.taskComment.update({
        where: { id: existing.id },
        data: { content: input.content },
        include: {
          authorUser: {
            select: { id: true, displayName: true, image: true },
          },
        },
      });
      await this.recordCardActivity(transaction, card, actor, {
        action: 'COMMENT_EDITED',
        metadata: { commentId: comment.id },
      });
      if (input.mentionUserIds !== undefined) {
        await this.syncMentions(
          transaction,
          card,
          actor,
          'COMMENT',
          input.mentionUserIds,
          comment.id,
        );
      }
      return comment;
    });
  }

  async deleteComment(
    cardId: string,
    commentId: string,
    actor: TaskCompanyActor,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        cardId,
        actor.companyId,
      );
      const comment = await transaction.taskComment.findFirst({
        where: { id: commentId, cardId },
      });
      if (!comment) throw new TaskNotFoundError();
      this.requireCommentMutationPermission(comment.authorUserId, actor);
      await transaction.taskComment.delete({ where: { id: comment.id } });
      await this.recordCardActivity(transaction, card, actor, {
        action: 'COMMENT_DELETED',
        metadata: { commentId: comment.id },
      });
    });
  }

  async getMentionCandidates(companyId: string, query = '') {
    return this.database.companyMembership.findMany({
      where: {
        companyId,
        user: {
          isActive: true,
          ...(query
            ? {
                OR: [
                  { displayName: { contains: query, mode: 'insensitive' } },
                  { email: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      orderBy: [{ user: { displayName: 'asc' } }, { userId: 'asc' }],
      take: 20,
      select: {
        user: { select: { id: true, displayName: true, image: true } },
      },
    }).then((memberships) => memberships.map(({ user }) => user));
  }

  async getAssigneeCandidates(companyId: string) {
    return this.database.companyMembership.findMany({
      where: {
        companyId,
        user: { isActive: true },
      },
      orderBy: [{ user: { displayName: 'asc' } }, { userId: 'asc' }],
      take: 50,
      select: {
        user: {
          select: {
            id: true,
            displayName: true,
            image: true,
            telegramUserLinks: {
              where: { companyId, enabled: true },
              select: { telegramUsername: true },
              take: 1,
            },
          },
        },
      },
    }).then((memberships) =>
      memberships.map(({ user }) => ({
        id: user.id,
        displayName: user.displayName,
        image: user.image,
        telegram: {
          connected: user.telegramUserLinks.length > 0,
          username: user.telegramUserLinks[0]?.telegramUsername ?? null,
        },
      })),
    );
  }

  async getAttachments(cardId: string, actor: TaskCompanyActor) {
    await this.requireCompanyCard(this.database, cardId, actor.companyId);
    const attachments = await this.database.taskAttachment.findMany({
      where: { cardId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        uploaderUser: {
          select: { id: true, displayName: true, image: true },
        },
      },
    });
    return attachments.map((attachment) =>
      this.publicAttachment(attachment, actor),
    );
  }

  async createAttachment(
    cardId: string,
    file: ValidatedTaskFile,
    bytes: Uint8Array,
    actor: TaskCompanyActor,
  ) {
    await this.requireCompanyCard(this.database, cardId, actor.companyId);
    if (
      (await this.database.taskAttachment.count({ where: { cardId } })) >=
      MAX_TASK_ATTACHMENTS
    ) {
      throw new TaskValidationError('A task may have at most 20 attachments.');
    }
    const storageKey = await this.attachmentStorage.put(bytes);
    try {
      const attachment = await this.database.$transaction(async (transaction) => {
        const card = await this.requireCompanyCard(
          transaction,
          cardId,
          actor.companyId,
        );
        const created = await transaction.taskAttachment.create({
          data: {
            cardId,
            name: file.displayFilename,
            url: '',
            size: file.byteSize,
            mimeType: file.mimeType,
            uploadedBy: actor.displayName,
            uploaderUserId: actor.userId,
            originalFilename: file.originalFilename,
            displayFilename: file.displayFilename,
            storageKey,
            byteSize: file.byteSize,
          },
          include: {
            uploaderUser: {
              select: { id: true, displayName: true, image: true },
            },
          },
        });
        await this.recordCardActivity(transaction, card, actor, {
          action: 'ATTACHMENT_ADDED',
          metadata: {
            attachmentId: created.id,
            displayFilename: file.displayFilename,
            byteSize: file.byteSize,
            mimeType: file.mimeType,
          },
        });
        return created;
      });
      return this.publicAttachment(attachment, actor);
    } catch (error) {
      await this.attachmentStorage.delete(storageKey);
      throw error;
    }
  }

  async getAttachmentDownload(
    cardId: string,
    attachmentId: string,
    actor: TaskCompanyActor,
  ) {
    await this.requireCompanyCard(this.database, cardId, actor.companyId);
    const attachment = await this.database.taskAttachment.findFirst({
      where: {
        id: attachmentId,
        cardId,
        card: { project: { companyId: actor.companyId } },
      },
    });
    if (!attachment?.storageKey) throw new TaskNotFoundError();
    return {
      bytes: await this.attachmentStorage.get(attachment.storageKey),
      filename: attachment.displayFilename ?? attachment.name,
      mimeType: attachment.mimeType ?? 'application/octet-stream',
    };
  }

  async deleteAttachment(
    cardId: string,
    attachmentId: string,
    actor: TaskCompanyActor,
  ) {
    const attachment = await this.database.$transaction(async (transaction) => {
      const card = await this.requireCompanyCard(
        transaction,
        cardId,
        actor.companyId,
      );
      const existing = await transaction.taskAttachment.findFirst({
        where: { id: attachmentId, cardId },
      });
      if (!existing) throw new TaskNotFoundError();
      if (
        existing.uploaderUserId !== actor.userId &&
        actor.role !== 'ADMIN' &&
        actor.role !== 'OWNER'
      ) {
        throw new AuthorizationDeniedError();
      }
      await transaction.taskAttachment.delete({ where: { id: existing.id } });
      await this.recordCardActivity(transaction, card, actor, {
        action: 'ATTACHMENT_REMOVED',
        metadata: {
          attachmentId: existing.id,
          displayFilename: existing.displayFilename ?? existing.name,
        },
      });
      return existing;
    });
    if (attachment.storageKey) {
      await this.attachmentStorage.delete(attachment.storageKey);
    }
  }

  private publicAttachment<
    Attachment extends {
      id: string;
      name: string;
      displayFilename: string | null;
      byteSize: number | null;
      size: number | null;
      mimeType: string | null;
      createdAt: Date;
      uploaderUserId: string | null;
      uploadedBy: string;
      uploaderUser?: { id: string; displayName: string; image: string | null } | null;
    },
  >(attachment: Attachment, actor: TaskCompanyActor) {
    return {
      id: attachment.id,
      filename: attachment.displayFilename ?? attachment.name,
      byteSize: attachment.byteSize ?? attachment.size,
      mimeType: attachment.mimeType ?? 'application/octet-stream',
      createdAt: attachment.createdAt,
      uploader:
        attachment.uploaderUser ?? {
          id: null,
          displayName: attachment.uploadedBy,
          image: null,
        },
      canDelete:
        attachment.uploaderUserId === actor.userId ||
        actor.role === 'ADMIN' ||
        actor.role === 'OWNER',
    };
  }

  private async syncMentions(
    transaction: Prisma.TransactionClient,
    card: { id: string; projectId: string; title: string },
    actor: TaskCompanyActor,
    sourceType: 'DESCRIPTION' | 'COMMENT',
    mentionUserIds: string[],
    commentId?: string,
  ) {
    const requestedIds = [...new Set(mentionUserIds)];
    const members = await transaction.companyMembership.findMany({
      where: {
        companyId: actor.companyId,
        userId: { in: requestedIds },
        user: { isActive: true },
      },
      select: {
        user: { select: { id: true, displayName: true } },
      },
    });
    if (members.length !== requestedIds.length) {
      throw new TaskValidationError(
        'Every mentioned user must be an active member of the current company.',
      );
    }
    const existing = await transaction.taskMention.findMany({
      where: {
        cardId: card.id,
        sourceType,
        commentId: commentId ?? null,
        resolvedAt: null,
      },
      select: { id: true, mentionedUserId: true },
    });
    const requested = new Set(requestedIds);
    const existingIds = new Set(
      existing.flatMap(({ mentionedUserId }) =>
        mentionedUserId ? [mentionedUserId] : [],
      ),
    );
    await transaction.taskMention.updateMany({
      where: {
        id: {
          in: existing
            .filter(({ mentionedUserId }) => !mentionedUserId || !requested.has(mentionedUserId))
            .map(({ id }) => id),
        },
      },
      data: { resolvedAt: new Date() },
    });
    for (const { user } of members) {
      if (existingIds.has(user.id)) continue;
      await transaction.taskMention.create({
        data: {
          cardId: card.id,
          commentId,
          mentionedUserId: user.id,
          mentionedDisplayName: user.displayName,
          sourceType,
          createdByUserId: actor.userId,
        },
      });
      await this.recordCardActivity(transaction, card, actor, {
        action: 'MENTION_ADDED',
        metadata: {
          mentionedUserId: user.id,
          mentionedDisplayName: user.displayName,
          sourceType,
          ...(commentId ? { commentId } : {}),
        },
      });
    }
  }

  private async requireCompanyCard(
    transaction: Prisma.TransactionClient | PrismaClient,
    cardId: string,
    companyId: string,
  ) {
    const card = await transaction.taskCard.findFirst({
      where: { id: cardId, project: { companyId } },
      select: { id: true, projectId: true, title: true },
    });
    if (!card) throw new TaskNotFoundError();
    return card;
  }

  private async recordCardActivity(
    transaction: Prisma.TransactionClient,
    card: { id: string; projectId: string; title: string },
    actor: TaskCompanyActor,
    event: Pick<TaskActivityEvent, 'action' | 'metadata'>,
  ) {
    await this.activityService.record(transaction, {
      action: event.action,
      projectId: card.projectId,
      cardId: card.id,
      entityType: 'TASK_CARD',
      entityId: card.id,
      entityTitle: card.title,
      actorType: 'USER',
      actorUserId: actor.userId,
      sourceType: actor.sourceType,
      sourceId: actor.sourceId,
      metadata: event.metadata,
    });
  }

  private requireCommentMutationPermission(
    authorUserId: string | null,
    actor: TaskCompanyActor,
  ) {
    if (
      authorUserId !== actor.userId &&
      actor.role !== 'OWNER' &&
      actor.role !== 'ADMIN'
    ) {
      throw new AuthorizationDeniedError();
    }
  }

  private async normalizeChecklistOrder(
    transaction: Prisma.TransactionClient,
    cardId: string,
  ) {
    const items = await transaction.taskChecklistItem.findMany({
      where: { cardId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true, order: true },
    });
    for (const [order, item] of items.entries()) {
      if (item.order !== order) {
        await transaction.taskChecklistItem.update({
          where: { id: item.id },
          data: { order },
        });
      }
    }
  }

  private async validateBoardProject(
    transaction: Prisma.TransactionClient,
    boardId: string,
    projectId: string,
  ) {
    const board = await transaction.taskBoard.findUnique({
      where: { id: boardId },
      select: { projectId: true, status: true },
    });

    if (!board) {
      throw new TaskValidationError('boardId does not reference a task board.');
    }
    if (board.projectId !== projectId) {
      throw new TaskValidationError('boardId must belong to projectId.');
    }
    return board;
  }

  private async validateVerifiedAssignee(
    transaction: Prisma.TransactionClient,
    assigneeUserId: string | null,
    companyId: string,
  ): Promise<void> {
    if (assigneeUserId === null) return;
    const membership = await transaction.companyMembership.findFirst({
      where: {
        companyId,
        userId: assigneeUserId,
        user: { isActive: true },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new TaskValidationError(
        'assigneeUserId must reference an active member of the current company.',
      );
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
      { field: 'assigneeUserId', action: 'ASSIGNEE_CHANGED' },
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
        sourceType: actor?.sourceType,
        sourceId: actor?.sourceId,
        metadata: {
          field,
          from: this.serializeActivityValue(before[field]),
          to: this.serializeActivityValue(after[field]),
        },
      }));
  }

  private isIdempotentCardUpdate(
    existing: TaskCard,
    input: UpdateTaskCardInput,
  ): boolean {
    const fields: Array<keyof Pick<
      UpdateTaskCardInput,
      | 'boardId'
      | 'title'
      | 'description'
      | 'priority'
      | 'status'
      | 'assignedTo'
      | 'assigneeUserId'
      | 'dueDate'
      | 'order'
    >> = [
      'boardId',
      'title',
      'description',
      'priority',
      'status',
      'assignedTo',
      'assigneeUserId',
      'dueDate',
      'order',
    ];
    return fields.every((field) =>
      input[field] === undefined ||
      this.serializeActivityValue(input[field]) ===
        this.serializeActivityValue(existing[field]),
    );
  }

  private activityActor(
    actor?: TaskMutationActor,
  ): Pick<TaskActivityEvent, 'actorType' | 'actorUserId'> | object {
    return actor
      ? { actorType: 'USER' as const, actorUserId: actor.userId }
      : {};
  }

  async startCardFromIntegration(
    cardId: string,
    actor: TaskCompanyActor,
  ) {
    return this.transitionCardForIntegration(cardId, actor, 'IN_PROGRESS');
  }

  async completeCardFromIntegration(
    cardId: string,
    actor: TaskCompanyActor,
  ) {
    return this.transitionCardForIntegration(cardId, actor, 'DONE');
  }

  private async transitionCardForIntegration(
    cardId: string,
    actor: TaskCompanyActor,
    status: 'IN_PROGRESS' | 'DONE',
  ) {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.taskCard.findFirst({
        where: {
          id: cardId,
          assigneeUserId: actor.userId,
          project: { companyId: actor.companyId },
        },
      });
      if (!existing) throw new TaskNotFoundError();
      if (existing.status === status) {
        return transaction.taskCard.findUniqueOrThrow({
          where: { id: cardId },
          include: cardInclude,
        });
      }
      const destinationBoard = await transaction.taskBoard.findFirst({
        where: {
          projectId: existing.projectId,
          status,
        },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: { id: true, status: true },
      });
      if (!destinationBoard?.status) {
        throw new TaskBoardStatusUnmappedError();
      }
      const updated = await transaction.taskCard.update({
        where: { id: existing.id },
        data: {
          boardId: destinationBoard.id,
          status: destinationBoard.status,
        },
        include: cardInclude,
      });
      for (const activity of this.describeChanges(existing, updated, actor)) {
        await this.activityService.record(transaction, activity);
      }
      return updated;
    });
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
