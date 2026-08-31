import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';

export async function GET() {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const accounts = await prisma.bankAccount.findMany({
      where: { companyId: { in: context.companyIds } },
      select: {
        id: true,
        companyId: true,
        provider: true,
        status: true,
        institutionId: true,
        institutionName: true,
        lastSync: true,
        createdAt: true,
        updatedAt: true,
        accounts: {
          select: {
            id: true,
            name: true,
            officialName: true,
            type: true,
            subtype: true,
            mask: true,
            currentBalance: true,
            availableBalance: true,
            isActive: true,
          },
        },
        company: { select: { id: true, name: true } },
        _count: { select: { transactions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(accounts);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch accounts');
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    const context = await financialControlAuthorization.requireContext('OWNER');
    const account = await prisma.bankAccount.findFirst({
      where: { id, companyId: { in: context.companyIds } },
      select: { id: true, companyId: true, status: true },
    });
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await prisma.$transaction(async (database) => {
      await database.bankAccount.update({
        where: { id: account.id },
        data: { status: 'DISABLED', disabledAt: new Date() },
      });
      await database.financialAuditEvent.create({
        data: {
          operatingGroupId: context.operatingGroupId,
          companyId: account.companyId,
          action: 'BANK_CONNECTION_DISABLED',
          actorUserId: context.userId,
          before: { status: account.status },
          after: { status: 'DISABLED' },
          metadata: { bankAccountId: account.id },
        },
      });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to delete account');
  }
}
