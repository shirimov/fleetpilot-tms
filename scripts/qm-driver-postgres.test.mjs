import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import { Pool } from 'pg';
import { postgresStore } from '../src/lib/fleet/qm-driver-store.mjs';
import { provisionSourceCompanies } from '../src/lib/fleet/qm-driver-company.mjs';
import { importDrivers, fingerprint } from '../src/lib/fleet/qm-driver-import.mjs';
import { fixture } from './qm-driver-fixture.mjs';

// Explicit opt-in. No migration/reset/cleanup shortcuts. Synthetic immutable
// evidence remains in the approved disposable DB, never a shared/live target.
const connection = process.env.DRIVER_IMPORT_DATABASE_URL;
test('PostgreSQL driver acceptance: committed readback, replay, rollback and guards', { skip: !connection }, async t => {
 const url = new URL(connection);
 assert.equal(url.hostname, '127.0.0.1');
 assert.ok(Number(url.port) >= 49152 && Number(url.port) <= 65535, 'explicit private high port required');
 assert.match(url.pathname, /^\/fleetpilot_driver_import_test_[a-z0-9_]+$/);
 assert.equal(url.search, '');
 assert.equal(url.hash, '');
 const pool = new Pool({connectionString:connection,max:3,connectionTimeoutMillis:5000,statement_timeout:15000});
 try {
  const target = (await pool.query('SELECT current_database() AS name')).rows[0];
  assert.equal(target.name, url.pathname.slice(1));
  const migration = await pool.query('SELECT migration_name FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', ['20261002120000_driver_source_profiles']);
  assert.equal(migration.rows.length, 1);
  const actorUserId = randomUUID(), group = randomUUID();
  await pool.query('INSERT INTO "User" (id,email,"displayName","updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)', [actorUserId,`${actorUserId}@example.test`,'Synthetic driver acceptance']);
  await pool.query('INSERT INTO "OperatingGroup" (id,name,"updatedAt") VALUES ($1,$2,CURRENT_TIMESTAMP)', [group,`Synthetic driver ${group}`]);
  await pool.query('INSERT INTO "OperatingGroupMembership" ("operatingGroupId","userId",role,"updatedAt") VALUES ($1,$2,\'OWNER\',CURRENT_TIMESTAMP)', [group,actorUserId]);
  const scope = {provider:'QUICKMANAGE',accountKey:`synthetic-${randomUUID()}`,operatingGroupId:group};
  const plan = {version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:'a'.repeat(64),mappingSha256:'b'.repeat(64),existingMappings:[],companies:[{providerCompanyId:'synthetic-source',companyId:randomUUID(),membershipId:randomUUID(),companyName:`Synthetic driver carrier ${randomUUID()}`}]};
  const store = postgresStore(pool);
  const provision = await provisionSourceCompanies(store,{plan,reviewedPlanSha256:fingerprint(plan),actorUserId,mode:'CREATE'});
  const row = fixture(); row.company_id='synthetic-source'; row.qm_driver_id=randomUUID();
  const input = {rows:[row],scope,mappings:provision.mappings,actorUserId,evidenceSha256:plan.evidenceSha256};
  const counts = async () => (await pool.query('SELECT (SELECT count(*)::int FROM "DriverSourceProfile" WHERE "accountKey"=$1) AS profiles,(SELECT count(*)::int FROM "DriverSourceImportEvent" e JOIN "DriverSourceProfile" p ON p.id=e."profileId" WHERE p."accountKey"=$1) AS events',[scope.accountKey])).rows[0];
  let profile;
  await t.test('real commit preserves exact source and audit; replay adds nothing', async () => {
   assert.deepEqual(await importDrivers(store,input),{created:1,unchanged:0});
   // New pool query, after the writing transaction has released its connection.
   profile=(await pool.query('SELECT * FROM "DriverSourceProfile" WHERE "accountKey"=$1',[scope.accountKey])).rows[0];
   assert.deepEqual(profile.source,row);
   assert.equal(profile.companyId,plan.companies[0].companyId);
   assert.equal(profile.driverId,null);
   assert.equal(profile.sourceHash,fingerprint(row));
   assert.deepEqual(await counts(),{profiles:1,events:1});
   assert.deepEqual(await importDrivers(store,input),{created:0,unchanged:1});
   assert.deepEqual(await counts(),{profiles:1,events:1});
  });
  await t.test('conflict rolls back a preceding fresh profile and its audit', async () => {
   const fresh=structuredClone(row);fresh.qm_driver_id=randomUUID();
   const changed=structuredClone(row);changed.phone='synthetic changed';
   await assert.rejects(importDrivers(store,{...input,rows:[fresh,changed]}),/SOURCE_CONFLICT/);
   assert.deepEqual(await counts(),{profiles:1,events:1});
  });
  await t.test('precommit verifier sees pending exact source and audit; rejection rolls both back', async () => {
   const fresh=structuredClone(row);fresh.qm_driver_id=randomUUID();
   let called=0;
   await assert.rejects(importDrivers(store,{...input,rows:[fresh]}, {verifyBeforeCommit:async tx=>{
    called++;
    const evidence=await tx.readImportEvidence({...scope,providerCompanyId:fresh.company_id,providerDriverId:fresh.qm_driver_id});
    assert.equal(evidence.length,1);
    assert.deepEqual(evidence[0].source,fresh);
    assert.equal(evidence[0].auditActor,actorUserId);
    assert.equal(evidence[0].auditSourceHash,fingerprint(fresh));
    throw new Error('SYNTHETIC_PRECOMMIT_REJECTION');
   }}),/SYNTHETIC_PRECOMMIT_REJECTION/);
   assert.equal(called,1);
   assert.deepEqual(await counts(),{profiles:1,events:1});
   const evidence=await store.transaction(tx=>tx.readImportEvidence({...scope,providerCompanyId:fresh.company_id,providerDriverId:fresh.qm_driver_id}),{readOnly:true});
   assert.deepEqual(evidence,[]);
  });
  await t.test('store pins schema ahead of temporary shadows and restores session path', async () => {
   const client=await pool.connect();
   try {
    await client.query('SET search_path = pg_temp, public');
    await client.query('CREATE TEMP TABLE "DriverSourceProfile" (LIKE public."DriverSourceProfile" INCLUDING DEFAULTS)');
    const pinned=postgresStore({connect:async()=>({query:client.query.bind(client),release(){}})});
    for(const readOnly of [false,true]) {
     const evidence=await pinned.transaction(tx=>tx.readImportEvidence({...scope,providerCompanyId:row.company_id,providerDriverId:row.qm_driver_id}),{readOnly});
     assert.equal(evidence.length,1);
     assert.deepEqual(evidence[0].source,row);
    }
    assert.equal((await client.query('SHOW search_path')).rows[0].search_path,'pg_temp, public');
   } finally {
    await client.query('DROP TABLE IF EXISTS pg_temp."DriverSourceProfile"');
    await client.query('RESET search_path');
    client.release();
   }
  });
  await t.test('unauthorized actor cannot write', async () => {
   await assert.rejects(importDrivers(store,{...input,actorUserId:randomUUID()}),/IMPORT_SCOPE_DENIED/);
   assert.deepEqual(await counts(),{profiles:1,events:1});
  });
  await t.test('database rejects modifying evidence and mismatched mapping scope', async () => {
   await assert.rejects(pool.query('UPDATE "DriverSourceProfile" SET "firstName"=$1 WHERE id=$2',['changed',profile.id]),/Driver source evidence is immutable/);
   await assert.rejects(pool.query('DELETE FROM "DriverSourceImportEvent" WHERE "profileId"=$1',[profile.id]),/Driver source evidence is immutable/);
   await assert.rejects(pool.query('INSERT INTO "DriverSourceProfile" (id,provider,"accountKey","operatingGroupId","providerCompanyId","providerDriverId","companyId","compensationType",source,"sourceHash","evidenceSha256","mappingEvidence","actorUserId") SELECT $1,provider,$2,"operatingGroupId","providerCompanyId",$3,"companyId","compensationType",source,"sourceHash","evidenceSha256","mappingEvidence","actorUserId" FROM "DriverSourceProfile" WHERE id=$4',[randomUUID(),'wrong-synthetic-account',randomUUID(),profile.id]),/Driver source mapping scope mismatch/);
   assert.deepEqual(await counts(),{profiles:1,events:1});
  });
  await t.test('real list/detail SQL isolates company and excludes source payload', async () => {
   const { PrismaClient } = await import('@prisma/client');
   const { PrismaPg } = await import('@prisma/adapter-pg');
   const { DriverPoolService } = await import('../src/lib/fleet/driver-pool-service.ts');
   const database = new PrismaClient({adapter:new PrismaPg({connectionString:connection})});
   try {
    const service=new DriverPoolService(database);
    const context={companyId:plan.companies[0].companyId,role:'OWNER',user:{id:actorUserId}};
    const list=await service.list(context,{page:1});
    assert.equal(list.drivers.length,1);
    assert.equal(list.drivers[0].id,`source:${profile.id}`);
    assert.equal(Object.hasOwn(list.drivers[0],'source'),false);
    assert.equal(Object.hasOwn(list.drivers[0],'email'),false);
    assert.equal(Object.hasOwn(list.drivers[0],'compensation'),false);
    const detail=await service.detail(context,`source:${profile.id}`);
    assert.equal(detail.employmentStatus,'active');
    assert.equal(detail.compensation.amount,null);
    assert.equal(Object.hasOwn(detail,'source'),false);
    const foreign={...context,companyId:randomUUID()};
    assert.deepEqual((await service.list(foreign,{page:1})).drivers,[]);
    await assert.rejects(service.detail(foreign,`source:${profile.id}`),/Not found/);
    await assert.rejects(service.detail({...context,role:'MEMBER'},`source:${profile.id}`));
   } finally {await database.$disconnect();}
  });
  await t.test('concurrent duplicate imports leave exactly one profile and audit', async () => {
   const next=structuredClone(row);next.qm_driver_id=randomUUID();
   const results=await Promise.allSettled([importDrivers(store,{...input,rows:[next]}),importDrivers(store,{...input,rows:[next]})]);
   assert.ok(results.some(r=>r.status==='fulfilled'));
   for(const result of results) if(result.status==='rejected') assert.ok(['40001','23505'].includes(result.reason.code),String(result.reason));
   assert.deepEqual(await counts(),{profiles:2,events:2});
   assert.deepEqual(await importDrivers(store,{...input,rows:[next]}),{created:0,unchanged:1});
  });
  await t.test('private import CLI commits and replays with fresh SQL verification', async () => {
   const directory=mkdtempSync(join(tmpdir(),'driver-postgres-cli-'));
   try {
    const next=structuredClone(row);next.qm_driver_id=randomUUID();
    const inputPath=join(directory,'input.json'),configPath=join(directory,'config.json');
    writeFileSync(inputPath,JSON.stringify([next]),{mode:0o600});
    writeFileSync(configPath,JSON.stringify({scope,mappings:provision.mappings,actorUserId}),{mode:0o600});
    for(const replay of [false,true]) {
     const output=join(directory,replay?'replay.json':'apply.json');
     const result=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',inputPath,'--config',configPath,'--output',output,'--apply-local'],{encoding:'utf8',timeout:20000,env:{...process.env,DRIVER_IMPORT_DATABASE_URL:connection}});
     assert.equal(result.error,undefined);
     assert.equal(result.status,0,result.stderr);
     assert.equal(statSync(output).mode&0o777,0o600);
     assert.deepEqual(JSON.parse(readFileSync(output,'utf8')).result,replay?{created:0,unchanged:1}:{created:1,unchanged:0});
     assert.doesNotMatch(result.stdout+result.stderr,/Synthetic Test|synthetic.invalid/);
     const saved=await pool.query('SELECT source FROM "DriverSourceProfile" WHERE "accountKey"=$1 AND "providerDriverId"=$2',[scope.accountKey,next.qm_driver_id]);
     assert.equal(saved.rows.length,1);assert.deepEqual(saved.rows[0].source,next);
     assert.deepEqual(await counts(),{profiles:3,events:3});
    }
   }finally{rmSync(directory,{recursive:true,force:true});}
  });
 } finally {await pool.end();}
});
