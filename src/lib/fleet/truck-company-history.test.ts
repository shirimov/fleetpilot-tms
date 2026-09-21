import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { TruckCompanyHistoryService, resolveCompanyRange, historyDate, type HistoryChange } from './truck-company-history';

// Dedicated database: immutable audit rows must not be deleted to clean a shared test DB.
const url = new URL(process.env.DATABASE_URL!);
const dbName = `truck_history_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url.toString() });
url.pathname = `/${dbName}`;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
const service = new TruckCompanyHistoryService(db);
let a: string, b: string, c: string, actor: string, reader: string;
const input = (periods: HistoryChange['periods']): HistoryChange => ({ action: 'CONFIRM', expectedRevisionId: null, source: 'OWNER_CONFIRMATION', sourceReference: 'Synthetic OWNER evidence', reason: 'Verified operating Company dates', periods });
async function truck(unit: string = randomUUID(), status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') { return db.truck.create({ data: { companyId: a, unitNumber: unit, unitNumberNormalized: unit.toUpperCase(), status } }); }
const period = (companyId: string, effectiveFrom: string, effectiveTo: string | null = null) => ({ companyId, effectiveFrom, effectiveTo });

before(async () => {
  const { execFileSync } = await import('node:child_process');
  await admin.query(`CREATE DATABASE "${dbName}"`);
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  [a, b, c] = await Promise.all(['Turner fixture', 'Rana fixture', 'Outside scope'].map(async name => (await db.company.create({ data: { name } })).id));
  actor = (await db.user.create({ data: { email: `${dbName}@example.test`, displayName: 'Owner' } })).id;
  reader = (await db.user.create({ data: { email: `${dbName}-reader@example.test`, displayName: 'Scoped reader' } })).id;
  await db.companyMembership.createMany({ data: [{ userId: actor, companyId: a, role: 'OWNER' }, { userId: actor, companyId: b, role: 'ADMIN' }, { userId: reader, companyId: a, role: 'ADMIN' }] });
});
after(async () => { await db.$disconnect(); await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); await admin.end(); });

test('calendar boundaries, unknown and conflicting intervals, full period and Wednesday split', () => {
  assert.throws(() => historyDate('2026-02-30'));
  assert.throws(() => historyDate('2026-07-01T12:00:00Z'));
  const p = [period('A', '2026-07-05', '2026-07-08'), period('B', '2026-07-08')];
  assert.deepEqual(resolveCompanyRange(p, '2026-07-05', '2026-07-08'), { status: 'EXACT', companyId: 'A' });
  assert.deepEqual(resolveCompanyRange(p, '2026-07-08', '2026-07-09'), { status: 'EXACT', companyId: 'B' });
  assert.deepEqual(resolveCompanyRange(p, '2026-07-05', '2026-07-12'), { status: 'SPLIT_PERIOD' });
  assert.deepEqual(resolveCompanyRange(p, '2026-07-01', '2026-07-12'), { status: 'UNKNOWN' });
  assert.deepEqual(resolveCompanyRange([...p, period('C', '2026-07-07')], '2026-07-05', '2026-07-12'), { status: 'AMBIGUOUS' });
});

test('one physical Truck: A→B→A, immutable correction revisions, inactive historical resolution', async () => {
  const t = await truck('024', 'INACTIVE');
  await db.truck.update({ where: { id: t.id }, data: { vin: '1XKYDP9X5PJ225667', vinNormalized: '1XKYDP9X5PJ225667' } });
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-01-01', actor), { status: 'UNKNOWN' });
  let revision = await service.change(t.id, input([period(a, '2026-01-01')]), actor);
  for (const [company, boundary] of [[b, '2026-06-01'], [a, '2026-08-01']]) {
    revision = await service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: revision.revisionId, destinationCompanyId: company, effectiveDate: boundary }, actor);
  }
  assert.equal(await db.truck.count({ where: { unitNumber: '024' } }), 1);
  assert.equal((await db.truck.findUniqueOrThrow({ where: { id: t.id } })).companyId, a);
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-07-01', actor), { status: 'EXACT', companyId: b });
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2025-12-31', actor), { status: 'UNKNOWN' });
  assert.deepEqual(await service.resolveRange(t.id, '2026-05-31', '2026-06-07', actor), { status: 'SPLIT_PERIOD' });
  assert.deepEqual(await service.resolveStatementTruck('1XKYDP9X5PJ225667', b, '2026-07-01', '2026-07-08', actor), { status: 'EXACT', truckId: t.id, companyId: b });
  const old = await db.truckCompanyAffiliation.count({ where: { truckId: t.id } });
  await service.change(t.id, { ...input([period(a, '2026-01-02', '2026-06-01'), period(b, '2026-06-01', '2026-08-01'), period(a, '2026-08-01')]), action: 'CORRECT', expectedRevisionId: revision.revisionId }, actor);
  assert.equal(await db.truckCompanyAffiliation.count({ where: { truckId: t.id } }), old + 3);
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-01-01', actor), { status: 'UNKNOWN' });
  await assert.rejects(db.truckCompanyHistoryRevision.delete({ where: { id: revision.revisionId } }));
  await assert.rejects(db.truck.update({ where: { id: t.id }, data: { companyId: b } }));
  await assert.rejects(db.truck.update({ where: { id: t.id }, data: { vin: 'ANOTHER_PHYSICAL_VIN' } }));
});

test('overlap, two opens, missing current, future move, unauthorized Company, collisions fail closed', async () => {
  const t = await truck();
  await assert.rejects(service.change(t.id, input([period(a, '2026-01-01'), period(b, '2026-02-01')]), actor), /overlap/);
  await assert.rejects(service.change(t.id, input([period(a, '2026-01-01', '2026-02-01')]), actor), /open/);
  await assert.rejects(service.change(t.id, input([period(c, '2026-01-01', '2026-02-01'), period(a, '2026-02-01')]), actor));
  const rev = await service.change(t.id, input([period(a, '2026-01-01')]), actor);
  const move: HistoryChange = { ...input([]), action: 'MOVE', destinationCompanyId: b, effectiveDate: '2026-07-01', expectedRevisionId: rev.revisionId };
  await assert.rejects(service.change(t.id, move, reader));
  await assert.rejects(service.change(t.id, { ...move, effectiveDate: '2099-01-01' }, actor), /Future/);
  await db.truck.create({ data: { unitNumber: t.unitNumber.toLowerCase(), companyId: b } });
  await assert.rejects(service.change(t.id, move, actor), /collision/);
  assert.equal((await db.truck.findUniqueOrThrow({ where: { id: t.id } })).companyId, a);
});

test('database exclusion and one-open guards reject direct writes and rolled-back supersession', async () => {
  const t = await truck(); const r = await service.change(t.id, input([period(a, '2026-01-01')]), actor);
  await assert.rejects(db.truckCompanyAffiliation.create({ data: { truckId: t.id, companyId: b, effectiveFrom: historyDate('2026-02-01'), revisionId: r.revisionId } }));
  await assert.rejects(db.truckCompanyAffiliation.create({ data: { truckId: t.id, companyId: b, effectiveFrom: historyDate('2026-02-01'), effectiveTo: historyDate('2026-02-02'), revisionId: r.revisionId } }));
  await assert.rejects(db.truckCompanyAffiliation.updateMany({ where: { truckId: t.id }, data: { supersededAt: new Date() } }));
  assert.equal(await db.truckCompanyAffiliation.count({ where: { truckId: t.id, supersededAt: null } }), 1);
});

test('concurrent same-head moves serialize: one succeeds, stale contender fails without new Truck', async () => {
  const t = await truck(); const r = await service.change(t.id, input([period(a, '2026-01-01')]), actor);
  const move: HistoryChange = { ...input([]), action: 'MOVE', expectedRevisionId: r.revisionId, destinationCompanyId: b, effectiveDate: '2026-07-01' };
  const results = await Promise.allSettled([service.change(t.id, move, actor), service.change(t.id, move, actor)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(await db.truckCompanyAffiliation.count({ where: { truckId: t.id, supersededAt: null, effectiveTo: null } }), 1);
  assert.equal((await db.truck.findUniqueOrThrow({ where: { id: t.id } })).companyId, b);
  const scoped = await service.history(t.id, reader);
  assert.equal(scoped.currentCompanyId, null);
  assert.equal(scoped.canManage, false);
  assert.ok(scoped.periods.every(p => p.companyId === a && p.reason === null));
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-07-01', reader), { status: 'UNKNOWN' });
});

test('normalized raw VIN duplicates cannot bypass canonical uniqueness; no economics or archive writes', async () => {
  await db.truck.create({ data: { companyId: a, unitNumber: 'vin-1', vin: '1XKYDP9X3KJ278859' } });
  await assert.rejects(db.truck.create({ data: { companyId: b, unitNumber: 'vin-2', vin: '1xkydp9x3kj278859' } }));
  for (const count of [await db.financialTransaction.count(), await db.financialAllocation.count(), await db.pilotFuelingEvent.count(), await db.archiveVersion.count(), await db.archiveLine.count()]) assert.equal(count, 0);
});
