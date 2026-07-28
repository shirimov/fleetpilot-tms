'use client';

import type { KanbanProject } from '@/lib/tasks/kanban-types';

type Props = {
  project: KanbanProject;
  onOpenCard: (cardId: string) => void;
};

const priorityStyle = {
  LOW: 'bg-emerald-400/12 text-emerald-200',
  MEDIUM: 'bg-amber-400/12 text-amber-200',
  HIGH: 'bg-orange-400/12 text-orange-200',
  URGENT: 'bg-rose-400/12 text-rose-200',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function TaskTableView({ project, onOpenCard }: Props) {
  return (
    <div className="overflow-auto rounded-xl border border-white/8 bg-[#151822]">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-[#1b1e29] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
          <tr>
            <th className="sticky left-0 z-30 w-[34%] border-b border-r border-white/8 bg-[#1b1e29] px-4 py-3">
              Task
            </th>
            <th className="border-b border-white/8 px-4 py-3">Status</th>
            <th className="border-b border-white/8 px-4 py-3">Assignee</th>
            <th className="border-b border-white/8 px-4 py-3">Priority</th>
            <th className="border-b border-white/8 px-4 py-3">Checklist</th>
            <th className="border-b border-white/8 px-4 py-3">Due date</th>
            <th className="border-b border-white/8 px-4 py-3">Last updated</th>
          </tr>
        </thead>
        <tbody>
          {project.boards.map((board) => (
            <TaskTableGroup
              key={board.id}
              board={board}
              onOpenCard={onOpenCard}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskTableGroup({
  board,
  onOpenCard,
}: {
  board: KanbanProject['boards'][number];
  onOpenCard: (cardId: string) => void;
}) {
  return (
    <>
      <tr>
        <th
          colSpan={7}
          className="border-b border-white/8 bg-[#11131b] px-4 py-2.5 text-left"
        >
          <span className="inline-flex items-center gap-2 font-semibold text-white">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: board.color ?? '#64748b' }}
              aria-hidden="true"
            />
            {board.name}
            <span className="font-normal text-slate-500">{board.cards.length}</span>
            {board.status === null && (
              <span className="rounded bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-200">
                Legacy · unmapped
              </span>
            )}
          </span>
        </th>
      </tr>
      {board.cards.length === 0 ? (
        <tr>
          <td colSpan={7} className="border-b border-white/6 px-4 py-6 text-center text-slate-500">
            No tasks match this view
          </td>
        </tr>
      ) : (
        board.cards.map((card) => (
          <tr key={card.id} className="group hover:bg-white/[0.025]">
            <td className="sticky left-0 z-10 border-r border-b border-white/6 bg-[#151822] px-4 py-3 group-hover:bg-[#1a1d27]">
              <button
                type="button"
                onClick={() => onOpenCard(card.id)}
                className="max-w-full truncate text-left font-medium text-slate-100 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {card.title}
              </button>
            </td>
            <td className="border-b border-white/6 px-4 py-3">
              <span
                className="inline-flex rounded-md px-2.5 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: board.color ?? '#475569' }}
              >
                {card.status.replaceAll('_', ' ')}
              </span>
            </td>
            <td className="border-b border-white/6 px-4 py-3 text-slate-400">
              {(card.checklistItems?.length ?? 0) > 0
                ? `${card.checklistItems?.filter(({ isCompleted }) => isCompleted).length}/${card.checklistItems?.length}`
                : '—'}
            </td>
            <td className="border-b border-white/6 px-4 py-3 text-slate-300">
              {card.assignedTo ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/20 text-xs font-bold text-violet-200">
                    {initials(card.assignedTo)}
                  </span>
                  <span className="max-w-32 truncate">{card.assignedTo}</span>
                </span>
              ) : (
                <span className="text-slate-500">Unassigned</span>
              )}
            </td>
            <td className="border-b border-white/6 px-4 py-3">
              <span className={`rounded-md px-2 py-1 text-xs font-semibold ${priorityStyle[card.priority]}`}>
                {card.priority}
              </span>
            </td>
            <td className="border-b border-white/6 px-4 py-3 text-slate-400">
              {card.dueDate
                ? new Date(card.dueDate).toLocaleDateString()
                : '—'}
            </td>
            <td className="border-b border-white/6 px-4 py-3 text-slate-400">
              {new Date(card.updatedAt).toLocaleDateString()}
            </td>
          </tr>
        ))
      )}
    </>
  );
}
