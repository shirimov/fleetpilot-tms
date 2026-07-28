import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { workforceAuthorizationService } from '@/lib/workforce/workforce-authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function GET() {
  try {
    const context = await workforceAuthorizationService.requireCompany();
    const employees = await prisma.employee.findMany({
      where: { companyId: context.companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return NextResponse.json(employees);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch employees');
  }
}

export async function POST(request: Request) {
  try {
    const context = await workforceAuthorizationService.requireCompany();
    const data = await request.json();
    const employee = await prisma.employee.create({
      data: {
        companyId: context.companyId,
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
        notes: data.notes || null,
      },
    });
    return NextResponse.json(employee);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to create employee');
  }
}
