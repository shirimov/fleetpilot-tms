import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { plaidClient } from '@/lib/plaid';
import { authorizationService } from '@/lib/auth/authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { financialAuthorizationService } from '@/lib/finance/financial-authorization';

export async function GET(req: NextRequest) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const { searchParams } = new URL(req.url);
    const bankAccountId = searchParams.get('bankAccountId');
    const days = parseInt(searchParams.get('days') || '30');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: Record<string, unknown> = {
      date: { gte: since },
      bankAccount: { companyId: context.companyId },
    };
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
    return tenantRouteErrorResponse(error, 'Failed to fetch transactions');
  }
}

export async function POST(req: NextRequest) {
  // Sync latest transactions
  try {
    const { bankAccountId } = await req.json();
    const context =
      await financialAuthorizationService.requireBankAccount(bankAccountId);

    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId: context.companyId },
      include: { accounts: true },
    });
    if (!bankAccount) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
      where: { id: bankAccountId, companyId: context.companyId },
      data: { lastSync: new Date() },
    });

    return NextResponse.json({ success: true, synced });
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to sync transactions');
  }
}
