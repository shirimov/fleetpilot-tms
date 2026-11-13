import {NextResponse} from 'next/server';
import type {CompanyAuthorization} from '@/lib/auth/authorization';
import {authorizationErrorResponse} from '@/lib/auth/auth-route-response';
import {PRIVATE_NO_STORE_HEADERS} from '@/lib/security/cache-headers';
import {DriverPoolNotFoundError,type DriverPoolService} from './driver-pool-service';
function failure(error:unknown) {
 const auth=authorizationErrorResponse(error);if(auth)return auth;
 return NextResponse.json({error:error instanceof DriverPoolNotFoundError?'Not found':'Unable to load driver pool.'},{status:error instanceof DriverPoolNotFoundError?404:500,headers:PRIVATE_NO_STORE_HEADERS});
}
export function createDriverPoolHandlers(deps:{requireCompany:()=>Promise<CompanyAuthorization>;service:Pick<DriverPoolService,'list'|'detail'>}) {
 return {
  list:async(request:Request)=>{
   try {
    const context=await deps.requireCompany(),query=new URL(request.url).searchParams;
    const page=query.get('page')??'1',status=query.get('status')??'ALL',search=query.get('q')??'';
    if(search.length>120||!/^[1-9]\d{0,4}$/.test(page)||Number(page)>10000||!['ALL','active','terminated','invited','UNKNOWN'].includes(status)) return NextResponse.json({error:'Invalid search, page or lifecycle filter.'},{status:400,headers:PRIVATE_NO_STORE_HEADERS});
    return NextResponse.json(await deps.service.list(context,{page:Number(page),status,search}),{headers:PRIVATE_NO_STORE_HEADERS});
   }catch(error){return failure(error);}
  },
  detail:async(id:string)=>{
   try{return NextResponse.json(await deps.service.detail(await deps.requireCompany(),id),{headers:PRIVATE_NO_STORE_HEADERS});}catch(error){return failure(error);}
  },
 };
}
