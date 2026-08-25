import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateTaskCardId } from '@/lib/tasks/task-validation';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const body = await request.json() as { archived?: unknown };
    if (typeof body.archived !== 'boolean') return NextResponse.json({ error: 'archived must be a boolean.' }, { status: 400 });
    const context = await taskAuthorizationService.requireCard(cardId);
    await taskService.setCardArchived(cardId, body.archived, {
      userId: context.user.id,
      displayName: context.user.displayName,
      companyId: context.companyId,
      role: context.role,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
