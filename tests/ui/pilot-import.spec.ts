import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';
import { pilotXlsFixture } from '../fixtures/pilot-xls';

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({ data: { userId, email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

test('OWNER matches and reviews Pilot trucks across authorized companies without changing active company', async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({ data: { name: `Pilot UI ${suffix}` } });
  const relatedCompany = await prisma.company.create({ data: { name: `Pilot UI Related ${suffix}` } });
  const unauthorizedCompany = await prisma.company.create({ data: { name: `Pilot UI Unauthorized ${suffix}` } });
  const owner = await prisma.user.create({ data: { email: `pilot-ui-${suffix}@example.test`, displayName: 'Pilot Owner', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'OWNER' } } } });
  const group = await prisma.operatingGroup.create({ data: { name: `Pilot UI Group ${suffix}`, companies: { create: { companyId: company.id } }, memberships: { create: { userId: owner.id, role: 'OWNER' } }, categories: { create: [{ name: 'Fuel', type: 'DIRECT_EXPENSE' }] } } });
  const category = await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: group.id, name: 'Fuel' } });
  const source = await prisma.financialSource.create({ data: { operatingGroupId: group.id, companyId: company.id, name: `Pilot EFS ${suffix}`, type: 'FUEL_CARD', provider: 'Pilot' } });
  await prisma.$transaction([
    prisma.companyMembership.create({ data: { companyId: relatedCompany.id, userId: owner.id, role: 'OWNER' } }),
    prisma.operatingGroupCompany.create({ data: { operatingGroupId: group.id, companyId: relatedCompany.id } }),
    prisma.operatingGroupCompany.create({ data: { operatingGroupId: group.id, companyId: unauthorizedCompany.id } }),
  ]);
  await prisma.truck.createMany({ data: [
    { companyId: company.id, unitNumber: '125', unitNumberNormalized: '125' },
    { companyId: relatedCompany.id, unitNumber: '777', unitNumberNormalized: '777' },
    { companyId: company.id, unitNumber: '888', unitNumberNormalized: '888' },
    { companyId: relatedCompany.id, unitNumber: '888', unitNumberNormalized: '888' },
    { companyId: unauthorizedCompany.id, unitNumber: '999', unitNumberNormalized: '999' },
  ] });
  try {
    await page.goto(`/login/email/verify#token=${await issueToken(owner.id, owner.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.goto('/accounting');
    await page.getByRole('button', { name: 'Pilot Fuel Imports' }).click();
    await expect(page.getByRole('heading', { name: 'Pilot Product Mappings' })).toBeVisible();
    await expect(page.getByLabel('Pilot product 020 category')).toBeVisible();
    await expect(page.getByLabel('Pilot product 033 category')).toBeVisible();
    await expect(page.getByLabel('Pilot product 140 category')).toBeVisible();
    await expect(page.getByText('Not mapped')).toHaveCount(3);
    await page.getByLabel('Pilot fuel-card source').selectOption(source.id);
    await page.getByLabel('Pilot XLS file').setInputFiles({ name: 'pilot-920001.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(pilotXlsFixture({
      invoiceNumber: '920001', total: 151,
      rowsBeforeTotal: [['1111222233334444', '777', '0099', 'Austin                  TX', 'TICKET-2', 'AUTH-2', 'Driver Two', '08/19', 123457, '020', 5, 10, 50, 0, 0, 0, 0, 0, 50, 50]],
    })) });
    await page.getByRole('button', { name: 'Parse statement' }).click();
    await expect(page.getByRole('heading', { name: '920001' })).toBeVisible();
    await expect(page.getByText(`125 — Pilot UI ${suffix}`)).toBeVisible();
    await expect(page.getByText(`777 — Pilot UI Related ${suffix}`)).toBeVisible();
    await expect(page.getByText('MISSING CATEGORY').first()).toBeVisible();
    await expect(page.getByText('Invoice total').locator('..')).toContainText('$151.00');
    await expect(page.getByText('Difference').locator('..')).toContainText('$0.00');
    await page.getByLabel('Pilot product 020 category').selectOption(category.id);
    await expect(page.getByText('Mapped to Fuel')).toBeVisible();
    expect(await prisma.pilotProductMapping.count({ where: { operatingGroupId: group.id, providerAccountHash: '*', productCode: '020' } })).toBe(1);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Apply product mappings' }).click();
    await expect(page.getByText('No issues in this view.')).toBeVisible();
    await expect(page.getByText('Invoice total').locator('..')).toContainText('$151.00');
    await expect(page.getByText('Difference').locator('..')).toContainText('$0.00');
    const imported = await prisma.pilotProviderInvoice.findFirstOrThrow({ where: { operatingGroupId: group.id, invoiceNumber: '920001' } });
    await prisma.$transaction([
      prisma.pilotProviderInvoice.update({ where: { id: imported.id }, data: { parseVersion: 'pilot-biff-v1', status: 'NEEDS_REVIEW', parsedTotalMinor: BigInt(1010000), differenceMinor: BigInt(999900) } }),
      prisma.pilotImportIssue.create({ data: { invoiceId: imported.id, code: 'AMOUNT_MISMATCH', message: 'Synthetic v1 mismatch.' } }),
      prisma.financialAuditEvent.updateMany({ where: { pilotProviderInvoiceId: imported.id, action: 'PILOT_INVOICE_PARSED' }, data: { metadata: { parseVersion: 'pilot-biff-v1' } } }),
    ]);
    await page.reload();
    await page.getByRole('button', { name: 'Pilot Fuel Imports' }).click();
    await page.getByRole('button', { name: /Invoice 920001 .* NEEDS_REVIEW/ }).click();
    await expect(page.getByRole('button', { name: 'Reparse invoice' })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Reparse invoice' }).click();
    await expect(page.getByText('Parser pilot-biff-v2')).toBeVisible();
    await expect(page.getByRole('button', { name: /Invoice 920001 .* READY_TO_POST/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reparse invoice' })).toHaveCount(0);
    await expect(page.getByText('No issues in this view.')).toBeVisible();
    expect(await prisma.financialTransaction.count({ where: { operatingGroupId: group.id, reference: '920001' } })).toBe(0);
    expect(await prisma.financialExpectation.count({ where: { operatingGroupId: group.id, reference: '920001' } })).toBe(0);
    expect(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: imported.id, action: 'PILOT_INVOICE_REPARSED' } })).toBe(1);

    await page.getByLabel('Pilot fuel-card source').selectOption(source.id);
    await page.getByLabel('Pilot XLS file').setInputFiles({ name: 'pilot-920002.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(pilotXlsFixture({ invoiceNumber: '920002', unitNumber: '888' })) });
    await page.getByRole('button', { name: 'Parse statement' }).click();
    await expect(page.getByRole('heading', { name: '920002' })).toBeVisible();
    const truckSelect = page.getByLabel('Resolve AMBIGUOUS_TRUCK');
    await expect(truckSelect).toContainText(`Truck 888 — Pilot UI ${suffix}`);
    await expect(truckSelect).toContainText(`Truck 888 — Pilot UI Related ${suffix}`);
    await expect(truckSelect).not.toContainText(`Pilot UI Unauthorized ${suffix}`);
    await page.getByLabel('Search trucks for AMBIGUOUS_TRUCK').fill('Related');
    await expect(truckSelect).toContainText(`Truck 888 — Pilot UI Related ${suffix}`);
    await expect(truckSelect).not.toContainText(`Truck 888 — Pilot UI ${suffix}`);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).activeCompanyId).toBe(company.id);
    expect(await prisma.financialTransaction.count({ where: { operatingGroupId: group.id } })).toBe(0);
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
    await prisma.truck.deleteMany({ where: { companyId: { in: [company.id, relatedCompany.id, unauthorizedCompany.id] } } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.company.deleteMany({ where: { id: { in: [company.id, relatedCompany.id, unauthorizedCompany.id] } } });
  }
});
