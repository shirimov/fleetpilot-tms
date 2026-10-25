import { saveDriver } from "@/lib/drivers/driver-mutations";
import { driverRouteError } from "@/lib/drivers/route-response";
import { documentAlerts } from "@/lib/drivers/qualification";
import { driverAuthorizationService } from "@/lib/drivers/driver-authorization";
import { driverProfileQuery } from "@/lib/drivers/profile-query";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { fleetAuthorizationService } from "@/lib/fleet/fleet-authorization";
import { fleetRouteErrorResponse } from "@/lib/fleet/fleet-route-response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireCompany("ADMIN");
    return NextResponse.json(
      await saveDriver(context, await request.json(), id),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await fleetAuthorizationService.requireDriver(id);
    await fleetAuthorizationService.requireCompany("ADMIN");
    // Preserve even unlinked records: optional FKs can otherwise silently detach history.
    return NextResponse.json(
      {
        error:
          "Driver deletion is disabled to preserve historical records. A reviewed archive workflow is required.",
      },
      { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return fleetRouteErrorResponse(error, "Failed to delete driver");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await driverAuthorizationService.requireRead();
    const driver = await prisma.driver.findFirst(
      driverProfileQuery(id, context.companyId),
    );
    if (!driver)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { documents, ...record } = driver;
    return NextResponse.json(
      {
        ...record,
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
        settlements: context.access.canViewCompensation
          ? driver.settlements
          : [],
        assignmentRestricted:
          !!driver.truckId && driver.truck?.companyId !== context.companyId,
        truckId:
          driver.truck?.companyId === context.companyId ? driver.truckId : null,
        truck:
          driver.truck?.companyId === context.companyId
            ? { id: driver.truck.id, unitNumber: driver.truck.unitNumber }
            : null,
        loads: driver.loads.map((load) => ({
          ...load,
          truck:
            load.truck?.companyId === context.companyId
              ? { unitNumber: load.truck.unitNumber }
              : null,
        })),
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return fleetRouteErrorResponse(error, "Failed to fetch driver profile");
  }
}
