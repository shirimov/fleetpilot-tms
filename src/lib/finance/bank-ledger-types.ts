import type { FinancialDirection } from '@prisma/client';

export type BankProviderTransaction = {
  externalId: string;
  pendingExternalId?: string | null;
  externalAccountId: string;
  authorizedDate?: Date | null;
  postedDate?: Date | null;
  amountMinor: bigint;
  providerAmountText: string;
  currency: string;
  direction: FinancialDirection | null;
  originalDescription: string;
  merchantName?: string | null;
  providerCategory?: unknown;
  pending: boolean;
  checkNumber?: string | null;
  referenceNumber?: string | null;
  location?: unknown;
  sourceMetadata?: unknown;
};

export type BankProviderSyncPage = {
  added: BankProviderTransaction[];
  modified: BankProviderTransaction[];
  removedExternalIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
};

export interface BankProviderAdapter {
  readonly provider: string;
  syncTransactions(input: {
    accessToken: string;
    cursor: string | null;
  }): Promise<BankProviderSyncPage>;
}

export type BankAllocationInput = {
  amountMinor: bigint;
  categoryId: string;
  truckId?: string | null;
  trailerId?: string | null;
  driverId?: string | null;
  partyId?: string | null;
  memo?: string | null;
};
