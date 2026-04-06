import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const priority = searchParams.get('priority');
    const category = searchParams.get('category');
    const accountId = searchParams.get('accountId');
    const unhandled = searchParams.get('unhandled') === 'true';

    const where: Record<string, unknown> = {};
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (accountId) where.accountId = accountId;
    if (unhandled) where.isHandled = false;

    const emails = await prisma.email.findMany({
      where,
      include: { account: { select: { email: true, label: true } } },
      orderBy: [{ priority: 'asc' }, { date: 'desc' }],
      take: 200,
    });

    const stats = await prisma.email.groupBy({
      by: ['priority'],
      _count: true,
      where: { isHandled: false },
    });

    return NextResponse.json({ emails, stats });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, isHandled, isRead } = await req.json();
    const email = await prisma.email.update({
      where: { id },
      data: { ...(isHandled !== undefined && { isHandled }), ...(isRead !== undefined && { isRead }) },
    });
    return NextResponse.json(email);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
