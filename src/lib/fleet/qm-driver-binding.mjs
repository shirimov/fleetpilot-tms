import {provisionSourceCompanies} from './qm-driver-company.mjs';
import {requireImport} from './qm-driver-import.mjs';

// Operator-only binding, never Company creation or driver import. Caller owns
// authentication and target authorization. Readback failure means uncertain apply.
export async function bindProvisionedCompanies(store,input) {
 const snapshot=structuredClone(input);
 requireImport(snapshot.mode==='BIND_PROVISIONED','BIND_ONLY_REQUIRED');
 const result=await provisionSourceCompanies(store,snapshot);
 const {plan,actorUserId,reviewedPlanSha256,reviewedReceiptSha256}=snapshot;
 await store.transaction(async tx=>{
  requireImport(await tx.authorizeGroup(actorUserId,plan.scope.operatingGroupId),'BINDING_READBACK_FAILED');
  for(const m of plan.existingMappings) {
   requireImport(await tx.authorize(actorUserId,m)&&await tx.verifyArchiveMapping(m),'BINDING_READBACK_FAILED');
  }
  for(const c of plan.companies) {
   const mapping=result.mappings.find(m=>m.providerCompanyId===c.providerCompanyId);
   const binding=await tx.findBinding({...plan.scope,providerCompanyId:c.providerCompanyId});
   requireImport(binding&&binding.id===mapping?.evidenceReference&&binding.provider===plan.scope.provider&&binding.accountKey===plan.scope.accountKey&&binding.providerCompanyId===c.providerCompanyId&&binding.companyId===c.companyId&&binding.operatingGroupId===plan.scope.operatingGroupId&&binding.sourceCompanyName===c.companyName&&binding.planSha256===reviewedPlanSha256&&binding.evidenceSha256===plan.evidenceSha256&&binding.origin==='PROVISIONED','BINDING_READBACK_FAILED');
   requireImport(await tx.authorize(actorUserId,mapping)&&await tx.verifyProvisionedCompany(c,actorUserId,plan.scope.operatingGroupId),'BINDING_READBACK_FAILED');
  }
 },{readOnly:true});
 return {version:1,kind:'DRIVER_BINDING_RECEIPT',applied:true,verified:true,verification:'POST_COMMIT_READ_ONLY',planSha256:reviewedPlanSha256,receiptSha256:reviewedReceiptSha256,evidenceSha256:plan.evidenceSha256,summary:{created:result.created,unchanged:result.unchanged,mappings:plan.existingMappings.length+result.mappings.length},importConfig:{scope:plan.scope,actorUserId,mappings:[...plan.existingMappings,...result.mappings]},blockers:[]};
}
