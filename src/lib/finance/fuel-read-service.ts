import { prisma } from '@/lib/prisma';
import type { PrismaClient } from '@prisma/client';
import type { FinancialAuthorization } from './financial-control-authorization';
import { pageNumber } from './accounting-read-model';

export class FuelReadService {
  constructor(private readonly database: PrismaClient = prisma) {}
  async overview(context: FinancialAuthorization, requestedPage: unknown = 1) {
    const invoices = await this.database.pilotProviderInvoice.findMany({
      where: { operatingGroupId: context.operatingGroupId, status: 'POSTED' },
      select: { id: true, invoiceTotalMinor: true, expectation: { select: { status: true } },
        adjustments: { select: { signedAmountMinor: true } },
        events: { select: { id: true, truckId: true, truck: { select: { id: true, unitNumber: true, status: true, companyId: true, company: { select: { name: true } } } }, productLines: { select: { productType: true, amountMinor: true, quantity: true } } } },
      },
    });
    const products: Record<string, { amountMinor: bigint; quantity: number }> = {};
    const trucks = new Map<string, { id: string; unitNumber: string; company: string; status: string; events: number; amountMinor: bigint; products: typeof products }>();
    let events = 0, adjustments = BigInt(0);
    for (const invoice of invoices) {
      for (const adjustment of invoice.adjustments) adjustments += adjustment.signedAmountMinor;
      for (const event of invoice.events) {
        events++;
        const truck = event.truck;
        if (truck && context.companyIds.includes(truck.companyId) && !trucks.has(truck.id)) trucks.set(truck.id, { id: truck.id, unitNumber: truck.unitNumber, company: truck.company.name, status: truck.status, events: 0, amountMinor: BigInt(0), products: {} });
        const row = truck ? trucks.get(truck.id) : undefined;
        if (row) row.events++;
        for (const line of event.productLines) {
          const product = products[line.productType] ??= { amountMinor: BigInt(0), quantity: 0 };
          product.amountMinor += line.amountMinor;
          product.quantity += Number(line.quantity);
          if (row) {
            row.amountMinor += line.amountMinor;
            const part = row.products[line.productType] ??= { amountMinor: BigInt(0), quantity: 0 };
            part.amountMinor += line.amountMinor;
            part.quantity += Number(line.quantity);
          }
        }
      }
    }
    const rows = [...trucks.values()].sort((a, b) => a.company.localeCompare(b.company) || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
    const page = Math.min(pageNumber(requestedPage), Math.max(1, Math.ceil(rows.length / 25)));
    const serializeProducts = (items: typeof products) => Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { amountMinor: value.amountMinor.toString(), quantity: value.quantity.toFixed(2) }]));
    return { invoices: invoices.length, settled: invoices.filter(row => row.expectation?.status === 'MATCHED').length, events, trucks: rows.length, netExpenseMinor: invoices.reduce((sum, row) => sum + row.invoiceTotalMinor, BigInt(0)).toString(), adjustmentsMinor: adjustments.toString(), products: serializeProducts(products),
      byTruck: { rows: rows.slice((page - 1) * 25, page * 25).map(row => ({ ...row, amountMinor: row.amountMinor.toString(), products: serializeProducts(row.products) })), total: rows.length, page, pageSize: 25 },
    };
  }
}
export const fuelReadService = new FuelReadService();
