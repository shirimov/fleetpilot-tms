import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramWebhook } from '@/lib/integrations/telegram-webhook';

export async function POST(request: NextRequest) {
  const verification = verifyTelegramWebhook(
    request.headers.get('x-telegram-bot-api-secret-token'),
    process.env.TELEGRAM_WEBHOOK_SECRET,
  );
  if (verification === 'unconfigured') {
    return NextResponse.json(
      { ok: false, error: 'Telegram integration is unavailable.' },
      { status: 503 },
    );
  }
  if (verification === 'invalid') {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized.' },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        'Telegram integration is unavailable until company routing is configured.',
    },
    { status: 503 },
  );
}
