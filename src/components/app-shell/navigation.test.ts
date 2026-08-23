import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationForRole } from './navigation';

function labelsFor(role: 'OWNER' | 'ADMIN' | 'MEMBER') {
  return navigationForRole(role).flatMap((section) =>
    section.items.map((item) => item.label),
  );
}

test('MEMBER navigation contains only Task Manager and their profile', () => {
  assert.deepEqual(labelsFor('MEMBER'), ['Task Manager', 'My Profile']);
});

test('OWNER and ADMIN navigation preserve the Alpha modules', () => {
  const ownerLabels = labelsFor('OWNER');
  assert.deepEqual(labelsFor('ADMIN'), ownerLabels);
  assert.ok(ownerLabels.includes('Task Manager'));
  assert.ok(ownerLabels.includes('Dispatch Board'));
  assert.ok(ownerLabels.includes('Finance'));
  assert.ok(ownerLabels.includes('Team'));
});
