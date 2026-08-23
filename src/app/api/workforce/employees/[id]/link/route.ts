import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { workforceProfileService } from '@/lib/workforce/workforce-profile-service';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { id } = await params;
    const body = await request.json() as { userId?: unknown };
    if (body.userId !== null && typeof body.userId !== 'string') return NextResponse.json({ error: 'userId must be a string or null.' }, { status: 400 });
    const employee = await workforceProfileService.linkUser(context, id, body.userId ?? null);
    return NextResponse.json({ employeeId: employee.id, userId: employee.userId });
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}
