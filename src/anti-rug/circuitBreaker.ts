// src/anti-rug/circuitBreaker.ts
// Phase 19 / Plan 19-05 — ANTIRUG-09 circuit breaker.
//
// Per-chain rolling-window trigger counter + tripped state + manual operator
// reset. When N triggers fire within the configured window (default 3 in 1h),
// the chain's anti-rug exit dispatch is auto-disabled until the operator
// resets the breaker through the dashboard (Plan 19-06) or CLI.
//
// PUBLIC SURFACE:
//   - incrementCircuitBreaker(ctx, evt) — record a trigger; trips on threshold.
//   - isCircuitBreakerTripped(chainName) — gate read for src/anti-rug/exitTrigger.
//   - resetCircuitBreaker(ctx) — operator-initiated clear (dashboard + Telegram).
//   - getRecentTriggers(chainName) — read accessor (Plan 19-06's CB-reset modal).
//
// SIDE EFFECTS (per CONTEXT.md D-VIS-CB-TRIPPED):
//   - When the breaker trips, ONE structured pino fatal log + ONE broadcast
//     of `cb_tripped` to the dashboard hub + ONE Telegram alert prefixed
//     with `*[ANTI-RUG HALTED]*`. Subsequent triggers within the same trip
//     window are silently recorded but do NOT re-fire the side effects.
//   - When the breaker is reset, ONE structured pino info log + ONE broadcast
//     of `cb_reset`. No Telegram (the operator initiated the reset).
//
// DESIGN DECISIONS (per Warning 11 from plan-checker iteration 1):
//
//   1. The rolling-window timestamp history (`triggerHistory`) tracks ALL
//      triggers within the window for the threshold-check math. Entries older
//      than `windowHours * 3600 * 1000` ms are dropped at the start of every
//      `incrementCircuitBreaker` call before the threshold check runs.
//
//   2. The trigger-event ring buffer (`recentTriggerEvents`) holds at most
//      `ctx.chain.antiRug.circuitBreakerTriggers` entries per chain (default
//      3). Older entries are evicted on insert beyond the cap. This buffer
//      is consumed by Plan 19-06's CB-reset modal which renders N
//      acknowledge sections where N = `triggers.length`. The buffer size
//      MATCHES the trip threshold — the modal always shows exactly the
//      events that triggered the most recent state, never older ones.
//
//   3. Per-chain isolation: separate `triggerHistory` + `trippedChains` +
//      `recentTriggerEvents` keyed by `chain.name`. Tripping ETH does NOT
//      affect BSC and vice versa.
//
//   4. Single-firing trip-side-effects: the `trippedChains` Set check before
//      emitting the `cb_tripped` broadcast / Telegram / fatal log ensures
//      operators see ONE alert per trip-event, not one per subsequent
//      trigger inside the tripped window.
//
//   5. Errors in `sendCtxAlert` are swallowed (best-effort dashboard +
//      Telegram surface). The pino log line is the canonical audit-trail
//      record — if Telegram is down, the operator still sees the trip in
//      the structured logs.
//
// References:
//   - .planning/REQUIREMENTS.md ANTIRUG-09
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md
//       D-VIS-CB-TRIPPED, D-LIVE-PER-CHAIN
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/anti-rug/circuitBreaker.ts" (lines 412-465)
//   - src/utils/exitManager.ts:14-25 — per-chain Map-state analog

import type { ChainContext } from '../chainRegistry';
import type { TriggerEvent } from './types';
import { logger } from '../utils/logger';
import { sendCtxAlert } from '../utils/notifier';
import { broadcast } from '../api/ws/broadcaster';

const log = logger.child({ module: 'antiRug:cb' });

// ---------------------------------------------------------------------------
// Module-level state — per-chain
// ---------------------------------------------------------------------------

/** Trigger timestamps within the rolling window; used for threshold count. */
const triggerHistory = new Map<string, number[]>();

/** Chains currently in the tripped state. */
const trippedChains = new Set<string>();

/**
 * Ring buffer of recent TriggerEvent payloads per chain. Bounded by
 * `ctx.chain.antiRug.circuitBreakerTriggers` (default 3). Consumed by
 * Plan 19-06's CB-reset modal — see Warning 11 from plan-checker iter 1.
 */
const recentTriggerEvents = new Map<string, TriggerEvent[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a trigger event toward the per-chain rolling-window counter. Trips
 * the breaker and emits side effects (pino fatal + broadcast + Telegram)
 * when the threshold is reached and the chain is not already tripped.
 *
 * Called from src/anti-rug/exitTrigger.ts on BOTH success and failure paths
 * (a failed exit still consumed a trigger slot — see Test 12 in PLAN.md).
 *
 * @param ctx ChainContext (carries antiRug threshold + window config).
 * @param evt The TriggerEvent payload (added to the ring buffer for the
 *            CB-reset modal in Plan 19-06).
 */
export function incrementCircuitBreaker(
    ctx: ChainContext,
    evt: TriggerEvent,
): void {
    const chain = ctx.chain.name;
    const now = Date.now();
    const windowMs = ctx.chain.antiRug.circuitBreakerWindowHours * 3600 * 1000;
    const threshold = ctx.chain.antiRug.circuitBreakerTriggers;

    // 1. Update the rolling-window timestamp history — drop entries older
    //    than `windowMs`, then append the current timestamp.
    const history = triggerHistory.get(chain) ?? [];
    const recent = history.filter((t) => now - t < windowMs);
    recent.push(now);
    triggerHistory.set(chain, recent);

    // 2. Update the trigger-event ring buffer — append + evict oldest beyond
    //    the threshold-sized cap (Warning 11 invariant).
    const events = recentTriggerEvents.get(chain) ?? [];
    events.push(evt);
    while (events.length > threshold) {
        events.shift();
    }
    recentTriggerEvents.set(chain, events);

    // 3. Threshold check — trip ONCE per trip window.
    if (recent.length >= threshold && !trippedChains.has(chain)) {
        trippedChains.add(chain);

        log.fatal(
            {
                chain,
                triggers: recent.length,
                windowHours: ctx.chain.antiRug.circuitBreakerWindowHours,
                op: 'antirug.cb-tripped',
            },
            'Anti-rug circuit breaker tripped',
        );

        // CR-01: align producer payload with frontend `CbTrippedPayload`
        // type (dashboard/src/types/api.ts). Frontend declares
        // `triggers: TriggerEvent[]` (the array, consumed by
        // CircuitBreakerResetModal) and `triggerCount: number` (the
        // count, consumed by the banner headline). Previously the
        // backend sent `triggers: <number>` + `triggerEvents: [...]`,
        // which silently broke the manual CB-reset workflow.
        broadcast('cb_tripped', {
            chain,
            triggers: events.slice(),
            windowHours: ctx.chain.antiRug.circuitBreakerWindowHours,
            triggerCount: recent.length,
        });

        // Best-effort Telegram alert per D-VIS-CB-TRIPPED. Swallow errors so
        // the trip side effects can't cascade into our caller.
        sendCtxAlert(
            ctx,
            `*[ANTI-RUG HALTED]* ${ctx.chain.displayName} — ${recent.length} triggers in last ${ctx.chain.antiRug.circuitBreakerWindowHours}h`,
        ).catch((err: unknown) => {
            log.warn({ err, chain, op: 'antirug.cb-tripped.alert-failed' }, 'CB tripped alert failed');
        });
    }
}

/**
 * Returns true if the per-chain breaker is currently tripped. Gate read
 * called from src/anti-rug/exitTrigger.ts before bridging to executeFullSell.
 *
 * @param chainName Lowercased chain name (e.g. 'eth').
 */
export function isCircuitBreakerTripped(chainName: string): boolean {
    return trippedChains.has(chainName);
}

/**
 * Operator-initiated reset. Clears the per-chain history + tripped state +
 * ring buffer, then broadcasts `cb_reset` + emits a structured pino info
 * log. Plan 19-06's dashboard wires this via the CB-reset modal's confirm
 * flow.
 *
 * @param ctx ChainContext for the chain being reset.
 */
export function resetCircuitBreaker(ctx: ChainContext): void {
    const chain = ctx.chain.name;

    triggerHistory.delete(chain);
    trippedChains.delete(chain);
    recentTriggerEvents.delete(chain);

    log.info(
        {
            chain,
            op: 'antirug.cb-reset',
            resetByOperatorTs: Date.now(),
        },
        'Anti-rug circuit breaker reset',
    );

    broadcast('cb_reset', {
        chain,
        resetByOperatorTs: Date.now(),
    });
}

/**
 * Read accessor for the per-chain ring buffer. Consumed by Plan 19-06's
 * CB-reset modal which renders N acknowledge sections where N =
 * `triggers.length` from this buffer (per Warning 11 from plan-checker
 * iteration 1).
 *
 * @param chainName Lowercased chain name (e.g. 'eth').
 * @returns The current ring-buffer contents (empty array if no triggers
 *          recorded). Safe to mutate the returned array — it's a copy.
 */
export function getRecentTriggers(chainName: string): TriggerEvent[] {
    const events = recentTriggerEvents.get(chainName);
    return events ? events.slice() : [];
}

// ---------------------------------------------------------------------------
// Test hook (production callers MUST NOT import this)
// ---------------------------------------------------------------------------

/**
 * Clears ALL per-chain state. Used by vitest `afterEach` so per-chain state
 * does not bleed between tests. Underscore prefix signals test-only.
 */
export function _resetForTesting(): void {
    triggerHistory.clear();
    trippedChains.clear();
    recentTriggerEvents.clear();
}
