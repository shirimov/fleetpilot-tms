import { NextRequest, NextResponse } from 'next/server';
import {
  parseTaskRequestBody,
  taskRouteErrorResponse,
} from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import {
  validateCreateTaskProjectInput,
  validateProjectId,
} from '@/lib/tasks/task-validation';
import { authorizationService } from '@/lib/auth/authorization';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { searchParams } = new URL(req.url);
    const projectId = validateProjectId(searchParams.get('projectId'));
    const projects = await taskService.getProjects(projectId, context.companyId);

    return NextResponse.json(projects);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const input = validateCreateTaskProjectInput(await parseTaskRequestBody(req));
    const project = await taskService.createProject(
      { ...input, companyId: context.companyId },
      { userId: context.user.id },
    );

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
