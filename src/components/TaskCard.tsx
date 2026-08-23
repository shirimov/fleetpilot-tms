'use client';

import { useState, type ReactNode } from 'react';
import type { KanbanCard } from '@/lib/tasks/kanban-types';
import type { KanbanCardFieldUpdate } from '@/lib/tasks/kanban-types';
import type { TaskAssignee } from '@/lib/tasks/task-types';
import type { TaskStatus } from '@prisma/client';
import TaskDeadline from '@/components/tasks/TaskDeadline';
import { AssigneeAvatar, TaskAssigneeSelect, TaskDueDateInput, TaskEffortSelect, TaskPrioritySelect, TaskStatusSelect } from '@/components/tasks/TaskFields';

type TaskCardProps = {
  card: KanbanCard;
  dragHandle?: ReactNode;
  isDragging?: boolean;
  onOpen?: () => void;
  assignees?: TaskAssignee[];
  statuses?: Array<{ value: TaskStatus; label: string }>;
  now?: number | null;
  updating?: boolean;
  onUpdateCard?: (cardId: string, changes: KanbanCardFieldUpdate) => Promise<void>;
  onStatusChange?: (cardId: string, status: TaskStatus) => Promise<void>;
};

const priorityStyles = {
  LOW: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  MEDIUM: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  HIGH: 'border-orange-400/40 bg-orange-400/10 text-orange-200',
  URGENT: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
};

export default function TaskCard({
  card,
  dragHandle,
  isDragging = false,
  onOpen,
  assignees = [],
  statuses = [],
  now = null,
  updating = false,
  onUpdateCard,
  onStatusChange,
}: TaskCardProps) {
  const [renderedAt] = useState(Date.now);
  const dueDate = card.dueDate ? new Date(card.dueDate) : null;
  const overdue =
    dueDate !== null &&
    dueDate.getTime() < renderedAt &&
    card.status !== 'DONE' &&
    card.status !== 'CANCELLED';
  const checklistItems = card.checklistItems ?? [];
  const completedChecklistItems = checklistItems.filter(
    ({ isCompleted }) => isCompleted,
  ).length;

  return (
    <article
      aria-label={`${card.title}, ${card.priority.toLowerCase()} priority, ${card.status.toLowerCase().replaceAll('_', ' ')}`}
      className={`rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-sm transition ${
        isDragging ? 'opacity-60 ring-2 ring-blue-400' : 'hover:border-slate-600'
      }`}
    >
      <div className="flex items-start gap-2">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left text-sm font-semibold text-slate-100 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {card.title}
          </button>
        ) : (
          <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-100">
            {card.title}
          </h3>
        )}
        {dragHandle}
      </div>

      {card.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">
          {card.description}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">Assignee</span>
          {onUpdateCard ? (
            <TaskAssigneeSelect label={`Assignee for ${card.title}`} value={card.assigneeUserId ?? ''} legacyName={card.assignedTo} assignees={assignees} disabled={updating} onChange={(assigneeUserId) => void onUpdateCard(card.id, { assigneeUserId })} />
          ) : <AssigneeAvatar assignee={card.assigneeUser} legacyName={card.assignedTo} />}
        </div>
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">Status</span>
          {onStatusChange ? <TaskStatusSelect label={`Status for ${card.title}`} value={card.status} statuses={statuses} disabled={updating} onChange={(status) => void onStatusChange(card.id, status)} /> : (
            <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">{card.status.replaceAll('_', ' ')}</span>
          )}
        </div>
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">Priority</span>
          {onUpdateCard ? <TaskPrioritySelect label={`Priority for ${card.title}`} value={card.priority} disabled={updating} onChange={(priority) => void onUpdateCard(card.id, { priority })} /> : (
        <span
          className={`rounded-full border px-2 py-1 font-semibold ${priorityStyles[card.priority]}`}
        >
          {card.priority}
        </span>
          )}
        </div>
        <div className="min-w-0">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">Due</span>
          {onUpdateCard ? <TaskDueDateInput label={`Due date and time for ${card.title}`} value={card.dueDate} disabled={updating} onChange={(dueDate) => void onUpdateCard(card.id, { dueDate })} /> : dueDate ? <span className={overdue ? 'font-semibold text-rose-300' : 'text-slate-400'}>{dueDate.toLocaleString()}</span> : <span className="text-slate-500">No deadline</span>}
        </div>
        <div className="col-span-2 flex items-center justify-between border-t border-white/6 pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Countdown</span>
          <TaskDeadline dueDate={card.dueDate} now={now} status={card.status} compact />
        </div>
        <div><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">Effort</span>{onUpdateCard ? <TaskEffortSelect label={`Effort for ${card.title}`} value={card.effort ?? 3} disabled={updating} onChange={(effort) => void onUpdateCard(card.id, { effort })} /> : <span className="text-violet-200">{card.effort ?? 3} / 5</span>}</div>
        <div><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">Expected</span><span className="text-slate-300">{card.expectedDurationMinutes ? `${card.expectedDurationMinutes}m` : '—'}</span></div>
        {card.blockedReason && <div className="col-span-2 rounded-lg bg-amber-400/10 px-2 py-1.5 text-amber-200">Waiting · {card.blockedReason.replaceAll('_', ' ')}</div>}
      </div>

      {card.labels.length > 0 && (
        <ul aria-label="Labels" className="mt-3 flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <li
              key={label.id}
              className="rounded-full border border-slate-600 px-2 py-0.5 text-xs text-slate-300"
              style={{ borderColor: label.color }}
            >
              {label.name}
            </li>
          ))}
        </ul>
      )}
      {checklistItems.length > 0 && (
        <div className="mt-3" aria-label={`${completedChecklistItems} of ${checklistItems.length} checklist items complete`}>
          <div className="mb-1 flex justify-between text-[11px] text-slate-500">
            <span>Checklist</span>
            <span>{completedChecklistItems}/{checklistItems.length}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-emerald-400"
              style={{
                width: `${(completedChecklistItems / checklistItems.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
    </article>
  );
}
