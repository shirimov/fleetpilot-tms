import type {
  CompanyMembershipRole,
  Prisma,
  TaskActivityAction,
  TaskActivityActorType,
  TaskActivityEntityType,
  TaskBlockedReason,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';

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
  assigneeUserId?: string | null;
  dueDate?: Date | null;
  effort?: number;
  expectedDurationMinutes?: number | null;
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
  assigneeUserId?: string | null;
  dueDate?: Date | null;
  effort?: number;
  expectedDurationMinutes?: number | null;
  blockedReason?: TaskBlockedReason | null;
  blockedNote?: string | null;
  order?: number;
  expectedUpdatedAt?: Date;
  mentionUserIds?: string[];
};

export type TaskAssignee = {
  id: string;
  displayName: string;
  image: string | null;
  telegram?: {
    connected: boolean;
    username: string | null;
  };
};

export type MoveTaskCardInput = {
  cardId: string;
  sourceBoardId: string;
  destinationBoardId: string;
  destinationIndex: number;
  expectedUpdatedAt?: Date;
};

export type TaskActivityEvent = {
  action: TaskActivityAction;
  projectId: string;
  cardId?: string;
  entityType: TaskActivityEntityType;
  entityId: string;
  entityTitle?: string | null;
  actorType?: TaskActivityActorType;
  actorId?: string;
  actorUserId?: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
};

export type TaskMutationActor = {
  userId: string;
  sourceType?: string;
  sourceId?: string;
};

export type TaskCompanyActor = TaskMutationActor & {
  companyId: string;
  role: CompanyMembershipRole;
  displayName: string;
};

export type CreateTaskChecklistItemInput = {
  cardId: string;
  content: string;
};

export type UpdateTaskChecklistItemInput = {
  cardId: string;
  itemId: string;
  content?: string;
  isCompleted?: boolean;
};

export type ReorderTaskChecklistInput = {
  cardId: string;
  itemIds: string[];
};

export type CreateTaskCommentInput = {
  cardId: string;
  content: string;
  mentionUserIds?: string[];
};

export type UpdateTaskCommentInput = CreateTaskCommentInput & {
  commentId: string;
};
