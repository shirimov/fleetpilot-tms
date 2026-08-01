'use client';

import type { TaskStatus } from '@prisma/client';
import type { KanbanCardFieldUpdate, KanbanProject } from '@/lib/tasks/kanban-types';
import type { TaskAssignee } from '@/lib/tasks/task-types';
import TaskDeadline from './TaskDeadline';
import { TaskAssigneeSelect, TaskDueDateInput, TaskPrioritySelect, TaskStatusSelect } from './TaskFields';

type Props = {
  project: KanbanProject;
  onOpenCard: (cardId: string) => void;
  assignees: TaskAssignee[];
  statuses: Array<{ value: TaskStatus; label: string }>;
  now: number | null;
  updatingCardIds: Set<string>;
  onUpdateCard: (cardId: string, changes: KanbanCardFieldUpdate) => Promise<void>;
  onStatusChange: (cardId: string, status: TaskStatus) => Promise<void>;
};

export default function TaskTableView(props: Props) {
  return (
    <div className="overflow-auto rounded-xl border border-white/8 bg-[#151822]">
      <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-[#1b1e29] text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          <tr>
            <th className="sticky left-0 z-30 w-[28%] border-b border-r border-white/8 bg-[#1b1e29] px-4 py-3">Task</th>
            <th className="border-b border-white/8 px-3 py-3">Assignee</th>
            <th className="border-b border-white/8 px-3 py-3">Status</th>
            <th className="border-b border-white/8 px-3 py-3">Priority</th>
            <th className="border-b border-white/8 px-3 py-3">Due date &amp; time</th>
            <th className="border-b border-white/8 px-3 py-3">Countdown</th>
            <th className="border-b border-white/8 px-3 py-3">Checklist</th>
          </tr>
        </thead>
        <tbody>{props.project.boards.map((board) => <TaskTableGroup key={board.id} board={board} {...props} />)}</tbody>
      </table>
    </div>
  );
}

function TaskTableGroup({ board, onOpenCard, assignees, statuses, now, updatingCardIds, onUpdateCard, onStatusChange }: Props & { board: KanbanProject['boards'][number] }) {
  return (
    <>
      <tr><th colSpan={7} className="border-b border-white/8 bg-[#11131b] px-4 py-2.5 text-left">
        <span className="inline-flex items-center gap-2 font-semibold text-white"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: board.color ?? '#64748b' }} aria-hidden="true" />{board.name}<span className="font-normal text-slate-500">{board.cards.length}</span>{board.status === null && <span className="rounded bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-200">Legacy · unmapped</span>}</span>
      </th></tr>
      {board.cards.length === 0 ? <tr><td colSpan={7} className="border-b border-white/6 px-4 py-6 text-center text-slate-500">No tasks match this view</td></tr> : board.cards.map((card) => {
        const updating = updatingCardIds.has(card.id);
        return (
          <tr key={card.id} className="group hover:bg-white/[0.025]">
            <td className="sticky left-0 z-10 border-r border-b border-white/6 bg-[#151822] px-4 py-2.5 group-hover:bg-[#1a1d27]"><button type="button" onClick={() => onOpenCard(card.id)} className="max-w-full truncate text-left font-medium text-slate-100 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">{card.title}</button></td>
            <td className="border-b border-white/6 px-3 py-2"><TaskAssigneeSelect label={`Assignee for ${card.title}`} value={card.assigneeUserId ?? ''} legacyName={card.assignedTo} assignees={assignees} disabled={updating} onChange={(assigneeUserId) => void onUpdateCard(card.id, { assigneeUserId })} /></td>
            <td className="border-b border-white/6 px-3 py-2"><TaskStatusSelect label={`Status for ${card.title}`} value={card.status} statuses={statuses} disabled={updating} onChange={(status) => void onStatusChange(card.id, status)} /></td>
            <td className="border-b border-white/6 px-3 py-2"><TaskPrioritySelect label={`Priority for ${card.title}`} value={card.priority} disabled={updating} onChange={(priority) => void onUpdateCard(card.id, { priority })} /></td>
            <td className="border-b border-white/6 px-3 py-2"><TaskDueDateInput label={`Due date and time for ${card.title}`} value={card.dueDate} disabled={updating} onChange={(dueDate) => void onUpdateCard(card.id, { dueDate })} /></td>
            <td className="border-b border-white/6 px-3 py-2"><TaskDeadline dueDate={card.dueDate} now={now} status={card.status} compact /></td>
            <td className="border-b border-white/6 px-3 py-2 text-slate-400">{(card.checklistItems?.length ?? 0) > 0 ? `${card.checklistItems?.filter(({ isCompleted }) => isCompleted).length}/${card.checklistItems?.length}` : '—'}</td>
          </tr>
        );
      })}
    </>
  );
}
