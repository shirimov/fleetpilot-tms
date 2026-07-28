'use client';

import { useState, type ReactNode } from 'react';
import type { KanbanCard } from '@/lib/tasks/kanban-types';

type TaskCardProps = {
  card: KanbanCard;
  dragHandle?: ReactNode;
  isDragging?: boolean;
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
}: TaskCardProps) {
  const [renderedAt] = useState(Date.now);
  const dueDate = card.dueDate ? new Date(card.dueDate) : null;
  const overdue =
    dueDate !== null &&
    dueDate.getTime() < renderedAt &&
    card.status !== 'DONE' &&
    card.status !== 'CANCELLED';

  return (
    <article
      aria-label={`${card.title}, ${card.priority.toLowerCase()} priority, ${card.status.toLowerCase().replaceAll('_', ' ')}`}
      className={`rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-sm transition ${
        isDragging ? 'opacity-60 ring-2 ring-blue-400' : 'hover:border-slate-600'
      }`}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-100">
          {card.title}
        </h3>
        {dragHandle}
      </div>

      {card.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">
          {card.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full border px-2 py-1 font-semibold ${priorityStyles[card.priority]}`}
        >
          {card.priority}
        </span>
        <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
          {card.status.replaceAll('_', ' ')}
        </span>
        {card.assignedTo && (
          <span className="max-w-full truncate text-slate-300">
            Assigned: {card.assignedTo}
          </span>
        )}
        {dueDate && (
          <span
            className={
              overdue
                ? 'font-semibold text-rose-300'
                : 'text-slate-400'
            }
          >
            {overdue ? 'Overdue: ' : 'Due: '}
            {dueDate.toLocaleDateString()}
          </span>
        )}
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
    </article>
  );
}
