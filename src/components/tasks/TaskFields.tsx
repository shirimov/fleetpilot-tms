'use client';

import type { TaskPriority, TaskStatus } from '@prisma/client';
import type { TaskAssignee } from '@/lib/tasks/task-types';
import { isoToLocalDateTime, localDateTimeToIso } from '@/lib/tasks/task-deadline';

const controlClass =
  'h-8 min-w-0 rounded-md border border-white/10 bg-[#11151f] px-2 text-xs text-slate-200 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 disabled:opacity-50';

export function assigneeDisplayName(
  assignee: TaskAssignee | null | undefined,
  legacyName: string | null,
) {
  return assignee?.displayName ?? legacyName ?? 'Unassigned';
}

export function AssigneeAvatar({
  assignee,
  legacyName,
}: {
  assignee?: TaskAssignee | null;
  legacyName: string | null;
}) {
  const name = assigneeDisplayName(assignee, legacyName);
  if (name === 'Unassigned') return <span className="text-xs text-slate-500">Unassigned</span>;
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className="inline-flex min-w-0 items-center gap-2" title={name}>
      {assignee?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assignee.image} alt="" className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-bold text-violet-200">
          {initials}
        </span>
      )}
      <span className="truncate text-xs text-slate-300">{name}</span>
    </span>
  );
}

export function TaskAssigneeSelect({
  value,
  assignees,
  disabled,
  label,
  legacyName,
  onChange,
}: {
  value: string;
  assignees: TaskAssignee[];
  disabled?: boolean;
  label: string;
  legacyName?: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.value || null)}
      className={controlClass}
    >
      <option value="">{legacyName ? `Legacy: ${legacyName} (unverified)` : 'Unassigned'}</option>
      {assignees.map((assignee) => (
        <option key={assignee.id} value={assignee.id}>{assignee.displayName}</option>
      ))}
    </select>
  );
}

export function TaskPrioritySelect({ value, disabled, label, onChange }: {
  value: TaskPriority;
  disabled?: boolean;
  label: string;
  onChange: (value: TaskPriority) => void;
}) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.value as TaskPriority)} className={controlClass}>
      <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
    </select>
  );
}

export function TaskStatusSelect({ value, statuses, disabled, label, onChange }: {
  value: TaskStatus;
  statuses: Array<{ value: TaskStatus; label: string }>;
  disabled?: boolean;
  label: string;
  onChange: (value: TaskStatus) => void;
}) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.value as TaskStatus)} className={controlClass}>
      {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
    </select>
  );
}

export function TaskDueDateInput({ value, disabled, label, onChange }: {
  value: string | null;
  disabled?: boolean;
  label: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <input
      type="datetime-local"
      aria-label={label}
      value={isoToLocalDateTime(value)}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(localDateTimeToIso(event.target.value))}
      className={`${controlClass} w-[10.75rem]`}
    />
  );
}
