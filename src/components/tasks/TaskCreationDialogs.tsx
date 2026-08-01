'use client';

import { type FormEvent, useRef } from 'react';
import type { TaskPriority, TaskStatus } from '@prisma/client';
import ModalLayer from '@/components/ui/ModalLayer';
import type { TaskAssignee } from '@/lib/tasks/task-types';

type ProjectSummary = {
  id: string;
  name: string;
};

const fieldClassName =
  'mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#10121a] px-3 text-sm text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 disabled:cursor-not-allowed disabled:opacity-60';

export function CreateProjectDialog({
  name,
  pending,
  error,
  onNameChange,
  onSubmit,
  onClose,
}: {
  name: string;
  pending: boolean;
  error: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending) onSubmit();
  }

  return (
    <ModalLayer
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-[2px]"
      labelledBy="create-project-title"
      describedBy="create-project-description"
      initialFocusRef={nameRef}
      onClose={onClose}
      canCloseOnEscape={() => !pending}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#171a24] p-5 shadow-2xl"
      >
        <h2 id="create-project-title" className="text-lg font-semibold">
          Create project
        </h2>
        <p id="create-project-description" className="mt-1 text-sm text-slate-400">
          Start a company-scoped workspace with standard task status groups.
        </p>
        {error && (
          <div role="alert" className="mt-4 rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <label className="mt-5 block text-sm font-medium text-slate-200">
          Project name
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            autoComplete="off"
            maxLength={120}
            className={fieldClassName}
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || pending}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </ModalLayer>
  );
}

export function CreateTaskDialog({
  project,
  statuses,
  title,
  status,
  priority,
  dueDate,
  assigneeUserId,
  assignees,
  pending,
  error,
  onTitleChange,
  onStatusChange,
  onPriorityChange,
  onDueDateChange,
  onAssigneeChange,
  onSubmit,
  onClose,
}: {
  project: ProjectSummary;
  statuses: Array<{ value: TaskStatus; label: string }>;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  assigneeUserId: string;
  assignees: TaskAssignee[];
  pending: boolean;
  error: string;
  onTitleChange: (title: string) => void;
  onStatusChange: (status: TaskStatus) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  onDueDateChange: (dueDate: string) => void;
  onAssigneeChange: (assigneeUserId: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending) onSubmit();
  }

  return (
    <ModalLayer
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-[2px]"
      labelledBy="create-task-title"
      describedBy="create-task-description"
      initialFocusRef={titleRef}
      onClose={onClose}
      canCloseOnEscape={() => !pending}
    >
      <form
        onSubmit={submit}
        className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#171a24] p-5 shadow-2xl"
      >
        <h2 id="create-task-title" className="text-lg font-semibold">
          Add a task
        </h2>
        <p id="create-task-description" className="mt-1 text-sm text-slate-400">
          Add work directly to a status group in the selected project.
        </p>
        {error && (
          <div role="alert" className="mt-4 rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Title
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              autoComplete="off"
              maxLength={200}
              className={fieldClassName}
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Project
            <select value={project.id} disabled className={fieldClassName}>
              <option value={project.id}>{project.name}</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Status
            <select
              value={status}
              onChange={(event) => onStatusChange(event.target.value as TaskStatus)}
              className={fieldClassName}
            >
              {statuses.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Priority
            <select
              value={priority}
              onChange={(event) => onPriorityChange(event.target.value as TaskPriority)}
              className={fieldClassName}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Due date and time <span className="text-slate-500">(optional)</span>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(event) => onDueDateChange(event.target.value)}
              className={fieldClassName}
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Assignee <span className="text-slate-500">(optional)</span>
            <select value={assigneeUserId} onChange={(event) => onAssigneeChange(event.target.value)} className={fieldClassName}>
              <option value="">Unassigned</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>{assignee.displayName}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Only active members of the current company are available.
            </span>
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || pending}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? 'Adding…' : 'Add task'}
          </button>
        </div>
      </form>
    </ModalLayer>
  );
}
