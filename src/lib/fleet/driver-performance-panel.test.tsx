import React from 'react';
import test from 'node:test';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import type {DriverPerformanceResult} from './driver-performance-report';

const result:DriverPerformanceResult={status:'SOURCES_NOT_CONNECTED',report:null,scope:{companyId:'synthetic-company',driverId:'source:exact',start:'2026-03-08T08:00:00.000Z',end:'2026-03-15T07:00:00.000Z',timeZone:'America/Los_Angeles',currency:'USD'}};
async function panelModule() {
 const module=await import('@/components/fleet/DriverPerformancePanel').catch(()=>null);
 assert.ok(module,'Client Performance panel is not implemented');return module;
}
test('client loads only exact tagged driver from protected GET with no-store and cancellation',async()=>{
 const {loadDriverPerformance}=await panelModule(),controller=new AbortController();
 const received=await loadDriverPerformance('source:exact',controller.signal,async(url,options)=>{
  assert.equal(url,'/api/drivers/pool/source%3Aexact/performance');
  assert.equal(options?.cache,'no-store');assert.equal(options?.signal,controller.signal);
  assert.equal(options?.method,'GET');assert.equal(options?.credentials,'same-origin');assert.equal(options?.body,undefined);
  return Response.json(result);
 });assert.deepEqual(received,result);
 for(const status of [401,403,404,500])await assert.rejects(loadDriverPerformance('source:exact',controller.signal,async()=>Response.json({error:'private SQL error'},{status})),/^Error: Unable to load performance report. Check access or retry.$/);
});

test('panel states render unavailable configured week and never show previous driver facts',async()=>{
 const {DriverPerformancePanelState}=await panelModule();
 const render=(driverId:string,state:Parameters<typeof DriverPerformancePanelState>[0]['state'])=>renderToStaticMarkup(<DriverPerformancePanelState driverId={driverId} state={state}/>);
 assert.match(render('source:exact',null),/Loading performance/);
 const loaded=render('source:exact',{driverId:'source:exact',result});
 for(const text of ['Business sources are not connected','America/Los_Angeles','2026-03-08T08:00:00.000Z'])assert.ok(loaded.includes(text),text);
 assert.doesNotMatch(loaded,/USD 0|sourceRefs/);
 const changed=render('driver:exact',{driverId:'source:exact',result});
 assert.match(changed,/Loading performance/);assert.doesNotMatch(changed,/2026-03-08/);
 const denied=render('source:exact',{driverId:'source:exact',error:true});assert.match(denied,/role="alert"/);assert.doesNotMatch(denied,/2026-03-08|private SQL/);
});


test('actual driver profile mounts the guarded Performance panel instead of the unconfigured preparation',async()=>{
 const {DriverPoolDetail}=await import('@/components/fleet/DriverPoolWorkspace');
 const html=renderToStaticMarkup(<DriverPoolDetail driver={{id:'source:exact',firstName:null,lastName:null,fullName:'Synthetic driver',employmentStatus:'UNKNOWN',safetyRating:'NOT_RATED',phone:null,email:null,hireDate:null,terminationDate:null,rehireDate:null,compensation:undefined}}/>);
 assert.match(html,/Loading performance report/);
 assert.doesNotMatch(html,/Not configured — no reporting cutoff is assumed/);
});


test('client panel import graph never loads the server singleton, authorization or database',async()=>{
 await panelModule();
 const loaded=Object.keys(createRequire(import.meta.url).cache);
 assert.deepEqual(loaded.filter(path=>/src\/lib\/(fleet\/driver-performance-server|auth\/authorization|prisma)\./.test(path)),[]);
});
