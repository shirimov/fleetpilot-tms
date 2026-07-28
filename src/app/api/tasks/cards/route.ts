import { NextRequest, NextResponse } from 'next/server';
import {
  parseTaskRequestBody,
  taskRouteErrorResponse,
} from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import {
  validateCreateTaskCardInput,
  validateTaskCardId,
  validateUpdateTaskCardInput,
} from '@/lib/tasks/task-validation';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const input = validateCreateTaskCardInput(await parseTaskRequestBody(req));
    const context = await taskAuthorizationService.requireProject(input.projectId);
    const card = await taskService.createCard(input, { userId: context.user.id });

    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const input = validateUpdateTaskCardInput(await parseTaskRequestBody(req));
    const context = await taskAuthorizationService.requireCard(input.id);
    const card = await taskService.updateCard(input, {
      userId: context.user.id,
      displayName: context.user.displayName,
      companyId: context.companyId,
      role: context.role,
    });

    return NextResponse.json(card);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cardId = validateTaskCardId(searchParams.get('id'));
    const context = await taskAuthorizationService.requireCard(cardId);
    await taskService.deleteCard(cardId, { userId: context.user.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
