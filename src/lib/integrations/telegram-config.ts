export type TelegramConfig = {
  enabled: true;
  botToken: string;
  webhookSecret: string;
  botUsername: string;
};

function normalizedTrue(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export function getTelegramConfig(): TelegramConfig | null {
  if (!normalizedTrue(process.env.TELEGRAM_ENABLED)) return null;

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@+/, '');

  if (!botToken || !webhookSecret || !botUsername) return null;

  return {
    enabled: true,
    botToken,
    webhookSecret,
    botUsername,
  };
}
