import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PilotImportService } from './pilot-import-service';
import type { FinancialAuthorization } from './financial-control-authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';

// Synthetic repositories only: no database, network, business records or authentication bypass.
const companyA = 'synthetic-company-a';
const companyB = 'synthetic-company-b';
const context: FinancialAuthorization = {
  userId: 'synthetic-user', role: 'OWNER', activeCompanyId: companyA,
  operatingGroupId: 'synthetic-group', companyIds: [companyA],
};
const invoice = {
  id: 'synthetic-invoice', operatingGroupId: context.operatingGroupId,
  status: 'NEEDS_REVIEW', sourceFormat: 'LEGACY_XLS', parseVersion: 'synthetic-old',
  invoiceTotalMinor: BigInt(25000), documents: [], issues: [],
  adjustments: [{ id: 'synthetic-credit', signedAmountMinor: BigInt(-100) }],
  events: [{ id: 'synthetic-event', truckId: 'synthetic-truck-b',
    truck: { id: 'synthetic-truck-b', companyId: companyB },
    productLines: [{ amountMinor: BigInt(25100) }],
  }],
};
function fixture() {
  const reads: unknown[] = [];
  const database = {
    companyMembership: { findMany: (async () => [{ companyId: companyA }, { companyId: companyB }]) as (...args: Parameters<PrismaClient['companyMembership']['findMany']>) => Promise<{ companyId: string }[]> },
    operatingGroupCompany: { findMany: async () => [{ companyId: companyA }, { companyId: companyB }] },
    $transaction: async () => { throw new Error('Unauthorized operation reached a transaction'); },
    pilotProviderInvoice: {
      findMany: async (args: unknown) => { reads.push(args); return [invoice]; },
      findFirst: async (args: unknown) => { reads.push(args); return invoice; },
    },
  };
  return { reads, database, service: new PilotImportService(database as unknown as PrismaClient) };
}

const metadata = { originalFilename: 'synthetic.xls', displayFilename: 'synthetic.xls', mimeType: 'application/vnd.ms-excel', byteSize: 0, storageKey: 'synthetic-key', checksumSha256: '0'.repeat(64) };
const deniedOperations: Array<[string, (service: PilotImportService) => Promise<unknown>]> = [
  ['detail', (service) => service.getInvoice(invoice.id, context)],
  ['create before parsing or persistence', (service) => service.createImport(new Uint8Array(), metadata, 'synthetic-source', context)],
  ['reparse before source retrieval', (service) => service.reparseInvoice(invoice.id, context)],
  ['rematch before persistence', (service) => service.rematchTrucks(invoice.id, context)],
  ['issue resolution before persistence', (service) => service.resolveIssue(invoice.id, 'synthetic-issue', {}, context)],
  ['product mapping before persistence', (service) => service.applyProductMappings(invoice.id, context)],
  ['posting before persistence', (service) => service.postInvoice(invoice.id, context)],
];
for (const [name, operation] of deniedOperations) {
  test(`whole Pilot invoice ${name} denies partial Company access`, async () => {
    const { service, reads } = fixture();
    await assert.rejects(() => operation(service), AuthorizationDeniedError);
    assert.equal(reads.length, 0);
  });
}

test('an empty operating group fails closed before invoice reads', async () => {
  const { service, database, reads } = fixture();
  database.operatingGroupCompany.findMany = async () => [];
  await assert.rejects(() => service.listInvoices({ ...context, companyIds: [companyA, companyB] }), AuthorizationDeniedError);
  assert.equal(reads.length, 0);
});

test('full Company access preserves whole invoice totals, credits and Truck identity', async () => {
  const { service } = fixture();
  const full = { ...context, companyIds: [companyA, companyB] };
  const before = structuredClone(invoice);
  const listed = await service.listInvoices(full);
  const detail = await service.getInvoice(invoice.id, full);
  assert.equal(listed[0].invoiceTotalMinor, '25000');
  assert.equal(detail.invoiceTotalMinor, '25000');
  assert.equal(detail.adjustments[0].signedAmountMinor, '-100');
  assert.equal(detail.events[0].truckId, 'synthetic-truck-b');
  assert.equal(detail.events[0].truck.companyId, companyB);
  assert.deepEqual(invoice, before);
}
);

test('whole Pilot invoices require every Company even for an OWNER, before any invoice read', async () => {
  const { reads, service } = fixture();
  await assert.rejects(() => service.listInvoices(context), AuthorizationDeniedError);
  assert.equal(reads.length, 0);
});


import { FinancialControlService } from './financial-control-service';
import { financialControlAuthorization } from './financial-control-authorization';
import { financialStatementStorage } from './financial-statement-storage';
import { pilotImportService } from './pilot-import-service';
import { prisma } from '@/lib/prisma';
import { POST as uploadPilot } from '@/app/api/finance/imports/pilot/route';
import { GET as downloadStatement } from '@/app/api/finance/statements/[id]/download/route';
const fullContext = { ...context, companyIds: [companyA, companyB] };

test('fresh Company membership revocation denies a stale full context', async () => {
  const { database, service, reads } = fixture();
  database.companyMembership.findMany = async () => [{ companyId: companyA }];
  await assert.rejects(() => service.listInvoices(fullContext), AuthorizationDeniedError);
  assert.equal(reads.length, 0);
});
test('fresh membership query pins actor, group Company IDs and ADMIN/OWNER roles', async () => {
  const { database, service } = fixture();
  let query: unknown;
  database.companyMembership.findMany = async (...args: Parameters<PrismaClient['companyMembership']['findMany']>) => { query = args[0]; return [{ companyId: companyA }, { companyId: companyB }]; };
  await service.requireInvoiceAccess(fullContext);
  assert.deepEqual(query, { where: { userId: context.userId, companyId: { in: [companyA, companyB] }, role: { in: ['ADMIN', 'OWNER'] } }, select: { companyId: true } });
});
for (const [name, access] of [['partial', context], ['revoked', fullContext], ['full', fullContext]] as const) {
  test(`generic statements ${name} access preserves bank scope and whole Pilot totals`, async () => {
    const { database } = fixture();
    if (name === 'revoked') database.companyMembership.findMany = async () => [{ companyId: companyA }];
    let query!: Prisma.FinancialStatementFindManyArgs;
    const pilot = { id: 'pilot-source', sourceTotalMinor: BigInt(25000) };
    const bank = { id: 'bank-source', sourceTotalMinor: BigInt(123) };
    const repo = { ...database, financialStatement: { findMany: async (args: Prisma.FinancialStatementFindManyArgs) => { query = args; return args.where!.pilotDocuments?.none ? [bank] : [bank, pilot]; } } };
    const result = await new FinancialControlService(repo as unknown as PrismaClient).listStatements(access);
    assert.deepEqual(result.map(row => row.id), name === 'full' ? ['bank-source', 'pilot-source'] : ['bank-source']);
    assert.equal(result[0].sourceTotalMinor, '123');
    assert.equal(query.where!.operatingGroupId, context.operatingGroupId);
    assert.deepEqual(query.where!.archiveVersions, { none: {} });
    if (name === 'full') assert.equal(result[1].sourceTotalMinor, '25000');
  });
}

// Actual handlers with temporary synthetic singleton transports; not authenticated HTTP acceptance.
async function withTransports(operation: (state: { puts: number; deletes: number; gets: number }) => Promise<void>) {
  const originals = {
    auth: financialControlAuthorization.requireContext, put: financialStatementStorage.put,
    del: financialStatementStorage.delete, get: financialStatementStorage.get,
    create: pilotImportService.createImport, group: prisma.operatingGroupCompany.findMany,
    membership: prisma.companyMembership.findMany, statement: prisma.financialStatement.findFirst,
  };
  const state = { puts: 0, deletes: 0, gets: 0 };
  try {
    financialControlAuthorization.requireContext = async () => fullContext;
    prisma.operatingGroupCompany.findMany = (async () => [{ companyId: companyA }, { companyId: companyB }]) as unknown as typeof originals.group;
    prisma.companyMembership.findMany = (async () => [{ companyId: companyA }, { companyId: companyB }]) as unknown as typeof originals.membership;
    financialStatementStorage.put = async () => { state.puts++; return 'synthetic-original-key'; };
    financialStatementStorage.delete = async () => { state.deletes++; };
    financialStatementStorage.get = async () => { state.gets++; return new Uint8Array([1, 2]); };
    await operation(state);
  } finally {
    financialControlAuthorization.requireContext = originals.auth;
    financialStatementStorage.put = originals.put; financialStatementStorage.delete = originals.del;
    financialStatementStorage.get = originals.get; pilotImportService.createImport = originals.create;
    prisma.operatingGroupCompany.findMany = originals.group;
    prisma.companyMembership.findMany = originals.membership;
    prisma.financialStatement.findFirst = originals.statement;
  }
}
function uploadRequest() {
  const form = new FormData();
  form.set('file', new File(['a,b\n1,2\n'], 'synthetic.csv', { type: 'text/csv' }));
  form.set('sourceId', 'synthetic-source');
  return new Request('http://synthetic.invalid/api/finance/imports/pilot', { method: 'POST', body: form });
}
test('Pilot upload denies partial access before reading request or storing original', async () => withTransports(async state => {
  financialControlAuthorization.requireContext = async () => context;
  let parsed = 0;
  const response = await uploadPilot({ formData: async () => { parsed++; return new FormData(); } } as unknown as Request);
  assert.equal(response.status, 403);
  assert.equal(parsed, 0); assert.equal(state.puts, 0);
}));
test('Pilot uncertain postcommit readback failure retains uploaded original bytes', async () => withTransports(async state => {
  pilotImportService.createImport = async () => { throw new AuthorizationDeniedError(); };
  const response = await uploadPilot(uploadRequest());
  assert.equal(response.status, 403);
  assert.equal(state.puts, 1); assert.equal(state.deletes, 0);
}));
for (const [name, linked, access, expected] of [
  ['partial Pilot', true, context, 403], ['revoked Pilot', true, fullContext, 403],
  ['full Pilot', true, fullContext, 200], ['partial bank', false, context, 200],
] as const) {
  test(`raw statement download ${name} checks actual Pilot relation before storage`, async () => withTransports(async state => {
    financialControlAuthorization.requireContext = async () => access;
    if (name === 'revoked Pilot') prisma.companyMembership.findMany = (async () => [{ companyId: companyA }]) as unknown as typeof prisma.companyMembership.findMany;
    let query!: Prisma.FinancialStatementFindFirstArgs;
    prisma.financialStatement.findFirst = (async (args: Prisma.FinancialStatementFindFirstArgs) => { query = args; return { storageKey: 'synthetic-key', originalFilename: 'source.csv', mimeType: 'text/csv', checksumSha256: 'synthetic', archiveVersions: [], archiveConflicts: [], pilotDocuments: linked ? [{ id: 'synthetic-link' }] : [] }; }) as unknown as typeof prisma.financialStatement.findFirst;
    const response = await downloadStatement(new Request('http://synthetic.invalid'), { params: Promise.resolve({ id: 'synthetic-statement' }) });
    assert.equal(response.status, expected);
    assert.equal(state.gets, expected === 200 ? 1 : 0);
    assert.ok(query.select!.pilotDocuments);
  }));
}
