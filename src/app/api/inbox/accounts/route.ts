import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const accounts = await prisma.emailAccount.findMany({
      include: { _count: { select: { emails: true } } },
      orderBy: { createdAt: 'asc' },
    });
    // Don't expose password
    return NextResponse.json(accounts.map(a => ({ ...a, password: '***' })));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, label, password, imapHost } = await req.json();
    const account = await prisma.emailAccount.upsert({
      where: { email },
      create: { email, label, password, imapHost: imapHost || 'imap.gmail.com' },
      update: { label, password, imapHost: imapHost || 'imap.gmail.com' },
    });
    return NextResponse.json({ ...account, password: '***' });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await prisma.email.deleteMany({ where: { accountId: id } });
    await prisma.emailAccount.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
