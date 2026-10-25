import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { driverAuthorizationService } from "@/lib/drivers/driver-authorization";
import { driverRouteError } from "@/lib/drivers/route-response";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";

export async function GET(request: Request) {
  try {
    const context = await driverAuthorizationService.requireRead();
    const page = Math.min(
      100000,
      Math.max(
        1,
        Number.parseInt(
          new URL(request.url).searchParams.get("page") || "1",
          10,
        ) || 1,
      ),
    );
    const where = { companyId: context.companyId };
    const [total, notifications] = await prisma.$transaction([
      prisma.driverReminder.count({ where }),
      prisma.driverReminder.findMany({
        where,
        take: 20,
        skip: (page - 1) * 20,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          driverId: true,
          kind: true,
          documentType: true,
          dueAt: true,
          createdAt: true,
        },
      }),
    ]);
    return NextResponse.json(
      {
        notifications,
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / 20)),
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
