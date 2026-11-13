import test from 'node:test';
import assert from 'node:assert/strict';
import * as workflow from '../src/lib/fleet/qm-driver-binding.mjs';
import {fingerprint} from '../src/lib/fleet/qm-driver-import.mjs';
import {postgresStore} from '../src/lib/fleet/qm-driver-store.mjs';
import {scope,mapping} from './qm-driver-fixture.mjs';
function fixture() {
 const plan={version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:'a'.repeat(64),mappingSha256:'b'.repeat(64),existingMappings:[mapping],companies:[{providerCompanyId:'synthetic-new',companyId:'11111111-1111-4111-8111-111111111111',membershipId:'22222222-2222-4222-8222-222222222222',companyName:'Synthetic Company'}]};
 const input={plan,reviewedPlanSha256:fingerprint(plan),actorUserId:'synthetic-owner',mode:'BIND_PROVISIONED'};
 input.receipt={version:1,kind:'COMPANY_CREATION_RECEIPT',applied:true,verified:true,created:1,existing:0,ownerUserId:input.actorUserId,companies:plan.companies.map(({providerCompanyId,companyId,membershipId})=>({providerCompanyId,companyId,membershipId})),wouldCreate:0,verification:'POST_COMMIT_READ_ONLY',planSha256:input.reviewedPlanSha256,evidenceSha256:plan.evidenceSha256,mappingSha256:plan.mappingSha256,scope};
 input.reviewedReceiptSha256=fingerprint(input.receipt);
 let binding;const calls=[];
 const store={async transaction(run,options){calls.push(options);return run({authorizeGroup:async()=>true,authorize:async()=>true,verifyArchiveMapping:async()=>true,findBinding:async()=>binding??null,hasArchiveIdentity:async()=>false,verifyProvisionedCompany:async()=>true,insertBinding:async b=>{assert.equal(calls.length,1);binding=b;},auditBinding:async()=>{}});}};
 return {input,store,calls,setBinding:value=>{binding=value;}};
}
test('readback adapter opens an explicitly read-only transaction',async()=>{
 const calls=[];const client={query:async sql=>{calls.push(sql);return {rows:[]};},release:()=>{}};
 await postgresStore({connect:async()=>client}).transaction(async()=>{}, {readOnly:true});
 assert.equal(calls[0],'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
 assert.equal(calls[1],'SET LOCAL search_path = pg_catalog, public, pg_temp');
 assert.equal(calls[2],'COMMIT');
});
test('failed post-commit readback returns no successful config and never retries apply',async()=>{
 const {input,store,calls,setBinding}=fixture();const transaction=store.transaction;
 store.transaction=async(run,options)=>{if(options?.readOnly)setBinding(null);return transaction(run,options);};
 await assert.rejects(workflow.bindProvisionedCompanies(store,input),/BINDING_READBACK_FAILED/);
 assert.equal(calls.length,2);
});
test('workflow refuses CREATE before entering a transaction',async()=>{
 const {input,store,calls}=fixture();input.mode='CREATE';
 await assert.rejects(workflow.bindProvisionedCompanies(store,input),/BIND_ONLY_REQUIRED/);assert.equal(calls.length,0);
});
test('binding workflow verifies committed bindings before returning import-ready config',async()=>{
 assert.equal(typeof workflow.bindProvisionedCompanies,'function');
 const {input,store,calls}=fixture();
 const report=await workflow.bindProvisionedCompanies(store,input);
 assert.equal(report.verified,true);assert.equal(report.applied,true);
 assert.equal(report.verification,'POST_COMMIT_READ_ONLY');
 assert.equal(calls.length,2);assert.deepEqual(calls[1],{readOnly:true});
 assert.equal(report.importConfig.mappings.length,2);
 assert.deepEqual(report.importConfig.mappings[0],mapping);
 assert.notEqual(report.importConfig.mappings[1].evidenceReference,input.plan.companies[0].companyId);
 assert.equal(report.summary.created,1);
});
