import type { TaskStatus } from '@prisma/client';
import { deadlinePresentation } from '@/lib/tasks/task-deadline';

const toneStyles = {
  none: 'border-white/8 bg-white/[0.03] text-slate-500',
  neutral: 'border-slate-600/50 bg-slate-700/20 text-slate-300',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  urgent: 'border-orange-400/35 bg-orange-400/10 text-orange-200',
  overdue: 'border-rose-400/35 bg-rose-400/10 text-rose-200',
  complete: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
};

export default function TaskDeadline({
  dueDate,
  now,
  status,
  compact = false,
}: {
  dueDate: string | null;
  now: number | null;
  status: TaskStatus;
  compact?: boolean;
}) {
  const presentation = deadlinePresentation(dueDate, now, status);
  return (
    <span
      role="timer"
      aria-label={presentation.accessibleLabel}
      className={`inline-flex whitespace-nowrap rounded-md border font-semibold tabular-nums ${toneStyles[presentation.tone]} ${compact ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-1 text-xs'}`}
    >
      {presentation.label}
    </span>
  );
}
