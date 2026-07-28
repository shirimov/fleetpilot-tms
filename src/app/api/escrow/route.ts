import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { workforceAuthorizationService } from '@/lib/workforce/workforce-authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function GET() {
  try {
    const context = await workforceAuthorizationService.requireCompany();
    const employees = await prisma.employee.findMany({
      where: { companyId: context.companyId },
      select: { id: true },
    });
    const escrows = await prisma.employeeEscrow.findMany({
      where: { employeeId: { in: employees.map(({ id }) => id) } },
      include: { transactions: { orderBy: { createdAt: 'desc' } } },
    });
    return NextResponse.json(escrows);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch escrow');
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    await workforceAuthorizationService.requireEmployee(data.employeeId);
    const escrow = await prisma.employeeEscrow.upsert({
      where: { employeeId: data.employeeId },
      create: {
        employeeId: data.employeeId,
        balance: 0,
        target: data.target || 0,
      },
      update: { target: data.target || 0 },
    });
    return NextResponse.json(escrow);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to update escrow');
  }
}
