import assert from 'node:assert/strict';
import { boundedHistoryShape } from '../../../tests/fixtures/truck-history-bounded';
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
const input = (periods: HistoryChange['periods']): HistoryChange => ({ action: 'CONFIRM', expectedRevisionId: null, source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic OWNER evidence', reason: 'Verified operating Company dates', periods });
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

test('overlap, two opens, empty revision, future move, unauthorized Company, collisions fail closed', async () => {
  const t = await truck();
  await assert.rejects(service.change(t.id, input([period(a, '2026-01-01'), period(b, '2026-02-01')]), actor), /overlap/);
  await assert.rejects(service.change(t.id, input([]), actor), /Supply/);
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

test('database rejects foreign-Truck affiliation parents and revision-chain splicing', async () => {
  const first = await truck(); const second = await truck();
  const root = await service.change(first.id, input([period(a, '2026-01-01')]), actor);
  await assert.rejects(db.truckCompanyAffiliation.create({ data: { truckId: second.id, companyId: b, effectiveFrom: historyDate('2026-01-01'), revisionId: root.revisionId } }));
  await assert.rejects(db.$transaction(async tx => {
    const revision = await tx.truckCompanyHistoryRevision.create({ data: { truckId: second.id, actorUserId: actor, previousRevisionId: root.revisionId, action: 'CORRECT', source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic evidence', reason: 'Cross-Truck parent must fail' } });
    await tx.truckCompanyAffiliation.create({ data: { truckId: second.id, companyId: a, effectiveFrom: historyDate('2026-01-01'), revisionId: revision.id } });
  }));
});

test('superseded decisions cannot acquire new active intervals without a reviewed revision', async () => {
  const t = await truck(); const root = await service.change(t.id, input([period(a, '2026-02-01')]), actor);
  await service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: root.revisionId, destinationCompanyId: b, effectiveDate: '2026-07-01' }, actor);
  await assert.rejects(db.truckCompanyAffiliation.create({ data: { truckId: t.id, companyId: a, effectiveFrom: historyDate('2026-01-01'), effectiveTo: historyDate('2026-02-01'), revisionId: root.revisionId } }));
  await assert.rejects(db.truck.updateMany({ where: { id: t.id }, data: { companyId: a } }));
  await assert.rejects(db.$executeRaw`UPDATE "Truck" SET "companyId"=${a} WHERE id=${t.id}`);
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-01-15', actor), { status: 'UNKNOWN' });
});

async function authorizedUser(name: string, companies: string[], role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER') {
  return db.user.create({ data: { email: `${name}-${randomUUID()}@example.test`, displayName: name, memberships: { create: companies.map(companyId => ({ companyId, role })) } } });
}

test('A→B→A→C keeps one identity and separate periods; audit reconstructs actor, source and boundary', async () => {
  const owner = await authorizedUser('Three Company owner', [a, b, c]);
  const created = await truck();
  const t = await db.truck.update({ where: { id: created.id }, data: { vin: '1HGCM82633A004352', vinNormalized: '1HGCM82633A004352' } }); // Synthetic physical-identity fixture.
  const count = await db.truck.count();
  let revision = await service.change(t.id, input([period(a, '2026-01-01')]), owner.id);
  for (const [destinationCompanyId, effectiveDate] of [[b, '2026-04-01'], [a, '2026-06-01'], [c, '2026-08-01']]) {
    revision = await service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: revision.revisionId, destinationCompanyId, effectiveDate }, owner.id);
  }
  assert.equal(await db.truck.count(), count);
  const final = await db.truck.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(final.vin, t.vin); assert.equal(final.companyId, c);
  const timeline = await service.history(t.id, owner.id);
  assert.deepEqual(timeline.periods.map(p => p.companyId), [a, b, a, c]);
  assert.deepEqual(await service.resolveRange(t.id, '2026-04-01', '2026-06-01', owner.id), { status: 'EXACT', companyId: b });
  const audit = await db.truckLifecycleEvent.findFirstOrThrow({ where: { truckReference: t.id, action: 'TRUCK_COMPANY_MOVE', after: { path: ['revisionId'], equals: revision.revisionId } } });
  assert.equal(audit.actorUserId, owner.id); assert.equal(audit.companyId, a);
  assert.deepEqual(audit.after, { companyId: c, revisionId: revision.revisionId });
  assert.deepEqual(audit.metadata, { source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic OWNER evidence', reason: 'Verified operating Company dates', vin: t.vin, periods: [period(a, '2026-01-01', '2026-04-01'), period(b, '2026-04-01', '2026-06-01'), period(a, '2026-06-01', '2026-08-01'), period(c, '2026-08-01')] });
});

test('simultaneous A→B and A→C are both authorized but only one revision can commit', async () => {
  const owner = await authorizedUser('Competing destinations', [a, b, c]);
  const t = await truck(); const root = await service.change(t.id, input([period(a, '2026-01-01')]), owner.id);
  const count = await db.truck.count();
  const results = await Promise.allSettled([b, c].map(destinationCompanyId => service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: root.revisionId, destinationCompanyId, effectiveDate: '2026-07-01' }, owner.id)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failed = results.find(r => r.status === 'rejected');
  assert.ok(failed?.status === 'rejected' && /History changed/.test(failed.reason.message));
  const current = await db.truck.findUniqueOrThrow({ where: { id: t.id } });
  const open = await db.truckCompanyAffiliation.findMany({ where: { truckId: t.id, supersededAt: null, effectiveTo: null } });
  assert.equal(open.length, 1); assert.equal(open[0].companyId, current.companyId);
  assert.ok([b, c].includes(current.companyId)); assert.equal(await db.truck.count(), count);
});

test('movement rolls back periods, Truck and revision if audit insertion fails', async () => {
  const t = await truck('ROLLBACK-AUDIT'); const root = await service.change(t.id, input([period(a, '2026-01-01')]), actor);
  const before = await db.truckCompanyAffiliation.findMany({ where: { truckId: t.id } });
  await db.$executeRawUnsafe(`CREATE FUNCTION reject_test_movement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."unitNumber"='ROLLBACK-AUDIT' AND NEW.action='TRUCK_COMPANY_MOVE' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reject_test_movement_audit BEFORE INSERT ON "TruckLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION reject_test_movement_audit()`);
  await assert.rejects(service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: root.revisionId, destinationCompanyId: b, effectiveDate: '2026-07-01' }, actor));
  assert.equal((await db.truck.findUniqueOrThrow({ where: { id: t.id } })).companyId, a);
  assert.deepEqual(await db.truckCompanyAffiliation.findMany({ where: { truckId: t.id } }), before);
  assert.equal(await db.truckCompanyHistoryRevision.count({ where: { truckId: t.id } }), 1);
});

test('OWNER and ADMIN are allowed; MEMBER, inactive, revoked and foreign-group users cannot read or mutate', async () => {
  const t = await truck(); const adminUser = await authorizedUser('Authorized admin', [a, b], 'ADMIN');
  const root = await service.change(t.id, input([period(a, '2026-01-01')]), adminUser.id);
  assert.equal((await service.history(t.id, adminUser.id)).canManage, true);
  const member = await authorizedUser('Member', [a, b], 'MEMBER');
  const inactive = await authorizedUser('Inactive', [a, b]); await db.user.update({ where: { id: inactive.id }, data: { isActive: false } });
  const revoked = await authorizedUser('Revoked', [a, b]); await db.companyMembership.deleteMany({ where: { userId: revoked.id } });
  const foreign = await authorizedUser('Foreign group', [c]);
  await db.operatingGroup.create({ data: { name: 'Foreign review group', memberships: { create: { userId: foreign.id, role: 'OWNER' } }, companies: { create: { companyId: c } } } });
  for (const user of [member, inactive, revoked, foreign]) {
    await assert.rejects(service.history(t.id, user.id));
    await assert.rejects(service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: root.revisionId, destinationCompanyId: b, effectiveDate: '2026-07-01' }, user.id));
    await assert.rejects(service.resolveStatementTruck('1XKYDP9X5PJ225667', a, '2026-07-01', '2026-07-02', user.id));
  }
});

test('calendar resolution is stable across UTC, timezone offsets and DST environments', () => {
  const original = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      for (const boundary of ['2026-03-08', '2026-11-01']) {
        assert.equal(historyDate(boundary).toISOString(), `${boundary}T00:00:00.000Z`);
        assert.deepEqual(resolveCompanyRange([period('A', '2026-01-01', boundary), period('B', boundary)], boundary, boundary === '2026-03-08' ? '2026-03-09' : '2026-11-02'), { status: 'EXACT', companyId: 'B' });
      }
    }
    for (const value of ['2026-03-08T00:00:00-08:00', '2026-03-08T08:00:00Z', '2026-11-01T00:00:00+13:00']) assert.throws(() => historyDate(value));
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});


test('bounded-only evidence preserves operational Company and every uncovered date stays UNKNOWN', async () => {
  const owner = await authorizedUser('Bounded owner', [a, b, c]);
  const t = await db.truck.create({ data: { companyId: c, unitNumber: 'BOUNDED-ONLY', vin: '1HGCM82633A004353' } });
  assert.equal((await service.history(t.id, owner.id)).periods.length, 0);
  const before = await db.truck.findUniqueOrThrow({ where: { id: t.id } });
  const rev = await service.change(t.id, { ...input([period(a, '2026-01-01', '2026-01-22'), period(b, '2026-02-05', '2026-03-01')]), source: 'QUICKMANAGE_STATEMENT' }, owner.id);
  assert.deepEqual(await db.truck.findUniqueOrThrow({ where: { id: t.id } }), before);
  assert.equal(await db.truckCompanyAffiliation.count({ where: { truckId: t.id, effectiveTo: null, supersededAt: null } }), 0);
  for (const date of ['2025-12-31', '2026-01-22', '2026-01-28', '2026-03-01', '2026-09-10']) {
    assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, date, owner.id), { status: 'UNKNOWN' });
  }
  assert.deepEqual(await service.resolveRange(t.id, '2026-01-02', '2026-01-22', owner.id), { status: 'EXACT', companyId: a });
  assert.deepEqual(await service.resolveRange(t.id, '2026-01-21', '2026-02-06', owner.id), { status: 'UNKNOWN' });
  const audit = await db.truckLifecycleEvent.findFirstOrThrow({ where: { truckReference: t.id } });
  assert.deepEqual(audit.before, { companyId: c, revisionId: null });
  assert.deepEqual(audit.after, { companyId: c, revisionId: rev.revisionId });
  assert.equal((await service.history(t.id, owner.id)).periods[0].source, 'QUICKMANAGE_STATEMENT');
  await assert.rejects(db.truck.update({ where: { id: t.id }, data: { companyId: a } }));
  await assert.rejects(db.$executeRaw`UPDATE "Truck" SET "companyId"=${a} WHERE id=${t.id}`);
  await assert.rejects(service.change(t.id, { ...input([period(c, '2026-01-01', '2026-02-01')]), action: 'CORRECT', expectedRevisionId: rev.revisionId }, reader));
});

test('adjacent bounded dates and gaps survive persisted correction without extending the final Company', async () => {
  const t = await truck();
  const r = await service.change(t.id, input([period(a, '2026-01-01', '2026-01-22'), period(b, '2026-01-22', '2026-02-05')]), actor);
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-01-21', actor), { status: 'EXACT', companyId: a });
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-01-22', actor), { status: 'EXACT', companyId: b });
  assert.deepEqual(await service.resolveRange(t.id, '2026-01-21', '2026-01-23', actor), { status: 'SPLIT_PERIOD' });
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-02-05', actor), { status: 'UNKNOWN' });
  await service.change(t.id, { ...input([period(a, '2026-01-01', '2026-01-22'), period(b, '2026-02-01', '2026-02-05')]), action: 'CORRECT', expectedRevisionId: r.revisionId }, actor);
  assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-01-25', actor), { status: 'UNKNOWN' });
  assert.equal(await db.truckCompanyAffiliation.count({ where: { truckId: t.id } }), 4);
});

test('bounded/bounded and bounded/open overlap are rejected in service and direct concurrent database writes', async () => {
  const t = await truck();
  await assert.rejects(service.change(t.id, input([period(a, '2026-01-01', '2026-02-01'), period(b, '2026-01-15', '2026-03-01')]), actor), /overlap/);
  await assert.rejects(service.change(t.id, input([period(b, '2026-01-01', '2026-02-01'), period(a, '2026-01-15')]), actor), /overlap/);
  const r = await service.change(t.id, input([period(a, '2026-01-01', '2026-02-01')]), actor);
  await assert.rejects(db.truckCompanyAffiliation.create({ data: { truckId: t.id, companyId: b, effectiveFrom: historyDate('2026-01-15'), effectiveTo: historyDate('2026-03-01'), revisionId: r.revisionId } }));
  await assert.rejects(db.truckCompanyAffiliation.create({ data: { truckId: t.id, companyId: a, effectiveFrom: historyDate('2026-01-15'), revisionId: r.revisionId } }));
  await assert.rejects(db.truckCompanyAffiliation.create({ data: { truckId: t.id, companyId: b, effectiveFrom: historyDate('2026-03-01'), revisionId: r.revisionId } })); // Wrong current open Company.
  const writes = await Promise.allSettled([a, b].map(companyId => db.truckCompanyAffiliation.create({ data: { truckId: t.id, companyId, effectiveFrom: historyDate('2026-03-01'), effectiveTo: historyDate('2026-04-01'), revisionId: r.revisionId } })));
  assert.equal(writes.filter(x => x.status === 'fulfilled').length, 1);
});

test('first movement and movement after bounded history record only the evidenced destination start', async () => {
  for (const withBounded of [false, true]) {
    const t = await truck();
    const r = withBounded ? await service.change(t.id, input([period(b, '2026-01-01', '2026-02-01')]), actor) : null;
    if (withBounded) await assert.rejects(service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: r!.revisionId, destinationCompanyId: b, effectiveDate: '2026-01-15' }, actor), /overlap/);
    const count = await db.truck.count();
    await service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: r?.revisionId ?? null, destinationCompanyId: b, effectiveDate: '2026-07-01' }, actor);
    assert.equal(await db.truck.count(), count);
    assert.equal((await db.truck.findUniqueOrThrow({ where: { id: t.id } })).companyId, b);
    const rows = await db.truckCompanyAffiliation.findMany({ where: { truckId: t.id, supersededAt: null } });
    assert.equal(rows.length, withBounded ? 2 : 1);
    assert.equal(rows.filter(p => p.effectiveTo === null).length, 1);
    assert.ok(rows.every(p => p.companyId === b)); // No fabricated prior A period.
    assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-06-30', actor), { status: 'UNKNOWN' });
    assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-07-01', actor), { status: 'EXACT', companyId: b });
  }
});

test('concurrent first movements from no history or bounded history commit only one destination', async () => {
  const owner = await authorizedUser('First movement owner', [a, b, c]);
  for (const withBounded of [false, true]) {
    const t = await truck(); const r = withBounded ? await service.change(t.id, input([period(a, '2026-01-01', '2026-02-01')]), owner.id) : null;
    const results = await Promise.allSettled([b, c].map(destinationCompanyId => service.change(t.id, { ...input([]), action: 'MOVE', expectedRevisionId: r?.revisionId ?? null, destinationCompanyId, effectiveDate: '2026-07-01' }, owner.id)));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    const open = await db.truckCompanyAffiliation.findMany({ where: { truckId: t.id, supersededAt: null, effectiveTo: null } });
    assert.equal(open.length, 1); assert.equal(open[0].companyId, (await db.truck.findUniqueOrThrow({ where: { id: t.id } })).companyId);
  }
});

test('78 synthetic bounded blocks preserve 24 adjacent/13 gapped transitions and six Sep 6 moves', async () => {
  const owner = await authorizedUser('Statement shape owner', [a, b, c]);
  const shape = boundedHistoryShape(a, b);
  assert.equal(shape.flat().length, 78);
  let adjacent = 0, gapped = 0;
  const persisted: string[] = [];
  for (const [i, periods] of shape.entries()) {
    const t = await db.truck.create({ data: { companyId: c, unitNumber: `SHAPE-${i}` } }); persisted.push(t.id);
    const before = await db.truck.findUniqueOrThrow({ where: { id: t.id } });
    await service.change(t.id, { ...input(periods), source: 'QUICKMANAGE_STATEMENT', sourceReference: `Synthetic statements ${i}` }, owner.id);
    assert.deepEqual(await db.truck.findUniqueOrThrow({ where: { id: t.id } }), before);
    for (let j = 1; j < periods.length; j++) {
      if (periods[j - 1].companyId !== periods[j].companyId) {
        if (periods[j - 1].effectiveTo === periods[j].effectiveFrom) adjacent++; else {
          gapped++;
          assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, periods[j - 1].effectiveTo!, owner.id), { status: 'UNKNOWN' });
        }
      }
    }
    if (i < 6) {
      assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-09-05', owner.id), { status: 'EXACT', companyId: a });
      assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-09-06', owner.id), { status: 'EXACT', companyId: b });
      assert.deepEqual(await service.resolveRange(t.id, '2026-09-05', '2026-09-07', owner.id), { status: 'SPLIT_PERIOD' });
      assert.deepEqual(await service.resolveTruckOperatingCompanyAt(t.id, '2026-09-13', owner.id), { status: 'UNKNOWN' });
    }
  }
  assert.equal(adjacent, 24); assert.equal(gapped, 13);
  assert.equal(await db.truckCompanyAffiliation.count({ where: { truckId: { in: persisted }, effectiveTo: null } }), 0);
  // Read-only event-shape regression; production counts never enter business logic.
  const history = await service.history(persisted[0], owner.id);
  const events = Array.from({ length: 698 }, (_, i) => ({ date: i < 670 ? '2026-09-06' : '2026-09-13', postedCompany: i < 31 ? a : b }));
  const snapshot = structuredClone(events); const counts = { EXACT: 0, UNKNOWN: 0 }; let differences = 0;
  for (const e of events) {
    const end = historyDate(e.date); end.setUTCDate(end.getUTCDate() + 1);
    const result = resolveCompanyRange(history.periods, e.date, end.toISOString().slice(0, 10));
    assert.ok(result.status === 'EXACT' || result.status === 'UNKNOWN'); counts[result.status]++;
    if (result.status === 'EXACT' && result.companyId !== e.postedCompany) differences++;
  }
  assert.deepEqual(counts, { EXACT: 670, UNKNOWN: 28 }); assert.equal(differences, 31); assert.deepEqual(events, snapshot);
  const truckCount = await db.truck.count();
  assert.deepEqual(await service.resolveStatementTruck('SYNTHETIC_MISSING_UNIT_211', a, '2026-07-01', '2026-07-08', owner.id), { status: 'UNKNOWN' });
  assert.equal(await db.truck.count(), truckCount);
});
