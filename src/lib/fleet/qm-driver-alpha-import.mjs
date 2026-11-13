import { createHash } from 'node:crypto';
import { requireImport, adaptExport, planImport, fingerprint, importDrivers } from './qm-driver-import.mjs';
import { bindProvisionedCompanies } from './qm-driver-binding.mjs';
import { postgresStore } from './qm-driver-store.mjs';
import { validateProvisionInput } from './qm-driver-company.mjs';

export function prepareAlphaImport(input) {
  requireImport(input && Object.keys(input).sort().join(',') === 'exportBytes,planBytes,receiptBytes,review', 'INVALID_RELEASE_INPUT');
  const {exportBytes,planBytes,receiptBytes} = input;
  for(const [raw,limit] of [[exportBytes,32*1024*1024],[planBytes,1024*1024],[receiptBytes,1024*1024]]) {
    requireImport(raw instanceof Uint8Array && raw.byteLength > 0 && raw.byteLength <= limit,'RELEASE_INPUT_BOUND');
  }
  const review=structuredClone(input.review);
  requireImport(review && Object.keys(review).sort().join(',') === 'actorUserId,reviewedPlanSha256,reviewedReceiptSha256','INVALID_REVIEW_CONFIG');
  const parse = raw => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const plan=parse(planBytes),receipt=parse(receiptBytes),rows=parse(exportBytes);
  const bindingInput={...review,plan,receipt,planBytes:Buffer.from(planBytes),receiptBytes:Buffer.from(receiptBytes),mode:'BIND_PROVISIONED'};
  validateProvisionInput(bindingInput);
  const evidenceSha256=createHash('sha256').update(exportBytes).digest('hex');
  requireImport(evidenceSha256 === plan.evidenceSha256,'EXPORT_RECEIPT_HASH_MISMATCH');
  const adapted=adaptExport(rows), identities=new Map();
  for(const row of adapted) {
    const key=JSON.stringify([row.source.company_id,row.source.qm_driver_id]);
    requireImport(!identities.has(key) || identities.get(key)===row.sourceHash,'CONFLICTING_SOURCE_IDENTITY');
    identities.set(key,row.sourceHash);
  }
  const sourceCompanies=new Set(adapted.map(row=>row.source.company_id));
  const mappedCompanies=new Set([...plan.existingMappings,...plan.companies].map(row=>row.providerCompanyId));
  requireImport(identities.size>0 && sourceCompanies.size===mappedCompanies.size && [...sourceCompanies].every(id=>mappedCompanies.has(id)),'RELEASE_COMPANY_COVERAGE_MISMATCH');
  return {bindingInput,rows,evidenceSha256,summary:{sourceRows:rows.length,uniqueDrivers:identities.size,companiesToBind:plan.companies.length,existingMappings:plan.existingMappings.length}};
}

function importVerifier(prepared, suppliedMappings) {
  const mappings=structuredClone(suppliedMappings);
  const {rows,bindingInput:{plan,actorUserId},evidenceSha256}=structuredClone(prepared);
  const expected=planImport(adaptExport(rows),plan.scope,structuredClone(mappings));
  const fail='POST_COMMIT_DRIVER_READBACK_FAILED';
  requireImport(expected.mappingGaps.length===0,fail);
  return async tx=>{
    requireImport(await tx.authorizeGroup(actorUserId,plan.scope.operatingGroupId),fail);
    const bindings=new Map();
    for(const mapping of mappings) {
      requireImport(await tx.authorize(actorUserId,mapping),fail);
      const binding=await tx.findBinding(mapping);
      requireImport(binding && binding.companyId===mapping.companyId && binding.operatingGroupId===plan.scope.operatingGroupId &&
        (binding.id===mapping.evidenceReference || binding.archiveCompanyId===mapping.evidenceReference),fail);
      if(binding.origin==='ARCHIVE') requireImport(await tx.verifyArchiveMapping({...mapping,evidenceReference:binding.archiveCompanyId}),fail);
      bindings.set(mapping.providerCompanyId,binding.id);
    }
    for(const row of expected.ready) {
      const source=row.source;
      const identity={...plan.scope,providerCompanyId:source.company_id,providerDriverId:source.qm_driver_id};
      const found=await tx.readImportEvidence(identity);
      requireImport(found.length===1,fail);
      const actual=found[0];
      const fields={...identity,companyId:row.mapping.companyId,mappingEvidence:bindings.get(source.company_id),
        actorUserId,evidenceSha256,sourceHash:row.sourceHash,firstName:source.name.first_name,middleName:source.name.middle_name,lastName:source.name.last_name,fullName:source.full_name,lifecycleStatus:source.status,hireDateRaw:source.hire_date,terminationDateRaw:source.terminated_at,rehireDateRaw:source.rehired_at,compensationType:row.compensationType,compensationAmount:row.compensationAmount,
        auditActor:actorUserId,auditEvidence:evidenceSha256,auditSourceHash:row.sourceHash};
      requireImport(typeof actual.id==='string' && typeof actual.auditId==='string' && Object.entries(fields).every(([key,value])=>actual[key]===value) && fingerprint(actual.source)===row.sourceHash,fail);
    }
    return {verifiedDrivers:expected.ready.length,verification:'POST_COMMIT_READ_ONLY'};
  };
}

export async function verifyCommittedImport(store, prepared, mappings) {
  return store.transaction(importVerifier(prepared,mappings),{readOnly:true});
}

// Only the authenticated Alpha operator entrypoint may call this. It never
// provisions Companies, migrates, deploys, or retries a possibly committed write.
export async function applyAlphaImport(pool,input,expectedMigrations,onStage=()=>{}) {
  const prepared=prepareAlphaImport(input);
  const migrations=structuredClone(expectedMigrations);
  requireImport(Array.isArray(migrations) && migrations.length>0 && migrations.length<=1000 &&
    migrations.every(m=>typeof m.name==='string' && /^[a-zA-Z0-9_]+$/.test(m.name) && /^[a-f0-9]{64}$/.test(m.checksum)) &&
    new Set(migrations.map(m=>m.name)).size===migrations.length,'INVALID_MIGRATION_MANIFEST');
  const db=await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
    await db.query('SET LOCAL search_path = pg_catalog, public, pg_temp');
    const identity=await db.query('SELECT current_database() AS database,current_user AS username');
    requireImport(identity.rows.length===1 && identity.rows[0].database==='fleetpilot_staging' && identity.rows[0].username==='fleetpilot','ALPHA_DATABASE_IDENTITY_MISMATCH');
    const ledger=await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"');
    requireImport(ledger.rows.length===migrations.length && migrations.every(m=>ledger.rows.filter(r=>r.migration_name===m.name && r.checksum===m.checksum && r.finished_at && r.rolled_back_at===null).length===1),'ALPHA_MIGRATION_IDENTITY_MISMATCH');
    await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK');throw error; } finally {db.release();}
  const store=postgresStore(pool);
  onStage('binding-apply-attempted');
  const binding=await bindProvisionedCompanies(store,prepared.bindingInput);
  onStage('binding-verified');
  const drivers=await importDrivers(store,{rows:prepared.rows,evidenceSha256:prepared.evidenceSha256,...binding.importConfig},
    {verifyBeforeCommit:importVerifier(prepared,binding.importConfig.mappings)});
  onStage('driver-commit-returned');
  const readback=await verifyCommittedImport(store,prepared,binding.importConfig.mappings);
  return {version:1,kind:'ALPHA_DRIVER_IMPORT_RECEIPT',applied:true,verified:true,
    verification:'POST_COMMIT_READ_ONLY',evidenceSha256:prepared.evidenceSha256,
    planSha256:prepared.bindingInput.reviewedPlanSha256,receiptSha256:prepared.bindingInput.reviewedReceiptSha256,
    source:prepared.summary,bindings:binding.summary,drivers,readback};
}

// Accident-prevention guard for the existing Alpha Compose network. This is not
// authentication: the caller must be the authorized operator on the pinned host.
export function validateAlphaDatabase(value) {
  let url;
  try { url = new URL(value); } catch { requireImport(false, 'ALPHA_DATABASE_TARGET_REQUIRED'); }
  requireImport(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === 'db' &&
    ['', '5432'].includes(url.port) && url.username === 'fleetpilot' &&
    url.pathname === '/fleetpilot_staging' && ['', '?schema=public'].includes(url.search) && url.hash === '',
  'ALPHA_DATABASE_TARGET_REQUIRED');
}
