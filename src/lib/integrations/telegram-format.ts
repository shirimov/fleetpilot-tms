import type { TaskPriority, TaskStatus } from '@prisma/client';

function ellipsize(value: string | null | undefined, length: number) {
  const normalized = value?.trim();
  if (!normalized) return 'No description';
  return normalized.length <= length
    ? normalized
    : `${normalized.slice(0, length - 1)}…`;
}

export function formatRemainingTime(dueDate: Date | null) {
  if (!dueDate) return 'No deadline';
  const difference = dueDate.getTime() - Date.now();
  const absolute = Math.abs(Math.floor(difference / 1000));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  if (difference < 0) {
    return hours > 0 ? `${hours}h ${minutes}m overdue` : `${minutes}m overdue`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatTelegramTaskSummary(input: {
  title: string;
  projectName: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: Date | null;
  description: string | null;
  prefix: string;
}) {
  const dueLabel = input.dueDate
    ? input.dueDate.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'No deadline';
  return [
    'FleetPilot',
    '',
    input.prefix,
    input.title,
    '',
    `Project: ${input.projectName}`,
    `Priority: ${input.priority}`,
    `Status: ${input.status.replaceAll('_', ' ')}`,
    `Due: ${dueLabel}`,
    `Remaining: ${formatRemainingTime(input.dueDate)}`,
    '',
    ellipsize(input.description, 220),
  ].join('\n');
}
