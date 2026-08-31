import { after, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/prisma';
import { bankProviderConfiguration } from '@/lib/finance/bank-token-crypto';
import { verifyPlaidWebhook } from '@/lib/finance/plaid-webhook';
import { bankSyncService } from '@/lib/finance/bank-sync-service';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

const MAX_WEBHOOK_BYTES = 64 * 1024;

function response(status = 200) {
  return NextResponse.json({ received: status === 200 }, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export async function POST(request: Request) {
  let authenticated = false;
  try {
    if (!bankProviderConfiguration().plaidConfigured) return response(503);
    const rawBody = await request.text();
    if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
      return response(400);
    }
    const verified = await verifyPlaidWebhook(
      rawBody,
      request.headers.get('plaid-verification'),
      async (keyId) => {
        const keyResponse = await plaidClient.webhookVerificationKeyGet({ key_id: keyId });
        return keyResponse.data.key;
      },
    );
    authenticated = true;
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const itemId = typeof payload.item_id === 'string' ? payload.item_id : '';
    const webhookType = typeof payload.webhook_type === 'string' ? payload.webhook_type : '';
    const webhookCode = typeof payload.webhook_code === 'string' ? payload.webhook_code : '';
    if (!itemId || !webhookType || !webhookCode) return response(400);
    const connection = await prisma.bankAccount.findFirst({
      where: {
        provider: 'PLAID',
        externalConnectionId: itemId,
        status: { notIn: ['DISABLED', 'REVOKED'] },
      },
      select: { id: true },
    });
    if (!connection) return response();
    const status = webhookType === 'TRANSACTIONS' && webhookCode === 'SYNC_UPDATES_AVAILABLE'
      ? 'QUEUED'
      : 'IGNORED';
    const created = await prisma.bankProviderWebhookEvent.createMany({
      data: [{
        bankAccountId: connection.id,
        provider: 'PLAID',
        eventHashSha256: verified.eventHash,
        webhookType,
        webhookCode,
        status,
      }],
      skipDuplicates: true,
    });
    if (created.count && status === 'QUEUED') {
      const event = await prisma.bankProviderWebhookEvent.findUnique({
        where: {
          provider_eventHashSha256: {
            provider: 'PLAID',
            eventHashSha256: verified.eventHash,
          },
        },
        select: { id: true },
      });
      if (event) after(() => bankSyncService.syncWebhookEvent(event.id));
    }
    return response();
  } catch {
    return response(authenticated ? 500 : 400);
  }
}
