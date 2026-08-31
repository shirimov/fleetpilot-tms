import { BankLedgerValidationError } from './bank-ledger-errors';

export const bankTransactionPeriods = ['all', '7', '14', '30', '60', '90', 'custom'] as const;
export type BankTransactionPeriod = (typeof bankTransactionPeriods)[number];

const presetDays = new Map<BankTransactionPeriod, number>([
  ['7', 7],
  ['14', 14],
  ['30', 30],
  ['60', 60],
  ['90', 90],
]);

function parseDateOnly(value: string | null | undefined, field: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BankLedgerValidationError(`${field} must be a valid date.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BankLedgerValidationError(`${field} must be a valid date.`);
  }
  return parsed;
}

export function resolveBankTransactionPeriod(input: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}) {
  if (!input.period && (input.from || input.to)) {
    const from = input.from ? parseDateOnly(input.from, 'Start date') : undefined;
    const to = input.to ? parseDateOnly(input.to, 'End date') : undefined;
    if (from && to && from > to) throw new BankLedgerValidationError('Start date cannot be after end date.');
    return { period: 'custom' as const, from, to };
  }
  const requestedPeriod = input.period ?? (input.from || input.to ? 'custom' : 'all');
  if (!bankTransactionPeriods.includes(requestedPeriod as BankTransactionPeriod)) {
    throw new BankLedgerValidationError('Transaction period is invalid.');
  }
  const period = requestedPeriod as BankTransactionPeriod;
  if (period === 'all') return { period, from: undefined, to: undefined };
  if (period === 'custom') {
    const from = parseDateOnly(input.from, 'Start date');
    const to = parseDateOnly(input.to, 'End date');
    if (from > to) throw new BankLedgerValidationError('Start date cannot be after end date.');
    return { period, from, to };
  }
  const days = presetDays.get(period)!;
  const now = input.now ?? new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { period, from, to };
}
