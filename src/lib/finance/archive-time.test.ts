import assert from "node:assert/strict";
import { test } from "node:test";
import { providerInstant } from "./archive-time";
import { inventoryFingerprint, optionalTime } from "./archive-normalize";

test("provider instants normalize offsets and fractional zeros without losing precision", () => {
  for (const value of [
    "2026-09-18T12:00:00Z",
    "2026-09-18T12:00:00.000Z",
    "2026-09-18T12:00:00.000000Z",
    "2026-09-18T08:00:00.000000000-04:00",
    "2026-09-18T17:30:00+05:30",
  ])
    assert.equal(providerInstant(value), "2026-09-18T12:00:00Z");
  for (const value of [
    "2026-09-18T12:00:00.725Z",
    "2026-09-18T12:00:00.725000Z",
    "2026-09-18T08:00:00.7250000-04:00",
  ])
    assert.equal(providerInstant(value), "2026-09-18T12:00:00.725Z");
  assert.equal(
    providerInstant("2026-09-18T08:00:00.725261000-04:00"),
    "2026-09-18T12:00:00.725261Z",
  );
  assert.equal(
    providerInstant("2026-09-18T23:30:00.000001-02:00"),
    "2026-09-19T01:30:00.000001Z",
  );
  assert.notEqual(
    providerInstant("2026-09-18T12:00:00.725261Z"),
    providerInstant("2026-09-18T12:00:00.725262Z"),
  );
  assert.notEqual(
    providerInstant("2026-09-18T12:00:00.7252610001Z"),
    providerInstant("2026-09-18T12:00:00.7252610002Z"),
  );
  assert.notEqual(
    providerInstant("2026-09-18T12:00:00Z"),
    providerInstant("2026-09-18T12:00:01Z"),
  );
  assert.equal(
    optionalTime("2026-09-18T12:00:00.725261Z")?.toISOString(),
    "2026-09-18T12:00:00.725Z",
  );
});

test("missing optional timestamps are deterministic; invalid or zone-less input is rejected", () => {
  assert.equal(providerInstant(null), null);
  assert.equal(providerInstant(undefined), null);
  assert.equal(optionalTime(null), null);
  for (const value of [
    "",
    "bad",
    0,
    "2026-09-18",
    "2026-09-18T12:00:00",
    "2026-02-30T12:00:00Z",
    "2026-09-18T24:00:00Z",
    "2026-09-18T12:60:00Z",
    "2026-09-18T12:00:60Z",
    "2026-09-18T12:00:00+24:00",
    "2026-09-18T12:00:00+04:60",
  ])
    assert.throws(() => providerInstant(value), /Invalid source timestamp/);
});

test("inventory timestamp fingerprints use instant semantics and leave raw metadata untouched", () => {
  const a = [
    { statement_id: "sample", updated_date: "2026-09-18T12:00:00.725261Z" },
  ];
  const b = [
    {
      statement_id: "sample",
      updated_date: "2026-09-18T08:00:00.725261000-04:00",
    },
  ];
  assert.equal(inventoryFingerprint(a), inventoryFingerprint(b));
  assert.notEqual(
    inventoryFingerprint(a),
    inventoryFingerprint([
      { ...a[0], updated_date: "2026-09-18T12:00:00.725262Z" },
    ]),
  );
  assert.equal(a[0].updated_date, "2026-09-18T12:00:00.725261Z");
});
