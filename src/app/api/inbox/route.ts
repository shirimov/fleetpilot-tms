import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import Imap from 'node-imap';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const priority = searchParams.get('priority');
    const category = searchParams.get('category');
    const accountId = searchParams.get('accountId');
    const where: Record<string, unknown> = {};
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (accountId) where.accountId = accountId;

    const emails = await prisma.email.findMany({
      where,
      include: { account: { select: { email: true, label: true } } },
      orderBy: [{ date: 'desc' }],
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

async function markReadOnGmail(accountId: string, messageId: string) {
  try {
    const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
    if (!account) return;

    await new Promise<void>((resolve) => {
      const imap = new Imap({
        user: account.email,
        password: account.password,
        host: account.imapHost,
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); resolve(); return; }
          // Search by Message-ID header
          imap.search([['HEADER', 'MESSAGE-ID', messageId]], (err, uids) => {
            if (err || !uids?.length) { imap.end(); resolve(); return; }
            imap.addFlags(uids, '\\Seen', () => {
              imap.end();
              resolve();
            });
          });
        });
      });

      imap.once('error', () => resolve());
      imap.connect();
    });
  } catch { /* silent fail */ }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, isHandled, isRead } = await req.json();
    const email = await prisma.email.update({
      where: { id },
      data: { ...(isHandled !== undefined && { isHandled }), ...(isRead !== undefined && { isRead }) },
    });

    // If marking as read, sync to Gmail in background
    if (isRead) {
      markReadOnGmail(email.accountId, email.messageId).catch(() => {});
    }

    return NextResponse.json(email);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
