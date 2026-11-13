import { prisma } from '@/lib/prisma';
import { fleetAuthorizationService } from './fleet-authorization';
import { DriverPoolService } from './driver-pool-service';
import { DriverSafetyCatalog } from './driver-safety-catalog';
import { DriverSafetyService } from './driver-safety-service';
import { DriverSafetyFiles } from './driver-safety-files';

export async function driverSafetyService(id: string, expectedRevision?: string) {
  // Authorize before touching local private storage, including configuration errors.
  const authorize = async (driverId: string) => {
    const context = await fleetAuthorizationService.requireCompany('ADMIN');
    await new DriverPoolService(prisma).detail(context,driverId);
    return { companyId:context.companyId,actorId:context.user.id,canConfigurePolicy:context.role === 'OWNER' };
  };
  await authorize(id);
  const catalog = new DriverSafetyCatalog();
  return new DriverSafetyService(catalog,new DriverSafetyFiles(catalog.root),authorize,expectedRevision);
}
