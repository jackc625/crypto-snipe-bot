// src/api/routes/trades.ts
// GET /api/trades -- paginated, filtered trade history (DASH-02, D-25, D-27, D-28).
// GET /api/trades/export -- CSV export of filtered trades (D-26).

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPnL } from '../../utils/db';

// Inline async handler to avoid dependency on errorHandler middleware timing (parallel plan execution)
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, next: (err?: unknown) => void) => {
        fn(req, res).catch(next);
    };
}

/**
 * Factory function for trades routes.
 * Mounts at /api/trades (parent handles prefix).
 */
export function tradeRoutes(): Router {
    const router = Router();

    // GET / -- Paginated, filtered trade history (D-25, D-27, D-28)
    router.get('/', asyncHandler(async (req: Request, res: Response) => {
        const chain = req.query.chain as string | undefined;
        const fromStr = req.query.from as string | undefined;
        const toStr = req.query.to as string | undefined;
        const outcome = (req.query.outcome as string | undefined) || 'all';
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 25));

        // Default from to 7 days ago if not provided (D-28)
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const fromTimestamp = fromStr
            ? Math.floor(new Date(fromStr).getTime() / 1000)
            : Math.floor((now - sevenDaysMs) / 1000);
        const toTimestamp = toStr
            ? Math.floor(new Date(toStr).getTime() / 1000)
            : undefined;

        // Fetch trades from DB via existing getPnL
        const trades = getPnL({
            chain: chain || undefined,
            fromTimestamp,
            toTimestamp,
        });

        // Post-filter by outcome
        let filtered = trades;
        if (outcome === 'profit') {
            filtered = trades.filter(t => t.realized_pnl !== null && t.realized_pnl > 0);
        } else if (outcome === 'loss') {
            filtered = trades.filter(t => t.realized_pnl !== null && t.realized_pnl < 0);
        }

        // Pagination
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const start = (page - 1) * limit;
        const paged = filtered.slice(start, start + limit);

        // Map to response format per D-27 (all four column groups)
        const tradeResponse = paged.map(t => ({
            // Core
            token: t.token,
            chain: t.chain,
            action: t.buy_status === 'pending' ? 'open' : 'closed',  // D-06: use buy_status, not sell_time
            pnl: t.realized_pnl,
            sellCount: t.sell_count,  // D-02: enables partial sell indicator in dashboard
            // Timing
            buyTime: t.buy_time,
            sellTime: t.sell_time,
            durationHeld: t.sell_time !== null ? t.sell_time - t.buy_time : null,
            // Amounts
            buyCost: t.buy_cost,
            buyGas: t.buy_gas,
            sellRevenue: t.sell_revenue,  // Now a number (aggregated SUM), not string|null
            sellGas: t.sell_gas,          // Now a number (aggregated SUM), not string|null
            // Exit
            poolType: t.pool_type,
            feeTier: t.fee_tier,
        }));

        res.json({
            trades: tradeResponse,
            pagination: { page, limit, total, totalPages },
        });
    }));

    // GET /export -- CSV export of filtered trades (D-26)
    router.get('/export', asyncHandler(async (req: Request, res: Response) => {
        const chain = req.query.chain as string | undefined;
        const fromStr = req.query.from as string | undefined;
        const toStr = req.query.to as string | undefined;
        const outcome = (req.query.outcome as string | undefined) || 'all';

        // Same filtering as GET /, but no pagination
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const fromTimestamp = fromStr
            ? Math.floor(new Date(fromStr).getTime() / 1000)
            : Math.floor((now - sevenDaysMs) / 1000);
        const toTimestamp = toStr
            ? Math.floor(new Date(toStr).getTime() / 1000)
            : undefined;

        const trades = getPnL({
            chain: chain || undefined,
            fromTimestamp,
            toTimestamp,
        });

        let filtered = trades;
        if (outcome === 'profit') {
            filtered = trades.filter(t => t.realized_pnl !== null && t.realized_pnl > 0);
        } else if (outcome === 'loss') {
            filtered = trades.filter(t => t.realized_pnl !== null && t.realized_pnl < 0);
        }

        // CSV header
        const header = 'Token,Chain,P&L,Sell Count,Buy Cost,Buy Gas,Sell Revenue,Sell Gas,Buy Time,Sell Time,Duration (s),Pool Type,Fee Tier';

        // CSV rows
        const rows = filtered.map(t => {
            const buyTimeStr = t.buy_time ? new Date(t.buy_time * 1000).toISOString() : '';
            const sellTimeStr = t.sell_time ? new Date(t.sell_time * 1000).toISOString() : '';
            const duration = t.sell_time !== null ? String(t.sell_time - t.buy_time) : '';
            return [
                t.token,
                t.chain,
                t.realized_pnl !== null ? String(t.realized_pnl) : '',
                String(t.sell_count),  // D-02: sell count column
                t.buy_cost ?? '',
                t.buy_gas ?? '',
                String(t.sell_revenue),  // Now always a number
                String(t.sell_gas),      // Now always a number
                buyTimeStr,
                sellTimeStr,
                duration,
                t.pool_type,
                t.fee_tier !== null ? String(t.fee_tier) : '',
            ].join(',');
        });

        const csv = [header, ...rows].join('\n');

        // Set CSV headers
        const dateStr = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=trades-${dateStr}.csv`);
        res.send(csv);
    }));

    return router;
}
