/** Read-only category attribution. Allocations consume amounts before the header
 * category fills a residual; the header and its allocations are never summed. */
export type Category = { type: string; isActive: boolean; operatingGroupId: string };
export type AccountingEntry = {
  amountMinor: bigint; direction: string; operatingGroupId: string;
  role: string; status: string; reconciliationStatus: string;
  category: Category | null;
  allocations: { amountMinor: bigint; category: Category | null }[];
  recoverableFromOwner: boolean; recoveryStatus: string;
};
export const reviewQueues = {
  unmatchedInflows: 'Income or credits needing evidence',
  unmatchedOutflows: 'Expenses needing evidence',
  partialMatches: 'Partially matched evidence',
  possibleDuplicates: 'Possible duplicates',
  uncategorizedExpenses: 'Expenses needing category review',
  missingAssignments: 'Expenses without allocations',
  ownerRecovery: 'Owner recovery outstanding',
} as const;
export type ReviewQueue = keyof typeof reviewQueues;
export function isReviewQueue(value: string): value is ReviewQueue { return Object.prototype.hasOwnProperty.call(reviewQueues, value); }
export function categoryAttribution(entry: AccountingEntry) {
  const valid = (category: Category | null) => !!category && category.isActive && category.operatingGroupId === entry.operatingGroupId;
  const allocated = entry.allocations.reduce((sum, row) => sum + row.amountMinor, BigInt(0));
  const invalidCoverage = allocated > entry.amountMinor || entry.allocations.some(row => row.amountMinor <= BigInt(0));
  const parts = invalidCoverage ? [{ amountMinor: entry.amountMinor, category: null }] : [
    ...entry.allocations,
    ...(allocated < entry.amountMinor ? [{ amountMinor: entry.amountMinor - allocated, category: entry.category }] : []),
  ];
  const uncategorizedMinor = parts.reduce((sum, part) => sum + (valid(part.category) ? BigInt(0) : part.amountMinor), BigInt(0));
  let incomeMinor = BigInt(0), grossExpensesMinor = BigInt(0), expenseCreditsMinor = BigInt(0), otherNetMinor = BigInt(0);
  for (const part of parts) {
    const sign = entry.direction === 'INFLOW' ? BigInt(1) : -BigInt(1);
    if (entry.direction === 'TRANSFER') continue;
    // Inactive categories still retain historical economic meaning, but require review.
    const type = part.category?.operatingGroupId === entry.operatingGroupId ? part.category.type : null;
    if (type === 'INCOME') incomeMinor += sign * part.amountMinor;
    else if (type === 'DIRECT_EXPENSE' || type === 'OVERHEAD') {
      if (entry.direction === 'OUTFLOW') grossExpensesMinor += part.amountMinor;
      else expenseCreditsMinor -= part.amountMinor;
    } else otherNetMinor += sign * part.amountMinor;
  }
  return { uncategorizedMinor, invalidCoverage, incomeMinor, grossExpensesMinor, expenseCreditsMinor, netExpensesMinor: grossExpensesMinor + expenseCreditsMinor, otherNetMinor };
}
export function entryQueues(entry: AccountingEntry): ReviewQueue[] {
  if (entry.status === 'VOIDED' || entry.role !== 'ECONOMIC') return [];
  const attribution = categoryAttribution(entry);
  const unresolved = ['UNREVIEWED', 'UNMATCHED', 'NEEDS_REVIEW'].includes(entry.reconciliationStatus);
  return (Object.keys(reviewQueues) as ReviewQueue[]).filter(key => ({
    unmatchedInflows: entry.direction === 'INFLOW' && unresolved,
    unmatchedOutflows: entry.direction === 'OUTFLOW' && unresolved,
    partialMatches: entry.reconciliationStatus === 'PARTIALLY_MATCHED',
    possibleDuplicates: entry.reconciliationStatus === 'DUPLICATE_SUSPECTED',
    uncategorizedExpenses: entry.direction === 'OUTFLOW' && (attribution.uncategorizedMinor > BigInt(0) || attribution.invalidCoverage),
    missingAssignments: entry.direction === 'OUTFLOW' && entry.allocations.length === 0,
    ownerRecovery: entry.recoverableFromOwner && !['RECOVERED', 'WAIVED'].includes(entry.recoveryStatus),
  })[key]);
}
export function summarizeAccounting(entries: AccountingEntry[]) {
  const result = { incomeMinor: BigInt(0), grossExpensesMinor: BigInt(0), expenseCreditsMinor: BigInt(0), netExpensesMinor: BigInt(0), otherNetMinor: BigInt(0), recordedNetMinor: BigInt(0) };
  for (const entry of entries.filter(row => row.role === 'ECONOMIC' && row.status !== 'VOIDED' && row.direction !== 'TRANSFER')) {
    const parts = categoryAttribution(entry);
    for (const key of ['incomeMinor', 'grossExpensesMinor', 'expenseCreditsMinor', 'netExpensesMinor', 'otherNetMinor'] as const) result[key] += parts[key];
    result.recordedNetMinor += entry.direction === 'INFLOW' ? entry.amountMinor : -entry.amountMinor;
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.toString()])) as Record<keyof typeof result, string>;
}
export function pageNumber(value: unknown) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1; }
