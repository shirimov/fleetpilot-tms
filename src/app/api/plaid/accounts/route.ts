import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizationService } from '@/lib/auth/authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { financialAuthorizationService } from '@/lib/finance/financial-authorization';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const accounts = await prisma.bankAccount.findMany({
      where: { companyId: context.companyId },
      select: {
        id: true,
        companyId: true,
        plaidItemId: true,
        institutionId: true,
        institutionName: true,
        lastSync: true,
        createdAt: true,
        updatedAt: true,
        accounts: true,
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
    const context = await financialAuthorizationService.requireBankAccount(id);
    await prisma.$transaction([
      prisma.bankTransaction.deleteMany({ where: { bankAccountId: id } }),
      prisma.bankSubAccount.deleteMany({ where: { bankAccountId: id } }),
      prisma.bankAccount.delete({
        where: { id, companyId: context.companyId },
      }),
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to delete account');
  }
}
