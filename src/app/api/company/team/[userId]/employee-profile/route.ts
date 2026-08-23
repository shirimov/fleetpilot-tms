import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import {
  workforceProfileService,
  type EmployeeProfileOnboardingInput,
} from '@/lib/workforce/workforce-profile-service';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { userId } = await params;
    const membership = await prisma.companyMembership.findUnique({
      where: {
        userId_companyId: { userId, companyId: context.companyId },
      },
      select: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
            isActive: true,
            employeeProfile: { select: { id: true } },
          },
        },
      },
    });
    if (!membership?.user.isActive) {
      return NextResponse.json({ error: 'Team member not found.' }, { status: 404 });
    }
    const [managers, unlinkedEmployees] = await Promise.all([
      prisma.employee.findMany({
        where: {
          companyId: context.companyId,
          employmentStatus: { not: 'TERMINATED' },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, jobTitle: true },
      }),
      prisma.employee.findMany({
        where: {
          companyId: context.companyId,
          userId: null,
          isActive: true,
          employmentStatus: { not: 'TERMINATED' },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          jobTitle: true,
          department: true,
        },
      }),
    ]);
    return NextResponse.json(
      { user: membership.user, managers, unlinkedEmployees },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { userId } = await params;
    const input = await request.json() as EmployeeProfileOnboardingInput;
    const employee = await workforceProfileService.createForUser(
      context,
      userId,
      input,
    );
    return NextResponse.json(
      { employeeId: employee.id, userId: employee.userId },
      { status: 201 },
    );
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { userId } = await params;
    const body = await request.json() as { employeeId?: unknown };
    if (typeof body.employeeId !== 'string' || !body.employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required.' },
        { status: 400 },
      );
    }
    const employee = await workforceProfileService.linkUser(
      context,
      body.employeeId,
      userId,
    );
    return NextResponse.json({ employeeId: employee.id, userId: employee.userId });
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}
