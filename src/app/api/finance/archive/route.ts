import { NextResponse } from "next/server";
import { financialControlAuthorization } from "@/lib/finance/financial-control-authorization";
import { archiveRead, archivePage } from "@/lib/finance/archive-read";
import { archiveService, json } from "@/lib/finance/archive-service";
import {
  archiveProviderConfigured,
  ArchiveProviderError,
  liveArchiveProvider,
} from "@/lib/finance/archive-provider";
import { financialRouteError } from "@/lib/finance/financial-control-route";
import { FinancialValidationError } from "@/lib/finance/financial-control-errors";
import { privateDownloadHeaders } from "@/lib/storage/private-file-storage";

export const maxDuration = 300;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
function failure(error: unknown) {
  if (error instanceof ArchiveProviderError)
    return reply(
      { error: error.code },
      error.code === "AUTHENTICATION_REQUIRED" ? 503 : 409,
    );
  const response = financialRouteError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function GET(request: Request) {
  try {
    const c = await financialControlAuthorization.requireContext(),
      p = new URL(request.url).searchParams;
    if (p.get("download")) {
      const file = await archiveService.original(p.get("download")!, c);
      return new NextResponse(file.bytes as BodyInit, {
        headers: privateDownloadHeaders(file.filename, "application/pdf"),
      });
    }
    let result: unknown;
    switch (p.get("view")) {
      case "statements":
        result = await archiveRead.statements(c, p);
        break;
      case "completeness":
        result = await archiveRead.inventories(
          c,
          archivePage(p.get("page")),
          p.get("company") ?? undefined,
          p.get("pid") ?? undefined,
        );
        break;
      case "inventory":
        result = await archiveRead.inventory(
          p.get("id") ?? "",
          c,
          archivePage(p.get("page")),
        );
        break;
      case "detail":
        result = await archiveRead.detail(
          p.get("id") ?? "",
          c,
          p.get("version") ?? undefined,
          archivePage(p.get("page")),
        );
        break;
      default:
        result = {
          ...(await archiveRead.overview(c)),
          connectionEnabled:
            archiveProviderConfigured() &&
            process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID ===
              c.operatingGroupId,
        };
    }
    return reply(json(result));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const c = await financialControlAuthorization.requireContext();
    if (Number(request.headers.get("content-length") || 0) > 8192)
      throw new FinancialValidationError("Request too large.");
    const b = await request.json();
    let result: unknown;
    if (b.action === "accept") {
      if (typeof b.statementId !== "string")
        throw new FinancialValidationError("Statement required.");
      result = await archiveService.accept(b.statementId, c);
    } else {
      const provider = liveArchiveProvider(c.operatingGroupId);
      if (
        b.action === "bind" &&
        typeof b.companyId === "string" &&
        typeof b.providerCompanyId === "string"
      )
        result = await archiveService.bind(
          b.companyId,
          b.providerCompanyId,
          provider,
          c,
        );
      else if (
        b.action === "discover" &&
        typeof b.company === "string" &&
        typeof b.pid === "string"
      )
        result = await archiveService.discover(b.company, b.pid, provider, c);
      else if (
        b.action === "capture" &&
        typeof b.inventoryId === "string" &&
        Array.isArray(b.itemIds) &&
        b.itemIds.every((x: unknown) => typeof x === "string")
      )
        result = await archiveService.run(
          b.inventoryId,
          b.itemIds,
          provider,
          c,
        );
      else throw new FinancialValidationError("Invalid archive action.");
    }
    return reply(json(result));
  } catch (error) {
    return failure(error);
  }
}
