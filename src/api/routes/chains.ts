// src/api/routes/chains.ts
// Chain status and control routes (DASH-03, D-40, D-41).
// GET /  -- per-chain status with masked RPC URLs and read-only config display.
// POST /:name/stop  -- removes event listeners for that chain (exit monitors continue per D-14).
// POST /:name/start -- re-adds chain to active set.

import { Router, Request, Response } from 'express';
import type { ChainContext } from '../../chainRegistry';
import { exitConfig } from '../../exitEngine';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'api:chains' });

/**
 * Extract hostname from URL, masking credentials and path.
 * e.g. "https://eth-mainnet.g.alchemy.com/v2/abc123" -> "eth-mainnet.g.alchemy.com"
 * Per D-41: "masked RPC URL".
 */
export function maskUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return '(invalid url)';
    }
}

/** Callback type for restarting chain listeners after a stop (D-12: returns warnings). */
export type RestartChainListenersCallback = (ctx: ChainContext) => Promise<{ warnings: string[] }>;

/**
 * Build chain control routes.
 *
 * @param contexts   -- Array of ChainContext for all enabled chains.
 * @param stoppedChains -- Module-level Set shared with server.ts; chain names in set have listeners stopped.
 * @param onRestart  -- Optional callback to re-subscribe factory events after start.
 */
export function chainRoutes(
    contexts: ChainContext[],
    stoppedChains: Set<string>,
    onRestart?: RestartChainListenersCallback,
): Router {
    const router = Router();

    // ── GET / ── per-chain status with config display ────────────────────
    router.get('/', async (_req: Request, res: Response) => {
        try {
            const chains = await Promise.all(
                contexts.map(async (ctx) => {
                    const name = ctx.chain.name;
                    let status: 'running' | 'stopped' | 'disconnected';
                    let blockNumber: number | null = null;

                    if (stoppedChains.has(name)) {
                        status = 'stopped';
                        // Still try to get block number for display
                        try {
                            blockNumber = await ctx.httpProvider.getBlockNumber();
                        } catch {
                            // ignore
                        }
                    } else {
                        try {
                            blockNumber = await ctx.httpProvider.getBlockNumber();
                            status = 'running';
                        } catch {
                            status = 'disconnected';
                        }
                    }

                    const wsConnected = ctx.wsProvider !== null;

                    return {
                        name,
                        displayName: ctx.chain.displayName,
                        status,
                        wsConnected,
                        snipeParams: {
                            snipeAmount: ctx.chain.snipeAmount,
                            maxCapital: ctx.chain.maxCapital,
                            minLiquidity: ctx.chain.minLiquidityThreshold,
                        },
                        riskLimits: {
                            maxOpenPositions: process.env.MAX_OPEN_POSITIONS || '10',
                            maxTotalExposure: process.env.MAX_TOTAL_EXPOSURE || '10.0',
                            dailyLossPct: process.env.DAILY_LOSS_PCT || '10',
                        },
                        exitStrategy: {
                            trailingStopPct: exitConfig.trailingStopPct,
                            stopLossPct: exitConfig.stopLossPct,
                            partialSellTiers: exitConfig.partialSellTiers,
                            urgencyWindowMs: exitConfig.urgencyWindowMs,
                        },
                        connection: {
                            rpcUrl: maskUrl(ctx.chain.httpRpcUrl),
                            wsUrl: ctx.chain.wsRpcUrl ? maskUrl(ctx.chain.wsRpcUrl) : null,
                            chainId: ctx.chain.chainId,
                            lastBlock: blockNumber,
                        },
                        dexes: ctx.chain.dexes.map((d) => d.name),
                    };
                }),
            );

            res.json({ chains });
        } catch (err) {
            log.error({ err }, 'Error fetching chain status');
            res.status(500).json({ error: 'Failed to fetch chain status' });
        }
    });

    // ── POST /:name/stop ── stop chain listeners (D-12, D-14, D-40) ────
    router.post('/:name/stop', (req: Request, res: Response) => {
        const name = String(req.params.name).toLowerCase();
        const ctx = contexts.find((c) => c.chain.name.toLowerCase() === name);

        if (!ctx) {
            res.status(404).json({ error: 'Chain not found' });
            return;
        }

        if (stoppedChains.has(ctx.chain.name)) {
            res.status(400).json({ error: 'Chain already stopped' });
            return;
        }

        stoppedChains.add(ctx.chain.name);

        // Remove event listeners on the WS provider to stop factory event subscriptions.
        // Do NOT destroy the provider -- exit monitors may need it (D-14).
        if (ctx.wsProvider) {
            ctx.wsProvider.removeAllListeners();
        }

        ctx.log.info('Chain listeners stopped via dashboard');
        res.json({ ok: true, chain: ctx.chain.name, status: 'stopped' });
    });

    // ── POST /:name/start ── restart chain listeners (D-12, D-40) ───────
    router.post('/:name/start', async (req: Request, res: Response) => {
        const name = String(req.params.name).toLowerCase();
        const ctx = contexts.find((c) => c.chain.name.toLowerCase() === name);

        if (!ctx) {
            res.status(404).json({ error: 'Chain not found' });
            return;
        }

        if (!stoppedChains.has(ctx.chain.name)) {
            res.status(400).json({ error: 'Chain is already running' });
            return;
        }

        stoppedChains.delete(ctx.chain.name);

        if (onRestart) {
            try {
                const result = await onRestart(ctx);
                ctx.log.info({ warnings: result.warnings }, 'Chain listeners restarted via dashboard');
                res.json({
                    ok: true,
                    chain: ctx.chain.name,
                    status: 'running',
                    warnings: result.warnings,  // D-12: always include warnings array
                });
            } catch (err) {
                ctx.log.error({ err }, 'Failed to restart chain listeners');
                // Even on full failure, chain was removed from stopped set
                res.json({
                    ok: true,
                    chain: ctx.chain.name,
                    status: 'running',
                    warnings: [`Full restart failed: ${err instanceof Error ? err.message : String(err)}`],
                });
            }
        } else {
            ctx.log.info('Chain removed from stopped set via dashboard (no restart callback)');
            res.json({
                ok: true,
                chain: ctx.chain.name,
                status: 'running',
                warnings: ['No restart callback configured. Full listener restart requires bot restart.'],
            });
        }
    });

    return router;
}
