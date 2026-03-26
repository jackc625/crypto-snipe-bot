// src/api/routes/risk.ts
// Risk data API routes for the monitoring dashboard (DASH-04).
// GET /api/risk/exposure -- portfolio exposure for donut chart (D-33)
// GET /api/risk/pnl -- cumulative P&L data points for line chart (D-31, D-32)
// GET /api/risk/limits -- position limit and daily loss utilization

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ChainContext } from '../../chainRegistry';
import { getPortfolioExposure } from '../../riskManager';
import { getPnL, getOpenPositionCount, getTotalExposure, getDailyRealizedLoss } from '../../utils/db';

// Inline async handler to avoid dependency on errorHandler middleware timing (parallel plan execution)
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, next: Function) => {
        fn(req, res).catch(next);
    };
}

// Range duration mappings in milliseconds
const RANGE_MS: Record<string, number | undefined> = {
    '24h': 86400000,
    '7d': 604800000,
    '30d': 2592000000,
    'all': undefined,
};

/**
 * Factory function for risk routes.
 * Mounts at /api/risk (parent handles prefix).
 */
export function riskRoutes(contexts: ChainContext[]): Router {
    const router = Router();

    // GET /exposure -- Portfolio exposure total and by-chain breakdown (D-33 donut chart)
    router.get('/exposure', asyncHandler(async (_req: Request, res: Response) => {
        const exposure = getPortfolioExposure();

        res.json({
            total: exposure.total,
            byChain: exposure.byChain,
        });
    }));

    // GET /pnl -- Cumulative P&L data points for line chart (D-31, D-32)
    router.get('/pnl', asyncHandler(async (req: Request, res: Response) => {
        const range = (req.query.range as string) || '7d';
        const validRanges = ['24h', '7d', '30d', 'all'];
        const effectiveRange = validRanges.includes(range) ? range : '7d';

        // Calculate fromTimestamp based on range
        const rangeMs = RANGE_MS[effectiveRange];
        const fromTimestamp = rangeMs !== undefined
            ? Math.floor((Date.now() - rangeMs) / 1000)
            : undefined;

        // Fetch trades in range
        const trades = getPnL({ fromTimestamp });

        // Build cumulative P&L data points
        // Filter to completed trades (those with sell_time) and sort by sell_time ascending
        const completedTrades = trades
            .filter(t => t.sell_time !== null && t.realized_pnl !== null)
            .sort((a, b) => a.sell_time! - b.sell_time!);

        let runningSum = 0;
        const dataPoints = completedTrades.map(t => {
            runningSum += t.realized_pnl!;
            return {
                time: t.sell_time!,       // epoch seconds for Lightweight Charts
                value: Math.round(runningSum * 1e8) / 1e8, // avoid floating point drift
            };
        });

        res.json({ dataPoints, range: effectiveRange });
    }));

    // GET /limits -- Position limit, exposure limit, and daily loss utilization
    router.get('/limits', asyncHandler(async (_req: Request, res: Response) => {
        // Read risk config from env (same sources as riskManager.ts)
        const maxOpenPositions = parseInt(process.env.MAX_OPEN_POSITIONS || '10', 10);
        const maxTotalExposure = parseFloat(process.env.MAX_TOTAL_EXPOSURE || '10.0');
        const dailyLossPct = parseFloat(process.env.DAILY_LOSS_PCT || '10');

        // Current open positions
        const posResult = getOpenPositionCount.get() as { count: number };

        // Current total exposure
        const expResult = getTotalExposure.get() as { total: number };

        // Daily realized loss: sum across all enabled chains
        const oneDayAgoMs = Date.now() - 86400000;
        const oneDayAgoSec = Math.floor(oneDayAgoMs / 1000);
        let totalDailyLoss = 0;
        for (const ctx of contexts) {
            if (ctx.chain.enabled) {
                const lossResult = getDailyRealizedLoss.get(ctx.chain.name, oneDayAgoSec) as { total_loss: number };
                totalDailyLoss += lossResult.total_loss;
            }
        }

        res.json({
            positionLimit: {
                used: posResult.count,
                max: maxOpenPositions,
            },
            exposureLimit: {
                used: Math.round(expResult.total * 10000) / 10000,
                max: maxTotalExposure,
            },
            dailyLoss: {
                used: Math.round(totalDailyLoss * 10000) / 10000,
                limitPct: dailyLossPct,
            },
        });
    }));

    return router;
}
