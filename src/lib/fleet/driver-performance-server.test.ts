import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {DriverPerformanceRepositoryReader} from './driver-performance-server';

// Synthetic SQL protocol tests, not PostgreSQL or migration acceptance.
test('production driver reader selects only exact identity and company for source and canonical IDs',async()=>{
 const calls:{sql:string;values:unknown[]}[]=[];
 const database={$queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{calls.push({sql:strings.join('?'),values});return [{companyId:'synthetic-company',driverId:values[0]}];}} as unknown as PrismaClient;
 const reader=new DriverPerformanceRepositoryReader(database);
 for(const id of ['source:synthetic-id','driver:synthetic-id']) {
  assert.deepEqual(await reader.findDriver('synthetic-company',id),{companyId:'synthetic-company',driverId:id});
 }
 assert.equal(calls.length,2);
 for(const call of calls) {
  assert.deepEqual(call.values.slice(1),['synthetic-id','synthetic-company']);
  assert.doesNotMatch(call.sql,/SELECT \*|compensation|payRate|phone|email/);
  assert.match(call.sql,/"companyId"=\?/);
 }
 assert.match(calls[0].sql,/"DriverSourceProfile"/);assert.match(calls[1].sql,/"Driver"/);

});

test('repository owns current Pacific configuration with no financial query',async()=>{
 let queries=0;
 const database={$queryRaw:async()=>{queries++;throw new Error('No source query allowed');}} as unknown as PrismaClient;
 const reader=new DriverPerformanceRepositoryReader(database,()=>new Date('2026-03-08T08:00:00.000Z'));
 assert.deepEqual(await reader.reportingScope('synthetic-company','source:synthetic-driver'),{companyId:'synthetic-company',driverId:'source:synthetic-driver',currency:'USD',start:'2026-03-08T08:00:00.000Z',end:'2026-03-15T07:00:00.000Z',timeZone:'America/Los_Angeles'});
 assert.equal(queries,0);
});
