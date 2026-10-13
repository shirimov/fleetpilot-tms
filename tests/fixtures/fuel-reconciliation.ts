import { createHash, randomUUID } from 'node:crypto';
import { prisma as db } from '@/lib/prisma';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const date = (value: string) => new Date(`${value}T00:00:00Z`);

// Synthetic records only. The browser suite requires a dedicated local database.
export async function fuelWorkflowFixture() {
  const key = randomUUID();
  const company = await db.company.create({ data: { name: `Fuel workflow ${key}` } });
  const otherCompany = await db.company.create({ data: { name: `Other fuel company ${key}` } });
  const owner = await db.user.create({ data: { email: `${key}@example.test`, displayName: 'Synthetic fuel owner', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'OWNER' } } } });
  const outsider = await db.user.create({ data: { email: `other-${key}@example.test`, displayName: 'Other company owner', activeCompanyId: otherCompany.id, memberships: { create: { companyId: otherCompany.id, role: 'OWNER' } } } });
  const group = await db.operatingGroup.create({ data: { name: `Fuel workflow ${key}`, companies: { create: [{ companyId: company.id }, { companyId: otherCompany.id }] }, memberships: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: outsider.id, role: 'OWNER' }] } } });
  const source = await db.financialSource.create({ data: { operatingGroupId: group.id, companyId: company.id, name: 'Synthetic fuel evidence', type: 'FUEL_CARD', provider: 'PILOT' } });
  const truck = await db.truck.create({ data: { companyId: company.id, unitNumber: `FUEL-${key}`, unitNumberNormalized: `FUEL-${key}`.toUpperCase() } });
  await db.$transaction(async tx => {
  const companyRevision = await tx.truckCompanyHistoryRevision.create({ data: { truckId: truck.id, action: 'CONFIRM', source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic browser fixture', reason: 'Synthetic browser fixture', actorUserId: owner.id } });
  await tx.truckCompanyAffiliation.create({ data: { truckId: truck.id, companyId: company.id, effectiveFrom: date('2026-01-01'), effectiveTo: date('2027-01-01'), revisionId: companyRevision.id } });
  });
  const party = await db.financialParty.create({ data: { operatingGroupId: group.id, companyId: company.id, name: 'Synthetic contractor', type: 'OWNER_OPERATOR' } });
  await db.$transaction(async tx => {
  const revision = await tx.truckOwnerHistoryRevision.create({ data: { truckId: truck.id, operatingGroupId: group.id, actorUserId: owner.id, sourceReference: 'Synthetic ownership', reason: 'Synthetic browser fixture' } });
  await tx.truckOwnerPeriod.create({ data: { truckId: truck.id, ownerPartyId: party.id, companyId: company.id, providerRecipientId: key, effectiveFrom: date('2026-01-01'), revisionId: revision.id } });
  });
  await db.fuelDeductionPolicy.create({ data: { operatingGroupId: group.id, companyId: company.id, truckId: truck.id, providerRecipientId: key, responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: date('2026-01-01'), sourceReference: 'Synthetic agreement', reason: 'Synthetic browser fixture', approvedByUserId: owner.id } });
  const document = await db.financialStatement.create({ data: { operatingGroupId: group.id, sourceId: source.id, type: 'FUEL_STATEMENT', periodStart: date('2026-06-01'), periodEnd: date('2026-06-30'), originalFilename: 'synthetic.csv', displayFilename: 'synthetic.csv', mimeType: 'text/csv', byteSize: 1, storageKey: `synthetic/${key}.csv`, checksumSha256: hash(key), importedByUserId: owner.id } });
  const record = await db.financialImportRecord.create({ data: { statementId: document.id, sourceRowIndex: 1, rawAmount: '100.00', fingerprintSha256: hash(`record-${key}`) } });
  const invoice = await db.pilotProviderInvoice.create({ data: { operatingGroupId: group.id, sourceId: source.id, sourceFormat: 'LEGACY_XLS', providerAccountHash: hash(key), invoiceNumber: key, billingDate: date('2026-06-10'), periodStart: date('2026-06-01'), periodEnd: date('2026-06-30'), invoiceTotalMinor: BigInt(10000), parsedTotalMinor: BigInt(10000), differenceMinor: BigInt(0), status: 'POSTED', parseVersion: 'synthetic', uploadedByUserId: owner.id, postedByUserId: owner.id, postedAt: new Date() } });
  const event = await db.pilotFuelingEvent.create({ data: { invoiceId: invoice.id, eventKeyHash: hash(key), ticketHash: hash(`ticket-${key}`), authorizationHash: hash(`auth-${key}`), cardLastFour: '1234', sourceUnitNumber: truck.unitNumber, locationNumber: '100', city: 'Synthetic City', state: 'CA', transactionDate: date('2026-06-10'), truckId: truck.id, truckMatchStatus: 'MATCHED' } });
  await db.pilotFuelProductLine.create({ data: { invoiceId: invoice.id, eventId: event.id, importRecordId: record.id, lineFingerprint: hash(`line-${key}`), sourceLineIdentity: key, sourceProductCode: '020', productType: 'TRUCK_DIESEL', quantity: '20.00', unitPrice: '5', amountMinor: BigInt(10000), retailAmountMinor: BigInt(10000), savingsMinor: BigInt(0) } });
  await db.archiveScopeGrant.create({ data: { operatingGroupId: group.id, companyId: company.id, grantedByUserId: owner.id, reason: 'Synthetic browser fixture' } });
  const archiveCompany = await db.archiveCompany.create({ data: { operatingGroupId: group.id, companyId: company.id, sourceId: source.id, accountKey: key, providerCompanyId: key, providerCompanyName: company.name } });
  const statement = await db.archiveStatement.create({ data: { archiveCompanyId: archiveCompany.id, providerStatementId: key, latestProviderVersion: 1, acceptedProviderVersion: 1 } });
  const { version, line } = await db.$transaction(async tx => {
  const version = await tx.archiveVersion.create({ data: { statementId: statement.id, providerVersion: 1, documentId: document.id, detailStorageKey: `synthetic/${key}.json`, detailChecksum: hash(`detail-${key}`), pdfChecksum: hash(key), bundleChecksum: hash(`bundle-${key}`), pid: key, recipientId: key, recipientName: 'Synthetic contractor', recipientType: 'CONTRACTOR', workStart: date('2026-06-07'), workEnd: date('2026-06-13'), header: {}, issues: [], parserVersion: 'synthetic', capturedByUserId: owner.id } });
  await tx.archiveTruck.create({ data: { versionId: version.id, sourceKey: key, unit: truck.unitNumber, truckId: truck.id, mappingStatus: 'MATCHED' } });
  // Conflicting card prevents an automatic match even though the amounts agree.
  const line = await tx.archiveLine.create({ data: { versionId: version.id, kind: 'DEDUCTION', sourceArray: 'fuel_transactions', sourceOrder: 0, providerLineId: key, description: 'Synthetic unresolved fuel deduction', sourceType: 'fuel', amountMinor: -BigInt(10000), rawAmount: '100.00', sourceDate: '2026-06-10', sourceUnit: truck.unitNumber, included: true, metadata: { type: 'fuel', date: '2026-06-10T12:00:00Z', diesel_amount: '100.00', diesel_qty: '20.00', def_amount: '0', reefer_amount: '0', reefer_qty: '0', pay_amount: '100.00', card_number: '9999', merchant: '100', city: 'Synthetic City', state: 'CA' } } });
  await tx.archiveVersion.update({ where: { id: version.id }, data: { sealed: true } });
    return { version, line };
  });
  // Nonempty ledger baseline catches accidental expense/recovery mutations.
  await db.financialTransaction.create({ data: { operatingGroupId: group.id, companyId: company.id, transactionDate: date('2026-06-10'), amountMinor: BigInt(10000), currency: 'USD', direction: 'OUTFLOW', description: 'Synthetic already posted fuel', status: 'POSTED', reconciliationStatus: 'UNMATCHED', dataStatus: 'VERIFIED', role: 'ECONOMIC', createdByUserId: owner.id } });
  return { company, otherCompany, owner, outsider, group, source, truck, event, line, version };
}

export async function fuelEconomics(groupId: string) {
  return {
    transactions: await db.financialTransaction.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
    allocations: await db.financialAllocation.findMany({ where: { transaction: { operatingGroupId: groupId } } }),
    expectations: await db.financialExpectation.findMany({ where: { operatingGroupId: groupId } }),
    bankMatches: await db.financialExpectationBankMatch.findMany({ where: { operatingGroupId: groupId } }),
  };
}
