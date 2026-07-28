import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, 100) ?? '';
    return NextResponse.json(
      await taskService.getMentionCandidates(context.companyId, query),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
