import type { TaskPriority, TaskStatus } from '@prisma/client';

export type CreateTaskProjectInput = {
  name: string;
  description?: string | null;
  color?: string | null;
  companyId?: string | null;
};

export type CreateTaskCardInput = {
  projectId: string;
  boardId: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  order?: number;
};

export type UpdateTaskCardInput = {
  id: string;
  boardId?: string;
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedTo?: string | null;
  dueDate?: Date | null;
  order?: number;
};

export type TaskActivityAction =
  | 'PROJECT_CREATED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED';

export type TaskActivityEvent = {
  action: TaskActivityAction;
  projectId?: string;
  cardId?: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
};
