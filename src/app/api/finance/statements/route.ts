import { NextResponse } from 'next/server';
import type { FinancialStatementType } from '@prisma/client';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService, financialDate } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { FinancialValidationError } from '@/lib/finance/financial-control-errors';
import { financialStatementStorage, validateFinancialStatement } from '@/lib/finance/financial-statement-storage';
import { genericCsvImporter } from '@/lib/finance/financial-importers';
import { normalizeCurrency } from '@/lib/finance/money';

const types = new Set<FinancialStatementType>(['BANK_STATEMENT', 'CREDIT_CARD_STATEMENT', 'FUEL_STATEMENT', 'TOLL_STATEMENT', 'TMS_SETTLEMENT', 'CUSTOMER_SETTLEMENT', 'OWNER_SETTLEMENT', 'REPAIR_INVOICE', 'INSURANCE_STATEMENT', 'OTHER']);

export async function GET() {
  try { return NextResponse.json(await financialControlService.listStatements(await financialControlAuthorization.requireContext())); }
  catch (error) { return financialRouteError(error); }
}
export async function POST(request: Request) {
  let storedKey: string | null = null;
  try {
    const context = await financialControlAuthorization.requireContext();
    const form = await request.formData();
    const file = form.get('file');
    const sourceId = form.get('sourceId');
    const type = form.get('type');
    const periodStart = form.get('periodStart');
    const periodEnd = form.get('periodEnd');
    if (!(file instanceof File) || typeof sourceId !== 'string' || typeof type !== 'string' || !types.has(type as FinancialStatementType) || typeof periodStart !== 'string' || typeof periodEnd !== 'string') throw new FinancialValidationError('Statement file, source, type, and period are required.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = validateFinancialStatement(file, bytes);
    storedKey = await financialStatementStorage.put(bytes);
    const { extension, ...documentMetadata } = metadata;
    const statement = await financialControlService.registerStatement({ sourceId, type: type as FinancialStatementType, periodStart: financialDate(periodStart, 'Statement period start'), periodEnd: financialDate(periodEnd, 'Statement period end'), ...documentMetadata, storageKey: storedKey, currency: normalizeCurrency(form.get('currency') ?? 'USD') }, context);
    storedKey = null;
    const imported = extension === '.csv' ? await financialControlService.importRawRecords(statement.id, genericCsvImporter.parse(bytes), context) : null;
    return NextResponse.json({ statementId: statement.id, imported }, { status: 201 });
  } catch (error) {
    if (storedKey) await financialStatementStorage.delete(storedKey).catch(() => undefined);
    return financialRouteError(error);
  }
}
