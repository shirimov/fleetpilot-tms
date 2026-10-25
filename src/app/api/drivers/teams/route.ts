import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { driverAuthorizationService } from "@/lib/drivers/driver-authorization";
import { driverRouteError } from "@/lib/drivers/route-response";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
export async function GET() {
  try {
    const context = await driverAuthorizationService.requireRead();
    return NextResponse.json(
      await prisma.driverTeam.findMany({
        where: { companyId: context.companyId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
