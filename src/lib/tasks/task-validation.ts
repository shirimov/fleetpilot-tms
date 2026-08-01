import type { TaskPriority, TaskStatus } from '@prisma/client';
import type {
  CreateTaskChecklistItemInput,
  CreateTaskCommentInput,
  CreateTaskCardInput,
  CreateTaskProjectInput,
  MoveTaskCardInput,
  ReorderTaskChecklistInput,
  UpdateTaskCardInput,
  UpdateTaskChecklistItemInput,
  UpdateTaskCommentInput,
} from './task-types';

const TASK_PRIORITIES = new Set<TaskPriority>(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const TASK_STATUSES = new Set<TaskStatus>([
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'CANCELLED',
]);

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskValidationError('Request body must be a JSON object.');
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TaskValidationError(`${field} is required.`);
  }

  return value.trim();
}

function optionalNullableString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new TaskValidationError(`${field} must be a string or null.`);
  }

  return value.trim() || null;
}

function optionalOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TaskValidationError('order must be a non-negative integer.');
  }

  return value as number;
}

function optionalMentionUserIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 25 ||
    value.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    throw new TaskValidationError(
      'mentionUserIds must contain at most 25 non-empty user IDs.',
    );
  }
  return [...new Set(value.map((id) => id.trim()))];
}

export function validateProjectId(value: string | null): string | undefined {
  if (value === null) return undefined;
  return requiredString(value, 'projectId');
}

export function validateCreateTaskProjectInput(
  value: unknown,
): CreateTaskProjectInput {
  const body = requireObject(value);

  return {
    name: requiredString(body.name, 'name'),
    description: optionalNullableString(body.description, 'description'),
    color: optionalNullableString(body.color, 'color'),
    companyId: optionalNullableString(body.companyId, 'companyId'),
  };
}

export function validateCreateTaskCardInput(value: unknown): CreateTaskCardInput {
  const body = requireObject(value);
  const priority = body.priority;

  if (priority !== undefined && !TASK_PRIORITIES.has(priority as TaskPriority)) {
    throw new TaskValidationError('priority is invalid.');
  }

  let dueDate: Date | null | undefined;
  if (Object.hasOwn(body, 'dueDate')) {
    if (body.dueDate === null || body.dueDate === '') {
      dueDate = null;
    } else if (typeof body.dueDate === 'string') {
      dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) {
        throw new TaskValidationError('dueDate must be a valid date or null.');
      }
    } else {
      throw new TaskValidationError('dueDate must be a valid date or null.');
    }
  }

  return {
    projectId: requiredString(body.projectId, 'projectId'),
    boardId: requiredString(body.boardId, 'boardId'),
    title: requiredString(body.title, 'title'),
    description: optionalNullableString(body.description, 'description'),
    priority: priority as TaskPriority | undefined,
    assigneeUserId: optionalNullableString(body.assigneeUserId, 'assigneeUserId'),
    dueDate,
    order: optionalOrder(body.order),
  };
}

export function validateUpdateTaskCardInput(value: unknown): UpdateTaskCardInput {
  const body = requireObject(value);
  const updateKeys = [
    'boardId',
    'title',
    'description',
    'priority',
    'status',
    'assigneeUserId',
    'dueDate',
    'order',
    'mentionUserIds',
  ];

  if (!updateKeys.some((key) => Object.hasOwn(body, key))) {
    throw new TaskValidationError('At least one task field must be provided.');
  }

  const priority = body.priority;
  if (priority !== undefined && !TASK_PRIORITIES.has(priority as TaskPriority)) {
    throw new TaskValidationError('priority is invalid.');
  }

  const status = body.status;
  if (status !== undefined && !TASK_STATUSES.has(status as TaskStatus)) {
    throw new TaskValidationError('status is invalid.');
  }

  let dueDate: Date | null | undefined;
  if (Object.hasOwn(body, 'dueDate')) {
    if (body.dueDate === null || body.dueDate === '') {
      dueDate = null;
    } else if (typeof body.dueDate === 'string' || body.dueDate instanceof Date) {
      dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) {
        throw new TaskValidationError('dueDate must be a valid date or null.');
      }
    } else {
      throw new TaskValidationError('dueDate must be a valid date or null.');
    }
  }

  let expectedUpdatedAt: Date | undefined;
  if (body.expectedUpdatedAt !== undefined) {
    if (typeof body.expectedUpdatedAt !== 'string') {
      throw new TaskValidationError('expectedUpdatedAt must be a valid date string.');
    }
    expectedUpdatedAt = new Date(body.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new TaskValidationError('expectedUpdatedAt must be a valid date string.');
    }
  }

  return {
    id: requiredString(body.id, 'id'),
    boardId:
      body.boardId === undefined ? undefined : requiredString(body.boardId, 'boardId'),
    title: body.title === undefined ? undefined : requiredString(body.title, 'title'),
    description: optionalNullableString(body.description, 'description'),
    priority: priority as TaskPriority | undefined,
    status: status as TaskStatus | undefined,
    assigneeUserId: optionalNullableString(body.assigneeUserId, 'assigneeUserId'),
    dueDate,
    order: optionalOrder(body.order),
    expectedUpdatedAt,
    mentionUserIds: optionalMentionUserIds(body.mentionUserIds),
  };
}

export function validateTaskCardId(value: string | null): string {
  return requiredString(value, 'id');
}

export function validateRequiredProjectId(value: string | null): string {
  return requiredString(value, 'projectId');
}

export function validateMoveTaskCardInput(
  cardId: string,
  value: unknown,
): MoveTaskCardInput {
  const body = requireObject(value);

  if (!Number.isInteger(body.destinationIndex) || (body.destinationIndex as number) < 0) {
    throw new TaskValidationError(
      'destinationIndex must be a non-negative integer.',
    );
  }

  let expectedUpdatedAt: Date | undefined;
  if (body.expectedUpdatedAt !== undefined) {
    if (typeof body.expectedUpdatedAt !== 'string') {
      throw new TaskValidationError('expectedUpdatedAt must be a valid date string.');
    }
    expectedUpdatedAt = new Date(body.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new TaskValidationError('expectedUpdatedAt must be a valid date string.');
    }
  }

  return {
    cardId: requiredString(cardId, 'id'),
    sourceBoardId: requiredString(body.sourceBoardId, 'sourceBoardId'),
    destinationBoardId: requiredString(
      body.destinationBoardId,
      'destinationBoardId',
    ),
    destinationIndex: body.destinationIndex as number,
    expectedUpdatedAt,
  };
}

const MAX_COLLABORATION_CONTENT_LENGTH = 10_000;

function collaborationContent(value: unknown, field = 'content'): string {
  const content = requiredString(value, field);
  if (content.length > MAX_COLLABORATION_CONTENT_LENGTH) {
    throw new TaskValidationError(
      `${field} must be ${MAX_COLLABORATION_CONTENT_LENGTH} characters or fewer.`,
    );
  }
  return content;
}

export function validateCreateChecklistItemInput(
  cardId: string,
  value: unknown,
): CreateTaskChecklistItemInput {
  const body = requireObject(value);
  return {
    cardId: requiredString(cardId, 'cardId'),
    content: collaborationContent(body.content),
  };
}

export function validateUpdateChecklistItemInput(
  cardId: string,
  itemId: string,
  value: unknown,
): UpdateTaskChecklistItemInput {
  const body = requireObject(value);
  if (!Object.hasOwn(body, 'content') && !Object.hasOwn(body, 'isCompleted')) {
    throw new TaskValidationError('content or isCompleted is required.');
  }
  if (
    Object.hasOwn(body, 'isCompleted') &&
    typeof body.isCompleted !== 'boolean'
  ) {
    throw new TaskValidationError('isCompleted must be a boolean.');
  }
  return {
    cardId: requiredString(cardId, 'cardId'),
    itemId: requiredString(itemId, 'itemId'),
    content: Object.hasOwn(body, 'content')
      ? collaborationContent(body.content)
      : undefined,
    isCompleted: body.isCompleted as boolean | undefined,
  };
}

export function validateReorderChecklistInput(
  cardId: string,
  value: unknown,
): ReorderTaskChecklistInput {
  const body = requireObject(value);
  if (
    !Array.isArray(body.itemIds) ||
    body.itemIds.some((id) => typeof id !== 'string' || !id.trim()) ||
    new Set(body.itemIds).size !== body.itemIds.length
  ) {
    throw new TaskValidationError('itemIds must contain unique non-empty IDs.');
  }
  return {
    cardId: requiredString(cardId, 'cardId'),
    itemIds: body.itemIds,
  };
}

export function validateCreateCommentInput(
  cardId: string,
  value: unknown,
): CreateTaskCommentInput {
  const body = requireObject(value);
  return {
    cardId: requiredString(cardId, 'cardId'),
    content: collaborationContent(body.content),
    mentionUserIds: optionalMentionUserIds(body.mentionUserIds),
  };
}

export function validateUpdateCommentInput(
  cardId: string,
  commentId: string,
  value: unknown,
): UpdateTaskCommentInput {
  const input = validateCreateCommentInput(cardId, value);
  return {
    ...input,
    commentId: requiredString(commentId, 'commentId'),
  };
}
