import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { FinancialValidationError } from '@/lib/finance/financial-control-errors';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { financialStatementStorage, validateFinancialStatement } from '@/lib/finance/financial-statement-storage';
import { pilotImportService } from '@/lib/finance/pilot-import-service';

export async function GET() {
  try { return NextResponse.json(await pilotImportService.listInvoices(await financialControlAuthorization.requireContext())); }
  catch (error) { return financialRouteError(error); }
}

export async function POST(request: Request) {
  let storageKey: string | null = null;
  try {
    const context = await financialControlAuthorization.requireContext();
    const form = await request.formData();
    const file = form.get('file');
    const sourceId = form.get('sourceId');
    if (!(file instanceof File) || typeof sourceId !== 'string' || !sourceId) throw new FinancialValidationError('Pilot XLS file and fuel-card source are required.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = validateFinancialStatement(file, bytes);
    if (metadata.extension !== '.xls') throw new FinancialValidationError('Pilot V1 requires a legacy .xls statement.');
    storageKey = await financialStatementStorage.put(bytes);
    const documentMetadata = { originalFilename: metadata.originalFilename, displayFilename: metadata.displayFilename, mimeType: metadata.mimeType, byteSize: metadata.byteSize, checksumSha256: metadata.checksumSha256 };
    const invoice = await pilotImportService.createImport(bytes, { ...documentMetadata, storageKey }, sourceId, context);
    storageKey = null;
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (storageKey) await financialStatementStorage.delete(storageKey).catch(() => undefined);
    return financialRouteError(error);
  }
}
