import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationService, authorizationService } from '@/lib/auth/authorization';
import { FinancialNotFoundError, FinancialValidationError } from '@/lib/finance/financial-control-errors';
import { normalizeCurrency, parsePositiveMinorUnits } from '@/lib/finance/money';
import { PayrollPreviewService, payrollPreviewService } from './payroll-preview-service';
import { evaluatePayrollCase } from './payroll-case-reconciliation';

const ruleTypes = ['MILEAGE_SOURCE', 'DEADHEAD', 'TEAM_ALLOCATION', 'CONTRACTOR_PERCENTAGE_BASE', 'FUEL_DEDUCTION', 'TOLL_DEDUCTION', 'RECURRING_DEDUCTION', 'ESCROW', 'ADVANCE_REPAYMENT'] as const;
const inputSourceValues = ['CANONICAL_FLEETPILOT', 'MANUAL_AUDIT_INPUT', 'EXTERNAL_REFERENCE', 'DERIVED', 'UNAVAILABLE'] as const;
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
    const applicability = ['APPLICABLE', 'NOT_APPLICABLE', 'REQUIRED_BUT_UNVERIFIED'].includes(String(input.applicability)) ? String(input.applicability) as 'APPLICABLE' | 'NOT_APPLICABLE' | 'REQUIRED_BUT_UNVERIFIED' : 'REQUIRED_BUT_UNVERIFIED';
    let configuration: unknown = input.configuration;
    if (typeof configuration === 'string') { try { configuration = JSON.parse(configuration); } catch { throw new FinancialValidationError('Rule configuration must be valid JSON.'); } }
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw new FinancialValidationError('Rule configuration must be a JSON object.');
    const evidenceNotes = typeof input.evidenceNotes === 'string' ? input.evidenceNotes.trim() || null : null;
    const evidenceCaseIds = Array.isArray(input.evidenceCaseIds) ? input.evidenceCaseIds.filter((id): id is string => typeof id === 'string') : typeof input.evidenceCaseId === 'string' && input.evidenceCaseId ? [input.evidenceCaseId] : [];
    if (applicability === 'NOT_APPLICABLE' && (verificationStatus !== 'ADMIN_VERIFIED' || !evidenceNotes)) throw new FinancialValidationError('Not-applicable rules require admin verification and a documented rationale.');
    if (verificationStatus === 'ADMIN_VERIFIED' && applicability === 'APPLICABLE') {
      const matched = await this.database.payrollReconciliationCase.count({ where: { id: { in: evidenceCaseIds }, companyId: context.companyId, status: 'MATCHED', exactMatch: true } });
      if (!evidenceCaseIds.length || matched !== evidenceCaseIds.length) throw new FinancialValidationError('Admin-verified applicable rules require matched same-company audit-case evidence.');
    }
    const now = new Date();
    return this.database.$transaction(async (tx) => {
      const rule = await tx.payrollRule.upsert({ where: { companyId_type: { companyId: context.companyId, type: type as never } }, create: { companyId: context.companyId, type: type as never, configuration: configuration as never, verificationStatus, applicability, evidenceNotes, testedAt: input.tested === true || input.tested === 'true' ? now : null, reconciledAt: input.reconciled === true || input.reconciled === 'true' ? now : null, verifiedByUserId: verificationStatus === 'ADMIN_VERIFIED' ? context.user.id : null }, update: { configuration: configuration as never, verificationStatus, applicability, evidenceNotes, testedAt: input.tested === true || input.tested === 'true' ? now : null, reconciledAt: input.reconciled === true || input.reconciled === 'true' ? now : null, verifiedByUserId: verificationStatus === 'ADMIN_VERIFIED' ? context.user.id : null } });
      for (const caseId of evidenceCaseIds) await tx.payrollRuleEvidence.upsert({ where: { ruleId_caseId: { ruleId: rule.id, caseId } }, create: { companyId: context.companyId, ruleId: rule.id, caseId, notes: evidenceNotes, createdByUserId: context.user.id }, update: { notes: evidenceNotes } });
      return rule;
    });
  }
  async createRecurringRule(input: Record<string, unknown>) {
    const context = await this.context(); const participant = await this.participant(context.companyId, input); const from = dateOnly(input.effectiveFrom, 'Effective start'); const to = input.effectiveTo ? dateOnly(input.effectiveTo, 'Effective end') : null;
    if (to && to < from) throw new FinancialValidationError('Effective end must not precede start.');
    return this.database.payrollRecurringDeductionRule.create({ data: { companyId: context.companyId, ...participant, category: required(input.category, 'Category', 100), description: required(input.description, 'Description'), amountMinor: parsePositiveMinorUnits(input.amount), currency: normalizeCurrency(input.currency ?? 'USD'), frequency: required(input.frequency, 'Frequency', 50), effectiveFrom: from, effectiveTo: to, verificationStatus: ['UNVERIFIED', 'OBSERVED', 'ADMIN_VERIFIED'].includes(String(input.verificationStatus)) ? input.verificationStatus as never : 'UNVERIFIED', createdByUserId: context.user.id } });
  }
  async listCases() { const context = await this.context(); return this.database.payrollReconciliationCase.findMany({ where: { companyId: context.companyId }, orderBy: { createdAt: 'desc' }, include: { period: { select: { identifier: true } }, driver: { select: { firstName: true, lastName: true } }, contractorParty: { select: { name: true } }, ruleEvidence: { select: { rule: { select: { type: true } } } } } }); }
  async createCase(input: Record<string, unknown>) {
    const context = await this.context(); const periodId = required(input.periodId, 'Pay period'); const participant = await this.participant(context.companyId, input); const preview = await this.previews.periodPreview(periodId); const participantId = participant.driverId ?? participant.contractorPartyId!; const item = preview.previews.find((entry) => entry.id === participantId); if (!item) throw new FinancialNotFoundError();
    const inputSources = input.inputSources && typeof input.inputSources === 'object' && !Array.isArray(input.inputSources) ? input.inputSources as Record<string, string> : {};
    if (Object.values(inputSources).some((source) => !inputSourceValues.includes(source as typeof inputSourceValues[number]))) throw new FinancialValidationError('Payroll input source classification is invalid.');
    const evaluation = evaluatePayrollCase(item.calculation as never, (item.reference ?? {}) as never, inputSources);
    const allowed = ['OPEN', 'MATCHED', 'EXPLAINED_DIFFERENCE', 'UNEXPLAINED_DIFFERENCE', 'RULE_GAP', 'DATA_GAP']; const requested = String(input.status ?? '');
    if (requested === 'MATCHED' && !evaluation.exactMatch) throw new FinancialValidationError('Only an exact component-level reconciliation can be marked matched.');
    const status = allowed.includes(requested) ? requested : evaluation.exactMatch ? 'MATCHED' : item.calculation.blockers.length ? 'RULE_GAP' : evaluation.mismatches.some((name) => evaluation.components[name].materialUnknown) ? 'DATA_GAP' : 'UNEXPLAINED_DIFFERENCE';
    const caseType = ['SOLO_DRIVER', 'DRIVER_WITH_DEDUCTIONS', 'CONTRACTOR', 'TEAM_DRIVER', 'COMPLEX_CONTRACTOR', 'OTHER'].includes(String(input.caseType)) ? String(input.caseType) : 'OTHER';
    return this.database.payrollReconciliationCase.create({ data: { companyId: context.companyId, periodId, ...participant, status: status as never, caseType: caseType as never, truckUnitReference: typeof input.truckUnitReference === 'string' ? input.truckUnitReference.trim() || null : null, inputSources: inputSources as never, exactMatch: evaluation.exactMatch, evaluatedAt: new Date(), calculatedSnapshot: item.calculation as never, externalSnapshot: (item.reference ?? {}) as never, componentDifferences: evaluation as never, differenceTypes: item.calculation.differenceTypes as never, notes: typeof input.notes === 'string' ? input.notes.trim() || null : null, createdByUserId: context.user.id } });
  }
  async readiness() {
    const context = await this.context(); const [rules, matched] = await Promise.all([this.database.payrollRule.findMany({ where: { companyId: context.companyId }, include: { _count: { select: { evidence: true } } } }), this.database.payrollReconciliationCase.findMany({ where: { companyId: context.companyId, status: 'MATCHED', exactMatch: true }, select: { caseType: true } })]);
    const byType = new Map(rules.map((rule) => [rule.type, rule])); const checks = ruleTypes.map((type) => { const rule = byType.get(type); const notApplicable = rule?.applicability === 'NOT_APPLICABLE'; return { type, applicability: rule?.applicability ?? 'REQUIRED_BUT_UNVERIFIED', configured: Boolean(rule), verified: rule ? ['ADMIN_VERIFIED', 'PRODUCTION_READY'].includes(rule.verificationStatus) : false, tested: notApplicable || Boolean(rule?.testedAt), reconciled: notApplicable || Boolean(rule?.reconciledAt), evidenceCases: rule?._count.evidence ?? 0, blocker: !rule ? 'Not configured' : rule.applicability === 'REQUIRED_BUT_UNVERIFIED' ? 'Applicability not established' : !['ADMIN_VERIFIED', 'PRODUCTION_READY'].includes(rule.verificationStatus) ? 'Not admin verified' : !notApplicable && !rule._count.evidence ? 'No matched case evidence' : !notApplicable && !rule.testedAt ? 'Not tested' : !notApplicable && !rule.reconciledAt ? 'Not reconciled' : null }; });
    const matchedCaseTypes = [...new Set(matched.map((item) => item.caseType))]; const matchedCases = matched.length; const ready = checks.every((check) => !check.blocker) && matchedCaseTypes.length >= 3; const configured = checks.filter((check) => check.configured).length;
    return { status: ready ? 'READY_FOR_GENERATION_DESIGN' : configured ? 'PARTIALLY_READY' : 'NOT_READY', checks, matchedCases, matchedCaseTypes, requiredMatchedCases: 3, awaitingRealCases: matchedCases === 0, generationEnabled: false };
  }
}
export const payrollVerificationService = new PayrollVerificationService();
