import { logger } from "./logger";

const log = logger.child({ module: 'exitManager' });

// ── Per-token selling mutex ──────────────────────────────────────────
// JavaScript is single-threaded. The "race" occurs when two async interval
// callbacks both evaluate their sell condition as true in rapid succession.
// The check-and-set on the Map is synchronous and atomic within a single
// event loop tick.
//
// Multi-chain: keys are "chain:tokenAddress" composites to prevent
// cross-chain collisions. Legacy single-arg overloads preserved.

const sellingTokens = new Map<string, boolean>();

export function tryAcquireSellLock(tokenAddress: string): boolean;
export function tryAcquireSellLock(chainName: string, tokenAddress: string): boolean;
export function tryAcquireSellLock(chainOrToken: string, tokenAddress?: string): boolean {
    const key = tokenAddress
        ? `${chainOrToken}:${tokenAddress.toLowerCase()}`
        : chainOrToken.toLowerCase();
    if (sellingTokens.get(key)) return false;
    sellingTokens.set(key, true);
    return true;
}

export function releaseSellLock(tokenAddress: string): void;
export function releaseSellLock(chainName: string, tokenAddress: string): void;
export function releaseSellLock(chainOrToken: string, tokenAddress?: string): void {
    const key = tokenAddress
        ? `${chainOrToken}:${tokenAddress.toLowerCase()}`
        : chainOrToken.toLowerCase();
    sellingTokens.delete(key);
}

// ── Per-position queued/in-flight lock (Phase 21.2 / Finding C) ──────────
// SIBLING of the sell-lock Map above, NOT a replacement. The sell-lock is
// acquired INSIDE executeFullSell for the brief window of a single submit; it
// is released the moment that submit settles. The serial ExitWorker, however,
// needs a lock that spans the ENTIRE lifetime a position is "owned" by the
// worker — from the instant a poll tick enqueues it, through the queue wait,
// through the (possibly multi-attempt) drain, until the sell fully settles.
// Without this wider lock the SAME position could be enqueued by a later poll
// tick while its first enqueue is still queued/in-flight → a re-entrant
// self-sell (double-spend class). Same single-threaded check-and-set atomicity
// reasoning as the sell-lock Map: the get/set on this Map is synchronous within
// one event-loop tick, so two concurrent poll ticks for the same position
// cannot both observe an unlocked state.
//
// Keyed identically ("chain:tokenAddress" composite, lowercased) so it lines up
// with the sell-lock / timer-registry / nonce-authority keying conventions.

const queuedPositions = new Map<string, boolean>();

function positionKey(chainName: string, tokenAddress: string): string {
    return `${chainName}:${tokenAddress.toLowerCase()}`;
}

/**
 * Acquire the per-position worker lock for {chain, token}. Returns true if the
 * caller now OWNS the position (it was free); false if it is already
 * queued/in-flight (the caller must skip — no re-entrant self-sell). The lock
 * is held across the whole enqueue→drain→settle lifetime and released via
 * {@link releasePositionQueue}.
 */
export function tryEnqueuePosition(chainName: string, tokenAddress: string): boolean {
    const key = positionKey(chainName, tokenAddress);
    if (queuedPositions.get(key)) return false;
    queuedPositions.set(key, true);
    return true;
}

/**
 * Release the per-position worker lock for {chain, token} after the sell
 * settles, so a future GENUINE re-trigger can enqueue the position again.
 */
export function releasePositionQueue(chainName: string, tokenAddress: string): void {
    queuedPositions.delete(positionKey(chainName, tokenAddress));
}

/**
 * Test-only: clear both the sell-lock and per-position-queue Maps so each test
 * starts from a clean state (underscore prefix signals test-only — mirrors
 * `_resetNonceChainsForTesting` in nonceAuthority.ts).
 */
export function _resetSellLocksForTesting(): void {
    sellingTokens.clear();
    queuedPositions.clear();
}

// ── Timer registry ───────────────────────────────────────────────────
// Tracks all active setInterval/setTimeout handles keyed by token address.
// Multi-chain: keys are "chain:tokenAddress" composites.
// When any exit mechanism fires (stop-loss, take-profit, timed sell),
// clearAllTimersForToken() cancels the others to prevent double-sells.

interface TokenTimers {
    stopLossInterval?: ReturnType<typeof setInterval>;
    takeProfitInterval?: ReturnType<typeof setInterval>;
    timedSellTimeout?: ReturnType<typeof setTimeout>;
    exitMonitorInterval?: ReturnType<typeof setInterval>;
}

const timerRegistry = new Map<string, TokenTimers>();

export function registerStopLoss(token: string, interval: ReturnType<typeof setInterval>): void;
export function registerStopLoss(chainName: string, token: string, interval: ReturnType<typeof setInterval>): void;
export function registerStopLoss(chainOrToken: string, tokenOrInterval: string | ReturnType<typeof setInterval>, interval?: ReturnType<typeof setInterval>): void {
    let key: string;
    let timerHandle: ReturnType<typeof setInterval>;
    if (interval !== undefined && typeof tokenOrInterval === 'string') {
        // Multi-chain overload: (chainName, token, interval)
        key = `${chainOrToken}:${tokenOrInterval.toLowerCase()}`;
        timerHandle = interval;
    } else {
        // Legacy overload: (token, interval)
        key = chainOrToken.toLowerCase();
        timerHandle = tokenOrInterval as ReturnType<typeof setInterval>;
    }
    const entry = timerRegistry.get(key) || {};
    entry.stopLossInterval = timerHandle;
    timerRegistry.set(key, entry);
}

export function registerTakeProfit(token: string, interval: ReturnType<typeof setInterval>): void;
export function registerTakeProfit(chainName: string, token: string, interval: ReturnType<typeof setInterval>): void;
export function registerTakeProfit(chainOrToken: string, tokenOrInterval: string | ReturnType<typeof setInterval>, interval?: ReturnType<typeof setInterval>): void {
    let key: string;
    let timerHandle: ReturnType<typeof setInterval>;
    if (interval !== undefined && typeof tokenOrInterval === 'string') {
        key = `${chainOrToken}:${tokenOrInterval.toLowerCase()}`;
        timerHandle = interval;
    } else {
        key = chainOrToken.toLowerCase();
        timerHandle = tokenOrInterval as ReturnType<typeof setInterval>;
    }
    const entry = timerRegistry.get(key) || {};
    entry.takeProfitInterval = timerHandle;
    timerRegistry.set(key, entry);
}

export function registerTimedSell(token: string, timeout: ReturnType<typeof setTimeout>): void;
export function registerTimedSell(chainName: string, token: string, timeout: ReturnType<typeof setTimeout>): void;
export function registerTimedSell(chainOrToken: string, tokenOrTimeout: string | ReturnType<typeof setTimeout>, timeout?: ReturnType<typeof setTimeout>): void {
    let key: string;
    let timerHandle: ReturnType<typeof setTimeout>;
    if (timeout !== undefined && typeof tokenOrTimeout === 'string') {
        key = `${chainOrToken}:${tokenOrTimeout.toLowerCase()}`;
        timerHandle = timeout;
    } else {
        key = chainOrToken.toLowerCase();
        timerHandle = tokenOrTimeout as ReturnType<typeof setTimeout>;
    }
    const entry = timerRegistry.get(key) || {};
    entry.timedSellTimeout = timerHandle;
    timerRegistry.set(key, entry);
}

// --- Phase 7: Unified exit monitor timer (single interval per position) ---

export function registerExitMonitor(
    chainName: string,
    tokenAddress: string,
    interval: ReturnType<typeof setInterval>
): void {
    const key = `${chainName}:${tokenAddress.toLowerCase()}`;
    // Clear any existing timers for this token first (safety: prevents leak)
    const existing = timerRegistry.get(key);
    if (existing) {
        if (existing.stopLossInterval) clearInterval(existing.stopLossInterval);
        if (existing.takeProfitInterval) clearInterval(existing.takeProfitInterval);
        if (existing.timedSellTimeout) clearTimeout(existing.timedSellTimeout);
        if (existing.exitMonitorInterval) clearInterval(existing.exitMonitorInterval);
    }
    timerRegistry.set(key, { exitMonitorInterval: interval });
}

/**
 * Phase 21.2 / Finding D (D-FAILED-EXIT-KEEP-MONITORING) — report whether a
 * routine exit-monitor poll interval is currently armed for {chain, token}.
 *
 * The anti-rug live-exit path calls {@link clearAllTimersForToken} BEFORE the
 * sell (exitTrigger.ts:222) to eliminate the poll-loop race. If that anti-rug
 * sell then FAILS on a STILL-HELD position, the balance-truth catch must RE-ARM
 * the routine poll timer (a still-held position must end with BOTH anti-rug
 * registered AND a poll timer armed). This predicate lets the catch re-arm ONLY
 * when the timer was actually cleared — it never double-arms a position whose
 * routine interval is still running (e.g. a failed trailing-stop, where the
 * interval was never cleared because routine triggers return 'continue').
 *
 * Keyed identically to the timer registry ("chain:token" composite, lowercased).
 */
export function hasExitMonitorTimer(chainName: string, tokenAddress: string): boolean {
    const key = `${chainName}:${tokenAddress.toLowerCase()}`;
    const entry = timerRegistry.get(key);
    return !!(entry && entry.exitMonitorInterval);
}

export function clearAllTimersForToken(token: string): void;
export function clearAllTimersForToken(chainName: string, token: string): void;
export function clearAllTimersForToken(chainOrToken: string, token?: string): void {
    const key = token
        ? `${chainOrToken}:${token.toLowerCase()}`
        : chainOrToken.toLowerCase();
    const entry = timerRegistry.get(key);
    if (!entry) return;
    if (entry.stopLossInterval) clearInterval(entry.stopLossInterval);
    if (entry.takeProfitInterval) clearInterval(entry.takeProfitInterval);
    if (entry.timedSellTimeout) clearTimeout(entry.timedSellTimeout);
    if (entry.exitMonitorInterval) clearInterval(entry.exitMonitorInterval);
    timerRegistry.delete(key);
}

export function clearAllTimers(): void {
    const keys = Array.from(timerRegistry.keys());
    for (const key of keys) {
        const entry = timerRegistry.get(key);
        if (!entry) continue;
        if (entry.stopLossInterval) clearInterval(entry.stopLossInterval);
        if (entry.takeProfitInterval) clearInterval(entry.takeProfitInterval);
        if (entry.timedSellTimeout) clearTimeout(entry.timedSellTimeout);
        if (entry.exitMonitorInterval) clearInterval(entry.exitMonitorInterval);
        timerRegistry.delete(key);
    }
}

