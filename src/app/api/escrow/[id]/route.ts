import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { workforceAuthorizationService } from '@/lib/workforce/workforce-authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await workforceAuthorizationService.requireEscrow(id);
    const data = await request.json();
    const amount = parseFloat(data.amount);
    const delta = data.type === 'DEPOSIT' ? amount : -amount;

    const transaction = await prisma.$transaction(async (database) => {
      const escrow = await database.employeeEscrow.findUnique({
        where: { id },
      });
      if (!escrow) return null;
      const escrowTransaction = await database.escrowTx.create({
        data: {
          escrowId: id,
          amount,
          type: data.type,
          description: data.description,
          date: data.date ? new Date(data.date) : new Date(),
        },
      });
      await database.employeeEscrow.update({
        where: { id },
        data: { balance: escrow.balance + delta },
      });
      return escrowTransaction;
    });
    if (!transaction) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(transaction);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to update escrow');
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await workforceAuthorizationService.requireEscrow(id);
    const escrow = await prisma.employeeEscrow.findUnique({
      where: { id },
      include: { transactions: { orderBy: { createdAt: 'desc' } } },
    });
    return NextResponse.json(escrow);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch escrow');
  }
}
