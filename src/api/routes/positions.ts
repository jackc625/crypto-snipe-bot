// src/api/routes/positions.ts
// GET /api/positions -- returns all open positions with current P&L and exit strategy state.
// Feeds the overview table (DASH-01) with expandable position rows (D-34, D-35).

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ChainContext } from '../../chainRegistry';
import { getPnL } from '../../utils/db';
import { getExitState, getTradeIdForPendingToken } from '../../utils/db';
import { exitConfig } from '../../exitEngine';
import type { ExitStateRow } from '../../exitEngine';

// Inline async handler to avoid dependency on errorHandler middleware timing (parallel plan execution)
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, next: Function) => {
        fn(req, res).catch(next);
    };
}

/**
 * Factory function for positions routes.
 * Mounts at /api/positions (parent handles prefix).
 */
export function positionRoutes(contexts: ChainContext[]): Router {
    const router = Router();

    // GET / -- All open positions with exit strategy details
    router.get('/', asyncHandler(async (req: Request, res: Response) => {
        // Get all trades (no filters)
        const allTrades = getPnL();

        // Filter to only open/pending positions: rows where sell_time is null
        const openTrades = allTrades.filter(t => t.sell_time === null);

        // For each open position, look up exit state and trade ID
        const positions = openTrades.map(trade => {
            // Get the trade ID for this pending token+chain
            const tradeIdRow = getTradeIdForPendingToken.get(trade.token, trade.chain) as { id: number } | undefined;
            const tradeId = tradeIdRow?.id ?? null;

            // Look up exit state if we have a trade ID
            let exitState: {
                highWaterMark: number;
                trailingActivated: boolean;
                partialTiersCompleted: number[];
                urgencyStartTs: number;
                urgencyPct: number;
                originalTokenAmount: string;
                volatilitySamples: number[];
            } | null = null;

            if (tradeId !== null) {
                const row = getExitState.get(tradeId) as ExitStateRow | undefined;
                if (row) {
                    // Parse JSON strings from DB
                    let partialTiersCompleted: number[] = [];
                    try { partialTiersCompleted = JSON.parse(row.partial_tiers_completed); } catch { /* empty */ }

                    let volatilitySamples: number[] = [];
                    try { volatilitySamples = JSON.parse(row.volatility_samples); } catch { /* empty */ }

                    // Compute urgency percentage: min(1, (now - urgencyStartTs) / urgencyWindowMs) * 100
                    const elapsed = Date.now() - row.urgency_start_ts;
                    const urgencyPct = Math.min(1, elapsed / exitConfig.urgencyWindowMs) * 100;

                    exitState = {
                        highWaterMark: row.high_water_mark,
                        trailingActivated: row.trailing_activated === 1,
                        partialTiersCompleted,
                        urgencyStartTs: row.urgency_start_ts,
                        urgencyPct: Math.round(urgencyPct * 100) / 100,
                        originalTokenAmount: row.original_token_amount,
                        volatilitySamples,
                    };
                }
            }

            return {
                tradeId,
                token: trade.token,
                chain: trade.chain,
                entryPrice: exitState?.highWaterMark !== undefined
                    ? (getExitState.get(tradeId!) as ExitStateRow | undefined)?.entry_price ?? null
                    : null,
                currentPrice: exitState?.highWaterMark ?? null,
                pnl: trade.realized_pnl,
                buyCost: trade.buy_cost,
                buyGas: trade.buy_gas,
                buyTime: trade.buy_time,
                poolType: trade.pool_type,
                feeTier: trade.fee_tier,
                exitState,
            };
        });

        res.json({ positions });
    }));

    return router;
}
