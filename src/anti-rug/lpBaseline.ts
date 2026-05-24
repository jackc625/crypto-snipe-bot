// src/anti-rug/lpBaseline.ts
// Phase 19 / Plan 19-03 Task 3 — LP-baseline snapshot, load, and clear
// helpers for the anti-rug detector.
//
// Exports:
//   - snapshotLpBaseline(ctx, dex, tradeId, pairOrPoolAddress, feeTier)
//       Called from Plan 19-05's V2/V3 buy-success branches parallel to
//       startExitMonitor. Reads on-chain state (V2: reserves + totalSupply;
//       V3: active liquidity + tick) and persists a row to lp_baseline via
//       Plan 19-01's `upsertLpBaseline` prepared statement.
//
//   - loadLpBaseline(tradeId): LpBaselineRow | null
//       Read-side for Plan 19-05's restart-resume path. Maps the
//       snake_case DB columns to the camelCase LpBaselineRow domain shape.
//
//   - clearLpBaseline(tradeId): number
//       Cleanup hook for Plan 19-05's exitEngine.ts:504 integration point
//       (full-close `unsubscribeAntiRug` flow). Returns the number of rows
//       deleted (0 or 1) so callers can log the outcome.
//
// Design decisions:
//
//   - V2 vs V3 dispatch on `dex.dexType` — single discriminator branch with
//     no per-chain logic. The ChainConfig dex registry shape (Plan 17+18)
//     guarantees every DexConfig carries the tag, so Plan 19 inherits the
//     branch-free dispatch with the existing isDexV2/isDexV3 idiom (or in
//     this case a simple `if (dex.dexType === 'v2')`).
//
//   - Errors from getReserves/totalSupply/liquidity/slot0 PROPAGATE. Buy-
//     success without a recorded baseline = the detector cannot evaluate
//     signal-1 (LP-removed %) for this position. Failing loudly here forces
//     the caller (Plan 19-05's buy-success branch) to surface the failure
//     via its existing error-emission path; silently swallowing would
//     produce an "unmonitored" position with NO operator awareness.
//
//   - `pair_or_pool_address` is lowercased before persisting. The
//     lp_baseline table column carries `COLLATE NOCASE` (Plan 19-01) so the
//     DB will lookup either way; lowercasing on write keeps the stored
//     form canonical and matches the existing `trades.token` convention
//     (Phase 4 storage layer).
//
//   - `v3PositionNftId` stays NULL on every insert in v6.17 per Research
//     Open Question #3 / Plan 19-01 decision — V3 baseline is pool-only.
//     The column exists for forward compatibility with v6.18+ NFT tracking.
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/anti-rug/lpBaseline.ts" (lines 282-348)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-01-SUMMARY.md
//       (upsertLpBaseline / getLpBaseline / deleteLpBaseline shapes)

import { Contract } from 'ethers';
import type { ChainContext, DexConfig } from '../chainRegistry';
import { PAIR_ABI, V3_POOL_ABI } from '../utils/abis';
import {
    upsertLpBaseline,
    getLpBaseline,
    deleteLpBaseline,
} from '../utils/db';
import type { LpBaselineRow } from './types';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'antiRug:lpBaseline' });

// ---------------------------------------------------------------------------
// snapshotLpBaseline
// ---------------------------------------------------------------------------

/**
 * Snapshot the LP baseline for a trade at buy success.
 *
 * V2 path (dex.dexType === 'v2'):
 *   - Reads `pair.getReserves()` (returns [reserve0, reserve1, ts]) and
 *     `pair.totalSupply()` in parallel via Promise.all.
 *   - Persists with poolType='v2', V2 fields populated, V3 fields explicitly
 *     null.
 *
 * V3 path (dex.dexType === 'v3'):
 *   - Reads `pool.liquidity()` (uint128 active liquidity at current tick)
 *     and `pool.slot0()` (returns tuple where index 1 is the int24 tick) in
 *     parallel via Promise.all.
 *   - Persists with poolType='v3', V3 fields populated (v3FeeTier from
 *     argument; v3PositionNftId=null per v6.17 Open Question #3), V2 fields
 *     explicitly null.
 *
 * Common fields written on every call:
 *   - `snapshot_block` = `ctx.httpProvider.getBlockNumber()` at call time.
 *   - `snapshot_ts`    = Unix epoch seconds at call time.
 *   - `pair_or_pool_address` lowercased.
 *
 * Emits exactly one structured pino info line on success:
 *     { tradeId, pool, snapshotBlock, op: 'antirug.lp-baseline.snapshot' }
 *
 * Errors from the on-chain calls propagate to the caller — buy-success
 * without a baseline is a fail-loud condition for the anti-rug monitor.
 *
 * @param ctx                ChainContext (httpProvider + chain.name for log fields).
 * @param dex                DexConfig (v2 or v3 via dexType discriminator).
 * @param tradeId            trades.id of the just-completed buy.
 * @param pairOrPoolAddress  Pair address (V2) or pool address (V3).
 * @param feeTier            V3 fee tier (e.g. 3000); null for V2.
 */
export async function snapshotLpBaseline(
    ctx: ChainContext,
    dex: DexConfig,
    tradeId: number,
    pairOrPoolAddress: string,
    feeTier: number | null,
): Promise<void> {
    const block = await ctx.httpProvider.getBlockNumber();
    const ts = Math.floor(Date.now() / 1000);
    const lcAddress = pairOrPoolAddress.toLowerCase();

    if (dex.dexType === 'v2') {
        const pair = new Contract(pairOrPoolAddress, PAIR_ABI, ctx.httpProvider);
        const [reserves, totalSupply] = await Promise.all([
            pair.getReserves(),
            pair.totalSupply(),
        ]);
        upsertLpBaseline.run({
            tradeId,
            poolType: 'v2',
            pairOrPoolAddress: lcAddress,
            v2Token0Reserve: reserves[0].toString(),
            v2Token1Reserve: reserves[1].toString(),
            v2LpTotalSupply: totalSupply.toString(),
            v3ActiveLiquidity: null,
            v3TickAtSnapshot: null,
            v3PositionNftId: null,
            v3FeeTier: null,
            snapshotBlock: block,
            snapshotTs: ts,
        });
    } else {
        // V3 path
        const pool = new Contract(pairOrPoolAddress, V3_POOL_ABI, ctx.httpProvider);
        const [liquidity, slot0] = await Promise.all([
            pool.liquidity(),
            pool.slot0(),
        ]);
        upsertLpBaseline.run({
            tradeId,
            poolType: 'v3',
            pairOrPoolAddress: lcAddress,
            v2Token0Reserve: null,
            v2Token1Reserve: null,
            v2LpTotalSupply: null,
            v3ActiveLiquidity: liquidity.toString(),
            v3TickAtSnapshot: Number(slot0[1]),
            v3PositionNftId: null, // Pool-only baseline in v6.17 — Research Open Q #3
            v3FeeTier: feeTier,
            snapshotBlock: block,
            snapshotTs: ts,
        });
    }

    log.info(
        {
            tradeId,
            pool: lcAddress,
            snapshotBlock: block,
            op: 'antirug.lp-baseline.snapshot',
        },
        'Anti-rug LP baseline snapshot recorded',
    );
}

// ---------------------------------------------------------------------------
// loadLpBaseline
// ---------------------------------------------------------------------------

/**
 * Internal: shape of a row returned by `getLpBaseline.get(tradeId)`. The
 * better-sqlite3 prepared statement returns snake_case column names because
 * the SQL schema uses them; the domain LpBaselineRow uses camelCase. This
 * type captures the wire shape so the field-name mapping is auditable.
 */
interface LpBaselineDbRow {
    trade_id: number;
    pool_type: 'v2' | 'v3';
    pair_or_pool_address: string;
    v2_token0_reserve: string | null;
    v2_token1_reserve: string | null;
    v2_lp_total_supply: string | null;
    v3_active_liquidity: string | null;
    v3_tick_at_snapshot: number | null;
    v3_position_nft_id: string | null;
    v3_fee_tier: number | null;
    snapshot_block: number;
    snapshot_ts: number;
}

/**
 * Load the LP baseline for a trade.
 *
 * Returns null when no row exists for the given tradeId (e.g., the trade
 * predates Phase 19 and never had a baseline snapshot, or the row was
 * already cleared on full close). Otherwise returns the camelCase domain
 * shape with all fields mapped from the snake_case DB columns.
 *
 * @param tradeId  trades.id PRIMARY KEY.
 * @returns LpBaselineRow on hit; null on miss.
 */
export function loadLpBaseline(tradeId: number): LpBaselineRow | null {
    const row = getLpBaseline.get(tradeId) as LpBaselineDbRow | undefined;
    if (!row) return null;
    return {
        tradeId: row.trade_id,
        poolType: row.pool_type,
        pairOrPoolAddress: row.pair_or_pool_address,
        v2Token0Reserve: row.v2_token0_reserve,
        v2Token1Reserve: row.v2_token1_reserve,
        v2LpTotalSupply: row.v2_lp_total_supply,
        v3ActiveLiquidity: row.v3_active_liquidity,
        v3TickAtSnapshot: row.v3_tick_at_snapshot,
        v3PositionNftId: row.v3_position_nft_id,
        v3FeeTier: row.v3_fee_tier,
        snapshotBlock: row.snapshot_block,
        snapshotTs: row.snapshot_ts,
    };
}

// ---------------------------------------------------------------------------
// clearLpBaseline
// ---------------------------------------------------------------------------

/**
 * Clear the LP baseline for a trade. Called from the exitEngine's full-close
 * cleanup hook (Plan 19-05 wires this at exitEngine.ts:504, right after
 * `deleteExitState.run(tradeId)`).
 *
 * Returns the number of rows deleted (0 if no row existed, 1 if cleared).
 * Callers can log the outcome — a 0-changes result is non-fatal (the row
 * may have been cleared by an earlier path) but worth structured logging.
 *
 * @param tradeId  trades.id whose baseline should be cleared.
 * @returns The changes count from the underlying DELETE.
 */
export function clearLpBaseline(tradeId: number): number {
    const result = deleteLpBaseline.run(tradeId) as { changes: number };
    return result.changes;
}
