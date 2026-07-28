import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import {
  parseTaskRequestBody,
  taskRouteErrorResponse,
} from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import {
  validateTaskCardId,
  validateUpdateChecklistItemInput,
} from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const route = await params;
    const cardId = validateTaskCardId(route.id);
    const context = await taskAuthorizationService.requireCard(cardId);
    const input = validateUpdateChecklistItemInput(
      cardId,
      route.itemId,
      await parseTaskRequestBody(request),
    );
    return NextResponse.json(
      await taskService.updateChecklistItem(input, {
        userId: context.user.id,
        displayName: context.user.displayName,
        companyId: context.companyId,
        role: context.role,
      }),
    );
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const route = await params;
    const cardId = validateTaskCardId(route.id);
    const itemId = validateTaskCardId(route.itemId);
    const context = await taskAuthorizationService.requireCard(cardId);
    await taskService.deleteChecklistItem(cardId, itemId, {
      userId: context.user.id,
      displayName: context.user.displayName,
      companyId: context.companyId,
      role: context.role,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
