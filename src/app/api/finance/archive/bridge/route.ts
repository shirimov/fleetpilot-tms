import { browserEvidenceGuard } from "@/lib/finance/archive-browser-evidence";
import { NextResponse } from "next/server";
import {
  archiveBridge,
  archiveContext,
} from "@/lib/finance/archive-bridge-service";
import { bridgeBody } from "@/lib/finance/archive-bridge-http";
import {
  businessOnly,
  exact,
  text,
} from "@/lib/finance/archive-bridge-validation";
import { json } from "@/lib/finance/archive-service";
import { financialRouteError } from "@/lib/finance/financial-control-route";
import { FinancialValidationError } from "@/lib/finance/financial-control-errors";
export const maxDuration = 300;
const reply = (value: unknown) =>
  NextResponse.json(json(value), {
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    return reply(await archiveBridge.review(await archiveContext()));
  } catch (e) {
    return financialRouteError(e);
  }
}
export async function POST(request: Request) {
  try {
    const c = await archiveContext();
    if (process.env.QUICKMANAGE_BROWSER_BRIDGE_ENABLED !== "true")
      throw new FinancialValidationError("Browser bridge is disabled.");
    const b = exact(await bridgeBody(request), [
      "action",
      "evidence",
      "catalogId",
      "providerCompanyId",
      "companyId",
      "confirmation",
      "reason",
      "historical",
      "inventoryId",
    ]);
    if (["catalog", "inventory", "capture"].includes(String(b.action)))
      browserEvidenceGuard(b.evidence);
    switch (b.action) {
      case "catalog":
        return reply(await archiveBridge.catalog(b.evidence, c));
      case "bind":
        businessOnly(b);
        return reply(
          await archiveBridge.bind(
            {
              catalogId: text(b.catalogId),
              providerCompanyId: text(b.providerCompanyId),
              companyId: text(b.companyId),
              confirmation: text(b.confirmation),
              reason: text(b.reason, 1000),
              historical: b.historical === true,
            },
            c,
          ),
        );
      case "inventory":
        return reply(await archiveBridge.inventory(b.evidence, c));
      case "capture":
        return reply(
          await archiveBridge.capture(text(b.inventoryId), b.evidence, c),
        );
      default:
        throw new FinancialValidationError("Unknown bridge action.");
    }
  } catch (e) {
    return financialRouteError(e);
  }
}
