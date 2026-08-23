import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCreateTaskCardInput, validateUpdateTaskCardInput, TaskValidationError } from './task-validation';

const base = { projectId: 'project', boardId: 'board', title: 'Plan load' };

test('task effort defaults in persistence and accepts canonical values 1 through 5', () => {
  assert.equal(validateCreateTaskCardInput({ ...base }).effort, undefined);
  for (const effort of [1, 2, 3, 4, 5]) assert.equal(validateCreateTaskCardInput({ ...base, effort }).effort, effort);
});

test('task effort rejects values outside 1 through 5', () => {
  for (const effort of [0, 6, 2.5, '3']) assert.throws(() => validateCreateTaskCardInput({ ...base, effort }), TaskValidationError);
});

test('expected duration accepts positive canonical minutes and null', () => {
  assert.equal(validateCreateTaskCardInput({ ...base, expectedDurationMinutes: 120 }).expectedDurationMinutes, 120);
  assert.equal(validateUpdateTaskCardInput({ id: 'task', expectedDurationMinutes: null }).expectedDurationMinutes, null);
  assert.throws(() => validateUpdateTaskCardInput({ id: 'task', expectedDurationMinutes: 0 }), TaskValidationError);
});

test('blocked metadata validates reason and supports clearing', () => {
  const blocked = validateUpdateTaskCardInput({ id: 'task', blockedReason: 'WAITING_ON_CUSTOMER', blockedNote: 'Awaiting documents' });
  assert.equal(blocked.blockedReason, 'WAITING_ON_CUSTOMER');
  assert.equal(validateUpdateTaskCardInput({ id: 'task', blockedReason: null }).blockedReason, null);
  assert.throws(() => validateUpdateTaskCardInput({ id: 'task', blockedReason: 'EMPLOYEE_DELAY' }), TaskValidationError);
});
