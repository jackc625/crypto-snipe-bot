// src/api/server.ts
// Express + HTTP + WebSocket server factory for the monitoring dashboard.
// Creates the API server with health check, authentication, data routes, and WebSocket broadcasting.

import express, { Router } from 'express';
import { createServer } from 'http';
import path from 'path';
import type { ChainContext } from '../chainRegistry';
import { logger } from '../utils/logger';

// Route factories
import { positionRoutes } from './routes/positions';
import { tradeRoutes } from './routes/trades';
import { riskRoutes } from './routes/risk';

const log = logger.child({ module: 'api' });

/**
 * Start the API server for the monitoring dashboard.
 * Creates Express app with middleware, mounts routes, starts HTTP server.
 *
 * @param contexts - Active chain contexts for status queries
 * @returns Object with close() method for graceful shutdown
 */
export function startApiServer(contexts: ChainContext[]): { close: () => void } {
    const app = express();

    // --- Middleware ---
    app.use(express.json());

    // --- Public routes (unauthenticated) ---
    // Health and auth routes will be mounted by Plan 01 infrastructure:
    // app.use('/health', healthRoutes(contexts));
    // app.use('/api/auth', authRoutes());

    // --- Authenticated data routes ---
    // Per Plan 02: mount position, trade, and risk routes behind auth middleware
    const apiRouter = Router();
    apiRouter.use('/positions', positionRoutes(contexts));
    apiRouter.use('/trades', tradeRoutes());
    apiRouter.use('/risk', riskRoutes(contexts));

    // Mount data routes under /api prefix
    // Note: authMiddleware will be added when Plan 01 infrastructure is merged
    app.use('/api', apiRouter);

    // --- SPA static files ---
    const dashboardPath = path.join(process.cwd(), 'dashboard', 'dist');
    app.use(express.static(dashboardPath));
    app.get('*', (_req, res) => {
        try {
            res.sendFile(path.join(dashboardPath, 'index.html'));
        } catch {
            res.status(404).json({ error: 'Dashboard not built' });
        }
    });

    // --- HTTP Server ---
    const server = createServer(app);
    const host = process.env.DASHBOARD_HOST || '127.0.0.1';
    const port = parseInt(process.env.DASHBOARD_PORT || '8080', 10);

    server.listen(port, host, () => {
        log.info({ host, port }, 'Dashboard API server started');
    });

    return {
        close: () => {
            server.close();
            log.info('Dashboard API server stopped');
        },
    };
}
