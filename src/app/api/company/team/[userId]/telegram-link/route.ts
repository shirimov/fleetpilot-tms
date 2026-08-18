import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { telegramLinkService } from '@/lib/integrations/telegram-link-service';

type RouteContext = { params: Promise<{ userId: string }> };

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { userId } = await params;
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: context.user.id,
      actorRole: context.role,
      companyId: context.companyId,
      userId,
    });
    return NextResponse.json(invitation, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Telegram invitation failed.' },
        {
          status:
            error instanceof Error &&
            error.message === 'Telegram integration is unavailable.'
              ? 503
              : 400,
          headers: { 'Cache-Control': 'private, no-store' },
        },
      )
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { userId } = await params;
    return NextResponse.json(
      await telegramLinkService.disconnectLink({
        actorUserId: context.user.id,
        actorRole: context.role,
        companyId: context.companyId,
        userId,
      }),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Telegram disconnect failed.' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
      )
    );
  }
}
