import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateTaskCardId } from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const route = await params;
    const cardId = validateTaskCardId(route.id);
    const attachmentId = validateTaskCardId(route.attachmentId);
    const context = await taskAuthorizationService.requireCard(cardId);
    await taskService.deleteAttachment(cardId, attachmentId, {
      userId: context.user.id,
      displayName: context.user.displayName,
      companyId: context.companyId,
      role: context.role,
    });
    return NextResponse.json(
      { success: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
