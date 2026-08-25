import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateTaskCardId } from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    return NextResponse.json(await taskService.getArchivePolicy(cardId, {
      userId: context.user.id,
      displayName: context.user.displayName,
      companyId: context.companyId,
      role: context.role,
    }));
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
