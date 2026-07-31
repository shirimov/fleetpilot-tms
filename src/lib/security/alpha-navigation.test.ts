import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alphaNavigation,
  navigationItemIsActive,
} from '@/components/app-shell/navigation';

test('alpha navigation exposes completed modules and marks blocked inbox unavailable', () => {
  const items = alphaNavigation.flatMap(({ items }) => items);
  assert.deepEqual(
    items.filter(({ unavailable }) => !unavailable).map(({ label }) => label),
    [
      'Dashboard',
      'Dispatch Board',
      'Loads',
      'Customers',
      'Trucks',
      'Trailers',
      'Drivers',
      'Inspections',
      'Task Manager',
      'Settlements',
      'Finance',
      'Companies',
      'HR',
    ],
  );
  assert.equal(items.find(({ label }) => label === 'Inbox')?.unavailable, true);
});

test('dispatch workspace query views have deterministic active navigation', () => {
  assert.equal(
    navigationItemIsActive('/loads?view=customers', '/loads', 'view=customers'),
    true,
  );
  assert.equal(
    navigationItemIsActive('/loads?view=dispatch', '/loads', 'view=customers'),
    false,
  );
  assert.equal(
    navigationItemIsActive('/loads?view=loads', '/loads', 'view=loads'),
    true,
  );
  assert.equal(navigationItemIsActive('/tasks', '/tasks', ''), true);
});
