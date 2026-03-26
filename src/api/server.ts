// src/api/server.ts
// Express + HTTP + WebSocket server factory.
// Single entry point for the dashboard API layer.

import express, { Router } from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import type { ChainContext } from '../chainRegistry';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { positionRoutes } from './routes/positions';
import { tradeRoutes } from './routes/trades';
import { riskRoutes } from './routes/risk';
import { chainRoutes } from './routes/chains';
import { controlRoutes } from './routes/controls';
import { authMiddleware, sessions } from './middleware/auth';
import { errorMiddleware } from './middleware/errorHandler';
import { handleUpgrade } from './ws/handler';
import { broadcast, getClientCount } from './ws/broadcaster';
import { getOpenPositionCount, getPnL } from '../utils/db';
import { getPortfolioExposure } from '../riskManager';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'api' });

/** Module-level set tracking which chains have had their listeners stopped */
const stoppedChains = new Set<string>();

/**
 * Start the Express + WebSocket API server.
 * Binds to DASHBOARD_HOST:DASHBOARD_PORT (default 127.0.0.1:8080).
 *
 * @param contexts - Active chain contexts for health and status queries
 * @returns Object with close() method for graceful shutdown
 */
export function startApiServer(contexts: ChainContext[]): { close: () => void } {
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    // --- Middleware (order matters per Pitfall 8) ---
    app.use(express.json());
    app.use(cookieParser());
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: true, credentials: true }));

    // --- Routes (order matters per Pitfall 8) ---

    // 1. Health check -- unauthenticated (D-20)
    app.use('/health', healthRoutes(contexts));

    // 2. Auth routes -- unauthenticated (login endpoint)
    app.use('/api/auth', authRoutes());

    // 3. Protected data routes -- positions, trades, risk, chains, controls
    const apiRouter = Router();
    apiRouter.use('/positions', positionRoutes(contexts));
    apiRouter.use('/trades', tradeRoutes());
    apiRouter.use('/risk', riskRoutes(contexts));
    apiRouter.use('/chains', chainRoutes(contexts, stoppedChains));
    apiRouter.use('/controls', controlRoutes(contexts));
    app.use('/api', authMiddleware, apiRouter);

    // 4. Static file serving for SPA (D-07)
    const dashboardDir = path.join(process.cwd(), 'dashboard', 'dist');
    app.use(express.static(dashboardDir));

    // 5. SPA catch-all -- serve index.html for client-side routing
    const indexPath = path.join(dashboardDir, 'index.html');
    app.get('*', (_req, res) => {
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            // Dashboard not built yet (dev mode) -- don't crash
            res.status(404).json({ error: 'Dashboard not built. Run build in dashboard/ first.' });
        }
    });

    // 6. Error middleware -- must be last
    app.use(errorMiddleware);

    // --- WebSocket upgrade (Pitfall 1: use server 'upgrade' event) ---
    server.on('upgrade', handleUpgrade(wss, sessions));

    // --- Position broadcast interval (D-09: every 5 seconds) ---
    const broadcastInterval = setInterval(() => {
        if (getClientCount() === 0) return;

        try {
            const posResult = getOpenPositionCount.get() as { count: number };
            const exposure = getPortfolioExposure();
            const oneDayAgoSec = Math.floor((Date.now() - 86_400_000) / 1000);
            const pnlRows = getPnL({ fromTimestamp: oneDayAgoSec });
            const dailyPnL = pnlRows.reduce(
                (sum, row) => sum + (row.realized_pnl ?? 0),
                0,
            );

            // Chain status
            const chainStatuses = contexts.map((ctx) => ({
                name: ctx.chain.name,
                displayName: ctx.chain.displayName,
                enabled: ctx.chain.enabled,
            }));

            broadcast('positions_update', {
                positions: {
                    open: posResult.count,
                    totalExposure: exposure.total,
                    exposureByChain: exposure.byChain,
                    dailyPnL,
                },
                chains: chainStatuses,
            });
        } catch (err) {
            log.error({ err }, 'Error broadcasting position update');
        }
    }, 5000);

    // --- Bind to host:port ---
    const host = process.env.DASHBOARD_HOST || '127.0.0.1';
    const port = parseInt(process.env.DASHBOARD_PORT || '8080', 10);

    server.listen(port, host, () => {
        log.info({ host, port }, 'Dashboard API server started');
    });

    // --- Shutdown ---
    return {
        close: () => {
            clearInterval(broadcastInterval);
            wss.close();
            server.close();
            log.info('Dashboard API server stopped');
        },
    };
}
