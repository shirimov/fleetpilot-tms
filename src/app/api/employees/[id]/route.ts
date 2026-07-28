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
    const employee = await prisma.employee.findFirst({
      where: { id, companyId: context.companyId },
      include: { payments: { orderBy: { createdAt: 'desc' } } },
    });
    return NextResponse.json(employee);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch employee');
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await workforceAuthorizationService.requireEmployee(id);
    const data = await request.json();
    const employee = await prisma.employee.update({
      where: { id, companyId: context.companyId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        roleCustom: data.roleCustom || null,
        phone: data.phone || null,
        email: data.email || null,
        country: data.country || 'Turkmenistan',
        city: data.city || null,
        region: data.region || null,
        salary: data.salary ? parseFloat(data.salary) : null,
        currency: data.currency || 'USD',
        paymentMethod: data.paymentMethod || 'Bank Transfer',
        startDate: data.startDate ? new Date(data.startDate) : null,
        isActive: data.isActive,
        notes: data.notes || null,
      },
    });
    return NextResponse.json(employee);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to update employee');
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await workforceAuthorizationService.requireEmployee(id);
    await prisma.employee.delete({
      where: { id, companyId: context.companyId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to delete employee');
  }
}
