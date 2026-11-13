import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDriverWeek,type DriverWeekScope,type DriverWeekInputs,type DriverMetricKey} from './driver-performance';

// All amounts, identifiers, dates, and records below are invented test fixtures.
const scope:DriverWeekScope={companyId:'synthetic-company',driverId:'source:synthetic-driver',start:'2026-01-05T00:00:00.000Z',end:'2026-01-12T00:00:00.000Z',timeZone:'UTC',currency:'USD'};
function facts(values:Partial<Record<DriverMetricKey,string>>):DriverWeekInputs {
 return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{scope:{...scope},value,coverage:'COMPLETE',sourceRefs:[`synthetic:${key}`]}])) as DriverWeekInputs;
}
const financial=()=>facts({grossRevenueMinor:'1000000',earnedPayMinor:'300000',fuelCostMinor:'200000',otherDirectCostsMinor:'100000',paymentsExcludingAdvancesMinor:'250000',advancesMinor:'50000'});

test('calculates contribution, never subtracting actual payments or advances a second time',()=>{
 const result=calculateDriverWeek(scope,financial());
 assert.equal(result.contributionMinor,'400000');assert.equal(result.contributionMarginPercent,'40.00');
 assert.equal(result.metrics.paymentsExcludingAdvancesMinor.value,'250000');assert.equal(result.metrics.advancesMinor.value,'50000');
 assert.equal(result.overallScore,null);assert.equal(result.scoringStatus,'POLICY_NOT_CONFIGURED');
 assert.equal(result.profitLabel,'Contribution profit — not net profit');
});
test('missing or partial direct costs suppress contribution rather than using zero',()=>{
 const missing=financial();delete missing.fuelCostMinor;
 assert.equal(calculateDriverWeek(scope,missing).contributionMinor,null);
 const partial=financial();partial.fuelCostMinor!.coverage='PARTIAL';
 const r=calculateDriverWeek(scope,partial);assert.equal(r.contributionMinor,null);assert.ok(r.missingContributionInputs.includes('fuelCostMinor'));
 assert.equal(r.metrics.fuelCostMinor.value,'200000');assert.equal(r.metrics.fuelCostMinor.coverage,'PARTIAL');
});
test('explicit evidence-backed zero differs from missing and losses remain negative',()=>{
 const f=financial();f.grossRevenueMinor!.value='10000';f.otherDirectCostsMinor!.value='0';
 assert.equal(calculateDriverWeek(scope,f).contributionMinor,'-490000');
 f.grossRevenueMinor!.value='0';assert.equal(calculateDriverWeek(scope,f).contributionMarginPercent,null);
});
test('requires exact same company driver period timezone and currency for every input',()=>{
 for(const field of ['companyId','driverId','start','end','timeZone','currency'] as const){
  const f=financial();f.earnedPayMinor!.scope={...scope,[field]:'different'};
  assert.throws(()=>calculateDriverWeek(scope,f),/scope/);
 }
});
test('rejects unsupported currencies, invalid intervals, timezone, unreferenced and malformed amounts',()=>{
 assert.throws(()=>calculateDriverWeek({...scope,currency:'EUR'},{}));
 assert.throws(()=>calculateDriverWeek({...scope,end:scope.start},{}));
 assert.throws(()=>calculateDriverWeek({...scope,timeZone:'not/a-zone'},{}));
 for(const value of ['1.2','01','-0','1e3',' 100','900719925474099999999999999999']){
  const f=financial();f.earnedPayMinor!.value=value;assert.throws(()=>calculateDriverWeek(scope,f));
 }
 const f=financial();f.earnedPayMinor!.sourceRefs=[];assert.throws(()=>calculateDriverWeek(scope,f),/reference/);
});
test('preserves exact integer cents beyond Number precision',()=>{
 const f=facts({grossRevenueMinor:'9007199254740993',earnedPayMinor:'1',fuelCostMinor:'1',otherDirectCostsMinor:'1'});
 assert.equal(calculateDriverWeek(scope,f).contributionMinor,'9007199254740990');
});
test('calculates comparable unit metrics only from complete attributed quantities',()=>{
 const f={...financial(),...facts({workedDays:'5',distanceMilliMiles:'2000000',fuelConsumedMilliGallons:'250000'})};
 const r=calculateDriverWeek(scope,f);
 assert.equal(r.grossPerWorkedDay,'2000.00');assert.equal(r.contributionPerWorkedDay,'800.00');
 assert.equal(r.contributionPerMile,'2.00');assert.equal(r.fuelCostPerMile,'1.00');assert.equal(r.milesPerGallon,'8.00');
 f.fuelConsumedMilliGallons!.coverage='PARTIAL';assert.equal(calculateDriverWeek(scope,f).milesPerGallon,null);
});
test('on-time rates distinguish late from unknown and disclose measured coverage',()=>{
 const f=facts({pickupOnTime:'8',pickupLate:'2',pickupUnknown:'3'});
 const r=calculateDriverWeek(scope,f);
 assert.equal(r.pickup.onTimePercent,'80.00');assert.equal(r.pickup.unknown,'3');assert.equal(r.pickup.classified,'10');
 assert.equal(r.delivery.onTimePercent,null);
 assert.equal(calculateDriverWeek(scope,facts({pickupOnTime:'0',pickupLate:'0',pickupUnknown:'3'})).pickup.onTimePercent,null);
});
test('availability and communication facts never create an automatic penalty or score',()=>{
 const r=calculateDriverWeek(scope,facts({approvedOffDays:'2',unplannedOffDays:'1',requiredRestDays:'1',communicationTimely:'4',communicationLate:'2',communicationUnknown:'3'}));
 assert.equal(r.overallScore,null);assert.equal(r.metrics.approvedOffDays.value,'2');
 assert.equal(r.communication.timelyPercent,'66.67');
 assert.throws(()=>calculateDriverWeek(scope,facts({workedDays:'8'})));
 assert.throws(()=>calculateDriverWeek(scope,facts({pickupOnTime:'-1'})));
});
test('empty profile has no invented money performance or pay balance',()=>{
 const r=calculateDriverWeek(scope,{});assert.equal(r.contributionMinor,null);assert.equal(r.milesPerGallon,null);
 assert.equal(r.metrics.paymentsExcludingAdvancesMinor.value,null);assert.equal(r.balanceOwedMinor,null);
 assert.equal(r.pickup.onTimePercent,null);
});
