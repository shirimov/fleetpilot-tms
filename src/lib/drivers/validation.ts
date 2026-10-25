export class DriverValidationError extends Error {}
export function parseDriverInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new DriverValidationError("Invalid driver information.");
  const input = body as Record<string, unknown>;
  function text(key: string, max: number, required = false) {
    const value = input[key];
    if (value != null && typeof value !== "string")
      throw new DriverValidationError(`${key} must be text.`);
    const trimmed = (value as string | undefined)?.trim() || "";
    if (trimmed.length > max || (required && !trimmed))
      throw new DriverValidationError(`Please provide a valid ${key}.`);
    return trimmed;
  }
  const firstName = text("firstName", 100, true);
  const lastName = text("lastName", 100, true);
  const phone = text("phone", 50);
  const email = text("email", 254);
  const licenseNum = text("licenseNum", 100);
  const truckId = text("truckId", 100);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new DriverValidationError("Please provide a valid email address.");
  if (!["PERCENTAGE", "PER_MILE", "FLAT"].includes(String(input.payType)))
    throw new DriverValidationError("Select a valid pay type.");
  if (
    !["string", "number"].includes(typeof input.payRate) ||
    String(input.payRate).trim() === ""
  )
    throw new DriverValidationError("Pay rate is required.");
  const payRate = Number(input.payRate);
  if (
    !Number.isFinite(payRate) ||
    payRate < 0 ||
    (input.payType === "PERCENTAGE" && payRate > 100)
  )
    throw new DriverValidationError(
      "Enter a valid nonnegative pay rate. Percentage cannot exceed 100.",
    );
  return {
    firstName,
    lastName,
    phone: phone || null,
    email: email || null,
    licenseNum: licenseNum || null,
    payType: input.payType as "PERCENTAGE" | "PER_MILE" | "FLAT",
    payRate,
    truckId: truckId || null,
  };
}
