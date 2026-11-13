import React from 'react';
import type {DriverPerformanceReportService} from '@/lib/fleet/driver-performance-report';
import {driverPerformanceReportService} from '@/lib/fleet/driver-performance-server';
import DriverPerformanceReportView from './DriverPerformanceReportView';

// Optional server-only composition. The mounted client panel imports only the DTO view.
export function createDriverPerformanceReport(service:Pick<DriverPerformanceReportService,'read'>) {
 return async function DriverPerformanceReport({driverId}:{driverId:string}) {
  return <DriverPerformanceReportView result={await service.read(driverId)}/>;
 };
}
export default createDriverPerformanceReport(driverPerformanceReportService);
