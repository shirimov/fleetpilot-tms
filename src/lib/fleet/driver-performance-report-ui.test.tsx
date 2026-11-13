import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import type {PrismaClient} from '@prisma/client';
import {AuthorizationService} from '../auth/authorization';
import {DriverPerformanceReportService} from './driver-performance-report';
import type {DriverWeekScope,DriverWeekInputs,DriverMetricKey} from './driver-performance';
import {createDriverPerformanceReport} from '@/components/fleet/DriverPerformanceReport';

// Synthetic server-composition/SSR tests; no HTTP, browser or production database acceptance.
function service(role:'ADMIN'|'MEMBER',configured:boolean,partial=false) {
 const authorization=new AuthorizationService({user:{findUnique:async()=>({id:'synthetic-user',isActive:true,activeCompanyId:'synthetic-company'})},companyMembership:{findFirst:async()=>({companyId:'synthetic-company',role})}} as unknown as PrismaClient,async()=>({user:{id:'synthetic-user'}}));
 const scope:DriverWeekScope={companyId:'synthetic-company',driverId:'source:synthetic-driver',start:'2026-01-04T00:00:00.000Z',end:'2026-01-11T00:00:00.000Z',timeZone:'UTC',currency:'USD'};
 const values:Partial<Record<DriverMetricKey,string>>={grossRevenueMinor:'1000000',earnedPayMinor:'300000',fuelCostMinor:'200000',otherDirectCostsMinor:'100000',paymentsExcludingAdvancesMinor:'250000',advancesMinor:'50000'};
 const inputs=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{scope:{...scope},value,coverage:partial&&key==='fuelCostMinor'?'PARTIAL':'COMPLETE',sourceRefs:['private-synthetic-source']}])) as DriverWeekInputs;
 return new DriverPerformanceReportService(authorization,{findDriver:async(companyId,driverId)=>({companyId,driverId}),reportingScope:async()=>configured?scope:null},{read:async()=>inputs});
}

test('server report renders authorized DTO with distinct cash and contribution and no raw evidence',async()=>{
 const Report=createDriverPerformanceReport(service('ADMIN',true));
 const html=renderToStaticMarkup(await Report({driverId:'source:synthetic-driver'}));
 for(const text of ['Contribution profit — not net profit','USD 4000.00','USD 3000.00','USD 2500.00','USD 500.00','Actual payments excluding advances','Advances paid','2026-01-04T00:00:00.000Z','UTC']) assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/sourceRefs|private-synthetic-source|Score: 0/);
});

test('presentation displays derived margin separately and leaves unavailable MPG and balance unknown',async()=>{
 const html=renderToStaticMarkup(await createDriverPerformanceReport(service('ADMIN',true))({driverId:'source:synthetic-driver'}));
 assert.match(html,/Contribution margin/);assert.match(html,/40.00%/);
 assert.match(html,/Miles per gallon/);assert.match(html,/Balance owed/);
 assert.doesNotMatch(html,/0.00 MPG|Balance owed[^<]*USD 0/);
});

test('server presentation propagates denial without rendering compensation',async()=>{
 const Report=createDriverPerformanceReport(service('MEMBER',true));
 await assert.rejects(Report({driverId:'source:synthetic-driver'}),/access|permission|authorized|denied/i);
});

test('server presentation explicitly discloses missing configuration and incomplete cost coverage',async()=>{
 const unknown=renderToStaticMarkup(await createDriverPerformanceReport(service('ADMIN',false))({driverId:'source:synthetic-driver'}));
 assert.match(unknown,/Reporting configuration is not confirmed/);assert.doesNotMatch(unknown,/USD 0/);
 const incomplete=renderToStaticMarkup(await createDriverPerformanceReport(service('ADMIN',true,true))({driverId:'source:synthetic-driver'}));
 assert.match(incomplete,/Incomplete contribution inputs/);assert.match(incomplete,/PARTIAL/);assert.match(incomplete,/Not calculated/);assert.doesNotMatch(incomplete,/USD 4000.00/);
});


test('configured but unconnected report renders Pacific interval with no invented money or score',async()=>{
 const scope:DriverWeekScope={companyId:'synthetic-company',driverId:'source:synthetic-driver',start:'2026-11-01T07:00:00.000Z',end:'2026-11-08T08:00:00.000Z',timeZone:'America/Los_Angeles',currency:'USD'};
 const Report=createDriverPerformanceReport({read:async()=>({status:'SOURCES_NOT_CONNECTED',report:null,scope})});
 const html=renderToStaticMarkup(await Report({driverId:scope.driverId}));
 for(const text of [scope.start,scope.end,scope.timeZone,'Sunday 00:00','end exclusive','Business sources are not connected','No financial result or driver ranking','Nov 1, 2026','Nov 8, 2026','00:00 PDT','00:00 PST','Weekly gross revenue','Driver compensation earned','Actual payments excluding advances','Advances paid','Verified fuel consumed','Not connected'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/USD 0|sourceRefs|synthetic-company/);
});
