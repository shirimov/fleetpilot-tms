import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDriverDocuments } from "@/lib/drivers/document-authorization";
import { driverRouteError } from "@/lib/drivers/route-response";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await requireDriverDocuments(id);
    const page = Math.max(
      1,
      Number.parseInt(
        new URL(request.url).searchParams.get("page") || "1",
        10,
      ) || 1,
    );
    const where = { driverId: id, companyId: context.companyId };
    const [total, events] = await prisma.$transaction([
      prisma.driverAudit.count({ where }),
      prisma.driverAudit.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        skip: (page - 1) * 20,
      }),
    ]);
    return NextResponse.json(
      { events, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
