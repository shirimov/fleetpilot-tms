import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptExport, planImport, importDrivers } from '../src/lib/fleet/qm-driver-import.mjs';

import {fixture,scope,mapping} from './qm-driver-fixture.mjs';
test('approved export is preserved without fabricated pay or names; missing mappings block',()=>{
 const row=fixture(); const adapted=adaptExport([row]);
 assert.deepEqual(adapted[0].source,row);
 assert.equal(adapted[0].compensationType,'UNKNOWN');
 assert.equal(adapted[0].compensationAmount,null);
 const plan=planImport(adapted,scope,[]);
 assert.equal(plan.ready.length,0); assert.deepEqual(plan.mappingGaps,['source-company']);
 assert.equal(planImport(adapted,scope,[mapping]).ready.length,1);
});

function memoryStore() {
 const state=new Map(); let audits=0;
 return {state,get audits(){return audits;},async transaction(run) {
  const draft=new Map(state); let pending=0;
  const result=await run({async authorize(){return true;},async verifyMapping(){return {id:'synthetic-driver-binding'};},async find(identity){return draft.get(identity.providerDriverId) ?? null;},async insert(row){draft.set(row.providerDriverId,row);},async audit(){pending++;}});
  state.clear(); for(const [key,value] of draft) state.set(key,value); audits+=pending; return result;
 }};
}
const request=()=>({rows:[fixture()],scope,mappings:[mapping],actorUserId:'synthetic-actor',evidenceSha256:'a'.repeat(64)});
test('transaction imports durable source profile, readback verifies, replay is idempotent',async()=>{
 const store=memoryStore(); const input=request();
 assert.deepEqual(await importDrivers(store,input),{created:1,unchanged:0});
 assert.equal(store.state.size,1); assert.equal(store.audits,1);
 assert.equal([...store.state.values()][0].mappingEvidence,'synthetic-driver-binding');
 assert.equal([...store.state.values()][0].compensationAmount,null);
 assert.deepEqual(await importDrivers(store,input),{created:0,unchanged:1});
 assert.equal(store.audits,1);
});
test('caller mutation during authorization cannot change validated import scope or mapping',async()=>{
 const store=memoryStore();
 const input=structuredClone(request());
 const original=structuredClone(input);
 const transaction=store.transaction.bind(store);
 store.transaction=run=>transaction(tx=>run({...tx,async authorize(){
  input.scope.accountKey='changed-account';
  input.scope.operatingGroupId='changed-group';
  input.mappings[0].companyId='changed-company';
  return true;
 }}));
 await importDrivers(store,input);
 const saved=[...store.state.values()][0];
 assert.equal(saved.accountKey,original.scope.accountKey);
 assert.equal(saved.operatingGroupId,original.scope.operatingGroupId);
 assert.equal(saved.companyId,original.mappings[0].companyId);
});

test('changed source identity conflicts and transaction rolls back entire batch',async()=>{
 const store=memoryStore(); await importDrivers(store,request());
 const changed=fixture(); changed.phone='synthetic-change'; const fresh=fixture(); fresh.qm_driver_id='second';
 await assert.rejects(importDrivers(store,{...request(),rows:[fresh,changed]}),/SOURCE_CONFLICT/);
 assert.equal(store.state.size,1); assert.equal(store.audits,1);
 assert.equal([...store.state.values()][0].mappingEvidence,'synthetic-driver-binding');
});

test('source IDs are scoped by company, account mappings cannot cross scopes',()=>{
 const second=fixture();second.company_id='other-company';
 const plan=planImport(adaptExport([fixture(),second]),scope,[mapping]);
 assert.equal(plan.summary.uniqueDrivers,2);assert.deepEqual(plan.mappingGaps,['other-company']);
 assert.throws(()=>planImport(adaptExport([fixture()]),scope,[{...mapping,accountKey:'wrong-account'}]),/MAPPING_SCOPE_MISMATCH/);
});
test('reject unapproved PII and conflicting duplicate source snapshots',()=>{
 assert.throws(()=>adaptExport([{...fixture(),ssn:'synthetic-secret'}]),/UNAPPROVED/);
 const altered=fixture();altered.hire_date='synthetic-date';
 assert.throws(()=>planImport(adaptExport([fixture(),altered]),scope,[mapping]),/CONFLICTING_SOURCE_IDENTITY/);
});
test('unknown names and lifecycle dates remain absent, known zero is not used for absent pay',()=>{
 const source=fixture();source.name={first_name:null,middle_name:null,last_name:null};source.full_name=null;
 const row=adaptExport([source])[0];assert.equal(row.source.name.first_name,null);assert.equal(row.compensationAmount,null);
 source.compensation.source_contract={type:'PC',rate:0};
 assert.equal(adaptExport([source])[0].compensationAmount,'0');
});
test('authorization and mapping rechecks happen before any writes',async()=>{
 for(const fail of ['authorize','verifyMapping']) {
  let writes=0;
  const store={transaction:async run=>run({authorize:async()=>fail!=='authorize',verifyMapping:async()=>fail!=='verifyMapping',insert:async()=>{writes++;}})};
  await assert.rejects(importDrivers(store,request()),/IMPORT_SCOPE_DENIED|COMPANY_MAPPING_NOT_VERIFIED/);assert.equal(writes,0);
 }
});


test('precommit verifier is invoked and awaited after audit, before transaction publication',async()=>{
 const store=memoryStore();let calls=0;
 await assert.rejects(importDrivers(store,request(),{verifyBeforeCommit:async tx=>{
  calls++;
  assert.equal(store.state.size,0);
  assert.equal(store.audits,0);
  assert.ok(await tx.find({providerDriverId:fixture().qm_driver_id}));
  await Promise.resolve();
  throw new Error('SYNTHETIC_VERIFY_FAILED');
 }}),/SYNTHETIC_VERIFY_FAILED/);
 assert.equal(calls,1);assert.equal(store.state.size,0);assert.equal(store.audits,0);
});
test('invalid commit verifier fails before opening transaction',async()=>{
 let calls=0;
 await assert.rejects(importDrivers({transaction:async()=>{calls++;}},request(),{verifyBeforeCommit:true}),/INVALID_COMMIT_VERIFIER/);
 assert.equal(calls,0);
});

test('later denied company blocks the whole batch before any profile or audit operation',async()=>{
 const second={...mapping,providerCompanyId:'second-source-company',companyId:'second-canonical-company'};
 const calls=[];
 const store={transaction:async run=>run({
  authorize:async(_actor,m)=>{calls.push(`authorize:${m.companyId}`);return m.companyId!==second.companyId;},
  verifyMapping:async m=>{calls.push(`mapping:${m.companyId}`);return {id:'synthetic-binding'};},
  find:async()=>{calls.push('find');return null;},
  insert:async()=>{calls.push('insert');},audit:async()=>{calls.push('audit');}
 })};
 await assert.rejects(importDrivers(store,{...request(),rows:[fixture(),{...fixture(),company_id:second.providerCompanyId}],mappings:[mapping,second]}),{message:'IMPORT_SCOPE_DENIED'});
 assert.deepEqual(calls,[`authorize:${mapping.companyId}`,`mapping:${mapping.companyId}`,`authorize:${second.companyId}`]);
});

test('failed inserted-profile readback publishes neither profile nor audit and does not retry',async()=>{
 const store=memoryStore(),transaction=store.transaction.bind(store);let inserts=0,reads=0,audits=0;
 store.transaction=run=>transaction(tx=>run({...tx,
  find:async identity=>{reads++;return reads===1?tx.find(identity):null;},
  insert:async row=>{inserts++;await tx.insert(row);},
  audit:async row=>{audits++;await tx.audit(row);}
 }));
 await assert.rejects(importDrivers(store,request()),{message:'IMPORT_READBACK_FAILED'});
 assert.equal(inserts,1);assert.equal(reads,2);assert.equal(audits,0);
 assert.equal(store.state.size,0);assert.equal(store.audits,0);
});

test('unchanged replay from a different reviewed envelope preserves original source and actor evidence',async()=>{
 const store=memoryStore(),input=request();await importDrivers(store,input);
 const before=structuredClone([...store.state.values()]);
 const replay={...input,actorUserId:'second-synthetic-actor',evidenceSha256:'b'.repeat(64),rows:[fixture(),fixture()]};
 assert.deepEqual(await importDrivers(store,replay),{created:0,unchanged:1});
 assert.deepEqual([...store.state.values()],before);assert.equal(store.audits,1);
 assert.deepEqual(input,request());
});
