export class FinancialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinancialValidationError';
  }
}

export class FinancialNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'FinancialNotFoundError';
  }
}

export class FinancialConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinancialConflictError';
  }
}
