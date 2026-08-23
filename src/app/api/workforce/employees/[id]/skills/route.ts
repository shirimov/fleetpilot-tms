import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { workforceProfileService } from '@/lib/workforce/workforce-profile-service';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { id } = await params;
    const body = await request.json() as { skillIds?: unknown };
    if (!Array.isArray(body.skillIds) || body.skillIds.some((value) => typeof value !== 'string')) return NextResponse.json({ error: 'skillIds must be an array of IDs.' }, { status: 400 });
    return NextResponse.json({ skills: await workforceProfileService.setSkills(context, id, body.skillIds) });
  } catch (error) { return workforceRouteErrorResponse(error); }
}
