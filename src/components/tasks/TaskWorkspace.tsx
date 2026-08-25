'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskPriority, TaskStatus } from '@prisma/client';
import type { KanbanCardFieldUpdate, KanbanProject } from '@/lib/tasks/kanban-types';
import { moveCardInBoardState, updateCardInBoardState } from '@/lib/tasks/kanban-state';
import type { TaskAssignee } from '@/lib/tasks/task-types';
import { localDateTimeToIso } from '@/lib/tasks/task-deadline';
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
import {
  CreateProjectDialog,
  CreateTaskDialog,
} from './TaskCreationDialogs';

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
  const [updatingCardIds, setUpdatingCardIds] = useState<Set<string>>(new Set());
  const [assigneeOptions, setAssigneeOptions] = useState<TaskAssignee[]>([]);
  const [clockNow, setClockNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectCreationError, setProjectCreationError] = useState('');
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('TODO');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('MEDIUM');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskEffort, setNewTaskEffort] = useState(3);
  const [newTaskExpectedDurationMinutes, setNewTaskExpectedDurationMinutes] = useState('');
  const [newTaskAssigneeUserId, setNewTaskAssigneeUserId] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskCreationError, setTaskCreationError] = useState('');
  const addTaskTriggerRef = useRef<HTMLButtonElement>(null);
  const createProjectTriggerRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    let active = true;
    fetch('/api/tasks/assignees')
      .then(async (response) => {
        if (!response.ok) throw new Error('Assignees could not be loaded.');
        return (await response.json()) as TaskAssignee[];
      })
      .then((members) => { if (active) setAssigneeOptions(members); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Assignees could not be loaded.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
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
  const selectedProject = projects.find(({ id }) => id === selectedProjectId);
  const creationStatuses = useMemo(() => {
    if (!project) return [];
    return project.boards.flatMap((board) =>
      board.status ? [{ value: board.status, label: board.name }] : [],
    );
  }, [project]);

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

  async function updateTaskCard(
    cardId: string,
    changes: KanbanCardFieldUpdate,
  ) {
    if (!project || updatingCardIds.has(cardId)) return;
    const current = findTaskCard(project.boards, cardId)?.card;
    if (!current) return;
    const snapshot = project;
    const optimisticChanges = {
      ...changes,
      ...(Object.hasOwn(changes, 'assigneeUserId')
        ? {
            assignedTo: null,
            assigneeUser:
              assigneeOptions.find(({ id }) => id === changes.assigneeUserId) ?? null,
          }
        : {}),
    };
    setProject({
      ...project,
      boards: updateCardInBoardState(project.boards, cardId, optimisticChanges),
    });
    setUpdatingCardIds((ids) => new Set(ids).add(cardId));
    setError(null);
    try {
      const response = await fetch('/api/tasks/cards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cardId, ...changes, expectedUpdatedAt: current.updatedAt }),
      });
      const body = (await response.json()) as KanbanProject['boards'][number]['cards'][number] | RequestError;
      if (!response.ok || !('id' in body)) throw new Error('error' in body ? body.error : 'Task update failed.');
      setProject((latest) => latest ? {
        ...latest,
        boards: updateCardInBoardState(latest.boards, cardId, body),
      } : latest);
    } catch (updateError) {
      setProject(snapshot);
      setError(`${updateError instanceof Error ? updateError.message : 'Task update failed.'} The previous value was restored.`);
    } finally {
      setUpdatingCardIds((ids) => {
        const next = new Set(ids);
        next.delete(cardId);
        return next;
      });
    }
  }

  async function changeTaskStatus(cardId: string, status: TaskStatus) {
    if (!project) return;
    const source = findTaskCard(project.boards, cardId);
    const destination = project.boards.find((board) => board.status === status);
    if (!source || !destination || source.board.id === destination.id) return;
    await moveTask({
      cardId,
      sourceBoardId: source.board.id,
      destinationBoardId: destination.id,
      destinationIndex: destination.cards.length,
    });
  }

  function reconcileDescription(cardId: string, description: string, updatedAt: string) {
    setProject((current) => current ? {
      ...current,
      boards: updateCardInBoardState(current.boards, cardId, { description, updatedAt }),
    } : current);
  }

  function removeDeletedTask(cardId: string) {
    setProject((current) => current ? {
      ...current,
      boards: current.boards.map((board) => ({
        ...board,
        cards: board.cards.filter((card) => card.id !== cardId),
      })),
    } : current);
    setSelectedCardId(null);
  }

  function openCreateTask() {
    if (!project || creationStatuses.length === 0) return;
    setNewTaskTitle('');
    setNewTaskStatus(
      creationStatuses.some(({ value }) => value === 'TODO')
        ? 'TODO'
        : creationStatuses[0]!.value,
    );
    setNewTaskPriority('MEDIUM');
    setNewTaskDueDate('');
    setNewTaskAssigneeUserId('');
    setTaskCreationError('');
    setShowCreateTask(true);
  }

  function openCreateProject() {
    setNewProjectName('');
    setProjectCreationError('');
    setShowCreateProject(true);
  }

  async function createProject() {
    if (!newProjectName.trim() || creatingProject) return;
    setCreatingProject(true);
    setProjectCreationError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      const body = (await response.json()) as ProjectSummary | RequestError;
      if (!response.ok || !('id' in body)) {
        throw new Error(
          'error' in body && body.error
            ? body.error
            : 'The project could not be created.',
        );
      }
      const createdProject = body as ProjectSummary;
      setProjects((current) => [...current, createdProject]);
      setSelectedProjectId(createdProject.id);
      setShowCreateProject(false);
      setNewProjectName('');
    } catch (createError) {
      setProjectCreationError(
        createError instanceof Error
          ? createError.message
          : 'The project could not be created.',
      );
    } finally {
      setCreatingProject(false);
    }
  }

  async function createTask() {
    if (!project || !newTaskTitle.trim() || creatingTask) return;
    const destination = project.boards.find(
      ({ status }) => status === newTaskStatus,
    );
    if (!destination) {
      setTaskCreationError(
        'The selected status is not mapped to a group in this project.',
      );
      return;
    }

    setCreatingTask(true);
    setTaskCreationError('');
    try {
      const response = await fetch('/api/tasks/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          boardId: destination.id,
          title: newTaskTitle.trim(),
          priority: newTaskPriority,
          dueDate: localDateTimeToIso(newTaskDueDate),
          effort: newTaskEffort,
          expectedDurationMinutes: newTaskExpectedDurationMinutes ? Number(newTaskExpectedDurationMinutes) : null,
          assigneeUserId: newTaskAssigneeUserId || null,
        }),
      });
      const body = (await response.json()) as RequestError;
      if (!response.ok) {
        throw new Error(body.error ?? 'The task could not be created.');
      }
      setNewTaskTitle('');
      await loadBoard();
      setShowCreateTask(false);
    } catch (createError) {
      setTaskCreationError(
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
    <main className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.08),transparent_34%),#090d17] text-white">
      <div className="mx-auto max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 rounded-2xl border border-white/8 bg-gradient-to-r from-blue-500/10 via-slate-900/75 to-cyan-400/5 p-4 shadow-xl shadow-black/10 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
                <span className="inline-block h-2 w-2 rounded-sm bg-blue-400" />
                Task Manager
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
                  Live workspace
                </span>
              </div>
              {project?.description && (
                <p className="mt-2 max-w-3xl text-sm text-slate-400">
                  {project.description}
                </p>
              )}
            </div>
            <button
              ref={addTaskTriggerRef}
              type="button"
              onClick={openCreateTask}
              disabled={!project}
              aria-describedby={!project ? 'add-task-prerequisite' : undefined}
              title={!project ? 'Create a project before adding tasks' : undefined}
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
            <p id="add-task-prerequisite" className="mt-2 text-sm text-slate-500">
              Create your first project to organize tasks into a shared workspace.
            </p>
            <button
              ref={createProjectTriggerRef}
              type="button"
              onClick={openCreateProject}
              className="mt-5 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              Create project
            </button>
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
              assignees={assigneeOptions}
              statuses={creationStatuses}
              now={clockNow}
              updatingCardIds={updatingCardIds}
              onUpdateCard={updateTaskCard}
              onStatusChange={changeTaskStatus}
            />
          ) : (
            <TaskTableView project={visibleProject} onOpenCard={setSelectedCardId} assignees={assigneeOptions} statuses={creationStatuses} now={clockNow} updatingCardIds={updatingCardIds} onUpdateCard={updateTaskCard} onStatusChange={changeTaskStatus} />
          )
        ) : null}
      </div>

      {selectedCard && (
        <TaskDetailDrawer
          card={selectedCard.card}
          board={selectedCard.board}
          onClose={() => setSelectedCardId(null)}
          assignees={assigneeOptions}
          statuses={creationStatuses}
          now={clockNow}
          updating={updatingCardIds.has(selectedCard.card.id)}
          onUpdateCard={updateTaskCard}
          onStatusChange={changeTaskStatus}
          onDescriptionSaved={reconcileDescription}
          onDeleted={removeDeletedTask}
        />
      )}
      {showCreateProject && (
        <CreateProjectDialog
          name={newProjectName}
          pending={creatingProject}
          error={projectCreationError}
          onNameChange={setNewProjectName}
          onSubmit={() => void createProject()}
          onClose={() => {
            if (!creatingProject) setShowCreateProject(false);
          }}
        />
      )}
      {showCreateTask && project && selectedProject && (
        <CreateTaskDialog
          project={selectedProject}
          statuses={creationStatuses}
          title={newTaskTitle}
          status={newTaskStatus}
          priority={newTaskPriority}
          dueDate={newTaskDueDate}
          effort={newTaskEffort}
          expectedDurationMinutes={newTaskExpectedDurationMinutes}
          assigneeUserId={newTaskAssigneeUserId}
          assignees={assigneeOptions}
          pending={creatingTask}
          error={taskCreationError}
          onTitleChange={setNewTaskTitle}
          onStatusChange={setNewTaskStatus}
          onPriorityChange={setNewTaskPriority}
          onDueDateChange={setNewTaskDueDate}
          onEffortChange={setNewTaskEffort}
          onExpectedDurationMinutesChange={setNewTaskExpectedDurationMinutes}
          onAssigneeChange={setNewTaskAssigneeUserId}
          onSubmit={() => void createTask()}
          onClose={() => {
            if (!creatingTask) setShowCreateTask(false);
          }}
        />
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
