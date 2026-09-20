import assert from "node:assert/strict";
import { test } from "node:test";
import { statementBusinessFingerprint as fingerprint } from "./archive-business-fingerprint";
import { hash } from "./archive-normalize";
import { fixedPaysFixture } from "../../../tests/fixtures/quickmanage-fixed-pays";
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
function* permutations<T>(rows: T[]): Generator<T[]> {
  if (!rows.length) {
    yield [];
    return;
  }
  for (let i = 0; i < rows.length; i++)
    for (const tail of permutations(rows.filter((_, j) => j !== i)))
      yield [rows[i], ...tail];
}
test("all 5040 diagnosed v14 permutations have one business fingerprint and preserve raw bytes", () => {
  const f = fixedPaysFixture(),
    raw = Buffer.from(f.bundle.detail),
    expected = fingerprint(raw);
  let count = 0;
  for (const rows of permutations(f.payload.data.fixed_pays)) {
    const input = bytes({
      ...f.payload,
      data: { ...f.payload.data, fixed_pays: rows },
    });
    assert.equal(fingerprint(input), expected);
    count++;
  }
  assert.equal(count, 5040);
  assert.deepEqual(f.bundle.detail, raw);
  const changed = structuredClone(f.payload);
  changed.data.fixed_pays.reverse();
  assert.notEqual(hash(bytes(changed)), hash(raw));
});
test("duplicate identical and same-day different rows retain multiplicity and every value", () => {
  const f = fixedPaysFixture(),
    row = f.payload.data.fixed_pays[1];
  f.payload.data.fixed_pays.push({ ...row }, { ...row, amount: 20 });
  const original = bytes(f.payload),
    expected = fingerprint(original);
  f.payload.data.fixed_pays.reverse();
  assert.equal(fingerprint(bytes(f.payload)), expected);
  f.payload.data.fixed_pays.splice(
    f.payload.data.fixed_pays.findIndex(
      (x) => x.day === "Monday" && x.amount === 35.71,
    ),
    1,
  );
  assert.notEqual(fingerprint(bytes(f.payload)), expected);
  assert.equal(JSON.parse(original.toString()).data.fixed_pays.length, 9);
});
test("amount, units, day, type, extra stable identity, UUID, version and other arrays remain significant", () => {
  const f = fixedPaysFixture(),
    expected = fingerprint(f.bundle.detail);
  const changes = [
    (x: typeof f.payload) => {
      x.data.fixed_pays[1].amount = 35.72;
    },
    (x: typeof f.payload) => {
      x.data.fixed_pays[1].worked_unit = 2;
    },
    (x: typeof f.payload) => {
      x.data.fixed_pays[1].day = "Tuesday";
    },
    (x: typeof f.payload) => {
      x.data.fixed_pays[1].type = "OTHER";
    },
    (x: typeof f.payload) => {
      Object.assign(x.data.fixed_pays[1], { id: "new-source-id" });
    },
    (x: typeof f.payload) => {
      x.data.statement_id = "11111111-1111-4111-8111-111111111111";
    },
    (x: typeof f.payload) => {
      x.data.version++;
    },
    (x: typeof f.payload) => {
      x.data.deductions.reverse();
    },
    (x: typeof f.payload) => {
      x.data.updated_date = "2026-09-18T12:00:00.000001Z";
    },
    (x: typeof f.payload) => {
      Object.assign(x.data, { new_field: "material" });
    },
  ];
  for (const change of changes) {
    const x = structuredClone(f.payload);
    change(x);
    assert.notEqual(fingerprint(bytes(x)), expected);
  }
});
test("deterministic object keys, lossless numeric lexemes, scalar types and nested array order", () => {
  assert.equal(
    fingerprint(Buffer.from('{"data":{"a":1,"b":"x"}}')),
    fingerprint(Buffer.from('{ "data": {"b":"x", "a":1} }')),
  );
  const raw = (v: string) =>
    Buffer.from(
      '{"data":{"fixed_pays":[{"day":"Monday","amount":' +
        v +
        ',"worked_unit":1}]}}',
    );
  for (const [a, b] of [
    ["4643.6192", "4643.6193"],
    ["442.99199999999996", "442.99199999999997"],
    ["9007199254740992", "9007199254740993"],
    ["0.123456789123456789", "0.123456789123456788"],
    ["1", '"1"'],
    ["1", "1.0"],
    ["-0", "0"],
  ])
    assert.notEqual(fingerprint(raw(a)), fingerprint(raw(b)));
  assert.notEqual(
    fingerprint(Buffer.from('{"data":{"x":[1,2]}}')),
    fingerprint(Buffer.from('{"data":{"x":[2,1]}}')),
  );
  assert.notEqual(
    fingerprint(Buffer.from('{"data":{"x":true}}')),
    fingerprint(Buffer.from('{"data":{"x":"true"}}')),
  );
  assert.notEqual(
    fingerprint(Buffer.from('{"data":{"x":null}}')),
    fingerprint(Buffer.from('{"data":{"x":"null"}}')),
  );
});
test("malformed, duplicate-key, over-depth and unsupported fixed-pay identity inputs fail closed", () => {
  for (const s of [
    '{"data":1,"data":2}',
    '{"a":1,}',
    "[1,]",
    '{"a":01}',
    '{"a":NaN}',
    '{"a":+1}',
    '{"a":.1}',
    '{"a":1e}',
    "true false",
    '{"data":{"fixed_pays":[{"amount":1}]}}',
    '{"data":{"fixed_pays":[{"day":"Funday"}]}}',
    '{"data":{"fixed_pays":{}}}',
    "[".repeat(42) + "0" + "]".repeat(42),
  ])
    assert.throws(() => fingerprint(Buffer.from(s)));
  assert.throws(() => fingerprint(new Uint8Array([0xff])));
});
