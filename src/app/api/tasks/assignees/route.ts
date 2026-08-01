import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany();
    return NextResponse.json(
      await taskService.getAssigneeCandidates(context.companyId),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
