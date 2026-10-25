import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDriverDocuments } from "@/lib/drivers/document-authorization";
import { addDocument, versionSelect } from "@/lib/drivers/document-service";
import { boundedDocumentForm } from "@/lib/drivers/document-storage";
import { documentAlerts } from "@/lib/drivers/qualification";
import { driverRouteError } from "@/lib/drivers/route-response";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const context = await requireDriverDocuments(id);
    const documents = await prisma.driverDocument.findMany({
      where: { driverId: id, companyId: context.companyId },
      orderBy: { createdAt: "desc" },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: versionSelect,
        },
        _count: { select: { versions: true } },
      },
    });
    return NextResponse.json(
      {
        documents: documents.map(({ versions, _count, ...document }) => ({
          ...document,
          currentVersion: versions[0] || null,
          versionCount: _count.versions,
        })),
        alerts: documentAlerts(documents),
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const context = await requireDriverDocuments(id, true);
    return NextResponse.json(
      await addDocument(context, id, await boundedDocumentForm(request)),
      { status: 201, headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
