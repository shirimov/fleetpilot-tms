import { createHash } from 'node:crypto';
import { Prisma, PrismaClient, type PilotImportIssueCode } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';
import { PILOT_XLS_PARSER_VERSION, pilotXlsParser, type PilotParsedInvoice, type PilotParsedRow } from './pilot-xls-parser';

type DocumentMetadata = {
  originalFilename: string;
  displayFilename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  checksumSha256: string;
};

type IssueInput = {
  code: PilotImportIssueCode;
  message: string;
  eventId?: string;
  productLineId?: string;
  adjustmentId?: string;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
const hash = (parts: Array<string | number | bigint | null | undefined>) => createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u001f')).digest('hex');
const lastFour = (value: string) => value.replace(/\D/g, '').slice(-4) || null;

export class PilotImportService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async createImport(bytes: Uint8Array, metadata: DocumentMetadata, sourceId: string, context: FinancialAuthorization) {
    const parsed = pilotXlsParser.parse(bytes);
    try {
      const invoiceId = await this.database.$transaction(async (tx) => {
        await this.lock(tx, `pilot-invoice:${context.operatingGroupId}:${parsed.providerAccountHash}:${parsed.invoiceNumber}`);
        const source = await tx.financialSource.findFirst({ where: { id: sourceId, operatingGroupId: context.operatingGroupId, type: 'FUEL_CARD', isActive: true }, select: { id: true, currency: true } });
        if (!source) throw new FinancialValidationError('Select an active fuel-card financial source in this operating group.');
        if (source.currency !== 'USD') throw new FinancialValidationError('Pilot V1 supports USD fuel-card sources only.');
        if (await tx.pilotProviderInvoice.findUnique({ where: { operatingGroupId_provider_providerAccountHash_invoiceNumber: { operatingGroupId: context.operatingGroupId, provider: 'PILOT', providerAccountHash: parsed.providerAccountHash, invoiceNumber: parsed.invoiceNumber } }, select: { id: true } })) {
          throw new FinancialConflictError('This Pilot invoice was already imported.');
        }
        const statement = await tx.financialStatement.create({ data: {
          operatingGroupId: context.operatingGroupId, sourceId, type: 'FUEL_STATEMENT', periodStart: parsed.periodStart, periodEnd: parsed.periodEnd,
          statementDate: parsed.billingDate, ...metadata, importStatus: 'IMPORTING', currency: 'USD', sourceTotalMinor: parsed.invoiceTotalMinor,
          importedByUserId: context.userId,
        } });
        const invoice = await tx.pilotProviderInvoice.create({ data: {
          operatingGroupId: context.operatingGroupId, sourceId, providerAccountHash: parsed.providerAccountHash, invoiceNumber: parsed.invoiceNumber,
          billingDate: parsed.billingDate, dueDate: parsed.dueDate, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd,
          invoiceTotalMinor: parsed.invoiceTotalMinor, parsedTotalMinor: parsed.parsedTotalMinor, differenceMinor: parsed.differenceMinor,
          parseVersion: PILOT_XLS_PARSER_VERSION, uploadedByUserId: context.userId,
          documents: { create: { statementId: statement.id, role: 'STRUCTURED_SOURCE' } },
        } });
        await this.persistRows(tx, invoice.id, statement.id, parsed, context);
        const openIssues = await tx.pilotImportIssue.count({ where: { invoiceId: invoice.id, status: 'OPEN' } });
        const status = parsed.differenceMinor === BigInt(0) && openIssues === 0 ? 'READY_TO_POST' : 'NEEDS_REVIEW';
        await tx.pilotProviderInvoice.update({ where: { id: invoice.id }, data: { status } });
        await tx.financialStatement.update({ where: { id: statement.id }, data: { importStatus: status === 'READY_TO_POST' ? 'IMPORTED' : 'NEEDS_REVIEW', importedAt: new Date(), importedRowCount: parsed.rows.length, unresolvedRowCount: openIssues } });
        await tx.financialAuditEvent.createMany({ data: [
          { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, pilotProviderInvoiceId: invoice.id, action: 'PILOT_INVOICE_UPLOADED', metadata: { statementId: statement.id, checksumSha256: metadata.checksumSha256 } },
          { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, pilotProviderInvoiceId: invoice.id, action: 'PILOT_INVOICE_PARSED', metadata: { parseVersion: PILOT_XLS_PARSER_VERSION, rowCount: parsed.rows.length, differenceMinor: parsed.differenceMinor.toString(), openIssueCount: openIssues } },
        ] });
        return invoice.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.getInvoice(invoiceId, context);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new FinancialConflictError('This Pilot statement or invoice was already imported.');
      throw error;
    }
  }

  private async persistRows(tx: Prisma.TransactionClient, invoiceId: string, statementId: string, parsed: PilotParsedInvoice, context: FinancialAuthorization) {
    const mappings = await tx.pilotProductMapping.findMany({ where: { operatingGroupId: context.operatingGroupId, provider: 'PILOT', providerAccountHash: parsed.providerAccountHash, isActive: true }, select: { productCode: true, categoryId: true, productType: true } });
    const mappingByCode = new Map(mappings.map((item) => [item.productCode, item]));
    const units = [...new Set(parsed.rows.filter((row) => row.kind === 'PRODUCT').map((row) => row.sourceUnitNumber).filter(Boolean))];
    const trucks = await tx.truck.findMany({ where: { companyId: { in: context.companyIds }, unitNumber: { in: units }, status: 'ACTIVE' }, select: { id: true, unitNumber: true, companyId: true } });
    const trucksByUnit = new Map<string, typeof trucks>();
    for (const truck of trucks) trucksByUnit.set(truck.unitNumber.trim(), [...(trucksByUnit.get(truck.unitNumber.trim()) ?? []), truck]);
    const seenEvents = new Set<string>(); const seenLines = new Set<string>(); const issues: IssueInput[] = [];
    const eventIds = new Map<string, string>();
    for (const row of parsed.rows) {
      const record = await tx.financialImportRecord.create({ data: this.importRecord(statementId, row) });
      if (row.kind === 'ADJUSTMENT') {
        const mapping = mappingByCode.get(`ADJUSTMENT:${row.adjustmentType}`);
        const adjustment = await tx.pilotInvoiceAdjustment.create({ data: {
          invoiceId, importRecordId: record.id, fingerprint: row.fingerprint, sourceLineIdentity: row.sourceLineIdentity,
          type: row.adjustmentType, description: row.description, transactionDate: row.transactionDate,
          signedAmountMinor: row.signedAmountMinor ?? BigInt(0), categoryId: mapping?.categoryId,
        } });
        if (seenLines.has(row.fingerprint)) issues.push({ code: 'DUPLICATE_LINE', message: `Row ${row.sourceRowIndex} duplicates another adjustment row.`, adjustmentId: adjustment.id });
        seenLines.add(row.fingerprint);
        if (row.signedAmountMinor === null || row.signedAmountMinor === BigInt(0)) issues.push({ code: 'INVALID_AMOUNT', message: `Row ${row.sourceRowIndex} has an invalid adjustment amount.`, adjustmentId: adjustment.id });
        if (!row.transactionDate && row.rawTransactionDate) issues.push({ code: 'INVALID_DATE', message: `Row ${row.sourceRowIndex} has an invalid date.`, adjustmentId: adjustment.id });
        if (row.adjustmentType === 'OTHER') issues.push({ code: 'UNKNOWN_ADJUSTMENT', message: `Row ${row.sourceRowIndex} requires adjustment review.`, adjustmentId: adjustment.id });
        if (!mapping) issues.push({ code: 'MISSING_CATEGORY', message: `Row ${row.sourceRowIndex} requires an accounting category.`, adjustmentId: adjustment.id });
        continue;
      }
      const stableEventKey = row.eventKeyHash ?? hash([invoiceId, 'invalid-event', row.sourceRowIndex]);
      let eventId = eventIds.get(stableEventKey);
      if (!eventId) {
        const candidates = trucksByUnit.get(row.sourceUnitNumber) ?? [];
        const matchStatus = candidates.length === 1 ? 'MATCHED' : candidates.length > 1 ? 'AMBIGUOUS' : 'UNMATCHED';
        const event = await tx.pilotFuelingEvent.create({ data: {
          invoiceId, eventKeyHash: stableEventKey, ticketHash: hash([row.ticketReference]), authorizationHash: hash([row.authorizationReference]), cardLastFour: lastFour(row.cardReference),
          sourceUnitNumber: row.sourceUnitNumber, locationNumber: row.locationNumber || null, city: row.city || null, state: row.state || null,
          purchaseOrderContext: row.purchaseOrderContext || null, sourceDriverName: row.sourceDriverName, transactionDate: row.transactionDate ?? parsed.billingDate,
          odometer: row.odometer, truckId: candidates.length === 1 ? candidates[0].id : null, truckMatchStatus: matchStatus,
        } });
        eventId = event.id; eventIds.set(stableEventKey, event.id);
        if (!row.eventKeyHash) issues.push({ code: 'INVALID_STRUCTURE', message: `Row ${row.sourceRowIndex} lacks a stable ticket/authorization identity.`, eventId: event.id });
        if (seenEvents.has(stableEventKey)) issues.push({ code: 'DUPLICATE_EVENT', message: `Row ${row.sourceRowIndex} duplicates a fueling event.`, eventId: event.id });
        seenEvents.add(stableEventKey);
        if (matchStatus === 'UNMATCHED') issues.push({ code: 'UNMATCHED_TRUCK', message: `Unit ${row.sourceUnitNumber || '(blank)'} did not match a truck.`, eventId: event.id });
        if (matchStatus === 'AMBIGUOUS') issues.push({ code: 'AMBIGUOUS_TRUCK', message: `Unit ${row.sourceUnitNumber} matched more than one truck.`, eventId: event.id });
        if (!row.transactionDate) issues.push({ code: 'INVALID_DATE', message: `Row ${row.sourceRowIndex} has an invalid transaction date.`, eventId: event.id });
        if (row.outsidePeriod) issues.push({ code: 'OUTSIDE_PERIOD', message: `Row ${row.sourceRowIndex} falls outside the derived invoice period.`, eventId: event.id });
      }
      const mapping = mappingByCode.get(row.productCode);
      const line = await tx.pilotFuelProductLine.create({ data: {
        invoiceId, eventId, importRecordId: record.id, lineFingerprint: row.lineFingerprint, sourceLineIdentity: row.sourceLineIdentity,
        sourceProductCode: row.productCode, productType: mapping?.productType ?? row.productType, quantity: row.quantity ?? '0', unitPrice: row.unitPrice ?? '0',
        amountMinor: row.amountMinor ?? BigInt(0), retailAmountMinor: row.retailAmountMinor, savingsMinor: row.savingsMinor, taxMinor: row.taxMinor, discountMinor: row.discountMinor, categoryId: mapping?.categoryId,
      } });
      if (seenLines.has(row.lineFingerprint)) issues.push({ code: 'DUPLICATE_LINE', message: `Row ${row.sourceRowIndex} duplicates another product row.`, productLineId: line.id, eventId });
      seenLines.add(row.lineFingerprint);
      if (row.amountMinor === null || row.amountMinor <= BigInt(0)) issues.push({ code: 'INVALID_AMOUNT', message: `Row ${row.sourceRowIndex} has an invalid product amount.`, productLineId: line.id, eventId });
      if (row.quantity === null || new Prisma.Decimal(row.quantity).lte(0)) issues.push({ code: 'INVALID_QUANTITY', message: `Row ${row.sourceRowIndex} has an invalid quantity.`, productLineId: line.id, eventId });
      if (row.productType === 'UNKNOWN_PRODUCT') issues.push({ code: 'UNKNOWN_PRODUCT', message: `Product code ${row.productCode} requires review.`, productLineId: line.id, eventId });
      if (!mapping) issues.push({ code: 'MISSING_CATEGORY', message: `Product code ${row.productCode} requires an accounting category.`, productLineId: line.id, eventId });
    }
    if (parsed.differenceMinor !== BigInt(0)) issues.push({ code: 'AMOUNT_MISMATCH', message: `Parsed rows differ from the invoice control total by ${parsed.differenceMinor.toString()} minor units.` });
    if (issues.length) await tx.pilotImportIssue.createMany({ data: issues.map((issue) => ({ invoiceId, ...issue })) });
  }

  private importRecord(statementId: string, row: PilotParsedRow) {
    const amount = row.kind === 'PRODUCT' ? row.amountMinor : row.signedAmountMinor;
    return {
      statementId, sourceRowIndex: row.sourceRowIndex, rawDescription: row.kind === 'PRODUCT' ? `Pilot product ${row.productCode}` : row.description,
      rawDate: row.rawTransactionDate || null, rawAmount: amount?.toString() ?? null, rawReference: row.kind === 'PRODUCT' ? row.ticketReference : null,
      rawMetadata: row.rawMetadata, candidateDate: row.transactionDate, candidateAmountMinor: amount === null ? null : amount < BigInt(0) ? -amount : amount,
      candidateDirection: amount === null ? null : amount < BigInt(0) ? 'INFLOW' as const : 'OUTFLOW' as const,
      candidateDescription: row.kind === 'PRODUCT' ? `Pilot ${row.productCode}` : row.description,
      fingerprintSha256: row.kind === 'PRODUCT' ? row.lineFingerprint : row.fingerprint, status: 'NEEDS_REVIEW' as const,
    };
  }

  async listInvoices(context: FinancialAuthorization) {
    const rows = await this.database.pilotProviderInvoice.findMany({ where: { operatingGroupId: context.operatingGroupId }, orderBy: [{ billingDate: 'desc' }, { createdAt: 'desc' }], include: { _count: { select: { events: true, productLines: true, adjustments: true, issues: true } } } });
    return json(rows);
  }

  async getInvoice(invoiceId: string, context: FinancialAuthorization) {
    const invoice = await this.database.pilotProviderInvoice.findFirst({ where: { id: invoiceId, operatingGroupId: context.operatingGroupId }, include: {
      source: { select: { id: true, name: true } }, documents: { include: { statement: { select: { id: true, originalFilename: true } } } },
      events: { orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }], include: { truck: { select: { id: true, unitNumber: true, companyId: true } }, productLines: { include: { category: { select: { id: true, name: true } } } } } },
      adjustments: { include: { category: { select: { id: true, name: true } } } }, issues: { orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] },
    } });
    if (!invoice) throw new FinancialNotFoundError();
    return json(invoice);
  }

  async resolveIssue(invoiceId: string, issueId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    return this.database.$transaction(async (tx) => {
      await this.lock(tx, `pilot-invoice:${invoiceId}`);
      const issue = await tx.pilotImportIssue.findFirst({ where: { id: issueId, invoiceId, invoice: { operatingGroupId: context.operatingGroupId }, status: 'OPEN' }, include: { invoice: { select: { status: true } } } });
      if (!issue) throw new FinancialNotFoundError();
      if (issue.invoice.status === 'POSTED') throw new FinancialConflictError('Posted Pilot invoices cannot be edited.');
      const action = input.action;
      const resolution: Record<string, string> = {};
      if (action === 'MATCH_TRUCK' && issue.eventId && typeof input.truckId === 'string') {
        const truck = await tx.truck.findFirst({ where: { id: input.truckId, companyId: { in: context.companyIds }, status: 'ACTIVE' }, select: { id: true, unitNumber: true } });
        if (!truck) throw new FinancialValidationError('Truck is outside this operating group.');
        await tx.pilotFuelingEvent.update({ where: { id: issue.eventId }, data: { truckId: truck.id, truckMatchStatus: 'MANUALLY_MATCHED' } });
        await tx.pilotImportIssue.updateMany({ where: { invoiceId, eventId: issue.eventId, status: 'OPEN', code: { in: ['UNMATCHED_TRUCK', 'AMBIGUOUS_TRUCK'] } }, data: { status: 'RESOLVED', resolvedByUserId: context.userId, resolvedAt: new Date(), resolutionMetadata: { action, truckId: truck.id } } });
        resolution.truckId = truck.id;
      } else if (action === 'SET_CATEGORY' && typeof input.categoryId === 'string' && (issue.productLineId || issue.adjustmentId)) {
        const category = await tx.financialCategory.findFirst({ where: { id: input.categoryId, operatingGroupId: context.operatingGroupId, isActive: true }, select: { id: true } });
        if (!category) throw new FinancialValidationError('Category is outside this operating group.');
        if (issue.productLineId) {
          await tx.pilotFuelProductLine.update({ where: { id: issue.productLineId }, data: { categoryId: category.id } });
          await tx.pilotImportIssue.updateMany({ where: { invoiceId, productLineId: issue.productLineId, status: 'OPEN', code: { in: ['MISSING_CATEGORY', 'UNKNOWN_PRODUCT'] } }, data: { status: 'RESOLVED', resolvedByUserId: context.userId, resolvedAt: new Date(), resolutionMetadata: { action, categoryId: category.id } } });
        } else {
          await tx.pilotInvoiceAdjustment.update({ where: { id: issue.adjustmentId! }, data: { categoryId: category.id } });
          await tx.pilotImportIssue.updateMany({ where: { invoiceId, adjustmentId: issue.adjustmentId, status: 'OPEN', code: { in: ['MISSING_CATEGORY', 'UNKNOWN_ADJUSTMENT'] } }, data: { status: 'RESOLVED', resolvedByUserId: context.userId, resolvedAt: new Date(), resolutionMetadata: { action, categoryId: category.id } } });
        }
        resolution.categoryId = category.id;
      } else if (action === 'ACKNOWLEDGE' && ['OUTSIDE_PERIOD'].includes(issue.code)) {
        await tx.pilotImportIssue.update({ where: { id: issue.id }, data: { status: 'RESOLVED', resolvedByUserId: context.userId, resolvedAt: new Date(), resolutionMetadata: { action } } });
      } else throw new FinancialValidationError('This issue requires an appropriate explicit resolution.');
      const open = await tx.pilotImportIssue.count({ where: { invoiceId, status: 'OPEN' } });
      const invoice = await tx.pilotProviderInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { differenceMinor: true } });
      await tx.pilotProviderInvoice.update({ where: { id: invoiceId }, data: { status: open === 0 && invoice.differenceMinor === BigInt(0) ? 'READY_TO_POST' : 'NEEDS_REVIEW' } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, pilotProviderInvoiceId: invoiceId, action: 'PILOT_IMPORT_ISSUE_RESOLVED', metadata: { issueId, action, ...resolution } } });
      return { resolved: true, openIssueCount: open };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async postInvoice(invoiceId: string, context: FinancialAuthorization) {
    await this.database.$transaction(async (tx) => {
      await this.lock(tx, `pilot-invoice:${invoiceId}`);
      const invoice = await tx.pilotProviderInvoice.findFirst({ where: { id: invoiceId, operatingGroupId: context.operatingGroupId }, include: { source: true, issues: { where: { status: 'OPEN' } }, events: { include: { truck: true, productLines: true } }, adjustments: true } });
      if (!invoice) throw new FinancialNotFoundError();
      if (invoice.status === 'POSTED') return;
      if (invoice.differenceMinor !== BigInt(0) || invoice.issues.length || invoice.status !== 'READY_TO_POST') throw new FinancialConflictError('Resolve every Pilot import issue and reconcile the invoice total before posting.');
      let postedSignedTotal = BigInt(0);
      for (const event of invoice.events) {
        if (!event.truck || !context.companyIds.includes(event.truck.companyId)) throw new FinancialValidationError('Every fueling event must have a same-group truck match.');
        const eventTotal = event.productLines.reduce((sum, line) => sum + line.amountMinor, BigInt(0));
        if (eventTotal <= BigInt(0) || event.productLines.some((line) => !line.categoryId || line.amountMinor <= BigInt(0))) throw new FinancialValidationError('Every fuel product line must have a positive amount and category.');
        const transaction = await tx.financialTransaction.create({ data: {
          operatingGroupId: context.operatingGroupId, companyId: event.truck.companyId, sourceId: invoice.sourceId, transactionDate: event.transactionDate,
          amountMinor: eventTotal, direction: 'OUTFLOW', status: 'POSTED', reconciliationStatus: 'RECONCILED', dataStatus: 'VERIFIED', role: 'ECONOMIC',
          description: `Pilot fuel purchase · Unit ${event.truck.unitNumber}`, reference: invoice.invoiceNumber, createdByUserId: context.userId,
          fingerprintSha256: hash([invoice.id, 'event', event.id]), reviewedByUserId: context.userId, reviewedAt: new Date(),
        } });
        for (const line of event.productLines) {
          await tx.financialTransactionEvidence.create({ data: { transactionId: transaction.id, importRecordId: line.importRecordId, matchedAmountMinor: line.amountMinor, method: 'EXACT', role: 'PRIMARY', matchedByUserId: context.userId } });
          await tx.financialAllocation.create({ data: { transactionId: transaction.id, amountMinor: line.amountMinor, categoryId: line.categoryId!, companyId: event.truck.companyId, truckId: event.truck.id, pilotProductLineId: line.id } });
          await tx.financialImportRecord.update({ where: { id: line.importRecordId }, data: { status: 'MATCHED' } });
        }
        await tx.pilotFuelingEvent.update({ where: { id: event.id }, data: { transactionId: transaction.id } });
        postedSignedTotal += eventTotal;
      }
      for (const adjustment of invoice.adjustments) {
        if (!adjustment.categoryId || adjustment.signedAmountMinor === BigInt(0)) throw new FinancialValidationError('Every adjustment must have a non-zero amount and category.');
        const amount = adjustment.signedAmountMinor < BigInt(0) ? -adjustment.signedAmountMinor : adjustment.signedAmountMinor;
        const transaction = await tx.financialTransaction.create({ data: {
          operatingGroupId: context.operatingGroupId, companyId: invoice.source.companyId ?? context.activeCompanyId, sourceId: invoice.sourceId,
          transactionDate: adjustment.transactionDate ?? invoice.billingDate, amountMinor: amount, direction: adjustment.signedAmountMinor < BigInt(0) ? 'INFLOW' : 'OUTFLOW',
          status: 'POSTED', reconciliationStatus: 'RECONCILED', dataStatus: 'VERIFIED', role: 'ECONOMIC', description: `Pilot invoice adjustment · ${adjustment.description}`,
          reference: invoice.invoiceNumber, createdByUserId: context.userId, fingerprintSha256: hash([invoice.id, 'adjustment', adjustment.id]), reviewedByUserId: context.userId, reviewedAt: new Date(),
        } });
        await tx.financialTransactionEvidence.create({ data: { transactionId: transaction.id, importRecordId: adjustment.importRecordId, matchedAmountMinor: amount, method: 'EXACT', role: 'PRIMARY', matchedByUserId: context.userId } });
        await tx.financialAllocation.create({ data: { transactionId: transaction.id, amountMinor: amount, categoryId: adjustment.categoryId, companyId: invoice.source.companyId ?? context.activeCompanyId, pilotAdjustmentId: adjustment.id } });
        await tx.financialImportRecord.update({ where: { id: adjustment.importRecordId }, data: { status: 'MATCHED' } });
        await tx.pilotInvoiceAdjustment.update({ where: { id: adjustment.id }, data: { transactionId: transaction.id } });
        postedSignedTotal += adjustment.signedAmountMinor;
      }
      if (postedSignedTotal !== invoice.invoiceTotalMinor) throw new FinancialConflictError('Posting totals do not reconcile to the Pilot invoice.');
      const expectation = await tx.financialExpectation.create({ data: {
        operatingGroupId: context.operatingGroupId, companyId: invoice.source.companyId ?? context.activeCompanyId, sourceId: invoice.sourceId,
        expectedAmountMinor: invoice.invoiceTotalMinor, direction: 'OUTFLOW', description: `Pilot invoice ${invoice.invoiceNumber}`,
        expectedDateStart: invoice.billingDate, expectedDateEnd: invoice.dueDate ?? invoice.billingDate, reference: invoice.invoiceNumber, createdByUserId: context.userId,
      } });
      await tx.pilotProviderInvoice.update({ where: { id: invoice.id }, data: { status: 'POSTED', postedAt: new Date(), postedByUserId: context.userId, expectationId: expectation.id } });
      await tx.financialStatement.updateMany({ where: { pilotDocuments: { some: { invoiceId } } }, data: { importStatus: 'IMPORTED', matchedRowCount: invoice.events.reduce((sum, event) => sum + event.productLines.length, 0) + invoice.adjustments.length, unresolvedRowCount: 0 } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, pilotProviderInvoiceId: invoice.id, action: 'PILOT_INVOICE_POSTED', metadata: { transactionCount: invoice.events.length + invoice.adjustments.length, expectationId: expectation.id, invoiceTotalMinor: invoice.invoiceTotalMinor.toString() } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.getInvoice(invoiceId, context);
  }

  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS lock_result`;
  }
}

export const pilotImportService = new PilotImportService();
