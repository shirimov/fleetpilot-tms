import assert from "node:assert/strict";
import { test } from "node:test";
import { statementBusinessFingerprint as fp } from "./archive-business-fingerprint";
import { hash } from "./archive-normalize";
import {
  tripTiesFixture,
  swapTripTies,
} from "../../../tests/fixtures/quickmanage-trip-ties";
import { fixedPaysFixture } from "../../../tests/fixtures/quickmanage-fixed-pays";
const bytes = (x: unknown) => Buffer.from(JSON.stringify(x));
test("diagnosed v8 all seven observed orders retain raw hashes but share business fingerprint", () => {
  const f = tripTiesFixture(),
    original = Buffer.from(f.bundle.detail),
    expected = fp(original);
  const hashes = new Set<string>();
  for (const [a, b] of [
    [false, false],
    [true, false],
    [true, true],
    [false, false],
    [false, false],
    [false, true],
    [false, true],
  ]) {
    const p = structuredClone(f.payload);
    swapTripTies(p.data.trips, a, b);
    const raw = bytes(p);
    hashes.add(hash(raw));
    assert.equal(fp(raw), expected);
    assert.deepEqual(f.bundle.detail, original);
  }
  assert.equal(hashes.size, 4);
});
const row = (id: string, time: string | null) => ({
  trip_id: id,
  origin_app_time: time,
  rate: "442.99199999999996",
  statement_stops: [1, 2],
});
const ten = "2026-01-19T10:00:00Z",
  noon = "2026-01-19T12:00:00Z";
const finger = (trips: unknown[]) => fp(bytes({ data: { trips } }));
test("only contiguous equal-instant groups sort; separate groups and noncontiguous ties retain order", () => {
  const a = row("A", ten),
    b = row("B", ten),
    c = row("C", noon),
    d = row("D", noon),
    e = row("E", "2026-01-19T15:00:00Z");
  assert.equal(finger([a, b, c, d, e]), finger([b, a, d, c, e]));
  assert.notEqual(finger([a, b, c]), finger([c, a, b]));
  assert.notEqual(finger([a, b, c, d, e]), finger([c, d, a, b, e]));
  assert.notEqual(finger([a, c, b]), finger([b, c, a]));
  assert.equal(finger([a, a, b]), finger([b, a, a]));
  assert.notEqual(finger([a, a, b]), finger([a, b]));
});
test("safe UTC equality preserves timestamp lexemes and submillisecond precision; unknown times/IDs are barriers", () => {
  const a = row("A", ten),
    b = row("B", "2026-01-19T05:00:00-05:00");
  assert.equal(finger([a, b]), finger([b, a]));
  assert.notEqual(finger([a, b]), finger([a, { ...b, origin_app_time: ten }]));
  for (const time of [
    null,
    "invalid",
    "2026-01-19T10:00:00.000001Z",
    "2026-01-19T10:01:00Z",
  ])
    assert.notEqual(finger([a, row("B", time)]), finger([row("B", time), a]));
  assert.notEqual(
    finger([
      { origin_app_time: ten, x: 1 },
      { origin_app_time: ten, x: 2 },
    ]),
    finger([
      { origin_app_time: ten, x: 2 },
      { origin_app_time: ten, x: 1 },
    ]),
  );
  assert.notEqual(
    finger([a, row("B", ten)]),
    finger([a, row("B", "2026-01-19T10:01:00Z")]),
  );
  assert.notEqual(
    finger([row("A", "2026-01-19T10:00:00.000001Z")]),
    finger([row("A", "2026-01-19T10:00:00.000002Z")]),
  );
  for (const key of ["trip_ref_number", "id"])
    assert.equal(
      finger([
        { [key]: "a", origin_app_time: ten },
        { [key]: "b", origin_app_time: ten },
      ]),
      finger([
        { [key]: "b", origin_app_time: ten },
        { [key]: "a", origin_app_time: ten },
      ]),
    );
});
test("every durable trip value, numeric spelling, identity, appointment and nested stop order remains significant", () => {
  const f = tripTiesFixture(),
    expected = fp(f.bundle.detail);
  for (const field of [
    "id",
    "trip_id",
    "trip_ref_number",
    "origin",
    "destination",
    "mileage",
    "deadhead",
    "rate",
    "net_amount",
    "contract_info",
    "origin_app_time",
    "statement_stops",
    "unknown_field",
  ]) {
    const p = structuredClone(f.payload);
    Object.assign(p.data.trips[7], {
      [field]:
        field === "statement_stops"
          ? [...p.data.trips[7].statement_stops].reverse()
          : "changed",
    });
    assert.notEqual(fp(bytes(p)), expected, field);
  }
  for (const [a, b] of [
    ["442.99199999999996", "442.99199999999997"],
    ["1", "1.0"],
    ["1", '"1"'],
    ["9007199254740992", "9007199254740993"],
  ]) {
    const raw = (n: string) =>
      Buffer.from(
        '{"data":{"trips":[{"trip_id":"A","origin_app_time":"' +
          ten +
          '","rate":' +
          n +
          "}]}}",
      );
    assert.notEqual(fp(raw(a)), fp(raw(b)));
  }
});
test("fixed pays and trip ties compose without normalizing other collections", () => {
  const fixed = fixedPaysFixture(),
    trips = tripTiesFixture();
  const p = {
    data: { ...trips.payload.data, fixed_pays: fixed.payload.data.fixed_pays },
  };
  const expected = fp(bytes(p));
  p.data.fixed_pays.reverse();
  swapTripTies(p.data.trips);
  assert.equal(fp(bytes(p)), expected);
  for (const field of [
    "deductions",
    "fuel_transactions",
    "adjustments",
    "earnings",
    "other",
  ])
    assert.notEqual(
      fp(bytes({ data: { [field]: [1, 2] } })),
      fp(bytes({ data: { [field]: [2, 1] } })),
    );
});
