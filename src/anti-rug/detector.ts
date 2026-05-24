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

import type { Log, WebSocketProvider } from 'ethers';
import type { ChainContext, DexConfig } from '../chainRegistry';
import {
    PAIR_BURN_TOPIC,
    PAIR_TRANSFER_TOPIC,
    POOL_BURN_TOPIC,
    POOL_COLLECT_TOPIC,
} from './events';
import { loadLpBaseline } from './lpBaseline';
import type { LpBaselineRow } from './types';
import { logger } from '../utils/logger';

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

/**
 * Module-scoped shim for Plan 19-04b's `evaluateRugSignals`. Defaults to a
 * warn-only stub so the dispatcher routes events through SOMETHING during
 * Plan 19-04a. Plan 19-04b replaces this via re-assignment at module-import
 * time (or its unit test injects a spy via `_setEvaluateRugSignalsForTesting`).
 *
 * Signature mirrors the canonical Plan 19-04b export shape:
 *   `(ctx, position, logEvent) => Promise<unknown>`
 *
 * The `unknown` return is acceptable here because Plan 19-04a never reads
 * the evaluator's return value — dispatchEvent is fire-and-await only at
 * this stage. Plan 19-04b's tests assert against the real return shape
 * (`RugEvaluation` discriminated union) against the real evaluator.
 */
let evaluateRugSignals: (
    ctx: ChainContext,
    position: RegisteredPosition,
    logEvent: Log,
) => Promise<unknown> = async (_ctx, position, logEvent) => {
    log.warn(
        {
            tradeId: position.tradeId,
            chain: position.chain,
            pair: position.pairOrPoolAddress,
            address: logEvent.address,
            op: 'antirug.evaluator.stub',
        },
        'evaluateRugSignals stub fired — Plan 19-04b not yet loaded',
    );
};

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
    evaluateRugSignals = fn;
}

/**
 * Reset the registry + chainState maps to empty. Test-only — production
 * lifecycle never resets these (positions are registered/unregistered
 * incrementally per buy/sell).
 */
export function _resetRegistryForTesting(): void {
    positionRegistry.clear();
    chainState.clear();
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
            await evaluateRugSignals(ctx, position, logEvent);
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
