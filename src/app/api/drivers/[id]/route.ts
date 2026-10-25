import { driverAuthorizationService } from "@/lib/drivers/driver-authorization";
import {
  DriverValidationError,
  parseDriverInput,
} from "@/lib/drivers/validation";
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
    const context = await fleetAuthorizationService.requireDriver(id);
    await fleetAuthorizationService.requireCompany("ADMIN");
    const body = parseDriverInput(await request.json());
    if (body.truckId) {
      const truck = await prisma.truck.findFirst({
        where: { id: body.truckId, companyId: context.companyId },
        select: { id: true },
      });
      if (!truck)
        return NextResponse.json(
          { error: "Truck is not available in the selected company." },
          { status: 400 },
        );
    }
    const driver = await prisma.driver.update({
      where: { id, companyId: context.companyId },
      data: {
        ...body,
      },
    });
    return NextResponse.json(driver, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof DriverValidationError || error instanceof SyntaxError)
      return NextResponse.json(
        {
          error:
            error instanceof DriverValidationError
              ? error.message
              : "Invalid JSON.",
        },
        { status: 400 },
      );
    return fleetRouteErrorResponse(error, "Failed to update driver");
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
    return NextResponse.json(
      {
        ...driver,
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
