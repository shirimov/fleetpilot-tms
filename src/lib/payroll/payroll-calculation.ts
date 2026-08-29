export type PayrollReadiness =
  | 'INCOMPLETE'
  | 'BLOCKED'
  | 'CALCULATED_WITH_WARNINGS'
  | 'RECONCILED'
  | 'UNRECONCILED';

export type InputAvailability = 'ZERO' | 'NOT_APPLICABLE' | 'NOT_AVAILABLE' | 'UNVERIFIED' | 'AVAILABLE';

export type PayrollTripInput = {
  id: string;
  reference: string;
  miles: string | null;
  mileageSource: 'LOAD_MILES';
};

export type PayrollAdjustmentInput = {
  id: string;
  category: 'REIMBURSEMENT' | 'CREDIT' | 'ADVANCE' | 'DEDUCTION' | 'RECURRING_DEDUCTION' | 'FUEL' | 'TOLL' | 'ESCROW' | 'OTHER';
  direction: 'CREDIT' | 'DEBIT';
  amountMinor: bigint;
  description: string;
};

export type PayrollPreviewInput = {
  participantType: 'COMPANY_DRIVER' | 'CONTRACTOR';
  contract: null | {
    type: 'PER_MILE' | 'PERCENTAGE' | 'FLAT' | 'HOURLY' | 'OTHER';
    rateMinorPerMile: bigint | null;
    percentageBasisPoints: number | null;
    percentageBase: string | null;
    appliesToTeam: boolean;
    teamAllocationStrategy: string | null;
  };
  trips: PayrollTripInput[];
  adjustments: PayrollAdjustmentInput[];
  externalReference?: null | {
    earningMinor: bigint | null;
    reimbursementMinor: bigint | null;
    fuelMinor: bigint | null;
    tollMinor: bigint | null;
    deductionsMinor: bigint | null;
    payoutMinor: bigint | null;
  };
};

function mileageThousandths(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, '0'));
}

function roundedProductMinor(milesThousandths: bigint, rateMinor: bigint) {
  return (milesThousandths * rateMinor + BigInt(500)) / BigInt(1000);
}

function adjustmentSummary(adjustments: PayrollAdjustmentInput[], category: PayrollAdjustmentInput['category']) {
  const rows = adjustments.filter((entry) => entry.category === category);
  if (!rows.length) return { amountMinor: null, availability: 'NOT_AVAILABLE' as const, rows };
  const amountMinor = rows.reduce((sum, entry) => sum + entry.amountMinor, BigInt(0));
  return { amountMinor, availability: amountMinor === BigInt(0) ? 'ZERO' as const : 'AVAILABLE' as const, rows };
}

export function calculatePayrollPreview(input: PayrollPreviewInput) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.contract) blockers.push('Missing pay contract.');
  if (input.contract?.type !== 'PER_MILE') {
    blockers.push(input.contract?.type === 'PERCENTAGE'
      ? input.contract.percentageBase === 'UNKNOWN' || !input.contract.percentageBase
        ? 'Contractor percentage base is not configured.'
        : 'Percentage payroll calculation is not verified yet.'
      : 'Unsupported pay type for calculation preview.');
  }
  if (input.contract?.type === 'PER_MILE' && input.contract.rateMinorPerMile === null) {
    blockers.push('Per-mile rate is missing.');
  }
  if (input.contract?.appliesToTeam && (!input.contract.teamAllocationStrategy || input.contract.teamAllocationStrategy === 'UNKNOWN')) {
    blockers.push('Team-driver mileage allocation is not configured.');
  }

  let eligibleMilesThousandths = BigInt(0);
  const tripBreakdown = input.trips.map((trip) => {
    if (trip.miles === null) {
      warnings.push(`Load ${trip.reference} has no mileage.`);
      return { ...trip, eligibleMilesThousandths: null, earningMinor: null };
    }
    const parsed = mileageThousandths(trip.miles);
    if (parsed === null) {
      blockers.push(`Load ${trip.reference} has unsupported mileage precision.`);
      return { ...trip, eligibleMilesThousandths: null, earningMinor: null };
    }
    eligibleMilesThousandths += parsed;
    return {
      ...trip,
      eligibleMilesThousandths: parsed,
      earningMinor: input.contract?.type === 'PER_MILE' && input.contract.rateMinorPerMile !== null
        ? roundedProductMinor(parsed, input.contract.rateMinorPerMile)
        : null,
    };
  });
  if (!input.trips.length) warnings.push('No eligible delivered loads were found for this period.');
  warnings.push('Mileage policy uses Load.miles for loads delivered in the pay period and remains unverified for final payroll.');

  const baseEarningMinor = tripBreakdown.every((trip) => trip.earningMinor !== null)
    && input.contract?.type === 'PER_MILE'
    ? tripBreakdown.reduce((sum, trip) => sum + (trip.earningMinor ?? BigInt(0)), BigInt(0))
    : null;
  const categories = {
    reimbursements: adjustmentSummary(input.adjustments, 'REIMBURSEMENT'),
    credits: adjustmentSummary(input.adjustments, 'CREDIT'),
    advances: adjustmentSummary(input.adjustments, 'ADVANCE'),
    fuel: adjustmentSummary(input.adjustments, 'FUEL'),
    tolls: adjustmentSummary(input.adjustments, 'TOLL'),
    deductions: adjustmentSummary(input.adjustments, 'DEDUCTION'),
    recurringDeductions: adjustmentSummary(input.adjustments, 'RECURRING_DEDUCTION'),
    escrow: adjustmentSummary(input.adjustments, 'ESCROW'),
    other: adjustmentSummary(input.adjustments, 'OTHER'),
  };
  for (const [name, component] of Object.entries(categories)) {
    if (component.availability === 'NOT_AVAILABLE') warnings.push(`${name} data is not available; it was not treated as a verified zero.`);
  }
  const creditMinor = input.adjustments.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amountMinor, BigInt(0));
  const debitMinor = input.adjustments.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amountMinor, BigInt(0));
  const calculatedPayoutMinor = blockers.length || baseEarningMinor === null ? null : baseEarningMinor + creditMinor - debitMinor;
  const externalPayoutMinor = input.externalReference?.payoutMinor ?? null;
  const payoutDifferenceMinor = calculatedPayoutMinor !== null && externalPayoutMinor !== null
    ? calculatedPayoutMinor - externalPayoutMinor
    : null;
  const readiness: PayrollReadiness = blockers.length
    ? 'BLOCKED'
    : externalPayoutMinor !== null
      ? payoutDifferenceMinor === BigInt(0) ? 'RECONCILED' : 'UNRECONCILED'
      : warnings.length ? 'CALCULATED_WITH_WARNINGS' : 'INCOMPLETE';

  return {
    readiness,
    blockers,
    warnings,
    mileagePolicy: 'LOAD_MILES_DELIVERED_IN_PERIOD' as const,
    eligibleMilesThousandths,
    excludedMilesThousandths: null,
    tripBreakdown,
    baseEarningMinor,
    components: categories,
    creditMinor,
    debitMinor,
    calculatedPayoutMinor,
    externalPayoutMinor,
    payoutDifferenceMinor,
  };
}
