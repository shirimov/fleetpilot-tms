export class AuthenticationRequiredError extends Error {
  constructor(message = 'Authentication is required.') {
    super(message);
    this.name = 'AuthenticationRequiredError';
  }
}

export class AuthorizationDeniedError extends Error {
  constructor(message = 'You do not have access to this resource.') {
    super(message);
    this.name = 'AuthorizationDeniedError';
  }
}
