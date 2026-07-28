import { NextResponse } from 'next/server';
import { TaskNotFoundError } from './task-service';
import { TaskValidationError } from './task-validation';

export async function parseTaskRequestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new TaskValidationError('Request body must contain valid JSON.');
  }
}

export function taskRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof TaskValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof TaskNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  console.error('Task route failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });

  return NextResponse.json(
    { error: 'An unexpected task service error occurred.' },
    { status: 500 },
  );
}
