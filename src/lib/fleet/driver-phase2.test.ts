import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expirationState,
  documentAlerts,
  parseDateOnly,
} from "../drivers/qualification";
import {
  parseEmployment,
  validateEmploymentDates,
} from "../drivers/employment";
import { validateDriverFile } from "../drivers/document-storage";
const now = new Date("2026-10-24T23:59:59Z");
test("driver expiration windows use UTC date boundaries, include expiration day, and remain cumulative", () => {
  for (const [offset, status] of [
    [-1, "EXPIRED"],
    [0, "EXPIRING_30"],
    [30, "EXPIRING_30"],
    [31, "EXPIRING_60"],
    [60, "EXPIRING_60"],
    [61, "EXPIRING_90"],
    [90, "EXPIRING_90"],
    [91, "ON_FILE"],
  ] as const) {
    const date = new Date(Date.UTC(2026, 9, 24 + offset));
    assert.equal(expirationState(date, now).status, status);
  }
  assert.equal(expirationState(null, now).status, "NO_EXPIRATION");
});
test("qualification alerts consider only the current version and do not claim compliance", () => {
  const summary = documentAlerts(
    [
      {
        type: "CDL_FRONT",
        versions: [
          { expiresAt: "2026-11-23T00:00:00Z" },
          { expiresAt: "2025-01-01" },
        ],
      },
      { type: "MVR", versions: [{ expiresAt: null }] },
    ],
    now,
  );
  assert.equal(summary.within30, 1);
  assert.equal(summary.within60, 1);
  assert.equal(summary.within90, 1);
  assert.equal(summary.expired, 0);
  assert.equal(summary.unknownExpiry, 1);
  assert.equal(summary.missingRequired.length, 5);
  assert.equal("compliant" in summary, false);
});
test("employment fields distinguish unknown employment, omit absent fields and reject duty status and invalid date ordering", () => {
  assert.deepEqual(parseEmployment({}), {});
  assert.deepEqual(
    parseEmployment({ employmentStatus: "", driverType: null }),
    { employmentStatus: null, driverType: null },
  );
  assert.equal(
    parseEmployment({ employmentStatus: "ON_LEAVE" }).employmentStatus,
    "ON_LEAVE",
  );
  assert.throws(() => parseEmployment({ employmentStatus: "ON_DUTY" }));
  assert.throws(() => parseEmployment({ employmentStartDate: "2026-02-30" }));
  assert.throws(() =>
    validateEmploymentDates({
      employmentStartDate: new Date("2026-02-01"),
      terminationDate: new Date("2026-01-01"),
    }),
  );
  assert.equal(
    parseDateOnly("2024-02-29", "date")?.toISOString(),
    "2024-02-29T00:00:00.000Z",
  );
});
test("driver file validation rejects active file extensions, forged signatures, unsafe names and MIME mismatches", () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\nsynthetic test\n%%EOF");
  assert.equal(
    validateDriverFile(
      new File([bytes], "cdl.pdf", { type: "application/pdf" }),
      bytes,
    ).mimeType,
    "application/pdf",
  );
  for (const [name, type, payload] of [
    ["cdl.html", "text/html", bytes],
    ["cdl.js.pdf", "application/pdf", bytes],
    ["../cdl.pdf", "application/pdf", bytes],
    ["cdl.png", "image/png", bytes],
    ["cdl.pdf", "image/png", bytes],
    ["cdl.pdf", "application/pdf", new TextEncoder().encode("not pdf")],
  ] as const)
    assert.throws(() =>
      validateDriverFile(new File([payload], name, { type }), payload),
    );
});
