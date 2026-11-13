import test from 'node:test';
import assert from 'node:assert/strict';
import type {CompanyAuthorization} from '../auth/authorization';
import {createDriverPoolHandlers} from './driver-pool-route';
import {AuthorizationDeniedError} from '../auth/auth-errors';

test('pool routes use private no-store and validate lifecycle filters',async()=>{
 const handlers=createDriverPoolHandlers({requireCompany:async()=>({companyId:'synthetic',role:'OWNER'}) as CompanyAuthorization,service:{list:async()=>({page:1,status:'active',search:'',hasMore:false,drivers:[]}),detail:async()=>{throw new Error('not called');}}});
 const ok=await handlers.list(new Request('https://synthetic.invalid/api/drivers/pool?status=active'));
 assert.equal(ok.status,200); assert.match(ok.headers.get('cache-control')??'',/no-store/);
 assert.equal((await handlers.list(new Request('https://synthetic.invalid/api/drivers/pool?page=-1'))).status,400);
});
test('search flows to service and rejects oversized input',async()=>{
 let observed:unknown;
 const handlers=createDriverPoolHandlers({requireCompany:async()=>({companyId:'synthetic',role:'OWNER'}) as CompanyAuthorization,service:{list:async(_context,filter)=>{observed=filter;return {page:1,status:'ALL',search:'Ada',hasMore:false,drivers:[]};},detail:async()=>{throw new Error('unused');}}});
 assert.equal((await handlers.list(new Request('https://synthetic.invalid/api/drivers/pool?q=Ada'))).status,200);
 assert.deepEqual(observed,{page:1,status:'ALL',search:'Ada'});
 assert.equal((await handlers.list(new Request('https://synthetic.invalid/api/drivers/pool?q='+ 'x'.repeat(121)))).status,400);
});
test('authorization failures never echo internal error data',async()=>{
 const handlers=createDriverPoolHandlers({requireCompany:async()=>{throw new AuthorizationDeniedError();},service:{list:async()=>{throw new Error('unexpected');},detail:async()=>{throw new Error('unexpected');}}});
 const response=await handlers.detail('source:synthetic');assert.equal(response.status,403);
});
