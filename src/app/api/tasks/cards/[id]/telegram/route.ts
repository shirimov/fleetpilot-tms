import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { validateTaskCardId } from '@/lib/tasks/task-validation';
import { telegramDeliveryService } from '@/lib/integrations/telegram-delivery-service';

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    return NextResponse.json(
      await telegramDeliveryService.getTaskTelegramSummary(cardId, context.companyId),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await authorizationService.requireActiveCompany('ADMIN');
    await telegramDeliveryService.createUpdateRequest({
      companyId: context.companyId,
      requestedByUserId: context.user.id,
      requestedByRole: context.role,
      requestedByDisplayName: context.user.displayName,
      taskCardId: cardId,
    });
    await telegramDeliveryService.drainDueDeliveries();
    return NextResponse.json({ success: true }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
