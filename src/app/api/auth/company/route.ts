import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany();
    const memberships = await prisma.companyMembership.findMany({
      where: { userId: context.user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        role: true,
        company: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(
      {
        user: {
          displayName: context.user.displayName,
          email: context.user.email,
          image: null,
        },
        activeCompanyId: context.companyId,
        companies: memberships.map(({ company, role }) => ({
          ...company,
          role,
        })),
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: 'Company context could not be loaded.' },
        { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
      )
    );
  }
}

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
