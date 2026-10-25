import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDriverDocuments } from "@/lib/drivers/document-authorization";
import {
  updateDocumentDates,
  versionSelect,
} from "@/lib/drivers/document-service";
import { driverRouteError } from "@/lib/drivers/route-response";
import { FleetResourceNotFoundError } from "@/lib/fleet/fleet-authorization";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
type Context = { params: Promise<{ id: string; documentId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { id, documentId } = await params;
    const context = await requireDriverDocuments(id);
    if (
      !(await prisma.driverDocument.findFirst({
        where: { id: documentId, driverId: id, companyId: context.companyId },
        select: { id: true },
      }))
    )
      throw new FleetResourceNotFoundError();
    const page = Math.max(
      1,
      Number.parseInt(
        new URL(request.url).searchParams.get("page") || "1",
        10,
      ) || 1,
    );
    const [total, versions] = await prisma.$transaction([
      prisma.driverDocumentVersion.count({ where: { documentId } }),
      prisma.driverDocumentVersion.findMany({
        where: { documentId },
        orderBy: { version: "desc" },
        take: 20,
        skip: (page - 1) * 20,
        select: versionSelect,
      }),
    ]);
    return NextResponse.json(
      { versions, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id, documentId } = await params;
    const context = await requireDriverDocuments(id, true);
    return NextResponse.json(
      await updateDocumentDates(context, id, documentId, await request.json()),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
