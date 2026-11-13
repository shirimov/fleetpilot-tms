import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { postgresStore } from '../src/lib/fleet/qm-driver-store.mjs';
import { importDrivers } from '../src/lib/fleet/qm-driver-import.mjs';
import { provisionSourceCompanies } from '../src/lib/fleet/qm-driver-company.mjs';
import { fingerprint } from '../src/lib/fleet/qm-driver-import.mjs';
import { fixture, scope, mapping } from './qm-driver-fixture.mjs';

// Protocol fake only: these exercise the real import/store wiring, not PostgreSQL.
for(const auditFails of [false,true]) test(`real import/store protocol ${auditFails?'rolls back on audit failure':'commits profile and audit together'}`,async()=>{
 const calls=[];let profile=null,binding=null;
 const client={async query(sql,values){
  calls.push({sql,values});
  if(sql.startsWith('SELECT m.')) {
   assert.deepEqual(values,['synthetic-actor',mapping.companyId,scope.operatingGroupId]);
   assert.match(sql,/m.role='OWNER'/);assert.match(sql,/u\."isActive"=true/);
   return {rows:[{companyId:mapping.companyId}]};
  }
  if(sql.startsWith('SELECT id FROM "ArchiveCompany"')) {
   assert.deepEqual(values,[scope.provider,scope.accountKey,mapping.providerCompanyId,mapping.companyId,scope.operatingGroupId,mapping.evidenceReference]);
   return {rows:[{id:mapping.evidenceReference}]};
  }
  if(sql.startsWith('SELECT * FROM "DriverSourceCompanyBinding"')) return {rows:binding?[binding]:[]};
  if(sql.startsWith('INSERT INTO "DriverSourceCompanyBinding"')) binding={id:values[0],provider:values[1],accountKey:values[2],operatingGroupId:values[3],providerCompanyId:values[4],companyId:values[5],archiveCompanyId:values[8],origin:values[7]};
  if(sql.startsWith('SELECT id,"sourceHash"')) return {rows:profile?[profile]:[]};
  if(sql.startsWith('INSERT INTO "DriverSourceProfile"')) {
   assert.equal(values[10],binding.id);assert.notEqual(values[10],mapping.evidenceReference);
   profile={id:values[0],sourceHash:values[7],companyId:values[6],operatingGroupId:values[3]};
  }
  if(sql.startsWith('INSERT INTO "DriverSourceImportEvent"')) {
   assert.equal(values[1],profile.id);assert.equal(values[4],profile.sourceHash);
   if(auditFails)throw new Error('SYNTHETIC_AUDIT_FAILURE');
  }
  return {rows:[]};
 },release(){calls.push({sql:'release'});}};
 const run=importDrivers(postgresStore({async connect(){return client;}}),{rows:[fixture()],scope,mappings:[mapping],actorUserId:'synthetic-actor',evidenceSha256:'a'.repeat(64)});
 if(auditFails) await assert.rejects(run,/SYNTHETIC_AUDIT_FAILURE/);
 else assert.deepEqual(await run,{created:1,unchanged:0});
 assert.equal(calls[0].sql,'BEGIN ISOLATION LEVEL SERIALIZABLE');
 assert.deepEqual(calls.slice(-2).map(call=>call.sql),[auditFails?'ROLLBACK':'COMMIT','release']);
 assert.equal(calls.filter(call=>call.sql.startsWith('INSERT INTO "DriverSourceProfile"')).length,1);
 assert.equal(calls.filter(call=>call.sql.startsWith('INSERT INTO "DriverSourceImportEvent"')).length,1);
});

test('provision service SQL protocol writes only explicit canonical and driver-specific tables',async()=>{
 const calls=[];let binding=null;
 const plan={version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:'a'.repeat(64),mappingSha256:'b'.repeat(64),existingMappings:[],companies:[{providerCompanyId:'synthetic-new-source',companyId:'11111111-1111-4111-8111-111111111111',membershipId:'22222222-2222-4222-8222-222222222222',companyName:'Synthetic New Carrier'}]};
 const client={async query(sql,values){
  calls.push({sql,values});
  if(sql.startsWith('SELECT g.')) {assert.match(sql,/g.role='OWNER'/);assert.match(sql,/u\."isActive"=true/);return {rows:[{operatingGroupId:scope.operatingGroupId}]};}
  if(sql.startsWith('SELECT c.')) {assert.deepEqual(values,[plan.companies[0].companyId,plan.companies[0].companyName,plan.companies[0].membershipId,'synthetic-owner',scope.operatingGroupId]);return {rows:[{id:plan.companies[0].companyId}]};}
  if(sql.startsWith('SELECT * FROM "DriverSourceCompanyBinding"'))return {rows:binding?[binding]:[]};
  if(sql.startsWith('INSERT INTO "DriverSourceCompanyBinding"'))binding={id:values[0],companyId:values[5],planSha256:values[10]};
  return {rows:[]};
 },release(){calls.push({sql:'release'});}};
 const result=await provisionSourceCompanies(postgresStore({connect:async()=>client}),{plan,reviewedPlanSha256:fingerprint(plan),actorUserId:'synthetic-owner',mode:'CREATE'});
 assert.equal(result.created,1);
 const tables=calls.filter(c=>c.sql.startsWith('INSERT')).map(c=>c.sql.match(/INSERT INTO "([^"]+)"/)[1]);
 assert.deepEqual(tables,['Company','CompanyMembership','OperatingGroupCompany','DriverSourceCompanyBinding','DriverSourceCompanyBindingEvent']);
 assert.deepEqual(calls.slice(-2).map(c=>c.sql),['COMMIT','release']);
 assert.ok(calls.some(c=>c.sql.startsWith('SELECT c.')));
});

test('driver-specific binding references work without ArchiveCompany and legacy references stay exact',async()=>{
 const binding={...mapping,id:'driver-binding',archiveCompanyId:null,origin:'PROVISIONED'};
 for(const evidenceReference of ['driver-binding','wrong-reference']) {
  const calls=[];const client={async query(sql,values){calls.push({sql,values});
   if(sql.startsWith('SELECT m.'))return {rows:[{companyId:mapping.companyId}]};
   if(sql.startsWith('SELECT * FROM "DriverSourceCompanyBinding"')) {assert.deepEqual(values,[scope.provider,scope.accountKey,mapping.providerCompanyId]);return {rows:[binding]};}
   return {rows:[]};
  },release(){}};
  const result=await postgresStore({connect:async()=>client}).transaction(tx=>tx.verifyMapping({...mapping,evidenceReference},{actorUserId:'synthetic-actor',evidenceSha256:'a'.repeat(64)}));
  assert.equal(result?.id??null,evidenceReference==='driver-binding'?'driver-binding':null);
  assert.ok(calls.every(c=>!c.sql.includes('ArchiveCompany')&&!c.sql.startsWith('INSERT')));
 }
});
test('existing legacy binding still checks original exact ArchiveCompany evidence',async()=>{
 for(const archiveVerified of [true,false]) for(const evidenceReference of [mapping.evidenceReference,'driver-binding']) {
  const calls=[];const binding={...mapping,id:'driver-binding',archiveCompanyId:mapping.evidenceReference,origin:'ARCHIVE'};
  const client={async query(sql,values){calls.push({sql,values});
   if(sql.startsWith('SELECT m.'))return {rows:[{companyId:mapping.companyId}]};
   if(sql.startsWith('SELECT * FROM "DriverSourceCompanyBinding"'))return {rows:[binding]};
   if(sql.startsWith('SELECT id FROM "ArchiveCompany"')) {
    assert.deepEqual(values,[scope.provider,scope.accountKey,mapping.providerCompanyId,mapping.companyId,scope.operatingGroupId,mapping.evidenceReference]);
    return {rows:archiveVerified?[{id:mapping.evidenceReference}]:[]};
   }
   return {rows:[]};
  },release(){}};
  const result=await postgresStore({connect:async()=>client}).transaction(tx=>tx.verifyMapping({...mapping,evidenceReference},{actorUserId:'synthetic-actor',evidenceSha256:'a'.repeat(64)}));
  assert.equal(result?.id??null,archiveVerified?'driver-binding':null);assert.ok(calls.every(c=>!c.sql.startsWith('INSERT')));
 }
});

test('SQL repository uses serializable transaction and rolls back on failures',async()=>{
 const calls=[];
 const client={async query(sql){calls.push(sql);return {rows:[]};},release(){calls.push('release');}};
 const store=postgresStore({async connect(){return client;}});
 await assert.rejects(store.transaction(async()=>{throw new Error('synthetic');}),/synthetic/);
 assert.deepEqual(calls,['BEGIN ISOLATION LEVEL SERIALIZABLE','SET LOCAL search_path = pg_catalog, public, pg_temp','ROLLBACK','release']);
});
test('post-commit evidence query scopes profile identity and joins original audit without writes',async()=>{
 const calls=[];const identity={...scope,providerCompanyId:mapping.providerCompanyId,providerDriverId:'synthetic-driver'};
 const client={query:async(sql,values)=>{calls.push({sql,values});return {rows:sql.startsWith('SELECT p.')?[{id:'synthetic-profile'}]:[]};},release(){}};
 const result=await postgresStore({connect:async()=>client}).transaction(tx=>tx.readImportEvidence(identity),{readOnly:true});
 assert.deepEqual(result,[{id:'synthetic-profile'}]);
 assert.equal(calls[0].sql,'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
 assert.equal(calls[1].sql,'SET LOCAL search_path = pg_catalog, public, pg_temp');
 assert.match(calls[2].sql,/LEFT JOIN "DriverSourceImportEvent"/);
 assert.doesNotMatch(calls[2].sql,/SELECT \*/);
 assert.deepEqual(calls[2].values,[scope.provider,scope.accountKey,mapping.providerCompanyId,'synthetic-driver']);
 assert.equal(calls[3].sql,'COMMIT');
});

test('migration creates additive unique source identity and immutable evidence only',()=>{
 const sql=readFileSync(new URL('../prisma/migrations/20261002120000_driver_source_profiles/migration.sql',import.meta.url),'utf8');
 assert.match(sql,/UNIQUE \("provider", "accountKey", "providerCompanyId", "providerDriverId"\)/);
 assert.match(sql,/BEFORE UPDATE OR DELETE/);
 assert.match(sql,/driver_source_mapping_guard/);
 assert.match(sql,/CREATE TABLE "DriverSourceCompanyBinding"/);
 assert.match(sql,/"mappingEvidence" TEXT NOT NULL REFERENCES "DriverSourceCompanyBinding"/);
 assert.match(sql,/driver_source_company_binding_immutable/);
 assert.match(sql,/a\."accountKey"=NEW\."accountKey"/);
 assert.doesNotMatch(sql,/ALTER TABLE "Driver"|CREATE TABLE "Financial|UPDATE "Financial|UPDATE "Driver"/);
});
