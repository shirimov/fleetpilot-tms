import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import Imap from 'node-imap';
import { simpleParser } from 'mailparser';

const IMPORTANT_SENDERS = [
  'amazon', 'relay', 'fmcsa', 'dot.gov', 'progressive', 'insurance',
  'echo', 'ch robinson', 'coyote', 'convoy', 'uber freight',
  'loadsmart', 'plaid', 'bank', 'chase', 'bofa', 'keybank',
  'irs', 'tax', 'quickmanage', 'map transit', 'swick', 'teamway',
  'headwall', 'whitehorse', 'triple t', 'value logistics', 'grizz',
  'secretary of state', 'sos.wa.gov', 'esd.wa'
];

const URGENT_SUBJECTS = [
  'urgent', 'action required', 'overdue', 'past due', 'canceled', 'cancelled',
  'violation', 'compliance', 'expired', 'termination', 'audit', 'due today',
  'final hours', 'days left', 'payment', 'remittance', 'invoice'
];

const IMPORTANT_SUBJECTS = [
  'settlement', 'deposit', 'renewal', 'amazon relay', 'load confirmation',
  'rate confirmation', 'annual report', 'registration', 'insurance'
];

function getPriority(from: string, subject: string): string {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  if (URGENT_SUBJECTS.some(k => s.includes(k))) return 'urgent';
  if (IMPORTANT_SENDERS.some(k => f.includes(k))) return 'important';
  if (IMPORTANT_SUBJECTS.some(k => s.includes(k))) return 'important';
  return 'normal';
}

function getCategory(from: string, subject: string): string {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  if (f.includes('amazon') || s.includes('relay')) return 'Amazon';
  if (f.includes('progressive') || s.includes('insurance')) return 'Insurance';
  if (f.includes('bank') || f.includes('chase') || f.includes('bofa')) return 'Banking';
  if (f.includes('irs') || s.includes('tax') || s.includes('annual report')) return 'Compliance';
  if (s.includes('payment') || s.includes('invoice') || s.includes('settlement')) return 'Payments';
  return 'Other';
}

async function syncAccount(accountId: string): Promise<number> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Account not found');

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: account.email,
      password: account.password,
      host: account.imapHost,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    let synced = 0;

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); reject(err); return; }

        // Fetch last 7 days
        const since = new Date();
        since.setDate(since.getDate() - 7);
        const sinceStr = since.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).replace(',', '');

        imap.search([['SINCE', sinceStr]], (err, uids) => {
          if (err || !uids?.length) { imap.end(); resolve(0); return; }

          const fetch = imap.fetch(uids, { bodies: '', markSeen: false });
          const promises: Promise<void>[] = [];

          fetch.on('message', (msg) => {
            const p = new Promise<void>((res) => {
              const chunks: Buffer[] = [];
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', async () => {
                  try {
                    const parsed = await simpleParser(Buffer.concat(chunks));
                    const from = parsed.from?.text || '';
                    const subject = parsed.subject || '';
                    const date = parsed.date || new Date();
                    const body = parsed.text || parsed.html || '';
                    const messageId = parsed.messageId || `${date.getTime()}-${from}`;
                    const priority = getPriority(from, subject);
                    const category = getCategory(from, subject);

                    // Only save important/urgent or recent from known senders
                    if (priority !== 'normal') {
                      await prisma.email.upsert({
                        where: { accountId_messageId: { accountId, messageId } },
                        create: {
                          accountId, messageId, from, subject,
                          date, body: body.substring(0, 5000),
                          priority, category,
                        },
                        update: { priority, category },
                      });
                      synced++;
                    }
                  } catch (e) { /* skip */ }
                  res();
                });
              });
            });
            promises.push(p);
          });

          fetch.once('end', async () => {
            await Promise.all(promises);
            imap.end();
            resolve(synced);
          });

          fetch.once('error', (e) => { imap.end(); reject(e); });
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await req.json();
    const synced = await syncAccount(accountId);
    return NextResponse.json({ success: true, synced });
  } catch (e: unknown) {
    console.error('Sync error:', e);
    const err = e as { message?: string };
    return NextResponse.json({ error: err?.message || 'Sync failed' }, { status: 500 });
  }
}
