import type { TaskPriority, TaskStatus } from '@prisma/client';
import type {
  CreateTaskCardInput,
  CreateTaskProjectInput,
  MoveTaskCardInput,
  UpdateTaskCardInput,
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

  return {
    projectId: requiredString(body.projectId, 'projectId'),
    boardId: requiredString(body.boardId, 'boardId'),
    title: requiredString(body.title, 'title'),
    description: optionalNullableString(body.description, 'description'),
    priority: priority as TaskPriority | undefined,
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
    'assignedTo',
    'dueDate',
    'order',
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

  return {
    id: requiredString(body.id, 'id'),
    boardId:
      body.boardId === undefined ? undefined : requiredString(body.boardId, 'boardId'),
    title: body.title === undefined ? undefined : requiredString(body.title, 'title'),
    description: optionalNullableString(body.description, 'description'),
    priority: priority as TaskPriority | undefined,
    status: status as TaskStatus | undefined,
    assignedTo: optionalNullableString(body.assignedTo, 'assignedTo'),
    dueDate,
    order: optionalOrder(body.order),
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
