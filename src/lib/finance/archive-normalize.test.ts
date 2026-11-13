import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeStatement } from "./archive-normalize";

test("equal-time, equal-amount QM advances remain separate source evidence, not fuel transactions", () => {
  const advances = ["advance-a", "advance-b"].map((id) => ({
    id,
    date: "2026-09-18T12:00:00.725261Z",
    charge: "100.00",
    truck_unit: "TEST-ADVANCE",
    name: "Advance",
    type: "advance",
  }));
  const bytes = Buffer.from(JSON.stringify({
    data: {
      statement_id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      driver_id: "22222222-2222-4222-8222-222222222222",
      batch_id: 202637,
      header: {
        driver: { contractor: false },
        period_info: {
          batch_id: "2026-37",
          start_date: "2026-09-07",
          end_date: "2026-09-13",
        },
      },
      advance_deductions: advances,
      fuel_transactions: [],
    },
  }));
  const originalBytes = Buffer.from(bytes);
  const normalized = normalizeStatement(bytes);

  // Equal entry timestamps, amounts and trucks do not establish duplication.
  // Preserve both rows for later bank reconciliation; do not infer fuel purchases.
  assert.equal(normalized.lines.length, 2);
  assert.equal(
    normalized.lines.filter((line) => line.sourceArray === "fuel_transactions").length,
    0,
  );
  assert.deepEqual(normalized.lines, advances.map((advance, sourceOrder) => ({
    kind: "DEDUCTION",
    sourceArray: "advance_deductions",
    sourceOrder,
    providerLineId: advance.id,
    description: advance.name,
    sourceType: advance.type,
    amountMinor: BigInt("10000"),
    rawAmount: advance.charge,
    sourceDate: advance.date,
    reference: null,
    sourceUnit: advance.truck_unit,
    included: null,
    metadata: advance,
  })));
  assert.equal(normalized.providerStatementId, "11111111-1111-4111-8111-111111111111");
  assert.equal(normalized.providerVersion, 1);
  assert.deepEqual(normalized.issues, []);
  assert.deepEqual(bytes, originalBytes);
  assert.deepEqual(normalizeStatement(bytes), normalized);
});
