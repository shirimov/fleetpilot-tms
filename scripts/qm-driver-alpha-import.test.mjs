import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture as driver, scope, mapping } from './qm-driver-fixture.mjs';
import { adaptExport } from '../src/lib/fleet/qm-driver-import.mjs';

const moduleUrl = new URL('../src/lib/fleet/qm-driver-alpha-import.mjs', import.meta.url);
const api = await import(moduleUrl).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
  throw error;
});

function readbackFixture(prepared) {
  const mappings=[mapping,{...scope,providerCompanyId:'synthetic-new',companyId:'11111111-1111-4111-8111-111111111111',evidenceReference:'new-binding'}];
  const records=adaptExport(prepared.rows).map((row,index)=>{
    const m=mappings.find(m=>m.providerCompanyId===row.source.company_id);
    return {id:`profile-${index}`,...scope,providerCompanyId:row.source.company_id,providerDriverId:row.source.qm_driver_id,companyId:m.companyId,mappingEvidence:m.evidenceReference,source:row.source,sourceHash:row.sourceHash,evidenceSha256:prepared.evidenceSha256,actorUserId:'synthetic-owner',firstName:row.source.name.first_name,middleName:row.source.name.middle_name,lastName:row.source.name.last_name,fullName:row.source.full_name,lifecycleStatus:row.source.status,hireDateRaw:row.source.hire_date,terminationDateRaw:row.source.terminated_at,rehireDateRaw:row.source.rehired_at,compensationType:row.compensationType,compensationAmount:row.compensationAmount,auditId:`event-${index}`,auditActor:'synthetic-owner',auditEvidence:prepared.evidenceSha256,auditSourceHash:row.sourceHash};
  });
  const calls=[];
  const tx={authorizeGroup:async()=>true,authorize:async()=>true,verifyArchiveMapping:async()=>true,
    findBinding:async m=>({...m,id:mappings.find(x=>x.providerCompanyId===m.providerCompanyId).evidenceReference,origin:m.providerCompanyId===mapping.providerCompanyId?'ARCHIVE':'PROVISIONED',archiveCompanyId:m.providerCompanyId===mapping.providerCompanyId?mapping.evidenceReference:null}),
    readImportEvidence:async i=>records.filter(r=>r.providerCompanyId===i.providerCompanyId&&r.providerDriverId===i.providerDriverId)};
  const store={transaction:async (run,options)=>{calls.push(options);return run(tx);}};
  return {mappings,records,calls,store};
}

test('fresh post-commit readback compares source, displayed fields, identity, mapping and audit',async()=>{
  assert.equal(typeof api.verifyCommittedImport,'function','fresh readback missing');
  const prepared=api.prepareAlphaImport(inputFixture()), f=readbackFixture(prepared);
  const result=await api.verifyCommittedImport(f.store,prepared,f.mappings);
  assert.deepEqual(result,{verifiedDrivers:2,verification:'POST_COMMIT_READ_ONLY'});
  assert.deepEqual(f.calls,[{readOnly:true}]);
  for(const field of ['id','provider','accountKey','operatingGroupId','providerCompanyId','providerDriverId','companyId','mappingEvidence','actorUserId','evidenceSha256','sourceHash','firstName','middleName','lastName','fullName','lifecycleStatus','hireDateRaw','terminationDateRaw','rehireDateRaw','compensationType','compensationAmount','auditId','auditActor','auditEvidence','auditSourceHash']) {
    const f=readbackFixture(prepared); f.records[0][field]=typeof f.records[0][field]==='string'?null:'synthetic-mismatch';
    await assert.rejects(api.verifyCommittedImport(f.store,prepared,f.mappings),/POST_COMMIT_DRIVER_READBACK_FAILED/);
  }
  const changedSource=readbackFixture(prepared);changedSource.records[0].source.phone='synthetic-changed';
  await assert.rejects(api.verifyCommittedImport(changedSource.store,prepared,changedSource.mappings),/POST_COMMIT_DRIVER_READBACK_FAILED/);
  const duplicate=readbackFixture(prepared);duplicate.records.push({...duplicate.records[0],auditId:'extra-audit'});
  await assert.rejects(api.verifyCommittedImport(duplicate.store,prepared,duplicate.mappings),/POST_COMMIT_DRIVER_READBACK_FAILED/);
});

const bytes = value => Buffer.from(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
function inputFixture() {
  const rows=[driver(), {...driver(),company_id:'synthetic-new',qm_driver_id:'new-driver',list_company:{carrier_id:'synthetic-new',carrier_name:'Synthetic Company'}}];
  const exportBytes=bytes(rows);
  const plan={version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:digest(exportBytes),mappingSha256:'b'.repeat(64),existingMappings:[mapping],companies:[{providerCompanyId:'synthetic-new',companyId:'11111111-1111-4111-8111-111111111111',membershipId:'22222222-2222-4222-8222-222222222222',companyName:'Synthetic Company'}]};
  const planBytes=bytes(plan), actorUserId='synthetic-owner';
  const receipt={version:1,kind:'COMPANY_CREATION_RECEIPT',applied:true,verified:true,created:1,existing:0,ownerUserId:actorUserId,companies:plan.companies.map(({providerCompanyId,companyId,membershipId})=>({providerCompanyId,companyId,membershipId})),wouldCreate:0,verification:'POST_COMMIT_READ_ONLY',planSha256:digest(planBytes),evidenceSha256:plan.evidenceSha256,mappingSha256:plan.mappingSha256,scope};
  const receiptBytes=bytes(receipt);
  return {exportBytes,planBytes,receiptBytes,review:{actorUserId,reviewedPlanSha256:digest(planBytes),reviewedReceiptSha256:digest(receiptBytes)}};
}

test('fresh readback rechecks revoked group, company and archive authority before reading driver evidence',async()=>{
 for(const denied of ['authorizeGroup','authorize','verifyArchiveMapping']) {
  const prepared=api.prepareAlphaImport(inputFixture()),f=readbackFixture(prepared),transaction=f.store.transaction.bind(f.store);
  let reads=0,checks=0;
  f.store.transaction=(run,options)=>transaction(tx=>run({...tx,
   [denied]:async()=>{checks++;return false;},
   readImportEvidence:async()=>{reads++;return [];}
  }),options);
  const before=structuredClone(f.records);
  await assert.rejects(api.verifyCommittedImport(f.store,prepared,f.mappings),{message:'POST_COMMIT_DRIVER_READBACK_FAILED'});
  assert.equal(checks,1);assert.equal(reads,0);assert.deepEqual(f.calls,[{readOnly:true}]);assert.deepEqual(f.records,before);
 }
});

test('fresh readback refuses missing audit without rewriting source or synthesizing replacement evidence',async()=>{
 const prepared=api.prepareAlphaImport(inputFixture()),f=readbackFixture(prepared);
 f.records[0].auditId=null;const before=structuredClone(f.records);
 await assert.rejects(api.verifyCommittedImport(f.store,prepared,f.mappings),{message:'POST_COMMIT_DRIVER_READBACK_FAILED'});
 assert.deepEqual(f.records,before);assert.deepEqual(f.calls,[{readOnly:true}]);
});

test('release input binds original export bytes to the reviewed creation receipt before DB access', () => {
  assert.equal(typeof api.prepareAlphaImport, 'function', 'release input preparation missing');
  const input=inputFixture(), result=api.prepareAlphaImport(input);
  assert.deepEqual(result.summary,{sourceRows:2,uniqueDrivers:2,companiesToBind:1,existingMappings:1});
  assert.equal(result.bindingInput.mode,'BIND_PROVISIONED');
  for(const field of ['exportBytes','planBytes','receiptBytes']) {
    assert.throws(()=>api.prepareAlphaImport({...input,[field]:Buffer.concat([input[field],Buffer.from(' ')])}));
  }
  assert.throws(()=>api.prepareAlphaImport({...input,review:{...input.review,extra:'not allowed'}}));
});


function protocolPool({readbackFailure=false,migrationMismatch=false}={}) {
  const calls=[],bindings=new Map(),profiles=new Map(),events=[];
  let readOnly=false;
  const fields=['id','provider','accountKey','operatingGroupId','providerCompanyId','providerDriverId','companyId','sourceHash','evidenceSha256','actorUserId','mappingEvidence','firstName','middleName','lastName','fullName','lifecycleStatus','hireDateRaw','terminationDateRaw','rehireDateRaw','compensationType','compensationAmount','source'];
  const client={release(){},async query(sql,v=[]) {
    calls.push(sql);
    if(sql.startsWith('BEGIN')) readOnly=sql.includes('READ ONLY');
    if(sql.includes('current_database()')) return {rows:[{database:'fleetpilot_staging',username:'fleetpilot'}]};
    if(sql.includes('FROM "_prisma_migrations"')) return {rows:[{migration_name:'20261002120000_driver_source_profiles',checksum:(migrationMismatch?'b':'a').repeat(64),finished_at:'2026-10-04',rolled_back_at:null}]};
    if(sql.startsWith('SELECT g.')||sql.startsWith('SELECT m.')||sql.startsWith('SELECT c.')) return {rows:[{id:'authorized'}]};
    if(sql.startsWith('SELECT id FROM "ArchiveCompany"')) return {rows:v.length===6?[{id:mapping.evidenceReference}]:[]};
    if(sql.startsWith('SELECT * FROM "DriverSourceCompanyBinding"')) return {rows:bindings.has(v[2])?[bindings.get(v[2])]:[]};
    if(sql.startsWith('INSERT INTO "DriverSourceCompanyBinding"')) bindings.set(v[4],{id:v[0],provider:v[1],accountKey:v[2],operatingGroupId:v[3],providerCompanyId:v[4],companyId:v[5],sourceCompanyName:v[6],origin:v[7],archiveCompanyId:v[8],evidenceSha256:v[9],planSha256:v[10],actorUserId:v[11]});
    if(sql.startsWith('INSERT INTO "DriverSourceProfile"')) {const record=Object.fromEntries(fields.map((f,i)=>[f,f==='source'?JSON.parse(v[i]):v[i]]));profiles.set(JSON.stringify([record.providerCompanyId,record.providerDriverId]),record);}
    if(sql.startsWith('INSERT INTO "DriverSourceImportEvent"')) events.push({auditId:v[0],profileId:v[1],auditActor:v[2],auditEvidence:v[3],auditSourceHash:v[4]});
    if(sql.startsWith('SELECT id,"sourceHash"')) {const p=profiles.get(JSON.stringify([v[2],v[3]]));return {rows:p?[p]:[]};}
    if(sql.startsWith('SELECT p.')) {const p=profiles.get(JSON.stringify([v[2],v[3]]));return {rows:readbackFailure&&readOnly?[]:p?events.filter(e=>e.profileId===p.id).map(e=>({...p,...e})):[]};}
    return {rows:[]};
  }};
  return {connect:async()=>client,calls,profiles,events};
}

test('real service orchestration binds, imports, fresh-reads and replays without duplicate writes (synthetic SQL protocol)',async()=>{
  assert.equal(typeof api.applyAlphaImport,'function');
  const pool=protocolPool(),input=inputFixture(),migrations=[{name:'20261002120000_driver_source_profiles',checksum:'a'.repeat(64)}];
  const result=await api.applyAlphaImport(pool,input,migrations);
  assert.equal(result.verified,true);assert.equal(result.drivers.created,2);assert.equal(result.readback.verifiedDrivers,2);
  const replay=await api.applyAlphaImport(pool,input,migrations);
  assert.equal(replay.drivers.created,0);assert.equal(replay.drivers.unchanged,2);assert.equal(pool.events.length,2);
  const tables=pool.calls.filter(s=>s.startsWith('INSERT')).map(s=>s.match(/INSERT INTO "([^"]+)"/)[1]);
  assert.ok(tables.every(t=>['DriverSourceProfile','DriverSourceImportEvent','DriverSourceCompanyBinding','DriverSourceCompanyBindingEvent'].includes(t)));
});

test('migration drift stops before writes and failed fresh readback never triggers automatic apply retry',async()=>{
  const migration=[{name:'20261002120000_driver_source_profiles',checksum:'a'.repeat(64)}];
  const drift=protocolPool({migrationMismatch:true});
  await assert.rejects(api.applyAlphaImport(drift,inputFixture(),migration),/ALPHA_MIGRATION_IDENTITY_MISMATCH/);
  assert.equal(drift.profiles.size,0);
  const failed=protocolPool({readbackFailure:true});
  await assert.rejects(api.applyAlphaImport(failed,inputFixture(),migration),/POST_COMMIT_DRIVER_READBACK_FAILED/);
  assert.equal(failed.events.length,2);
});

test('post-commit readback failure leaves one attempted import and original source/audit evidence (synthetic SQL protocol)',async()=>{
 const pool=protocolPool({readbackFailure:true}),input=inputFixture(),stages=[];
 const migration=[{name:'20261002120000_driver_source_profiles',checksum:'a'.repeat(64)}];
 await assert.rejects(api.applyAlphaImport(pool,input,migration,stage=>stages.push(stage)),{message:'POST_COMMIT_DRIVER_READBACK_FAILED'});
 assert.deepEqual(stages,['binding-apply-attempted','binding-verified','driver-commit-returned']);
 assert.equal(pool.calls.filter(sql=>sql==='BEGIN ISOLATION LEVEL SERIALIZABLE').length,2,'one binding and one driver transaction; no automatic retry');
 assert.equal(pool.calls.filter(sql=>sql.startsWith('INSERT INTO "DriverSourceProfile"')).length,2);
 assert.equal(pool.calls.filter(sql=>sql.startsWith('INSERT INTO "DriverSourceImportEvent"')).length,2);
 assert.equal(pool.calls.at(-1),'ROLLBACK');
 const expected=adaptExport(JSON.parse(input.exportBytes));
 assert.equal(pool.profiles.size,2);assert.equal(pool.events.length,2);
 for(const row of expected) {
  const profile=pool.profiles.get(JSON.stringify([row.source.company_id,row.source.qm_driver_id]));
  assert.deepEqual(profile.source,row.source);assert.equal(profile.sourceHash,row.sourceHash);
  assert.equal(profile.actorUserId,input.review.actorUserId);assert.equal(profile.evidenceSha256,digest(input.exportBytes));
  const audits=pool.events.filter(event=>event.profileId===profile.id);
  assert.equal(audits.length,1);assert.equal(audits[0].auditSourceHash,row.sourceHash);
  assert.equal(audits[0].auditActor,input.review.actorUserId);assert.equal(audits[0].auditEvidence,profile.evidenceSha256);
 }
});

test('each database transaction pins search_path before application-table access',async()=>{
  const pool=protocolPool();
  await api.applyAlphaImport(pool,inputFixture(),[{name:'20261002120000_driver_source_profiles',checksum:'a'.repeat(64)}]);
  for(let i=0;i<pool.calls.length;i++) if(pool.calls[i].startsWith('BEGIN')) {
    assert.equal(pool.calls[i+1],'SET LOCAL search_path = pg_catalog, public, pg_temp');
  }
});

test('known incompatible historical provenance blocks driver commit instead of failing after new rows commit',async()=>{
  const pool=protocolPool(),input=inputFixture(),migration=[{name:'20261002120000_driver_source_profiles',checksum:'a'.repeat(64)}];
  await api.applyAlphaImport(pool,input,migration);
  const [first,second]=[...pool.profiles.values()];
  first.actorUserId='other-historical-owner';pool.events.find(e=>e.profileId===first.id).auditActor='other-historical-owner';
  pool.profiles.delete(JSON.stringify([second.providerCompanyId,second.providerDriverId]));
  pool.events.splice(pool.events.findIndex(e=>e.profileId===second.id),1);
  const stages=[];
  await assert.rejects(api.applyAlphaImport(pool,input,migration,stage=>stages.push(stage)),/POST_COMMIT_DRIVER_READBACK_FAILED/);
  assert.ok(!stages.includes('driver-commit-returned'),'incompatible prior provenance must be rejected before driver COMMIT');
  assert.equal(pool.calls.at(-1),'ROLLBACK');
});

test('exact observed database and role pass identity before the synthetic ledger boundary',async()=>{
  const calls=[];
  const pool={connect:async()=>({query:async(sql)=>{calls.push(sql);return {rows:sql.includes('current_database()')?[{database:'fleetpilot_staging',username:'fleetpilot'}]:[]};},release(){}})};
  await assert.rejects(api.applyAlphaImport(pool,inputFixture(),[{name:'synthetic_migration',checksum:'a'.repeat(64)}]),/ALPHA_MIGRATION_IDENTITY_MISMATCH/);
  assert.ok(calls.some(sql=>sql.includes('FROM "_prisma_migrations"')));
  assert.equal(calls.at(-1),'ROLLBACK');
});

test('wrong database or role is refused before ledger and writing transactions (synthetic)',async()=>{
  for(const [database,username] of [['fleetpilot','fleetpilot'],['other','fleetpilot'],['fleetpilot_staging','other'],['fleetpilot_staging','fleetpilot_staging']]) {
    const calls=[];
    const pool={connect:async()=>({query:async(sql)=>{calls.push(sql);return {rows:sql.includes('current_database()')?[{database,username}]:[]};},release(){}})};
    await assert.rejects(api.applyAlphaImport(pool,inputFixture(),[{name:'synthetic_migration',checksum:'a'.repeat(64)}]),/ALPHA_DATABASE_IDENTITY_MISMATCH/);
    assert.ok(!calls.some(sql=>sql.includes('FROM "_prisma_migrations"')||sql.startsWith('INSERT')||sql==='BEGIN ISOLATION LEVEL SERIALIZABLE'));
    assert.equal(calls.at(-1),'ROLLBACK');
  }
});

test('operator import checks database and migration identity before entering a writing transaction',async()=>{
  assert.equal(typeof api.applyAlphaImport,'function','operator orchestration missing');
  const calls=[];
  const pool={connect:async()=>({query:async(sql)=>{calls.push(sql);return {rows:sql.includes('current_database()')?[{database:'wrong',username:'fleetpilot'}]:[]};},release(){}})};
  await assert.rejects(api.applyAlphaImport(pool,inputFixture(),[{name:'synthetic_migration',checksum:'a'.repeat(64)}]),/ALPHA_DATABASE_IDENTITY_MISMATCH/);
  assert.ok(calls.every(sql=>!sql.startsWith('INSERT') && sql!=='BEGIN ISOLATION LEVEL SERIALIZABLE'));
});

test('Alpha import requires the fixed Compose database endpoint without override options', () => {
  assert.equal(typeof api.validateAlphaDatabase, 'function', 'Alpha target validator missing');
  // All URLs and SQL responses here are synthetic; no target connection is made.
  for (const url of ['postgresql://fleetpilot:***@db:5432/fleetpilot_staging?schema=public', 'postgres://fleetpilot:***@db/fleetpilot_staging']) {
    assert.doesNotThrow(() => api.validateAlphaDatabase(url));
  }
  for (const url of ['postgresql://fleetpilot:***@localhost/fleetpilot_staging', 'postgresql://fleetpilot:***@other/fleetpilot_staging', 'postgresql://other:***@db/fleetpilot_staging', 'postgresql://fleetpilot:***@db/other', 'postgresql://fleetpilot:***@db/fleetpilot', 'postgresql://fleetpilot:***@db:5433/fleetpilot_staging', 'postgresql://fleetpilot:***@db/fleetpilot_staging?options=-csearch_path%3Dother', 'postgresql://fleetpilot:***@db/fleetpilot_staging?schema=public&schema=other', 'postgresql://fleetpilot:***@db/fleetpilot_staging#x', 'postgresql://fleetpilot:***@db/fleetpilot%5fstaging']) {
    assert.throws(() => api.validateAlphaDatabase(url), /ALPHA_DATABASE_TARGET_REQUIRED/);
  }
});
