// src/api/routes/auth.ts
// POST /api/auth/login route.

import { Router } from 'express';
import { loginHandler } from '../middleware/auth';

/**
 * Create auth routes.
 * POST /login validates DASHBOARD_API_KEY and sets session cookie.
 */
export function authRoutes(): Router {
    const router = Router();
    router.post('/login', loginHandler);
    return router;
}
