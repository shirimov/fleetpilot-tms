import { NextResponse } from "next/server";
import { archiveContext } from "@/lib/finance/archive-bridge-service";
import { archiveCaptureRuns } from "@/lib/finance/archive-capture-run";
import { bridgeBody } from "@/lib/finance/archive-bridge-http";
import { exact, text } from "@/lib/finance/archive-bridge-validation";
import { FinancialValidationError } from "@/lib/finance/financial-control-errors";
import { financialRouteError } from "@/lib/finance/financial-control-route";
export async function POST(request: Request) {
  try {
    const c = await archiveContext("OWNER");
    const b = exact(await bridgeBody(request), [
      "action",
      "captureRunId",
      "allowedProviderCompanyIds",
      "label",
    ]);
    let result;
    if (b.action === "create")
      result = await archiveCaptureRuns.create(
        b.allowedProviderCompanyIds,
        b.label,
        c,
      );
    else if (
      ["ACTIVE", "COMPLETED", "CLOSED", "FAILED"].includes(String(b.action)) &&
      b.allowedProviderCompanyIds === undefined &&
      b.label === undefined
    )
      result = await archiveCaptureRuns.transition(
        text(b.captureRunId),
        b.action as "ACTIVE" | "COMPLETED" | "CLOSED" | "FAILED",
        c,
      );
    else throw new FinancialValidationError("Invalid capture run action.");
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return financialRouteError(e);
  }
}
