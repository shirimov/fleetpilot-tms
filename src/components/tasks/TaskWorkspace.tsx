'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskPriority, TaskStatus } from '@prisma/client';
import type { KanbanProject } from '@/lib/tasks/kanban-types';
import { moveCardInBoardState } from '@/lib/tasks/kanban-state';
import {
  EMPTY_TASK_FILTERS,
  deriveVisibleProject,
  findTaskCard,
  getTaskAssignees,
  hasActiveTaskFilters,
  type DueDateFilter,
  type TaskFilters,
  type TaskSort,
  type TaskView,
} from '@/lib/tasks/task-workspace-state';
import TaskBoardView, { type TaskBoardMove } from './TaskBoardView';
import TaskDetailDrawer from './TaskDetailDrawer';
import TaskTableView from './TaskTableView';

type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
};

type RequestError = { error?: string };

const statuses: Array<{ value: TaskStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const priorities: Array<TaskPriority | 'all'> = [
  'all',
  'URGENT',
  'HIGH',
  'MEDIUM',
  'LOW',
];

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-white/10 bg-[#1a1d27] px-3 text-xs font-medium text-slate-300 outline-none hover:border-white/20 focus:border-blue-400"
      >
        {children}
      </select>
    </label>
  );
}

export default function TaskWorkspace() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [project, setProject] = useState<KanbanProject | null>(null);
  const [view, setView] = useState<TaskView>('board');
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS);
  const [sort, setSort] = useState<TaskSort>('board');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/tasks')
      .then(async (response) => {
        if (!response.ok) throw new Error('Projects could not be loaded.');
        return (await response.json()) as ProjectSummary[];
      })
      .then((projectList) => {
        if (!active) return;
        setProjects(projectList);
        setSelectedProjectId((current) => current || projectList[0]?.id || '');
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Projects could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setLoadingProjects(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadBoard = useCallback(async () => {
    if (!selectedProjectId) {
      setProject(null);
      return;
    }
    setLoadingBoard(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/projects/${selectedProjectId}/board`,
      );
      const body = (await response.json()) as KanbanProject | RequestError;
      if (!response.ok) {
        throw new Error(
          'error' in body && body.error
            ? body.error
            : 'The project workspace could not be loaded.',
        );
      }
      setProject(body as KanbanProject);
    } catch (loadError) {
      setProject(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'The project workspace could not be loaded.',
      );
    } finally {
      setLoadingBoard(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setSelectedCardId(null);
    setFilters(EMPTY_TASK_FILTERS);
    setSort('board');
    void loadBoard();
  }, [loadBoard]);

  const visibleProject = useMemo(
    () => (project ? deriveVisibleProject(project, filters, sort) : null),
    [filters, project, sort],
  );
  const assignees = useMemo(() => getTaskAssignees(project), [project]);
  const selectedCard = useMemo(
    () =>
      project && selectedCardId
        ? findTaskCard(project.boards, selectedCardId)
        : null,
    [project, selectedCardId],
  );
  const filtersActive = hasActiveTaskFilters(filters);
  const movementDisabled = filtersActive || sort !== 'board';

  function updateFilter<Key extends keyof TaskFilters>(
    key: Key,
    value: TaskFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function moveTask(move: TaskBoardMove) {
    if (!project || moving) return;
    const sourceCard = findTaskCard(project.boards, move.cardId)?.card;
    if (!sourceCard) return;

    const snapshot = project;
    const optimisticBoards = moveCardInBoardState(project.boards, move);
    if (optimisticBoards === project.boards) return;
    setProject({ ...project, boards: optimisticBoards });
    setMoving(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/cards/${move.cardId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...move,
          expectedUpdatedAt: sourceCard.updatedAt,
        }),
      });
      const body = (await response.json()) as KanbanProject | RequestError;
      if (!response.ok) {
        throw new Error(
          'error' in body && body.error
            ? body.error
            : 'The task move could not be saved.',
        );
      }
      setProject(body as KanbanProject);
    } catch (moveError) {
      setProject(snapshot);
      setError(
        `${
          moveError instanceof Error
            ? moveError.message
            : 'The task move failed.'
        } The previous board state was restored.`,
      );
    } finally {
      setMoving(false);
    }
  }

  async function createTask() {
    if (!project || !newTaskTitle.trim() || creatingTask) return;
    const destination =
      project.boards.find(({ status }) => status === 'TODO') ??
      project.boards.find(({ status }) => status !== null);
    if (!destination) {
      setError('A status-mapped group is required before adding a task.');
      return;
    }

    setCreatingTask(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          boardId: destination.id,
          title: newTaskTitle.trim(),
        }),
      });
      const body = (await response.json()) as RequestError;
      if (!response.ok) {
        throw new Error(body.error ?? 'The task could not be created.');
      }
      setNewTaskTitle('');
      setShowCreateTask(false);
      await loadBoard();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'The task could not be created.',
      );
    } finally {
      setCreatingTask(false);
    }
  }

  if (loadingProjects) {
    return <TaskWorkspaceSkeleton />;
  }

  return (
    <main className="min-h-screen bg-[#0e1017] text-white">
      <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
                <span className="inline-block h-2 w-2 rounded-sm bg-blue-400" />
                Task workspace
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label="Project"
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  className="max-w-[min(70vw,32rem)] rounded-lg border border-transparent bg-transparent py-1 pr-8 text-2xl font-semibold text-white outline-none hover:border-white/10 focus:border-blue-400 sm:text-3xl"
                >
                  {projects.map((projectOption) => (
                    <option key={projectOption.id} value={projectOption.id} className="bg-slate-900">
                      {projectOption.name}
                    </option>
                  ))}
                </select>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
                  Live operations
                </span>
              </div>
              {project?.description && (
                <p className="mt-2 max-w-3xl text-sm text-slate-400">
                  {project.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowCreateTask(true)}
              disabled={!project}
              className="rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/15 hover:bg-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-40"
            >
              + Add task
            </button>
          </div>
        </header>

        <div className="mb-4 flex flex-col gap-3 border-y border-white/8 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-1" aria-label="Task view">
            {(['board', 'table'] as const).map((viewOption) => (
              <button
                key={viewOption}
                type="button"
                onClick={() => setView(viewOption)}
                aria-pressed={view === viewOption}
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  view === viewOption
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {viewOption}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[min(100%,15rem)] flex-1 xl:flex-none">
              <span className="sr-only">Search tasks</span>
              <span className="pointer-events-none absolute left-3 top-2 text-slate-500">⌕</span>
              <input
                type="search"
                value={filters.query}
                onChange={(event) => updateFilter('query', event.target.value)}
                placeholder="Search tasks"
                className="h-9 w-full rounded-lg border border-white/10 bg-[#1a1d27] pl-8 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400 xl:w-56"
              />
            </label>
            <Select label="Status filter" value={filters.status} onChange={(value) => updateFilter('status', value as TaskFilters['status'])}>
              {statuses.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Select label="Assignee filter" value={filters.assignee} onChange={(value) => updateFilter('assignee', value)}>
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {assignees.map((assignee) => <option key={assignee} value={assignee}>{assignee}</option>)}
            </Select>
            <Select label="Priority filter" value={filters.priority} onChange={(value) => updateFilter('priority', value as TaskFilters['priority'])}>
              {priorities.map((priority) => <option key={priority} value={priority}>{priority === 'all' ? 'All priorities' : priority}</option>)}
            </Select>
            <Select label="Due date filter" value={filters.dueDate} onChange={(value) => updateFilter('dueDate', value as DueDateFilter)}>
              <option value="all">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="soon">Due in 7 days</option>
              <option value="none">No due date</option>
            </Select>
            <Select label="Sort tasks" value={sort} onChange={(value) => setSort(value as TaskSort)}>
              <option value="board">Board order</option>
              <option value="updated">Recently updated</option>
              <option value="dueDate">Due date</option>
              <option value="priority">Priority</option>
              <option value="title">Task title</option>
            </Select>
            {filtersActive && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_TASK_FILTERS)}
                className="h-9 rounded-lg px-3 text-xs font-semibold text-blue-300 hover:bg-blue-400/10"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {movementDisabled && view === 'board' && project && (
          <p className="mb-3 text-xs text-slate-500">
            Dragging is paused while filters or custom sorting are active.
          </p>
        )}
        {moving && <p role="status" className="mb-3 text-xs font-medium text-blue-300">Saving task move…</p>}
        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            <span>{error}</span>
            {selectedProjectId && (
              <button type="button" onClick={() => void loadBoard()} className="font-semibold underline">Retry</button>
            )}
          </div>
        )}

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-16 text-center">
            <h2 className="text-lg font-semibold">No task projects yet</h2>
            <p className="mt-2 text-sm text-slate-500">Create a project through the existing task API to start organizing work.</p>
          </div>
        ) : loadingBoard ? (
          <TaskWorkspaceSkeleton compact />
        ) : visibleProject ? (
          view === 'board' ? (
            <TaskBoardView
              project={visibleProject}
              moving={moving}
              movementDisabled={movementDisabled}
              onMove={moveTask}
              onOpenCard={setSelectedCardId}
            />
          ) : (
            <TaskTableView project={visibleProject} onOpenCard={setSelectedCardId} />
          )
        ) : null}
      </div>

      {selectedCard && (
        <TaskDetailDrawer
          card={selectedCard.card}
          board={selectedCard.board}
          onClose={() => setSelectedCardId(null)}
        />
      )}
      {showCreateTask && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createTask();
            }}
            className="w-full max-w-md rounded-xl border border-white/10 bg-[#171a24] p-5 shadow-2xl"
          >
            <h2 className="text-lg font-semibold">Add a task</h2>
            <p className="mt-1 text-sm text-slate-500">New tasks are appended to the project&apos;s To do group.</p>
            <input
              autoFocus
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              placeholder="What needs to be done?"
              className="mt-5 w-full rounded-lg border border-white/10 bg-[#10121a] px-3 py-2.5 text-sm outline-none focus:border-blue-400"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateTask(false)} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-white/5">Cancel</button>
              <button disabled={!newTaskTitle.trim() || creatingTask} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">
                {creatingTask ? 'Adding…' : 'Add task'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function TaskWorkspaceSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-label="Loading task workspace" className={compact ? '' : 'min-h-screen bg-[#0e1017] p-8'}>
      <div className="animate-pulse space-y-4">
        {!compact && <div className="h-10 w-72 rounded-lg bg-white/8" />}
        <div className="h-12 rounded-lg bg-white/5" />
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((value) => (
            <div key={value} className="h-96 w-80 shrink-0 rounded-xl bg-white/5" />
          ))}
        </div>
      </div>
    </div>
  );
}
