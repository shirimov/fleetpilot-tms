import { createHash, randomUUID } from 'node:crypto';

export function requireImport(condition, code) { if (!condition) throw new Error(code); }
export function identifier(value) { requireImport(typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value), 'INVALID_IDENTIFIER'); }
function object(value, allowed, required = allowed) {
 requireImport(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT');
 requireImport(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value,key)), 'UNAPPROVED_OR_MISSING_FIELD');
}
function text(value) { requireImport(value === null || (typeof value === 'string' && value.length <= 4096), 'INVALID_TEXT'); }
function texts(value, keys) { object(value,keys); Object.values(value).forEach(text); }
function stable(value) { return Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value; }
export function fingerprint(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }

// This is the private export envelope adapter, NOT an invented provider API.
// Unknown fields fail closed; approved evidence never passes through public DTOs.
export function adaptExport(rows) {
 requireImport(Array.isArray(rows) && rows.length <= 100000, 'INVALID_ROSTER');
 return rows.map(source => {
  object(source,['address','company_id','company_name','compensation','detail_availability','driver_role','email','full_name','hire_date','license','list_company','name','phone','provenance','qm_driver_id','qm_driver_number','qm_drv_status','qm_extra_driver_id','rehired_at','status','terminated_at']);
  identifier(source.company_id); identifier(source.qm_driver_id);
  for (const key of ['company_name','detail_availability','driver_role','email','full_name','hire_date','phone','qm_drv_status','qm_extra_driver_id','rehired_at','status','terminated_at']) text(source[key]);
  requireImport(Number.isSafeInteger(source.qm_driver_number),'INVALID_DRIVER_NUMBER');
  texts(source.name,['first_name','middle_name','last_name']);
  texts(source.address,['address_line_1','address_line_2','city','state','zip_code','country']);
  texts(source.list_company,['carrier_id','carrier_name']);
  const pay=source.compensation;
  object(pay,['frequency','frequency_note','primary_ui_fields','source_contract']); text(pay.frequency); text(pay.frequency_note);
  object(pay.primary_ui_fields,['Driver role','Gross Share','Payment','Payment Type','Rate','Empty Rate'],[]); Object.values(pay.primary_ui_fields).forEach(text);
  object(pay.source_contract,['type','rate','empty_rate','split_share','frequency'],['type']); text(pay.source_contract.type);
  for(const key of ['rate','empty_rate','split_share']) if(Object.hasOwn(pay.source_contract,key)) requireImport(pay.source_contract[key] === null || (typeof pay.source_contract[key] === 'number' && Number.isFinite(pay.source_contract[key])) || (typeof pay.source_contract[key] === 'string' && pay.source_contract[key].length<=256),'INVALID_COMPENSATION');
  if(Object.hasOwn(pay.source_contract,'frequency')) text(pay.source_contract.frequency);
  object(source.provenance,['detail','roster']);
  texts(source.provenance.roster,['batch_file','source_url','retrieved_at']);
  if(source.provenance.detail!==null) texts(source.provenance.detail,['source_url','ui_source_url','retrieved_at']);
  if(source.license!==null) {
   object(source.license,['source_url','folders']); text(source.license.source_url);
   requireImport(Array.isArray(source.license.folders) && source.license.folders.length<=20,'INVALID_LICENSE');
   for(const folder of source.license.folders) {
    object(folder,['label','records']); requireImport(['CDL (Front)','CDL (Back)','OLD CDL'].includes(folder.label),'UNAPPROVED_LICENSE_FOLDER');
    requireImport(Array.isArray(folder.records) && folder.records.length<=100,'INVALID_LICENSE');
    for(const record of folder.records) {
     object(record,['expiration_date','class','state','number','endorsements','issue_date','country','restrictions'],[]);
     for(const [key,value] of Object.entries(record)) {
      if(key==='endorsements') { requireImport(Array.isArray(value) && value.length<=100,'INVALID_LICENSE'); value.forEach(text); } else text(value);
     }
    }
   }
  }
  // Provider code remains the type: do not claim currency/frequency or interpret FP as salary.
  const compensationType = ['PC','PPM','FP'].includes(pay.source_contract.type) ? pay.source_contract.type : 'UNKNOWN';
  const compensationAmount = pay.source_contract.rate == null ? null : String(pay.source_contract.rate);
  return {source:structuredClone(source), sourceHash:fingerprint(source), compensationType,compensationAmount};
 });
}
export function planImport(rows,scope,mappings) {
 object(scope,['provider','accountKey','operatingGroupId']); requireImport(scope.provider==='QUICKMANAGE','INVALID_PROVIDER'); Object.values(scope).forEach(identifier);
 requireImport(Array.isArray(mappings),'INVALID_MAPPINGS');
 const companies=new Map();
 for(const mapping of mappings) {
  object(mapping,['provider','accountKey','operatingGroupId','providerCompanyId','companyId','evidenceReference']); Object.values(mapping).forEach(identifier);
  requireImport(mapping.provider===scope.provider && mapping.accountKey===scope.accountKey && mapping.operatingGroupId===scope.operatingGroupId,'MAPPING_SCOPE_MISMATCH');
  requireImport(!companies.has(mapping.providerCompanyId) || fingerprint(companies.get(mapping.providerCompanyId))===fingerprint(mapping),'AMBIGUOUS_MAPPING'); companies.set(mapping.providerCompanyId,mapping);
 }
 const identities=new Map(); const gaps=new Set(); const ready=[]; let duplicates=0;
 for(const row of rows) {
  const key=JSON.stringify([row.source.company_id,row.source.qm_driver_id]);
  if(identities.has(key)) { requireImport(identities.get(key)===row.sourceHash,'CONFLICTING_SOURCE_IDENTITY'); duplicates++; continue; }
  identities.set(key,row.sourceHash);
  const mapping=companies.get(row.source.company_id);
  if(!mapping) gaps.add(row.source.company_id); else ready.push({...row,mapping});
 }
 return {ready,mappingGaps:[...gaps].sort(),summary:{sourceRows:rows.length,uniqueDrivers:identities.size,duplicates,mappedDrivers:ready.length,unmappedDrivers:identities.size-ready.length}};
}

// All authorization, mapping checks, profile and audit writes share one serializable transaction.
// A conflict aborts the whole import; never overwrite evidence or guess a legacy Driver link.
export async function importDrivers(store, input, {verifyBeforeCommit} = {}) {
 requireImport(verifyBeforeCommit === undefined || typeof verifyBeforeCommit === 'function','INVALID_COMMIT_VERIFIER');
 // Freeze caller-owned scope/mappings before validation and the first await.
 const {rows,scope,mappings,actorUserId,evidenceSha256}=structuredClone(input);
 identifier(actorUserId); requireImport(/^[a-f0-9]{64}$/.test(evidenceSha256),'INVALID_EVIDENCE_HASH');
 const plan=planImport(adaptExport(rows),scope,mappings);
 requireImport(plan.mappingGaps.length===0,'COMPANY_MAPPING_UNRESOLVED');
 return store.transaction(async tx=>{
  const bindings=new Map();
  for(const mapping of mappings) {
   requireImport(await tx.authorize(actorUserId,mapping),'IMPORT_SCOPE_DENIED');
   const binding=await tx.verifyMapping(mapping,{actorUserId,evidenceSha256});
   requireImport(typeof binding?.id==='string' && binding.id.length>0,'COMPANY_MAPPING_NOT_VERIFIED');
   bindings.set(mapping.providerCompanyId,binding.id);
  }
  let created=0,unchanged=0;
  for(const row of plan.ready) {
   const identity={...scope,providerCompanyId:row.source.company_id,providerDriverId:row.source.qm_driver_id};
   const existing=await tx.find(identity);
   if(existing) {
    requireImport(existing.sourceHash===row.sourceHash && existing.companyId===row.mapping.companyId && existing.operatingGroupId===scope.operatingGroupId,'SOURCE_CONFLICT'); unchanged++; continue;
   }
   const profile={...identity,id:randomUUID(),companyId:row.mapping.companyId,sourceHash:row.sourceHash,evidenceSha256,actorUserId,mappingEvidence:bindings.get(row.mapping.providerCompanyId),
    firstName:row.source.name.first_name,lastName:row.source.name.last_name,middleName:row.source.name.middle_name,fullName:row.source.full_name,
    lifecycleStatus:row.source.status,hireDateRaw:row.source.hire_date,terminationDateRaw:row.source.terminated_at,rehireDateRaw:row.source.rehired_at,
    compensationType:row.compensationType,compensationAmount:row.compensationAmount,source:row.source};
   await tx.insert(profile);
   const verified=await tx.find(identity);
   requireImport(verified?.sourceHash===profile.sourceHash && verified?.companyId===profile.companyId,'IMPORT_READBACK_FAILED');
   await tx.audit({id:randomUUID(),profileId:profile.id,actorUserId,evidenceSha256,sourceHash:profile.sourceHash}); created++;
  }
  if(verifyBeforeCommit) await verifyBeforeCommit(tx);
  return {created,unchanged};
 });
}

