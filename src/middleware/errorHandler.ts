import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/validation';
import { logger } from '../utils/logger';
import { ApiError } from '../types';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log the error
  logger.error('Unhandled error in request', {
    error,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Determine error response
  let statusCode = 500;
  let errorResponse: ApiError = {
    error: 'Internal server error'
  };

  if (error instanceof ValidationError) {
    statusCode = 400;
    errorResponse = {
      error: error.message,
      code: 'VALIDATION_ERROR'
    };
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorResponse = {
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    };
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    errorResponse = {
      error: 'Token expired',
      code: 'TOKEN_EXPIRED'
    };
  } else if (error.message === 'Authentication required') {
    statusCode = 401;
    errorResponse = {
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    };
  }

  // Don't leak internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    errorResponse = {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    };
  }

  res.status(statusCode).json(errorResponse);
}

export function notFoundHandler(req: Request, res: Response): void {
  logger.warn('Route not found', {
    method: req.method,
    url: req.url,
    ip: req.ip
  });

  res.status(404).json({
    error: 'Route not found',
    code: 'NOT_FOUND'
  } as ApiError);
}

// Async error wrapper for route handlers
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}