export class BankLedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankLedgerValidationError';
  }
}

export class BankLedgerNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'BankLedgerNotFoundError';
  }
}

export class BankProviderUnavailableError extends Error {
  constructor(message = 'Bank provider is not connected.') {
    super(message);
    this.name = 'BankProviderUnavailableError';
  }
}
