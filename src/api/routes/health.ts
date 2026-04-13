// src/api/routes/health.ts
// GET /health route factory.
// Unauthenticated endpoint (per D-20) returning chain connectivity,
// position summary, and bot liveness data.

import { readFileSync } from 'fs';
import { join } from 'path';
import { Router } from 'express';
import type { ChainContext } from '../../chainRegistry';
import { getOpenPositionCount, getPnL } from '../../utils/db';
import { getPortfolioExposure } from '../../riskManager';
import { asyncHandler } from '../middleware/errorHandler';

const startTime = Date.now();
const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8'));

/**
 * Create health route handler bound to the given chain contexts.
 * Response shape per D-29; status codes per D-30.
 */
export function healthRoutes(
    contexts: ChainContext[],
    getTelegramStatus?: () => { connected: boolean; error: string | null },
): Router {
    const router = Router();

    router.get(
        '/',
        asyncHandler(async (_req, res) => {
            const chainResults = await Promise.allSettled(
                contexts.map(async (ctx) => {
                    let connected = false;
                    let latestBlock: number | null = null;
                    try {
                        latestBlock = await ctx.httpProvider.getBlockNumber();
                        connected = true;
                    } catch {
                        connected = false;
                    }
                    return {
                        name: ctx.chain.name,
                        displayName: ctx.chain.displayName,
                        connected,
                        latestBlock,
                        wsConnected: ctx.wsProvider !== null,
                    };
                }),
            );

            const chains = chainResults.map((r) =>
                r.status === 'fulfilled'
                    ? r.value
                    : { name: 'unknown', displayName: '?', connected: false, latestBlock: null, wsConnected: false },
            );

            const anyDisconnected = chains.some((c) => !c.connected);

            // Position data
            const posResult = getOpenPositionCount.get() as { count: number };
            const exposure = getPortfolioExposure();

            // 24h P&L
            const oneDayAgoSec = Math.floor((Date.now() - 86_400_000) / 1000);
            const pnlRows = getPnL({ fromTimestamp: oneDayAgoSec });
            const dailyPnL = pnlRows.reduce(
                (sum, row) => sum + (row.realized_pnl ?? 0),
                0,
            );

            const status = anyDisconnected ? 'degraded' : 'ok';
            const statusCode = anyDisconnected ? 503 : 200;

            // D-19: Telegram connection status
            const telegramStatus = getTelegramStatus
                ? getTelegramStatus()
                : { connected: false, error: 'Not configured' };

            res.status(statusCode).json({
                status,
                version: pkg.version,
                uptime: Math.floor((Date.now() - startTime) / 1000),
                chains,
                positions: {
                    open: posResult.count,
                    totalExposure: exposure.total,
                    dailyPnL,
                },
                telegramConnected: telegramStatus.connected,    // D-19
                telegramError: telegramStatus.error,             // D-19
            });
        }),
    );

    return router;
}
