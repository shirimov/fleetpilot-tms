import type { TaskStatus } from '@prisma/client';

export type DeadlineTone = 'none' | 'neutral' | 'warning' | 'urgent' | 'overdue' | 'complete';

export type DeadlinePresentation = {
  label: string;
  accessibleLabel: string;
  tone: DeadlineTone;
};

function two(value: number) {
  return String(value).padStart(2, '0');
}

function durationLabel(milliseconds: number, includePrefix: boolean) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (days > 0) return `${days}d ${two(hours)}:${two(minutes)}`;
  if (hours > 0) return `${two(hours)}:${two(minutes)}:${two(remainder)}`;
  return `${includePrefix ? 'Due in ' : ''}${minutes}m ${two(remainder)}s`;
}

export function deadlinePresentation(
  dueDate: string | null,
  now: number | null,
  status: TaskStatus,
  locale?: string,
): DeadlinePresentation {
  if (status === 'DONE') {
    return { label: 'Completed', accessibleLabel: 'Task completed', tone: 'complete' };
  }
  if (status === 'CANCELLED') {
    return { label: 'Cancelled', accessibleLabel: 'Task cancelled', tone: 'complete' };
  }
  if (!dueDate) {
    return { label: 'No deadline', accessibleLabel: 'No deadline', tone: 'none' };
  }
  const dueAt = new Date(dueDate);
  if (Number.isNaN(dueAt.getTime()) || now === null) {
    return { label: 'Calculating…', accessibleLabel: 'Calculating time remaining', tone: 'neutral' };
  }
  const difference = dueAt.getTime() - now;
  const absolute = Math.abs(difference);
  const overdue = difference < 0;
  const label = overdue
    ? `Overdue ${durationLabel(absolute, false)}`
    : durationLabel(absolute, true);
  const fullDeadline = dueAt.toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return {
    label,
    accessibleLabel: `${overdue ? 'Deadline passed' : 'Due'} ${fullDeadline}. ${label}.`,
    tone: overdue
      ? 'overdue'
      : difference < 3_600_000
        ? 'urgent'
        : difference < 86_400_000
          ? 'warning'
          : 'neutral',
  };
}

export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isoToLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
