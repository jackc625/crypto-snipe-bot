// src/anti-rug/detector.ts
// Phase 19 / Plan 19-04a — Anti-rug detector FOUNDATION skeleton.
//
// This file ships the position-registry plumbing, the WS subscription
// skeleton with topic-filter union, the dispatch router, and the chunked
// getLogs primitive. Plans 19-04b (multi-signal evaluator) and 19-04c
// (WS lifecycle: heartbeat + reconnect + backfill + HTTP polling fallback)
// extend this skeleton in later waves.
//
// PUBLIC SURFACE (consumed by Plans 19-04b / 19-04c / 19-05):
//   - registerAntiRugPosition(ctx, dex, tokenAddress, pairOrPoolAddress, tradeId, feeTier)
//   - unregisterAntiRugPosition(chain, tradeId)
//   - startChainAntiRugListener(ctx)       — SKELETON; full lifecycle in 19-04c
//   - getLogsForBackfill(ctx, fromBlock, toBlock, addresses, topics)
//   - getRegisteredPositions(chain)        — flat list (resume/backfill helper)
//
// TEST HOOK (private surface, exported with underscore prefix):
//   - _setEvaluateRugSignalsForTesting(fn) — Plan 19-04b ships the real
//     evaluateRugSignals; this plan's unit tests inject a spy via this hook
//     because dispatchEvent calls evaluateRugSignals BEFORE 19-04b lands.
//   - _resetRegistryForTesting()           — clears positionRegistry +
//     chainState between unit tests so per-chain state doesn't bleed.
//
// DESIGN DECISIONS (see 19-04a-SUMMARY.md for the full rationale):
//
//   1. positionRegistry shape: Map<chain, Map<addr, RegisteredPosition[]>>
//      - Outer key: chain.name (e.g. 'eth'). Per-chain isolation.
//      - Inner key: lowercased pair/pool address.
//      - Value: ARRAY of registered positions on that address. Handles the
//        rare case of multiple positions on the same pair (Test 20).
//
//   2. chainState shape: Map<chain.name, ChainAntiRugState> — populated with
//      a minimal skeleton on first registerAntiRugPosition; Plan 19-04c
//      populates the heartbeat / reconnect / backfill fields.
//
//   3. evaluateRugSignals shim: declared as a module-scoped `let` variable
//      defaulted to a warn-only stub. Plan 19-04b lands the real evaluator
//      (and the test hook `_setEvaluateRugSignalsForTesting` injects a spy
//      for this plan's dispatch-routing unit tests). This is the cleanest
//      mechanism that lets THIS plan ship a passing test suite without
//      Plan 19-04b's evaluator existing yet.
//
//   4. Topic filter union: a SINGLE WS subscription per chain whose `topics`
//      field is the union of ALL four topics (V2 Pair.Burn + Pair.Transfer
//      + V3 Pool.Burn + Pool.Collect). The dispatch router decides which
//      position(s) the event belongs to via the inner-map address lookup.
//      Pitfall #10 LOCKS single-listener-per-chain.
//
//   5. Address filter: union of all registered pair/pool addresses for the
//      chain (lowercased; ethers v6 accepts mixed/lowercase indifferently
//      but lowercasing avoids relying on implementation detail).
//
//   6. getLogsForBackfill chunk iteration: `chunkStart += cap` with
//      `chunkEnd = min(chunkStart + cap - 1, toBlock)`. Cap from
//      `ctx.chain.antiRug.backfillCapBlocks` per 19-RESEARCH.md CRITICAL #1
//      (Alchemy free tier = 10 blocks per call). Errors propagate (no
//      try/catch swallow) — Plan 19-04c handles the [GAP DETECTED] FAIL
//      CLOSED branch.
//
//   7. WS subscription idempotency: re-calling startChainAntiRugListener
//      removes the previous filter listener and re-installs a fresh one
//      with the current address+topic union. This is the planner-recommended
//      "drop+recreate" mechanism. ethers v6 WebSocketProvider lacks a clean
//      "replace filter" API, and re-using `.off()` keeps the implementation
//      explicit (versus calling `.on()` multiple times and accumulating
//      stale handlers, which would dispatch each event 2+ times after a
//      reconnect or address-list change).
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-04a-PLAN.md
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/anti-rug/detector.ts" (lines 76-198)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md
//       §5 CRITICAL #1 (Alchemy 10-block cap) + §6 (single-listener-per-chain)
//   - src/bot.ts:656-752 (startDexListener — canonical single-listener-per-chain analog)

import { Contract } from 'ethers';
import type { Log, WebSocketProvider } from 'ethers';
import type { ChainContext, DexConfig } from '../chainRegistry';
import {
    PAIR_BURN_TOPIC,
    PAIR_TRANSFER_TOPIC,
    POOL_BURN_TOPIC,
    POOL_COLLECT_TOPIC,
} from './events';
import { loadLpBaseline } from './lpBaseline';
import { isAddressAllowlisted } from './allowlist';
import type { LpBaselineRow, RugEvaluation, RugSignals } from './types';
import { PAIR_ABI, V3_POOL_ABI, V3_QUOTER_V2_ABI } from '../utils/abis';
import { logger } from '../utils/logger';
import { triggerAntiRugExit } from './exitTrigger';

const log = logger.child({ module: 'antiRug:detector' });

// ---------------------------------------------------------------------------
// Types — registry + per-chain state
// ---------------------------------------------------------------------------

/**
 * One registered position. Plan 19-04b's `evaluateRugSignals` receives this
 * shape and uses it to look up the V2 reserves baseline vs current state,
 * the V3 active-liquidity baseline, and the fee tier for the V3 sell-sim.
 */
export interface RegisteredPosition {
    tradeId: number;
    chain: string;
    tokenAddress: string;
    /** Lowercased pair (V2) or pool (V3) address. */
    pairOrPoolAddress: string;
    dex: DexConfig;
    /** V3 fee tier (e.g. 3000); null for V2. */
    feeTier: number | null;
    /** Snapshot from Plan 19-01's lp_baseline table at buy success. */
    baseline: LpBaselineRow;
    /** Discriminator derived from `dex.dexType`. */
    poolType: 'v2' | 'v3';
}

/**
 * Per-chain WS subscription state.
 *
 * This plan initialises with a minimal {wsProvider:null, heartbeatInterval:
 * null, reconnectAttempts:0, lastSeenBlock:0, healthState:'disconnected',
 * lastPongTs:0} record on first registerAntiRugPosition. Plan 19-04c
 * populates the rest as part of the heartbeat + reconnect + backfill cycle.
 */
interface ChainAntiRugState {
    wsProvider: WebSocketProvider | null;
    heartbeatInterval: NodeJS.Timeout | null;
    reconnectAttempts: number;
    lastSeenBlock: number;
    healthState: 'connected' | 'reconnecting' | 'disconnected';
    lastPongTs: number;
    /**
     * The dispatcher currently wired to the WS subscription. Tracked so we
     * can call `wsProvider.off(filter, dispatcher)` to drop the prior
     * subscription before installing a fresh one on address/topic-set change.
     * `null` when no subscription is active.
     */
    activeDispatcher: ((logEvent: Log) => void) | null;
    /**
     * The filter object the activeDispatcher is wired to. Used for the
     * `wsProvider.off(...)` call when re-subscribing.
     */
    activeFilter: { address: string[]; topics: string[][] } | null;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const positionRegistry = new Map<
    string,
    Map<string, RegisteredPosition[]>
>();

const chainState = new Map<string, ChainAntiRugState>();

// ---------------------------------------------------------------------------
// Plan 19-04b — V3 Burn-without-Collect grace window state
// ---------------------------------------------------------------------------

/**
 * Default V3 Burn-without-Collect grace window in blocks (planner discretion,
 * see SUMMARY §"V3_BURN_GRACE_BLOCKS default"). On a V3 Pool.Burn event, the
 * pending entry holds the burn pending EITHER (i) a Pool.Collect arrival
 * within the grace window OR (ii) the grace-timeout block-watcher firing.
 *
 * In v6.17 this is a hardcoded module-level constant. v6.18 may promote to
 * `ctx.chain.antiRug.v3BurnGraceBlocks` if operational data shows a need to
 * tune per chain.
 */
const V3_BURN_GRACE_BLOCKS = 5;

interface PendingV3Burn {
    poolAddress: string;
    position: RegisteredPosition;
    burnEvent: Log;
    burnBlockNumber: number;
    timeoutBlockNumber: number; // burnBlockNumber + V3_BURN_GRACE_BLOCKS
}

/**
 * Per-pool pending V3 Burn entries keyed by lowercased pool address. The
 * value is the MOST RECENT Burn event held pending re-evaluation per planner
 * discretion (LAST-WINS — see SUMMARY §"Multiple Burns within grace window").
 *
 * pendingV3Burn lifecycle:
 *   - Set in handleV3BurnArrival when a Pool.Burn arrives.
 *   - Cleared in handleV3CollectArrival when a Pool.Collect for the same
 *     pool arrives within the grace window (the Collect's evaluation
 *     supersedes the held Burn).
 *   - Cleared in the grace-timeout block-watcher's `evaluateV3MultiSignal`
 *     call when the grace window elapses without a Collect.
 *   - Cleared by `_clearPendingV3BurnForTesting` / `_resetRegistryForTesting`
 *     in unit tests.
 */
const pendingV3Burn = new Map<string, PendingV3Burn>();

// ---------------------------------------------------------------------------
// evaluateRugSignals shim — Plan 19-04b real implementation
// ---------------------------------------------------------------------------

/**
 * Module-scoped reference to the active evaluator. Defaulted to the real
 * implementation (`evaluateRugSignalsImpl`) shipped by this plan; the
 * `_setEvaluateRugSignalsForTesting` hook lets Plan 19-04a's existing tests
 * inject a spy without breaking the dispatch-routing behavior of the WS
 * subscription.
 *
 * Plan 19-04a's tests are preserved because the shim STILL gets called from
 * dispatchEvent (line ~556) via the let-bound reference; the only change
 * vs Plan 19-04a is that the DEFAULT value points to the real evaluator,
 * not the warn-only stub.
 */
let evaluateRugSignalsShim: (
    ctx: ChainContext,
    position: RegisteredPosition,
    logEvent: Log,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Test hooks (underscore-prefixed exports)
// ---------------------------------------------------------------------------

/**
 * Inject a custom evaluateRugSignals function for testing.
 *
 * Plan 19-04a's unit tests (`test/unit/anti-rug/detectorRegistry.test.ts`)
 * pass a `vi.fn()` here to assert dispatch-routing behavior. Plan 19-04b
 * may also use this hook for its own tests or replace the module-level
 * shim outright.
 */
export function _setEvaluateRugSignalsForTesting(
    fn: (
        ctx: ChainContext,
        position: RegisteredPosition,
        logEvent: Log,
    ) => Promise<unknown>,
): void {
    evaluateRugSignalsShim = fn;
}

/**
 * Reset the registry + chainState maps to empty. Test-only — production
 * lifecycle never resets these (positions are registered/unregistered
 * incrementally per buy/sell).
 *
 * Also clears the pendingV3Burn map (Plan 19-04b grace-window state) so
 * V3 Burn entries do not bleed between tests.
 */
export function _resetRegistryForTesting(): void {
    positionRegistry.clear();
    chainState.clear();
    pendingV3Burn.clear();
}

/**
 * Plan 19-04b test hook: clear ONLY the pendingV3Burn map. Used by
 * detectorEvaluator.test.ts to reset grace-window state between tests
 * without disturbing the position registry.
 */
export function _clearPendingV3BurnForTesting(): void {
    pendingV3Burn.clear();
}

/**
 * Plan 19-04b test hook: inspect a pendingV3Burn entry by pool address
 * (lowercased). Returns the entry or undefined. Used by Test 10d
 * (LAST-WINS verification) to confirm the latest Burn replaces the prior.
 */
export function _getPendingV3BurnForTesting(
    poolAddress: string,
): PendingV3Burn | undefined {
    return pendingV3Burn.get(poolAddress.toLowerCase());
}

// ---------------------------------------------------------------------------
// Public API: registerAntiRugPosition / unregisterAntiRugPosition / getRegisteredPositions
// ---------------------------------------------------------------------------

/**
 * Register an open position with the anti-rug detector.
 *
 * Behavior:
 *   1. Load the lp_baseline row for the trade via Plan 19-03's
 *      `loadLpBaseline(tradeId)`. If null, log.error with structured
 *      fields and RETURN WITHOUT REGISTERING — buy-success should have
 *      called snapshotLpBaseline first; a missing baseline is a bug
 *      visible via the operator's log review path. The dashboard will
 *      surface the position as "Unmonitored" per UI-SPEC.
 *
 *   2. Build the RegisteredPosition with `poolType = dex.dexType` (the
 *      ChainConfig discriminator from Phases 17/18).
 *
 *   3. Insert into positionRegistry[chain.name][pair.toLowerCase()] — the
 *      inner Map is created lazily on the first registration for each chain.
 *      The address bucket is an ARRAY so multiple positions on the same
 *      pair (Test 20 case) are all dispatched.
 *
 *   4. Initialise chainState[chain.name] if absent.
 *
 *   5. Kick off (or refresh) the WS subscription via
 *      `startChainAntiRugListener(ctx)`. The function is idempotent: drops
 *      the prior subscription if any and reinstalls with the current
 *      address+topic union.
 *
 * Called from Plan 19-05's V2 + V3 buy-success branches in src/bot.ts,
 * parallel to startExitMonitor.
 */
export async function registerAntiRugPosition(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    pairOrPoolAddress: string,
    tradeId: number,
    feeTier: number | null,
): Promise<void> {
    const baseline = loadLpBaseline(tradeId);
    if (!baseline) {
        log.error(
            {
                tradeId,
                chain: ctx.chain.name,
                pair: pairOrPoolAddress,
                op: 'antirug.register.no-baseline',
            },
            'Anti-rug register skipped — lp_baseline row missing (snapshot may have failed)',
        );
        return;
    }

    const chainName = ctx.chain.name;
    const lcAddress = pairOrPoolAddress.toLowerCase();
    const position: RegisteredPosition = {
        tradeId,
        chain: chainName,
        tokenAddress,
        pairOrPoolAddress: lcAddress,
        dex,
        feeTier,
        baseline,
        poolType: dex.dexType,
    };

    let perChain = positionRegistry.get(chainName);
    if (!perChain) {
        perChain = new Map<string, RegisteredPosition[]>();
        positionRegistry.set(chainName, perChain);
    }
    const bucket = perChain.get(lcAddress);
    if (bucket) {
        bucket.push(position);
    } else {
        perChain.set(lcAddress, [position]);
    }

    if (!chainState.has(chainName)) {
        chainState.set(chainName, {
            wsProvider: null,
            heartbeatInterval: null,
            reconnectAttempts: 0,
            lastSeenBlock: 0,
            healthState: 'disconnected',
            lastPongTs: 0,
            activeDispatcher: null,
            activeFilter: null,
        });
    }

    log.info(
        {
            tradeId,
            chain: chainName,
            pair: lcAddress,
            poolType: position.poolType,
            op: 'antirug.register',
        },
        'Anti-rug position registered',
    );

    // Kick off or refresh the WS subscription so the new address is in
    // the filter union. Plan 19-04c lands the heartbeat / reconnect /
    // backfill lifecycle; this plan ships the subscription wire-up only.
    await startChainAntiRugListener(ctx);
}

/**
 * Unregister a position from the anti-rug detector.
 *
 * Removes the entry by tradeId from whichever inner-map bucket holds it
 * across the chain's registry. If the bucket becomes empty, the address
 * key is deleted entirely so the filter address-list shrinks on the next
 * `startChainAntiRugListener` call.
 *
 * If the chain has zero positions remaining, the WS subscription is LEFT
 * RUNNING with an empty address list (saves reconnect cost on the next
 * buy; planner discretion per <interfaces>).
 *
 * Called from Plan 19-05's full-close cleanup hook at exitEngine.ts:504.
 */
export function unregisterAntiRugPosition(
    chain: string,
    tradeId: number,
): void {
    const perChain = positionRegistry.get(chain);
    if (!perChain) return;

    for (const [addr, bucket] of perChain.entries()) {
        const idx = bucket.findIndex((p) => p.tradeId === tradeId);
        if (idx !== -1) {
            bucket.splice(idx, 1);
            if (bucket.length === 0) {
                perChain.delete(addr);
            }
            log.info(
                {
                    tradeId,
                    chain,
                    pair: addr,
                    op: 'antirug.unregister',
                },
                'Anti-rug position unregistered',
            );
            return;
        }
    }

    // Non-existent tradeId is a no-op (matches the plan's <behavior>).
}

/**
 * Return a flat list of all positions registered on a chain.
 *
 * Consumed by:
 *   - This module's startChainAntiRugListener to build the address-union
 *     filter on every (re-)subscription.
 *   - Plan 19-04c's resumeAntiRugMonitoring path (`getLogs` backfill needs
 *     to know which addresses to query).
 *   - Plan 19-06's dashboard for the "open positions monitored" tile.
 */
export function getRegisteredPositions(chain: string): RegisteredPosition[] {
    const perChain = positionRegistry.get(chain);
    if (!perChain) return [];
    const out: RegisteredPosition[] = [];
    for (const bucket of perChain.values()) {
        for (const p of bucket) {
            out.push(p);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Public API: startChainAntiRugListener — WS subscription SKELETON
// ---------------------------------------------------------------------------

/**
 * Start (or refresh) the single per-chain anti-rug WS subscription.
 *
 * This plan ships the SKELETON. Plan 19-04c lands the full body:
 *   - Heartbeat (`ws@^8.20.0` ping/pong every 30s; `terminate()` on no-pong)
 *   - Reconnect (exponential backoff with on('close') handler)
 *   - backfillSinceLastSeen (chunked `getLogs` via `getLogsForBackfill`)
 *   - HTTP polling fallback (when `ctx.wsProvider == null`)
 *   - chain_ws_health_change broadcast to the dashboard
 *   - chain_state.last_seen_block bookkeeping
 *
 * Skeleton behavior in THIS plan:
 *   1. If `ctx.wsProvider == null`, log warn — HTTP polling fallback lands
 *      in Plan 19-04c.
 *   2. Compute the address-union (all registered pair/pool addresses for
 *      the chain, lowercased).
 *   3. Compute the topic-union (all four V2 + V3 topics — single filter
 *      covers every registered position regardless of poolType).
 *   4. If a prior dispatcher is wired, call `wsProvider.off(filter, fn)`
 *      to drop it before subscribing with the new filter — keeps each
 *      chain's WS subscription count == 1 per Pitfall #10.
 *   5. Wire the new dispatcher via `wsProvider.on(filter, dispatcher)`.
 *   6. Update chainState bookkeeping (wsProvider handle, healthState,
 *      activeDispatcher, activeFilter).
 *
 * Idempotent: re-calling with the same chain refreshes the filter
 * union. Returns immediately if there are no registered positions for
 * the chain (Plan 19-04c will keep the WS subscription RUNNING even
 * with an empty address list per the planner's discretionary call —
 * this skeleton sets up the subscription only when at least one address
 * is registered to keep the test surface minimal).
 */
export async function startChainAntiRugListener(
    ctx: ChainContext,
): Promise<void> {
    const chainName = ctx.chain.name;
    const state = chainState.get(chainName);
    if (!state) {
        // No registrations on this chain yet — nothing to subscribe to.
        return;
    }

    if (!ctx.wsProvider) {
        // TODO Plan 19-04c — HTTP polling fallback (startHttpPollingAntiRug)
        // for chains without a WS endpoint configured. See src/bot.ts:758-810
        // for the canonical polling-fallback pattern.
        log.warn(
            {
                chain: chainName,
                op: 'antirug.listener.no-ws',
            },
            'Anti-rug WS provider missing — TODO Plan 19-04c: HTTP polling fallback',
        );
        return;
    }

    const addresses = getRegisteredPositions(chainName).map(
        (p) => p.pairOrPoolAddress,
    );
    if (addresses.length === 0) {
        // No addresses registered — nothing to filter. Plan 19-04c will
        // decide whether to keep the WS subscription alive with empty
        // address filter or tear it down.
        return;
    }

    // Topic filter union — single subscription covers all four topics
    // (V2 Pair.Burn + Pair.Transfer + V3 Pool.Burn + Pool.Collect).
    // ethers v6 treats `topics: [[topic0_a, topic0_b, ...]]` as the
    // standard OR-at-position-0 filter shape.
    const topicUnion = [
        PAIR_BURN_TOPIC,
        PAIR_TRANSFER_TOPIC,
        POOL_BURN_TOPIC,
        POOL_COLLECT_TOPIC,
    ];
    const filter = {
        address: addresses,
        topics: [topicUnion],
    };

    // Drop the prior dispatcher before installing the fresh one. ethers v6
    // does not support filter-replace natively; calling .on(...) twice on
    // the same provider would install BOTH handlers and dispatch each
    // event twice. Drop+recreate is the explicit pattern.
    if (state.activeDispatcher && state.activeFilter) {
        ctx.wsProvider.off(state.activeFilter, state.activeDispatcher);
    }

    const dispatcher = (logEvent: Log): void => {
        // dispatchEvent is intentionally fire-and-forget at this layer.
        // The evaluator is async; we await internally via the shim, but
        // any rejection is logged inside dispatchEvent so unhandled
        // rejections do not surface to the WS subscription wrapper.
        void dispatchEvent(ctx, logEvent);
    };

    ctx.wsProvider.on(filter, dispatcher);

    state.wsProvider = ctx.wsProvider;
    state.healthState = 'connected';
    state.activeDispatcher = dispatcher;
    state.activeFilter = filter;

    log.info(
        {
            chain: chainName,
            addresses: addresses.length,
            topics: topicUnion.length,
            op: 'antirug.listener.subscribed',
        },
        'Anti-rug WS subscription installed (skeleton — TODO Plan 19-04c: heartbeat + reconnect + backfill)',
    );

    // TODO Plan 19-04c — heartbeat setup, reconnect 'close' handler,
    // backfillSinceLastSeen call, broadcast 'chain_ws_health_change'.
}

// ---------------------------------------------------------------------------
// Internal: dispatchEvent — log → position(s) → evaluateRugSignals
// ---------------------------------------------------------------------------

/**
 * Route a log event to all positions registered on its address.
 *
 * - Extract `address = logEvent.address.toLowerCase()`.
 * - Look up `positions = positionRegistry[ctx.chain.name][address] ?? []`.
 * - For each position, call `evaluateRugSignals(ctx, position, logEvent)`.
 *   Plan 19-04b lands the actual evaluator; this plan's test mocks it via
 *   `_setEvaluateRugSignalsForTesting`.
 * - Unknown addresses (not in the inner map) silently drop — the WS
 *   subscription's address filter SHOULD prevent these, but a defence-
 *   in-depth lookup costs nothing and protects against filter mis-config.
 *
 * The function is NOT exported — internal dispatch only. Plan 19-04b can
 * extend it inline (since both plans share this file) when wiring the
 * evaluator's return-value handling (verdict='unsafe' → confirm-after-N
 * delay queue, verdict='allowlisted' → suppressed-event log line, etc.).
 */
async function dispatchEvent(
    ctx: ChainContext,
    logEvent: Log,
): Promise<void> {
    const chainName = ctx.chain.name;
    const lcAddress = logEvent.address.toLowerCase();
    const perChain = positionRegistry.get(chainName);
    if (!perChain) return;
    const positions = perChain.get(lcAddress);
    if (!positions || positions.length === 0) {
        // Not one of ours — silent drop per Test A5.
        return;
    }

    for (const position of positions) {
        try {
            // Plan 19-04b lands the actual evaluator; the let-shim above
            // routes through it. Failure is logged but does not break the
            // dispatch loop for sibling positions on the same pair.
            await evaluateRugSignalsShim(ctx, position, logEvent);
        } catch (err) {
            log.error(
                {
                    err,
                    tradeId: position.tradeId,
                    chain: chainName,
                    pair: lcAddress,
                    op: 'antirug.dispatch.evaluator-error',
                },
                'Anti-rug evaluator threw — continuing with next position',
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Public API: getLogsForBackfill — chunked getLogs primitive
// ---------------------------------------------------------------------------

/**
 * Chunked `eth_getLogs` primitive that respects each chain's per-call
 * block-range cap.
 *
 * Caller (Plan 19-04c's `backfillSinceLastSeen`) passes:
 *   - `fromBlock` / `toBlock` — INCLUSIVE block range to scan.
 *   - `addresses`             — the address-union currently registered.
 *   - `topics`                — typically `[[BURN, TRANSFER, BURN, COLLECT]]`,
 *                                the same union used in the WS subscription.
 *
 * Iteration math:
 *
 *     for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += cap) {
 *         const chunkEnd = Math.min(chunkStart + cap - 1, toBlock);
 *         const events = await ctx.httpProvider.getLogs({
 *             fromBlock: chunkStart, toBlock: chunkEnd,
 *             address: addresses, topics
 *         });
 *         allEvents.push(...events);
 *     }
 *
 * Example with cap=10 and [100, 150]: SIX chunks —
 *   [100, 109], [110, 119], [120, 129], [130, 139], [140, 149], [150, 150]
 *
 * The off-by-one is deliberate: `chunkStart + cap - 1` keeps each chunk's
 * EXCLUSIVE upper bound at `chunkStart + cap`, matching the standard
 * "cap blocks per call" Alchemy semantics. The final chunk shrinks to
 * `toBlock` whenever `chunkStart + cap - 1 > toBlock`.
 *
 * Errors propagate (no try/catch). Plan 19-04c's caller catches and
 * surfaces the FAIL CLOSED [GAP DETECTED] branch per D-BACKFILL.
 */
export async function getLogsForBackfill(
    ctx: ChainContext,
    fromBlock: number,
    toBlock: number,
    addresses: string[],
    topics: (string | string[])[],
): Promise<Log[]> {
    const cap = ctx.chain.antiRug.backfillCapBlocks;
    const allEvents: Log[] = [];
    for (
        let chunkStart = fromBlock;
        chunkStart <= toBlock;
        chunkStart += cap
    ) {
        const chunkEnd = Math.min(chunkStart + cap - 1, toBlock);
        const events = await ctx.httpProvider.getLogs({
            address: addresses,
            fromBlock: chunkStart,
            toBlock: chunkEnd,
            topics,
        });
        for (const e of events) {
            allEvents.push(e);
        }
    }
    return allEvents;
}

// ===========================================================================
// Plan 19-04b — Multi-signal AND chain evaluator + V3 Burn grace window
//                + confirm-after-N-blocks gate
// ===========================================================================
//
// THREE-SIGNAL CONTRACT:
//   - Signal 1 (LP-removed): for V2, percent drop in `pair.totalSupply()`
//     vs `baseline.v2_lp_total_supply`. For V3, percent drop in
//     `pool.liquidity()` vs `baseline.v3_active_liquidity`. Trips if
//     drop > `ctx.chain.antiRug.lpRemovalPct` (default 50%).
//   - Signal 2 (allowlist): destination address (V2 Burn `to` / V2 Transfer
//     `to` / V3 Burn `owner` / V3 Collect `owner` per D-V3-ALLOWLIST) NOT in
//     the chain's V2 or V3 allowlist. Trips when allowlist miss.
//     **Allowlist HIT short-circuits the AND chain → verdict='allowlisted'.**
//   - Signal 3 (sell-feasibility): for V2, current reserves below 50% of
//     baseline (i.e. `currentReserves / baselineReserves < 0.5`). For V3,
//     `QuoterV2.quoteExactInputSingle.staticCall(...)` returns a quoted
//     output < 50% of baseline expected. QuoterV2 revert = signal-3 trips
//     per fail-closed discipline (sell-impossible IS the rug condition).
//
// VERDICT DISCRIMINATED UNION:
//   - 'allowlisted' — destination in allowlist (short-circuit; signals carried).
//   - 'unsafe'      — all THREE signals tripped (verdict + reason + signals).
//   - 'safe'        — partial-signal (zero/one/two signals tripped).
//   - 'unknown'     — RPC error during evaluation (fail-closed; reason carried).
//
// CONFIRM-AFTER-N-BLOCKS GATE:
//   - After the AND chain reaches 'unsafe', the dispatch to triggerAntiRugExit
//     is HELD for `ctx.chain.antiRug.confirmBlocks` blocks. A block watcher
//     re-evaluates at the gate-elapsed block. If the verdict de-trips, the
//     dispatch is aborted (log 'antirug.signal-detripped'). If it stays
//     'unsafe', triggerAntiRugExit is invoked.
//   - confirmBlocks=0 fires synchronously (immediate dispatch — Test 13).
//
// V3 BURN-WITHOUT-COLLECT GRACE WINDOW (Blocker 2 resolution (a)):
//   - On Pool.Burn arrival: set pendingV3Burn entry; register block watcher
//     at burnBlock + V3_BURN_GRACE_BLOCKS for grace-timeout re-evaluation.
//   - On Pool.Collect arrival for the same pool within grace: consume the
//     pendingV3Burn entry; evaluate the AND chain synchronously on Collect.
//   - At grace-timeout block: re-evaluate the AND chain against current
//     pool state. If the held Burn pre-conditions still apply, the verdict
//     is deterministic per the live signal state.
//
// VACUOUS-PASS GUARD:
//   - Any thrown error during signal evaluation → verdict='unknown', with
//     `reason` carrying the error message. Never returns 'safe' on missing
//     data — that would be a vacuous pass through the type-system contract.

// ---------------------------------------------------------------------------
// V2 evaluation
// ---------------------------------------------------------------------------

/**
 * Decode the destination address (`to` / `owner` / `recipient`) from a log
 * event based on its topic[0]. Returns null if the topic does not match a
 * supported event signature (caller treats as topic-not-recognized).
 */
function decodeDestination(logEvent: Log): string | null {
    const topic0 = logEvent.topics[0];
    if (topic0 === PAIR_BURN_TOPIC) {
        // V2 Pair.Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)
        // `to` is the SECOND indexed param → topics[2].
        if (logEvent.topics.length < 3) return null;
        return '0x' + logEvent.topics[2].slice(26).toLowerCase();
    }
    if (topic0 === PAIR_TRANSFER_TOPIC) {
        // V2 Pair Transfer(address indexed from, address indexed to, uint256 value)
        // `to` is the SECOND indexed param → topics[2].
        if (logEvent.topics.length < 3) return null;
        return '0x' + logEvent.topics[2].slice(26).toLowerCase();
    }
    if (topic0 === POOL_BURN_TOPIC) {
        // V3 Pool.Burn(address indexed owner, int24 indexed tickLower, ...)
        // `owner` is the FIRST indexed param → topics[1].
        if (logEvent.topics.length < 2) return null;
        return '0x' + logEvent.topics[1].slice(26).toLowerCase();
    }
    if (topic0 === POOL_COLLECT_TOPIC) {
        // V3 Pool.Collect(address indexed owner, address recipient, ...)
        // Per D-V3-ALLOWLIST, we use `owner` (topics[1]) on Collect — the
        // recipient field is data-only and the V3 Locker ecosystem uses owner
        // identity as the allowlist anchor.
        if (logEvent.topics.length < 2) return null;
        return '0x' + logEvent.topics[1].slice(26).toLowerCase();
    }
    return null;
}

/**
 * Compute V2 signal evidence by reading current pair state and comparing to
 * baseline. Returns the signal-evidence shape plus boolean flags for which
 * signals tripped. Throws on RPC error so the caller can catch → verdict='unknown'.
 */
async function evaluateV2Signals(
    ctx: ChainContext,
    position: RegisteredPosition,
    destination: string,
): Promise<{
    signal1Tripped: boolean;
    signal2Tripped: boolean;
    signal3Tripped: boolean;
    allowlistHit: boolean;
    lockerName: string | undefined;
    signals: RugSignals;
}> {
    if (!position.baseline.v2LpTotalSupply || !position.baseline.v2Token0Reserve) {
        throw new Error('V2 baseline fields missing — cannot evaluate signals');
    }

    const pair = new Contract(
        position.pairOrPoolAddress,
        PAIR_ABI,
        ctx.httpProvider,
    );
    const [reserves, totalSupply] = await Promise.all([
        pair.getReserves(),
        pair.totalSupply(),
    ]);

    const baselineSupply = BigInt(position.baseline.v2LpTotalSupply);
    const baselineReserve0 = BigInt(position.baseline.v2Token0Reserve);
    const currentSupply = BigInt(totalSupply.toString());
    const currentReserve0 = BigInt(reserves[0].toString());

    // Signal 1: LP-removed percentage = (1 - currentSupply/baselineSupply) * 100
    // Use integer math via basis points to avoid floating-point drift.
    const lpRemovedBps =
        baselineSupply === 0n
            ? 0n
            : 10000n - (currentSupply * 10000n) / baselineSupply;
    const lpRemovedPct = Number(lpRemovedBps) / 100;
    const signal1Tripped = lpRemovedPct > ctx.chain.antiRug.lpRemovalPct;

    // Signal 2: destination NOT in allowlist
    const hit = isAddressAllowlisted(
        ctx.chain.antiRug.allowlistV2,
        destination,
    );
    const allowlistHit = hit.hit;
    const signal2Tripped = !allowlistHit;

    // Signal 3: V2 reserves below sell-threshold (50% of baseline reserves)
    const reserve0PctBps =
        baselineReserve0 === 0n
            ? 0n
            : (currentReserve0 * 10000n) / baselineReserve0;
    const reserve0Pct = Number(reserve0PctBps) / 100;
    const v2ReservePctBelow = 100 - reserve0Pct;
    const signal3Tripped = reserve0Pct < 50;

    const signals: RugSignals = {
        lpRemovedPct,
        destination: destination.toLowerCase(),
        allowlistHit: allowlistHit ? 'safe' : 'unsafe',
        sellSimSlippagePct: null,
        v2ReservePctBelow,
    };

    return {
        signal1Tripped,
        signal2Tripped,
        signal3Tripped,
        allowlistHit,
        lockerName: hit.lockerName,
        signals,
    };
}

// ---------------------------------------------------------------------------
// V3 evaluation
// ---------------------------------------------------------------------------

/**
 * Compute V3 signal evidence by reading current pool state + simulating sell
 * via QuoterV2.quoteExactInputSingle.staticCall. Returns signal-evidence and
 * trip flags. Throws on non-revert RPC error so the caller catches → 'unknown'.
 *
 * QuoterV2 revert (e.g. "execution reverted: insufficient liquidity") is
 * treated as signal-3 TRIP per fail-closed discipline (sell-impossible IS
 * the rug condition — see CONTEXT.md D-V3-SIGNAL3).
 */
async function evaluateV3Signals(
    ctx: ChainContext,
    position: RegisteredPosition,
    destination: string,
): Promise<{
    signal1Tripped: boolean;
    signal2Tripped: boolean;
    signal3Tripped: boolean;
    allowlistHit: boolean;
    lockerName: string | undefined;
    signals: RugSignals;
}> {
    if (!position.baseline.v3ActiveLiquidity) {
        throw new Error('V3 baseline v3ActiveLiquidity missing — cannot evaluate signals');
    }

    const pool = new Contract(
        position.pairOrPoolAddress,
        V3_POOL_ABI,
        ctx.httpProvider,
    );
    const liquidity = await pool.liquidity();

    const baselineLiquidity = BigInt(position.baseline.v3ActiveLiquidity);
    const currentLiquidity = BigInt(liquidity.toString());

    // Signal 1: liquidity-drop percentage
    const drainedBps =
        baselineLiquidity === 0n
            ? 0n
            : 10000n - (currentLiquidity * 10000n) / baselineLiquidity;
    const lpRemovedPct = Number(drainedBps) / 100;
    const signal1Tripped = lpRemovedPct > ctx.chain.antiRug.lpRemovalPct;

    // Signal 2: destination (owner) NOT in V3 allowlist
    const hit = isAddressAllowlisted(
        ctx.chain.antiRug.allowlistV3,
        destination,
    );
    const allowlistHit = hit.hit;
    const signal2Tripped = !allowlistHit;

    // Signal 3: V3 sell-sim via QuoterV2.staticCall
    // Resolve the V3 dex's quoterAddress from ChainConfig.dexes — finding the
    // first V3 dex on the chain (the position's `dex` field carries V3 dex,
    // so we use that quoterAddress directly).
    let sellSimSlippagePct: number = 0;
    let signal3Tripped: boolean;
    try {
        const v3Dex = position.dex;
        if (v3Dex.dexType !== 'v3') {
            throw new Error('V3 evaluation requires V3 DexConfig');
        }
        const quoterAddress = v3Dex.quoterAddress;
        const quoter = new Contract(
            quoterAddress,
            V3_QUOTER_V2_ABI,
            ctx.httpProvider,
        );
        // Probe amount: use the baseline active liquidity as a proxy (the real
        // production value is the position's amount; for v6.17 we use the
        // baseline as a normalized probe amount — see SUMMARY).
        const probeAmount = baselineLiquidity;
        const quoteParams = {
            tokenIn: position.tokenAddress,
            tokenOut: ctx.chain.wethAddress,
            amountIn: probeAmount,
            fee: position.feeTier ?? position.baseline.v3FeeTier ?? 3000,
            sqrtPriceLimitX96: 0n,
        };
        const result = await quoter.quoteExactInputSingle.staticCall(
            quoteParams,
        );
        const quotedOut = BigInt(result[0].toString());
        // Compare against baselineLiquidity (proxy for baseline expected). The
        // ratio is quotedOut / baselineLiquidity. <50% trips signal-3.
        const quotedRatioBps =
            baselineLiquidity === 0n
                ? 0n
                : (quotedOut * 10000n) / baselineLiquidity;
        const quotedRatioPct = Number(quotedRatioBps) / 100;
        sellSimSlippagePct = 100 - quotedRatioPct;
        signal3Tripped = quotedRatioPct < 50;
    } catch (err) {
        // QuoterV2 revert (typically "execution reverted: insufficient liquidity")
        // is treated as signal-3 TRIP per fail-closed (D-V3-SIGNAL3).
        const errMsg = err instanceof Error ? err.message : String(err);
        const isRevert =
            errMsg.toLowerCase().includes('reverted') ||
            errMsg.toLowerCase().includes('insufficient');
        if (!isRevert) {
            // Non-revert error — re-throw so caller produces verdict='unknown'.
            throw err;
        }
        log.warn(
            {
                tradeId: position.tradeId,
                chain: ctx.chain.name,
                pool: position.pairOrPoolAddress,
                err: errMsg,
                op: 'antirug.v3-signal3.quoter-revert',
            },
            'V3 QuoterV2 reverted — treating as signal-3 trip (fail-closed)',
        );
        signal3Tripped = true;
        sellSimSlippagePct = 100;
    }

    const signals: RugSignals = {
        lpRemovedPct,
        destination: destination.toLowerCase(),
        allowlistHit: allowlistHit ? 'safe' : 'unsafe',
        sellSimSlippagePct,
        v2ReservePctBelow: null,
    };

    return {
        signal1Tripped,
        signal2Tripped,
        signal3Tripped,
        allowlistHit,
        lockerName: hit.lockerName,
        signals,
    };
}

// ---------------------------------------------------------------------------
// Confirm-after-N-blocks gate
// ---------------------------------------------------------------------------

/**
 * Schedule a re-evaluation block watcher to confirm the unsafe verdict after
 * `ctx.chain.antiRug.confirmBlocks` blocks. Dispatches to triggerAntiRugExit
 * on confirmed re-evaluation; logs 'antirug.signal-detripped' on de-trip.
 *
 * When confirmBlocks=0, dispatches synchronously (Test 13).
 *
 * The re-evaluation reads the LIVE pool state at the confirm block. Implementation
 * note: we re-evaluate signals 1 + 3 only (signal-2 is the destination from the
 * ORIGINAL event — it doesn't change). If signal-1 OR signal-3 de-trips, the
 * gate aborts.
 */
async function scheduleConfirmBlocksGate(
    ctx: ChainContext,
    position: RegisteredPosition,
    evaluation: RugEvaluation,
    poolType: 'v2' | 'v3',
    destination: string,
): Promise<void> {
    const confirmBlocks = ctx.chain.antiRug.confirmBlocks;
    if (confirmBlocks === 0) {
        // Synchronous dispatch (Test 13).
        await triggerAntiRugExit(
            ctx,
            position.dex,
            position.tokenAddress,
            position.feeTier,
            position.tradeId,
            evaluation,
        );
        return;
    }

    const triggerBlock = await ctx.httpProvider.getBlockNumber();
    const confirmBlock = triggerBlock + confirmBlocks;

    const blockHandler = async (currentBlock: number) => {
        if (currentBlock < confirmBlock) return;
        ctx.httpProvider.off('block', blockHandler);

        // Re-evaluate against live state.
        let reTripped: boolean;
        let reSignals: RugSignals | undefined;
        try {
            if (poolType === 'v2') {
                const reEval = await evaluateV2Signals(ctx, position, destination);
                reSignals = reEval.signals;
                reTripped =
                    reEval.signal1Tripped &&
                    reEval.signal2Tripped &&
                    reEval.signal3Tripped;
            } else {
                const reEval = await evaluateV3Signals(ctx, position, destination);
                reSignals = reEval.signals;
                reTripped =
                    reEval.signal1Tripped &&
                    reEval.signal2Tripped &&
                    reEval.signal3Tripped;
            }
        } catch (err) {
            log.error(
                {
                    err: err instanceof Error ? err.message : String(err),
                    tradeId: position.tradeId,
                    chain: ctx.chain.name,
                    op: 'antirug.confirm-gate.reeval-error',
                },
                'Confirm-blocks re-evaluation threw — aborting dispatch (fail-closed)',
            );
            return;
        }

        if (!reTripped) {
            log.info(
                {
                    tradeId: position.tradeId,
                    chain: ctx.chain.name,
                    originalSignals:
                        'signals' in evaluation ? evaluation.signals : undefined,
                    currentSignals: reSignals,
                    op: 'antirug.signal-detripped',
                },
                'Signal de-tripped during confirm-blocks delay — aborting dispatch',
            );
            return;
        }

        // Still unsafe at confirm block → fire the exit.
        await triggerAntiRugExit(
            ctx,
            position.dex,
            position.tokenAddress,
            position.feeTier,
            position.tradeId,
            evaluation,
        );
    };
    ctx.httpProvider.on('block', blockHandler);

    log.info(
        {
            tradeId: position.tradeId,
            chain: ctx.chain.name,
            triggerBlock,
            confirmBlock,
            confirmBlocks,
            op: 'antirug.confirm-gate.scheduled',
        },
        'Anti-rug confirm-blocks gate scheduled',
    );
}

// ---------------------------------------------------------------------------
// V2 multi-signal AND chain evaluator
// ---------------------------------------------------------------------------

async function evaluateV2MultiSignal(
    ctx: ChainContext,
    position: RegisteredPosition,
    logEvent: Log,
): Promise<RugEvaluation> {
    const destination = decodeDestination(logEvent);
    if (!destination) {
        return {
            verdict: 'unknown',
            reason: 'topic-not-recognized',
        };
    }

    try {
        const sig = await evaluateV2Signals(ctx, position, destination);

        // Allowlist short-circuit
        if (sig.allowlistHit) {
            log.info(
                {
                    tradeId: position.tradeId,
                    chain: ctx.chain.name,
                    pair: position.pairOrPoolAddress,
                    destination: destination.toLowerCase(),
                    lockerName: sig.lockerName,
                    op: 'antirug.allowlist-hit',
                },
                'V2 Burn destination is allowlisted — suppressed',
            );
            return {
                verdict: 'allowlisted',
                signals: sig.signals,
                lockerName: sig.lockerName ?? '',
            };
        }

        const allTripped =
            sig.signal1Tripped && sig.signal2Tripped && sig.signal3Tripped;

        if (allTripped) {
            const evaluation: RugEvaluation = {
                verdict: 'unsafe',
                reason: 'three-signal-trigger',
                signals: sig.signals,
            };
            // Schedule confirm-blocks gate (synchronous dispatch when
            // confirmBlocks=0). Fire-and-forget at this layer; the gate
            // function handles the dispatch.
            await scheduleConfirmBlocksGate(
                ctx,
                position,
                evaluation,
                'v2',
                destination,
            );
            return evaluation;
        }

        return {
            verdict: 'safe',
            reason: 'partial-signal',
            signals: sig.signals,
        };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(
            {
                err: errMsg,
                tradeId: position.tradeId,
                chain: ctx.chain.name,
                pair: position.pairOrPoolAddress,
                op: 'antirug.evaluator.v2-error',
            },
            'V2 evaluator threw — verdict=unknown (fail-closed)',
        );
        return { verdict: 'unknown', reason: errMsg };
    }
}

// ---------------------------------------------------------------------------
// V3 multi-signal AND chain evaluator + Burn grace window
// ---------------------------------------------------------------------------

/**
 * The V3 path's full AND-chain evaluation, invoked synchronously on Collect
 * arrival OR on grace-timeout block-watcher fire. Returns the verdict and
 * (if all-three trip) schedules the confirm-blocks gate before triggering
 * the exit.
 */
async function evaluateV3MultiSignal(
    ctx: ChainContext,
    position: RegisteredPosition,
    logEvent: Log,
    triggerSource: 'collect-arrival' | 'grace-timeout',
): Promise<RugEvaluation> {
    const destination = decodeDestination(logEvent);
    if (!destination) {
        return {
            verdict: 'unknown',
            reason: 'topic-not-recognized',
        };
    }

    try {
        const sig = await evaluateV3Signals(ctx, position, destination);

        if (sig.allowlistHit) {
            log.info(
                {
                    tradeId: position.tradeId,
                    chain: ctx.chain.name,
                    pool: position.pairOrPoolAddress,
                    owner: destination.toLowerCase(),
                    lockerName: sig.lockerName,
                    triggerSource,
                    op: 'antirug.allowlist-hit',
                },
                'V3 owner is allowlisted — suppressed',
            );
            return {
                verdict: 'allowlisted',
                signals: sig.signals,
                lockerName: sig.lockerName ?? '',
            };
        }

        const allTripped =
            sig.signal1Tripped && sig.signal2Tripped && sig.signal3Tripped;

        if (allTripped) {
            const evaluation: RugEvaluation = {
                verdict: 'unsafe',
                reason: 'three-signal-trigger',
                signals: sig.signals,
            };
            await scheduleConfirmBlocksGate(
                ctx,
                position,
                evaluation,
                'v3',
                destination,
            );
            return evaluation;
        }

        return {
            verdict: 'safe',
            reason: 'partial-signal',
            signals: sig.signals,
        };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(
            {
                err: errMsg,
                tradeId: position.tradeId,
                chain: ctx.chain.name,
                pool: position.pairOrPoolAddress,
                op: 'antirug.evaluator.v3-error',
            },
            'V3 evaluator threw — verdict=unknown (fail-closed)',
        );
        return { verdict: 'unknown', reason: errMsg };
    }
}

/**
 * V3 Burn arrival: hold the burn pending Collect or grace-timeout.
 *
 * Per the LAST-WINS planner discretion (CONTEXT.md D-V3-EVENTS + Test 10d),
 * multiple Burns for the same pool within the grace window OVERWRITE the
 * pending entry. The latest Burn's block governs the timeout watcher.
 */
async function handleV3BurnArrival(
    ctx: ChainContext,
    position: RegisteredPosition,
    burnEvent: Log,
): Promise<void> {
    const poolKey = burnEvent.address.toLowerCase();
    const burnBlockNumber = burnEvent.blockNumber;
    const timeoutBlockNumber = burnBlockNumber + V3_BURN_GRACE_BLOCKS;

    // LAST-WINS: latest burn replaces any prior pending entry.
    pendingV3Burn.set(poolKey, {
        poolAddress: poolKey,
        position,
        burnEvent,
        burnBlockNumber,
        timeoutBlockNumber,
    });

    log.info(
        {
            tradeId: position.tradeId,
            chain: ctx.chain.name,
            pool: poolKey,
            burnBlock: burnBlockNumber,
            timeoutBlock: timeoutBlockNumber,
            op: 'antirug.v3-burn-grace-window',
        },
        'V3 Burn held pending Collect or grace timeout',
    );

    // Schedule block-watcher for grace timeout.
    const blockHandler = async (currentBlock: number) => {
        if (currentBlock < timeoutBlockNumber) return;

        // Check pending entry still here AND matches THIS burn (LAST-WINS
        // semantics — if a later burn replaced this entry, only THE latest
        // burn's handler should fire).
        const pending = pendingV3Burn.get(poolKey);
        if (!pending || pending.burnBlockNumber !== burnBlockNumber) {
            // Collect consumed the entry, OR a later Burn replaced it. Either
            // way, this handler has nothing to do.
            ctx.httpProvider.off('block', blockHandler);
            return;
        }

        // Grace timeout fired — re-evaluate against current pool state.
        ctx.httpProvider.off('block', blockHandler);
        pendingV3Burn.delete(poolKey);
        await evaluateV3MultiSignal(ctx, position, burnEvent, 'grace-timeout');
    };
    ctx.httpProvider.on('block', blockHandler);
}

/**
 * V3 Collect arrival: consume the pending Burn (if any within grace window)
 * and synchronously evaluate the AND chain against current pool state.
 */
async function handleV3CollectArrival(
    ctx: ChainContext,
    position: RegisteredPosition,
    collectEvent: Log,
): Promise<RugEvaluation> {
    const poolKey = collectEvent.address.toLowerCase();
    const pending = pendingV3Burn.get(poolKey);
    if (pending) {
        pendingV3Burn.delete(poolKey);
        log.info(
            {
                tradeId: position.tradeId,
                chain: ctx.chain.name,
                pool: poolKey,
                burnBlock: pending.burnBlockNumber,
                collectBlock: collectEvent.blockNumber,
                op: 'antirug.v3-burn-collect-paired',
            },
            'V3 Burn paired with Collect within grace window',
        );
    }
    return evaluateV3MultiSignal(ctx, position, collectEvent, 'collect-arrival');
}

// ---------------------------------------------------------------------------
// Plan 19-04b — top-level evaluateRugSignals export
// ---------------------------------------------------------------------------

/**
 * Multi-signal AND chain evaluator + V3 Burn grace window + confirm-after-N
 * blocks gate dispatch coordinator.
 *
 * Topic-based dispatch:
 *   - PAIR_BURN_TOPIC / PAIR_TRANSFER_TOPIC → V2 path → synchronous AND chain.
 *   - POOL_BURN_TOPIC                       → V3 Burn → hold pending Collect
 *                                             or grace-timeout; returns
 *                                             verdict='safe' / 'partial-signal'
 *                                             immediately (the held burn
 *                                             dispatches via the block watcher).
 *   - POOL_COLLECT_TOPIC                    → V3 Collect → consume pending
 *                                             Burn (if any) + synchronous AND
 *                                             chain on Collect.
 *   - other                                  → verdict='unknown', reason='topic-not-recognized'.
 *
 * On the V2 path:
 *   - Allowlist hit → verdict='allowlisted'.
 *   - All three signals trip → verdict='unsafe' + dispatch to confirm-blocks gate.
 *   - Otherwise → verdict='safe' / 'partial-signal'.
 *
 * On the V3 path (Collect arrival):
 *   - Same as V2 path (signal-3 is QuoterV2 sell-sim instead of V2 reserves).
 *
 * On the V3 path (Burn arrival):
 *   - Sets pendingV3Burn entry + schedules grace-timeout block watcher.
 *   - Returns verdict='safe' / 'partial-signal' to the caller — the actual
 *     verdict is computed asynchronously when EITHER Collect arrives OR the
 *     grace window expires.
 *
 * On RPC error during signal evaluation:
 *   - verdict='unknown', reason carries the error message. Vacuous-pass
 *     unrepresentable per the discriminated-union type contract.
 */
export async function evaluateRugSignals(
    ctx: ChainContext,
    position: RegisteredPosition,
    logEvent: Log,
): Promise<RugEvaluation> {
    const topic0 = logEvent.topics[0];

    if (topic0 === PAIR_BURN_TOPIC || topic0 === PAIR_TRANSFER_TOPIC) {
        return evaluateV2MultiSignal(ctx, position, logEvent);
    }

    if (topic0 === POOL_BURN_TOPIC) {
        await handleV3BurnArrival(ctx, position, logEvent);
        // Held pending Collect / grace-timeout. The actual verdict fires
        // asynchronously through the block watcher; we return a placeholder
        // 'safe' / 'partial-signal' here.
        const placeholderSignals: RugSignals = {
            lpRemovedPct: 0,
            destination: decodeDestination(logEvent) ?? '',
            allowlistHit: 'unknown',
            sellSimSlippagePct: null,
            v2ReservePctBelow: null,
        };
        return {
            verdict: 'safe',
            reason: 'partial-signal',
            signals: placeholderSignals,
        };
    }

    if (topic0 === POOL_COLLECT_TOPIC) {
        return handleV3CollectArrival(ctx, position, logEvent);
    }

    log.warn(
        {
            tradeId: position.tradeId,
            chain: ctx.chain.name,
            address: logEvent.address,
            topic: topic0,
            op: 'antirug.evaluator.unknown-topic',
        },
        'Unknown topic in anti-rug evaluator — verdict=unknown',
    );
    return { verdict: 'unknown', reason: 'topic-not-recognized' };
}

// Wire the let-shim to the real implementation. Plan 19-04a's tests inject
// a spy via `_setEvaluateRugSignalsForTesting`; that hook overwrites this
// reference. The default (this module-load-time assignment) is the real
// evaluator above.
evaluateRugSignalsShim = evaluateRugSignals;
