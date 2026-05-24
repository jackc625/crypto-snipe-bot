// src/anti-rug/types.ts
// Phase 19 / Plan 19-03 Task 1 — Source-of-truth type contract for the
// `src/anti-rug/` module. Declares:
//
//   - RugSignals          : the per-signal evidence shape (LP-removed %,
//                           destination, allowlist-hit, sell-sim slippage,
//                           V2 reserve-pct-below).
//   - RugEvaluation       : discriminated-union return shape with verdict
//                           values 'safe' | 'unsafe' | 'allowlisted' |
//                           'unknown'. Vacuous-pass is UNREPRESENTABLE — the
//                           'safe' variant carries `reason: 'partial-signal'`
//                           + `signals: RugSignals` as REQUIRED fields, so
//                           `{ verdict: 'safe' }` cannot type-check (mirrors
//                           Phase 18 HoneypotResult discipline D-13/D-14).
//   - AllowlistEntry      : per-locker row carrying provenance for the
//                           D-LIST-AUDIT trail.
//   - AntiRugConfig       : per-chain anti-rug tuning + merged V2 + V3
//                           allowlists. Re-exported via chainRegistry.ts
//                           so ChainConfig.antiRug uses this declaration.
//   - AntiRugMonitorState : UI-SPEC badge state union (6 values).
//   - TriggerEvent        : payload shared between detector + circuit
//                           breaker + dashboard (Plans 19-04 / 19-05 / 19-06).
//   - LpBaselineRow       : domain-shape mirror of the lp_baseline DB table
//                           (Plan 19-01) with camelCase field names.
//
// Discriminated-union shape decisions (Plan 19-03 Task 1):
//
//   - The 'safe' variant carries `reason: 'partial-signal'` because the only
//     way to reach `verdict='safe'` is "ALL three signals evaluated cleanly
//     but at least one missed its threshold". Carrying the reason allows the
//     evaluator to produce a structured audit trail of which sub-evaluation
//     failed without inflating the type to include per-signal verdicts.
//
//   - The 'allowlisted' variant carries `lockerName: string` (not nested
//     in signals) because the lockerName is the OPERATOR-FACING identity
//     (e.g. "Unicrypt UniLockerV2 ETH" vs "TeamFinance / TrustSwap Lock
//     ETH") that the D-LIST-AUDIT log line needs at the top level of the
//     evaluation. The matching destination address is still in signals
//     for the full evidence dump.
//
//   - The 'unknown' variant intentionally does NOT carry `signals` because
//     "unknown" specifically means "we could not evaluate the signals" —
//     the failure mode is precisely the absence of signal data. Forcing a
//     `signals` field on this variant would either lie (synthesize fake
//     data) or use null sentinels (which Phase 18 D-13/D-14 ban).
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/anti-rug/types.ts" (lines 506-545)
//   - src/utils/honeypot/types.ts (HoneypotResult analog — same shape)

/**
 * Per-signal evidence emitted by the detector's multi-signal evaluator.
 * Each field is non-null when its corresponding signal was successfully
 * evaluated; `null` on the V2-only / V3-only fields means "the other DEX
 * type's signal does not apply to this pool" (not "the signal failed").
 */
export interface RugSignals {
    /** Signal 1: percentage of LP removed since baseline. 0–100; > threshold trips. */
    lpRemovedPct: number;
    /** Signal 2: lowercased address that received the burned LP / liquidity. */
    destination: string;
    /** Signal 2 verdict against the merged allowlist (V2 + V3). */
    allowlistHit: 'safe' | 'unsafe' | 'unknown';
    /** Signal 3 (V3 only): sell-simulation slippage % via QuoterV2. null on V2 paths. */
    sellSimSlippagePct: number | null;
    /** Signal 3 (V2 only): reserves now below sell-threshold % of baseline. null on V3 paths. */
    v2ReservePctBelow: number | null;
}

/**
 * Discriminated-union evaluation result from `evaluateRugSignals(...)`.
 *
 * Vacuous-pass unrepresentable:
 *   - 'safe'        : REQUIRES `reason` + `signals`
 *   - 'unsafe'      : REQUIRES `reason` + `signals`
 *   - 'allowlisted' : REQUIRES `signals` + `lockerName`
 *   - 'unknown'     : REQUIRES `reason`, MUST NOT carry `signals`
 *
 * Each evaluator branch returns one of these variants; no branch can return
 * `{ verdict: 'safe' }` without first having computed all three signals.
 */
export type RugEvaluation =
    | {
          verdict: 'safe';
          reason: 'partial-signal';
          signals: RugSignals;
      }
    | {
          verdict: 'allowlisted';
          signals: RugSignals;
          lockerName: string;
      }
    | {
          verdict: 'unsafe';
          reason: 'three-signal-trigger';
          signals: RugSignals;
      }
    | {
          verdict: 'unknown';
          reason: string;
      };

/**
 * One row of the merged allowlist (hardcoded base + env overlay).
 * `provenance` distinguishes hardcoded entries from operator-supplied ones
 * for the D-LIST-AUDIT structured log dump at startup.
 */
export interface AllowlistEntry {
    /** Checksummed (or canonical lowercased burn) address. */
    address: string;
    /** Operator-facing name, e.g. 'Unicrypt UniLockerV2 ETH'. */
    lockerName: string;
    /** Where this entry came from. */
    provenance: 'hardcoded' | 'env-overlay';
}

/**
 * Per-chain anti-rug tuning + allowlist surface attached to ChainConfig.
 *
 * `liveExecute` defaults FALSE (dry-run) per D-LIVE-PER-CHAIN safety; the
 * operator flips it to true on a per-chain basis after the 7-day dry-run
 * gate + 0-FP review.
 *
 * `backfillCapBlocks` is the per-`getLogs`-call block-range cap (Alchemy
 * free-tier on ETH = 10; default 500 on BSC/Base/Arb per 19-RESEARCH.md
 * CRITICAL #1). `maxBackfillBlocks` is the hard ceiling above which a
 * [GAP DETECTED] alert fires (FAIL CLOSED per D-BACKFILL).
 *
 * `allowlistV2` / `allowlistV3` are the MERGED (hardcoded + env overlay)
 * locker allowlists per pool type. Plan 19-02 builds these at startup;
 * Plan 19-03 (this plan) consumes them for the signal-2 evaluator
 * (`isAddressAllowlisted`) and the startup verification
 * (`verifyAllowlistAtStartup`).
 */
export interface AntiRugConfig {
    liveExecute: boolean;
    lpRemovalPct: number;
    confirmBlocks: number;
    circuitBreakerTriggers: number;
    circuitBreakerWindowHours: number;
    gasMultiplier: number;
    backfillCapBlocks: number;
    maxBackfillBlocks: number;
    allowlistV2: AllowlistEntry[];
    allowlistV3: AllowlistEntry[];
}

/**
 * UI-SPEC badge state union for the dashboard's "Anti-Rug" positions-table
 * column. The 6 states exactly match the colour/label table in UI-SPEC
 * §"Anti-Rug column header and badges":
 *
 *   'live'             — anti-rug monitor running with executeFullSell wired
 *   'dry-run'          — monitor running; exits are logged but not submitted
 *   'would-have-sold'  — dry-run telemetry emitted a would-have-sold event;
 *                        operator click-through review pending
 *   'exit-fired'       — live exit successfully submitted
 *   'halted'           — circuit breaker tripped on this chain; no exits fire
 *   'unmonitored'      — position has no lp_baseline row (pre-v6.17 or error)
 */
export type AntiRugMonitorState =
    | 'live'
    | 'dry-run'
    | 'would-have-sold'
    | 'exit-fired'
    | 'halted'
    | 'unmonitored';

/**
 * Payload emitted at every trigger event (live or dry-run). Consumed by:
 *   - Plan 19-05 circuitBreaker.ts — for the rolling-window counter +
 *     dashboard 'cb_tripped' broadcast
 *   - Plan 19-06 dashboard — recent triggers list under the Anti-Rug
 *     Monitor tile
 *
 * `outcome` is a free-form string capturing what happened
 * (e.g. 'dry-run-would-have-sold', 'exit-fired-success',
 * 'exit-fired-revert', 'cb-suppressed').
 */
export interface TriggerEvent {
    token: string;
    pair: string;
    signals: RugSignals;
    outcome: string;
    timestamp: number;
    chain: string;
}

/**
 * Domain-shape mirror of the `lp_baseline` table (Plan 19-01).
 *
 * snake_case → camelCase mapping:
 *   - `trade_id`              → `tradeId`
 *   - `pool_type`             → `poolType`
 *   - `pair_or_pool_address`  → `pairOrPoolAddress`
 *   - `v2_token0_reserve`     → `v2Token0Reserve`
 *   - `v2_token1_reserve`     → `v2Token1Reserve`
 *   - `v2_lp_total_supply`    → `v2LpTotalSupply`
 *   - `v3_active_liquidity`   → `v3ActiveLiquidity`
 *   - `v3_tick_at_snapshot`   → `v3TickAtSnapshot`
 *   - `v3_position_nft_id`    → `v3PositionNftId`
 *   - `v3_fee_tier`           → `v3FeeTier`
 *   - `snapshot_block`        → `snapshotBlock`
 *   - `snapshot_ts`           → `snapshotTs`
 *
 * String-typed bigint fields preserve precision across the better-sqlite3
 * TEXT-storage boundary (matches the `trades.amount_in` convention from
 * Phase 4). Caller converts to `bigint` at use site.
 *
 * Per Plan 19-01 + Research Open Question #3, `v3PositionNftId` stays
 * NULLABLE in v6.17 — V3 baseline is pool-only.
 */
export interface LpBaselineRow {
    tradeId: number;
    poolType: 'v2' | 'v3';
    pairOrPoolAddress: string;
    v2Token0Reserve: string | null;
    v2Token1Reserve: string | null;
    v2LpTotalSupply: string | null;
    v3ActiveLiquidity: string | null;
    v3TickAtSnapshot: number | null;
    v3PositionNftId: string | null;
    v3FeeTier: number | null;
    snapshotBlock: number;
    snapshotTs: number;
}
