import assert from 'node:assert/strict';
import test from 'node:test';
import {
  landingPageForRole,
  moduleForPath,
  roleCanAccessModule,
  roleCanAccessPath,
} from './module-permissions';

test('MEMBER lands on Task Manager and can use Task and profile modules', () => {
  assert.equal(landingPageForRole('MEMBER'), '/tasks');
  assert.equal(roleCanAccessModule('MEMBER', 'tasks'), true);
  assert.equal(roleCanAccessModule('MEMBER', 'profile'), true);
  assert.equal(roleCanAccessPath('MEMBER', '/tasks'), true);
  assert.equal(roleCanAccessPath('MEMBER', '/api/tasks/cards/card-id/comments'), true);
  assert.equal(roleCanAccessPath('MEMBER', '/api/tasks/cards/card-id/checklist'), true);
  assert.equal(roleCanAccessPath('MEMBER', '/api/tasks/cards/card-id/telegram'), true);
  assert.equal(roleCanAccessPath('MEMBER', '/api/auth/company'), true);
});

test('MEMBER is denied unfinished pages and their APIs', () => {
  for (const pathname of [
    '/',
    '/administration',
    '/dispatch',
    '/loads',
    '/companies',
    '/drivers',
    '/hr/employees',
    '/finance',
    '/trucks',
    '/api/dashboard',
    '/api/company/team',
    '/api/loads',
    '/api/companies',
    '/api/drivers',
    '/api/employees',
    '/api/plaid/accounts',
    '/api/trucks',
  ]) {
    assert.equal(roleCanAccessPath('MEMBER', pathname), false, pathname);
  }
});

test('OWNER and ADMIN retain access to every current module', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    assert.equal(landingPageForRole(role), '/');
    for (const pathname of [
      '/',
      '/tasks',
      '/administration',
      '/loads',
      '/trucks',
      '/finance',
      '/hr/employees',
      '/api/company/team',
      '/api/loads',
      '/api/plaid/accounts',
    ]) {
      assert.equal(roleCanAccessPath(role, pathname), true, `${role} ${pathname}`);
    }
  }
});

test('public Telegram webhook stays available for secret-token authentication', () => {
  assert.equal(moduleForPath('/api/integrations/telegram/webhook'), null);
  assert.equal(moduleForPath('/api/telegram/webhook'), null);
});

