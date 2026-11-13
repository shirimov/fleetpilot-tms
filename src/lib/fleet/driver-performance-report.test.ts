import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {AuthorizationService} from '../auth/authorization';
import {AuthorizationDeniedError} from '../auth/auth-errors';
import type {DriverWeekScope,DriverWeekInputs,DriverMetricKey} from './driver-performance';
import {DriverPerformanceReportService} from './driver-performance-report';

// UTC below is synthetic adapter configuration, not the production Pacific policy.
const scope:DriverWeekScope={companyId:'synthetic-company',driverId:'source:synthetic-driver',start:'2026-01-04T00:00:00.000Z',end:'2026-01-11T00:00:00.000Z',timeZone:'UTC',currency:'USD'};
function facts():DriverWeekInputs {
 const values:Partial<Record<DriverMetricKey,string>>={grossRevenueMinor:'1000000',earnedPayMinor:'300000',fuelCostMinor:'200000',otherDirectCostsMinor:'100000',paymentsExcludingAdvancesMinor:'250000',advancesMinor:'50000'};
 return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{scope:{...scope},value,coverage:'COMPLETE',sourceRefs:[`private-synthetic:${key}`]}])) as DriverWeekInputs;
}


// Synthetic repository/session protocol tests; no database or production source reads.
function fixture(role:'MEMBER'|'ADMIN'='ADMIN') {
 const calls:string[]=[];
 const database={user:{findUnique:async()=>({id:'synthetic-user',email:'fixture@example.test',displayName:null,isActive:true,activeCompanyId:'synthetic-company'})},companyMembership:{findFirst:async()=>({companyId:'synthetic-company',role})}} as unknown as PrismaClient;
 const authorization=new AuthorizationService(database,async()=>({user:{id:'synthetic-user'}}));
 const repository={findDriver:async(companyId:string,driverId:string)=>{calls.push(`driver:${companyId}:${driverId}`);return {companyId,driverId};},reportingScope:async()=>{calls.push('configuration');return null;}};
 const provider={read:async()=>{calls.push('metrics');return {};}};
 return {calls,authorization,repository,provider};
}

test('missing server reporting configuration blocks metric reads without assuming timezone or week',async()=>{
 const f=fixture();
 const result=await new DriverPerformanceReportService(f.authorization,f.repository,f.provider).read('source:synthetic-driver');
 assert.deepEqual(result,{status:'REPORTING_NOT_CONFIGURED',report:null});
 assert.deepEqual(f.calls,['driver:synthetic-company:source:synthetic-driver','configuration']);
});

test('authorized server-provider DTO preserves contribution without double-counting payments and advances',async()=>{
 const f=fixture();
 const repository={...f.repository,reportingScope:async()=>({...scope})};
 const provider={read:async(received:DriverWeekScope)=>{assert.deepEqual(received,scope);return facts();}};
 const result=await new DriverPerformanceReportService(f.authorization,repository,provider).read(scope.driverId);
 assert.equal(result?.status,'AVAILABLE');
 assert.equal(result?.report?.contributionMinor,'400000');
 assert.equal(result?.report?.metrics.earnedPayMinor.value,'300000');
 assert.equal(result?.report?.metrics.paymentsExcludingAdvancesMinor.value,'250000');
 assert.equal(result?.report?.metrics.advancesMinor.value,'50000');
 assert.doesNotMatch(JSON.stringify(result),/sourceRefs|private-synthetic/);
});

test('guarded report leaves incomplete costs unknown instead of zero',async()=>{
 const f=fixture(),inputs=facts(); inputs.fuelCostMinor!.coverage='PARTIAL';
 const result=await new DriverPerformanceReportService(f.authorization,{...f.repository,reportingScope:async()=>({...scope})},{read:async()=>inputs}).read(scope.driverId);
 assert.equal(result?.status,'INCOMPLETE');
 assert.equal(result?.report?.contributionMinor,null);
 assert.deepEqual(result?.report?.missingContributionInputs,['fuelCostMinor']);
});

test('configuration and provider scope mismatches fail closed before exposing metrics',async()=>{
 const f=fixture();let reads=0;
 for(const wrong of [{...scope,companyId:'other'},{...scope,driverId:'driver:synthetic-driver'},{...scope,timeZone:''}]) {
  await assert.rejects(new DriverPerformanceReportService(f.authorization,{...f.repository,reportingScope:async()=>wrong},{read:async()=>{reads++;return facts();}}).read(scope.driverId));
 }
 assert.equal(reads,0);
 const inputs=facts();inputs.earnedPayMinor!.scope.driverId='driver:synthetic-driver';
 await assert.rejects(new DriverPerformanceReportService(f.authorization,{...f.repository,reportingScope:async()=>({...scope})},{read:async()=>inputs}).read(scope.driverId),/scope/);
});

test('configured report with no source adapter is explicitly unconnected',async()=>{
 const f=fixture();
 assert.deepEqual(await new DriverPerformanceReportService(f.authorization,{...f.repository,reportingScope:async()=>({...scope})},null).read(scope.driverId),{status:'SOURCES_NOT_CONNECTED',report:null,scope});
});

test('actual module guards deny finance and HR to MEMBER before repository/provider reads',async()=>{
 const f=fixture('MEMBER');
 await assert.rejects(f.authorization.requireModule('finance'),AuthorizationDeniedError);
 await assert.rejects(f.authorization.requireModule('hr'),AuthorizationDeniedError);
 await assert.rejects(new DriverPerformanceReportService(f.authorization,f.repository,f.provider).read('source:synthetic-driver'),AuthorizationDeniedError);
 assert.deepEqual(f.calls,[]);
});

test('binds exact company and tagged driver before reading reporting configuration',async()=>{
 const f=fixture();
 const service=new DriverPerformanceReportService(f.authorization,f.repository,f.provider);
 for(const driverId of ['synthetic-driver','source:','source:synthetic driver']) await assert.rejects(service.read(driverId));
 assert.deepEqual(f.calls,[]);
 for(const binding of [null,{companyId:'other-company',driverId:'source:synthetic-driver'},{companyId:'synthetic-company',driverId:'driver:synthetic-driver'}]) {
  const repository={...f.repository,findDriver:async()=>binding};
  await assert.rejects(new DriverPerformanceReportService(f.authorization,repository,f.provider).read('source:synthetic-driver'),/Not found/);
 }
 assert.deepEqual(f.calls,[]);
});
