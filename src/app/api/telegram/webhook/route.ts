import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramWebhook } from '@/lib/integrations/telegram-webhook';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

export async function POST(request: NextRequest) {
  const verification = verifyTelegramWebhook(
    request.headers.get('x-telegram-bot-api-secret-token'),
    process.env.TELEGRAM_WEBHOOK_SECRET,
  );
  if (verification === 'unconfigured') {
    return NextResponse.json(
      { ok: false, error: 'Telegram integration is unavailable.' },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if (verification === 'invalid') {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized.' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        'Telegram integration is unavailable until company routing is configured.',
    },
    { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
  );
}
