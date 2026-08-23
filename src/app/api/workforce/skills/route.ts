import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    return NextResponse.json(await prisma.employeeSkillDefinition.findMany({ where: { companyId: context.companyId }, orderBy: { name: 'asc' } }));
  } catch (error) { return workforceRouteErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const body = await request.json() as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return NextResponse.json({ error: 'Skill name is required and must be at most 80 characters.' }, { status: 400 });
    return NextResponse.json(await prisma.employeeSkillDefinition.create({ data: { companyId: context.companyId, name } }), { status: 201 });
  } catch (error) { return workforceRouteErrorResponse(error); }
}
