import { timingSafeEqual } from 'node:crypto';

export type TelegramWebhookVerification =
  | 'verified'
  | 'invalid'
  | 'unconfigured';

export function verifyTelegramWebhook(
  receivedSecret: string | null,
  configuredSecret: string | undefined,
): TelegramWebhookVerification {
  if (!configuredSecret) return 'unconfigured';
  if (!receivedSecret) return 'invalid';

  const received = Buffer.from(receivedSecret);
  const configured = Buffer.from(configuredSecret);
  if (received.length !== configured.length) return 'invalid';
  return timingSafeEqual(received, configured) ? 'verified' : 'invalid';
}
