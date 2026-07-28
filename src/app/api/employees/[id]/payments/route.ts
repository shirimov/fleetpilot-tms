import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { workforceAuthorizationService } from '@/lib/workforce/workforce-authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await workforceAuthorizationService.requireEmployee(id);
    const payments = await prisma.employeePayment.findMany({
      where: { employeeId: id, employee: { companyId: context.companyId } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(payments);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch payments');
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await workforceAuthorizationService.requireEmployee(id);
    const data = await request.json();
    const payment = await prisma.employeePayment.create({
      data: {
        employeeId: id,
        amount: parseFloat(data.amount),
        currency: data.currency || 'USD',
        period: data.period,
        method: data.method || 'Bank Transfer',
        status: data.status || 'PENDING',
        paidAt: data.paidAt ? new Date(data.paidAt) : null,
        notes: data.notes || null,
      },
    });
    return NextResponse.json(payment);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to create payment');
  }
}
