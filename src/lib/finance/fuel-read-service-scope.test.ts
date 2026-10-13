import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { FuelReadService } from './fuel-read-service';
import type { FinancialAuthorization } from './financial-control-authorization';

// Synthetic repository fixtures, not PostgreSQL or business-record acceptance.
const context = (companyIds: string[], role: 'ADMIN' | 'OWNER' = 'ADMIN'): FinancialAuthorization => ({
  userId: 'synthetic-viewer', activeCompanyId: 'synthetic-company-a',
  operatingGroupId: 'synthetic-group', companyIds, role,
});
const product = { productType: 'TRUCK_DIESEL', amountMinor: BigInt(10000), quantity: '20.00' };
const event = (id: string, companyId: string | null) => ({
  id, truckId: companyId ? `${id}-truck` : null,
  truck: companyId ? { id: `${id}-truck`, unitNumber: id, companyId, company: { name: companyId }, status: 'ACTIVE' } : null,
  productLines: [product],
});
const invoices = [
  { id: 'synthetic-b-only', invoiceTotalMinor: BigInt(9900), expectation: { status: 'MATCHED' }, adjustments: [{ signedAmountMinor: BigInt(-100) }], events: [event('b', 'synthetic-company-b')] },
  { id: 'synthetic-mixed', invoiceTotalMinor: BigInt(30000), expectation: null, adjustments: [], events: [event('a', 'synthetic-company-a'), event('b2', 'synthetic-company-b'), event('unmapped', null)] },
];
function repository(companies = ['synthetic-company-a', 'synthetic-company-b']) {
  const reads: unknown[] = [];
  const database = {
    operatingGroupCompany: { findMany: async (args: unknown) => {
      assert.deepEqual(args, { where: { operatingGroupId: 'synthetic-group' }, select: { companyId: true } });
      return companies.map(companyId => ({ companyId }));
    } },
    pilotProviderInvoice: { findMany: async (args: unknown) => { reads.push(args); return invoices; } },
  };
  return { service: new FuelReadService(database as unknown as PrismaClient), reads };
}

test('Fuel overview rejects partial Company scope before reading group-wide totals', async () => {
  const { service, reads } = repository();
  await assert.rejects(() => service.overview(context(['synthetic-company-a'])), AuthorizationDeniedError);
  assert.equal(reads.length, 0, 'Unauthorized totals must not be fetched.');
});

test('Group OWNER role does not bypass missing Company authorization', async () => {
  const { service, reads } = repository();
  await assert.rejects(() => service.overview(context(['synthetic-company-a'], 'OWNER')), AuthorizationDeniedError);
  assert.equal(reads.length, 0);
});

test('Full Company scope preserves complete invoice economics including unmapped evidence', async () => {
  const { service, reads } = repository();
  const before = structuredClone(invoices);
  const result = await service.overview(context(['synthetic-company-b', 'synthetic-company-a']));
  assert.equal(result.invoices, 2);
  assert.equal(result.settled, 1);
  assert.equal(result.events, 4);
  assert.equal(result.netExpenseMinor, '39900');
  assert.equal(result.adjustmentsMinor, '-100');
  assert.deepEqual(result.products.TRUCK_DIESEL, { amountMinor: '40000', quantity: '80.00' });
  assert.equal(result.trucks, 3);
  assert.deepEqual(result.byTruck.rows.map(row => row.id), ['a-truck', 'b-truck', 'b2-truck']);
  assert.deepEqual(result.byTruck.rows.map(row => row.amountMinor), ['10000', '10000', '10000']);
  assert.equal(reads.length, 1);
  assert.deepEqual(invoices, before, 'Read view must not mutate source evidence.');
});

test('An empty authorized Company set cannot read group totals', async () => {
  const { service, reads } = repository();
  await assert.rejects(() => service.overview(context([])), AuthorizationDeniedError);
  assert.equal(reads.length, 0);
});

test('An operating group without Company links fails closed', async () => {
  const { service, reads } = repository([]);
  await assert.rejects(() => service.overview(context(['synthetic-company-a', 'synthetic-company-b'])), AuthorizationDeniedError);
  assert.equal(reads.length, 0);
});
