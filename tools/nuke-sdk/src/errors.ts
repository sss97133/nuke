/**
 * Nuke SDK Error Classes
 */

export class NukeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NukeError';
    Object.setPrototypeOf(this, NukeError.prototype);
  }
}

export class NukeAPIError extends NukeError {
  public readonly statusCode: number;
  public readonly rawResponse: any;

  constructor(message: string, statusCode: number, rawResponse?: any) {
    super(message);
    this.name = 'NukeAPIError';
    this.statusCode = statusCode;
    this.rawResponse = rawResponse;
    Object.setPrototypeOf(this, NukeAPIError.prototype);
  }
}

export class NukeAuthenticationError extends NukeAPIError {
  constructor(message: string = 'Invalid or missing API key') {
    super(message, 401);
    this.name = 'NukeAuthenticationError';
    Object.setPrototypeOf(this, NukeAuthenticationError.prototype);
  }
}

export class NukeRateLimitError extends NukeAPIError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 429);
    this.name = 'NukeRateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, NukeRateLimitError.prototype);
  }
}

export class NukeValidationError extends NukeAPIError {
  public readonly validationErrors: Record<string, string[]>;

  constructor(message: string, errors: Record<string, string[]>) {
    super(message, 400);
    this.name = 'NukeValidationError';
    this.validationErrors = errors;
    Object.setPrototypeOf(this, NukeValidationError.prototype);
  }
}

export class NukeNotFoundError extends NukeAPIError {
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' not found`, 404);
    this.name = 'NukeNotFoundError';
    Object.setPrototypeOf(this, NukeNotFoundError.prototype);
  }
}

/**
 * Check if an error is a Nuke SDK error
 */
export function isNukeError(error: unknown): error is NukeError {
  return error instanceof NukeError;
}

/**
 * Check if an error is specifically an API error (vs network/config error)
 */
export function isNukeAPIError(error: unknown): error is NukeAPIError {
  return error instanceof NukeAPIError;
}
