import type { PrismaClient } from '@prisma/client';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { roleCanAccessModule } from '@/lib/auth/module-permissions';
import { DriverSafetyCatalog } from './driver-safety-catalog';
import { calculateRating } from './driver-safety-validation';
import { poolListDto, poolDetailDto } from './qm-driver-dto.mjs';

type PoolRow = {id:string;firstName:string|null;lastName:string|null;fullName:string|null;lifecycleStatus:string|null;phone?:string|null;email?:string|null;hireDateRaw?:string|null;terminationDateRaw?:string|null;rehireDateRaw?:string|null;compensationType?:string|null;compensationAmount?:string|null;compensationFrequency?:string|null};
type SafetySummary = {photoVersion?:string|null;internalRating?:number|null;safetyDataUnavailable?:boolean};
async function safetySummaries(companyId:string) {
 if(!process.env.PRIVATE_FILE_STORAGE_ROOT)return ():SafetySummary=>({photoVersion:null,internalRating:null});
 try {
  const state=await new DriverSafetyCatalog().read(companyId);
  return (id:string):SafetySummary=>{
   const profile=state.drivers[id],records=profile?.inspections??[],superseded=new Set(records.map(record=>record.supersedes));
   return {photoVersion:profile?.photo?.sha256??null,internalRating:calculateRating(state.policies.at(-1)??null,records.filter(record=>!superseded.has(record.id))).score};
  };
 }catch{return ():SafetySummary=>({safetyDataUnavailable:true});}
}
export class DriverPoolNotFoundError extends Error { constructor(){super('Not found');} }
export class DriverPoolService {
 constructor(private readonly database:PrismaClient) {}
 async list(context:CompanyAuthorization,{page,status='ALL',search=''}:{page:number;status?:string;search?:string}) {
  if(typeof search!=='string'||search.length>120) throw new RangeError('Invalid pool search');
  search=search.trim();
  if(!roleCanAccessModule(context.role,'fleet')) throw new AuthorizationDeniedError();
  if(!Number.isInteger(page)||page<1||page>10000||!['ALL','active','terminated','invited','UNKNOWN'].includes(status)) throw new RangeError('Invalid pool filter');
  const rows=await this.database.$queryRaw<PoolRow[]>`
   SELECT * FROM (
    SELECT 'source:' || p.id AS id,p."firstName",p."lastName",p."fullName",p."lifecycleStatus"
    FROM "DriverSourceProfile" p WHERE p."companyId"=${context.companyId}
    UNION ALL
    SELECT 'driver:' || d.id AS id,d."firstName",d."lastName",NULL AS "fullName",'UNKNOWN' AS "lifecycleStatus"
    FROM "Driver" d WHERE d."companyId"=${context.companyId} AND NOT EXISTS (SELECT 1 FROM "DriverSourceProfile" p WHERE p."driverId"=d.id AND p."companyId"=d."companyId")
   ) roster WHERE (${status}='ALL' OR COALESCE(NULLIF("lifecycleStatus",''),'UNKNOWN')=${status})
   AND (${search}='' OR strpos(lower(concat_ws(' ',"fullName","firstName","lastName")),lower(${search}))>0)
   ORDER BY "lastName" NULLS LAST,"firstName" NULLS LAST,id LIMIT 51 OFFSET ${(page-1)*50}`;
  const safety=await safetySummaries(context.companyId);
  return {page,status,search,hasMore:rows.length>50,drivers:rows.slice(0,50).map(row=>({...poolListDto(row),...safety(row.id)}))};
 }
 async detail(context:CompanyAuthorization,id:string) {
  if(!roleCanAccessModule(context.role,'fleet')) throw new AuthorizationDeniedError();
  const canReadPay=roleCanAccessModule(context.role,'hr');
  let rows:PoolRow[];
  if(id.startsWith('source:')) {
   rows=await this.database.$queryRaw<PoolRow[]>`
    SELECT 'source:' || id AS id,"firstName","lastName","fullName","lifecycleStatus","hireDateRaw","terminationDateRaw","rehireDateRaw",
    source->>'phone' AS phone,source->>'email' AS email,
    CASE WHEN ${canReadPay} THEN "compensationType" ELSE NULL END AS "compensationType",
    CASE WHEN ${canReadPay} THEN "compensationAmount" ELSE NULL END AS "compensationAmount",
    CASE WHEN ${canReadPay} THEN source->'compensation'->>'frequency' ELSE NULL END AS "compensationFrequency"
    FROM "DriverSourceProfile" WHERE id=${id.slice(7)} AND "companyId"=${context.companyId}`;
  } else if(id.startsWith('driver:')) {
   rows=await this.database.$queryRaw<PoolRow[]>`
    SELECT 'driver:' || id AS id,"firstName","lastName",NULL AS "fullName",'UNKNOWN' AS "lifecycleStatus",phone,email,
    CASE WHEN ${canReadPay} THEN "payType"::text ELSE NULL END AS "compensationType",
    CASE WHEN ${canReadPay} THEN "payRate"::text ELSE NULL END AS "compensationAmount"
    FROM "Driver" WHERE id=${id.slice(7)} AND "companyId"=${context.companyId}`;
  } else throw new DriverPoolNotFoundError();
  if(rows.length!==1) throw new DriverPoolNotFoundError();
  return {...poolDetailDto(rows[0],canReadPay),...(await safetySummaries(context.companyId))(id)};
 }
}
