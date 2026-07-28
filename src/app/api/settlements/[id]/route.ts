import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { financialAuthorizationService } from '@/lib/finance/financial-authorization';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await financialAuthorizationService.requireSettlement(
      id,
      'ADMIN',
    );
    const body = await req.json();
    const current = await prisma.settlement.findFirst({
      where: { id, truck: { companyId: context.companyId } },
    });
    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const data: Prisma.SettlementUpdateInput = {};
    if (body.isPaid !== undefined) {
      data.isPaid = body.isPaid;
      data.paidAt = body.isPaid ? new Date() : null;
    }
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.fuelDeduction !== undefined) {
      data.fuelDeduction = parseFloat(body.fuelDeduction);
    }
    if (body.otherDeductions !== undefined) {
      data.otherDeductions = parseFloat(body.otherDeductions);
    }
    if (
      body.fuelDeduction !== undefined ||
      body.otherDeductions !== undefined
    ) {
      const fuel =
        typeof data.fuelDeduction === 'number'
          ? data.fuelDeduction
          : current.fuelDeduction;
      const other =
        typeof data.otherDeductions === 'number'
          ? data.otherDeductions
          : current.otherDeductions;
      data.netPay = current.driverPay - fuel - other;
    }

    const settlement = await prisma.settlement.update({
      where: { id, truck: { companyId: context.companyId } },
      data,
      include: { truck: true, driver: true, load: true },
    });
    return NextResponse.json(settlement);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to update settlement');
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await financialAuthorizationService.requireSettlement(
      id,
      'ADMIN',
    );
    const result = await prisma.settlement.deleteMany({
      where: { id, truck: { companyId: context.companyId } },
    });
    if (!result.count) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to delete settlement');
  }
}
