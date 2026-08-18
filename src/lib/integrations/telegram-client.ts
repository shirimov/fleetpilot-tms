import { setTimeout as delay } from 'node:timers/promises';
import { getTelegramConfig } from './telegram-config';
import type { TelegramInlineKeyboardMarkup } from './telegram-types';

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_DIRECT_ATTEMPTS = 3;

export class TelegramConfigurationError extends Error {
  constructor() {
    super('Telegram integration is not configured.');
  }
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly options: {
      transient: boolean;
      retryAfterSeconds?: number;
      permanentCode?: number;
    },
  ) {
    super(message);
  }
}

function safeErrorMessage(error: unknown) {
  if (error instanceof TelegramApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unknown Telegram delivery error.';
}

export function sanitizeTelegramError(error: unknown) {
  const message = safeErrorMessage(error).replace(/bot\d+:[A-Za-z0-9_-]+/g, '[redacted]');
  return message.length > 400 ? `${message.slice(0, 397)}...` : message;
}

export class TelegramBotService {
  constructor(private readonly fetchImpl?: FetchLike) {}

  private get config() {
    const config = getTelegramConfig();
    if (!config) throw new TelegramConfigurationError();
    return config;
  }

  async sendMessage(input: {
    chatId: bigint;
    text: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }) {
    const body: Record<string, unknown> = {
      chat_id: input.chatId.toString(),
      text: input.text,
      disable_web_page_preview: true,
    };
    if (input.replyMarkup) body.reply_markup = input.replyMarkup;
    const payload = await this.callTelegramApi('sendMessage', body);
    const result = payload.result as { message_id: number | string };
    return { messageId: BigInt(String(result.message_id)) };
  }

  async answerCallbackQuery(input: { callbackQueryId: string; text?: string }) {
    await this.callTelegramApi('answerCallbackQuery', {
      callback_query_id: input.callbackQueryId,
      text: input.text,
      show_alert: false,
    });
  }

  private async callTelegramApi(method: string, body: Record<string, unknown>) {
    const { botToken } = this.config;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < MAX_DIRECT_ATTEMPTS) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await (this.fetchImpl ?? fetch)(
          `https://api.telegram.org/bot${botToken}/${method}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        clearTimeout(timeout);

        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          description?: string;
          parameters?: { retry_after?: number };
          result?: unknown;
          error_code?: number;
        };

        if (response.ok && payload.ok !== false) return payload;

        const retryAfterSeconds = payload.parameters?.retry_after;
        const description = payload.description ?? `Telegram API ${response.status}`;
        const transient =
          response.status === 429 || response.status >= 500 || response.status === 408;
        const apiError = new TelegramApiError(description, {
          transient,
          retryAfterSeconds,
          permanentCode: transient ? undefined : response.status,
        });
        if (!transient || attempt >= MAX_DIRECT_ATTEMPTS) throw apiError;
        await delay((retryAfterSeconds ?? attempt) * 1000);
        lastError = apiError;
        continue;
      } catch (error) {
        clearTimeout(timeout);
        const normalized =
          error instanceof TelegramApiError
            ? error
            : error instanceof Error && error.name === 'AbortError'
              ? new TelegramApiError('Telegram API timeout.', { transient: true })
              : new TelegramApiError('Telegram network error.', { transient: true });
        if (!normalized.options.transient || attempt >= MAX_DIRECT_ATTEMPTS) throw normalized;
        lastError = normalized;
        await delay(attempt * 500);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new TelegramApiError('Telegram delivery failed.', { transient: true });
  }
}

export const telegramBotService = new TelegramBotService();
