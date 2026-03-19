import { Contract } from "ethers";
import { flushState } from "./storage";

// ── Per-token selling mutex ──────────────────────────────────────────
// JavaScript is single-threaded. The "race" occurs when two async interval
// callbacks both evaluate their sell condition as true in rapid succession.
// The check-and-set on the Map is synchronous and atomic within a single
// event loop tick.

const sellingTokens = new Map<string, boolean>();

export function tryAcquireSellLock(tokenAddress: string): boolean {
    const key = tokenAddress.toLowerCase();
    if (sellingTokens.get(key)) return false;
    sellingTokens.set(key, true);
    return true;
}

export function releaseSellLock(tokenAddress: string): void {
    sellingTokens.delete(tokenAddress.toLowerCase());
}

// ── Timer registry ───────────────────────────────────────────────────
// Tracks all active setInterval/setTimeout handles keyed by token address.
// When any exit mechanism fires (stop-loss, take-profit, timed sell),
// clearAllTimersForToken() cancels the others to prevent double-sells.

interface TokenTimers {
    stopLossInterval?: ReturnType<typeof setInterval>;
    takeProfitInterval?: ReturnType<typeof setInterval>;
    timedSellTimeout?: ReturnType<typeof setTimeout>;
}

const timerRegistry = new Map<string, TokenTimers>();

export function registerStopLoss(token: string, interval: ReturnType<typeof setInterval>): void {
    const key = token.toLowerCase();
    const entry = timerRegistry.get(key) || {};
    entry.stopLossInterval = interval;
    timerRegistry.set(key, entry);
}

export function registerTakeProfit(token: string, interval: ReturnType<typeof setInterval>): void {
    const key = token.toLowerCase();
    const entry = timerRegistry.get(key) || {};
    entry.takeProfitInterval = interval;
    timerRegistry.set(key, entry);
}

export function registerTimedSell(token: string, timeout: ReturnType<typeof setTimeout>): void {
    const key = token.toLowerCase();
    const entry = timerRegistry.get(key) || {};
    entry.timedSellTimeout = timeout;
    timerRegistry.set(key, entry);
}

export function clearAllTimersForToken(token: string): void {
    const key = token.toLowerCase();
    const entry = timerRegistry.get(key);
    if (!entry) return;
    if (entry.stopLossInterval) clearInterval(entry.stopLossInterval);
    if (entry.takeProfitInterval) clearInterval(entry.takeProfitInterval);
    if (entry.timedSellTimeout) clearTimeout(entry.timedSellTimeout);
    timerRegistry.delete(key);
}

export function clearAllTimers(): void {
    const keys = Array.from(timerRegistry.keys());
    for (const token of keys) {
        clearAllTimersForToken(token);
    }
}

// ── Shutdown handler ─────────────────────────────────────────────────
// On SIGTERM/SIGINT: clear all timers, remove factory listeners,
// flush state to disk, exit cleanly. Safety net forces exit after 5s.

let isShuttingDown = false;

export function isShutdownInProgress(): boolean {
    return isShuttingDown;
}

export function initShutdownHandler(factory: Contract): void {
    isShuttingDown = false;

    function gracefulShutdown(signal: string): void {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.log(`[SHUTDOWN] Received ${signal}. Cleaning up...`);

        clearAllTimers();
        factory.removeAllListeners();
        flushState();

        console.log(`[SHUTDOWN] Cleanup complete. Exiting.`);
        process.exit(0);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Safety net: force exit after 5 seconds if graceful shutdown hangs
    process.on('SIGTERM', () => {
        setTimeout(() => {
            console.error('[SHUTDOWN] Force exit after 5s timeout');
            process.exit(1);
        }, 5000).unref();
    });

    process.on('SIGINT', () => {
        setTimeout(() => {
            console.error('[SHUTDOWN] Force exit after 5s timeout');
            process.exit(1);
        }, 5000).unref();
    });
}
