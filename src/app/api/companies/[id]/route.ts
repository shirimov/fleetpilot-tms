import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await authorizationService.requireCompanyMembership(id, 'ADMIN');
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 });
    }
    const company = await prisma.company.update({
      where: { id },
      data: {
        name: body.name.trim(),
        dotNumber:
          typeof body.dotNumber === 'string' ? body.dotNumber.trim() || null : null,
        mcNumber:
          typeof body.mcNumber === 'string' ? body.mcNumber.trim() || null : null,
      },
    });
    return NextResponse.json(company);
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Company request failed.' }, { status: 500 })
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await authorizationService.requireCompanyMembership(id, 'OWNER');
    await prisma.company.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Company request failed.' }, { status: 500 })
    );
  }
}
