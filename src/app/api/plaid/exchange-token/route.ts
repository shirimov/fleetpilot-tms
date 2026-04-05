import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { public_token, companyId } = await req.json();

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Get institution info
    const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
    const institutionId = itemResponse.data.item.institution_id;
    let institutionName = 'Unknown Bank';

    if (institutionId) {
      const instResponse = await plaidClient.institutionsGetById({
        institution_id: institutionId,
        country_codes: ['US' as never],
      });
      institutionName = instResponse.data.institution.name;
    }

    // Get accounts
    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
    const accounts = accountsResponse.data.accounts;

    // Save to DB
    const bankAccount = await prisma.bankAccount.create({
      data: {
        companyId: companyId || null,
        plaidItemId: itemId,
        plaidAccessToken: accessToken,
        institutionId,
        institutionName,
        lastSync: new Date(),
        accounts: {
          create: accounts.map(acc => ({
            plaidAccountId: acc.account_id,
            name: acc.name,
            officialName: acc.official_name || null,
            type: acc.type,
            subtype: acc.subtype || null,
            mask: acc.mask || null,
            currentBalance: acc.balances.current || 0,
            availableBalance: acc.balances.available || 0,
          })),
        },
      },
      include: { accounts: true },
    });

    // Sync transactions (last 30 days)
    await syncTransactions(accessToken, bankAccount.id);

    return NextResponse.json({ success: true, bankAccount });
  } catch (error: unknown) {
    console.error('Plaid exchange token error:', error);
    const err = error as { response?: { data?: unknown }; message?: string };
    return NextResponse.json(
      { error: 'Failed to connect bank', details: err?.response?.data || err?.message },
      { status: 500 }
    );
  }
}

async function syncTransactions(accessToken: string, bankAccountId: string) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const endDate = new Date();

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const response = await plaidClient.transactionsGet({
    access_token: accessToken,
    start_date: fmt(startDate),
    end_date: fmt(endDate),
  });

  const transactions = response.data.transactions;

  // Get sub account map
  const subAccounts = await prisma.bankSubAccount.findMany({
    where: { bankAccountId },
  });
  const subAccountMap = Object.fromEntries(subAccounts.map(a => [a.plaidAccountId, a.id]));

  // Upsert transactions
  for (const tx of transactions) {
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
        merchantName: tx.merchant_name || null,
      },
    });
  }
}
