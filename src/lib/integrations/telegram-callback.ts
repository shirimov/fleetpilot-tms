import { createHmac, timingSafeEqual } from 'node:crypto';
import { getTelegramConfig } from './telegram-config';

export type TelegramCallbackAction = 'start' | 'complete' | 'update' | 'open';

const ACTION_CODES: Record<TelegramCallbackAction, string> = {
  start: 's',
  complete: 'c',
  update: 'u',
  open: 'o',
};

const CODE_ACTIONS = Object.fromEntries(
  Object.entries(ACTION_CODES).map(([action, code]) => [code, action]),
) as Record<string, TelegramCallbackAction>;

const TTL_SECONDS = 60 * 60 * 24;

function callbackSecret() {
  const config = getTelegramConfig();
  if (!config) throw new Error('Telegram integration is unavailable.');
  return config.webhookSecret;
}

function signatureFor(raw: string) {
  return createHmac('sha256', callbackSecret()).update(raw).digest('base64url').slice(0, 12);
}

export function createTelegramCallbackData(
  action: TelegramCallbackAction,
  taskCardId: string,
  expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS,
) {
  const actionCode = ACTION_CODES[action];
  const raw = `${actionCode}:${taskCardId}:${expiresAt}`;
  return `${raw}:${signatureFor(raw)}`;
}

export function parseTelegramCallbackData(callbackData: string) {
  const [actionCode, taskCardId, expiresAtRaw, signature] = callbackData.split(':');
  if (!actionCode || !taskCardId || !expiresAtRaw || !signature) return null;
  const action = CODE_ACTIONS[actionCode];
  const expiresAt = Number(expiresAtRaw);
  if (!action || !Number.isInteger(expiresAt)) return null;
  if (expiresAt < Math.floor(Date.now() / 1000)) return null;

  const raw = `${actionCode}:${taskCardId}:${expiresAtRaw}`;
  const expected = Buffer.from(signatureFor(raw));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  return { action, taskCardId };
}
