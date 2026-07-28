import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.companyId !== 'string' || !body.companyId.trim()) {
      return NextResponse.json(
        { error: 'companyId is required.' },
        { status: 400 },
      );
    }

    const context = await authorizationService.setActiveCompany(
      body.companyId.trim(),
    );
    return NextResponse.json({
      companyId: context.companyId,
      role: context.role,
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: 'Active company could not be changed.' },
        { status: 500 },
      )
    );
  }
}
