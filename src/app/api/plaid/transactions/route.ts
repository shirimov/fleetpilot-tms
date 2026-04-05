import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { plaidClient } from '@/lib/plaid';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bankAccountId = searchParams.get('bankAccountId');
    const days = parseInt(searchParams.get('days') || '30');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: Record<string, unknown> = { date: { gte: since } };
    if (bankAccountId) where.bankAccountId = bankAccountId;

    const transactions = await prisma.bankTransaction.findMany({
      where,
      include: {
        bankAccount: { select: { institutionName: true } },
        subAccount: { select: { name: true, mask: true } },
      },
      orderBy: { date: 'desc' },
      take: 500,
    });

    // Summary stats
    const income = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const expenses = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

    return NextResponse.json({ transactions, summary: { income, expenses, net: income - expenses } });
  } catch (error) {
    console.error('Get transactions error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Sync latest transactions
  try {
    const { bankAccountId } = await req.json();

    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      include: { accounts: true },
    });
    if (!bankAccount) return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const response = await plaidClient.transactionsGet({
      access_token: bankAccount.plaidAccessToken,
      start_date: fmt(startDate),
      end_date: fmt(endDate),
    });

    const subAccountMap = Object.fromEntries(bankAccount.accounts.map(a => [a.plaidAccountId, a.id]));
    let synced = 0;

    for (const tx of response.data.transactions) {
      await prisma.bankTransaction.upsert({
        where: { plaidTransactionId: tx.transaction_id },
        create: {
          bankAccountId,
          subAccountId: subAccountMap[tx.account_id] || null,
          plaidTransactionId: tx.transaction_id,
          date: new Date(tx.date),
          amount: tx.amount,
          name: tx.name,
          merchantName: tx.merchant_name || null,
          category: tx.personal_finance_category?.primary || (tx.category?.[0] ?? null),
          subCategory: tx.personal_finance_category?.detailed || (tx.category?.[1] ?? null),
          pending: tx.pending,
        },
        update: {
          amount: tx.amount,
          pending: tx.pending,
        },
      });
      synced++;
    }

    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { lastSync: new Date() },
    });

    return NextResponse.json({ success: true, synced });
  } catch (error) {
    console.error('Sync transactions error:', error);
    return NextResponse.json({ error: 'Failed to sync transactions' }, { status: 500 });
  }
}
