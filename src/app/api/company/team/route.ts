import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { normalizeEmail } from '@/lib/auth/account-linking';

export const dynamic = 'force-dynamic';

const VALID_ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER']);

export async function GET(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { companyId } = context;

    // Allow the client to supply start/end ISO datetimes that define "today" in the user's timezone.
    // This avoids using the server's local timezone and lets the UI compute day boundaries in the browser.
    const url = new URL(request.url);
    const startIso = url.searchParams.get('start') ?? null;
    const endIso = url.searchParams.get('end') ?? null;

    let startOfDay: Date | null = null;
    let nextDay: Date | null = null;
    const now = new Date();

    // Strict validation rules per PR: if either start or end provided alone -> 400; if provided but invalid -> 400; if start >= end -> 400.
    if (startIso || endIso) {
      if (!startIso || !endIso) {
        return NextResponse.json({ error: 'both start and end are required when specifying boundaries.' }, { status: 400 });
      }
      const s = new Date(startIso as string);
      const e = new Date(endIso as string);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
        return NextResponse.json({ error: 'invalid start or end datetime.' }, { status: 400 });
      }
      if (s.getTime() >= e.getTime()) {
        return NextResponse.json({ error: 'start must be before end.' }, { status: 400 });
      }
      startOfDay = s;
      nextDay = e;
    } else {
      // Neither supplied -> explicit UTC-day fallback
      const utcNow = new Date();
      const utcStart = new Date(Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), utcNow.getUTCDate()));
      const utcNext = new Date(utcStart);
      utcNext.setUTCDate(utcStart.getUTCDate() + 1);
      startOfDay = utcStart;
      nextDay = utcNext;
    }

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

    // Enforce OWNER-only creation of OWNER memberships.
    if (role === 'OWNER' && context.role !== 'OWNER') {
      return NextResponse.json({ error: 'only OWNER may create OWNER membership.' }, { status: 403 });
    }

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

    // Only OWNER may promote to OWNER or demote an OWNER.
    if (role !== undefined) {
      if (role === 'OWNER' && context.role !== 'OWNER') {
        return NextResponse.json({ error: 'only OWNER may assign OWNER role.' }, { status: 403 });
      }
      if (membership.role === 'OWNER' && context.role !== 'OWNER') {
        return NextResponse.json({ error: 'only OWNER may modify an OWNER membership.' }, { status: 403 });
      }
    }

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

    // Only OWNER may remove an OWNER membership.
    if (membership.role === 'OWNER' && context.role !== 'OWNER') {
      return NextResponse.json({ error: 'only OWNER may remove an OWNER membership.' }, { status: 403 });
    }

    // Prevent removing the last OWNER
    if (membership.role === 'OWNER') {
      const ownerCount = await prisma.companyMembership.count({ where: { companyId, role: 'OWNER' } });
      if (ownerCount <= 1) {
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
