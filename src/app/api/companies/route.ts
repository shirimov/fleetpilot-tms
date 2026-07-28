import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany();
    const company = await prisma.company.findUnique({
      where: { id: context.companyId },
      select: {
        id: true,
        name: true,
        dotNumber: true,
        mcNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json(company ? [company] : []);
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Company request failed.' }, { status: 500 })
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorizationService.requireUser();
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 });
    }
    const companyName = body.name.trim();

    const company = await prisma.$transaction(async (transaction) => {
      const created = await transaction.company.create({
        data: {
          name: companyName,
          dotNumber:
            typeof body.dotNumber === 'string' ? body.dotNumber.trim() || null : null,
          mcNumber:
            typeof body.mcNumber === 'string' ? body.mcNumber.trim() || null : null,
        },
      });
      await transaction.companyMembership.create({
        data: { userId: user.id, companyId: created.id, role: 'OWNER' },
      });
      if (!user.activeCompanyId) {
        await transaction.user.update({
          where: { id: user.id },
          data: { activeCompanyId: created.id },
        });
      }
      return created;
    });
    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Company request failed.' }, { status: 500 })
    );
  }
}
