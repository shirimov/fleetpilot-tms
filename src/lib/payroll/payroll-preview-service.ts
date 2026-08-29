import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationService, authorizationService } from '@/lib/auth/authorization';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from '@/lib/finance/financial-control-errors';
import { normalizeCurrency, parsePositiveMinorUnits } from '@/lib/finance/money';
import { calculatePayrollPreview } from './payroll-calculation';

const text = (value: unknown, label: string, max = 200) => {
  if (typeof value !== 'string' || !value.trim()) throw new FinancialValidationError(`${label} is required.`);
  if (value.trim().length > max) throw new FinancialValidationError(`${label} is too long.`);
  return value.trim();
};
const optionalText = (value: unknown, max = 200) => typeof value === 'string' && value.trim()
  ? text(value, 'Value', max)
  : null;
const dateOnly = (value: unknown, label: string) => {
  const normalized = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new FinancialValidationError(`${label} must be a calendar date.`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) throw new FinancialValidationError(`${label} is invalid.`);
  return date;
};
const minorOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new FinancialValidationError('Amount must be a non-negative monetary value.');
  const normalized = String(value).trim().replaceAll(',', '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new FinancialValidationError('Amount must be a non-negative monetary value with at most two decimal places.');
  const [whole, fraction = ''] = normalized.split('.');
  return (BigInt(whole) * BigInt(100)) + BigInt(fraction.padEnd(2, '0'));
};
const jsonMinor = (value: bigint | null) => value === null ? null : value.toString();

export class PayrollPreviewService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorization: AuthorizationService = authorizationService,
  ) {}

  private async context() {
    return this.authorization.requireActiveCompany('ADMIN');
  }

  async listPeriods() {
    const context = await this.context();
    return this.database.payrollPeriod.findMany({
      where: { companyId: context.companyId },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { adjustments: true, externalReferences: true } } },
    });
  }

  async createPeriod(input: Record<string, unknown>) {
    const context = await this.context();
    const startDate = dateOnly(input.startDate, 'Start date');
    const endDate = dateOnly(input.endDate, 'End date');
    if (endDate < startDate) throw new FinancialValidationError('End date must be on or after start date.');
    try {
      return await this.database.payrollPeriod.create({ data: {
        companyId: context.companyId,
        identifier: text(input.identifier, 'Period identifier'),
        startDate,
        endDate,
        externalProvider: optionalText(input.externalProvider, 50),
        externalPeriod: optionalText(input.externalPeriod),
        externalBatchId: optionalText(input.externalBatchId),
        notes: optionalText(input.notes, 2000),
      } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new FinancialConflictError('This pay-period identifier already exists.');
      throw error;
    }
  }

  async participants() {
    const context = await this.context();
    const [drivers, contractors] = await Promise.all([
      this.database.driver.findMany({ where: { companyId: context.companyId }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], select: { id: true, firstName: true, lastName: true, truck: { select: { id: true, unitNumber: true } } } }),
      this.database.financialParty.findMany({ where: { companyId: context.companyId, type: 'OWNER_OPERATOR', isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    return { drivers, contractors };
  }

  async createContract(input: Record<string, unknown>) {
    const context = await this.context();
    const participantType = input.participantType === 'CONTRACTOR' ? 'CONTRACTOR' : 'COMPANY_DRIVER';
    const type = ['PER_MILE', 'PERCENTAGE', 'FLAT', 'HOURLY', 'OTHER'].includes(String(input.type)) ? String(input.type) as 'PER_MILE' | 'PERCENTAGE' | 'FLAT' | 'HOURLY' | 'OTHER' : 'OTHER';
    const driverId = participantType === 'COMPANY_DRIVER' ? text(input.participantId, 'Driver') : null;
    const contractorPartyId = participantType === 'CONTRACTOR' ? text(input.participantId, 'Contractor') : null;
    if (driverId && !await this.database.driver.findFirst({ where: { id: driverId, companyId: context.companyId } })) throw new FinancialValidationError('Driver is outside the active company.');
    if (contractorPartyId && !await this.database.financialParty.findFirst({ where: { id: contractorPartyId, companyId: context.companyId, type: 'OWNER_OPERATOR' } })) throw new FinancialValidationError('Contractor is outside the active company.');
    const rateMinorPerMile = type === 'PER_MILE' ? parsePositiveMinorUnits(input.ratePerMile) : null;
    const percentageBasisPoints = type === 'PERCENTAGE' ? Math.round(Number(input.percentage) * 100) : null;
    if (percentageBasisPoints !== null && (!Number.isInteger(percentageBasisPoints) || percentageBasisPoints < 0 || percentageBasisPoints > 10000)) throw new FinancialValidationError('Percentage must be between 0 and 100.');
    const percentageBase = type === 'PERCENTAGE' && ['GROSS_REVENUE', 'LINEHAUL', 'TRIP_RATE', 'NET_AFTER_SPECIFIC_CHARGES', 'UNKNOWN'].includes(String(input.percentageBase)) ? String(input.percentageBase) as 'GROSS_REVENUE' | 'LINEHAUL' | 'TRIP_RATE' | 'NET_AFTER_SPECIFIC_CHARGES' | 'UNKNOWN' : null;
    return this.database.payrollPayContract.create({ data: {
      companyId: context.companyId, participantType, driverId, contractorPartyId, type,
      rateMinorPerMile, percentageBasisPoints, percentageBase,
      appliesToTeam: input.appliesToTeam === true,
      teamAllocationStrategy: input.appliesToTeam === true ? 'UNKNOWN' : null,
      effectiveFrom: dateOnly(input.effectiveFrom, 'Effective date'),
    } });
  }

  async createAdjustment(input: Record<string, unknown>) {
    const context = await this.context();
    const period = await this.database.payrollPeriod.findFirst({ where: { id: text(input.periodId, 'Pay period'), companyId: context.companyId } });
    if (!period) throw new FinancialNotFoundError();
    const participantType = input.participantType === 'CONTRACTOR' ? 'CONTRACTOR' : 'COMPANY_DRIVER';
    const driverId = participantType === 'COMPANY_DRIVER' ? text(input.participantId, 'Driver') : null;
    const contractorPartyId = participantType === 'CONTRACTOR' ? text(input.participantId, 'Contractor') : null;
    if (driverId && !await this.database.driver.findFirst({ where: { id: driverId, companyId: context.companyId } })) throw new FinancialValidationError('Driver is outside the active company.');
    if (contractorPartyId && !await this.database.financialParty.findFirst({ where: { id: contractorPartyId, companyId: context.companyId, type: 'OWNER_OPERATOR' } })) throw new FinancialValidationError('Contractor is outside the active company.');
    const category = String(input.category);
    if (!['REIMBURSEMENT', 'CREDIT', 'ADVANCE', 'DEDUCTION', 'RECURRING_DEDUCTION', 'FUEL', 'TOLL', 'ESCROW', 'OTHER'].includes(category)) throw new FinancialValidationError('Adjustment category is invalid.');
    return this.database.payrollAdjustment.create({ data: {
      companyId: context.companyId, periodId: period.id, participantType, driverId, contractorPartyId,
      category: category as never,
      direction: ['REIMBURSEMENT', 'CREDIT'].includes(category) ? 'CREDIT' : input.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      amountMinor: parsePositiveMinorUnits(input.amount), currency: normalizeCurrency(input.currency ?? 'USD'),
      description: text(input.description, 'Description', 500), effectiveDate: dateOnly(input.effectiveDate, 'Effective date'),
      createdByUserId: context.user.id,
    } });
  }

  async createReference(input: Record<string, unknown>) {
    const context = await this.context();
    const period = await this.database.payrollPeriod.findFirst({ where: { id: text(input.periodId, 'Pay period'), companyId: context.companyId } });
    if (!period) throw new FinancialNotFoundError();
    const participantType = input.participantType === 'CONTRACTOR' ? 'CONTRACTOR' : 'COMPANY_DRIVER';
    const driverId = participantType === 'COMPANY_DRIVER' ? text(input.participantId, 'Driver') : null;
    const contractorPartyId = participantType === 'CONTRACTOR' ? text(input.participantId, 'Contractor') : null;
    if (driverId && !await this.database.driver.findFirst({ where: { id: driverId, companyId: context.companyId } })) throw new FinancialValidationError('Driver is outside the active company.');
    if (contractorPartyId && !await this.database.financialParty.findFirst({ where: { id: contractorPartyId, companyId: context.companyId, type: 'OWNER_OPERATOR' } })) throw new FinancialValidationError('Contractor is outside the active company.');
    return this.database.payrollExternalReference.upsert({
      where: driverId ? { periodId_driverId_provider: { periodId: period.id, driverId, provider: text(input.provider, 'Provider', 50) } } : { periodId_contractorPartyId_provider: { periodId: period.id, contractorPartyId: contractorPartyId!, provider: text(input.provider, 'Provider', 50) } },
      create: { companyId: context.companyId, periodId: period.id, participantType, driverId, contractorPartyId, provider: text(input.provider, 'Provider', 50), externalStatementRef: optionalText(input.externalStatementRef), externalPeriod: optionalText(input.externalPeriod), earningMinor: minorOrNull(input.earning), reimbursementMinor: minorOrNull(input.reimbursement), fuelMinor: minorOrNull(input.fuel), tollMinor: minorOrNull(input.toll), deductionsMinor: minorOrNull(input.deductions), payoutMinor: minorOrNull(input.payout), currency: normalizeCurrency(input.currency ?? 'USD'), notes: optionalText(input.notes, 2000), createdByUserId: context.user.id },
      update: { externalStatementRef: optionalText(input.externalStatementRef), externalPeriod: optionalText(input.externalPeriod), earningMinor: minorOrNull(input.earning), reimbursementMinor: minorOrNull(input.reimbursement), fuelMinor: minorOrNull(input.fuel), tollMinor: minorOrNull(input.toll), deductionsMinor: minorOrNull(input.deductions), payoutMinor: minorOrNull(input.payout), notes: optionalText(input.notes, 2000) },
    });
  }

  async periodPreview(periodId: string) {
    const context = await this.context();
    const period = await this.database.payrollPeriod.findFirst({ where: { id: periodId, companyId: context.companyId } });
    if (!period) throw new FinancialNotFoundError();
    const endExclusive = new Date(period.endDate); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const drivers = await this.database.driver.findMany({
      where: { companyId: context.companyId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        truck: { select: { id: true, unitNumber: true } },
        payrollContracts: { where: { companyId: context.companyId, isActive: true, effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
        payrollAdjustments: { where: { periodId: period.id, companyId: context.companyId }, orderBy: { createdAt: 'asc' } },
        payrollReferences: { where: { periodId: period.id, companyId: context.companyId }, orderBy: { createdAt: 'desc' }, take: 1 },
        loads: {
          where: {
            companyId: context.companyId,
            deliveryDate: { gte: period.startDate, lt: endExclusive },
            status: { in: ['DELIVERED', 'POD_UPLOADED', 'INVOICED', 'PAID'] },
          },
          orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const driverPreviews = drivers.map((driver) => {
      const contract = driver.payrollContracts[0] ?? null;
      const reference = driver.payrollReferences[0] ?? null;
      const calculation = calculatePayrollPreview({
        participantType: 'COMPANY_DRIVER',
        contract: contract && { type: contract.type, rateMinorPerMile: contract.rateMinorPerMile, percentageBasisPoints: contract.percentageBasisPoints, percentageBase: contract.percentageBase, appliesToTeam: contract.appliesToTeam, teamAllocationStrategy: contract.teamAllocationStrategy },
        trips: driver.loads.map((load) => ({ id: load.id, reference: load.referenceNum ?? load.loadNumber, miles: load.miles === null ? null : String(load.miles), mileageSource: 'LOAD_MILES' })),
        adjustments: driver.payrollAdjustments.map((item) => ({ id: item.id, category: item.category, direction: item.direction, amountMinor: item.amountMinor, description: item.description })),
        externalReference: reference && { earningMinor: reference.earningMinor, reimbursementMinor: reference.reimbursementMinor, fuelMinor: reference.fuelMinor, tollMinor: reference.tollMinor, deductionsMinor: reference.deductionsMinor, payoutMinor: reference.payoutMinor },
      });
      return { id: driver.id, name: `${driver.firstName} ${driver.lastName}`, truck: driver.truck, contract: contract ? { ...contract, rateMinorPerMile: jsonMinor(contract.rateMinorPerMile) } : null, reference: reference ? { ...reference, earningMinor: jsonMinor(reference.earningMinor), reimbursementMinor: jsonMinor(reference.reimbursementMinor), fuelMinor: jsonMinor(reference.fuelMinor), tollMinor: jsonMinor(reference.tollMinor), deductionsMinor: jsonMinor(reference.deductionsMinor), payoutMinor: jsonMinor(reference.payoutMinor) } : null, calculation: JSON.parse(JSON.stringify(calculation, (_, value) => typeof value === 'bigint' ? value.toString() : value)) };
    });
    const contractors = await this.database.financialParty.findMany({
      where: { companyId: context.companyId, type: 'OWNER_OPERATOR', isActive: true },
      orderBy: { name: 'asc' },
      include: {
        payrollContracts: { where: { companyId: context.companyId, isActive: true, effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
        payrollAdjustments: { where: { periodId: period.id, companyId: context.companyId }, orderBy: { createdAt: 'asc' } },
        payrollReferences: { where: { periodId: period.id, companyId: context.companyId }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const contractorPreviews = contractors.map((contractor) => {
      const contract = contractor.payrollContracts[0] ?? null;
      const reference = contractor.payrollReferences[0] ?? null;
      const calculation = calculatePayrollPreview({
        participantType: 'CONTRACTOR',
        contract: contract && { type: contract.type, rateMinorPerMile: contract.rateMinorPerMile, percentageBasisPoints: contract.percentageBasisPoints, percentageBase: contract.percentageBase, appliesToTeam: contract.appliesToTeam, teamAllocationStrategy: contract.teamAllocationStrategy },
        trips: [],
        adjustments: contractor.payrollAdjustments.map((item) => ({ id: item.id, category: item.category, direction: item.direction, amountMinor: item.amountMinor, description: item.description })),
        externalReference: reference && { earningMinor: reference.earningMinor, reimbursementMinor: reference.reimbursementMinor, fuelMinor: reference.fuelMinor, tollMinor: reference.tollMinor, deductionsMinor: reference.deductionsMinor, payoutMinor: reference.payoutMinor },
      });
      return { id: contractor.id, name: contractor.name, truck: null, contract: contract ? { ...contract, rateMinorPerMile: jsonMinor(contract.rateMinorPerMile) } : null, reference: reference ? { ...reference, earningMinor: jsonMinor(reference.earningMinor), reimbursementMinor: jsonMinor(reference.reimbursementMinor), fuelMinor: jsonMinor(reference.fuelMinor), tollMinor: jsonMinor(reference.tollMinor), deductionsMinor: jsonMinor(reference.deductionsMinor), payoutMinor: jsonMinor(reference.payoutMinor) } : null, calculation: JSON.parse(JSON.stringify(calculation, (_, value) => typeof value === 'bigint' ? value.toString() : value)) };
    });
    const previews = [...driverPreviews, ...contractorPreviews];
    const totals = previews.reduce((acc, preview) => {
      const currentCount = typeof acc[preview.calculation.readiness] === 'number'
        ? acc[preview.calculation.readiness] as number
        : 0;
      acc[preview.calculation.readiness] = currentCount + 1;
      if (preview.calculation.calculatedPayoutMinor !== null) {
        acc.totalCalculatedPayoutMinor = (
          BigInt(String(acc.totalCalculatedPayoutMinor))
          + BigInt(preview.calculation.calculatedPayoutMinor)
        ).toString();
      }
      return acc;
    }, { totalCalculatedPayoutMinor: '0' } as Record<string, number | string>);
    return { period, previews, totals, contractorNotice: 'Contractor percentage previews remain blocked until an explicit, verified percentage base and trip relationship are configured.' };
  }
}

export const payrollPreviewService = new PayrollPreviewService();
