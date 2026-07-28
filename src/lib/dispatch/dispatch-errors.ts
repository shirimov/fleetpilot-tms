export class DispatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchValidationError';
  }
}

export class DispatchResourceNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'DispatchResourceNotFoundError';
  }
}

export class DispatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchConflictError';
  }
}

