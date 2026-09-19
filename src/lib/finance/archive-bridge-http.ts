import { FinancialValidationError } from "./financial-control-errors";
import { BRIDGE_UPLOAD_LIMIT } from "./archive-bridge-validation";
/** Same-origin session upload only. Never a cross-origin QuickManage receiver or URL proxy. */
export async function bridgeBody(request: Request) {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(process.env.AUTH_URL ?? request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new FinancialValidationError("Same-origin upload required.");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new FinancialValidationError("JSON evidence upload required.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > BRIDGE_UPLOAD_LIMIT))
    throw new FinancialValidationError("Upload too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new FinancialValidationError("Upload required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > BRIDGE_UPLOAD_LIMIT)
        throw new FinancialValidationError("Upload too large.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new FinancialValidationError("Malformed JSON upload.");
  }
}
