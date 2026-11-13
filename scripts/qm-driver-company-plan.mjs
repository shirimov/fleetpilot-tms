import {randomUUID} from 'node:crypto';
import {adaptExport,planImport,requireImport} from '../src/lib/fleet/qm-driver-import.mjs';

// Preparation only: no writes, inferred Company matches, or financial records.
// Persist each generated plan privately and reuse it rather than generating new IDs on retry.
export function buildCompanyPlan({rows,mappings,evidenceSha256,mappingSha256,expectedCompanyCount}) {
 requireImport(Array.isArray(mappings) && mappings.length>0,'VERIFIED_SCOPE_REQUIRED');
 requireImport(/^[a-f0-9]{64}$/.test(evidenceSha256) && /^[a-f0-9]{64}$/.test(mappingSha256),'INVALID_EVIDENCE_HASH');
 requireImport(Number.isSafeInteger(expectedCompanyCount) && expectedCompanyCount>0 && expectedCompanyCount<=100,'INVALID_EXPECTED_COUNT');
 const {provider,accountKey,operatingGroupId}=mappings[0];
 const scope={provider,accountKey,operatingGroupId};
 const adapted=adaptExport(rows),plan=planImport(adapted,scope,mappings);
 requireImport(plan.mappingGaps.length===expectedCompanyCount,'COMPANY_CREATION_COUNT_MISMATCH');
 const companies=plan.mappingGaps.map(providerCompanyId=>{
  const names=new Set(adapted.filter(row=>row.source.company_id===providerCompanyId).map(row=>row.source.company_name));
  requireImport(names.size===1,'SOURCE_COMPANY_NAME_CONFLICT');
  const companyName=[...names][0];
  requireImport(typeof companyName==='string' && companyName.trim().length>0 && companyName.length<=256 && !/[\x00-\x1f\x7f]/.test(companyName),'SOURCE_COMPANY_NAME_REQUIRED');
  return {providerCompanyId,companyId:randomUUID(),companyName,membershipId:randomUUID()};
 });
 return {version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256,mappingSha256,existingMappings:structuredClone(mappings),companies};
}
