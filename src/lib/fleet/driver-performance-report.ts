import type {AuthorizationService} from '../auth/authorization';
import {AuthorizationDeniedError} from '../auth/auth-errors';
import {roleCanAccessModule} from '../auth/module-permissions';
import {calculateDriverWeek,driverMetricDefinitions,type DriverMetricKey,type DriverWeekScope,type DriverWeekInputs} from './driver-performance';

export class DriverPerformanceNotFoundError extends Error {constructor(){super('Not found');}}

type DriverBinding={companyId:string;driverId:string};
export interface DriverPerformanceRepository {
 findDriver(companyId:string,driverId:string):Promise<DriverBinding|null>;
 // Must resolve reviewed server configuration, never request-supplied intervals/timezones.
 reportingScope(companyId:string,driverId:string):Promise<DriverWeekScope|null>;
}
export interface DriverPerformanceMetricProvider {
 // Trusted server adapter owns attribution, evidence and completeness. COMPLETE is not authentication.
 // No production implementation is connected. Do not use an upload/body as this provider.
 read(scope:Readonly<DriverWeekScope>):Promise<DriverWeekInputs>;
}
type Calculation=ReturnType<typeof calculateDriverWeek>;
export type DriverPerformanceDto=Omit<Calculation,'metrics'> & {
 metrics:Record<DriverMetricKey,{value:string|null;coverage:'MISSING'|'COMPLETE'|'PARTIAL'}>;
};
export type DriverPerformanceResult=
 | {status:'REPORTING_NOT_CONFIGURED';report:null}
 | {status:'SOURCES_NOT_CONNECTED';report:null;scope:DriverWeekScope}
 | {status:'AVAILABLE'|'INCOMPLETE';report:DriverPerformanceDto};

// Server-owned dependencies only. Never construct these from a request body.
// The only public read parameter is the exact tagged driver ID, not facts or COMPLETE claims.
export class DriverPerformanceReportService {
 constructor(private readonly authorization:Pick<AuthorizationService,'requireModule'>,private readonly repository:DriverPerformanceRepository,private readonly provider:DriverPerformanceMetricProvider|null) {}
 async read(driverId:string):Promise<DriverPerformanceResult> {
  const context=await this.authorization.requireModule('finance');
  if(!roleCanAccessModule(context.role,'hr')||!roleCanAccessModule(context.role,'fleet')) throw new AuthorizationDeniedError();
  if(typeof driverId!=='string'||driverId.length>200||!/^(source|driver):[^\s]+$/.test(driverId)) throw new DriverPerformanceNotFoundError();
  const binding=await this.repository.findDriver(context.companyId,driverId);
  if(!binding||binding.companyId!==context.companyId||binding.driverId!==driverId) throw new DriverPerformanceNotFoundError();
  const configuredScope=await this.repository.reportingScope(context.companyId,driverId);
  if(!configuredScope) return {status:'REPORTING_NOT_CONFIGURED',report:null};
  const scope={...configuredScope};
  if(scope.companyId!==context.companyId||scope.driverId!==driverId) throw new Error('Reporting scope mismatch');
  calculateDriverWeek(scope,{}); // Validate configuration before any sensitive source read.
  if(!this.provider) return {status:'SOURCES_NOT_CONNECTED',report:null,scope};
  const inputs=await this.provider.read(Object.freeze({...scope}));
  const calculation=calculateDriverWeek(scope,inputs);
  // Allowlist DTO metric fields; raw evidence/source references never cross this boundary.
  const metrics={} as DriverPerformanceDto['metrics'];
  for(const key of Object.keys(driverMetricDefinitions) as DriverMetricKey[]) {
   const metric=calculation.metrics[key]; metrics[key]={value:metric.value,coverage:metric.coverage};
  }
  return {status:calculation.missingContributionInputs.length?'INCOMPLETE':'AVAILABLE',report:{...calculation,metrics}};
 }
}
