import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { workforceAuthorizationService } from '@/lib/workforce/workforce-authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function PATCH(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; paymentId: string }> },
) {
  try {
    const { id, paymentId } = await params;
    await workforceAuthorizationService.requirePayment(id, paymentId);
    const data = await request.json();
    const payment = await prisma.employeePayment.update({
      where: { id: paymentId, employeeId: id },
      data: {
        status: data.status,
        paidAt: data.paidAt ? new Date(data.paidAt) : null,
      },
    });
    return NextResponse.json(payment);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to update payment');
  }
}
