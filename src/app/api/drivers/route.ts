import {
  DriverValidationError,
  parseDriverInput,
} from "@/lib/drivers/validation";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { fleetAuthorizationService } from "@/lib/fleet/fleet-authorization";
import { fleetRouteErrorResponse } from "@/lib/fleet/fleet-route-response";

export async function GET() {
  try {
    const context = await fleetAuthorizationService.requireCompany("ADMIN");
    const drivers = await prisma.driver.findMany({
      where: { companyId: context.companyId },
      include: {
        truck: { select: { id: true, unitNumber: true, companyId: true } },
      },
      orderBy: { lastName: "asc" },
    });
    return NextResponse.json(
      drivers.map((driver) => ({
        ...driver,
        assignmentRestricted:
          !!driver.truckId && driver.truck?.companyId !== context.companyId,
        truckId:
          driver.truck?.companyId === context.companyId ? driver.truckId : null,
        truck:
          driver.truck?.companyId === context.companyId
            ? { id: driver.truck.id, unitNumber: driver.truck.unitNumber }
            : null,
      })),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return fleetRouteErrorResponse(error, "Failed to fetch drivers");
  }
}

export async function POST(request: Request) {
  try {
    const context = await fleetAuthorizationService.requireCompany("ADMIN");
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
    const driver = await prisma.driver.create({
      data: {
        companyId: context.companyId,
        ...body,
      },
    });
    return NextResponse.json(driver);
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
    return fleetRouteErrorResponse(error, "Failed to create driver");
  }
}
