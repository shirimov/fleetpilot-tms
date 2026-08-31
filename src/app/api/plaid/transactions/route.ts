import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizationService } from '@/lib/auth/authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankSyncService } from '@/lib/finance/bank-sync-service';

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
      select: {
        id: true,
        date: true,
        name: true,
        merchantName: true,
        amount: true,
        direction: true,
        category: true,
        subCategory: true,
        pending: true,
        bankAccount: { select: { institutionName: true } },
        subAccount: { select: { name: true, mask: true } },
      },
      orderBy: { date: 'desc' },
      take: 500,
    });

    // Summary stats
    const income = transactions.filter(t => t.direction === 'INFLOW').reduce((s, t) => s + t.amount, 0);
    const expenses = transactions.filter(t => t.direction === 'OUTFLOW').reduce((s, t) => s + t.amount, 0);

    return NextResponse.json({ transactions, summary: { income, expenses, net: income - expenses } });
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch transactions');
  }
}

export async function POST(req: NextRequest) {
  try {
    const { bankAccountId } = await req.json();
    const context = await financialControlAuthorization.requireContext('ADMIN');
    return NextResponse.json(await bankSyncService.syncNow(context, bankAccountId));
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to sync transactions');
  }
}
