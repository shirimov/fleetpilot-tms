import type { TaskPriority, TaskStatus } from '@prisma/client';

export type KanbanLabel = {
  id: string;
  name: string;
  color: string;
};

export type KanbanCard = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo: string | null;
  assigneeUserId?: string | null;
  assigneeUser?: {
    id: string;
    displayName: string;
    image: string | null;
  } | null;
  dueDate: string | null;
  order: number;
  updatedAt: string;
  labels: KanbanLabel[];
  checklistItems?: Array<{ id: string; isCompleted: boolean }>;
};

export type KanbanColumn = {
  id: string;
  name: string;
  color: string | null;
  order: number;
  status: TaskStatus | null;
  cards: KanbanCard[];
};

export type KanbanCardFieldUpdate = Partial<
  Pick<KanbanCard, 'description' | 'priority' | 'assigneeUserId' | 'dueDate'>
>;

export type KanbanProject = {
  id: string;
  name: string;
  description: string | null;
  boards: KanbanColumn[];
};
