import { NextResponse } from 'next/server';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateRequiredProjectId } from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const projectId = validateRequiredProjectId(id);
    const project = await taskService.getProjectBoard(projectId);

    return NextResponse.json(project);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
