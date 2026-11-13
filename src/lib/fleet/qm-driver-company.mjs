import { createHash, randomUUID } from 'node:crypto';
import { fingerprint, identifier, requireImport } from './qm-driver-import.mjs';

/**
 * Operator-only API; actorUserId is attribution, NOT an authentication credential.
 * Callers must authenticate/authorize the operator independently and review the exact
 * plan. With planBytes/receiptBytes, review hashes are SHA-256 of those exact UTF-8
 * file bytes; without bytes they are fingerprint (canonical JSON). Evidence/mapping
 * hashes always retain original file SHA-256. No source-file discovery occurs here.
 * @typedef {{provider:'QUICKMANAGE',accountKey:string,operatingGroupId:string}} Scope
 * @typedef {{providerCompanyId:string,companyId:string,companyName:string,membershipId:string}} CompanyPlan
 * @typedef {{version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope:Scope,evidenceSha256:string,mappingSha256:string,existingMappings:Array<object>,companies:Array<CompanyPlan>}} ProvisionPlan
 */
function exact(value,keys) {
 requireImport(value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key)),'INVALID_COMPANY_PLAN');
}
// Match the standalone creator's name semantics, not identifier semantics.
// Count Unicode code points as Python does; reject unpaired surrogates so UTF-8
// encoding cannot replace source evidence. Validation never rewrites the name.
function sourceCompanyName(value) {
 requireImport(typeof value==='string' && value.length>0 && [...value].length<=256 && value.trim().length>0 && !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(value),'INVALID_SOURCE_COMPANY_NAME');
}
function hash(value) {requireImport(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'INVALID_EVIDENCE_HASH');}
function uuid(value) {requireImport(typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value),'INVALID_PLANNED_ID');}
function reviewedJSON(value,reviewedHash,bytes,code) {
 hash(reviewedHash);
 if(bytes===undefined) {requireImport(fingerprint(value)===reviewedHash,code);return;}
 requireImport(bytes instanceof Uint8Array && bytes.length<=1024*1024,code);
 requireImport(createHash('sha256').update(bytes).digest('hex')===reviewedHash,code);
 let parsed;try {parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));} catch {throw new Error(code);}
 requireImport(fingerprint(parsed)===fingerprint(value),code);
}
export function validateCompanyPlan(plan,reviewedPlanSha256,planBytes) {
 exact(plan,['version','intent','scope','evidenceSha256','mappingSha256','existingMappings','companies']);
 requireImport(plan.version===1 && plan.intent==='CREATE_MISSING_QM_COMPANIES','COMPANY_CREATION_NOT_AUTHORIZED');
 exact(plan.scope,['provider','accountKey','operatingGroupId']);Object.values(plan.scope).forEach(identifier);
 requireImport(plan.scope.provider==='QUICKMANAGE','INVALID_PROVIDER');hash(plan.evidenceSha256);hash(plan.mappingSha256);hash(reviewedPlanSha256);
 reviewedJSON(plan,reviewedPlanSha256,planBytes,'REVIEWED_PLAN_MISMATCH');
 requireImport(Array.isArray(plan.companies) && plan.companies.length>0 && plan.companies.length<=100 && Array.isArray(plan.existingMappings),'INVALID_COMPANY_PLAN');
 const sources=new Set(),companies=new Set(),memberships=new Set();
 for(const m of plan.existingMappings) {
  exact(m,['provider','accountKey','operatingGroupId','providerCompanyId','companyId','evidenceReference']);Object.values(m).forEach(identifier);
  requireImport(Object.keys(plan.scope).every(k=>m[k]===plan.scope[k]),'MAPPING_SCOPE_MISMATCH');
  requireImport(!sources.has(m.providerCompanyId),'AMBIGUOUS_MAPPING');sources.add(m.providerCompanyId);companies.add(m.companyId);
 }
 for(const c of plan.companies) {
  exact(c,['providerCompanyId','companyId','companyName','membershipId']);identifier(c.providerCompanyId);uuid(c.companyId);uuid(c.membershipId);sourceCompanyName(c.companyName);
  requireImport(!sources.has(c.providerCompanyId) && !companies.has(c.companyId) && !memberships.has(c.membershipId),'DUPLICATE_COMPANY_PLAN');
  sources.add(c.providerCompanyId);companies.add(c.companyId);memberships.add(c.membershipId);
 }
 return plan;
}
function mappingFor(binding) {
 return {provider:binding.provider,accountKey:binding.accountKey,operatingGroupId:binding.operatingGroupId,providerCompanyId:binding.providerCompanyId,companyId:binding.companyId,evidenceReference:binding.id};
}
/**
 * CREATE explicitly authorizes Company + OWNER CompanyMembership + group link for
 * each fixed plan entry, all atomically with bindings/events. Never called by import.
 * Pure validation only; does not authenticate an actor or inspect a target.
 * BIND_PROVISIONED requires the exact independently reviewed creation receipt.
 * @param {{plan:ProvisionPlan,reviewedPlanSha256:string,planBytes?:Uint8Array,actorUserId:string,mode:'CREATE'|'BIND_PROVISIONED',receipt?:object,receiptBytes?:Uint8Array,reviewedReceiptSha256?:string}} input
 */
export function validateProvisionInput(input) {
 const {plan,reviewedPlanSha256,planBytes,actorUserId,mode,receipt,receiptBytes,reviewedReceiptSha256}=input;
 validateCompanyPlan(plan,reviewedPlanSha256,planBytes);identifier(actorUserId);
 requireImport(mode==='CREATE' || mode==='BIND_PROVISIONED','COMPANY_CREATION_NOT_AUTHORIZED');
 if(mode==='BIND_PROVISIONED') {
  exact(receipt,['version','kind','applied','verified','created','existing','ownerUserId','companies','wouldCreate','verification','planSha256','evidenceSha256','mappingSha256','scope']);
  reviewedJSON(receipt,reviewedReceiptSha256,receiptBytes,'PROVISION_RECEIPT_MISMATCH');
  const expected=plan.companies.map(({providerCompanyId,companyId,membershipId})=>({providerCompanyId,companyId,membershipId}));
  const sortedHashes=rows=>Array.isArray(rows)?rows.map(fingerprint).sort():null;
  requireImport(receipt.version===1 && receipt.kind==='COMPANY_CREATION_RECEIPT' && receipt.applied===true && receipt.verified===true && receipt.wouldCreate===0 && receipt.verification==='POST_COMMIT_READ_ONLY' && receipt.planSha256===reviewedPlanSha256 && receipt.ownerUserId===actorUserId && receipt.evidenceSha256===plan.evidenceSha256 && receipt.mappingSha256===plan.mappingSha256 && fingerprint(receipt.scope)===fingerprint(plan.scope) && fingerprint(sortedHashes(receipt.companies))===fingerprint(sortedHashes(expected)) && Number.isSafeInteger(receipt.created) && receipt.created>=0 && Number.isSafeInteger(receipt.existing) && receipt.existing>=0 && receipt.created+receipt.existing===plan.companies.length,'PROVISION_RECEIPT_MISMATCH');
 } else requireImport(receipt===undefined && receiptBytes===undefined && reviewedReceiptSha256===undefined,'UNEXPECTED_PROVISION_RECEIPT');
}
export async function provisionSourceCompanies(store,input) {
 const snapshot=structuredClone(input);
 validateProvisionInput(snapshot);
 const {plan,reviewedPlanSha256,actorUserId,mode,receipt,reviewedReceiptSha256}=snapshot;
 return store.transaction(async tx=>{
  requireImport(await tx.authorizeGroup(actorUserId,plan.scope.operatingGroupId),'COMPANY_SCOPE_DENIED');
  for(const m of plan.existingMappings) {
   requireImport(await tx.authorize(actorUserId,m),'COMPANY_SCOPE_DENIED');
   requireImport(await tx.verifyArchiveMapping(m),'COMPANY_MAPPING_NOT_VERIFIED');
  }
  let created=0,unchanged=0;const mappings=[];
  for(const c of plan.companies) {
   const identity={...plan.scope,providerCompanyId:c.providerCompanyId};
   const previous=await tx.findBinding(identity);
   if(previous) {
    requireImport(previous.companyId===c.companyId && previous.operatingGroupId===plan.scope.operatingGroupId && previous.sourceCompanyName===c.companyName && previous.planSha256===reviewedPlanSha256,'COMPANY_BINDING_CONFLICT');
    requireImport(await tx.authorize(actorUserId,previous),'COMPANY_SCOPE_DENIED');
    requireImport(await tx.verifyProvisionedCompany(c,actorUserId,plan.scope.operatingGroupId),'PROVISIONED_COMPANY_MISMATCH');
    mappings.push(mappingFor(previous));unchanged++;continue;
   }
   requireImport(!await tx.hasArchiveIdentity(identity),'COMPANY_ARCHIVE_CONFLICT');
   if(mode==='CREATE') {
    requireImport(!await tx.hasCompanyName(c.companyName),'COMPANY_NAME_CONFLICT');
    await tx.createCompany({id:c.companyId,name:c.companyName});
    await tx.createOwnerMembership({id:c.membershipId,userId:actorUserId,companyId:c.companyId});
    await tx.createGroupCompany({operatingGroupId:plan.scope.operatingGroupId,companyId:c.companyId});
   }
   requireImport(await tx.verifyProvisionedCompany(c,actorUserId,plan.scope.operatingGroupId),'PROVISIONED_COMPANY_MISMATCH');
   const binding={...identity,id:randomUUID(),companyId:c.companyId,sourceCompanyName:c.companyName,origin:'PROVISIONED',archiveCompanyId:null,evidenceSha256:plan.evidenceSha256,planSha256:reviewedPlanSha256,actorUserId,provenance:{plan:structuredClone(plan),mode,...(receipt?{receipt:structuredClone(receipt),reviewedReceiptSha256}:{})}};
   await tx.insertBinding(binding);
   const persisted=await tx.findBinding(identity);
   requireImport(persisted?.id===binding.id && persisted?.companyId===c.companyId && persisted?.planSha256===reviewedPlanSha256,'COMPANY_BINDING_READBACK_FAILED');
   await tx.auditBinding({id:randomUUID(),bindingId:binding.id,actorUserId,evidenceSha256:plan.evidenceSha256,planSha256:reviewedPlanSha256});
   mappings.push(mappingFor(binding));created++;
  }
  return {created,unchanged,mappings};
 });
}
