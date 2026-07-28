export class TaskNotFoundError extends Error {
  constructor(message = 'Task card not found.') {
    super(message);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskProjectNotFoundError extends Error {
  constructor(message = 'Task project not found.') {
    super(message);
    this.name = 'TaskProjectNotFoundError';
  }
}

export class TaskBoardNotFoundError extends Error {
  constructor(message = 'Task board not found.') {
    super(message);
    this.name = 'TaskBoardNotFoundError';
  }
}

export class TaskBoardProjectMismatchError extends Error {
  constructor(message = 'Task board does not belong to the task project.') {
    super(message);
    this.name = 'TaskBoardProjectMismatchError';
  }
}

export class TaskBoardStatusUnmappedError extends Error {
  constructor(message = 'Destination task board has no status mapping.') {
    super(message);
    this.name = 'TaskBoardStatusUnmappedError';
  }
}

export class TaskMoveConflictError extends Error {
  constructor(message = 'Task card changed before the move could be applied.') {
    super(message);
    this.name = 'TaskMoveConflictError';
  }
}

export class InvalidTaskDestinationIndexError extends Error {
  constructor(message = 'destinationIndex is outside the destination board range.') {
    super(message);
    this.name = 'InvalidTaskDestinationIndexError';
  }
}
