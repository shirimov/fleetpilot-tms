// Server composition root. Server components / route handlers only; never client workspaces.
import {pacificReportingWeek} from './driver-performance-week';
import type {PrismaClient} from '@prisma/client';
import {authorizationService} from '../auth/authorization';
import {prisma} from '../prisma';
import {DriverPerformanceReportService,type DriverPerformanceRepository} from './driver-performance-report';

// Small read-only identity adapter: existing source/canonical roster tables, no pay/contact reads.
// No source-to-canonical inference and no accounting adapter are implemented here.
export class DriverPerformanceRepositoryReader implements DriverPerformanceRepository {
 constructor(private readonly database:Pick<PrismaClient,'$queryRaw'>,private readonly now:()=>Date=()=>new Date()) {}
 async findDriver(companyId:string,driverId:string) {
  if(!/^(source|driver):[^\s]+$/.test(driverId)) return null;
  const rawId=driverId.slice(driverId.indexOf(':')+1);
  const rows=driverId.startsWith('source:')
   ?await this.database.$queryRaw<{companyId:string;driverId:string}[]>`SELECT "companyId",${driverId} AS "driverId" FROM "DriverSourceProfile" WHERE id=${rawId} AND "companyId"=${companyId}`
   :await this.database.$queryRaw<{companyId:string;driverId:string}[]>`SELECT "companyId",${driverId} AS "driverId" FROM "Driver" WHERE id=${rawId} AND "companyId"=${companyId}`;
  return rows.length===1?rows[0]:null;
 }
 async reportingScope(companyId:string,driverId:string) {
  // Trusted owner policy, not caller configuration. Currency is the existing calculator contract.
  return {companyId,driverId,...pacificReportingWeek(this.now()),currency:'USD'};
 }

}
export const driverPerformanceReportService=new DriverPerformanceReportService(authorizationService,new DriverPerformanceRepositoryReader(prisma),null);
