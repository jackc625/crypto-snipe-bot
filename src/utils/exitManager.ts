import { Contract } from "ethers";
import { closeDb } from "./db";
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
        timerRegistry.delete(key);
    }
}

// ── Shutdown handler ─────────────────────────────────────────────────
// On SIGTERM/SIGINT: clear all timers, remove factory listeners,
// close database, exit cleanly. Safety net forces exit after 5s.

let isShuttingDown = false;

export function isShutdownInProgress(): boolean {
    return isShuttingDown;
}

/**
 * Legacy single-chain shutdown handler.
 * Clears timers, removes factory listeners, closes DB, exits.
 */
export function initShutdownHandler(factory: Contract): void {
    isShuttingDown = false;

    function gracefulShutdown(signal: string): void {
        if (isShuttingDown) return;
        isShuttingDown = true;

        log.info({ signal }, 'Shutdown signal received, cleaning up');

        clearAllTimers();
        factory.removeAllListeners();
        closeDb();

        log.info('Shutdown cleanup complete, exiting');
        process.exit(0);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Safety net: force exit after 5 seconds if graceful shutdown hangs
    process.on('SIGTERM', () => {
        setTimeout(() => {
            log.error('Force exit after 5s timeout');
            process.exit(1);
        }, 5000).unref();
    });

    process.on('SIGINT', () => {
        setTimeout(() => {
            log.error('Force exit after 5s timeout');
            process.exit(1);
        }, 5000).unref();
    });
}

/**
 * Multi-chain shutdown handler.
 * Accepts a cleanup callback that handles all chain-specific teardown.
 */
export function initMultiChainShutdownHandler(cleanup: () => void): void {
    isShuttingDown = false;

    function gracefulShutdown(signal: string): void {
        if (isShuttingDown) return;
        isShuttingDown = true;
        log.info({ signal }, 'Shutdown signal received');
        clearAllTimers();
        cleanup();
        closeDb();
        log.info('Shutdown complete');
        process.exit(0);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    // Safety net
    process.on('SIGTERM', () => { setTimeout(() => { log.error('Force exit'); process.exit(1); }, 5000).unref(); });
    process.on('SIGINT', () => { setTimeout(() => { log.error('Force exit'); process.exit(1); }, 5000).unref(); });
}
