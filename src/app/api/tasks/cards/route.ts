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

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const input = validateCreateTaskCardInput(await parseTaskRequestBody(req));
    const card = await taskService.createCard(input);

    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const input = validateUpdateTaskCardInput(await parseTaskRequestBody(req));
    const card = await taskService.updateCard(input);

    return NextResponse.json(card);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cardId = validateTaskCardId(searchParams.get('id'));
    await taskService.deleteCard(cardId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
