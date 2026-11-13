// Pure preparation calculator. No DB/network access, score policy, or source authentication.
// Inputs must be independently attributed to this exact driver/company/week by a trusted connector.
export type DriverWeekScope={companyId:string;driverId:string;start:string;end:string;timeZone:string;currency:string};
export const driverMetricDefinitions={
 grossRevenueMinor:{label:'Weekly gross revenue',group:'Profitability',unit:'USD cents'},
 earnedPayMinor:{label:'Driver compensation earned',group:'Profitability',unit:'USD cents'},
 fuelCostMinor:{label:'Attributed fuel cost',group:'Profitability',unit:'USD cents'},
 otherDirectCostsMinor:{label:'Other attributable direct costs',group:'Profitability',unit:'USD cents'},
 paymentsExcludingAdvancesMinor:{label:'Actual payments excluding advances',group:'Payments',unit:'USD cents'},
 advancesMinor:{label:'Advances paid',group:'Payments',unit:'USD cents'},
 scheduledDays:{label:'Scheduled days',group:'Availability',unit:'days'},
 workedDays:{label:'Worked days',group:'Availability',unit:'days'},
 approvedOffDays:{label:'Approved time off',group:'Availability',unit:'days'},
 unplannedOffDays:{label:'Unplanned absences',group:'Availability',unit:'days'},
 requiredRestDays:{label:'Required rest',group:'Availability',unit:'days'},
 distanceMilliMiles:{label:'Attributed distance',group:'Fuel efficiency',unit:'thousandths of a mile'},
 fuelConsumedMilliGallons:{label:'Verified fuel consumed',group:'Fuel efficiency',unit:'thousandths of a US gallon'},
 completedLoads:{label:'Completed loads',group:'Load performance',unit:'count'},
 pickupOnTime:{label:'On-time pickups',group:'Load performance',unit:'count'},
 pickupLate:{label:'Late pickups',group:'Load performance',unit:'count'},
 pickupUnknown:{label:'Pickups missing timing evidence',group:'Load performance',unit:'count'},
 deliveryOnTime:{label:'On-time deliveries',group:'Load performance',unit:'count'},
 deliveryLate:{label:'Late deliveries',group:'Load performance',unit:'count'},
 deliveryUnknown:{label:'Deliveries missing timing evidence',group:'Load performance',unit:'count'},
 driverResponsibleDelays:{label:'Reviewed driver-responsible delays',group:'Load performance',unit:'count'},
 communicationTimely:{label:'Timely dispatcher updates',group:'Communication',unit:'count'},
 communicationLate:{label:'Late dispatcher updates',group:'Communication',unit:'count'},
 communicationUnknown:{label:'Updates awaiting review',group:'Communication',unit:'count'},
} as const;
export type DriverMetricKey=keyof typeof driverMetricDefinitions;
export type DriverMetricFact={scope:DriverWeekScope;value:string;coverage:'COMPLETE'|'PARTIAL';sourceRefs:string[]};
export type DriverWeekInputs=Partial<Record<DriverMetricKey,DriverMetricFact>>;
const moneyKeys=new Set<DriverMetricKey>(['grossRevenueMinor','earnedPayMinor','fuelCostMinor','otherDirectCostsMinor','paymentsExcludingAdvancesMinor','advancesMinor']);
const requiredContribution=['grossRevenueMinor','earnedPayMinor','fuelCostMinor','otherDirectCostsMinor'] as const;
const scopeFields=['companyId','driverId','start','end','timeZone','currency'] as const;

function validateScope(scope:DriverWeekScope) {
 if(scopeFields.some(key=>typeof scope[key]!=='string'||!scope[key]||scope[key].length>200)
  || !/^(source|driver):[^\s]+$/.test(scope.driverId) || scope.currency!=='USD')throw new Error('Invalid driver-week scope; only USD minor units supported.');
 for(const date of [scope.start,scope.end]) {
  const value=new Date(date);
  if(!Number.isFinite(value.getTime()) || value.toISOString()!==date)throw new Error('Explicit canonical UTC interval required.');
 }
 const duration=Date.parse(scope.end)-Date.parse(scope.start);
 if(duration<=0 || duration>8*24*60*60*1000)throw new Error('Invalid weekly interval.');
 new Intl.DateTimeFormat('en-US',{timeZone:scope.timeZone});
}
// Exact integer arithmetic; display ratios round half away from zero to two decimals.
function ratio(n:bigint|null,d:bigint|null):string|null {
 if(n===null || d===null || d<=BigInt(0))return null;
 const negative=n<BigInt(0),absolute=negative?-n:n;
 const scaled=(absolute*BigInt(100)+d/BigInt(2))/d;
 return `${negative&&scaled!==BigInt(0)?'-':''}${scaled/BigInt(100)}.${(scaled%BigInt(100)).toString().padStart(2,'0')}`;
}

export function calculateDriverWeek(scope:DriverWeekScope,inputs:DriverWeekInputs) {
 validateScope(scope);
 if(Object.keys(inputs).some(key=>!Object.hasOwn(driverMetricDefinitions,key)))throw new Error('Unknown performance metric.');
 type Metric={value:string|null;coverage:'MISSING'|'COMPLETE'|'PARTIAL';sourceRefs:string[]};
 const metrics={} as Record<DriverMetricKey,Metric>;
 for(const key of Object.keys(driverMetricDefinitions) as DriverMetricKey[]) {
  const fact=inputs[key];
  if(fact===undefined){metrics[key]={value:null,coverage:'MISSING',sourceRefs:[]};continue;}
  if(!fact || !fact.scope || scopeFields.some(field=>fact.scope[field]!==scope[field]))throw new Error('Metric scope mismatch.');
  if(!['COMPLETE','PARTIAL'].includes(fact.coverage))throw new Error('Invalid coverage.');
  if(!Array.isArray(fact.sourceRefs)||fact.sourceRefs.length<1||fact.sourceRefs.length>50
   || fact.sourceRefs.some(ref=>typeof ref!=='string'||!ref.trim()||ref.length>200))throw new Error('Evidence reference required.');
  if(typeof fact.value!=='string'||! /^(0|-?[1-9]\d{0,17})$/.test(fact.value))throw new Error('Canonical integer metric required.');
  const value=BigInt(fact.value);
  if(!moneyKeys.has(key)&&value<BigInt(0))throw new Error('Negative operational metric.');
  if(driverMetricDefinitions[key].unit==='days'&&value>BigInt(7))throw new Error('Weekly day count exceeds seven.');
  metrics[key]={value:fact.value,coverage:fact.coverage,sourceRefs:[...fact.sourceRefs]};
 }
 const complete=(key:DriverMetricKey)=>metrics[key].coverage==='COMPLETE'?BigInt(metrics[key].value!):null;
 const missingContributionInputs=requiredContribution.filter(key=>complete(key)===null);
 const gross=complete('grossRevenueMinor'),fuel=complete('fuelCostMinor');
 const contribution=missingContributionInputs.length?null:gross!-complete('earnedPayMinor')!-fuel!-complete('otherDirectCostsMinor')!;
 const days=complete('workedDays'),miles=complete('distanceMilliMiles'),gallons=complete('fuelConsumedMilliGallons');
 const rates=(on:DriverMetricKey,late:DriverMetricKey,unknown:DriverMetricKey)=>{
  const a=complete(on),b=complete(late),u=complete(unknown);
  return {percent:a===null||b===null||u===null?null:ratio(a*BigInt(100),a+b),classified:a===null||b===null?null:(a+b).toString(),unknown:u?.toString()??null};
 };
 const pickup=rates('pickupOnTime','pickupLate','pickupUnknown');
 const delivery=rates('deliveryOnTime','deliveryLate','deliveryUnknown');
 const communication=rates('communicationTimely','communicationLate','communicationUnknown');
 return {
  scope:{...scope},metrics,missingContributionInputs,profitLabel:'Contribution profit — not net profit',
  contributionMinor:contribution?.toString()??null,
  contributionMarginPercent:ratio(contribution===null?null:contribution*BigInt(100),gross),
  grossPerWorkedDay:ratio(gross,days===null?null:days*BigInt(100)),
  contributionPerWorkedDay:ratio(contribution,days===null?null:days*BigInt(100)),
  contributionPerMile:ratio(contribution===null?null:contribution*BigInt(1000),miles===null?null:miles*BigInt(100)),
  fuelCostPerMile:ratio(fuel===null?null:fuel*BigInt(1000),miles===null?null:miles*BigInt(100)),
  milesPerGallon:ratio(miles,gallons),
  pickup:{onTimePercent:pickup.percent,classified:pickup.classified,unknown:pickup.unknown},
  delivery:{onTimePercent:delivery.percent,classified:delivery.classified,unknown:delivery.unknown},
  communication:{timelyPercent:communication.percent,classified:communication.classified,unknown:communication.unknown},
  // No balance calculation without settlement/payment/advance allocation evidence.
  balanceOwedMinor:null,overallScore:null,scoringStatus:'POLICY_NOT_CONFIGURED' as const,
 };
}
