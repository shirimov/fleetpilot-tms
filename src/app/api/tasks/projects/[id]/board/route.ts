import { NextResponse } from 'next/server';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateRequiredProjectId } from '@/lib/tasks/task-validation';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const projectId = validateRequiredProjectId(id);
    const context = await taskAuthorizationService.requireProject(projectId);
    const search = new URL(request.url).searchParams;
    const rawView = search.get('view');
    const rawPeriod = search.get('period');
    const view = rawView === 'completed' || rawView === 'archived' ? rawView : 'active';
    const period = rawPeriod === 'week' || rawPeriod === 'month' || rawPeriod === 'all' ? rawPeriod : 'today';
    const employee = await taskService.getUserTimeZone(context.companyId, context.user.id);
    const project = await taskService.getProjectBoard(
      projectId,
      context.companyId,
      { view, period, timeZone: employee },
    );

    return NextResponse.json(project);
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
