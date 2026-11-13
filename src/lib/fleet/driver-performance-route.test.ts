import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {AuthorizationService} from '../auth/authorization';
import {DriverPerformanceReportService} from './driver-performance-report';
import {DriverPerformanceRepositoryReader} from './driver-performance-server';

function fixture(role:'ADMIN'|'OWNER'|'MEMBER'='ADMIN',signedIn=true,binding='correct') {
 const queries:{sql:string;values:unknown[]}[]=[];
 const authorization=new AuthorizationService({user:{findUnique:async()=>({id:'synthetic-user',isActive:true,activeCompanyId:'company-owned-by-server'})},companyMembership:{findFirst:async()=>({companyId:'company-owned-by-server',role})}} as unknown as PrismaClient,async()=>signedIn?{user:{id:'synthetic-user'}}:null);
 const repository=new DriverPerformanceRepositoryReader({$queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{
  queries.push({sql:strings.join('?'),values});
  return binding==='missing'?[]:[{companyId:binding==='wrong-company'?'other':'company-owned-by-server',driverId:binding==='wrong-driver'?'driver:exact':values[0]}];
 }} as unknown as PrismaClient,()=>new Date('2026-11-01T07:00:00.000Z'));
 return {queries,authorization,repository,service:new DriverPerformanceReportService(authorization,repository,null)};
}
async function factory() {
 const module=await import('./driver-performance-route').catch(()=>null);
 assert.ok(module,'Protected Performance GET handler is not implemented');
 return module.createDriverPerformanceGet;
}

test('Performance GET denies unauthenticated and MEMBER before roster/source queries',async()=>{
 const create=await factory();
 for(const [signedIn,role,status] of [[false,'ADMIN',401],[true,'MEMBER',403]] as const) {
  const f=fixture(role,signedIn),response=await create(f.service)(new Request('http://synthetic.test/report'),{params:Promise.resolve({id:'source:exact'})});
  assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(f.queries,[]);
 }
});

test('Performance GET owns company/driver/week and exposes configured unavailable sources without facts',async()=>{
 const create=await factory();
 for(const role of ['ADMIN','OWNER'] as const) {
  const f=fixture(role);
  const response=await create(f.service)(new Request('http://synthetic.test/report?companyId=attacker&timeZone=UTC&start=bad&provider=COMPLETE'),{params:Promise.resolve({id:'source:exact'})});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{status:'SOURCES_NOT_CONNECTED',report:null,scope:{companyId:'company-owned-by-server',driverId:'source:exact',start:'2026-11-01T07:00:00.000Z',end:'2026-11-08T08:00:00.000Z',timeZone:'America/Los_Angeles',currency:'USD'}});
  assert.equal(f.queries.length,1);assert.deepEqual(f.queries[0].values,['source:exact','exact','company-owned-by-server']);
 }
});

test('Performance GET refuses different company, namespace, invalid IDs and redacts internal failures',async()=>{
 const create=await factory();
 for(const binding of ['missing','wrong-company','wrong-driver']) {
  const f=fixture('ADMIN',true,binding),response=await create(f.service)(new Request('http://synthetic.test/report'),{params:Promise.resolve({id:'source:exact'})});
  assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(await response.json(),{error:'Not found'});
 }
 const f=fixture(),invalid=await create(f.service)(new Request('http://synthetic.test/report'),{params:Promise.resolve({id:'exact'})});
 assert.equal(invalid.status,404);assert.equal(f.queries.length,0);
 const failed=await create({read:async()=>{throw new Error('secret-sourceRef-or-SQL');}})(new Request('http://synthetic.test/report'),{params:Promise.resolve({id:'source:exact'})});
 assert.equal(failed.status,500);assert.equal(failed.headers.get('cache-control'),'private, no-store');assert.deepEqual(await failed.json(),{error:'Unable to load performance report.'});
});


test('real protected handler response feeds client loader and DTO component without network or database',async()=>{
 const React=(await import('react')).default;
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {loadDriverPerformance,DriverPerformancePanelState}=await import('@/components/fleet/DriverPerformancePanel');
 const create=await factory(),f=fixture(),get=create(f.service);
 const loaded=await loadDriverPerformance('source:exact',new AbortController().signal,async(url,options)=>get(new Request(`http://synthetic.test${url}`,options),{params:Promise.resolve({id:'source:exact'})}));
 const html=renderToStaticMarkup(React.createElement(DriverPerformancePanelState,{driverId:'source:exact',state:{driverId:'source:exact',result:loaded}}));
 assert.match(html,/Business sources are not connected/);assert.match(html,/America\/Los_Angeles/);assert.match(html,/00:00 PDT/);assert.match(html,/00:00 PST/);
 assert.doesNotMatch(html,/sourceRefs|USD 0|Score: 0/);
});

test('Next Performance route is mounted as a dynamic read-only GET export',async()=>{
 const route=await import('@/app/api/drivers/pool/[id]/performance/route');
 assert.equal(route.dynamic,'force-dynamic');assert.equal(typeof route.GET,'function');
 assert.deepEqual(Object.keys(route).filter(key=>/^(GET|POST|PUT|DELETE|PATCH)$/.test(key)),['GET']);
});


test('protected GET strips provider evidence references from financial DTO and redacts provider errors',async()=>{
 const create=await factory(),f=fixture();
 const scope=await f.repository.reportingScope('company-owned-by-server','source:exact');
 const provider={read:async(received:Readonly<typeof scope>)=>{
  assert.deepEqual(received,scope);assert.equal(Object.isFrozen(received),true);
  return {grossRevenueMinor:{scope,value:'12345',coverage:'COMPLETE' as const,sourceRefs:['private-evidence-reference']}};
 }};
 const response=await create(new DriverPerformanceReportService(f.authorization,f.repository,provider))(new Request('http://synthetic.test/report'),{params:Promise.resolve({id:'source:exact'})});
 const body=await response.json();
 assert.equal(body.status,'INCOMPLETE');assert.equal(body.report.contributionMinor,null);assert.equal(body.report.metrics.grossRevenueMinor.value,'12345');
 assert.doesNotMatch(JSON.stringify(body),/sourceRefs|private-evidence-reference/);
 const failed=await create(new DriverPerformanceReportService(f.authorization,f.repository,{read:async()=>{throw new Error('private-evidence-reference');}}))(new Request('http://synthetic.test/report'),{params:Promise.resolve({id:'source:exact'})});
 assert.equal(failed.status,500);assert.doesNotMatch(await failed.text(),/private-evidence-reference/);
});
