import {createDriverPerformanceGet} from '@/lib/fleet/driver-performance-route';
import {driverPerformanceReportService} from '@/lib/fleet/driver-performance-server';
export const dynamic='force-dynamic';
export const GET=createDriverPerformanceGet(driverPerformanceReportService);
