'use client';

import { useEffect, useState } from 'react';
import type { KanbanCard, KanbanColumn } from '@/lib/tasks/kanban-types';

type Activity = {
  id: string;
  action: string;
  actorType: string;
  entityTitle: string | null;
  metadata: unknown;
  occurredAt: string;
};

type Props = {
  card: KanbanCard;
  board: KanbanColumn;
  onClose: () => void;
};

const actionLabels: Record<string, string> = {
  TASK_CREATED: 'Task created',
  TITLE_CHANGED: 'Title changed',
  DESCRIPTION_CHANGED: 'Description changed',
  STATUS_CHANGED: 'Status changed',
  BOARD_CHANGED: 'Moved to another group',
  PRIORITY_CHANGED: 'Priority changed',
  ASSIGNEE_CHANGED: 'Assignee changed',
  DUE_DATE_CHANGED: 'Due date changed',
  ORDER_CHANGED: 'Task reordered',
  TASK_DELETED: 'Task deleted',
};

function PlaceholderPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-4">
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

export default function TaskDetailDrawer({ card, board, onClose }: Props) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/tasks/cards/${card.id}/activity`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Activity could not be loaded.');
        return (await response.json()) as Activity[];
      })
      .then((timeline) => {
        if (active) setActivities(timeline);
      })
      .catch((error: unknown) => {
        if (active) {
          setActivityError(
            error instanceof Error ? error.message : 'Activity could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setActivityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [card.id]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close task details"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
        className="relative h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#12141c] shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start gap-4 border-b border-white/8 bg-[#12141c]/95 px-5 py-5 backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-300">
              {board.name}
            </p>
            <h2 id="task-drawer-title" className="text-xl font-semibold text-white">
              {card.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-xl text-slate-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            ×
          </button>
        </header>

        <div className="space-y-6 p-5">
          <section aria-labelledby="overview-heading">
            <h3 id="overview-heading" className="mb-3 text-sm font-semibold text-white">
              Overview
            </h3>
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-white/8 bg-[#181b25] p-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Status</dt>
                <dd className="mt-1 font-medium text-slate-200">{card.status.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Priority</dt>
                <dd className="mt-1 font-medium text-slate-200">{card.priority}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Assignee</dt>
                <dd className="mt-1 font-medium text-slate-200">{card.assignedTo ?? 'Unassigned'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Due date</dt>
                <dd className="mt-1 font-medium text-slate-200">
                  {card.dueDate ? new Date(card.dueDate).toLocaleDateString() : 'No due date'}
                </dd>
              </div>
            </dl>
            <p className="mt-3 rounded-xl border border-white/8 bg-[#181b25] p-4 text-sm leading-6 text-slate-300">
              {card.description || 'No description has been added.'}
            </p>
          </section>

          <section aria-labelledby="activity-heading">
            <h3 id="activity-heading" className="mb-3 text-sm font-semibold text-white">
              Activity
            </h3>
            {activityLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-white/5" />
            ) : activityError ? (
              <p className="rounded-lg bg-rose-400/10 p-3 text-sm text-rose-200">{activityError}</p>
            ) : activities.length === 0 ? (
              <p className="text-sm text-slate-500">No activity recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {activities.map((activity) => (
                  <li key={activity.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                    <div>
                      <p className="font-medium text-slate-200">
                        {actionLabels[activity.action] ?? activity.action.replaceAll('_', ' ')}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {activity.actorType.toLocaleLowerCase()} ·{' '}
                        {new Date(activity.occurredAt).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="coming-soon-heading">
            <h3 id="coming-soon-heading" className="mb-3 text-sm font-semibold text-white">
              Connected work
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <PlaceholderPanel title="Comments" description="Team discussion will appear here in a future sprint." />
              <PlaceholderPanel title="Files" description="Task documents and attachments are coming soon." />
              <PlaceholderPanel title="AI assistance" description="Recommendations will remain reviewable before action." />
              <PlaceholderPanel title="Telegram" description="Linked operational messages will appear here." />
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
