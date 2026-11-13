import {prisma} from '@/lib/prisma';
import {fleetAuthorizationService} from '@/lib/fleet/fleet-authorization';
import {DriverPoolService} from '@/lib/fleet/driver-pool-service';
import {createDriverPoolHandlers} from '@/lib/fleet/driver-pool-route';
export const dynamic='force-dynamic';
const handlers=createDriverPoolHandlers({requireCompany:()=>fleetAuthorizationService.requireCompany(),service:new DriverPoolService(prisma)});
export const GET=handlers.list;
