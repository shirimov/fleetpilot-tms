import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import {
  parseTaskRequestBody,
  taskRouteErrorResponse,
} from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import {
  validateCreateCommentInput,
  validateTaskCardId,
} from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    return NextResponse.json(
      await taskService.getComments(cardId, {
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

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    const input = validateCreateCommentInput(
      cardId,
      await parseTaskRequestBody(request),
    );
    const comment = await taskService.createComment(input, {
      userId: context.user.id,
      displayName: context.user.displayName,
      companyId: context.companyId,
      role: context.role,
    });
    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
