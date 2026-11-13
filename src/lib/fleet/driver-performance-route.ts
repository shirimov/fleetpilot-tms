import {NextResponse} from 'next/server';
import {AuthenticationRequiredError,AuthorizationDeniedError} from '../auth/auth-errors';
import {PRIVATE_NO_STORE_HEADERS} from '../security/cache-headers';
import {DriverPerformanceNotFoundError,type DriverPerformanceReportService} from './driver-performance-report';

// Trusted server dependency only. No request body, facts, provider or reporting configuration accepted.
export function createDriverPerformanceGet(service:Pick<DriverPerformanceReportService,'read'>) {
 return async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
   return NextResponse.json(await service.read((await params).id),{headers:PRIVATE_NO_STORE_HEADERS});
  }catch(error) {
   const status=error instanceof AuthenticationRequiredError?401:error instanceof AuthorizationDeniedError?403:error instanceof DriverPerformanceNotFoundError?404:500;
   const message=status===401?'Authentication is required.':status===403?'You do not have access to this resource.':status===404?'Not found':'Unable to load performance report.';
   return NextResponse.json({error:message},{status,headers:PRIVATE_NO_STORE_HEADERS});
  }
 };
}
