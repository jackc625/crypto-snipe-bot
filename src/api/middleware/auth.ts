// src/api/middleware/auth.ts
// Session cookie auth middleware and login handler.
// In-memory session store with TTL-based expiry.

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'api:auth' });

// --- Session State ---

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** In-memory session store: token -> metadata */
export const sessions = new Map<string, { createdAt: number }>();

// --- Login Handler ---

/**
 * POST /api/auth/login
 * Validates req.body.apiKey against process.env.DASHBOARD_API_KEY.
 * On match: generates UUID session, sets httpOnly cookie, returns { ok: true }.
 * On mismatch: returns 401 with descriptive error.
 */
export function loginHandler(req: Request, res: Response): void {
    const { apiKey } = req.body as { apiKey?: string };
    const expected = process.env.DASHBOARD_API_KEY;

    if (!expected) {
        log.error('DASHBOARD_API_KEY not set -- login will always fail');
        res.status(500).json({ error: 'Server misconfigured: DASHBOARD_API_KEY not set' });
        return;
    }

    if (!apiKey || apiKey !== expected) {
        log.warn('Failed login attempt');
        res.status(401).json({ error: 'Invalid API key. Check DASHBOARD_API_KEY in your .env file.' });
        return;
    }

    const token = uuidv4();
    sessions.set(token, { createdAt: Date.now() });

    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('session', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: isProduction,
        maxAge: SESSION_TTL_MS,
    });

    log.info('Successful login');
    res.json({ ok: true });
}

// --- Session Validation ---

/**
 * Check if a session token is valid and not expired.
 * Exported for WebSocket handler reuse.
 */
export function validateSession(token: string): boolean {
    const session = sessions.get(token);
    if (!session) return false;

    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        sessions.delete(token);
        return false;
    }

    return true;
}

// --- Auth Middleware ---

/**
 * Express middleware: validates the 'session' cookie.
 * If invalid or expired, returns 401. Otherwise calls next().
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const token = req.cookies?.session as string | undefined;

    if (!token || !validateSession(token)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    next();
}
