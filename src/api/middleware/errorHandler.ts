// src/api/middleware/errorHandler.ts
// Centralized async error wrapper and Express error middleware.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'api' });

/**
 * Wraps an async Express route handler so thrown errors are
 * forwarded to next() instead of crashing the process.
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Express error middleware -- must be registered LAST.
 * Logs the error via pino and returns a JSON error response.
 */
export function errorMiddleware(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    const statusCode = (err as Error & { statusCode?: number }).statusCode || 500;
    // WR-02: client errors (4xx, e.g. a 403 CORS rejection) log at warn so they
    // stop masquerading as server errors and spamming the error log during
    // go-live monitoring. Only 5xx (true server faults) log at error level.
    if (statusCode < 500) {
        log.warn({ err, statusCode }, 'API client error');
    } else {
        log.error({ err, statusCode }, 'Unhandled API error');
    }
    res.status(statusCode).json({ error: err.message || 'Internal server error' });
}
