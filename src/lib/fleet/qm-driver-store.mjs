import { randomUUID } from 'node:crypto';
import { requireImport } from './qm-driver-import.mjs';

// Parameterized PostgreSQL adapter. No environment loading and no financial writes.
export function postgresStore(pool) {
 return {async transaction(run,{readOnly=false}={}) {
  const db=await pool.connect();
  const insert=async(table,fields,row,jsonFields=[])=>db.query(`INSERT INTO "${table}" (${fields.map(f=>`"${f}"`).join(',')}) VALUES (${fields.map((_,i)=>`$${i+1}`).join(',')})`,fields.map(f=>jsonFields.includes(f)?JSON.stringify(row[f]):row[f]));
  try {
   await db.query(readOnly?'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY':'BEGIN ISOLATION LEVEL SERIALIZABLE');
   await db.query('SET LOCAL search_path = pg_catalog, public, pg_temp');
   const tx={
    async authorize(actor,mapping) {
     const result=await db.query('SELECT m."companyId" FROM "CompanyMembership" m JOIN "User" u ON u.id=m."userId" JOIN "OperatingGroupCompany" g ON g."companyId"=m."companyId" WHERE m."userId"=$1 AND m."companyId"=$2 AND m.role=\'OWNER\' AND u."isActive"=true AND g."operatingGroupId"=$3',[actor,mapping.companyId,mapping.operatingGroupId]);
     return result.rows.length===1;
    },
    async authorizeGroup(actor,group) {
     const result=await db.query('SELECT g."operatingGroupId" FROM "OperatingGroupMembership" g JOIN "User" u ON u.id=g."userId" WHERE g."userId"=$1 AND g."operatingGroupId"=$2 AND g.role=\'OWNER\' AND u."isActive"=true',[actor,group]);
     return result.rows.length===1;
    },
    async verifyArchiveMapping(m) {
     // Existing binding is evidence only; an archive grant is NOT permission to import.
     const result=await db.query('SELECT id FROM "ArchiveCompany" WHERE provider=$1 AND "accountKey"=$2 AND "providerCompanyId"=$3 AND "companyId"=$4 AND "operatingGroupId"=$5 AND id=$6',[m.provider,m.accountKey,m.providerCompanyId,m.companyId,m.operatingGroupId,m.evidenceReference]);
     return result.rows.length===1;
    },
    async findBinding(m) {
     const result=await db.query('SELECT * FROM "DriverSourceCompanyBinding" WHERE provider=$1 AND "accountKey"=$2 AND "providerCompanyId"=$3',[m.provider,m.accountKey,m.providerCompanyId]);
     return result.rows[0]??null;
    },
    async verifyMapping(m,{actorUserId,evidenceSha256}) {
     requireImport(await tx.authorize(actorUserId,m),'IMPORT_SCOPE_DENIED');
     const existing=await tx.findBinding(m);
     if(existing) {
      requireImport(existing.companyId===m.companyId && existing.operatingGroupId===m.operatingGroupId,'COMPANY_BINDING_CONFLICT');
      if(existing.id!==m.evidenceReference && existing.archiveCompanyId!==m.evidenceReference)return null;
      // Archive-backed bindings always recheck their original exact evidence,
      // even when the caller uses the new driver-specific binding ID.
      if(existing.origin==='ARCHIVE' && !await tx.verifyArchiveMapping({...m,evidenceReference:existing.archiveCompanyId}))return null;
      return existing;
     }
     if(!await tx.verifyArchiveMapping(m))return null;
     const binding={id:randomUUID(),provider:m.provider,accountKey:m.accountKey,operatingGroupId:m.operatingGroupId,providerCompanyId:m.providerCompanyId,companyId:m.companyId,sourceCompanyName:null,origin:'ARCHIVE',archiveCompanyId:m.evidenceReference,evidenceSha256,planSha256:null,actorUserId,provenance:{mapping:{...m}}};
     await tx.insertBinding(binding);
     await tx.auditBinding({id:randomUUID(),bindingId:binding.id,actorUserId,evidenceSha256,planSha256:null});
     const persisted=await tx.findBinding(m);
     requireImport(persisted?.id===binding.id && persisted?.companyId===m.companyId && persisted?.operatingGroupId===m.operatingGroupId,'COMPANY_BINDING_READBACK_FAILED');
     return persisted;
    },
    async hasArchiveIdentity(m) {
     const result=await db.query('SELECT id FROM "ArchiveCompany" WHERE provider=$1 AND "accountKey"=$2 AND "providerCompanyId"=$3',[m.provider,m.accountKey,m.providerCompanyId]);
     return result.rows.length>0;
    },
    async hasCompanyName(name) {
     // A same-name row is a review conflict, never a mapping/adoption candidate.
     const result=await db.query('SELECT id FROM "Company" WHERE lower(name)=lower($1)',[name]);return result.rows.length>0;
    },
    async verifyProvisionedCompany(c,actor,group) {
     const result=await db.query('SELECT c.id FROM "Company" c JOIN "CompanyMembership" m ON m."companyId"=c.id JOIN "User" u ON u.id=m."userId" JOIN "OperatingGroupCompany" g ON g."companyId"=c.id WHERE c.id=$1 AND c.name=$2 AND m.id=$3 AND m."userId"=$4 AND m.role=\'OWNER\' AND u."isActive"=true AND g."operatingGroupId"=$5',[c.companyId,c.companyName,c.membershipId,actor,group]);
     return result.rows.length===1;
    },
    async createCompany(c) {await db.query('INSERT INTO "Company" (id,name,"updatedAt") VALUES ($1,$2,CURRENT_TIMESTAMP)',[c.id,c.name]);},
    async createOwnerMembership(m) {await db.query('INSERT INTO "CompanyMembership" (id,"userId","companyId",role,"updatedAt") VALUES ($1,$2,$3,\'OWNER\',CURRENT_TIMESTAMP)',[m.id,m.userId,m.companyId]);},
    async createGroupCompany(g) {await db.query('INSERT INTO "OperatingGroupCompany" ("operatingGroupId","companyId") VALUES ($1,$2)',[g.operatingGroupId,g.companyId]);},
    async insertBinding(b) {await insert('DriverSourceCompanyBinding',['id','provider','accountKey','operatingGroupId','providerCompanyId','companyId','sourceCompanyName','origin','archiveCompanyId','evidenceSha256','planSha256','actorUserId','provenance'],b,['provenance']);},
    async auditBinding(e) {await insert('DriverSourceCompanyBindingEvent',['id','bindingId','actorUserId','evidenceSha256','planSha256'],e);},
    async find(i) {
     const result=await db.query('SELECT id,"sourceHash","companyId","operatingGroupId" FROM "DriverSourceProfile" WHERE provider=$1 AND "accountKey"=$2 AND "providerCompanyId"=$3 AND "providerDriverId"=$4',[i.provider,i.accountKey,i.providerCompanyId,i.providerDriverId]);
     return result.rows[0]??null;
    },
    async readImportEvidence(i) {
     const result=await db.query('SELECT p.id,p.provider,p."accountKey",p."operatingGroupId",p."providerCompanyId",p."providerDriverId",p."companyId",p."mappingEvidence",p."actorUserId",p."evidenceSha256",p."sourceHash",p.source,p."firstName",p."middleName",p."lastName",p."fullName",p."lifecycleStatus",p."hireDateRaw",p."terminationDateRaw",p."rehireDateRaw",p."compensationType",p."compensationAmount",e.id AS "auditId",e."actorUserId" AS "auditActor",e."evidenceSha256" AS "auditEvidence",e."sourceHash" AS "auditSourceHash" FROM "DriverSourceProfile" p LEFT JOIN "DriverSourceImportEvent" e ON e."profileId"=p.id WHERE p.provider=$1 AND p."accountKey"=$2 AND p."providerCompanyId"=$3 AND p."providerDriverId"=$4',[i.provider,i.accountKey,i.providerCompanyId,i.providerDriverId]);
     return result.rows;
    },
    async insert(p) {
     const fields=['id','provider','accountKey','operatingGroupId','providerCompanyId','providerDriverId','companyId','sourceHash','evidenceSha256','actorUserId','mappingEvidence','firstName','middleName','lastName','fullName','lifecycleStatus','hireDateRaw','terminationDateRaw','rehireDateRaw','compensationType','compensationAmount','source'];
     await insert('DriverSourceProfile',fields,p,['source']);
    },
    async audit(a) {
     await db.query('INSERT INTO "DriverSourceImportEvent" (id,"profileId","actorUserId","evidenceSha256","sourceHash") VALUES ($1,$2,$3,$4,$5)',[a.id,a.profileId,a.actorUserId,a.evidenceSha256,a.sourceHash]);
    },
   };
   const result=await run(tx);
   await db.query('COMMIT'); return result;
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally {db.release();}
 }};
}
