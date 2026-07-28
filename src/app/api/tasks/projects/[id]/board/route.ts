import { NextResponse } from 'next/server';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateRequiredProjectId } from '@/lib/tasks/task-validation';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const projectId = validateRequiredProjectId(id);
    const context = await taskAuthorizationService.requireProject(projectId);
    const project = await taskService.getProjectBoard(
      projectId,
      context.companyId,
    );

    return NextResponse.json(project);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
