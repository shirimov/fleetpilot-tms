// Synthetic tagged-query transport only; no PostgreSQL or authentication acceptance.
// Run with the existing tsx loader because this exercises the actual TypeScript service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DriverPoolService, DriverPoolNotFoundError } from '../src/lib/fleet/driver-pool-service.ts';
import { AuthorizationDeniedError } from '../src/lib/auth/auth-errors.ts';

const context={companyId:'synthetic-company',role:'OWNER',user:{id:'synthetic-owner'}};

test('denied member cannot read either source or legacy driver detail before any query',async()=>{
 let queries=0;
 const service=new DriverPoolService({$queryRaw:async()=>{queries++;return [];}});
 for(const id of ['source:synthetic-id','driver:synthetic-id']) {
  await assert.rejects(service.detail({...context,role:'MEMBER'},id),AuthorizationDeniedError);
 }
 assert.equal(queries,0);
});

test('source and legacy detail bind exact company and identity; absent company-scoped rows stay not found',async()=>{
 const queries=[];
 const service=new DriverPoolService({$queryRaw:async(strings,...values)=>{queries.push({sql:strings.join('?'),values});return [];}});
 for(const prefix of ['source:','driver:']) {
  await assert.rejects(service.detail(context,`${prefix}synthetic-id' OR true --`),DriverPoolNotFoundError);
  const query=queries.at(-1);
  assert.match(query.sql,/WHERE id=\? AND "companyId"=\?/);
  assert.equal(query.values.at(-2),"synthetic-id' OR true --");
  assert.equal(query.values.at(-1),context.companyId);
  assert.ok(!query.sql.includes("OR true --"));
 }
 assert.equal(queries.length,2);
});

test('roster pagination keeps the sentinel out and projects no source, audit, contact or pay fields',async()=>{
 const rows=Array.from({length:51},(_,i)=>({id:`source:synthetic-${i}`,firstName:'Synthetic',lastName:'Test',fullName:null,lifecycleStatus:null,
  source:{phone:'synthetic-private'},sourceHash:'synthetic-hash',actorUserId:'synthetic-actor',evidenceSha256:'synthetic-envelope',email:'synthetic-contact',phone:'synthetic-phone',compensationAmount:'999'}));
 const before=structuredClone(rows);const queries=[];
 const service=new DriverPoolService({$queryRaw:async(strings,...values)=>{queries.push({sql:strings.join('?'),values});return rows;}});
 const result=await service.list(context,{page:2,status:'UNKNOWN',search:' Synthetic '});
 assert.equal(result.hasMore,true);assert.equal(result.drivers.length,50);
 assert.equal(result.drivers.some(row=>row.id==='source:synthetic-50'),false);
 assert.deepEqual(Object.keys(result.drivers[0]).sort(),['employmentStatus','firstName','fullName','id','internalRating','lastName','photoVersion','safetyRating'].sort());
 assert.equal(result.drivers[0].employmentStatus,'UNKNOWN');
 assert.equal(queries[0].values.filter(value=>value===context.companyId).length,2);
 assert.equal(queries[0].values.at(-1),50);
 assert.deepEqual(rows,before);
});
