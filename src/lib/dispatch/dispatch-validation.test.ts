import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTrailerVinInput } from './dispatch-validation';

test('trailer VIN input remains strict and normalizes valid VINs', () => {
  assert.equal(validateTrailerVinInput({ vin: '1hgcm82633a004352' }), '1HGCM82633A004352');
  assert.throws(
    () => validateTrailerVinInput({ vin: 'not-a-valid-vin' }),
    /valid 17-character VIN with a valid check digit/,
  );
});
