// src/api/server.ts
// Express API server for the monitoring dashboard (D-01, D-03, D-44).
// Mounts health check, chain control, and bot control routes.
// Runs in the same process as the bot for direct access to in-memory state.

import express from 'express';
import type { Server } from 'http';
import type { ChainContext } from '../chainRegistry';
import { chainRoutes, RestartChainListenersCallback } from './routes/chains';
import { controlRoutes } from './routes/controls';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'api:server' });

/** Module-level set tracking which chains have had their listeners stopped */
const stoppedChains = new Set<string>();

export interface ApiServerOptions {
    /** Array of ChainContext for all enabled chains */
    contexts: ChainContext[];
    /** Port to listen on (default: DASHBOARD_PORT env or 8080) */
    port?: number;
    /** Host to bind to (default: DASHBOARD_HOST env or 127.0.0.1) */
    host?: string;
    /** Optional callback to restart chain listeners after stop */
    onRestartChain?: RestartChainListenersCallback;
}

/**
 * Start the API server. Returns the HTTP server instance for graceful shutdown.
 */
export function startApiServer(options: ApiServerOptions): Server {
    const {
        contexts,
        port = parseInt(process.env.DASHBOARD_PORT || '8080', 10),
        host = process.env.DASHBOARD_HOST || '127.0.0.1',
        onRestartChain,
    } = options;

    const app = express();
    app.use(express.json());

    // ── API routes under /api prefix (D-42) ──────────────────────────────
    const apiRouter = express.Router();
    apiRouter.use('/chains', chainRoutes(contexts, stoppedChains, onRestartChain));
    apiRouter.use('/controls', controlRoutes(contexts));
    app.use('/api', apiRouter);

    // ── Start server ─────────────────────────────────────────────────────
    const server = app.listen(port, host, () => {
        log.info({ port, host }, 'API server started');
    });

    return server;
}

export { stoppedChains };
