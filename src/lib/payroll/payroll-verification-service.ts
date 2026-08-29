import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationService, authorizationService } from '@/lib/auth/authorization';
import { FinancialNotFoundError, FinancialValidationError } from '@/lib/finance/financial-control-errors';
import { normalizeCurrency, parsePositiveMinorUnits } from '@/lib/finance/money';
import { PayrollPreviewService, payrollPreviewService } from './payroll-preview-service';

const ruleTypes = ['MILEAGE_SOURCE', 'DEADHEAD', 'TEAM_ALLOCATION', 'CONTRACTOR_PERCENTAGE_BASE', 'FUEL_DEDUCTION', 'TOLL_DEDUCTION', 'RECURRING_DEDUCTION', 'ESCROW', 'ADVANCE_REPAYMENT'] as const;
const dateOnly = (value: unknown, label: string) => { const raw = String(value ?? ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new FinancialValidationError(`${label} must be a calendar date.`); const result = new Date(`${raw}T00:00:00.000Z`); if (result.toISOString().slice(0, 10) !== raw) throw new FinancialValidationError(`${label} is invalid.`); return result; };
const required = (value: unknown, label: string, max = 500) => { if (typeof value !== 'string' || !value.trim()) throw new FinancialValidationError(`${label} is required.`); if (value.trim().length > max) throw new FinancialValidationError(`${label} is too long.`); return value.trim(); };

export class PayrollVerificationService {
  constructor(private readonly database: PrismaClient = prisma, private readonly authorization: AuthorizationService = authorizationService, private readonly previews: PayrollPreviewService = payrollPreviewService) {}
  private context() { return this.authorization.requireActiveCompany('ADMIN'); }
  private async participant(companyId: string, input: Record<string, unknown>) {
    const participantType: 'CONTRACTOR' | 'COMPANY_DRIVER' = input.participantType === 'CONTRACTOR' ? 'CONTRACTOR' : 'COMPANY_DRIVER';
    const id = required(input.participantId, 'Participant');
    if (participantType === 'COMPANY_DRIVER') { if (!await this.database.driver.findFirst({ where: { id, companyId } })) throw new FinancialValidationError('Driver is outside the active company.'); return { participantType, driverId: id, contractorPartyId: null }; }
    if (!await this.database.financialParty.findFirst({ where: { id, companyId, type: 'OWNER_OPERATOR', isActive: true } })) throw new FinancialValidationError('Contractor is outside the active company.');
    return { participantType, driverId: null, contractorPartyId: id };
  }
  async listRules() { const context = await this.context(); return this.database.payrollRule.findMany({ where: { companyId: context.companyId }, orderBy: { type: 'asc' } }); }
  async saveRule(input: Record<string, unknown>) {
    const context = await this.context(); const type = String(input.type);
    if (!ruleTypes.includes(type as typeof ruleTypes[number])) throw new FinancialValidationError('Payroll rule type is invalid.');
    const verificationStatus = ['UNVERIFIED', 'OBSERVED', 'ADMIN_VERIFIED'].includes(String(input.verificationStatus)) ? String(input.verificationStatus) as 'UNVERIFIED' | 'OBSERVED' | 'ADMIN_VERIFIED' : 'UNVERIFIED';
    let configuration: unknown = input.configuration;
    if (typeof configuration === 'string') { try { configuration = JSON.parse(configuration); } catch { throw new FinancialValidationError('Rule configuration must be valid JSON.'); } }
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw new FinancialValidationError('Rule configuration must be a JSON object.');
    const now = new Date();
    return this.database.payrollRule.upsert({ where: { companyId_type: { companyId: context.companyId, type: type as never } }, create: { companyId: context.companyId, type: type as never, configuration: configuration as never, verificationStatus, evidenceNotes: typeof input.evidenceNotes === 'string' ? input.evidenceNotes.trim() || null : null, testedAt: input.tested === true || input.tested === 'true' ? now : null, reconciledAt: input.reconciled === true || input.reconciled === 'true' ? now : null, verifiedByUserId: verificationStatus === 'ADMIN_VERIFIED' ? context.user.id : null }, update: { configuration: configuration as never, verificationStatus, evidenceNotes: typeof input.evidenceNotes === 'string' ? input.evidenceNotes.trim() || null : null, testedAt: input.tested === true || input.tested === 'true' ? now : null, reconciledAt: input.reconciled === true || input.reconciled === 'true' ? now : null, verifiedByUserId: verificationStatus === 'ADMIN_VERIFIED' ? context.user.id : null } });
  }
  async createRecurringRule(input: Record<string, unknown>) {
    const context = await this.context(); const participant = await this.participant(context.companyId, input); const from = dateOnly(input.effectiveFrom, 'Effective start'); const to = input.effectiveTo ? dateOnly(input.effectiveTo, 'Effective end') : null;
    if (to && to < from) throw new FinancialValidationError('Effective end must not precede start.');
    return this.database.payrollRecurringDeductionRule.create({ data: { companyId: context.companyId, ...participant, category: required(input.category, 'Category', 100), description: required(input.description, 'Description'), amountMinor: parsePositiveMinorUnits(input.amount), currency: normalizeCurrency(input.currency ?? 'USD'), frequency: required(input.frequency, 'Frequency', 50), effectiveFrom: from, effectiveTo: to, verificationStatus: ['UNVERIFIED', 'OBSERVED', 'ADMIN_VERIFIED'].includes(String(input.verificationStatus)) ? input.verificationStatus as never : 'UNVERIFIED', createdByUserId: context.user.id } });
  }
  async listCases() { const context = await this.context(); return this.database.payrollReconciliationCase.findMany({ where: { companyId: context.companyId }, orderBy: { createdAt: 'desc' }, include: { period: { select: { identifier: true } }, driver: { select: { firstName: true, lastName: true } }, contractorParty: { select: { name: true } } } }); }
  async createCase(input: Record<string, unknown>) {
    const context = await this.context(); const periodId = required(input.periodId, 'Pay period'); const participant = await this.participant(context.companyId, input); const preview = await this.previews.periodPreview(periodId); const participantId = participant.driverId ?? participant.contractorPartyId!; const item = preview.previews.find((entry) => entry.id === participantId); if (!item) throw new FinancialNotFoundError();
    const allowed = ['OPEN', 'MATCHED', 'EXPLAINED_DIFFERENCE', 'UNEXPLAINED_DIFFERENCE', 'RULE_GAP', 'DATA_GAP']; const requested = String(input.status ?? '');
    if (requested === 'MATCHED' && item.calculation.readiness !== 'RECONCILED') throw new FinancialValidationError('Only a fully reconciled preview can be marked matched.');
    const status = allowed.includes(requested) ? requested : item.calculation.readiness === 'RECONCILED' ? 'MATCHED' : item.calculation.readiness === 'BLOCKED' ? 'RULE_GAP' : 'UNEXPLAINED_DIFFERENCE';
    return this.database.payrollReconciliationCase.create({ data: { companyId: context.companyId, periodId, ...participant, status: status as never, calculatedSnapshot: item.calculation as never, externalSnapshot: (item.reference ?? {}) as never, componentDifferences: { payoutDifferenceMinor: item.calculation.payoutDifferenceMinor, differenceTypes: item.calculation.differenceTypes } as never, differenceTypes: item.calculation.differenceTypes as never, notes: typeof input.notes === 'string' ? input.notes.trim() || null : null, createdByUserId: context.user.id } });
  }
  async readiness() {
    const context = await this.context(); const [rules, matchedCases] = await Promise.all([this.database.payrollRule.findMany({ where: { companyId: context.companyId } }), this.database.payrollReconciliationCase.count({ where: { companyId: context.companyId, status: 'MATCHED' } })]);
    const byType = new Map(rules.map((rule) => [rule.type, rule])); const checks = ruleTypes.map((type) => { const rule = byType.get(type); return { type, configured: Boolean(rule), verified: rule ? ['ADMIN_VERIFIED', 'PRODUCTION_READY'].includes(rule.verificationStatus) : false, tested: Boolean(rule?.testedAt), reconciled: Boolean(rule?.reconciledAt), blocker: !rule ? 'Not configured' : !['ADMIN_VERIFIED', 'PRODUCTION_READY'].includes(rule.verificationStatus) ? 'Not admin verified' : !rule.testedAt ? 'Not tested' : !rule.reconciledAt ? 'Not reconciled' : null }; });
    const ready = checks.every((check) => !check.blocker) && matchedCases >= 3; const configured = checks.filter((check) => check.configured).length;
    return { status: ready ? 'READY_FOR_GENERATION_DESIGN' : configured ? 'PARTIALLY_READY' : 'NOT_READY', checks, matchedCases, requiredMatchedCases: 3, generationEnabled: false };
  }
}
export const payrollVerificationService = new PayrollVerificationService();
