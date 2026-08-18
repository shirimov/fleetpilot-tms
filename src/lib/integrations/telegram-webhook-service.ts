import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { taskService } from '@/lib/tasks/task-service';
import { createTelegramCallbackData, parseTelegramCallbackData } from './telegram-callback';
import { telegramBotService } from './telegram-client';
import { telegramDeliveryService } from './telegram-delivery-service';
import { telegramLinkService } from './telegram-link-service';
import type { TelegramCallbackContext, TelegramMessageContext } from './telegram-types';

type TelegramUpdatePayload = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    from?: { id?: number; username?: string };
    chat?: { id?: number; type?: string };
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number; username?: string };
    message?: {
      message_id?: number;
      chat?: { id?: number; type?: string };
    };
  };
};

function asBigInt(value: number | undefined) {
  return value === undefined ? null : BigInt(String(value));
}

function messageContext(payload: TelegramUpdatePayload): TelegramMessageContext | null {
  const message = payload.message;
  if (!message) return null;
  return {
    messageId: asBigInt(message.message_id) ?? BigInt(0),
    chatId: asBigInt(message.chat?.id) ?? BigInt(0),
    chatType: message.chat?.type ?? null,
    from:
      message.from?.id === undefined
        ? null
        : {
            id: BigInt(String(message.from.id)),
            username: message.from.username ?? null,
          },
    text: message.text ?? null,
  };
}

function callbackContext(payload: TelegramUpdatePayload): TelegramCallbackContext | null {
  const callback = payload.callback_query;
  if (!callback?.id || callback.from?.id === undefined) return null;
  return {
    id: callback.id,
    from: {
      id: BigInt(String(callback.from.id)),
      username: callback.from.username ?? null,
    },
    data: callback.data ?? null,
    messageId: asBigInt(callback.message?.message_id),
    chatId: asBigInt(callback.message?.chat?.id),
    chatType: callback.message?.chat?.type ?? null,
  };
}

function commandName(text: string) {
  return text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function commandArgument(text: string) {
  return text.trim().split(/\s+/, 2)[1] ?? '';
}

function openTasksUrl() {
  const base =
    process.env.AUTH_URL?.replace(/\/+$/, '') ??
    process.env.APP_URL?.replace(/\/+$/, '') ??
    'https://fleetpilot.invalid';
  return `${base}/tasks`;
}

export class TelegramWebhookService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async handleUpdate(payload: TelegramUpdatePayload) {
    const updateId = payload.update_id;
    if (typeof updateId !== 'number' || !Number.isInteger(updateId)) return { ok: true };

    const message = messageContext(payload);
    const callback = callbackContext(payload);
    const telegramUserId = message?.from?.id ?? callback?.from.id ?? null;
    const telegramChatId = message?.chatId ?? callback?.chatId ?? null;
    const actor =
      telegramUserId !== null && telegramChatId !== null
        ? await telegramDeliveryService.getVerifiedActorByTelegramIdentity({
            telegramUserId,
            telegramChatId,
          })
        : null;
    const inbound = await this.recordInboundUpdate({
      updateId,
      kind: message ? 'message' : callback ? 'callback_query' : 'ignored',
      companyId: actor?.companyId ?? null,
      telegramUserId,
      telegramChatId,
    });
    if (!inbound) return { ok: true, duplicate: true };

    try {
      if (message) {
        await this.handleMessage(updateId, message);
      } else if (callback) {
        await this.handleCallback(updateId, callback);
      }
      await this.database.telegramInboundUpdate.update({
        where: { id: inbound.id },
        data: { processedAt: new Date() },
      });
      return { ok: true };
    } catch (error) {
      await this.database.telegramInboundUpdate.update({
        where: { id: inbound.id },
        data: { processedAt: new Date() },
      });
      throw error;
    }
  }

  private async handleMessage(updateId: number, message: TelegramMessageContext) {
    if (message.chatType !== 'private' || !message.from || !message.text) return;
    if (message.text.startsWith('/')) {
      await this.handleCommand(updateId, message);
      return;
    }

    const actor = await telegramDeliveryService.getVerifiedActorByTelegramIdentity({
      telegramUserId: message.from.id,
      telegramChatId: message.chatId,
    });
    if (!actor) {
      await telegramBotService.sendMessage({
        chatId: message.chatId,
        text: 'Link your Telegram account from FleetPilot before sending updates.',
      });
      return;
    }

    const pending = await telegramDeliveryService.consumePendingTextAction({
      companyId: actor.companyId,
      userId: actor.userId,
      telegramChatId: actor.telegramChatId,
    });
    if (!pending?.taskCardId) {
      await this.queueAndDrainLinkedResponse({
        companyId: actor.companyId,
        userId: actor.userId,
        text: 'No pending FleetPilot update request was found. Use /tasks to see your tasks.',
      });
      return;
    }

    const comment = await taskService.createComment(
      { cardId: pending.taskCardId, content: message.text },
      {
        userId: actor.userId,
        displayName: actor.displayName,
        companyId: actor.companyId,
        role: actor.role,
        sourceType: 'TELEGRAM',
        sourceId: `telegram-update:${updateId}`,
      },
    );
    if (pending.telegramUpdateRequestId) {
      await telegramDeliveryService.markUpdateRequestResponded(
        pending.telegramUpdateRequestId,
        comment.id,
      );
    }
    await this.queueAndDrainLinkedResponse({
      companyId: actor.companyId,
      userId: actor.userId,
      text: 'Update added to FleetPilot.',
    });
  }

  private async handleCommand(_updateId: number, message: TelegramMessageContext) {
    const name = commandName(message.text ?? '');
    if (name === '/start') {
      await this.handleStartCommand(message);
      return;
    }

    const actor = await telegramDeliveryService.getVerifiedActorByTelegramIdentity({
      telegramUserId: message.from!.id,
      telegramChatId: message.chatId,
    });
    if (!actor) {
      await telegramBotService.sendMessage({
        chatId: message.chatId,
        text: 'Your Telegram account is not linked yet. Use the Connect Telegram link from FleetPilot Team.',
      });
      return;
    }

    if (name === '/help') {
      await this.queueAndDrainLinkedResponse({
        companyId: actor.companyId,
        userId: actor.userId,
        text: 'FleetPilot commands:\n/help\n/tasks\n/due\n\nUse the task buttons to Start, Add Update, Complete, or Open Task.',
      });
      return;
    }

    if (name === '/tasks') {
      await this.queueTaskList(actor, false);
      return;
    }

    if (name === '/due') {
      await this.queueTaskList(actor, true);
      return;
    }

    await this.queueAndDrainLinkedResponse({
      companyId: actor.companyId,
      userId: actor.userId,
      text: `Unknown command "${name}". Use /help for available commands.`,
    });
  }

  private async handleStartCommand(message: TelegramMessageContext) {
    const token = commandArgument(message.text ?? '');
    if (!token) {
      await telegramBotService.sendMessage({
        chatId: message.chatId,
        text: 'FleetPilot Telegram bot is ready. Open the Connect Telegram link from FleetPilot Team to link your account.',
      });
      return;
    }

    try {
      const linked = await telegramLinkService.consumeLinkToken({
        token,
        telegramUserId: message.from!.id,
        telegramChatId: message.chatId,
        telegramUsername: message.from?.username ?? null,
      });
      await this.queueAndDrainLinkedResponse({
        companyId: linked.link.companyId,
        userId: linked.link.userId,
        text: `FleetPilot Telegram connected for ${linked.companyName}. Use /tasks or /due to get started.`,
      });
    } catch (error) {
      await telegramBotService.sendMessage({
        chatId: message.chatId,
        text: error instanceof Error ? error.message : 'Telegram linking failed.',
      });
    }
  }

  private async handleCallback(updateId: number, callback: TelegramCallbackContext) {
    if (!callback.chatId || callback.chatType !== 'private' || !callback.data) return;

    const actor = await telegramDeliveryService.getVerifiedActorByTelegramIdentity({
      telegramUserId: callback.from.id,
      telegramChatId: callback.chatId,
    });
    if (!actor) {
      await telegramBotService.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Link your Telegram account from FleetPilot first.',
      });
      return;
    }

    const parsed = parseTelegramCallbackData(callback.data);
    if (!parsed) {
      await telegramBotService.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'This FleetPilot action expired. Open the latest message and try again.',
      });
      return;
    }

    if (parsed.action === 'open') {
      await this.queueAndDrainLinkedResponse({
        companyId: actor.companyId,
        userId: actor.userId,
        text: 'Open FleetPilot Task Manager:',
        replyMarkup: {
          inline_keyboard: [[{ text: 'Open Task', url: `${openTasksUrl()}` }]],
        },
      });
      await telegramBotService.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Opened FleetPilot link.',
      });
      return;
    }

    if (parsed.action === 'update') {
      const card = await this.database.taskCard.findFirst({
        where: {
          id: parsed.taskCardId,
          assigneeUserId: actor.userId,
          project: { companyId: actor.companyId },
        },
        select: { id: true },
      });
      if (!card) {
        await telegramBotService.answerCallbackQuery({
          callbackQueryId: callback.id,
          text: 'This task is not assigned to your FleetPilot account.',
        });
        return;
      }
      await telegramDeliveryService.createPendingTextAction({
        companyId: actor.companyId,
        userId: actor.userId,
        taskCardId: parsed.taskCardId,
        telegramChatId: actor.telegramChatId,
      });
      await this.queueAndDrainLinkedResponse({
        companyId: actor.companyId,
        userId: actor.userId,
        text: 'Send your update for this FleetPilot task.',
      });
      await telegramBotService.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Reply with your update.',
      });
      return;
    }

    if (parsed.action === 'start') {
      await taskService.startCardFromIntegration(parsed.taskCardId, {
        userId: actor.userId,
        displayName: actor.displayName,
        companyId: actor.companyId,
        role: actor.role,
        sourceType: 'TELEGRAM',
        sourceId: `telegram-callback:${updateId}`,
      });
      await this.queueAndDrainLinkedResponse({
        companyId: actor.companyId,
        userId: actor.userId,
        text: 'FleetPilot task moved to In Progress.',
      });
      await telegramBotService.answerCallbackQuery({
        callbackQueryId: callback.id,
        text: 'Task started.',
      });
      return;
    }

    await taskService.completeCardFromIntegration(parsed.taskCardId, {
      userId: actor.userId,
      displayName: actor.displayName,
      companyId: actor.companyId,
      role: actor.role,
      sourceType: 'TELEGRAM',
      sourceId: `telegram-callback:${updateId}`,
    });
    await this.queueAndDrainLinkedResponse({
      companyId: actor.companyId,
      userId: actor.userId,
      text: 'FleetPilot task marked complete.',
    });
    await telegramBotService.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: 'Task completed.',
    });
  }

  private async queueTaskList(
    actor: {
      userId: string;
      displayName: string;
      companyId: string;
    },
    dueOnly: boolean,
  ) {
    const tasks = await this.database.taskCard.findMany({
      where: {
        assigneeUserId: actor.userId,
        project: { companyId: actor.companyId },
        status: { notIn: ['DONE', 'CANCELLED'] },
        ...(dueOnly ? { dueDate: { not: null } } : {}),
      },
      include: { project: { select: { name: true } } },
      orderBy: dueOnly ? [{ dueDate: 'asc' }, { updatedAt: 'desc' }] : [{ updatedAt: 'desc' }],
      take: 5,
    });

    const text =
      tasks.length === 0
        ? dueOnly
          ? 'No overdue or upcoming assigned tasks.'
          : 'No open assigned tasks.'
        : [
            dueOnly ? 'Due tasks:' : 'Assigned tasks:',
            '',
            ...tasks.map(
              (task, index) =>
                `${index + 1}. ${task.title} — ${task.project.name}${
                  task.dueDate ? ` — ${task.dueDate.toLocaleString()}` : ''
                }`,
            ),
          ].join('\n');

    const replyMarkup =
      tasks.length === 0
        ? undefined
        : {
            inline_keyboard: tasks.flatMap((task) => [
              [{ text: `Open: ${task.title.slice(0, 24)}`, url: openTasksUrl() }],
              [
                { text: 'Start', callback_data: createTelegramCallbackData('start', task.id) },
                { text: 'Add Update', callback_data: createTelegramCallbackData('update', task.id) },
                { text: 'Complete', callback_data: createTelegramCallbackData('complete', task.id) },
              ],
            ]),
          };

    await this.queueAndDrainLinkedResponse({
      companyId: actor.companyId,
      userId: actor.userId,
      text,
      replyMarkup,
    });
  }

  private async recordInboundUpdate(input: {
    updateId: number;
    kind: string;
    companyId: string | null;
    telegramUserId: bigint | null;
    telegramChatId: bigint | null;
  }) {
    try {
      return await this.database.telegramInboundUpdate.create({
        data: {
          telegramUpdateId: BigInt(String(input.updateId)),
          kind: input.kind,
          companyId: input.companyId,
          telegramUserId: input.telegramUserId,
          telegramChatId: input.telegramChatId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  private async queueAndDrainLinkedResponse(input: {
    companyId: string;
    userId: string;
    text: string;
    replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> };
  }) {
    await telegramDeliveryService.enqueueCommandResponse(input);
    await telegramDeliveryService.drainDueDeliveries();
  }
}

export const telegramWebhookService = new TelegramWebhookService();
