import { saveDriver } from "@/lib/drivers/driver-mutations";
import { driverRouteError } from "@/lib/drivers/route-response";
import { documentAlerts } from "@/lib/drivers/qualification";
import { driverAuthorizationService } from "@/lib/drivers/driver-authorization";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { fleetAuthorizationService } from "@/lib/fleet/fleet-authorization";
import { fleetRouteErrorResponse } from "@/lib/fleet/fleet-route-response";

export async function GET() {
  try {
    const context = await driverAuthorizationService.requireRead();
    const drivers = await prisma.driver.findMany({
      where: { companyId: context.companyId },
      include: {
        team: { select: { id: true, name: true } },
        documents: {
          select: {
            type: true,
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { expiresAt: true },
            },
          },
        },
        truck: { select: { id: true, unitNumber: true, companyId: true } },
      },
      orderBy: { lastName: "asc" },
    });
    return NextResponse.json(
      drivers.map(({ documents, ...driver }) => ({
        ...driver,
        documentAlerts: documentAlerts(documents),
        canReadDocuments: context.access.canReadDocuments,
        licenseNum: context.access.canReadDocuments ? driver.licenseNum : null,
        emergencyContactName: context.access.canReadDocuments
          ? driver.emergencyContactName
          : null,
        emergencyContactPhone: context.access.canReadDocuments
          ? driver.emergencyContactPhone
          : null,
        emergencyContactRelation: context.access.canReadDocuments
          ? driver.emergencyContactRelation
          : null,

        canEdit: context.access.canEdit,
        canViewCompensation: context.access.canViewCompensation,
        payType: context.access.canViewCompensation ? driver.payType : null,
        payRate: context.access.canViewCompensation ? driver.payRate : null,
        assignmentRestricted:
          !!driver.truckId && driver.truck?.companyId !== context.companyId,
        truckId:
          driver.truck?.companyId === context.companyId ? driver.truckId : null,
        truck:
          driver.truck?.companyId === context.companyId
            ? { id: driver.truck.id, unitNumber: driver.truck.unitNumber }
            : null,
      })),
      {
        headers: {
          ...PRIVATE_NO_STORE_HEADERS,
          "X-Drivers-Can-Edit": String(context.access.canEdit),
          "X-Drivers-Can-View-Compensation": String(
            context.access.canViewCompensation,
          ),
        },
      },
    );
  } catch (error) {
    return fleetRouteErrorResponse(error, "Failed to fetch drivers");
  }
}

export async function POST(request: Request) {
  try {
    const context = await fleetAuthorizationService.requireCompany("ADMIN");
    return NextResponse.json(await saveDriver(context, await request.json()), {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch (error) {
    return driverRouteError(error);
  }
}
