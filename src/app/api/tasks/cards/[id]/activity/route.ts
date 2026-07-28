import { NextResponse } from 'next/server';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateTaskCardId } from '@/lib/tasks/task-validation';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const cardId = validateTaskCardId(id);
    const context = await taskAuthorizationService.requireCardActivity(cardId);
    const activities = await taskService.getCardActivity(
      cardId,
      context.companyId,
    );

    return NextResponse.json(activities);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
