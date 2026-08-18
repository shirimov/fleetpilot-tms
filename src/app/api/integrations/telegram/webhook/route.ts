import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramWebhook } from '@/lib/integrations/telegram-webhook';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { getTelegramConfig } from '@/lib/integrations/telegram-config';
import { telegramWebhookService } from '@/lib/integrations/telegram-webhook-service';

const MAX_WEBHOOK_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const config = getTelegramConfig();
  const verification = verifyTelegramWebhook(
    request.headers.get('x-telegram-bot-api-secret-token'),
    config?.webhookSecret,
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

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Payload too large.' },
      { status: 413, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Request body must contain valid JSON.' },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json(
        { ok: false, error: 'Malformed Telegram payload.' },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    await telegramWebhookService.handleUpdate(payload);
    return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
