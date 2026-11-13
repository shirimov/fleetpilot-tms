import { FinancialValidationError } from '../finance/financial-control-errors';

// Beneficial ownership is independent of the Truck's operating Company.
// The recipient binding is explicitly confirmed in that Company's QM namespace.
export type OwnerPeriod = {
  ownerPartyId: string; companyId: string; providerRecipientId: string;
  effectiveFrom: string; effectiveTo: string | null;
};
export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateOwnerPeriods(periods: OwnerPeriod[]): OwnerPeriod[] {
  if (!Array.isArray(periods) || !periods.length || periods.length > 200) throw new FinancialValidationError('Supply 1–200 owner periods.');
  for (const period of periods) {
    if (!period || ['ownerPartyId', 'companyId', 'providerRecipientId'].some(key => {
      const value = period[key as keyof OwnerPeriod];
      return typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200;
    })) throw new FinancialValidationError('Owner, Company and confirmed recipient IDs are required.');
    if (!isBusinessDate(period.effectiveFrom)) throw new FinancialValidationError('Use an explicit calendar date (YYYY-MM-DD).');
    if (period.effectiveTo !== null && (!isBusinessDate(period.effectiveTo) || period.effectiveTo <= period.effectiveFrom)) throw new FinancialValidationError('Period end must follow start.');
  }
  const sorted = [...periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 1; i < sorted.length; i++) {
    if (!sorted[i - 1].effectiveTo || sorted[i - 1].effectiveTo! > sorted[i].effectiveFrom) throw new FinancialValidationError('Owner periods cannot overlap.');
  }
  return sorted;
}

export function resolveTruckOwnerAt<T extends OwnerPeriod>(periods: T[], businessDate: string | null, companyId: string):
  | { status: 'EXACT'; period: T }
  | { status: 'NEEDS_BUSINESS_DATE' | 'NO_CONFIRMED_OWNER' | 'OVERLAPPING_OWNER_HISTORY' | 'OWNER_RECIPIENT_SCOPE_MISMATCH' | 'INVALID_OWNER_HISTORY' } {
  // Do not slice timestamps into dates: the operational timezone is unconfirmed.
  if (!isBusinessDate(businessDate)) return { status: 'NEEDS_BUSINESS_DATE' };
  // Validate each row independently so overlap retains its own review reason.
  try { for (const period of periods) validateOwnerPeriods([period]); }
  catch { return { status: 'INVALID_OWNER_HISTORY' }; }
  const matching = periods.filter(period => period.effectiveFrom <= businessDate && (!period.effectiveTo || businessDate < period.effectiveTo));
  if (matching.length > 1) return { status: 'OVERLAPPING_OWNER_HISTORY' };
  if (!matching.length) return { status: 'NO_CONFIRMED_OWNER' };
  if (matching[0].companyId !== companyId) return { status: 'OWNER_RECIPIENT_SCOPE_MISMATCH' };
  return { status: 'EXACT', period: matching[0] };
}

// Resolve provider calendar labels without manufacturing an operational timestamp.
export function resolvePilotTruckOwnerAt<T extends OwnerPeriod>(periods: T[], date: string | null, sourceFormat: string, companyId: string): ReturnType<typeof resolveTruckOwnerAt<T>> {
  const owner = resolveTruckOwnerAt(periods, ['LEGACY_XLS', 'PIPE_INVOICE'].includes(sourceFormat) ? date : null, companyId);
  // Both parsers retain a date label, not proof of a purchase-day timezone.
  // There is no evidence that PIPE is exempt from the Sunday/Saturday ambiguity.
  if (['LEGACY_XLS', 'PIPE_INVOICE'].includes(sourceFormat) && isBusinessDate(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 0) {
    const prior = new Date(`${date}T00:00:00Z`);
    prior.setUTCDate(prior.getUTCDate() - 1);
    const saturday = resolveTruckOwnerAt(periods, prior.toISOString().slice(0, 10), companyId);
    if (owner.status !== 'EXACT' || saturday.status !== 'EXACT'
      || owner.period.ownerPartyId !== saturday.period.ownerPartyId
      || owner.period.providerRecipientId !== saturday.period.providerRecipientId) return { status: 'NEEDS_BUSINESS_DATE' };
  }
  return owner;
}
