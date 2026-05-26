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
import { chainRoutes, RestartChainListenersCallback } from './routes/chains';
import { controlRoutes } from './routes/controls';
import { antiRugRoutes } from './routes/antiRug';
import { authMiddleware, sessions } from './middleware/auth';
import { errorMiddleware } from './middleware/errorHandler';
import { handleUpgrade } from './ws/handler';
import { broadcast, getClientCount } from './ws/broadcaster';
import { buildPositionsWithLivePrices } from './helpers/positions';
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
export function startApiServer(
    contexts: ChainContext[],
    onRestart?: RestartChainListenersCallback,
    getTelegramStatus?: () => { connected: boolean; error: string | null },
): { close: () => void } {
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    // --- Middleware (order matters per Pitfall 8) ---
    app.use(express.json());
    app.use(cookieParser());
    app.use(helmet({ contentSecurityPolicy: false }));
    // CR-02 (commit 2d3395e) keeps `origin: true`-style reflection OFF: combined
    // with `credentials: true` it would let any malicious page the operator
    // visits in the same browser POST to /api/controls/pause, /resume,
    // /emergency-sell etc. (classic CSRF-via-CORS). Cross-origin writes still
    // require the DASHBOARD_ALLOWED_ORIGINS allowlist below.
    //
    // Phase 20 live UAT (test 2) gap fix: the prior callback assumed a
    // same-origin request carries NO Origin header. That holds only for
    // GET/HEAD — browsers DO send `Origin` on a same-origin POST. So with the
    // shipped-default empty DASHBOARD_ALLOWED_ORIGINS, every dashboard POST
    // (login, pause/resume) returned 500 "CORS: origin not allowed" and the
    // SPA served BY the bot could not log in. We now detect same-origin by
    // comparing the Origin's host:port to the request's own Host header
    // (NOT by Origin absence): a POST from the SPA the bot itself serves is
    // same-origin and is NOT CSRF, so it passes with zero operator config,
    // while a cross-origin Origin (host mismatch) still requires the allowlist.
    // `cors`'s static-options origin callback does not receive the request, so
    // we build the middleware per-request to capture `req.headers.host`.
    const allowedOrigins = (process.env.DASHBOARD_ALLOWED_ORIGINS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    app.use((req, res, next) => {
        const requestHost = req.headers.host;
        return cors({
            origin: (origin, cb) => {
                // 1. No Origin header → allow. Covers GET/HEAD, curl, and the
                //    pause/resume CLI (Node axios sends no Origin).
                if (!origin) return cb(null, true);
                // 2. TRUE same-origin: Origin host:port == request Host header.
                //    A malformed Origin must fall through to rejection, not throw.
                try {
                    if (requestHost && new URL(origin).host === requestHost) {
                        return cb(null, true);
                    }
                } catch {
                    // malformed Origin — fall through to allowlist / rejection
                }
                // 3. Explicit allowlist for opted-in cross-origin / remote dashboards.
                if (allowedOrigins.includes(origin)) return cb(null, true);
                // Otherwise reject — preserves the CR-02 anti-CSRF intent.
                cb(new Error('CORS: origin not allowed'));
            },
            credentials: true,
        })(req, res, next);
    });

    // --- Routes (order matters per Pitfall 8) ---

    // 1. Health check -- unauthenticated (D-20)
    app.use('/health', healthRoutes(contexts, getTelegramStatus));

    // 2. Auth routes -- unauthenticated (login endpoint)
    app.use('/api/auth', authRoutes());

    // 3. Protected data routes -- positions, trades, risk, chains, controls
    const apiRouter = Router();
    apiRouter.use('/positions', positionRoutes(contexts));
    apiRouter.use('/trades', tradeRoutes());
    apiRouter.use('/risk', riskRoutes(contexts));
    apiRouter.use('/chains', chainRoutes(contexts, stoppedChains, onRestart));
    apiRouter.use('/controls', controlRoutes(contexts));
    apiRouter.use('/anti-rug', antiRugRoutes(contexts));
    app.use('/api', authMiddleware, apiRouter);

    // 4. Static file serving for SPA (D-07)
    const dashboardDir = path.join(process.cwd(), 'dashboard', 'dist');
    app.use(express.static(dashboardDir));

    // 5. SPA catch-all -- serve index.html for client-side routing
    const indexPath = path.join(dashboardDir, 'index.html');
    app.get('/{*path}', (_req, res) => {
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

    // --- Position broadcast interval (D-07, D-08: shared helper, every 5 seconds) ---
    const broadcastInterval = setInterval(async () => {
        if (getClientCount() === 0) return;

        try {
            const positions = await buildPositionsWithLivePrices(contexts);

            const chainStatuses = contexts.map((ctx) => ({
                name: ctx.chain.name,
                displayName: ctx.chain.displayName,
                enabled: ctx.chain.enabled,
            }));

            broadcast('positions_update', {
                positions,
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
