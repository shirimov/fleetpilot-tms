import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDriverDocuments } from "@/lib/drivers/document-authorization";
import { driverStorage } from "@/lib/drivers/document-storage";
import { driverRouteError } from "@/lib/drivers/route-response";
import { FleetResourceNotFoundError } from "@/lib/fleet/fleet-authorization";
import { privateDownloadHeaders } from "@/lib/storage/private-file-storage";
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; documentId: string; versionId: string }> },
) {
  try {
    const { id, documentId, versionId } = await params;
    const context = await requireDriverDocuments(id);
    const version = await prisma.driverDocumentVersion.findFirst({
      where: {
        id: versionId,
        documentId,
        document: { driverId: id, companyId: context.companyId },
      },
    });
    if (!version) throw new FleetResourceNotFoundError();
    const bytes = await (await driverStorage()).get(version.storageKey);
    if (
      bytes.length !== version.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== version.sha256
    )
      throw new Error("Stored document integrity check failed.");
    const preview =
      new URL(request.url).searchParams.get("preview") === "1" &&
      version.mimeType.startsWith("image/");
    await prisma.driverAudit.create({
      data: {
        companyId: context.companyId,
        driverId: id,
        actorId: context.user.id,
        actorName: context.user.displayName,
        action: preview ? "DOCUMENT_PREVIEWED" : "DOCUMENT_DOWNLOADED",
        metadata: { documentId, versionId },
      },
    });
    return new NextResponse(bytes as BodyInit, {
      headers: {
        ...privateDownloadHeaders(
          version.filename,
          version.mimeType,
          preview ? "inline" : "attachment",
        ),
        "Content-Length": String(bytes.length),
      },
    });
  } catch (error) {
    return driverRouteError(error);
  }
}
