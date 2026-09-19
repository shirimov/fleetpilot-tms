import { archiveDocumentScope } from '@/lib/finance/archive-service';
import { hash } from '@/lib/finance/archive-normalize';
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
    const statement = await prisma.financialStatement.findFirst({ where: { id: (await params).id, ...archiveDocumentScope(context) }, select: { storageKey: true, originalFilename: true, mimeType: true, checksumSha256: true, archiveVersions: { select: { id: true }, take: 1 }, archiveConflicts: { select: { id: true }, take: 1 } } });
    if (!statement) throw new FinancialNotFoundError();
    const bytes = await financialStatementStorage.get(statement.storageKey);
    if ((statement.archiveVersions.length || statement.archiveConflicts.length) && hash(bytes) !== statement.checksumSha256) throw new Error('Archive integrity check failed');
    return new NextResponse(bytes as BodyInit, { headers: { ...privateDownloadHeaders(statement.originalFilename, statement.mimeType), 'Content-Length': String(bytes.byteLength) } });
  } catch (error) { return financialRouteError(error); }
}
