import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,mapping} from './qm-driver-fixture.mjs';
import {buildCompanyPlan} from './qm-driver-company-plan.mjs';
const input=()=>{
 const historical=fixture();historical.company_id='historical-source';historical.company_name='Historical Synthetic Company';
 return {rows:[fixture(),historical],mappings:[mapping],evidenceSha256:'a'.repeat(64),mappingSha256:'b'.repeat(64),expectedCompanyCount:1};
};
test('creation plan contains only missing source companies and exact source names',()=>{
 const plan=buildCompanyPlan(input());
 assert.equal(plan.intent,'CREATE_MISSING_QM_COMPANIES');
 assert.equal(plan.companies.length,1);
 assert.equal(plan.companies[0].providerCompanyId,'historical-source');
 assert.equal(plan.companies[0].companyName,'Historical Synthetic Company');
 assert.match(plan.companies[0].companyId,/^[a-f0-9-]{36}$/);
 assert.equal(plan.companies[0].dotNumber,undefined);
 assert.deepEqual(plan.existingMappings,[mapping]);
 assert.equal(plan.drivers,undefined);
});
test('company creation fails rather than choosing conflicting or blank names',()=>{
 const request=input(),conflicting=structuredClone(request.rows[1]);conflicting.qm_driver_id='other';conflicting.company_name='Different Synthetic Company';
 assert.throws(()=>buildCompanyPlan({...request,rows:[...request.rows,conflicting]}),/SOURCE_COMPANY_NAME_CONFLICT/);
 request.rows[1].company_name='';assert.throws(()=>buildCompanyPlan(request),/SOURCE_COMPANY_NAME_REQUIRED/);
});
test('unexpected creation scope fails closed',()=>{
 assert.throws(()=>buildCompanyPlan({...input(),expectedCompanyCount:2}),/COMPANY_CREATION_COUNT_MISMATCH/);
});
