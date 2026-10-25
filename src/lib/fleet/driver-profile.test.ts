import assert from "node:assert/strict";
import { test } from "node:test";
import { driverProfileQuery } from "../drivers/profile-query";
import { DriverValidationError, parseDriverInput } from "../drivers/validation";

test("driver profile scopes identity, trips and settlement relationships to the selected company", () => {
  const query = driverProfileQuery("driver-1", "company-1");
  assert.deepEqual(query.where, { id: "driver-1", companyId: "company-1" });
  assert.deepEqual(query.select.loads.where, { companyId: "company-1" });
  assert.deepEqual(query.select.settlements.where, {
    truck: { companyId: "company-1" },
    OR: [{ loadId: null }, { load: { companyId: "company-1" } }],
  });
  assert.equal(query.select.loads.take, 100);
  assert.equal(query.select.driverOrientations.take, 25);
  assert.equal("signature" in query.select.driverOrientations.select, false);
});
const valid = {
  firstName: " Test ",
  lastName: " Driver ",
  payType: "PERCENTAGE",
  payRate: "25",
  truckId: "",
};
test("driver writes normalize supported fields and ignore spoofed ownership", () => {
  const parsed = parseDriverInput({ ...valid, companyId: "foreign-company" });
  assert.equal(parsed.firstName, "Test");
  assert.equal(parsed.payRate, 25);
  assert.equal(parsed.truckId, null);
  assert.equal("companyId" in parsed, false);
});
test("driver writes reject malformed names, pay rates, emails and enum values", () => {
  for (const patch of [
    { firstName: "" },
    { payRate: "" },
    { payRate: "25oops" },
    { payRate: -1 },
    { payRate: 101 },
    { payRate: null },
    { email: "not-an-email" },
    { truckId: 4 },
    { payType: "UNKNOWN" },
  ]) {
    assert.throws(
      () => parseDriverInput({ ...valid, ...patch }),
      DriverValidationError,
    );
  }
});
