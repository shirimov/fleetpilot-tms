import type {
  CompanyMembershipRole,
  Prisma,
  PrismaClient,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createTelegramCallbackData } from './telegram-callback';
import {
  TelegramApiError,
  sanitizeTelegramError,
  telegramBotService,
} from './telegram-client';
import { TaskNotFoundError } from '@/lib/tasks/task-errors';
import { TaskValidationError } from '@/lib/tasks/task-validation';
import type {
  TelegramDeliveryPayload,
  TelegramInlineKeyboardMarkup,
} from './telegram-types';
import { formatTelegramTaskSummary } from './telegram-format';
import { getTelegramConfig } from './telegram-config';

const MAX_DELIVERY_ATTEMPTS = 5;
const UPDATE_REQUEST_COOLDOWN_MS = 10 * 60 * 1000;
const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const DRAIN_BATCH_SIZE = 5;

type TransactionClient = Prisma.TransactionClient;

function openTasksUrl() {
  const base =
    process.env.AUTH_URL?.replace(/\/+$/, '') ??
    process.env.APP_URL?.replace(/\/+$/, '') ??
    'https://fleetpilot.invalid';
  return `${base}/tasks`;
}

function isOpenTask(status: TaskStatus) {
  return status !== 'DONE' && status !== 'CANCELLED';
}

function taskButtons(taskCardId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Open Task', url: openTasksUrl() }],
      [
        { text: 'Start', callback_data: createTelegramCallbackData('start', taskCardId) },
        { text: 'Add Update', callback_data: createTelegramCallbackData('update', taskCardId) },
        { text: 'Complete', callback_data: createTelegramCallbackData('complete', taskCardId) },
      ],
    ],
  };
}

type VerifiedTelegramActor = {
  userId: string;
  displayName: string;
  companyId: string;
  role: CompanyMembershipRole;
  telegramUserId: bigint;
  telegramChatId: bigint;
  telegramUsername: string | null;
};

export class TelegramDeliveryService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async getVerifiedActorByTelegramIdentity(input: {
    telegramUserId: bigint;
    telegramChatId: bigint;
  }): Promise<VerifiedTelegramActor | null> {
    const link = await this.database.telegramUserLink.findUnique({
      where: { telegramUserId: input.telegramUserId },
      include: {
        user: {
          select: { id: true, displayName: true, isActive: true, activeCompanyId: true },
        },
        company: { select: { id: true } },
      },
    });
    if (
      !link ||
      !link.enabled ||
      link.telegramChatId !== input.telegramChatId ||
      !link.user.isActive
    ) {
      return null;
    }

    const membership = await this.database.companyMembership.findUnique({
      where: {
        userId_companyId: {
          userId: link.userId,
          companyId: link.companyId,
        },
      },
      select: { role: true },
    });
    if (!membership) return null;

    return {
      userId: link.user.id,
      displayName: link.user.displayName,
      companyId: link.companyId,
      role: membership.role,
      telegramUserId: link.telegramUserId,
      telegramChatId: link.telegramChatId,
      telegramUsername: link.telegramUsername,
    };
  }

  async enqueueCommandResponse(input: {
    companyId: string;
    userId: string;
    text: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
    type?: 'COMMAND_RESPONSE' | 'CALLBACK_RESPONSE';
  }) {
    const link = await this.database.telegramUserLink.findUnique({
      where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
    });
    if (!link || !link.enabled) return null;
    const delivery = await this.database.telegramDelivery.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        telegramChatId: link.telegramChatId,
        type: input.type ?? 'COMMAND_RESPONSE',
        payload: {
          kind: input.type ?? 'COMMAND_RESPONSE',
          text: input.text,
          ...(input.replyMarkup ? { replyMarkup: input.replyMarkup } : {}),
        },
      },
    });
    return delivery;
  }

  async queueAssignmentDelivery(
    transaction: TransactionClient,
    input: {
      companyId: string;
      userId: string;
      taskCardId: string;
      title: string;
      description: string | null;
      priority: TaskPriority;
      status: TaskStatus;
      dueDate: Date | null;
      projectName: string;
      dedupeKey: string;
    },
  ) {
    if (!getTelegramConfig()) return;
    const link = await transaction.telegramUserLink.findUnique({
      where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
    });
    if (!link || !link.enabled) return;

    await transaction.telegramDelivery.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        companyId: input.companyId,
        userId: input.userId,
        taskCardId: input.taskCardId,
        telegramChatId: link.telegramChatId,
        type: 'ASSIGNMENT',
        dedupeKey: input.dedupeKey,
        payload: {
          kind: 'ASSIGNMENT',
          text: formatTelegramTaskSummary({
            title: input.title,
            projectName: input.projectName,
            priority: input.priority,
            status: input.status,
            dueDate: input.dueDate,
            description: input.description,
            prefix: 'New task assigned:',
          }),
          replyMarkup: taskButtons(input.taskCardId),
        } satisfies TelegramDeliveryPayload,
      },
    });
  }

  async createPendingTextAction(input: {
    companyId: string;
    userId: string;
    taskCardId: string;
    telegramChatId: bigint;
    requestedByUserId?: string;
    updateRequestId?: string;
  }) {
    const now = new Date();
    const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);
    return this.database.$transaction(async (transaction) => {
      await transaction.telegramPendingAction.updateMany({
        where: {
          companyId: input.companyId,
          userId: input.userId,
          taskCardId: input.taskCardId,
          type: 'ADD_UPDATE',
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });
      return transaction.telegramPendingAction.create({
        data: {
          companyId: input.companyId,
          userId: input.userId,
          taskCardId: input.taskCardId,
          telegramChatId: input.telegramChatId,
          type: 'ADD_UPDATE',
          requestedByUserId: input.requestedByUserId,
          telegramUpdateRequestId: input.updateRequestId,
          expiresAt,
        },
      });
    });
  }

  async consumePendingTextAction(input: {
    companyId: string;
    userId: string;
    telegramChatId: bigint;
  }) {
    const now = new Date();
    return this.database.$transaction(async (transaction) => {
      const action = await transaction.telegramPendingAction.findFirst({
        where: {
          companyId: input.companyId,
          userId: input.userId,
          telegramChatId: input.telegramChatId,
          type: 'ADD_UPDATE',
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!action) return null;
      const claimed = await transaction.telegramPendingAction.updateMany({
        where: {
          id: action.id,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      return claimed.count === 1 ? { ...action, consumedAt: now } : null;
    });
  }

  async createUpdateRequest(input: {
    companyId: string;
    requestedByUserId: string;
    requestedByRole: CompanyMembershipRole;
    requestedByDisplayName: string;
    taskCardId: string;
  }) {
    if (!getTelegramConfig()) {
      throw new TaskValidationError('Telegram integration is unavailable.');
    }
    return this.database.$transaction(async (transaction) => {
      const card = await transaction.taskCard.findFirst({
        where: {
          id: input.taskCardId,
          project: { companyId: input.companyId },
        },
        include: {
          project: { select: { name: true } },
        },
      });
      if (!card) {
        throw new TaskNotFoundError();
      }
      if (!card.assigneeUserId) {
        throw new TaskValidationError(
          'Only assigned tasks can request a Telegram update.',
        );
      }
      if (!isOpenTask(card.status)) {
        throw new TaskValidationError(
          'Updates can only be requested for open tasks.',
        );
      }

      const link = await transaction.telegramUserLink.findUnique({
        where: {
          companyId_userId: {
            companyId: input.companyId,
            userId: card.assigneeUserId,
          },
        },
      });
      if (!link || !link.enabled) {
        throw new TaskValidationError(
          'The assignee does not have Telegram connected.',
        );
      }

      const recent = await transaction.telegramUpdateRequest.findFirst({
        where: {
          companyId: input.companyId,
          taskCardId: card.id,
          assigneeUserId: card.assigneeUserId,
          status: 'PENDING',
          createdAt: { gt: new Date(Date.now() - UPDATE_REQUEST_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        throw new TaskValidationError(
          'A Telegram update was already requested recently.',
        );
      }

      const request = await transaction.telegramUpdateRequest.create({
        data: {
          companyId: input.companyId,
          taskCardId: card.id,
          requestedByUserId: input.requestedByUserId,
          assigneeUserId: card.assigneeUserId,
          expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_MS),
        },
      });

      await transaction.telegramPendingAction.updateMany({
        where: {
          telegramUpdateRequestId: request.id,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date() },
      });

      await transaction.telegramPendingAction.create({
        data: {
          companyId: input.companyId,
          userId: card.assigneeUserId,
          taskCardId: card.id,
          telegramChatId: link.telegramChatId,
          type: 'ADD_UPDATE',
          requestedByUserId: input.requestedByUserId,
          telegramUpdateRequestId: request.id,
          expiresAt: request.expiresAt,
        },
      });

      await transaction.telegramDelivery.create({
        data: {
          companyId: input.companyId,
          userId: card.assigneeUserId,
          taskCardId: card.id,
          telegramChatId: link.telegramChatId,
          type: 'UPDATE_REQUEST',
          dedupeKey: `update-request:${request.id}`,
          payload: {
            kind: 'UPDATE_REQUEST',
            updateRequestId: request.id,
            text: formatTelegramTaskSummary({
              title: card.title,
              projectName: card.project.name,
              priority: card.priority,
              status: card.status,
              dueDate: card.dueDate,
              description: card.description,
              prefix: 'Update requested:',
            }) + '\n\nWhat is the current status?',
            replyMarkup: taskButtons(card.id),
          } satisfies TelegramDeliveryPayload,
        },
      });

      return request;
    });
  }

  async markUpdateRequestResponded(updateRequestId: string, responseCommentId: string) {
    await this.database.telegramUpdateRequest.updateMany({
      where: {
        id: updateRequestId,
        status: 'PENDING',
        respondedAt: null,
      },
      data: {
        status: 'RESPONDED',
        respondedAt: new Date(),
        responseCommentId,
      },
    });
  }

  async getTaskTelegramSummary(cardId: string, companyId: string) {
    const telegramAvailable = Boolean(getTelegramConfig());
    const card = await this.database.taskCard.findFirst({
      where: { id: cardId, project: { companyId } },
      select: {
        id: true,
        status: true,
        assigneeUserId: true,
      },
    });
    if (!card) return null;

    const link =
      card.assigneeUserId
        ? await this.database.telegramUserLink.findUnique({
            where: {
              companyId_userId: {
                companyId,
                userId: card.assigneeUserId,
              },
            },
            select: { enabled: true, telegramUsername: true },
          })
        : null;

    const latestRequest = await this.database.telegramUpdateRequest.findFirst({
      where: { companyId, taskCardId: cardId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        status: true,
        createdAt: true,
        respondedAt: true,
      },
    });

    return {
      telegramAvailable,
      assigneeTelegramConnected: telegramAvailable && Boolean(link?.enabled),
      assigneeTelegramUsername: link?.telegramUsername ?? null,
      canRequestUpdate:
        telegramAvailable &&
        Boolean(card.assigneeUserId && link?.enabled) &&
        isOpenTask(card.status),
      latestRequest,
    };
  }

  async drainDueDeliveries(limit = DRAIN_BATCH_SIZE) {
    if (!getTelegramConfig()) return { processed: 0 };

    const due = await this.database.telegramDelivery.findMany({
      where: {
        status: { in: ['PENDING', 'RETRYING'] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    let processed = 0;
    for (const delivery of due) {
      const claimed = await this.database.telegramDelivery.updateMany({
        where: { id: delivery.id, status: delivery.status },
        data: {
          status: 'PROCESSING',
          attempts: delivery.attempts + 1,
        },
      });
      if (claimed.count === 0) continue;
      processed += 1;
      await this.processDelivery(delivery.id);
    }
    return { processed };
  }

  private async processDelivery(deliveryId: string) {
    const delivery = await this.database.telegramDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery) return;

    try {
      const payload = delivery.payload as unknown as TelegramDeliveryPayload;
      const result = await telegramBotService.sendMessage({
        chatId: delivery.telegramChatId,
        text: payload.text,
        replyMarkup: 'replyMarkup' in payload ? payload.replyMarkup : undefined,
      });
      if (delivery.type === 'UPDATE_REQUEST' && payload.kind === 'UPDATE_REQUEST') {
        await this.database.telegramUpdateRequest.updateMany({
          where: { id: payload.updateRequestId, telegramMessageId: null },
          data: { telegramMessageId: result.messageId },
        });
      }
      await this.database.telegramDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          telegramMessageId: result.messageId,
          lastError: null,
        },
      });
    } catch (error) {
      const sanitized = sanitizeTelegramError(error);
      const transient =
        error instanceof TelegramApiError ? error.options.transient : true;
      const retryAfterSeconds =
        error instanceof TelegramApiError ? error.options.retryAfterSeconds : undefined;
      const attempts = delivery.attempts;
      const shouldRetry = transient && attempts < MAX_DELIVERY_ATTEMPTS;
      await this.database.telegramDelivery.update({
        where: { id: deliveryId },
        data: {
          status: shouldRetry ? 'RETRYING' : 'PERMANENT_FAILURE',
          nextAttemptAt: shouldRetry
            ? new Date(
                Date.now() +
                  ((retryAfterSeconds ?? Math.min(2 ** attempts, 60)) * 1000),
              )
            : delivery.nextAttemptAt,
          lastError: sanitized,
        },
      });
    }
  }
}

export const telegramDeliveryService = new TelegramDeliveryService();
