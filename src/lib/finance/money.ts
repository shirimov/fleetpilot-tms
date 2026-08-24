import { FinancialValidationError } from './financial-control-errors';

const currencyPattern = /^[A-Z]{3}$/;
const decimalPattern = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string') throw new FinancialValidationError('Currency is required.');
  const currency = value.trim().toUpperCase();
  if (!currencyPattern.test(currency)) {
    throw new FinancialValidationError('Currency must be a three-letter ISO code.');
  }
  return currency;
}

export function parsePositiveMinorUnits(value: unknown): bigint {
  if (typeof value !== 'string') throw new FinancialValidationError('Amount is required.');
  const normalized = value.trim().replace(/,/g, '');
  const match = decimalPattern.exec(normalized);
  if (!match) throw new FinancialValidationError('Amount must be a positive value with at most two decimals.');
  const minor = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (minor <= BigInt(0)) throw new FinancialValidationError('Amount must be greater than zero.');
  return minor;
}

export function formatMinorUnits(value: bigint, currency = 'USD'): string {
  const major = value / BigInt(100);
  const minor = (value % BigInt(100)).toString().padStart(2, '0');
  return `${currency} ${major}.${minor}`;
}

export function bigintJson(value: bigint | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}
