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

