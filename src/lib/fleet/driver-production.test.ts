import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import {
  encryptEnvelope,
  decryptEnvelope,
  storageKeys,
} from "../drivers/secure-storage";
import {
  scanDocument,
  requireCleanDownload,
} from "../drivers/document-scanner";
import { parseReminderPolicy, reminderKind } from "../drivers/reminder-service";

test("document encryption authenticates bytes, purpose and key identity", () => {
  const key = randomBytes(32),
    bytes = Buffer.from("synthetic-private-document");
  const encrypted = encryptEnvelope(bytes, key, "test", "driver-documents");
  assert.equal(encrypted.includes(bytes), false);
  assert.deepEqual(
    decryptEnvelope(encrypted, { test: key }, "driver-documents"),
    bytes,
  );
  assert.throws(() =>
    decryptEnvelope(encrypted, { test: key }, "driver-quarantine"),
  );
  assert.throws(() => decryptEnvelope(encrypted, {}, "driver-documents"));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() =>
    decryptEnvelope(encrypted, { test: key }, "driver-documents"),
  );
});
test("production fails closed for absent encryption keys and absent scanner", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DRIVERS_STORAGE_KEYS: "{}",
      DRIVERS_STORAGE_ACTIVE_KEY: "",
    });
    delete process.env.DRIVERS_CLAMD_SOCKET;
    assert.throws(() => storageKeys());
    assert.equal(
      (await scanDocument(Buffer.from("synthetic"))).status,
      "ERROR",
    );
    assert.throws(() =>
      requireCleanDownload({ scanStatus: "UNSCANNED", scannedAt: null }),
    );
    assert.throws(() =>
      requireCleanDownload({ scanStatus: "CLEAN", scannedAt: null }),
    );
    requireCleanDownload({ scanStatus: "CLEAN", scannedAt: new Date() });
  } finally {
    for (const name of Object.keys(process.env))
      if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});
test("reminders catch up to the nearest threshold and distinguish UTC expired day", () => {
  const now = new Date("2026-10-25T23:59:59Z");
  for (const [days, expected] of [
    [91, null],
    [90, "DAYS_90"],
    [60, "DAYS_60"],
    [30, "DAYS_30"],
    [0, "DAYS_30"],
    [-1, "EXPIRED"],
  ] as const)
    assert.equal(
      reminderKind(new Date(Date.UTC(2026, 9, 25 + days)), now),
      expected,
    );
});
test("missing-document reminders require explicit validated policy", () => {
  assert.throws(() =>
    parseReminderPolicy({
      enabled: true,
      requiredTypes: ["COMPLIANT"],
      trackedTypes: [],
    }),
  );
  assert.throws(() =>
    parseReminderPolicy({
      enabled: true,
      requiredTypes: [],
      trackedTypes: [],
      mvrReviewDays: -1,
    }),
  );
  assert.deepEqual(
    parseReminderPolicy({
      enabled: false,
      requiredTypes: [],
      trackedTypes: ["MVR"],
      mvrReviewDays: 365,
    }),
    {
      enabled: false,
      requiredTypes: [],
      trackedTypes: ["MVR"],
      mvrReviewDays: 365,
    },
  );
});
