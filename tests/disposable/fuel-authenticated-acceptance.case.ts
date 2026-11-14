import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIResponse, type Browser, type BrowserContext, type TestInfo } from 'playwright/test';
import { assertDisposableIsolation } from './assert-isolation';

// The shared host harness proves fresh DB identity, grants and denied egress.
// Neither empty tables nor a caller-provided acknowledgement proves isolation.
assertDisposableIsolation('fuel');

type Actor = { id: string; email: string };
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const date = (v = '2026-02-11') => new Date(`${v}T00:00:00Z`);
const encode = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);
const reason = 'Synthetic isolated acceptance: explicitly reviewed source identity.';

async function reply(response: APIResponse, status = 200, privateResponse = false) {
  expect(response.status()).toBe(status);
  if (privateResponse || status >= 400) expect(response.headers()['cache-control']).toBe('private, no-store');
  const body = await response.json();
  if (status === 403) expect(body).toEqual({ error: 'Access denied' });
  if (status === 404) expect(body).toEqual({ error: 'Not found' });
  return body;
}
// src/proxy.ts rejects an existing inactive session or a MEMBER before the
// finance/fleet route runs; its 403 contract is distinct from route Access denied.
async function proxyDenied(response: APIResponse) {
  expect(response.status()).toBe(403);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: 'You do not have access to this resource.' });
}
// Only GET /api/finance/transactions returns transactionPage(), not a list.
function transactionRows(body: unknown): Array<{ id: string }> {
  expect(body).toEqual({ rows: expect.any(Array), total: expect.any(Number), page: 1, pageSize: 25 });
  const page = body as { rows: Array<{ id: string }>; total: number };
  expect(Number.isSafeInteger(page.total)).toBe(true);
  expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
  expect(page.rows.length).toBeLessThanOrEqual(25);
  return page.rows;
}
function stamped(value: unknown, start: number, end = Date.now()) {
  expect(typeof value).toBe('string');
  const time = Date.parse(value as string);
  expect(Number.isFinite(time)).toBe(true);
  expect(time).toBeGreaterThanOrEqual(start - 1000);
  expect(time).toBeLessThanOrEqual(end + 1000);
}
function identifier(value: unknown): asserts value is string {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^[A-Za-z0-9_-]{8,200}$/);
}
async function files(root: string): Promise<string[]> {
  const rows: string[] = [];
  let bytes = 0;
  async function walk(relative: string) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name), full = path.join(root, name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new Error('Unexpected attachment symlink');
      bytes += stat.isDirectory() ? 0 : stat.size;
      if (rows.length >= 1024 || bytes > 16 * 1024 * 1024 || !stat.isDirectory() && !stat.isFile()) throw new Error('Unexpected attachment tree exceeds synthetic bounds');
      rows.push(`${name}:${stat.mode & 0o777}:${stat.isDirectory() ? 'directory' : sha(await readFile(full))}`);
      if (stat.isDirectory()) await walk(name);
    }
  }
  await walk(''); return rows;
}

// Exact row-value multisets, not counts or recomputed business algorithms.
// SQL casts each JSONB row to text before transport, preserving bigint/decimal values.
const selectors = {
  FinancialSource: 't."operatingGroupId" = $1',
  FinancialStatement: 't."operatingGroupId" = $1',
  FinancialImportRecord: 't."statementId" IN (SELECT id FROM "FinancialStatement" WHERE "operatingGroupId" = $1)',
  PilotProviderInvoice: 't."operatingGroupId" = $1',
  PilotInvoiceDocument: 't."invoiceId" IN (SELECT id FROM "PilotProviderInvoice" WHERE "operatingGroupId" = $1)',
  PilotFuelingEvent: 't."invoiceId" IN (SELECT id FROM "PilotProviderInvoice" WHERE "operatingGroupId" = $1)',
  PilotFuelProductLine: 't."invoiceId" IN (SELECT id FROM "PilotProviderInvoice" WHERE "operatingGroupId" = $1)',
  PilotInvoiceAdjustment: 't."invoiceId" IN (SELECT id FROM "PilotProviderInvoice" WHERE "operatingGroupId" = $1)',
  PilotImportIssue: 't."invoiceId" IN (SELECT id FROM "PilotProviderInvoice" WHERE "operatingGroupId" = $1)',
  FinancialTransaction: 't."operatingGroupId" = $1',
  FinancialAllocation: 't."transactionId" IN (SELECT id FROM "FinancialTransaction" WHERE "operatingGroupId" = $1)',
  FinancialTransactionEvidence: 't."transactionId" IN (SELECT id FROM "FinancialTransaction" WHERE "operatingGroupId" = $1)',
  FinancialExpectation: 't."operatingGroupId" = $1',
  FinancialExpectationMatch: 't."expectationId" IN (SELECT id FROM "FinancialExpectation" WHERE "operatingGroupId" = $1)',
  FinancialExpectationBankMatch: 't."operatingGroupId" = $1',
  FinancialAuditEvent: 't."operatingGroupId" = $1',
  FinancialCategory: 't."operatingGroupId" = $1',
  FinancialParty: 't."operatingGroupId" = $1',
  PilotProductMapping: 't."operatingGroupId" = $1',
  BankAccount: 't."companyId" IN (SELECT "companyId" FROM "OperatingGroupCompany" WHERE "operatingGroupId" = $1)',
  BankTransaction: 't."companyId" IN (SELECT "companyId" FROM "OperatingGroupCompany" WHERE "operatingGroupId" = $1)',
  BankTransactionClassification: 't."bankTransactionId" IN (SELECT b.id FROM "BankTransaction" b JOIN "OperatingGroupCompany" c ON c."companyId"=b."companyId" WHERE c."operatingGroupId" = $1)',
  Truck: 't."companyId" IN (SELECT "companyId" FROM "OperatingGroupCompany" WHERE "operatingGroupId" = $1)',
  TruckCompanyHistoryRevision: 't."truckId" IN (SELECT tr.id FROM "Truck" tr JOIN "OperatingGroupCompany" c ON c."companyId"=tr."companyId" WHERE c."operatingGroupId" = $1)',
  TruckCompanyAffiliation: 't."truckId" IN (SELECT tr.id FROM "Truck" tr JOIN "OperatingGroupCompany" c ON c."companyId"=tr."companyId" WHERE c."operatingGroupId" = $1)',
  FuelReconciliationManualMatch: 't."operatingGroupId" = $1',
  TruckOwnerHistoryRevision: 't."operatingGroupId" = $1',
  TruckOwnerPeriod: 't."revisionId" IN (SELECT id FROM "TruckOwnerHistoryRevision" WHERE "operatingGroupId" = $1)',
  ArchiveCompany: 't."operatingGroupId" = $1',
  ArchiveStatement: 't."archiveCompanyId" IN (SELECT id FROM "ArchiveCompany" WHERE "operatingGroupId" = $1)',
  ArchiveVersion: 't."statementId" IN (SELECT s.id FROM "ArchiveStatement" s JOIN "ArchiveCompany" c ON c.id=s."archiveCompanyId" WHERE c."operatingGroupId" = $1)',
  ArchiveLine: 't."versionId" IN (SELECT v.id FROM "ArchiveVersion" v JOIN "ArchiveStatement" s ON s.id=v."statementId" JOIN "ArchiveCompany" c ON c.id=s."archiveCompanyId" WHERE c."operatingGroupId" = $1)',
  ArchiveTruck: 't."versionId" IN (SELECT v.id FROM "ArchiveVersion" v JOIN "ArchiveStatement" s ON s.id=v."statementId" JOIN "ArchiveCompany" c ON c.id=s."archiveCompanyId" WHERE c."operatingGroupId" = $1)',
} as const;

async function fixture(browser: Browser, baseURL: string | undefined, info: TestInfo) {
  assertDisposableIsolation('fuel');
  if (!baseURL || !process.env.DISPOSABLE_READER_DATABASE_URL || !process.env.PRIVATE_FILE_STORAGE_ROOT) {
    throw new Error('Fuel requires baseURL, a separately granted DISPOSABLE_READER_DATABASE_URL and shared fresh PRIVATE_FILE_STORAGE_ROOT');
  }
  const { prisma: db } = await import('../../src/lib/prisma');
  const { Pool } = await import('pg');
  const reader = new Pool({ connectionString: process.env.DISPOSABLE_READER_DATABASE_URL, max: 1, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  const control = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  const suffix = `fuel-${randomUUID()}`;
  // Allocate all root IDs before writes, allowing reconciliation of uncertain setup.
  const a = `${suffix}-a`, b = `${suffix}-b`, c = `${suffix}-c`, group = `${suffix}-group`, foreignGroup = `${suffix}-foreign`;
  const contexts: BrowserContext[] = [], storageKeys: string[] = [];
  let immutable = false;
  const root = process.env.PRIVATE_FILE_STORAGE_ROOT;
  const actorIds: string[] = [];
  async function snapshot(only?: readonly (keyof typeof selectors)[]) {
    const client = await reader.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result: Record<string, string[]> = {};
      for (const table of only ?? Object.keys(selectors) as (keyof typeof selectors)[]) {
        result[table] = (await client.query(`SELECT to_jsonb(t)::text AS row FROM "${table}" t WHERE ${selectors[table]} ORDER BY to_jsonb(t)::text`, [group])).rows.map(r => r.row);
      }
      await client.query('COMMIT'); return { rows: result, files: await files(root) };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function actor(name: string, role: 'OWNER' | 'ADMIN' | 'MEMBER', full = true, foreign = false): Promise<Actor> {
    const id = `${suffix}-${name}`; actorIds.push(id);
    return db.user.create({ data: { id, email: `${id}@example.test`, displayName: `Synthetic ${name}`, activeCompanyId: foreign ? c : a,
      memberships: { create: (foreign ? [c] : full ? [a, b] : [a]).map(companyId => ({ companyId, role })) },
      operatingGroupMemberships: { create: { operatingGroupId: foreign ? foreignGroup : group, role } } } });
  }
  async function login(who: Actor, allowed = true) {
    const context = await browser.newContext({ baseURL }); contexts.push(context);
    const token = randomBytes(32).toString('base64url'), tokenHash = sha(token);
    await db.emailSignInToken.create({ data: { userId: who.id, email: who.email, tokenHash, expiresAt: new Date(Date.now() + 120_000) } });
    const page = await context.newPage();
    await page.goto(`/login/email/verify#token=${token}`);
    if (!allowed) {
      await expect(page.getByRole('heading', { name: 'This sign-in link is invalid or expired' })).toBeVisible();
      expect((await reply(await context.request.get('/api/auth/session'))).user).toBeUndefined();
      expect((await db.emailSignInToken.findUniqueOrThrow({ where: { tokenHash } })).consumedAt).toBeNull();
      await page.close(); return context.request;
    }
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    const session = await reply(await context.request.get('/api/auth/session'));
    expect(session.user.id).toBe(who.id); expect(Date.parse(session.expires)).toBeGreaterThan(Date.now());
    expect((await db.emailSignInToken.findUniqueOrThrow({ where: { tokenHash } })).consumedAt).not.toBeNull();
    await page.close(); return context.request;
  }
  async function document(sourceId: string, name: string, type: 'FUEL_STATEMENT' | 'BANK_STATEMENT' | 'OWNER_SETTLEMENT' = 'FUEL_STATEMENT') {
    const { financialStatementStorage } = await import('../../src/lib/finance/financial-statement-storage');
    // Direct synthetic DB envelopes, not a claim that a provider parser ran.
    const pdf = type === 'OWNER_SETTLEMENT';
    const filename = `${name}.${pdf ? 'pdf' : 'csv'}`;
    const bytes = Buffer.from(pdf ? `%PDF-1.4\n% synthetic ${suffix} ${name}\n%%EOF\n` : `synthetic,${suffix},${name}\nvalue,1\n`);
    const key = await financialStatementStorage.put(bytes); storageKeys.push(key);
    return db.financialStatement.create({ data: { operatingGroupId: group, sourceId, type, periodStart: date(), periodEnd: date(), originalFilename: filename, displayFilename: filename, mimeType: pdf ? 'application/pdf' : 'text/csv', byteSize: bytes.length, storageKey: key, checksumSha256: sha(bytes), sourceTotalMinor: BigInt(9900), importedByUserId: `${suffix}-owner` } });
  }
  async function close(primary?: unknown) {
    const failures: unknown[] = [];
    async function attempt(fn: () => Promise<unknown>) { try { await fn(); } catch (e) { failures.push(e); } }
    for (const context of contexts) await attempt(() => context.close());
    await attempt(async () => {
      await info.attach('fuel-owned-fixture-manifest', { body: Buffer.from(encode({ suffix, companyIds: [a,b,c], groupIds: [group,foreignGroup], actorIds, storageKeys, immutable, cleanup: immutable ? 'Immutable rows and original bytes retained for mandatory external fresh-pair destruction; no guard bypass' : 'Exact owned FK-order deletion' })), contentType: 'application/json' });
    });
    if (!immutable) {
      // Predicates derive exclusively from the exact preallocated owned group.
      const deletes: Array<() => Promise<unknown>> = [
        () => db.financialAuditEvent.deleteMany({ where: { operatingGroupId: group } }),
        () => db.financialExpectationBankMatch.deleteMany({ where: { operatingGroupId: group } }),
        () => db.financialExpectationMatch.deleteMany({ where: { expectation: { operatingGroupId: group } } }),
        () => db.financialTransactionEvidence.deleteMany({ where: { transaction: { operatingGroupId: group } } }),
        () => db.financialAllocation.deleteMany({ where: { transaction: { operatingGroupId: group } } }),
        () => db.pilotImportIssue.deleteMany({ where: { invoice: { operatingGroupId: group } } }),
        () => db.pilotFuelProductLine.deleteMany({ where: { invoice: { operatingGroupId: group } } }),
        () => db.pilotInvoiceAdjustment.deleteMany({ where: { invoice: { operatingGroupId: group } } }),
        () => db.pilotFuelingEvent.deleteMany({ where: { invoice: { operatingGroupId: group } } }),
        () => db.pilotInvoiceDocument.deleteMany({ where: { invoice: { operatingGroupId: group } } }),
        () => db.pilotProviderInvoice.deleteMany({ where: { operatingGroupId: group } }),
        () => db.financialExpectation.deleteMany({ where: { operatingGroupId: group } }),
        () => db.financialTransaction.deleteMany({ where: { operatingGroupId: { in: [group,foreignGroup] } } }),
        () => db.financialImportRecord.deleteMany({ where: { statement: { operatingGroupId: group } } }),
        () => db.financialStatement.deleteMany({ where: { operatingGroupId: group } }),
        () => db.bankTransactionClassification.deleteMany({ where: { bankTransaction: { companyId: a } } }),
        () => db.bankTransaction.deleteMany({ where: { companyId: a } }),
        () => db.bankAccount.deleteMany({ where: { companyId: a } }),
        () => db.financialSource.deleteMany({ where: { operatingGroupId: group } }),
        () => db.truck.deleteMany({ where: { companyId: { in: [a,b,c] } } }),
        () => db.user.deleteMany({ where: { id: { in: actorIds } } }),
        () => db.operatingGroup.deleteMany({ where: { id: { in: [group,foreignGroup] } } }),
        () => db.company.deleteMany({ where: { id: { in: [a,b,c] } } }),
      ];
      for (const remove of deletes) await attempt(remove);
      for (const key of storageKeys) await attempt(async () => (await import('../../src/lib/finance/financial-statement-storage')).financialStatementStorage.delete(key));
      await attempt(async () => {
        expect(await db.company.count({ where: { id: { in: [a,b,c] } } })).toBe(0);
        expect(await db.user.count({ where: { id: { in: actorIds } } })).toBe(0);
        expect(await db.operatingGroup.count({ where: { id: { in: [group,foreignGroup] } } })).toBe(0);
        for (const key of storageKeys) await expect(lstat(path.join(root, 'financial-statements', key))).rejects.toMatchObject({ code: 'ENOENT' });
      });
    }
    await attempt(() => reader.end()); await attempt(() => control.end()); await attempt(() => db.$disconnect());
    if (primary !== undefined || failures.length) throw new AggregateError([...(primary === undefined ? [] : [primary]), ...failures], 'Fuel primary/cleanup evidence (first error retained)');
  }
  try {
    // Supplement external grant proof without attempting to repair permissions.
    const r = (await reader.query('SELECT current_database() db, current_user usr, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    const w = (await db.$queryRawUnsafe<Array<{ db: string; usr: string }>>('SELECT current_database() db, current_user usr'))[0];
    expect(r.db).toBe(w.db); expect(r.usr).not.toBe(w.usr); expect(r.rolsuper).toBe(false); expect(r.rolbypassrls).toBe(false);
    const writable = await reader.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR pg_has_role(current_user,c.relowner,'USAGE'))");
    expect(writable.rows).toEqual([]);
    await db.company.createMany({ data: [a,b,c].map(id => ({ id, name: `Synthetic ${id}` })) });
    await db.operatingGroup.create({ data: { id: group, name: suffix, companies: { create: [a,b].map(companyId => ({ companyId })) } } });
    await db.operatingGroup.create({ data: { id: foreignGroup, name: `${suffix}-foreign`, companies: { create: { companyId: c } } } });
    const owner = await actor('owner', 'OWNER');
    const source = await db.financialSource.create({ data: { operatingGroupId: group, companyId: a, name: suffix, type: 'FUEL_CARD', provider: 'PILOT', currency: 'USD' } });
    const pilotDocument = await document(source.id, 'synthetic-pilot');
    const bankDocument = await document(source.id, 'synthetic-bank', 'BANK_STATEMENT');
    const expectation = await db.financialExpectation.create({ data: { operatingGroupId: group, companyId: a, sourceId: source.id, expectedAmountMinor: BigInt(9900), direction: 'OUTFLOW', description: suffix, expectedDateStart: date(), expectedDateEnd: date(), createdByUserId: owner.id } });
    const invoice = await db.pilotProviderInvoice.create({ data: { operatingGroupId: group, sourceId: source.id, providerAccountHash: sha(suffix), invoiceNumber: suffix, billingDate: date(), periodStart: date(), periodEnd: date(), invoiceTotalMinor: BigInt(9900), parsedTotalMinor: BigInt(9900), differenceMinor: BigInt(0), status: 'POSTED', parseVersion: 'synthetic', uploadedByUserId: owner.id, postedByUserId: owner.id, postedAt: new Date(), expectationId: expectation.id, documents: { create: { statementId: pilotDocument.id, role: 'STRUCTURED_SOURCE' } } } });
    const truck = await db.truck.create({ data: { companyId: a, unitNumber: suffix, unitNumberNormalized: suffix.toUpperCase() } });
    const transaction = await db.financialTransaction.create({ data: { operatingGroupId: group, companyId: a, transactionDate: date(), amountMinor: BigInt(10000), direction: 'OUTFLOW', description: suffix, createdByUserId: owner.id, status: 'POSTED' } });
    const foreignTransaction = await db.financialTransaction.create({ data: { operatingGroupId: foreignGroup, companyId: c, transactionDate: date(), amountMinor: BigInt(17777), direction: 'OUTFLOW', description: `${suffix}-foreign-transaction`, createdByUserId: owner.id, status: 'POSTED' } });
    const fuelTransaction = await db.financialTransaction.create({ data: { operatingGroupId: group, companyId: b, transactionDate: date(), amountMinor: BigInt(10000), direction: 'OUTFLOW', description: `${suffix}-fuel`, createdByUserId: owner.id, status: 'POSTED' } });
    const event = await db.pilotFuelingEvent.create({ data: { invoiceId: invoice.id, eventKeyHash: sha(`${suffix}-event`), ticketHash: sha(`${suffix}-ticket`), authorizationHash: sha(`${suffix}-authorization`), sourceUnitNumber: truck.unitNumber, transactionDate: date(), truckId: truck.id, truckMatchStatus: 'MATCHED', transactionId: fuelTransaction.id } });
    const record = await db.financialImportRecord.create({ data: { statementId: pilotDocument.id, sourceRowIndex: 1, rawAmount: '100.00', rawMetadata: { synthetic: suffix }, candidateAmountMinor: BigInt(10000), fingerprintSha256: sha(`${suffix}-row`) } });
    const product = await db.pilotFuelProductLine.create({ data: { invoiceId: invoice.id, eventId: event.id, importRecordId: record.id, lineFingerprint: sha(`${suffix}-line`), sourceLineIdentity: `${suffix}-line`, sourceProductCode: 'SYNTHETIC-UNMAPPED', productType: 'TRUCK_DIESEL', quantity: '20.00', unitPrice: '5.0000000', amountMinor: BigInt(10000), retailAmountMinor: BigInt(11000), savingsMinor: BigInt(1000) } });
    const creditRow = await db.financialImportRecord.create({ data: { statementId: pilotDocument.id, sourceRowIndex: 2, rawAmount: '-1.00', fingerprintSha256: sha(`${suffix}-credit-row`) } });
    const creditTransaction = await db.financialTransaction.create({ data: { operatingGroupId: group, companyId: a, transactionDate: date(), amountMinor: BigInt(100), direction: 'INFLOW', description: `${suffix}-credit`, createdByUserId: owner.id, status: 'POSTED' } });
    await db.pilotInvoiceAdjustment.create({ data: { invoiceId: invoice.id, importRecordId: creditRow.id, fingerprint: sha(`${suffix}-credit`), sourceLineIdentity: `${suffix}-credit`, description: 'Synthetic signed credit', signedAmountMinor: -BigInt(100), transactionId: creditTransaction.id } });
    const bankRow = await db.financialImportRecord.create({ data: { statementId: bankDocument.id, sourceRowIndex: 1, rawAmount: '100.00', candidateAmountMinor: BigInt(10000), fingerprintSha256: sha(`${suffix}-bank-row`) } });
    const manualExpectation = await db.financialExpectation.create({ data: { operatingGroupId: group, companyId: a, expectedAmountMinor: BigInt(9900), direction: 'OUTFLOW', description: `${suffix}-manual`, expectedDateStart: date(), expectedDateEnd: date(), createdByUserId: owner.id } });
    const bankAccount = await db.bankAccount.create({ data: { companyId: a, provider: 'OTHER', createdByUserId: owner.id } });
    const bank = await db.bankTransaction.create({ data: { bankAccountId: bankAccount.id, companyId: a, amount: 150, amountMinor: BigInt(15000), direction: 'OUTFLOW', date: date(), name: 'Synthetic bank control' } });
    return { db, reader, control, a,b,c,group,foreignGroup,suffix,owner,source,invoice,expectation,manualExpectation,transaction,foreignTransaction,fuelTransaction,creditTransaction,event,record,bankRow,product,truck,bank,pilotDocument,bankDocument,actor,login,document,snapshot,close, markImmutable: () => { immutable = true; } };
  } catch (error) { await close(error); throw error; }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function run(browser: Browser, baseURL: string | undefined, info: TestInfo, operation: (f: Fixture) => Promise<void>) {
  const f = await fixture(browser, baseURL, info); let primary: unknown;
  try { await operation(f); } catch (error) {
    primary = error;
    try { await info.attach('fuel-first-failure-poststate', { body: Buffer.from(encode(await f.snapshot())), contentType: 'application/json' }); }
    catch (snapshotError) { primary = new AggregateError([error,snapshotError], 'Primary assertion and failure-readback error'); }
  }
  await f.close(primary);
}

test.describe('real-session synthetic Fuel acceptance', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 90_000 });

  test('whole invoice HTTP scope and adjacent source/manual-target authorization', async ({ browser, baseURL }, info) => run(browser, baseURL, info, async f => {
    const owner = await f.login(f.owner);
    const admin = await f.login(await f.actor('admin', 'ADMIN'));
    const partial = await f.login(await f.actor('partial', 'OWNER', false));
    const revokedActor = await f.actor('revoked', 'OWNER'); const revoked = await f.login(revokedActor);
    await f.db.companyMembership.delete({ where: { userId_companyId: { userId: revokedActor.id, companyId: f.b } } });
    const member = await f.login(await f.actor('member', 'MEMBER'));
    const foreign = await f.login(await f.actor('foreign', 'OWNER', true, true));
    const inactiveActor = await f.actor('inactive', 'OWNER'); const inactive = await f.login(inactiveActor);
    await f.db.user.update({ where: { id: inactiveActor.id }, data: { isActive: false } });
    const initiallyInactive = await f.actor('initially-inactive', 'OWNER');
    await f.db.user.update({ where: { id: initiallyInactive.id }, data: { isActive: false } });
    await reply(await (await f.login(initiallyInactive, false)).get('/api/finance/fuel'), 401);
    const anonymousContext = await browser.newContext({ baseURL });
    try { await reply(await anonymousContext.request.get('/api/finance/fuel'), 401); } finally { await anonymousContext.close(); }
    await proxyDenied(await inactive.get('/api/finance/fuel'));
    await proxyDenied(await member.get('/api/finance/fuel'));
    await reply(await foreign.get(`/api/finance/imports/pilot/${f.invoice.id}`), 404);
    expect(transactionRows(await reply(await foreign.get('/api/finance/transactions'))).map(x => x.id)).toEqual([f.foreignTransaction.id]);
    for (const request of [owner, admin]) {
      const invoice = await reply(await request.get(`/api/finance/imports/pilot/${f.invoice.id}`));
      expect(invoice.id).toBe(f.invoice.id); expect(invoice.invoiceTotalMinor).toBe('9900');
      expect(invoice.events[0].productLines[0]).toMatchObject({ id: f.product.id, amountMinor: '10000', quantity: '20', categoryId: null });
      expect(invoice.adjustments[0].signedAmountMinor).toBe('-100');
      expect((await reply(await request.get('/api/finance/imports/pilot'))).map((x: { id: string }) => x.id)).toEqual([f.invoice.id]);
      await reply(await request.get('/api/finance/fuel'));
      const candidates = await reply(await request.get(`/api/finance/expectations/${f.expectation.id}/bank-matches`));
      expect(candidates.find((x: { id: string }) => x.id === f.bank.id).amountDifferenceMinor).toBe('5100');
    }
    const settled = await reply(await owner.post(`/api/finance/expectations/${f.expectation.id}/bank-matches`, { data: { bankTransactionId: f.bank.id, matchedAmountMinor: '100' } }), 201);
    identifier(settled.id); expect(settled.matchedAmountMinor).toBe('100');
    const beforeRepeat = await f.snapshot();
    expect((await reply(await owner.post(`/api/finance/expectations/${f.expectation.id}/bank-matches`, { data: { bankTransactionId: f.bank.id, matchedAmountMinor: '100' } }), 201)).idempotent).toBe(true);
    expect(await f.snapshot()).toEqual(beforeRepeat);
    const families = [
      ['statements', f.pilotDocument.id, f.bankDocument.id], ['import-records', f.record.id, f.bankRow.id],
      ['expectations', f.expectation.id, f.manualExpectation.id], ['transactions', f.fuelTransaction.id, f.transaction.id],
    ];
    for (const request of [owner, admin, partial, revoked]) {
      const full = request === owner || request === admin;
      for (const [route, pilotId, controlId] of families) {
        const body = await reply(await request.get(`/api/finance/${route}`));
        const rows = route === 'transactions' ? transactionRows(body) : body;
        expect(rows.some((x: { id: string }) => x.id === pilotId)).toBe(full);
        expect(rows.some((x: { id: string }) => x.id === controlId)).toBe(true);
        expect(rows.some((x: { id: string }) => x.id === f.foreignTransaction.id)).toBe(false);
        if (!full) { expect(encode(rows)).not.toContain(f.invoice.id); expect(encode(rows)).not.toContain(f.creditTransaction.id); }
      }
    }
    const issue = await f.db.pilotImportIssue.create({ data: { invoiceId: f.invoice.id, eventId: f.event.id, code: 'UNMATCHED_TRUCK', message: 'Synthetic valid issue target' } });
    for (const request of [partial, revoked]) {
      const before = await f.snapshot();
      for (const url of ['/api/finance/fuel', '/api/finance/imports/pilot', `/api/finance/imports/pilot/${f.invoice.id}`, `/api/finance/statements/${f.pilotDocument.id}/download`]) await reply(await request.get(url), 403);
      await reply(await request.get(`/api/finance/expectations/${f.expectation.id}/bank-matches`), 404);
      await reply(await request.post(`/api/finance/expectations/${f.expectation.id}/bank-matches`, { data: { bankTransactionId: f.bank.id, matchedAmountMinor: '100' } }), 404);
      await reply(await request.post(`/api/finance/expectations/${f.expectation.id}/matches`, { data: { transactionId: f.transaction.id, amount: '1.00' } }), 404);
      await reply(await request.post(`/api/finance/transactions/${f.transaction.id}/evidence`, { data: { importRecordId: f.record.id, amount: '1.00', method: 'MANUAL' } }), 404);
      for (const action of ['reparse', 'rematch', 'apply-product-mappings', 'post']) await reply(await request.post(`/api/finance/imports/pilot/${f.invoice.id}/${action}`, { data: {} }), 403);
      await reply(await request.post(`/api/finance/imports/pilot/${f.invoice.id}/issues/${issue.id}`, { data: { action: 'MATCH_TRUCK', truckId: f.truck.id } }), 403);
      expect(await f.snapshot()).toEqual(before);
      const downloaded = await request.get(`/api/finance/statements/${f.bankDocument.id}/download`);
      expect(downloaded.status()).toBe(200); expect(downloaded.headers()['cache-control']).toBe('private, no-store');
      expect(downloaded.headers()['x-content-type-options']).toBe('nosniff'); expect(sha(await downloaded.body())).toBe(f.bankDocument.checksumSha256);
    }
    // Positive non-Pilot controls use normal services, not provider-owned targets.
    const start = Date.now();
    const match = await reply(await partial.post(`/api/finance/expectations/${f.manualExpectation.id}/matches`, { data: { transactionId: f.transaction.id, amount: '1.00' } }), 201);
    identifier(match.id); stamped(match.matchedAt, start);
    expect((await f.db.financialExpectationMatch.findUniqueOrThrow({ where: { id: match.id } })).matchedAmountMinor).toBe(BigInt(100));
    const evidence = await reply(await partial.post(`/api/finance/transactions/${f.transaction.id}/evidence`, { data: { importRecordId: f.bankRow.id, amount: '1.00', method: 'MANUAL' } }), 201);
    identifier(evidence.id); stamped(evidence.matchedAt, start);
    expect((await f.db.financialTransactionEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).importRecordId).toBe(f.bankRow.id);
    const pilotMatch = await reply(await owner.post(`/api/finance/expectations/${f.expectation.id}/matches`, { data: { transactionId: f.transaction.id, amount: '1.00' } }), 201);
    identifier(pilotMatch.id); stamped(pilotMatch.matchedAt, start);
    expect((await f.db.financialExpectationMatch.findUniqueOrThrow({ where: { id: pilotMatch.id } })).expectationId).toBe(f.expectation.id);
    const pilotEvidence = await reply(await owner.post(`/api/finance/transactions/${f.transaction.id}/evidence`, { data: { importRecordId: f.record.id, amount: '1.00', method: 'MANUAL' } }), 201);
    identifier(pilotEvidence.id); stamped(pilotEvidence.matchedAt, start);
    expect((await f.db.financialTransactionEvidence.findUniqueOrThrow({ where: { id: pilotEvidence.id } })).importRecordId).toBe(f.record.id);
  }));

  test('OWNER reservation and history are real HTTP with immutable source/economic oracles', async ({ browser, baseURL }, info) => run(browser, baseURL, info, async f => {
    const owner = await f.login(f.owner), admin = await f.login(await f.actor('admin', 'ADMIN'));
    const member = await f.login(await f.actor('member', 'MEMBER'));
    const foreign = await f.login(await f.actor('foreign', 'OWNER', true, true));
    const revokedActor = await f.actor('revoked', 'OWNER'); const revoked = await f.login(revokedActor);
    await f.db.operatingGroupMembership.delete({ where: { operatingGroupId_userId: { operatingGroupId: f.group, userId: revokedActor.id } } });
    // These existing production guards forbid row deletion. Retain immutable evidence
    // until the common harness destroys and verifies the entire owned fresh pair.
    f.markImmutable();
    const { TruckCompanyHistoryService } = await import('../../src/lib/fleet/truck-company-history');
    await new TruckCompanyHistoryService(f.db).change(f.truck.id, { action: 'CONFIRM', expectedRevisionId: null, source: 'MANUAL_CONFIRMATION', sourceReference: reason, reason, periods: [{ companyId: f.a, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-01' }] }, f.owner.id);
    await f.db.archiveScopeGrant.create({ data: { operatingGroupId: f.group, companyId: f.a, grantedByUserId: f.owner.id, reason } });
    const archiveCompany = await f.db.archiveCompany.create({ data: { operatingGroupId: f.group, companyId: f.a, sourceId: f.source.id, accountKey: f.suffix, providerCompanyId: `${f.suffix}-provider`, providerCompanyName: 'Synthetic archive' } });
    const recipient = `${f.suffix}-recipient`, otherRecipient = `${f.suffix}-other-recipient`;
    const lineIds: string[] = [];
    for (const [index, who] of [recipient, recipient, otherRecipient].entries()) {
      const document = await f.document(f.source.id, `archive-${index}`, 'OWNER_SETTLEMENT');
      const { FilesystemPrivateFileStorage } = await import('../../src/lib/storage/private-file-storage');
      const rawDetail = Buffer.from(encode({ synthetic: f.suffix, providerRecipientId: who, sourceIndex: index, fuel_transactions: index < 2 ? [{ id: `${f.suffix}-line-${index}`, amount: '100.00', quantity: '20.00', purchaseDate: '2026-02-11' }] : [] }));
      const detailStorageKey = await new FilesystemPrivateFileStorage('quickmanage-details').put(rawDetail);
      const statement = await f.db.archiveStatement.create({ data: { archiveCompanyId: archiveCompany.id, providerStatementId: `${f.suffix}-${index}`, latestProviderVersion: 1, acceptedProviderVersion: 1 } });
      await f.db.$transaction(async tx => {
        const version = await tx.archiveVersion.create({ data: { statementId: statement.id, providerVersion: 1, documentId: document.id, detailStorageKey, detailChecksum: sha(rawDetail), pdfChecksum: document.checksumSha256, bundleChecksum: sha(`${document.checksumSha256}:${sha(rawDetail)}`), pid: `${f.suffix}-period`, recipientId: who, recipientType: 'CONTRACTOR', workStart: date('2026-02-09'), workEnd: date('2026-02-15'), header: {}, issues: [], parserVersion: 'synthetic-direct-envelope', capturedByUserId: f.owner.id } });
        await tx.archiveTruck.create({ data: { versionId: version.id, sourceKey: f.truck.unitNumber, unit: f.truck.unitNumber, truckId: f.truck.id, mappingStatus: 'MATCHED' } });
        if (index < 2) {
          const line = await tx.archiveLine.create({ data: { versionId: version.id, kind: 'DEDUCTION', sourceArray: 'fuel_transactions', sourceOrder: 0, providerLineId: `${f.suffix}-line-${index}`, amountMinor: -BigInt(10000), rawAmount: '100.00', sourceDate: '2026-02-11', sourceUnit: f.truck.unitNumber, included: true, metadata: { date: `2026-02-11T${index ? '11' : '10'}:00:00Z`, diesel_amount: '100.00', diesel_qty: '20.00', def_amount: '0', reefer_amount: '0', reefer_qty: '0', pay_amount: '100.00' } } }); lineIds.push(line.id);
        }
        await tx.archiveVersion.update({ where: { id: version.id }, data: { sealed: true } });
      });
    }
    const party = await f.db.financialParty.create({ data: { operatingGroupId: f.group, companyId: f.a, type: 'OWNER_OPERATOR', name: `${f.suffix}-owner-party` } });
    const historyInput = { expectedRevisionId: null, sourceReference: reason, reason, periods: [{ ownerPartyId: party.id, companyId: f.a, providerRecipientId: recipient, effectiveFrom: '2026-01-01', effectiveTo: null }] };
    const manualInput = { action: 'MANUAL_MATCH', pilotEventId: f.event.id, archiveLineId: lineIds[0], reason };
    // Nonempty original ledger/evidence/allocation projections avoid vacuous
    // conservation assertions. No posting/matching service coverage is repeated.
    const category = await f.db.financialCategory.create({ data: { operatingGroupId: f.group, name: `${f.suffix}-original-category`, type: 'DIRECT_EXPENSE' } });
    await f.db.financialAllocation.create({ data: { transactionId: f.fuelTransaction.id, companyId: f.b, categoryId: category.id, amountMinor: BigInt(10000), pilotProductLineId: f.product.id } });
    await f.db.financialTransactionEvidence.create({ data: { transactionId: f.fuelTransaction.id, importRecordId: f.record.id, matchedAmountMinor: BigInt(10000), method: 'EXACT', role: 'PRIMARY', matchedByUserId: f.owner.id } });
    await f.db.financialTransaction.update({ where: { id: f.fuelTransaction.id }, data: { reconciliationStatus: 'MATCHED' } });
    await f.db.financialExpectationMatch.create({ data: { expectationId: f.expectation.id, transactionId: f.transaction.id, matchedAmountMinor: BigInt(100) } });
    await f.db.financialExpectation.update({ where: { id: f.expectation.id }, data: { matchedAmountMinor: BigInt(100), status: 'PARTIALLY_MATCHED' } });
    const immutableTables = ['FinancialStatement','FinancialImportRecord','PilotProviderInvoice','PilotInvoiceDocument','PilotFuelingEvent','PilotFuelProductLine','PilotInvoiceAdjustment','FinancialTransaction','FinancialAllocation','FinancialTransactionEvidence','FinancialExpectation','FinancialExpectationMatch','FinancialExpectationBankMatch','ArchiveVersion','ArchiveLine','ArchiveTruck'] as const;
    const original = await f.snapshot(immutableTables);
    const preview = await reply(await owner.get('/api/finance/fuel-reconciliation'), 200, true);
    const row = preview.rows.find((x: { pilotEventId: string }) => x.pilotEventId === f.event.id);
    expect(row.statementEvidence).toBeNull();
    expect(preview.rows.filter((x: { pilotEventId: string | null; statementEvidence?: { lineIds: string[] } }) => !x.pilotEventId && x.statementEvidence?.lineIds.some(id => lineIds.includes(id))).flatMap((x: { statementEvidence: { lineIds: string[] } }) => x.statementEvidence.lineIds).sort()).toEqual([...lineIds].sort());
    for (const request of [admin, member, foreign, revoked]) {
      const before = await f.snapshot();
      const manualDenied = await request.post('/api/finance/fuel-reconciliation', { data: manualInput });
      if (request === member) await proxyDenied(manualDenied);
      else await reply(manualDenied, request === foreign ? 409 : 403);
      const historyDenied = await request.post(`/api/trucks/${f.truck.id}/owner-history`, { data: historyInput });
      if (request === member) await proxyDenied(historyDenied);
      else await reply(historyDenied, request === foreign ? 404 : 403);
      expect(await f.snapshot()).toEqual(before);
    }
    await reply(await admin.get(`/api/trucks/${f.truck.id}/owner-history`), 200, true);
    const start = Date.now();
    const reservation = await reply(await owner.post('/api/finance/fuel-reconciliation', { data: manualInput }), 201, true);
    identifier(reservation.id); stamped(reservation.createdAt, start);
    const persisted = await f.db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(persisted).toMatchObject({ pilotEventId: f.event.id, archiveLineId: lineIds[0], createdByUserId: f.owner.id, reason, unmatchedAt: null });
    const creationAudit = await f.db.financialAuditEvent.findMany({ where: { operatingGroupId: f.group, action: 'FUEL_RECONCILIATION_MANUAL_MATCHED' } });
    expect(creationAudit).toHaveLength(1); expect(creationAudit[0].actorUserId).toBe(f.owner.id);
    expect(creationAudit[0].after).toEqual({ matchId: reservation.id, pilotEventId: f.event.id, archiveLineId: lineIds[0] });
    const first = await reply(await owner.post(`/api/trucks/${f.truck.id}/owner-history`, { data: historyInput }), 200, true); identifier(first.revisionId);
    const corrected = await reply(await owner.post(`/api/trucks/${f.truck.id}/owner-history`, { data: { ...historyInput, expectedRevisionId: first.revisionId, periods: [{ ...historyInput.periods[0], providerRecipientId: otherRecipient }] } }), 200, true);
    identifier(corrected.revisionId); expect(corrected.revisionId).not.toBe(first.revisionId);
    const history = await reply(await owner.get(`/api/trucks/${f.truck.id}/owner-history`), 200, true);
    expect(history.revisionId).toBe(corrected.revisionId); expect(history.periods[0].actorUserId).toBe(f.owner.id); stamped(history.periods[0].createdAt, start);
    const revisions = await f.db.truckOwnerHistoryRevision.findMany({ where: { truckId: f.truck.id } });
    expect(revisions).toHaveLength(2); expect(revisions.find(x => x.id === corrected.revisionId)?.previousRevisionId).toBe(first.revisionId);
    const correctionPreview = await reply(await owner.get('/api/finance/fuel-reconciliation'), 200, true);
    const paired = correctionPreview.rows.find((x: { pilotEventId: string }) => x.pilotEventId === f.event.id);
    expect(paired.manualMatch.id).toBe(reservation.id); expect(paired.statementEvidence.lineIds).toEqual([lineIds[0]]);
    // This Contractor fixture has confirmed owner history and retained manual
    // evidence but no FuelDeductionPolicy: reconciliation stops at NEEDS_POLICY.
    expect(paired.status).toBe('NEEDS_POLICY');
    expect(correctionPreview.rows.filter((x: { statementEvidence?: { lineIds: string[] } }) => x.statementEvidence?.lineIds.includes(lineIds[1]))).toHaveLength(1);
    expect(correctionPreview.completeness.orphanActiveManualMatches).toBe(0); expect(correctionPreview.completeness.duplicateConsumedEvidence).toBe(0);
    expect(await f.db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: reservation.id } })).toEqual(persisted);
    expect(await f.db.financialAuditEvent.findMany({ where: { id: creationAudit[0].id } })).toEqual(creationAudit);
    const beforeStale = await f.snapshot();
    await reply(await owner.post(`/api/trucks/${f.truck.id}/owner-history`, { data: historyInput }), 409);
    for (const request of [admin, member, revoked]) {
      const denied = await request.patch('/api/finance/fuel-reconciliation', { data: { action: 'MANUAL_UNMATCH', matchId: reservation.id, reason } });
      if (request === member) await proxyDenied(denied);
      else await reply(denied, 403);
    }
    expect(await f.snapshot()).toEqual(beforeStale);
    const retired = await reply(await owner.patch('/api/finance/fuel-reconciliation', { data: { action: 'MANUAL_UNMATCH', matchId: reservation.id, reason } }), 200, true);
    expect(retired.id).toBe(reservation.id); expect(retired.unmatchedByUserId).toBe(f.owner.id); stamped(retired.unmatchedAt, start);
    const finalMatch = await f.db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: reservation.id } });
    expect({ ...finalMatch, unmatchedAt: null, unmatchedByUserId: null, unmatchReason: null }).toEqual(persisted);
    expect(await f.db.fuelReconciliationManualMatch.count({ where: { operatingGroupId: f.group, unmatchedAt: null } })).toBe(0);
    expect(await f.db.financialAuditEvent.count({ where: { operatingGroupId: f.group, action: 'FUEL_RECONCILIATION_MANUAL_UNMATCHED' } })).toBe(1);
    expect(await f.snapshot(immutableTables)).toEqual(original);
  }));

  test('committed authority changes precede generic matching authoritative reread', async ({ browser, baseURL }, info) => run(browser, baseURL, info, async f => {
    const who = await f.actor('interleaving', 'OWNER'), request = await f.login(who);
    const changes = ['company-revocation', 'group-expansion', 'actor-disablement', 'group-role-revocation'] as const;
    for (const operation of ['expectation', 'evidence'] as const) for (const change of changes) {
      const barrier = await f.control.connect(); let pending: Promise<APIResponse> | undefined;
      let released = false, primary: unknown;
      try {
        await barrier.query('BEGIN'); await barrier.query("SET LOCAL statement_timeout = '5s'");
        const key = operation === 'expectation' ? `expectation:${f.expectation.id}` : `import-record:${f.record.id}`;
        const blockerPid = (await barrier.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        await barrier.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
        const before = await f.snapshot();
        const started = Date.now();
        pending = operation === 'expectation'
          ? request.post(`/api/finance/expectations/${f.expectation.id}/matches`, { data: { transactionId: f.transaction.id, amount: '1.00' }, timeout: 12_000 })
          : request.post(`/api/finance/transactions/${f.transaction.id}/evidence`, { data: { importRecordId: f.record.id, amount: '1.00', method: 'MANUAL' }, timeout: 12_000 });
        // Observe the actual lock wait and blocker identity. Polling observes a
        // deterministic barrier; elapsed sleeps never stand in for lock evidence.
        let waitProof: unknown;
        await expect.poll(async () => {
          const rows = await f.reader.query("SELECT a.pid, a.wait_event_type, l.classid::text, l.objid::text, l.objsubid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid AND l.locktype='advisory' AND NOT l.granted WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND $1::int = ANY(pg_blocking_pids(a.pid))", [blockerPid]);
          waitProof = rows.rows; return rows.rowCount;
        }, { timeout: 4000, intervals: [20,50,100] }).toBe(1);
        // Independent second writer commits before the blocker is released.
        if (change === 'company-revocation') await f.db.companyMembership.delete({ where: { userId_companyId: { userId: who.id, companyId: f.b } } });
        if (change === 'group-expansion') {
          await f.db.operatingGroupCompany.delete({ where: { companyId: f.c } });
          await f.db.operatingGroupCompany.create({ data: { operatingGroupId: f.group, companyId: f.c } });
        }
        if (change === 'actor-disablement') await f.db.user.update({ where: { id: who.id }, data: { isActive: false } });
        if (change === 'group-role-revocation') await f.db.operatingGroupMembership.update({ where: { operatingGroupId_userId: { operatingGroupId: f.group, userId: who.id } }, data: { role: 'MEMBER' } });
        const authority = (await f.reader.query('SELECT u."isActive", (SELECT role::text FROM "OperatingGroupMembership" WHERE "userId"=u.id AND "operatingGroupId"=$2) "groupRole", (SELECT role::text FROM "CompanyMembership" WHERE "userId"=u.id AND "companyId"=$3) "companyRole", (SELECT "operatingGroupId" FROM "OperatingGroupCompany" WHERE "companyId"=$4) "expandedGroup" FROM "User" u WHERE u.id=$1', [who.id,f.group,f.b,f.c])).rows[0];
        if (change === 'company-revocation') expect(authority.companyRole).toBeNull();
        if (change === 'group-expansion') expect(authority.expandedGroup).toBe(f.group);
        if (change === 'actor-disablement') expect(authority.isActive).toBe(false);
        if (change === 'group-role-revocation') expect(authority.groupRole).toBe('MEMBER');
        const committed = Date.now();
        await barrier.query('COMMIT'); released = true;
        const response = await pending;
        const after = await f.snapshot();
        // Retain the barrier and actual response even when the assertion fails.
        await info.attach(`fuel-authority-${operation}-${change}`, { body: Buffer.from(encode({ operation, change, key, blockerPid, waitProof, authority, started, committed, releasedBeforeResponse: true, status: response.status(), body: await response.json(), before, after })), contentType: 'application/json' });
        // Disablement/group-role risks are assertions, not reported reproductions.
        // No production fix is authorized if normal CI observes a write here.
        await reply(response, 404);
        expect(after).toEqual(before);

      } catch (error) { primary = error; }
      finally {
        const cleanup: unknown[] = [];
        try { if (!released) await barrier.query('ROLLBACK'); } catch (error) { cleanup.push(error); }
        barrier.release();
        try { if (pending) await pending; } catch (error) { cleanup.push(error); }
        // Restore only the explicitly changed synthetic authority for the next row.
        try {
          await f.db.user.update({ where: { id: who.id }, data: { isActive: true } });
          await f.db.companyMembership.upsert({ where: { userId_companyId: { userId: who.id, companyId: f.b } }, create: { userId: who.id, companyId: f.b, role: 'OWNER' }, update: { role: 'OWNER' } });
          await f.db.operatingGroupMembership.update({ where: { operatingGroupId_userId: { operatingGroupId: f.group, userId: who.id } }, data: { role: 'OWNER' } });
          if (change === 'group-expansion') { await f.db.operatingGroupCompany.delete({ where: { companyId: f.c } }); await f.db.operatingGroupCompany.create({ data: { operatingGroupId: f.foreignGroup, companyId: f.c } }); }
        } catch (error) { cleanup.push(error); }
        if (primary !== undefined || cleanup.length) throw new AggregateError([...(primary === undefined ? [] : [primary]), ...cleanup], 'Authority assertion/cleanup failure; no retry authorized');
      }
    }
  }));
});
