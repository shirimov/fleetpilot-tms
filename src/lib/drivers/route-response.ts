import { DriverStorageUnavailableError } from "./document-scanner";
import { NextResponse } from "next/server";
import { fleetRouteErrorResponse } from "@/lib/fleet/fleet-route-response";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
import { DriverValidationError } from "./validation";
import { DriverConflictError } from "./driver-mutations";
export function driverRouteError(error: unknown) {
  if (error instanceof DriverStorageUnavailableError)
    return NextResponse.json(
      { error: error.message },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  if (
    error instanceof DriverValidationError ||
    error instanceof DriverConflictError ||
    error instanceof SyntaxError
  )
    return NextResponse.json(
      {
        error:
          error instanceof SyntaxError ? "Invalid request." : error.message,
      },
      {
        status: error instanceof DriverConflictError ? 409 : 400,
        headers: PRIVATE_NO_STORE_HEADERS,
      },
    );
  const response = fleetRouteErrorResponse(error, "Driver request failed.");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
