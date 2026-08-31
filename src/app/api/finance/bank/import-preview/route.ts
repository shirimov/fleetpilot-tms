import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankExportPreviewService } from '@/lib/finance/bank-export-preview-service';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import { BankLedgerValidationError } from '@/lib/finance/bank-ledger-errors';

export async function POST(request: Request) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const form = await request.formData();
    const file = form.get('file');
    const companyId = String(form.get('companyId') ?? '');
    const bankAccountId = String(form.get('bankAccountId') ?? '');
    const subAccountId = String(form.get('subAccountId') ?? '');
    if (!(file instanceof File) || !companyId || !bankAccountId || !subAccountId) throw new BankLedgerValidationError('Choose a company, connection, account, and bank export file.');
    return NextResponse.json(await bankExportPreviewService.preview(context, {
      companyId,
      bankAccountId,
      subAccountId,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }), { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    return bankLedgerRouteError(error);
  }
}
