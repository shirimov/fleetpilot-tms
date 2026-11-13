import test from 'node:test';
import assert from 'node:assert/strict';
import * as service from '../src/lib/fleet/qm-driver-company.mjs';
import { createHash } from 'node:crypto';
import { fingerprint } from '../src/lib/fleet/qm-driver-import.mjs';
import { scope, mapping } from './qm-driver-fixture.mjs';

// Synthetic transaction dependency, not a PostgreSQL acceptance test.
function memoryStore(overrides={},initial={}) {
 let state={companies:[],bindings:[],events:[],memberships:[],groups:[],...initial};
 return {get state(){return state;},async transaction(run){
  const draft=structuredClone(state);
  const tx={
   authorizeGroup:async()=>true,
   findBinding:async m=>draft.bindings.find(b=>b.provider===m.provider&&b.accountKey===m.accountKey&&b.providerCompanyId===m.providerCompanyId),
   hasArchiveIdentity:async()=>false,
   hasCompanyName:async name=>draft.companies.some(c=>c.name===name),
   createCompany:async c=>draft.companies.push(c),
   createOwnerMembership:async c=>draft.memberships.push(c),
   createGroupCompany:async c=>draft.groups.push(c),
   insertBinding:async b=>draft.bindings.push(b),
   auditBinding:async e=>draft.events.push(e),
   authorize:async()=>true,
   verifyArchiveMapping:async()=>true,
   verifyProvisionedCompany:async(c,actor,group)=>draft.companies.some(v=>v.id===c.companyId&&v.name===c.companyName)&&draft.memberships.some(v=>v.id===c.membershipId&&v.companyId===c.companyId&&v.userId===actor)&&draft.groups.some(v=>v.companyId===c.companyId&&v.operatingGroupId===group),
   ...overrides,
  };
  const result=await run(tx);state=draft;return result;
 }};
}
const plan=()=>({version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:'a'.repeat(64),mappingSha256:'b'.repeat(64),existingMappings:[],companies:[{providerCompanyId:'synthetic-source-company',companyId:'11111111-1111-4111-8111-111111111111',membershipId:'22222222-2222-4222-8222-222222222222',companyName:'Synthetic Carrier LLC'}]});
const request=(p=plan())=>({plan:p,reviewedPlanSha256:fingerprint(p),actorUserId:'synthetic-owner',mode:'CREATE'});
const receiptFor=input=>({version:1,kind:'COMPANY_CREATION_RECEIPT',applied:true,verified:true,created:input.plan.companies.length,existing:0,ownerUserId:input.actorUserId,companies:input.plan.companies.map(({providerCompanyId,companyId,membershipId})=>({providerCompanyId,companyId,membershipId})),wouldCreate:0,verification:'POST_COMMIT_READ_ONLY',planSha256:input.reviewedPlanSha256,evidenceSha256:input.plan.evidenceSha256,mappingSha256:input.plan.mappingSha256,scope:input.plan.scope});
test('explicit reviewed provision creates canonical company and durable binding; replay creates nothing',async()=>{
 assert.equal(typeof service.provisionSourceCompanies,'function');
 const store=memoryStore();const input=request();
 const first=await service.provisionSourceCompanies(store,input);
 assert.equal(first.created,1);assert.equal(first.unchanged,0);
 assert.equal(store.state.companies[0].name,input.plan.companies[0].companyName);
 assert.equal(store.state.companies[0].dotNumber,undefined);assert.equal(store.state.companies[0].mcNumber,undefined);
 assert.equal(store.state.bindings[0].providerCompanyId,input.plan.companies[0].providerCompanyId);
 assert.equal(store.state.bindings[0].planSha256,input.reviewedPlanSha256);
 assert.equal(store.state.events.length,1);assert.equal(store.state.memberships.length,1);assert.equal(store.state.groups.length,1);
 const second=await service.provisionSourceCompanies(store,input);
 assert.equal(second.created,0);assert.equal(second.unchanged,1);assert.deepEqual(second.mappings,first.mappings);
 assert.equal(store.state.companies.length,1);assert.equal(store.state.events.length,1);
});
test('caller mutation during authorization cannot change reviewed plan writes',async()=>{
 const input=request();const original=input.plan.companies[0].companyName;
 const store=memoryStore({authorizeGroup:async()=>{input.plan.companies[0].companyName='Unreviewed changed name';return true;}});
 await service.provisionSourceCompanies(store,input);
 assert.equal(store.state.companies[0].name,original);
});
test('replay rejects canonical company or membership drift',async()=>{
 const input=request();const store=memoryStore();await service.provisionSourceCompanies(store,input);
 store.state.companies[0].name='Changed canonical name';
 await assert.rejects(service.provisionSourceCompanies(store,input),/PROVISIONED_COMPANY_MISMATCH/);
});
test('reviewed receipt binds exact pre-provisioned IDs without company or membership writes',async()=>{
 const input=request();const c=input.plan.companies[0];
 input.planBytes=Buffer.from(JSON.stringify(input.plan,null,2)+'\n');
 input.reviewedPlanSha256=createHash('sha256').update(input.planBytes).digest('hex');
 const receipt=receiptFor(input);
 const receiptBytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
 const reviewedReceiptSha256=createHash('sha256').update(receiptBytes).digest('hex');
 const store=memoryStore({createCompany:async()=>assert.fail('company write'),createOwnerMembership:async()=>assert.fail('membership write'),createGroupCompany:async()=>assert.fail('group write')},{companies:[{id:c.companyId,name:c.companyName}],memberships:[{id:c.membershipId,companyId:c.companyId,userId:input.actorUserId}],groups:[{companyId:c.companyId,operatingGroupId:scope.operatingGroupId}]});
 const result=await service.provisionSourceCompanies(store,{...input,mode:'BIND_PROVISIONED',receipt,receiptBytes,reviewedReceiptSha256});
 assert.equal(result.created,1);assert.equal(store.state.bindings.length,1);
 assert.deepEqual(store.state.bindings[0].provenance.receipt,receipt);
});
test('source company names retain exact whitespace and Unicode through reviewed receipt binding',async()=>{
 for(const name of ['Synthetic Carrier LLC ', ' Synthetic Carrier LLC', 'Cafe\u0301 Synthetic Carrier ', '🚚'.repeat(256)]) {
  const p=plan();p.companies[0].companyName=name;
  const input=request(p);input.planBytes=Buffer.from(JSON.stringify(p,null,2)+'\n');
  const originalBytes=Buffer.from(input.planBytes);
  input.reviewedPlanSha256=createHash('sha256').update(input.planBytes).digest('hex');
  const receipt=receiptFor(input),receiptBytes=Buffer.from(JSON.stringify(receipt));
  const c=p.companies[0];
  const store=memoryStore({}, {companies:[{id:c.companyId,name}],memberships:[{id:c.membershipId,companyId:c.companyId,userId:input.actorUserId}],groups:[{companyId:c.companyId,operatingGroupId:scope.operatingGroupId}]});
  await service.provisionSourceCompanies(store,{...input,mode:'BIND_PROVISIONED',receipt,receiptBytes,reviewedReceiptSha256:createHash('sha256').update(receiptBytes).digest('hex')});
  assert.equal(store.state.bindings[0].sourceCompanyName,name);
  assert.equal(store.state.bindings[0].provenance.plan.companies[0].companyName,name);
  assert.deepEqual(input.planBytes,originalBytes);
  assert.equal(p.companies[0].companyName,name);
 }
});
test('invalid source company names fail before any transaction',async()=>{
 const invalid=[null,42,{},[], '', ' ', '\u00a0\u2003', 'x'.repeat(257), '🚚'.repeat(257), 'Synthetic\ud800', '\udfffCarrier'];
 for(let code=0;code<32;code++)invalid.push(`Synthetic${String.fromCharCode(code)}Carrier`);
 invalid.push('Synthetic\x7fCarrier');
 for(const companyName of invalid) {
  const p=plan();p.companies[0].companyName=companyName;
  await assert.rejects(service.provisionSourceCompanies({transaction:()=>assert.fail('invalid name reached transaction')},request(p)),/^Error: INVALID_SOURCE_COMPANY_NAME$/);
 }
});
test('plan tampering, missing intent, duplicate identities and malformed fixed IDs fail before transaction',async()=>{
 const base=request();
 const variations=[
  {...base,reviewedPlanSha256:'c'.repeat(64)},
  {...base,planBytes:Buffer.from(JSON.stringify(base.plan))},
  {...base,planBytes:Buffer.from('{}'),reviewedPlanSha256:createHash('sha256').update('{}').digest('hex')},
  {...base,mode:undefined},
  request({...plan(),intent:'IMPORT_DRIVERS'}),
  request({...plan(),companies:[...plan().companies,...plan().companies]}),
  request({...plan(),companies:[{...plan().companies[0],companyId:'not-a-uuid'}]}),
  request({...plan(),companies:[{...plan().companies[0],providerCompanyId:' synthetic-source-company'}]}),
  request({...plan(),companies:[{...plan().companies[0],providerCompanyId:'synthetic-source-company '}]}),
  request({...plan(),companies:[{...plan().companies[0],dotNumber:'invented'}]}),
  request({...plan(),existingMappings:[{...mapping,accountKey:'different-account'}]}),
 ];
 for(const input of variations) {
  let transactions=0;
  await assert.rejects(service.provisionSourceCompanies({transaction:()=>{transactions++;throw new Error('UNEXPECTED_TRANSACTION');}},input),/REVIEWED_PLAN_MISMATCH|COMPANY_CREATION_NOT_AUTHORIZED|DUPLICATE_COMPANY_PLAN|INVALID_PLANNED_ID|INVALID_IDENTIFIER|INVALID_COMPANY_PLAN|MAPPING_SCOPE_MISMATCH/);
  assert.equal(transactions,0);
 }
});
test('inactive/non-owner/group denial and exact archive mapping failures leave no writes',async()=>{
 for(const overrides of [{authorizeGroup:async()=>false},{authorize:async()=>false},{verifyArchiveMapping:async()=>false}]) {
  const p=plan();p.existingMappings=[mapping];const store=memoryStore(overrides);
  await assert.rejects(service.provisionSourceCompanies(store,request(p)),/COMPANY_SCOPE_DENIED|COMPANY_MAPPING_NOT_VERIFIED/);
  assert.equal(store.state.companies.length,0);assert.equal(store.state.bindings.length,0);
 }
});
test('same-name and archive identity conflicts are unresolved, never adopted',async()=>{
 for(const overrides of [{hasCompanyName:async()=>true},{hasArchiveIdentity:async()=>true}]) {
  const store=memoryStore(overrides);await assert.rejects(service.provisionSourceCompanies(store,request()),/COMPANY_NAME_CONFLICT|COMPANY_ARCHIVE_CONFLICT/);
  assert.equal(store.state.companies.length,0);assert.equal(store.state.bindings.length,0);
 }
});
test('later company conflict and audit failure roll back all synthetic transaction writes',async()=>{
 const p=plan();p.companies.push({...p.companies[0],providerCompanyId:'second-source',companyId:'33333333-3333-4333-8333-333333333333',membershipId:'44444444-4444-4444-8444-444444444444',companyName:'Second Synthetic Carrier'});
 for(const overrides of [{hasCompanyName:async name=>name==='Second Synthetic Carrier'},{auditBinding:async()=>{throw new Error('AUDIT_FAILED');}}]) {
  const store=memoryStore(overrides);await assert.rejects(service.provisionSourceCompanies(store,request(p)),/COMPANY_NAME_CONFLICT|AUDIT_FAILED/);
  for(const values of Object.values(store.state))assert.equal(values.length,0);
 }
});
test('binding identity cannot be moved to another account scope, group, company or plan',async()=>{
 const input=request();const store=memoryStore();await service.provisionSourceCompanies(store,input);
 for(const change of [{companyId:'33333333-3333-4333-8333-333333333333'},{operatingGroupId:'other-group'},{sourceCompanyName:'Changed source'},{planSha256:'d'.repeat(64)}]) {
  const snapshot=structuredClone(store.state);Object.assign(snapshot.bindings[0],change);
  await assert.rejects(service.provisionSourceCompanies(memoryStore({},snapshot),input),/COMPANY_BINDING_CONFLICT/);
 }
});
test('receipt must match exact plan, actor, company IDs and reviewed receipt hash',async()=>{
 const input=request();const receipt=receiptFor(input);
 for(const changed of [{...receipt,ownerUserId:'other-owner'},{...receipt,planSha256:'d'.repeat(64)},{...receipt,companies:[]},{...receipt,applied:false},{...receipt,verified:false},{...receipt,verification:'READ_ONLY_PREFLIGHT'},{...receipt,existing:1},{...receipt,scope:{...scope,accountKey:'other-account'}},{...receipt,mappingSha256:'f'.repeat(64)},receipt]) {
  await assert.rejects(service.provisionSourceCompanies({transaction:()=>assert.fail('receipt should fail before transaction')},{...input,mode:'BIND_PROVISIONED',receipt:changed,reviewedReceiptSha256:changed===receipt?'e'.repeat(64):fingerprint(changed)}),/PROVISION_RECEIPT_MISMATCH/);
 }
 const store=memoryStore();await assert.rejects(service.provisionSourceCompanies(store,{...input,mode:'BIND_PROVISIONED',receipt,reviewedReceiptSha256:fingerprint(receipt)}),/PROVISIONED_COMPANY_MISMATCH/);
 assert.equal(store.state.companies.length,0);assert.equal(store.state.bindings.length,0);
});
