// lib/utils/apiErrors.ts

// Base API Error class
export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: any;

  constructor(message: string, status: number = 500, code?: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      details: this.details,
    };
  }
}

// Validation Error
export class ValidationError extends ApiError {
  public readonly fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string>) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.fields = fields;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      fields: this.fields,
    };
  }
}

// Not Found Error
export class NotFoundError extends ApiError {
  constructor(resource: string, id?: string) {
    const message = id 
      ? `${resource} with id "${id}" not found`
      : `${resource} not found`;
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

// Authentication Error
export class AuthError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

// Permission Error
export class PermissionError extends ApiError {
  constructor(message: string = 'Permission denied') {
    super(message, 403, 'PERMISSION_DENIED');
    this.name = 'PermissionError';
  }
}

// Rate Limit Error
export class RateLimitError extends ApiError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 429, 'RATE_LIMIT');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      retryAfter: this.retryAfter,
    };
  }
}

// Error code constants
export const ERROR_CODES = {
  // Client errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  AUTH_ERROR: 'AUTH_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMIT: 'RATE_LIMIT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  
  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  
  // File errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  
  // OpenAI specific
  CONTEXT_LENGTH: 'CONTEXT_LENGTH',
  INVALID_API_KEY: 'INVALID_API_KEY',
  
  // Storage specific
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_TOKEN: 'INVALID_TOKEN',
} as const;

// Type guard to check if error is ApiError
export function isApiError(error: any): error is ApiError {
  return error instanceof ApiError;
}

// Helper to create error response
export function createErrorResponse(error: any) {
  if (isApiError(error)) {
    return {
      error: {
        message: error.message,
        code: error.code,
        status: error.status,
        ...(error instanceof ValidationError && { fields: error.fields }),
        ...(error instanceof RateLimitError && { retryAfter: error.retryAfter }),
      },
    };
  }
  
  // Generic error response for unknown errors
  return {
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred'
        : error.message || 'Unknown error',
      code: ERROR_CODES.INTERNAL_ERROR,
      status: 500,
    },
  };
}