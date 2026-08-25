import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';
import { pilotXlsFixture } from '../fixtures/pilot-xls';

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({ data: { userId, email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

test('OWNER reviews and posts a synthetic Pilot XLS without invoice-level double counting', async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({ data: { name: `Pilot UI ${suffix}` } });
  const owner = await prisma.user.create({ data: { email: `pilot-ui-${suffix}@example.test`, displayName: 'Pilot Owner', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'OWNER' } } } });
  const group = await prisma.operatingGroup.create({ data: { name: `Pilot UI Group ${suffix}`, companies: { create: { companyId: company.id } }, memberships: { create: { userId: owner.id, role: 'OWNER' } }, categories: { create: [{ name: 'Fuel', type: 'DIRECT_EXPENSE' }] } } });
  const category = await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: group.id, name: 'Fuel' } });
  const source = await prisma.financialSource.create({ data: { operatingGroupId: group.id, companyId: company.id, name: `Pilot EFS ${suffix}`, type: 'FUEL_CARD', provider: 'Pilot' } });
  await prisma.pilotProductMapping.create({ data: { operatingGroupId: group.id, providerAccountHash: createHash('sha256').update('123456789').digest('hex'), productCode: '020', productType: 'TRUCK_DIESEL', categoryId: category.id, approvedByUserId: owner.id } });
  await prisma.truck.create({ data: { companyId: company.id, unitNumber: '125' } });
  try {
    await page.goto(`/login/email/verify#token=${await issueToken(owner.id, owner.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.goto('/accounting');
    await page.getByRole('button', { name: 'Pilot Fuel Imports' }).click();
    await page.getByLabel('Pilot fuel-card source').selectOption(source.id);
    await page.getByLabel('Pilot XLS file').setInputFiles({ name: 'pilot-920001.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(pilotXlsFixture({ invoiceNumber: '920001' })) });
    await page.getByRole('button', { name: 'Parse statement' }).click();
    await expect(page.getByRole('heading', { name: '920001' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Invoice 920001 .* READY_TO_POST/ })).toBeVisible();
    await expect(page.getByText('No issues in this view.')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Post reconciled invoice' }).click();
    await expect(page.getByRole('button', { name: /Invoice 920001 .* POSTED/ })).toBeVisible();
    const invoice = await prisma.pilotProviderInvoice.findFirstOrThrow({ where: { operatingGroupId: group.id, invoiceNumber: '920001' }, include: { events: { include: { transaction: { include: { allocations: true, evidence: true } } } }, expectation: true } });
    expect(invoice.expectation?.expectedAmountMinor).toBe(BigInt(10100));
    expect(invoice.events).toHaveLength(1);
    expect(invoice.events[0].transaction?.amountMinor).toBe(BigInt(10100));
    expect(invoice.events[0].transaction?.role).toBe('ECONOMIC');
    expect(invoice.events[0].transaction?.allocations).toHaveLength(1);
    expect(invoice.events[0].transaction?.evidence).toHaveLength(1);
    expect(await prisma.financialTransaction.count({ where: { operatingGroupId: group.id, reference: '920001' } })).toBe(1);
  } finally {
    await prisma.financialAllocation.deleteMany({ where: { transaction: { operatingGroupId: group.id } } });
    await prisma.financialTransactionEvidence.deleteMany({ where: { transaction: { operatingGroupId: group.id } } });
    await prisma.pilotImportIssue.deleteMany({ where: { invoice: { operatingGroupId: group.id } } });
    await prisma.pilotFuelProductLine.deleteMany({ where: { invoice: { operatingGroupId: group.id } } });
    await prisma.pilotInvoiceAdjustment.deleteMany({ where: { invoice: { operatingGroupId: group.id } } });
    await prisma.pilotFuelingEvent.deleteMany({ where: { invoice: { operatingGroupId: group.id } } });
    await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialTransaction.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.pilotInvoiceDocument.deleteMany({ where: { invoice: { operatingGroupId: group.id } } });
    await prisma.pilotProviderInvoice.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialExpectation.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialImportRecord.deleteMany({ where: { statement: { operatingGroupId: group.id } } });
    await prisma.financialStatement.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.pilotProductMapping.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialSource.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialCategory.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroup.delete({ where: { id: group.id } });
    await prisma.truck.deleteMany({ where: { companyId: company.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
