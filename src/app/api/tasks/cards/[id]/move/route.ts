import { NextResponse } from 'next/server';
import {
  parseTaskRequestBody,
  taskRouteErrorResponse,
} from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateMoveTaskCardInput } from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = validateMoveTaskCardInput(
      id,
      await parseTaskRequestBody(request),
    );
    const project = await taskService.moveCard(input);

    return NextResponse.json(project);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
