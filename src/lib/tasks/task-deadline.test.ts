import assert from 'node:assert/strict';
import test from 'node:test';
import { deadlinePresentation, isoToLocalDateTime, localDateTimeToIso } from './task-deadline';

const now = Date.parse('2030-01-01T12:00:00.000Z');

test('deadline countdown covers every urgency state accessibly', () => {
  assert.equal(deadlinePresentation(null, now, 'TODO').tone, 'none');
  assert.deepEqual(
    deadlinePresentation('2030-01-03T18:14:00.000Z', now, 'TODO').label,
    '2d 06:14',
  );
  assert.equal(deadlinePresentation('2030-01-02T05:42:18.000Z', now, 'TODO').tone, 'warning');
  assert.equal(deadlinePresentation('2030-01-01T12:18:30.000Z', now, 'TODO').tone, 'urgent');
  assert.match(deadlinePresentation('2030-01-01T10:35:00.000Z', now, 'TODO').label, /^Overdue /);
  assert.equal(deadlinePresentation('2030-01-01T10:35:00.000Z', now, 'DONE').label, 'Completed');
  assert.match(
    deadlinePresentation('2030-01-01T12:18:30.000Z', now, 'TODO', 'en-US').accessibleLabel,
    /Due .*Due in 18m 30s/,
  );
});

test('local date-time inputs round trip through an unambiguous UTC timestamp', () => {
  const localValue = '2030-06-15T14:30';
  const iso = localDateTimeToIso(localValue);
  assert.ok(iso?.endsWith('Z'));
  assert.equal(isoToLocalDateTime(iso), localValue);
  assert.equal(localDateTimeToIso(''), null);
});
