import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import {
  parseTaskRequestBody,
  taskRouteErrorResponse,
} from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import {
  validateTaskCardId,
  validateUpdateCommentInput,
} from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; commentId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const route = await params;
    const cardId = validateTaskCardId(route.id);
    const context = await taskAuthorizationService.requireCard(cardId);
    const input = validateUpdateCommentInput(
      cardId,
      route.commentId,
      await parseTaskRequestBody(request),
    );
    return NextResponse.json(
      await taskService.updateComment(input, {
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
    const commentId = validateTaskCardId(route.commentId);
    const context = await taskAuthorizationService.requireCard(cardId);
    await taskService.deleteComment(cardId, commentId, {
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
