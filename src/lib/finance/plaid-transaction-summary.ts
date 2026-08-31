import type { FinancialDirection } from '@prisma/client';

type TransactionSummaryInput = {
  amount: number;
  direction: FinancialDirection | null;
};

export function summarizeTransactions(transactions: TransactionSummaryInput[]) {
  const income = transactions
    .filter(transaction => transaction.direction === 'INFLOW')
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const expenses = transactions
    .filter(transaction => transaction.direction === 'OUTFLOW')
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

  return { income, expenses, net: income - expenses };
}
