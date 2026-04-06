// src/api/helpers/positions.ts
// Shared helper to build position data with live on-chain prices via queryPrice().
// Used by the positions API route and any other consumer needing enriched position data.

import { ethers } from 'ethers';
import type { ChainContext } from '../../chainRegistry';
import { getPnL, getExitState, getTradeIdForPendingToken } from '../../utils/db';
import { queryPrice, exitConfig } from '../../exitEngine';
import type { ExitStateRow } from '../../exitEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LivePosition {
    tradeId: number | null;
    token: string;
    chain: string;
    entryPrice: number | null;
    currentPrice: number | null;
    priceStale: boolean;
    unrealizedPnl: number | null;
    pnl: number;
    buyCost: string | null;
    buyGas: string | null;
    buyTime: number;
    poolType: string;
    feeTier: number | null;
    sellRevenue: number;
    dexName: string | null;
    exitState: {
        highWaterMark: number;
        trailingActivated: boolean;
        partialTiersCompleted: number[];
        urgencyStartTs: number;
        urgencyPct: number;
        originalTokenAmount: string;
        volatilitySamples: number[];
    } | null;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Fetch all open positions, enrich each with a live on-chain price via queryPrice(),
 * and compute unrealized P&L. Queries are issued in parallel across all positions.
 *
 * If queryPrice fails or returns null for a position, falls back to the exitState
 * highWaterMark and sets priceStale = true.
 */
export async function buildPositionsWithLivePrices(contexts: ChainContext[]): Promise<LivePosition[]> {
    // 1. Fetch open trades
    const allTrades = getPnL();
    const openTrades = allTrades.filter(t => t.buy_status === 'pending');

    // 2. Process each trade in parallel (D-02)
    const positions = await Promise.all(openTrades.map(async (trade): Promise<LivePosition> => {
        // 3. Resolve ChainContext per trade (D-04)
        const ctx = contexts.find(c => c.chain.name === trade.chain);

        // 4. Resolve DexConfig per trade using dex_name when available (D-02, D-03)
        const dex = ctx?.chain.dexes.find(d => {
            if (d.dexType !== trade.pool_type) return false;
            // When dex_name is available (new trades), require exact match (D-02)
            if (trade.dex_name) return d.name === trade.dex_name;
            // Legacy trades (dex_name NULL): fall back to first-match (D-03)
            return true;
        }) ?? null;

        // 5. Look up trade ID and exit state
        const tradeIdRow = getTradeIdForPendingToken.get(trade.token, trade.chain) as { id: number } | undefined;
        const tradeId = tradeIdRow?.id ?? null;

        let exitState: LivePosition['exitState'] = null;

        if (tradeId !== null) {
            const row = getExitState.get(tradeId) as ExitStateRow | undefined;
            if (row) {
                let partialTiersCompleted: number[] = [];
                try { partialTiersCompleted = JSON.parse(row.partial_tiers_completed); } catch { /* empty */ }

                let volatilitySamples: number[] = [];
                try { volatilitySamples = JSON.parse(row.volatility_samples); } catch { /* empty */ }

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

        // 6. Query live price (D-01, D-02)
        let currentPrice: number | null = null;
        let priceStale = false;

        // If chain exists but dex resolution failed (removed/renamed dex), mark stale
        if (ctx && !dex) {
            priceStale = true;
        }

        if (ctx && dex && trade.buy_cost) {
            try {
                const buyAmountWei = ethers.parseEther(trade.buy_cost);
                currentPrice = await queryPrice(ctx, dex, trade.token, trade.fee_tier, buyAmountWei);
            } catch {
                // queryPrice catches its own errors, but wrap ethers.parseEther too
            }
        }

        // 7. Fallback to highWaterMark (D-03)
        if (currentPrice === null && exitState) {
            currentPrice = exitState.highWaterMark;
            priceStale = true;
        }

        // 8. Compute unrealized P&L (D-05)
        // currentPrice from queryPrice is in wei (Number), divide by 1e18 for ETH
        // Formula: unrealizedPnl = (currentPrice/1e18) + sell_revenue - buy_cost - sell_gas
        const unrealizedPnl = currentPrice !== null
            ? (currentPrice / 1e18) + trade.sell_revenue - parseFloat(trade.buy_cost || '0') - trade.sell_gas
            : null;

        // 9. Return enriched position
        return {
            tradeId,
            token: trade.token,
            chain: trade.chain,
            entryPrice: exitState
                ? ((getExitState.get(tradeId!) as ExitStateRow | undefined)?.entry_price ?? null)
                : null,
            currentPrice: currentPrice !== null ? currentPrice / 1e18 : null,
            priceStale,
            unrealizedPnl,
            pnl: trade.realized_pnl,
            buyCost: trade.buy_cost,
            buyGas: trade.buy_gas,
            buyTime: trade.buy_time,
            poolType: trade.pool_type,
            feeTier: trade.fee_tier,
            sellRevenue: trade.sell_revenue,
            dexName: trade.dex_name ?? null,
            exitState,
        };
    }));

    return positions;
}
