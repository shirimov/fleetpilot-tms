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

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = validateProjectId(searchParams.get('projectId'));
    const projects = await taskService.getProjects(projectId);

    return NextResponse.json(projects);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = validateCreateTaskProjectInput(await parseTaskRequestBody(req));
    const project = await taskService.createProject(input);

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
