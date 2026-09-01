import type { Transaction } from 'plaid';
import { plaidClient } from '@/lib/plaid';
import type {
  BankProviderAccountSnapshot,
  BankProviderAdapter,
  BankProviderSyncPage,
  BankProviderTransaction,
} from './bank-ledger-types';

export function plaidBalanceMinor(value: number | null | undefined) {
  return value == null ? null : BigInt(Math.round(value * 100));
}

export function derivePlaidTransactionDirection(amount: number) {
  if (amount === 0) return null;
  return amount < 0 ? 'INFLOW' as const : 'OUTFLOW' as const;
}

function dateOnly(value?: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function mapTransaction(transaction: Transaction): BankProviderTransaction {
  const providerAmountText = String(transaction.amount);
  const amountMinor = BigInt(Math.round(Math.abs(transaction.amount) * 100));
  return {
    externalId: transaction.transaction_id,
    pendingExternalId: transaction.pending_transaction_id ?? null,
    externalAccountId: transaction.account_id,
    authorizedDate: dateOnly(transaction.authorized_date),
    postedDate: dateOnly(transaction.date),
    amountMinor,
    providerAmountText,
    currency: transaction.iso_currency_code ?? transaction.unofficial_currency_code ?? 'USD',
    direction: derivePlaidTransactionDirection(transaction.amount),
    originalDescription: transaction.name,
    merchantName: transaction.merchant_name ?? null,
    providerCategory: transaction.personal_finance_category ?? transaction.category ?? null,
    pending: transaction.pending,
    checkNumber: transaction.check_number ?? null,
    location: transaction.location,
    sourceMetadata: {
      paymentChannel: transaction.payment_channel,
      transactionCode: transaction.transaction_code,
    },
  };
}

export class PlaidBankProviderAdapter implements BankProviderAdapter {
  readonly provider = 'PLAID';

  async syncAccounts(input: {
    accessToken: string;
  }): Promise<BankProviderAccountSnapshot[]> {
    const response = await plaidClient.accountsGet({ access_token: input.accessToken });
    return response.data.accounts.map((account) => ({
      externalAccountId: account.account_id,
      name: account.name,
      officialName: account.official_name ?? null,
      type: account.type,
      subtype: account.subtype ?? null,
      mask: account.mask ?? null,
      currency: account.balances.iso_currency_code ?? account.balances.unofficial_currency_code ?? 'USD',
      currentBalanceMinor: plaidBalanceMinor(account.balances.current),
      availableBalanceMinor: plaidBalanceMinor(account.balances.available),
    }));
  }

  async syncTransactions(input: {
    accessToken: string;
    cursor: string | null;
  }): Promise<BankProviderSyncPage> {
    const response = await plaidClient.transactionsSync({
      access_token: input.accessToken,
      cursor: input.cursor ?? undefined,
      count: 500,
    });
    return {
      added: response.data.added.map(mapTransaction),
      modified: response.data.modified.map(mapTransaction),
      removedExternalIds: response.data.removed.map(({ transaction_id }) => transaction_id),
      nextCursor: response.data.next_cursor,
      hasMore: response.data.has_more,
    };
  }
}
