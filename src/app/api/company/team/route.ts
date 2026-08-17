import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { normalizeEmail } from '@/lib/auth/account-linking';

export const dynamic = 'force-dynamic';

const VALID_ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER']);

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { companyId } = context;
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const nextDay = new Date(startOfDay);
    nextDay.setDate(startOfDay.getDate() + 1);

    const [memberships, openGroups, overdueGroups, dueTodayGroups] =
      await Promise.all([
        prisma.companyMembership.findMany({
          where: { companyId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            user: { select: { id: true, displayName: true, email: true, image: true, isActive: true } },
          },
        }),
        prisma.taskCard.groupBy({
          by: ['assigneeUserId'],
          where: {
            project: { companyId },
            assigneeUserId: { not: null },
            status: { notIn: ['DONE', 'CANCELLED'] },
          },
          _count: { _all: true },
        }),
        prisma.taskCard.groupBy({
          by: ['assigneeUserId'],
          where: {
            project: { companyId },
            assigneeUserId: { not: null },
            status: { notIn: ['DONE', 'CANCELLED'] },
            dueDate: { lt: now },
          },
          _count: { _all: true },
        }),
        prisma.taskCard.groupBy({
          by: ['assigneeUserId'],
          where: {
            project: { companyId },
            assigneeUserId: { not: null },
            status: { notIn: ['DONE', 'CANCELLED'] },
            dueDate: { gte: startOfDay, lt: nextDay },
          },
          _count: { _all: true },
        }),
      ]);

    const openMap = new Map<string, number>();
    for (const g of openGroups) {
      if (g.assigneeUserId) openMap.set(g.assigneeUserId, g._count._all);
    }
    const overdueMap = new Map<string, number>();
    for (const g of overdueGroups) {
      if (g.assigneeUserId) overdueMap.set(g.assigneeUserId, g._count._all);
    }
    const dueTodayMap = new Map<string, number>();
    for (const g of dueTodayGroups) {
      if (g.assigneeUserId) dueTodayMap.set(g.assigneeUserId, g._count._all);
    }

    const result = memberships.map((m) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      user: {
        id: m.user.id,
        displayName: m.user.displayName,
        email: m.user.email,
        image: m.user.image,
        isActive: m.user.isActive,
      },
      openTasks: openMap.get(m.user.id) ?? 0,
      overdueTasks: overdueMap.get(m.user.id) ?? 0,
      dueToday: dueTodayMap.get(m.user.id) ?? 0,
      telegramStatus: 'Not connected',
    }));

    return NextResponse.json({ members: result, currentUserRole: context.role }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Team request failed.' }, { status: 500 })
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { companyId } = context;
    const body = (await request.json()) as Record<string, unknown>;

    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
    const role = typeof body.role === 'string' ? body.role.trim() : '';

    if (!emailRaw) return NextResponse.json({ error: 'email is required.' }, { status: 400 });
    const email = normalizeEmail(emailRaw);
    if (!email) return NextResponse.json({ error: 'invalid email.' }, { status: 400 });
    if (!VALID_ROLES.has(role)) return NextResponse.json({ error: 'invalid role.' }, { status: 400 });

    const created = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        user = await tx.user.create({ data: { email, displayName: displayName || email } });
      }

      const existingMembership = await tx.companyMembership.findUnique({ where: { userId_companyId: { userId: user.id, companyId } } });
      if (existingMembership) {
        throw new Error('MEMBERSHIP_EXISTS');
      }

      const membership = await tx.companyMembership.create({ data: { userId: user.id, companyId, role: role as any } });
      return { membership, user };
    });

    return NextResponse.json({ membership: { id: created.membership.id, role: created.membership.role }, user: { id: created.user.id, email: created.user.email, displayName: created.user.displayName, image: created.user.image } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'MEMBERSHIP_EXISTS') {
      return NextResponse.json({ error: 'membership already exists' }, { status: 409 });
    }
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Team create failed.' }, { status: 500 })
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { companyId } = context;
    const body = (await request.json()) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId : null;
    const role = typeof body.role === 'string' ? body.role.trim() : undefined;

    if (!userId) return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
    if (role !== undefined && !VALID_ROLES.has(role)) return NextResponse.json({ error: 'invalid role.' }, { status: 400 });

    const membership = await prisma.companyMembership.findUnique({ where: { userId_companyId: { userId, companyId } } });
    if (!membership) return NextResponse.json({ error: 'membership not found.' }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;

    const updated = await prisma.companyMembership.update({ where: { id: membership.id }, data: updates });
    return NextResponse.json({ membership: updated });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Team update failed.' }, { status: 500 })
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { companyId, user: actor } = context;
    const body = (await request.json()) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId : null;
    if (!userId) return NextResponse.json({ error: 'userId is required.' }, { status: 400 });

    const membership = await prisma.companyMembership.findUnique({ where: { userId_companyId: { userId, companyId } } });
    if (!membership) return NextResponse.json({ error: 'membership not found.' }, { status: 404 });

    // Prevent removing the last OWNER
    if (membership.role === 'OWNER') {
      const ownerCount = await prisma.companyMembership.count({ where: { companyId, role: 'OWNER' } });
      if (ownerCount <= 1) {
        // If actor is trying to remove self and they're the last owner, block
        if (actor.user.id === userId) {
          return NextResponse.json({ error: 'cannot remove the last owner from the company.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'company must have at least one owner.' }, { status: 400 });
      }
    }

    await prisma.companyMembership.delete({ where: { id: membership.id } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Team delete failed.' }, { status: 500 })
    );
  }
}
