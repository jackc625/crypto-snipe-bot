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
    //
    // WR-01 (gap-closure): the same-origin test compares the FULL web origin
    // `(scheme, host, port)` via `URL.origin`, not just `host:port`. A bare
    // `host:port` compare is scheme-blind, so behind a TLS-terminating proxy
    // (`DASHBOARD_HOST=0.0.0.0` per going-live.md §5) an `http://` Origin could
    // match the browser's `https` page and slip past as "same-origin".
    //
    // The request scheme is derived from the ACTUAL socket TLS state
    // (`req.socket.encrypted`), which is NOT attacker-controllable. We do NOT
    // enable Express `trust proxy`, because that makes Express trust ALL
    // client-supplied forwarding headers (`X-Forwarded-For`/`-Proto`), a
    // spoofing vector. For the TLS-terminating-proxy deployment — where TLS
    // ends at the proxy and the proxy→bot hop is plain HTTP, so the socket
    // reports `http` while the browser speaks `https` — operators opt in via
    // `DASHBOARD_TRUST_PROXY_PROTO=1` to trust `X-Forwarded-Proto`. That is the
    // only correct way to learn the browser-facing scheme behind a proxy, and
    // it is gated behind explicit config rather than trusted by default.
    const allowedOrigins = (process.env.DASHBOARD_ALLOWED_ORIGINS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    const trustProxyProto = process.env.DASHBOARD_TRUST_PROXY_PROTO === '1';
    app.use((req, res, next) => {
        const requestHost = req.headers.host;
        // Scheme from the real socket (not attacker-controllable). Only when the
        // operator opts in do we honor the proxy's X-Forwarded-Proto.
        const socketScheme = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
        const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
        const requestScheme = trustProxyProto && (fwdProto === 'https' || fwdProto === 'http')
            ? fwdProto
            : socketScheme;
        // Normalize the request's own origin once (host can be malformed → undefined).
        let requestOrigin: string | undefined;
        if (requestHost) {
            try {
                requestOrigin = new URL(`${requestScheme}://${requestHost}`).origin;
            } catch {
                requestOrigin = undefined;
            }
        }
        return cors({
            origin: (origin, cb) => {
                // 1. No Origin header → allow. Covers GET/HEAD, curl, and the
                //    pause/resume CLI (Node axios sends no Origin).
                if (!origin) return cb(null, true);
                // 2. TRUE same-origin: full Origin (scheme+host+port) == request origin.
                //    A malformed Origin must fall through to rejection, not throw.
                try {
                    if (requestOrigin && new URL(origin).origin === requestOrigin) {
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
