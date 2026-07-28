import { NextResponse } from 'next/server';
import {
  InvalidTaskDestinationIndexError,
  TaskBoardNotFoundError,
  TaskBoardProjectMismatchError,
  TaskBoardStatusUnmappedError,
  TaskMoveConflictError,
  TaskNotFoundError,
  TaskProjectNotFoundError,
} from './task-errors';
import { TaskValidationError } from './task-validation';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';

export async function parseTaskRequestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new TaskValidationError('Request body must contain valid JSON.');
  }
}

export function taskRouteErrorResponse(error: unknown): NextResponse {
  const authorizationResponse = authorizationErrorResponse(error);
  if (authorizationResponse) return authorizationResponse;

  if (error instanceof TaskValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof TaskNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (
    error instanceof TaskProjectNotFoundError ||
    error instanceof TaskBoardNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (
    error instanceof TaskMoveConflictError ||
    error instanceof TaskBoardStatusUnmappedError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (
    error instanceof TaskBoardProjectMismatchError ||
    error instanceof InvalidTaskDestinationIndexError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error('Task route failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });

  return NextResponse.json(
    { error: 'An unexpected task service error occurred.' },
    { status: 500 },
  );
}
