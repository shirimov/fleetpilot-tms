import type { FinancialDirection, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { BankLedgerNotFoundError, BankLedgerValidationError } from './bank-ledger-errors';

export function normalizeMerchant(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ') ?? '';
  if (/\b(PILOT|FLYING J)\b/.test(normalized)) return 'PILOT FLYING J';
  return normalized;
}

export function normalizeDescriptionToken(value: string) {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

type SuggestionTransaction = { merchantName: string | null; originalDescription: string | null; direction: FinancialDirection | null; amountMinor: bigint | null; bankAccountId: string; providerCategory: unknown };
type SuggestionRule = { id: string; name: string; merchantNormalized: string | null; descriptionContainsNormalized: string | null; direction: FinancialDirection | null; bankAccountId: string | null; minimumAmountMinor: bigint | null; maximumAmountMinor: bigint | null; categoryId: string; scope: 'COMPANY_LEVEL' | 'ENTITY_ALLOCATED'; truckId: string | null; trailerId: string | null; driverId: string | null; partyId: string | null };

export function matchRule(transaction: SuggestionTransaction, rules: SuggestionRule[]) {
  const merchant = normalizeMerchant(transaction.merchantName || transaction.originalDescription);
  const description = normalizeDescriptionToken(transaction.originalDescription ?? '');
  const amount = transaction.amountMinor ?? BigInt(0);
  return rules.find((rule) =>
    (!rule.merchantNormalized || rule.merchantNormalized === merchant) &&
    (!rule.descriptionContainsNormalized || description.includes(rule.descriptionContainsNormalized)) &&
    (!rule.direction || rule.direction === transaction.direction) &&
    (!rule.bankAccountId || rule.bankAccountId === transaction.bankAccountId) &&
    (rule.minimumAmountMinor == null || amount >= rule.minimumAmountMinor) &&
    (rule.maximumAmountMinor == null || amount <= rule.maximumAmountMinor));
}

export function conservativeSemantic(transaction: SuggestionTransaction, categories: { id: string; name: string }[]) {
  const merchant = normalizeMerchant(transaction.merchantName || transaction.originalDescription);
  const exactCategory = (terms: string[]) => categories.find((category) => terms.some((term) => normalizeDescriptionToken(category.name) === term));
  const category = merchant === 'PILOT FLYING J' ? exactCategory(['FUEL', 'TRUCK FUEL'])
    : /\b(TOLL|EZ PASS|E ZPASS|PREPASS)\b/.test(merchant) ? exactCategory(['TOLLS', 'TOLL'])
      : /\b(PAYROLL|ADP)\b/.test(merchant) ? exactCategory(['PAYROLL', 'DRIVER PAY']) : undefined;
  return category ? { categoryId: category.id, source: 'MERCHANT_SEMANTICS' as const, confidence: 'HIGH' as const, reason: `Known merchant semantics: ${merchant}.` } : null;
}

export type RuleInput = {
  name: string; isEnabled?: boolean; merchantNormalized?: string | null;
  descriptionContains?: string | null; direction?: FinancialDirection | null;
  bankAccountId?: string | null; minimumAmountMinor?: bigint | null; maximumAmountMinor?: bigint | null;
  categoryId: string; scope: 'COMPANY_LEVEL' | 'ENTITY_ALLOCATED'; truckId?: string | null;
  trailerId?: string | null; driverId?: string | null; partyId?: string | null;
};

export class BankCategorizationService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async listRules(context: FinancialAuthorization, companyId = context.activeCompanyId) {
    this.requireCompany(context, companyId);
    const rules = await this.database.bankCategorizationRule.findMany({
      where: { companyId }, include: { category: { select: { id: true, name: true } }, company: { select: { name: true } }, createdBy: { select: { displayName: true, email: true } }, bankAccount: { select: { institutionName: true } }, truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } }, driver: { select: { firstName: true, lastName: true } }, party: { select: { name: true } } },
      orderBy: [{ isEnabled: 'desc' }, { updatedAt: 'desc' }],
    });
    return rules.map((rule) => ({ ...rule, minimumAmountMinor: rule.minimumAmountMinor?.toString() ?? null, maximumAmountMinor: rule.maximumAmountMinor?.toString() ?? null }));
  }

  async createRule(context: FinancialAuthorization, companyId: string, input: RuleInput) {
    this.requireCompany(context, companyId);
    return this.database.$transaction(async (tx) => {
      await this.validateRule(tx, context, companyId, input);
      const rule = await tx.bankCategorizationRule.create({ data: this.ruleData(context, companyId, input) });
      await this.audit(tx, context, companyId, 'BANK_CATEGORIZATION_RULE_CREATED', rule.id, null, rule);
      return rule;
    }, { isolationLevel: 'Serializable' });
  }

  async updateRule(context: FinancialAuthorization, id: string, input: RuleInput) {
    return this.database.$transaction(async (tx) => {
      const before = await tx.bankCategorizationRule.findFirst({ where: { id, companyId: { in: context.companyIds } } });
      if (!before) throw new BankLedgerNotFoundError();
      await this.validateRule(tx, context, before.companyId, input);
      const rule = await tx.bankCategorizationRule.update({ where: { id }, data: { ...this.ruleData(context, before.companyId, input), createdByUserId: undefined } });
      await this.audit(tx, context, before.companyId, 'BANK_CATEGORIZATION_RULE_UPDATED', id, before, rule);
      return rule;
    }, { isolationLevel: 'Serializable' });
  }

  async deleteRule(context: FinancialAuthorization, id: string) {
    return this.database.$transaction(async (tx) => {
      const before = await tx.bankCategorizationRule.findFirst({ where: { id, companyId: { in: context.companyIds } } });
      if (!before) throw new BankLedgerNotFoundError();
      await tx.bankCategorizationRule.delete({ where: { id } });
      await this.audit(tx, context, before.companyId, 'BANK_CATEGORIZATION_RULE_DELETED', id, before, null);
    }, { isolationLevel: 'Serializable' });
  }

  async setRuleEnabled(context: FinancialAuthorization, id: string, isEnabled: boolean) {
    return this.database.$transaction(async (tx) => {
      const before = await tx.bankCategorizationRule.findFirst({ where: { id, companyId: { in: context.companyIds } } });
      if (!before) throw new BankLedgerNotFoundError();
      const rule = await tx.bankCategorizationRule.update({ where: { id }, data: { isEnabled, updatedByUserId: context.userId } });
      await this.audit(tx, context, before.companyId, isEnabled ? 'BANK_CATEGORIZATION_RULE_ENABLED' : 'BANK_CATEGORIZATION_RULE_DISABLED', id, before, rule);
      return rule;
    }, { isolationLevel: 'Serializable' });
  }

  async progress(context: FinancialAuthorization, companyId = context.activeCompanyId) {
    this.requireCompany(context, companyId);
    const rows = await this.database.bankTransaction.findMany({ where: { companyId }, select: { amountMinor: true, direction: true, classification: { select: { categoryId: true, reviewStatus: true } } } });
    const result = { total: rows.length, categorized: 0, uncategorized: 0, reviewed: 0, suggested: 0, needsReview: 0, unreviewed: 0, ignored: 0, inflowMinor: BigInt(0), outflowMinor: BigInt(0), categorizedInflowMinor: BigInt(0), categorizedOutflowMinor: BigInt(0) };
    for (const row of rows) {
      const amount = row.amountMinor ?? BigInt(0); const categorized = Boolean(row.classification?.categoryId);
      if (categorized) result.categorized++; else result.uncategorized++;
      const status = row.classification?.reviewStatus ?? 'UNREVIEWED';
      if (status === 'REVIEWED') result.reviewed++; else if (status === 'SUGGESTED') result.suggested++; else if (status === 'NEEDS_REVIEW') result.needsReview++; else if (status === 'IGNORED') result.ignored++; else result.unreviewed++;
      if (row.direction === 'INFLOW') { result.inflowMinor += amount; if (categorized) result.categorizedInflowMinor += amount; }
      if (row.direction === 'OUTFLOW') { result.outflowMinor += amount; if (categorized) result.categorizedOutflowMinor += amount; }
    }
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]));
  }

  async patterns(context: FinancialAuthorization, companyId = context.activeCompanyId) {
    this.requireCompany(context, companyId);
    const rows = await this.database.bankTransaction.findMany({ where: { companyId }, select: { merchantName: true, originalDescription: true, direction: true, amountMinor: true, date: true, classification: { select: { categoryId: true, reviewStatus: true } } } });
    const groups = new Map<string, { merchantNormalized: string; direction: FinancialDirection | null; count: number; totalMinor: bigint; earliest: Date; latest: Date; uncategorized: number; representativeDescriptions: string[] }>();
    for (const row of rows) { const merchantNormalized = normalizeMerchant(row.merchantName || row.originalDescription) || 'UNIDENTIFIED'; const key = `${row.direction ?? 'NEUTRAL'}:${merchantNormalized}`; const current = groups.get(key) ?? { merchantNormalized, direction: row.direction, count: 0, totalMinor: BigInt(0), earliest: row.date, latest: row.date, uncategorized: 0, representativeDescriptions: [] }; current.count++; current.totalMinor += row.amountMinor ?? BigInt(0); if (row.date < current.earliest) current.earliest = row.date; if (row.date > current.latest) current.latest = row.date; if (!row.classification?.categoryId) current.uncategorized++; const description = row.originalDescription?.trim(); if (description && !current.representativeDescriptions.includes(description) && current.representativeDescriptions.length < 3) current.representativeDescriptions.push(description); groups.set(key, current); }
    return [...groups.values()].map((group) => ({ ...group, totalMinor: group.totalMinor.toString() })).sort((a, b) => b.count - a.count || a.merchantNormalized.localeCompare(b.merchantNormalized));
  }

  private requireCompany(context: FinancialAuthorization, companyId: string) { if (!context.companyIds.includes(companyId)) throw new BankLedgerNotFoundError(); }
  private ruleData(context: FinancialAuthorization, companyId: string, input: RuleInput) {
    const merchant = normalizeMerchant(input.merchantNormalized); const token = input.descriptionContains ? normalizeDescriptionToken(input.descriptionContains) : '';
    return { operatingGroupId: context.operatingGroupId, companyId, name: input.name.trim(), isEnabled: input.isEnabled ?? true, merchantNormalized: merchant || null, descriptionContainsNormalized: token || null, direction: input.direction ?? null, bankAccountId: input.bankAccountId ?? null, minimumAmountMinor: input.minimumAmountMinor ?? null, maximumAmountMinor: input.maximumAmountMinor ?? null, categoryId: input.categoryId, scope: input.scope, truckId: input.truckId ?? null, trailerId: input.trailerId ?? null, driverId: input.driverId ?? null, partyId: input.partyId ?? null, createdByUserId: context.userId, updatedByUserId: context.userId };
  }
  private async validateRule(tx: Prisma.TransactionClient, context: FinancialAuthorization, companyId: string, input: RuleInput) {
    if (!input.name.trim()) throw new BankLedgerValidationError('Rule name is required.');
    if (!normalizeMerchant(input.merchantNormalized) && !normalizeDescriptionToken(input.descriptionContains ?? '') && !input.direction && !input.bankAccountId && input.minimumAmountMinor == null && input.maximumAmountMinor == null) throw new BankLedgerValidationError('At least one rule condition is required.');
    if (input.minimumAmountMinor != null && input.maximumAmountMinor != null && input.minimumAmountMinor > input.maximumAmountMinor) throw new BankLedgerValidationError('Minimum amount cannot exceed maximum amount.');
    const category = await tx.financialCategory.findFirst({ where: { id: input.categoryId, operatingGroupId: context.operatingGroupId, isActive: true } });
    if (!category) throw new BankLedgerValidationError('Category is invalid.');
    if (input.bankAccountId && !(await tx.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId } }))) throw new BankLedgerValidationError('Bank account is invalid.');
    const entities = [input.truckId && tx.truck.findFirst({ where: { id: input.truckId, companyId } }), input.trailerId && tx.trailer.findFirst({ where: { id: input.trailerId, companyId } }), input.driverId && tx.driver.findFirst({ where: { id: input.driverId, companyId } }), input.partyId && tx.financialParty.findFirst({ where: { id: input.partyId, operatingGroupId: context.operatingGroupId, OR: [{ companyId }, { companyId: null }] } })].filter(Boolean) as Promise<unknown>[];
    if ((await Promise.all(entities)).some((entity) => !entity)) throw new BankLedgerValidationError('Rule entity is invalid.');
    if (input.scope === 'COMPANY_LEVEL' && entities.length) throw new BankLedgerValidationError('Company-level rules cannot assign an entity.');
    if (input.scope === 'ENTITY_ALLOCATED' && !entities.length) throw new BankLedgerValidationError('Entity-allocated rules require an entity.');
  }
  private async audit(tx: Prisma.TransactionClient, context: FinancialAuthorization, companyId: string, action: string, ruleId: string, before: unknown, after: unknown) { await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId, actorUserId: context.userId, action, before: before ? JSON.parse(JSON.stringify(before, (_, v) => typeof v === 'bigint' ? v.toString() : v)) : undefined, after: after ? JSON.parse(JSON.stringify(after, (_, v) => typeof v === 'bigint' ? v.toString() : v)) : undefined, metadata: { ruleId } } }); }
}

export const bankCategorizationService = new BankCategorizationService();
