import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { QuickManageMixedStagingService } from './quickmanage-mixed-staging-service';

const suffix=randomUUID().slice(0,8); const carrierA=randomUUID(); const carrierB=randomUUID(); const service=new QuickManageMixedStagingService(prisma);
let userId=''; let memberId=''; let companyA=''; let companyB='';
const context=(role:'OWNER'|'ADMIN'|'MEMBER'='OWNER'):CompanyAuthorization=>({companyId:companyA,role,user:{id:role==='MEMBER'?memberId:userId,email:`${role}-${suffix}@test.invalid`,displayName:role,isActive:true,activeCompanyId:companyA}});
const records=[
  {id:`truck-a-${suffix}`,carrierId:carrierA,carrierName:'Carrier A',unit:`00${suffix}`,status:'active'},
  {id:`truck-b-${suffix}`,carrierId:carrierB,carrierName:'Carrier B',unit:`B-${suffix}`,status:'active'},
];

before(async()=>{ const [a,b]=await Promise.all([prisma.company.create({data:{name:`Mixed A ${suffix}`}}),prisma.company.create({data:{name:`Mixed B ${suffix}`}})]);companyA=a.id;companyB=b.id;
 const [owner,member]=await Promise.all([prisma.user.create({data:{email:`owner-${suffix}@test.invalid`,displayName:'Owner',activeCompanyId:companyA}}),prisma.user.create({data:{email:`member-${suffix}@test.invalid`,displayName:'Member',activeCompanyId:companyA}})]);userId=owner.id;memberId=member.id;
 await prisma.companyMembership.createMany({data:[{userId,companyId:companyA,role:'OWNER'},{userId,companyId:companyB,role:'ADMIN'},{userId:memberId,companyId:companyA,role:'MEMBER'}]});
});
after(async()=>{await prisma.externalSyncRow.deleteMany({where:{batch:{actorUserId:{in:[userId,memberId]}}}});await prisma.externalSyncBatch.deleteMany({where:{actorUserId:{in:[userId,memberId]}}});await prisma.externalSourceLink.deleteMany({where:{companyId:{in:[companyA,companyB]}}});await prisma.externalProviderAccountMapping.deleteMany({where:{verifiedByUserId:userId}});await prisma.truck.deleteMany({where:{companyId:{in:[companyA,companyB]}}});await prisma.companyMembership.deleteMany({where:{userId:{in:[userId,memberId]}}});await prisma.user.deleteMany({where:{id:{in:[userId,memberId]}}});await prisma.company.deleteMany({where:{id:{in:[companyA,companyB]}}});});

test('mixed carrier snapshot stages account-level rows without importing',async()=>{const batch=await service.stageTrucks(records,context());assert.equal(batch.companyId,null);assert.equal(batch.scope,'ACCOUNT');assert.equal(batch.sourceAdapter,'QUICKMANAGE_WEB_EQUIPMENT');assert.equal(batch.unresolvedCompanyRows,2);assert.equal(batch.rows.every(r=>r.disposition==='UNRESOLVED_COMPANY'&&!!r.externalCarrierId),true);assert.equal(await prisma.truck.count({where:{companyId:{in:[companyA,companyB]}}}),0);});

test('stable carrier mappings reclassify by company and grouped apply is idempotent',async()=>{const batch=await service.stageTrucks(records,context());await service.saveMapping({carrierId:records[0].carrierId,carrierName:'Completely different supporting name',companyId:companyA},context());await service.saveMapping({carrierId:records[1].carrierId,carrierName:records[1].carrierName,companyId:companyB},context());const staged=await prisma.externalSyncBatch.findUniqueOrThrow({where:{id:batch.id},include:{rows:true}});assert.equal(staged.newRows,2);assert.equal(staged.unresolvedCompanyRows,0);assert.deepEqual(new Set(staged.rows.map(r=>r.resolvedCompanyId)),new Set([companyA,companyB]));await service.apply(batch.id,context());await service.apply(batch.id,context());assert.equal(await prisma.truck.count({where:{companyId:{in:[companyA,companyB]}}}),2);assert.equal(await prisma.externalSourceLink.count({where:{companyId:{in:[companyA,companyB]}}}),2);const repeat=await service.stageTrucks(records,context());assert.equal(repeat.unchangedRows,2);});

test('member, cross-company mapping, duplicate source IDs, and stale mapping fail closed',async()=>{await assert.rejects(service.stageTrucks(records,context('MEMBER')),/Administrator/);await assert.rejects(service.stageTrucks([records[0],records[0]],context()),/Duplicate/);await assert.rejects(service.saveMapping({carrierId:randomUUID(),carrierName:'Foreign',companyId:companyB},context('MEMBER')),/Administrator/);
 const batch=await service.stageTrucks([{...records[0],id:`stale-${suffix}`,unit:`S-${suffix}`}],context());await service.saveMapping({carrierId:records[0].carrierId,carrierName:records[0].carrierName,companyId:companyA},context());await prisma.externalProviderAccountMapping.update({where:{provider_externalAccountId:{provider:'QUICKMANAGE',externalAccountId:records[0].carrierId}},data:{verifiedAt:new Date(Date.now()+1000)}});await assert.rejects(service.apply(batch.id,context()),/mapping changed/);
});

test('database rejects null company for company scope',async()=>{await assert.rejects(prisma.externalSyncBatch.create({data:{companyId:null,scope:'COMPANY',actorUserId:userId,provider:'TEST',totalRows:0,newRows:0,matchedRows:0,unchangedRows:0,conflictRows:0,invalidRows:0}}));});
