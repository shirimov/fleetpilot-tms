import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { privateDownloadHeaders } from '@/lib/storage/private-file-storage';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialStatementStorage } from '@/lib/finance/financial-statement-storage';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { FinancialNotFoundError } from '@/lib/finance/financial-control-errors';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const context = await financialControlAuthorization.requireContext();
    const statement = await prisma.financialStatement.findFirst({ where: { id: (await params).id, operatingGroupId: context.operatingGroupId }, select: { storageKey: true, originalFilename: true, mimeType: true } });
    if (!statement) throw new FinancialNotFoundError();
    const bytes = await financialStatementStorage.get(statement.storageKey);
    return new NextResponse(bytes as BodyInit, { headers: { ...privateDownloadHeaders(statement.originalFilename, statement.mimeType), 'Content-Length': String(bytes.byteLength) } });
  } catch (error) { return financialRouteError(error); }
}
