import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { BankLedgerNotFoundError } from './bank-ledger-errors';
import type { FinancialAuthorization } from './financial-control-authorization';
import { parseBankExport, type BankExportPreviewStatus } from './bank-export-preview';

function normalized(value: string | null) {
  return value?.trim().replace(/\s+/g, ' ').toUpperCase() ?? '';
}

export class BankExportPreviewService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async preview(context: FinancialAuthorization, input: {
    companyId: string;
    bankAccountId: string;
    subAccountId: string;
    filename: string;
    bytes: Uint8Array;
  }) {
    if (!context.companyIds.includes(input.companyId)) throw new AuthorizationDeniedError();
    const account = await this.database.bankSubAccount.findFirst({
      where: {
        id: input.subAccountId,
        bankAccountId: input.bankAccountId,
        bankAccount: { companyId: input.companyId },
      },
      select: { id: true, name: true, mask: true, bankAccountId: true },
    });
    if (!account) throw new BankLedgerNotFoundError();

    const parsed = parseBankExport({ filename: input.filename, bytes: input.bytes });
    const validDates = parsed.flatMap((row) => row.postedDate ? [row.postedDate] : []);
    const externalIds = parsed.flatMap((row) => row.externalId ? [row.externalId] : []);
    const [existingIdentities, possibleMatches] = await Promise.all([
      externalIds.length ? this.database.bankTransactionExternalId.findMany({
        where: { bankAccountId: input.bankAccountId, externalId: { in: externalIds } },
        select: { externalId: true },
      }) : [],
      validDates.length ? this.database.bankTransaction.findMany({
        where: {
          bankAccountId: input.bankAccountId,
          subAccountId: input.subAccountId,
          date: {
            gte: new Date(`${validDates.sort()[0]}T00:00:00.000Z`),
            lte: new Date(`${validDates.sort().at(-1)}T23:59:59.999Z`),
          },
        },
        select: { date: true, amountMinor: true, direction: true, originalDescription: true, name: true, checkNumber: true, referenceNumber: true },
      }) : [],
    ]);
    const identitySet = new Set(existingIdentities.map(({ externalId }) => externalId));

    const rows = parsed.map((row) => {
      let status: BankExportPreviewStatus = row.error ? 'INVALID' : row.externalId && identitySet.has(row.externalId) ? 'ALREADY_EXISTS' : 'NEW';
      if (status === 'NEW') {
        const possible = possibleMatches.some((existing) => {
          const signedMinor = existing.direction === 'OUTFLOW' ? -(existing.amountMinor ?? BigInt(0)) : existing.amountMinor ?? BigInt(0);
          return existing.date.toISOString().slice(0, 10) === row.postedDate
            && signedMinor === row.amountMinor
            && normalized(existing.originalDescription ?? existing.name) === normalized(row.description)
            && (!row.checkNumber || normalized(existing.checkNumber ?? existing.referenceNumber) === normalized(row.checkNumber));
        });
        if (possible) status = 'POSSIBLE_DUPLICATE';
      }
      return {
        rowNumber: row.rowNumber,
        status,
        source: row.source,
        externalIdPresent: Boolean(row.externalId),
        postedDate: row.postedDate,
        amountMinor: row.amountMinor?.toString() ?? null,
        description: row.description,
        checkNumber: row.checkNumber,
        error: row.error,
      };
    });

    const count = (status: BankExportPreviewStatus) => rows.filter((row) => row.status === status).length;
    return {
      mode: 'PREVIEW_ONLY' as const,
      account,
      summary: { total: rows.length, new: count('NEW'), alreadyExists: count('ALREADY_EXISTS'), possibleDuplicate: count('POSSIBLE_DUPLICATE'), invalid: count('INVALID') },
      rows,
    };
  }
}

export const bankExportPreviewService = new BankExportPreviewService();
