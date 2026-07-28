import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import {
  parseTaskRequestBody,
  taskRouteErrorResponse,
} from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import {
  validateCreateChecklistItemInput,
  validateReorderChecklistInput,
  validateTaskCardId,
} from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    return NextResponse.json(
      await taskService.getChecklist(cardId, context.companyId),
    );
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    const input = validateCreateChecklistItemInput(
      cardId,
      await parseTaskRequestBody(request),
    );
    const item = await taskService.createChecklistItem(input, {
      userId: context.user.id,
      displayName: context.user.displayName,
      companyId: context.companyId,
      role: context.role,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    const input = validateReorderChecklistInput(
      cardId,
      await parseTaskRequestBody(request),
    );
    return NextResponse.json(
      await taskService.reorderChecklist(input, {
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
