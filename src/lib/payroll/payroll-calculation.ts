export type PayrollReadiness = 'INCOMPLETE' | 'BLOCKED' | 'CALCULATED_WITH_WARNINGS' | 'RECONCILED' | 'UNRECONCILED';
export type DifferenceType = 'MILEAGE_DIFFERENCE' | 'RATE_DIFFERENCE' | 'TEAM_ALLOCATION_DIFFERENCE' | 'MISSING_REIMBURSEMENT' | 'MISSING_ADVANCE' | 'MISSING_FUEL' | 'MISSING_TOLL' | 'MISSING_DEDUCTION' | 'CONTRACTOR_BASE_DIFFERENCE' | 'ROUNDING_DIFFERENCE' | 'UNKNOWN';
export type PayrollTripInput = { id: string; reference: string; miles: string | null; mileageSource: 'LOAD_MILES'; deadheadMiles?: string | null; allocatedMiles?: string | null; grossRevenueMinor?: bigint | null; linehaulMinor?: bigint | null; fuelSurchargeMinor?: bigint | null };
export type PayrollAdjustmentInput = { id: string; category: 'REIMBURSEMENT' | 'CREDIT' | 'ADVANCE' | 'DEDUCTION' | 'RECURRING_DEDUCTION' | 'FUEL' | 'TOLL' | 'ESCROW' | 'OTHER'; direction: 'CREDIT' | 'DEBIT'; amountMinor: bigint; description: string };
export type PayrollPreviewInput = {
  participantType: 'COMPANY_DRIVER' | 'CONTRACTOR';
  contract: null | { type: 'PER_MILE' | 'PERCENTAGE' | 'FLAT' | 'HOURLY' | 'OTHER'; rateMinorPerMile: bigint | null; percentageBasisPoints: number | null; percentageBase: string | null; appliesToTeam: boolean; teamAllocationStrategy: string | null; teamAllocationPercent?: number | null; mileagePolicy?: string; deadheadPolicy?: string; deadheadRateMinorPerMile?: bigint | null; roundingRule?: string; verificationStatus?: string };
  trips: PayrollTripInput[]; adjustments: PayrollAdjustmentInput[];
  externalReference?: null | { earningMinor: bigint | null; reimbursementMinor: bigint | null; advancesMinor?: bigint | null; fuelMinor: bigint | null; tollMinor: bigint | null; deductionsMinor: bigint | null; recurringMinor?: bigint | null; escrowMinor?: bigint | null; payoutMinor: bigint | null; milesThousandths?: bigint | null; rateMinorPerMile?: bigint | null };
};
export function mileageThousandths(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, '0'));
}
const roundedProductMinor = (miles: bigint, rate: bigint) => (miles * rate + BigInt(500)) / BigInt(1000);
const roundedPercentage = (amount: bigint, basisPoints: number) => (amount * BigInt(basisPoints) + BigInt(5000)) / BigInt(10000);
function adjustmentSummary(adjustments: PayrollAdjustmentInput[], category: PayrollAdjustmentInput['category']) {
  const rows = adjustments.filter((entry) => entry.category === category);
  if (!rows.length) return { amountMinor: null, availability: 'NOT_AVAILABLE' as const, rows };
  const amountMinor = rows.reduce((sum, entry) => sum + entry.amountMinor, BigInt(0));
  return { amountMinor, availability: amountMinor === BigInt(0) ? 'ZERO' as const : 'AVAILABLE' as const, rows };
}
function componentMap(adjustments: PayrollAdjustmentInput[]) {
  return { reimbursements: adjustmentSummary(adjustments, 'REIMBURSEMENT'), credits: adjustmentSummary(adjustments, 'CREDIT'), advances: adjustmentSummary(adjustments, 'ADVANCE'), fuel: adjustmentSummary(adjustments, 'FUEL'), tolls: adjustmentSummary(adjustments, 'TOLL'), deductions: adjustmentSummary(adjustments, 'DEDUCTION'), recurringDeductions: adjustmentSummary(adjustments, 'RECURRING_DEDUCTION'), escrow: adjustmentSummary(adjustments, 'ESCROW'), other: adjustmentSummary(adjustments, 'OTHER') };
}
function allocatedTeamMiles(miles: bigint, trip: PayrollTripInput, contract: NonNullable<PayrollPreviewInput['contract']>, blockers: string[]) {
  if (!contract.appliesToTeam) return miles;
  switch (contract.teamAllocationStrategy) {
    case 'SPLIT_50_50': return (miles + BigInt(1)) / BigInt(2);
    case 'FULL_MILES_EACH': return miles;
    case 'CUSTOM_PERCENTAGE':
    case 'PRIMARY_SECONDARY':
      if (contract.teamAllocationPercent === null || contract.teamAllocationPercent === undefined) { blockers.push(`Load ${trip.reference} lacks a team allocation percentage.`); return null; }
      return (miles * BigInt(contract.teamAllocationPercent) + BigInt(5000)) / BigInt(10000);
    case 'CUSTOM_MILES': return trip.allocatedMiles ? mileageThousandths(trip.allocatedMiles) : null;
    default: blockers.push('Team-driver mileage allocation is not configured.'); return null;
  }
}
function tripPercentageBase(trip: PayrollTripInput, base: string | null) {
  if (base === 'GROSS_REVENUE' || base === 'TOTAL_REVENUE') return trip.grossRevenueMinor ?? null;
  if (base === 'LINEHAUL' || base === 'TRIP_RATE') return trip.linehaulMinor ?? null;
  if (base === 'LINEHAUL_PLUS_FSC' && trip.linehaulMinor != null && trip.fuelSurchargeMinor != null) return trip.linehaulMinor + trip.fuelSurchargeMinor;
  return null;
}
export function classifyPayrollDifferences(calculated: { eligibleMilesThousandths: bigint; baseEarningMinor: bigint | null; components: ReturnType<typeof componentMap>; payoutDifferenceMinor: bigint | null }, external: PayrollPreviewInput['externalReference']) {
  if (!external) return [] as DifferenceType[];
  const result = new Set<DifferenceType>();
  if (external.milesThousandths != null && external.milesThousandths !== calculated.eligibleMilesThousandths) result.add('MILEAGE_DIFFERENCE');
  if (external.earningMinor != null && calculated.baseEarningMinor != null && external.earningMinor !== calculated.baseEarningMinor) result.add('RATE_DIFFERENCE');
  const checks: Array<[bigint | null | undefined, bigint | null, DifferenceType]> = [[external.reimbursementMinor, calculated.components.reimbursements.amountMinor, 'MISSING_REIMBURSEMENT'], [external.advancesMinor, calculated.components.advances.amountMinor, 'MISSING_ADVANCE'], [external.fuelMinor, calculated.components.fuel.amountMinor, 'MISSING_FUEL'], [external.tollMinor, calculated.components.tolls.amountMinor, 'MISSING_TOLL'], [external.deductionsMinor, calculated.components.deductions.amountMinor, 'MISSING_DEDUCTION'], [external.recurringMinor, calculated.components.recurringDeductions.amountMinor, 'MISSING_DEDUCTION']];
  for (const [expected, actual, type] of checks) if (expected != null && expected !== (actual ?? BigInt(0))) result.add(type);
  if (calculated.payoutDifferenceMinor != null && calculated.payoutDifferenceMinor !== BigInt(0) && result.size === 0) result.add('UNKNOWN');
  return [...result];
}
export function calculatePayrollPreview(input: PayrollPreviewInput) {
  const blockers: string[] = []; const warnings: string[] = []; const contract = input.contract;
  if (!contract) blockers.push('Missing pay contract.');
  if (contract && !['ADMIN_VERIFIED', 'PRODUCTION_READY'].includes(contract.verificationStatus ?? 'UNVERIFIED')) warnings.push('Pay contract rule is not admin verified.');
  if (contract?.mileagePolicy && contract.mileagePolicy !== 'LOAD_MILES') blockers.push('Configured mileage policy is unsupported by current FleetPilot load data.');
  if (contract?.type === 'PER_MILE' && contract.rateMinorPerMile === null) blockers.push('Per-mile rate is missing.');
  if (contract?.type === 'PERCENTAGE' && (!contract.percentageBase || contract.percentageBase === 'UNKNOWN')) blockers.push('Contractor percentage base is not configured.');
  if (contract && !['PER_MILE', 'PERCENTAGE'].includes(contract.type)) blockers.push('Unsupported pay type for calculation preview.');
  let eligibleMilesThousandths = BigInt(0); let excludedMilesThousandths = BigInt(0);
  const tripBreakdown = input.trips.map((trip) => {
    const parsed = trip.miles === null ? null : mileageThousandths(trip.miles);
    if (parsed === null) { if (trip.miles === null) warnings.push(`Load ${trip.reference} has no mileage.`); else blockers.push(`Load ${trip.reference} has unsupported mileage precision.`); return { ...trip, eligibleMilesThousandths: null, excludedMilesThousandths: null, earningMinor: null, reason: 'Mileage unavailable' }; }
    const allocated = contract ? allocatedTeamMiles(parsed, trip, contract, blockers) : parsed;
    if (allocated === null) { if (contract?.teamAllocationStrategy === 'CUSTOM_MILES') blockers.push(`Load ${trip.reference} lacks valid custom allocated miles.`); return { ...trip, eligibleMilesThousandths: null, excludedMilesThousandths: null, earningMinor: null, reason: 'Allocation blocked' }; }
    if (allocated > parsed && contract?.teamAllocationStrategy !== 'FULL_MILES_EACH') blockers.push(`Load ${trip.reference} allocation exceeds trip miles.`);
    eligibleMilesThousandths += allocated; excludedMilesThousandths += allocated <= parsed ? parsed - allocated : BigInt(0);
    let earningMinor: bigint | null = null;
    if (contract?.type === 'PER_MILE' && contract.rateMinorPerMile !== null) earningMinor = roundedProductMinor(allocated, contract.rateMinorPerMile);
    if (contract?.type === 'PERCENTAGE' && contract.percentageBasisPoints !== null) { const base = tripPercentageBase(trip, contract.percentageBase); if (base === null) blockers.push(`Load ${trip.reference} lacks the configured percentage base.`); else earningMinor = roundedPercentage(base, contract.percentageBasisPoints); }
    if (trip.deadheadMiles) { const deadhead = mileageThousandths(trip.deadheadMiles); if (deadhead === null) blockers.push(`Load ${trip.reference} has invalid deadhead mileage.`); else if (contract?.deadheadPolicy === 'PAID' && contract.deadheadRateMinorPerMile != null) { eligibleMilesThousandths += deadhead; earningMinor = (earningMinor ?? BigInt(0)) + roundedProductMinor(deadhead, contract.deadheadRateMinorPerMile); } else if (contract?.deadheadPolicy === 'NOT_PAID') excludedMilesThousandths += deadhead; else blockers.push(`Load ${trip.reference} deadhead treatment is not configured.`); }
    return { ...trip, eligibleMilesThousandths: allocated, excludedMilesThousandths: allocated <= parsed ? parsed - allocated : BigInt(0), earningMinor, reason: contract?.appliesToTeam ? `Team strategy: ${contract.teamAllocationStrategy}` : 'Full load miles' };
  });
  if (!input.trips.length) warnings.push('No eligible delivered loads were found for this period.');
  warnings.push('Mileage source is Load.miles; its operational meaning remains unverified for final payroll.');
  const baseEarningMinor = tripBreakdown.every((trip) => trip.earningMinor !== null) && contract && ['PER_MILE', 'PERCENTAGE'].includes(contract.type) ? tripBreakdown.reduce((sum, trip) => sum + (trip.earningMinor ?? BigInt(0)), BigInt(0)) : null;
  const components = componentMap(input.adjustments);
  for (const [name, component] of Object.entries(components)) if (component.availability === 'NOT_AVAILABLE') warnings.push(`${name} data is not available; it was not treated as a verified zero.`);
  const creditMinor = input.adjustments.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amountMinor, BigInt(0));
  const debitMinor = input.adjustments.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amountMinor, BigInt(0));
  const calculatedPayoutMinor = blockers.length || baseEarningMinor === null ? null : baseEarningMinor + creditMinor - debitMinor;
  const externalPayoutMinor = input.externalReference?.payoutMinor ?? null;
  const payoutDifferenceMinor = calculatedPayoutMinor !== null && externalPayoutMinor !== null ? calculatedPayoutMinor - externalPayoutMinor : null;
  const differenceTypes = classifyPayrollDifferences({ eligibleMilesThousandths, baseEarningMinor, components, payoutDifferenceMinor }, input.externalReference);
  const readiness: PayrollReadiness = blockers.length ? 'BLOCKED' : externalPayoutMinor !== null ? payoutDifferenceMinor === BigInt(0) && differenceTypes.length === 0 ? 'RECONCILED' : 'UNRECONCILED' : warnings.length ? 'CALCULATED_WITH_WARNINGS' : 'INCOMPLETE';
  return { readiness, blockers, warnings, mileagePolicy: contract?.mileagePolicy ?? 'LOAD_MILES', mileageSource: 'Load.miles', eligibleMilesThousandths, excludedMilesThousandths, manualOverrideMilesThousandths: null, tripBreakdown, baseEarningMinor, components, creditMinor, debitMinor, calculatedPayoutMinor, externalPayoutMinor, payoutDifferenceMinor, differenceTypes };
}
