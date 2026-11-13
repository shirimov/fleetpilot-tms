import assert from 'node:assert/strict';
import test from 'node:test';
import type { KanbanProject } from './kanban-types';
import { moveCardInBoardState, updateCardInBoardState } from './kanban-state';
import {
  EMPTY_TASK_FILTERS,
  deriveVisibleProject,
  findTaskCard,
  getTaskAssignees,
  hasActiveTaskFilters,
} from './task-workspace-state';

function recoveryProject(): KanbanProject {
  return {
    id: 'synthetic-project',
    name: 'Recovery acceptance fixture',
    description: null,
    boards: [
      {
        id: 'todo', name: 'To do', color: null, order: 0, status: 'TODO',
        cards: [
          {
            id: 'related', title: 'Zulu inspection', description: null,
            priority: 'LOW', status: 'TODO', assignedTo: 'Historical name',
            assigneeUserId: 'synthetic-user',
            assigneeUser: { id: 'synthetic-user', displayName: 'Current assignee', image: null },
            dueDate: null, order: 0, updatedAt: '2030-01-01T00:00:00.000Z', labels: [],
          },
          {
            id: 'legacy', title: 'Alpha dispatch', description: 'Legacy assignment',
            priority: 'HIGH', status: 'TODO', assignedTo: 'Legacy assignee',
            dueDate: null, order: 1, updatedAt: '2030-01-01T00:00:00.000Z', labels: [],
          },
        ],
      },
      { id: 'done', name: 'Done', color: null, order: 1, status: 'DONE', cards: [] },
      { id: 'legacy-board', name: 'Imported', color: null, order: 2, status: null, cards: [] },
    ],
  };
}

const now = Date.parse('2030-01-02T00:00:00.000Z');

function cardIds(project: KanbanProject): string[][] {
  return project.boards.map((board) => board.cards.map((card) => card.id));
}

test('clearing stale filters restores canonical ordering, empty legacy boards, and assignments', () => {
  const canonical = recoveryProject();
  const saved = structuredClone(canonical);
  const staleFilters = { ...EMPTY_TASK_FILTERS, assignee: 'Removed assignee' };

  const sorted = deriveVisibleProject(canonical, EMPTY_TASK_FILTERS, 'title', now);
  assert.deepEqual(cardIds(sorted), [['legacy', 'related'], [], []]);
  const hidden = deriveVisibleProject(canonical, staleFilters, 'title', now);
  assert.equal(hasActiveTaskFilters(staleFilters), true);
  assert.deepEqual(cardIds(hidden), [[], [], []]);
  // Drawer lookup and filter options use canonical data, not the empty projection.
  assert.equal(findTaskCard(canonical.boards, 'related')?.board.id, 'todo');
  assert.deepEqual(getTaskAssignees(canonical), ['Current assignee', 'Legacy assignee']);

  const recovered = deriveVisibleProject(canonical, EMPTY_TASK_FILTERS, 'board', now);
  assert.equal(hasActiveTaskFilters(EMPTY_TASK_FILTERS), false);
  assert.deepEqual(recovered, saved);
  assert.equal(recovered.boards[2].status, null);
  assert.deepEqual(canonical, saved, 'filtering and sorting must not mutate the recovery snapshot');
});

test('a status-filtered optimistic move leaves the original snapshot recoverable with assignment intact', () => {
  const canonical = recoveryProject();
  const saved = structuredClone(canonical);
  const optimistic = {
    ...canonical,
    boards: moveCardInBoardState(canonical.boards, {
      cardId: 'related', destinationBoardId: 'done', destinationIndex: 0,
    }),
  };
  const moved = findTaskCard(optimistic.boards, 'related');
  assert.equal(moved?.board.id, 'done');
  assert.equal(moved?.card.status, 'DONE');
  assert.equal(moved?.card.assigneeUserId, 'synthetic-user');
  assert.deepEqual(moved?.card.assigneeUser, saved.boards[0].cards[0].assigneeUser);
  assert.equal(moved?.card.assignedTo, 'Historical name');
  assert.deepEqual(cardIds(deriveVisibleProject(
    optimistic, { ...EMPTY_TASK_FILTERS, status: 'TODO' }, 'board', now,
  )), [['legacy'], [], []]);

  // The workspace restores this pre-request snapshot on a failed move.
  // This tests the real helpers' snapshot safety, not React/fetch error handling.
  assert.deepEqual(deriveVisibleProject(canonical, EMPTY_TASK_FILTERS, 'board', now), saved);
  assert.deepEqual(canonical, saved);
});

test('unrelated optimistic edits retain relation precedence and legacy assignment filtering', () => {
  const canonical = recoveryProject();
  const saved = structuredClone(canonical);
  const edited = {
    ...canonical,
    boards: updateCardInBoardState(canonical.boards, 'related', { priority: 'URGENT' }),
  };
  const byAssignee = (assignee: string) => cardIds(deriveVisibleProject(
    edited, { ...EMPTY_TASK_FILTERS, assignee }, 'board', now,
  ));

  assert.deepEqual(byAssignee('Current assignee'), [['related'], [], []]);
  assert.deepEqual(byAssignee('Historical name'), [[], [], []]);
  assert.deepEqual(byAssignee('Legacy assignee'), [['legacy'], [], []]);
  assert.deepEqual(byAssignee('unassigned'), [[], [], []]);
  assert.deepEqual(getTaskAssignees(edited), ['Current assignee', 'Legacy assignee']);
  assert.deepEqual(findTaskCard(edited.boards, 'related')?.card, {
    ...saved.boards[0].cards[0], priority: 'URGENT',
  });
  assert.deepEqual(canonical, saved, 'a failed edit must still have an unchanged rollback snapshot');
});
