import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { FinancialControlService } from './financial-control-service';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';

const companyA = 'synthetic-company-a';
const companyB = 'synthetic-company-b';
const context: FinancialAuthorization = { userId: 'synthetic-user', role: 'OWNER', activeCompanyId: companyA, operatingGroupId: 'synthetic-group', companyIds: [companyA, companyB] };
// Small synthetic repository transport implements the relation filters used by the real service.
function matches(row: unknown, where: unknown): boolean {
  return Object.entries((where ?? {}) as Record<string, unknown>).every(([key, value]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (key === 'OR') return (value as unknown[]).some(v => matches(row, v));
    const actual = (row as Record<string, unknown>)[key];
    if (value === null) return actual == null;
    if (typeof value !== 'object' || value instanceof Date) return actual === value;
    if ('in' in value) return (value.in as unknown[]).includes(actual);
    if ('not' in value) return actual !== value.not;
    if ('none' in value) return !(actual as unknown[]).some(v => matches(v, value.none));
    if ('is' in value) return value.is === null ? actual == null : matches(actual, value.is);
    return actual != null && matches(actual, value);
  });
}
type SyntheticQuery = { where: Record<string, unknown> };
type SyntheticWrite = { data: Record<string, unknown>; where?: Record<string, unknown> };
function fixture(access: 'partial' | 'revoked' | 'full') {
  const queries: Record<string, SyntheticQuery[]> = {};
  const writes: Array<{ delegate: string; args: SyntheticWrite }> = [];
  const events: string[] = [];
  const write = (delegate: string, args: SyntheticWrite) => { writes.push({ delegate, args }); return { id: 'synthetic-match', ...args.data }; };
  const record = (key: string, args: SyntheticQuery) => { events.push(key); (queries[key] ??= []).push(args); };
  const group = context.operatingGroupId;
  const imports = ['bank', 'pilot', 'foreign'].map(id => ({ id, candidateAmountMinor: BigInt(25000), statement: { currency: 'USD', operatingGroupId: id === 'foreign' ? 'other-group' : group, pilotDocuments: id === 'pilot' ? [{ id: 'link' }] : [] } }));
  const expectations = ['manual', 'pilot', 'foreign'].map(id => ({ id, operatingGroupId: id === 'foreign' ? 'other-group' : group, pilotProviderInvoice: id === 'pilot' ? { id: 'invoice' } : null, expectedAmountMinor: BigInt(25000), matchedAmountMinor: BigInt(100), bankMatches: [], expectedDateStart: new Date('2026-08-01'), expectedDateEnd: new Date('2026-08-31'), direction: 'OUTFLOW', currency: 'USD' }));
  const transactions = ['manual', 'fuel', 'credit', 'foreign'].map(id => ({ id, direction: 'OUTFLOW', currency: 'USD', reconciliationStatus: 'UNMATCHED', operatingGroupId: id === 'foreign' ? 'other-group' : group, companyId: id === 'fuel' ? companyB : companyA, status: 'POSTED', category: null, amountMinor: BigInt(25000), expectedRecoveryMinor: BigInt(0), recoveredAmountMinor: BigInt(0), waivedAmountMinor: BigInt(0), pilotFuelingEvent: id === 'fuel' ? { invoiceId: 'invoice' } : null, pilotInvoiceAdjustment: id === 'credit' ? { invoiceId: 'invoice' } : null, allocations: [{ companyId: id === 'fuel' ? companyB : companyA, amountMinor: BigInt(25000) }], evidence: [] }));
  const bank = { id: 'bank-transaction', companyId: companyA, amountMinor: BigInt(30000), expectationMatches: [], allocations: [], classification: null };
  const database = {
    bankTransaction: { findMany: async (args: SyntheticQuery) => { record('bank', args); return [bank]; }, findFirst: async () => bank },
    financialExpectationBankMatch: { findUnique: async () => ({ id: 'existing-match', matchedAmountMinor: BigInt(100) }) },
    $queryRaw: async (strings: TemplateStringsArray) => strings.join('').includes('"isActive"') ? [{ isActive: true }] : strings.join('').includes('OperatingGroupCompany') ? [{ operatingGroupId: group }] : [{ role: 'OWNER' }],
    $transaction: async (callback: (transport: unknown) => Promise<unknown>) => callback(database),
    financialCategory: { findMany: async () => [] },
    financialTransaction: {
      findMany: async (args: SyntheticQuery) => { record('transactions', args); return transactions.filter(row => matches(row, args.where)); },
      findFirst: async (args: SyntheticQuery) => { record('transaction', args); return transactions.find(row => matches(row, args.where)) ?? null; },
      findUnique: async (args: SyntheticQuery) => { record('providerGuard', args); return transactions.find(row => matches(row, args.where)) ?? null; },
      update: async (args: SyntheticWrite) => write('transaction', args),
    },
    operatingGroupCompany: { findMany: async (args: SyntheticQuery) => { record('group', args); return [{ companyId: companyA }, { companyId: companyB }]; } },
    companyMembership: { findMany: async (args: SyntheticQuery) => { record('membership', args); return access === 'revoked' ? [{ companyId: companyA }] : [{ companyId: companyA }, { companyId: companyB }]; } },
    financialImportRecord: {
      findMany: async (args: SyntheticQuery) => { record('imports', args); return imports.filter(row => matches(row, args.where)); },
      findFirst: async (args: SyntheticQuery) => { record('import', args); return imports.find(row => matches(row, args.where)) ?? null; },
      update: async (args: SyntheticWrite) => write('import', args),
    },
    financialExpectationMatch: { aggregate: async () => ({ _sum: { matchedAmountMinor: BigInt(0) } }), create: async (args: SyntheticWrite) => write('expectationMatch', args) },
    financialTransactionEvidence: { aggregate: async () => ({ _sum: { matchedAmountMinor: BigInt(0) } }), create: async (args: SyntheticWrite) => write('evidence', args) },
    financialAuditEvent: { create: async (args: SyntheticWrite) => write('audit', args) },
    financialExpectation: {
      findMany: async (args: SyntheticQuery) => { record('expectations', args); return expectations.filter(row => matches(row, args.where)); },
      findFirst: async (args: SyntheticQuery) => { record('expectation', args); return expectations.find(row => matches(row, args.where)) ?? null; },
      update: async (args: SyntheticWrite) => write('expectation', args),
    },
  };
  return { database, queries, writes, events, accessContext: access === 'partial' ? { ...context, companyIds: [companyA] } : context, service: new FinancialControlService(database as unknown as PrismaClient) };
}
function assertAuthority(queries: Record<string, SyntheticQuery[]>, access: string) {
  assert.ok(queries.group?.length, 'fresh group authority must be queried');
  assert.deepEqual(queries.group[0].where, { operatingGroupId: context.operatingGroupId });
  if (access !== 'partial') assert.deepEqual(queries.membership[0].where, { userId: context.userId, companyId: { in: [companyA, companyB] }, role: { in: ['ADMIN', 'OWNER'] } });
}
for (const access of ['partial', 'revoked', 'full'] as const) {
  test(`raw import records ${access}: hide whole Pilot rows, retain bank and group scope`, async () => {
    const { service, accessContext, queries } = fixture(access);
    const rows = await service.listImportRecords(accessContext);
    assert.deepEqual(rows.map((row: { id: string }) => row.id), access === 'full' ? ['bank', 'pilot'] : ['bank']);
    assert.equal(rows[0].candidateAmountMinor, '25000');
    assertAuthority(queries, access);
  });
}
for (const access of ['partial', 'revoked', 'full'] as const) {
  test(`expectations ${access}: hide whole Pilot totals, retain manual and group scope`, async () => {
    const { service, accessContext, queries } = fixture(access);
    const rows = await service.listExpectations(accessContext);
    assert.deepEqual(rows.map((row: { id: string }) => row.id), access === 'full' ? ['manual', 'pilot'] : ['manual']);
    assert.equal(rows[0].expectedAmountMinor, '25000');
    assert.equal(rows[0].matchedAmountMinor, '100');
    assertAuthority(queries, access);
  });
}
for (const access of ['partial', 'revoked', 'full'] as const) {
  test(`transactions ${access}: no group-wide Pilot fuel or credit economics, retain manual`, async () => {
    const { service, accessContext, queries } = fixture(access);
    const rows = await service.listTransactions(accessContext, ['manual', 'fuel', 'credit', 'foreign']);
    assert.deepEqual(rows.map((row: { id: string }) => row.id), access === 'full' ? ['manual', 'fuel', 'credit'] : ['manual']);
    assert.equal(rows[0].amountMinor, '25000');
    assert.equal(rows[0].allocatedMinor, '25000');
    if (access === 'full') assert.equal(rows[1].allocations[0].companyId, companyB);
    assert.deepEqual(queries.transactions[0].where.id, { in: ['manual', 'fuel', 'credit', 'foreign'] });
    assertAuthority(queries, access);
  });
}
for (const access of ['partial', 'revoked', 'full'] as const) {
  test(`bank candidates ${access}: no Pilot total inference, retain manual matching`, async () => {
    const { service, accessContext, queries } = fixture(access);
    if (access === 'full') {
      const rows = await service.listBankMatchCandidates('pilot', accessContext);
      assert.equal(rows[0].amountDifferenceMinor, '5100');
    } else {
      await assert.rejects(() => service.listBankMatchCandidates('pilot', accessContext), FinancialNotFoundError);
      assert.equal(queries.bank?.length ?? 0, 0);
    }
    const manual = await service.listBankMatchCandidates('manual', accessContext);
    assert.equal(manual[0].amountDifferenceMinor, '5100');
    assert.deepEqual(queries.bank[0].where.companyId, { in: accessContext.companyIds });
    assertAuthority(queries, access);
  });
}
for (const access of ['partial', 'revoked', 'full'] as const) {
  test(`direct bank matching ${access}: Pilot gate precedes idempotent total readback, manual retained`, async () => {
    const { service, accessContext, queries } = fixture(access);
    const input = { bankTransactionId: 'bank-transaction' };
    if (access === 'full') {
      const result = await service.matchExpectationToBank('pilot', input, accessContext);
      assert.equal(result.matchedAmountMinor, '100');
    } else await assert.rejects(() => service.matchExpectationToBank('pilot', input, accessContext), FinancialNotFoundError);
    const manual = await service.matchExpectationToBank('manual', input, accessContext);
    assert.equal(manual.matchedAmountMinor, '100');
    assert.equal(manual.idempotent, true);
    assertAuthority(queries, access);
  });
}

for (const access of ['partial', 'revoked', 'full'] as const) {
  test(`generic expectation ${access}: Pilot source permission before manual target writes`, async () => {
    const { service, accessContext, queries, writes, events } = fixture(access);
    const operation = () => service.matchExpectation('pilot', { transactionId: 'manual', amount: '1.00' }, accessContext);
    if (access === 'full') {
      assert.equal((await operation()).matchedAmountMinor, '100');
      assert.deepEqual(writes.map(w => w.delegate), ['expectationMatch', 'expectation', 'audit']);
      assert.equal(writes[1].args.data.matchedAmountMinor, BigInt(200));
      assert.equal(writes[2].args.data.action, 'EXPECTATION_MATCHED');
    } else {
      await assert.rejects(operation, FinancialNotFoundError);
      assert.deepEqual(writes, []);
      assert.deepEqual(queries.expectation[0].where.pilotProviderInvoice, { is: null });
    }
    assertAuthority(queries, access);
    assert.ok(events.indexOf('group') < events.indexOf('expectation'));
    if (access !== 'partial') assert.ok(events.indexOf('membership') < events.indexOf('expectation'));
  });
  test(`generic expectation ${access}: permitted manual source conserved and audited`, async () => {
    const { service, accessContext, writes } = fixture(access);
    assert.equal((await service.matchExpectation('manual', { transactionId: 'manual', amount: '1.00' }, accessContext)).matchedAmountMinor, '100');
    assert.equal(writes[1].args.data.matchedAmountMinor, BigInt(200));
    assert.equal(writes[1].args.data.status, 'PARTIALLY_MATCHED');
    assert.equal(writes[2].args.data.actorUserId, context.userId);
  });
}
for (const id of ['unknown', 'foreign']) {
  test(`generic expectation ${id}: source and target IDs retain group filters without writes`, async () => {
    for (const target of [false, true]) {
      const { service, accessContext, writes, queries } = fixture('full');
      await assert.rejects(() => service.matchExpectation(target ? 'manual' : id, { transactionId: target ? id : 'manual', amount: '1.00' }, accessContext), FinancialNotFoundError);
      assert.deepEqual(writes, []);
      assert.equal(queries.expectation[0].where.operatingGroupId, context.operatingGroupId);
      assert.equal(queries.transaction[0].where.operatingGroupId, context.operatingGroupId);
    }
  });
}
test('generic expectation: amount conservation and provider-owned conflicts remain no-write', async () => {
  for (const transactionId of ['manual', 'fuel', 'credit']) {
    const { service, accessContext, writes } = fixture('full');
    await assert.rejects(() => service.matchExpectation('manual', { transactionId, amount: transactionId === 'manual' ? '250.01' : '1.00' }, accessContext), transactionId === 'manual' ? FinancialValidationError : FinancialConflictError);
    assert.deepEqual(writes, []);
  }
});

for (const access of ['partial', 'revoked', 'full'] as const) {
  test(`generic evidence ${access}: Pilot source permission before manual target writes`, async () => {
    const { service, accessContext, queries, writes, events } = fixture(access);
    const operation = () => service.matchEvidence('manual', { importRecordId: 'pilot', amount: '1.00', method: 'MANUAL' }, accessContext);
    if (access === 'full') {
      assert.equal((await operation()).matchedAmountMinor, '100');
      assert.deepEqual(writes.map(w => w.delegate), ['evidence', 'transaction', 'import', 'audit']);
      assert.equal(writes[3].args.data.action, 'EVIDENCE_MATCHED');
    } else {
      await assert.rejects(operation, FinancialNotFoundError);
      assert.deepEqual(writes, []);
      assert.deepEqual(queries.import[0].where.statement, { operatingGroupId: context.operatingGroupId, pilotDocuments: { none: {} } });
    }
    assertAuthority(queries, access);
    assert.ok(events.indexOf('group') < events.indexOf('import'));
    if (access !== 'partial') assert.ok(events.indexOf('membership') < events.indexOf('import'));
  });
  test(`generic evidence ${access}: permitted bank source conserved and audited`, async () => {
    const { service, accessContext, writes } = fixture(access);
    assert.equal((await service.matchEvidence('manual', { importRecordId: 'bank', amount: '1.00', method: 'MANUAL' }, accessContext)).matchedAmountMinor, '100');
    assert.equal(writes[0].args.data.role, 'PRIMARY');
    assert.equal(writes[1].args.data.reconciliationStatus, 'PARTIALLY_MATCHED');
    assert.equal(writes[2].args.data.status, 'PARTIALLY_MATCHED');
    assert.equal(writes[3].args.data.actorUserId, context.userId);
  });
}
for (const id of ['unknown', 'foreign']) {
  test(`generic evidence ${id}: source and target IDs retain group filters without writes`, async () => {
    for (const target of [false, true]) {
      const { service, accessContext, writes, queries } = fixture('full');
      await assert.rejects(() => service.matchEvidence(target ? id : 'manual', { importRecordId: target ? 'bank' : id, amount: '1.00', method: 'MANUAL' }, accessContext), FinancialNotFoundError);
      assert.deepEqual(writes, []);
      assert.deepEqual(queries.import[0].where, { id: target ? 'bank' : id, statement: { operatingGroupId: context.operatingGroupId } });
      assert.deepEqual(queries.transaction[0].where, { id: target ? id : 'manual', operatingGroupId: context.operatingGroupId });
    }
  });
}
test('generic evidence: amount conservation and provider-owned conflicts remain no-write', async () => {
  for (const transactionId of ['manual', 'fuel', 'credit']) {
    const { service, accessContext, writes } = fixture('full');
    await assert.rejects(() => service.matchEvidence(transactionId, { importRecordId: 'bank', amount: transactionId === 'manual' ? '250.01' : '1.00', method: 'MANUAL' }, accessContext), transactionId === 'manual' ? FinancialValidationError : FinancialConflictError);
    assert.deepEqual(writes, []);
  }
});
