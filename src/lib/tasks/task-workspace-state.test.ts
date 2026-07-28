import assert from 'node:assert/strict';
import test from 'node:test';
import type { KanbanProject } from './kanban-types';
import {
  EMPTY_TASK_FILTERS,
  deriveVisibleProject,
  findTaskCard,
  getTaskAssignees,
} from './task-workspace-state';

const project: KanbanProject = {
  id: 'project-1',
  name: 'Operations',
  description: null,
  boards: [
    {
      id: 'board-1',
      name: 'Unmapped legacy',
      color: null,
      order: 0,
      status: null,
      cards: [
        {
          id: 'card-1',
          title: 'Inspect trailer',
          description: 'Safety review',
          priority: 'HIGH',
          status: 'TODO',
          assignedTo: 'Aman',
          dueDate: '2026-07-27T00:00:00.000Z',
          order: 0,
          updatedAt: '2026-07-20T00:00:00.000Z',
          labels: [{ id: 'label-1', name: 'Safety', color: '#ef4444' }],
        },
      ],
    },
    {
      id: 'board-2',
      name: 'Done',
      color: '#22c55e',
      order: 1,
      status: 'DONE',
      cards: [
        {
          id: 'card-2',
          title: 'Confirm delivery',
          description: null,
          priority: 'LOW',
          status: 'DONE',
          assignedTo: null,
          dueDate: null,
          order: 0,
          updatedAt: '2026-07-21T00:00:00.000Z',
          labels: [],
        },
      ],
    },
  ],
};

test('filters cards without hiding legacy status-null boards', () => {
  const visible = deriveVisibleProject(
    project,
    { ...EMPTY_TASK_FILTERS, query: 'safety' },
    'board',
    Date.parse('2026-07-28T00:00:00.000Z'),
  );

  assert.equal(visible.boards.length, 2);
  assert.equal(visible.boards[0].status, null);
  assert.deepEqual(visible.boards[0].cards.map(({ id }) => id), ['card-1']);
  assert.equal(visible.boards[1].cards.length, 0);
});

test('supports due-date, status, and deterministic priority sorting', () => {
  const overdue = deriveVisibleProject(
    project,
    { ...EMPTY_TASK_FILTERS, dueDate: 'overdue' },
    'priority',
    Date.parse('2026-07-28T00:00:00.000Z'),
  );
  assert.deepEqual(overdue.boards[0].cards.map(({ id }) => id), ['card-1']);

  const done = deriveVisibleProject(
    project,
    { ...EMPTY_TASK_FILTERS, status: 'DONE' },
    'board',
  );
  assert.equal(done.boards[0].cards.length, 0);
  assert.deepEqual(done.boards[1].cards.map(({ id }) => id), ['card-2']);
});

test('finds drawer card context and returns unique sorted assignees', () => {
  assert.equal(findTaskCard(project.boards, 'card-2')?.board.name, 'Done');
  assert.equal(findTaskCard(project.boards, 'missing'), null);
  assert.deepEqual(getTaskAssignees(project), ['Aman']);
});
