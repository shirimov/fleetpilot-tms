import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixture, scope, mapping } from './qm-driver-fixture.mjs';
const cli=new URL('./qm-driver-alpha-import-cli.mjs',import.meta.url);
const raw=value=>Buffer.from(JSON.stringify(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function envelope() {
 const exportBytes=raw([fixture(),{...fixture(),company_id:'synthetic-new',qm_driver_id:'new-driver',list_company:{carrier_id:'synthetic-new',carrier_name:'Synthetic Company'}}]);
 const plan={version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:sha(exportBytes),mappingSha256:'b'.repeat(64),existingMappings:[mapping],companies:[{providerCompanyId:'synthetic-new',companyId:'11111111-1111-4111-8111-111111111111',membershipId:'22222222-2222-4222-8222-222222222222',companyName:'Synthetic Company'}]};
 const planBytes=raw(plan),actorUserId='synthetic-owner';
 const receipt={version:1,kind:'COMPANY_CREATION_RECEIPT',applied:true,verified:true,created:1,existing:0,ownerUserId:actorUserId,companies:plan.companies.map(({providerCompanyId,companyId,membershipId})=>({providerCompanyId,companyId,membershipId})),wouldCreate:0,verification:'POST_COMMIT_READ_ONLY',planSha256:sha(planBytes),evidenceSha256:plan.evidenceSha256,mappingSha256:plan.mappingSha256,scope};
 const receiptBytes=raw(receipt);
 return {exportBase64:exportBytes.toString('base64'),planBase64:planBytes.toString('base64'),receiptBase64:receiptBytes.toString('base64'),review:{actorUserId,reviewedPlanSha256:sha(planBytes),reviewedReceiptSha256:sha(receiptBytes)}};
}
function run(args,input='') {return spawnSync(process.execPath,[cli.pathname,...args],{input,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,DATABASE_URL:'postgresql://not-allowed:SENSITIVE@remote/production'}});}
test('operator entrypoint defaults to refusal and never prints input or database credentials',()=>{
 assert.ok(existsSync(cli),'operator CLI missing');
 const r=run([],'SENSITIVE');assert.equal(r.status,2);assert.doesNotMatch(r.stdout+r.stderr,/SENSITIVE/);
});
test('offline preview uses exact raw bytes and cannot connect or apply',()=>{
 assert.ok(existsSync(cli),'operator CLI missing');
 const r=run(['--preview'],JSON.stringify(envelope()));
 assert.equal(r.status,2,r.stderr);const report=JSON.parse(r.stdout);
 assert.equal(report.applied,false);assert.equal(report.summary.uniqueDrivers,2);assert.equal(report.verified,false);
 assert.doesNotMatch(r.stdout,/Synthetic Test|SENSITIVE/);
});
test('apply refuses wrong endpoint before any connection and malformed envelopes are sanitized',()=>{
 assert.ok(existsSync(cli),'operator CLI missing');
 for(const [args,input] of [[['--apply-alpha'],JSON.stringify(envelope())],[['--preview'],'{"SENSITIVE":"x"}'],[['--preview'],'not-json-SENSITIVE']]) {
  const r=run(args,input);assert.equal(r.status,1);assert.doesNotMatch(r.stdout+r.stderr,/SENSITIVE/);
 }
});
