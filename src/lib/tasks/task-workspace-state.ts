import type { TaskPriority, TaskStatus } from '@prisma/client';
import type {
  KanbanCard,
  KanbanColumn,
  KanbanProject,
} from './kanban-types';

export type TaskView = 'board' | 'table';
export type TaskSort = 'board' | 'updated' | 'dueDate' | 'priority' | 'title';
export type DueDateFilter = 'all' | 'overdue' | 'soon' | 'none';

export type TaskFilters = {
  query: string;
  status: TaskStatus | 'all';
  assignee: string;
  priority: TaskPriority | 'all';
  dueDate: DueDateFilter;
};

export const EMPTY_TASK_FILTERS: TaskFilters = {
  query: '',
  status: 'all',
  assignee: 'all',
  priority: 'all',
  dueDate: 'all',
};

const priorityWeight: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function matchesDueDate(
  card: KanbanCard,
  filter: DueDateFilter,
  now: number,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return card.dueDate === null;
  if (!card.dueDate) return false;

  const dueAt = new Date(card.dueDate).getTime();
  if (filter === 'overdue') {
    return (
      dueAt < now && card.status !== 'DONE' && card.status !== 'CANCELLED'
    );
  }

  return dueAt >= now && dueAt <= now + 7 * 24 * 60 * 60 * 1000;
}

export function taskMatchesFilters(
  card: KanbanCard,
  filters: TaskFilters,
  now = Date.now(),
): boolean {
  const query = filters.query.trim().toLocaleLowerCase();
  const matchesQuery =
    !query ||
    card.title.toLocaleLowerCase().includes(query) ||
    card.description?.toLocaleLowerCase().includes(query) ||
    card.labels.some((label) => label.name.toLocaleLowerCase().includes(query));

  return (
    matchesQuery &&
    (filters.status === 'all' || card.status === filters.status) &&
    (filters.assignee === 'all' ||
      (filters.assignee === 'unassigned'
        ? !card.assigneeUserId && !card.assignedTo
        : (card.assigneeUser?.displayName ?? card.assignedTo) === filters.assignee)) &&
    (filters.priority === 'all' || card.priority === filters.priority) &&
    matchesDueDate(card, filters.dueDate, now)
  );
}

export function sortTaskCards(
  cards: KanbanCard[],
  sort: TaskSort,
): KanbanCard[] {
  if (sort === 'board') return [...cards];

  return [...cards].sort((left, right) => {
    let comparison = 0;
    if (sort === 'updated') {
      comparison =
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime();
    } else if (sort === 'dueDate') {
      comparison =
        (left.dueDate ? new Date(left.dueDate).getTime() : Infinity) -
        (right.dueDate ? new Date(right.dueDate).getTime() : Infinity);
    } else if (sort === 'priority') {
      comparison =
        priorityWeight[left.priority] - priorityWeight[right.priority];
    } else {
      comparison = left.title.localeCompare(right.title);
    }

    return comparison || left.order - right.order || left.id.localeCompare(right.id);
  });
}

export function deriveVisibleProject(
  project: KanbanProject,
  filters: TaskFilters,
  sort: TaskSort,
  now = Date.now(),
): KanbanProject {
  return {
    ...project,
    boards: project.boards.map((board) => ({
      ...board,
      cards: sortTaskCards(
        board.cards.filter((card) => taskMatchesFilters(card, filters, now)),
        sort,
      ),
    })),
  };
}

export function findTaskCard(
  boards: KanbanColumn[],
  cardId: string,
): { card: KanbanCard; board: KanbanColumn } | null {
  for (const board of boards) {
    const card = board.cards.find(({ id }) => id === cardId);
    if (card) return { card, board };
  }
  return null;
}

export function getTaskAssignees(project: KanbanProject | null): string[] {
  return Array.from(
    new Set(
      (project?.boards ?? [])
        .flatMap(({ cards }) => cards)
        .map(({ assignedTo, assigneeUser }) => assigneeUser?.displayName ?? assignedTo)
        .filter((assignee): assignee is string => Boolean(assignee)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function hasActiveTaskFilters(filters: TaskFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.status !== 'all' ||
    filters.assignee !== 'all' ||
    filters.priority !== 'all' ||
    filters.dueDate !== 'all'
  );
}
