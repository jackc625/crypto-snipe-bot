// test/unit/anti-rug/exitTrigger.test.ts
// Phase 19 Plan 19-05 / Task 1b — src/anti-rug/exitTrigger.ts real bridge.
//
// Replaces Plan 19-04b's stub. triggerAntiRugExit now gates on
// ctx.chain.antiRug.liveExecute (dry-run) AND isCircuitBreakerTripped
// (per-chain CB), then on live execute path calls clearAllTimersForToken
// FIRST followed by executeFullSell with reason='anti-rug'. Increments
// the circuit breaker on BOTH success AND failure paths.
//
// Tests (8-13):
//
//   Test 8: liveExecute=false → log 'antirug.dry-run.would-have-sold',
//           sendCtxAlert with `*[DRY-RUN] Anti-rug ...*` prefix, return
//           false WITHOUT calling executeFullSell.
//   Test 9: liveExecute=true AND isCircuitBreakerTripped(chain) === true →
//           log 'antirug.cb-tripped.exit-suppressed', return false WITHOUT
//           calling executeFullSell.
//   Test 10: liveExecute=true AND CB not tripped → calls
//            clearAllTimersForToken(chain, token) FIRST, then
//            executeFullSell(ctx, dex, tokenAddress, feeTier, 'anti-rug',
//            tradeId, reasonDetail). reasonDetail formatted as
//            "LP removed {X}% by {address}; {Y}% sell-sim/reserves slippage".
//   Test 11: executeFullSell returns true → triggerAntiRugExit calls
//            incrementCircuitBreaker once.
//   Test 12: executeFullSell returns false → triggerAntiRugExit STILL calls
//            incrementCircuitBreaker (failed exit consumed a trigger slot).
//   Test 13: triggerAntiRugExit emits broadcast('antirug_state_update', ...)
//            with state='exit-fired' on live + 'would-have-sold' on dry-run.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const logFatal = vi.fn();
const logDebug = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: logInfo,
            warn: logWarn,
            error: logError,
            fatal: logFatal,
            debug: logDebug,
        }),
        info: logInfo,
        warn: logWarn,
        error: logError,
        fatal: logFatal,
        debug: logDebug,
    },
}));

const sendCtxAlertMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: sendCtxAlertMock,
}));

const broadcastMock = vi.fn();
vi.mock('../../../src/api/ws/broadcaster', () => ({
    broadcast: broadcastMock,
}));

const clearAllTimersForTokenMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    clearAllTimersForToken: clearAllTimersForTokenMock,
}));

const executeFullSellMock = vi.fn();
vi.mock('../../../src/exitEngine', () => ({
    executeFullSell: executeFullSellMock,
}));

const isCircuitBreakerTrippedMock = vi.fn();
const incrementCircuitBreakerMock = vi.fn();
vi.mock('../../../src/anti-rug/circuitBreaker', () => ({
    isCircuitBreakerTripped: isCircuitBreakerTrippedMock,
    incrementCircuitBreaker: incrementCircuitBreakerMock,
}));

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function buildCtx(opts: { liveExecute?: boolean; chain?: string; displayName?: string } = {}) {
    return {
        chain: {
            name: opts.chain ?? 'eth',
            displayName: opts.displayName ?? '[ETH]',
            antiRug: {
                liveExecute: opts.liveExecute ?? true,
                circuitBreakerTriggers: 3,
                circuitBreakerWindowHours: 1,
                gasMultiplier: 2.0,
            },
        },
    };
}

const V2_DEX = { dexType: 'v2' as const, name: 'uniswap-v2' };

function makeEvaluation(opts: { lpPct?: number; dest?: string; sellSimPct?: number | null; v2Pct?: number | null } = {}) {
    return {
        verdict: 'unsafe' as const,
        reason: 'three-signal-trigger' as const,
        signals: {
            lpRemovedPct: opts.lpPct ?? 80,
            destination: opts.dest ?? '0xdeadbeef00000000000000000000000000000000',
            allowlistHit: 'unsafe' as const,
            sellSimSlippagePct: opts.sellSimPct === undefined ? null : opts.sellSimPct,
            v2ReservePctBelow: opts.v2Pct === undefined ? 90 : opts.v2Pct,
        },
    };
}

beforeEach(() => {
    logInfo.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    logFatal.mockClear();
    logDebug.mockClear();
    sendCtxAlertMock.mockClear().mockResolvedValue(undefined);
    broadcastMock.mockClear();
    clearAllTimersForTokenMock.mockClear();
    executeFullSellMock.mockReset();
    isCircuitBreakerTrippedMock.mockReset();
    incrementCircuitBreakerMock.mockReset();
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 19 — triggerAntiRugExit bridge', () => {
    it("Test 8: liveExecute=false logs would-have-sold + sends [DRY-RUN] alert + returns false WITHOUT executeFullSell", async () => {
        const { triggerAntiRugExit } = await import('../../../src/anti-rug/exitTrigger');

        const ctx = buildCtx({ liveExecute: false });
        const result = await triggerAntiRugExit(
            ctx as Parameters<typeof triggerAntiRugExit>[0],
            V2_DEX as Parameters<typeof triggerAntiRugExit>[1],
            '0xToken00000000000000000000000000000000T01',
            null,
            42,
            makeEvaluation(),
        );

        expect(result).toBe(false);
        expect(executeFullSellMock).not.toHaveBeenCalled();

        // Structured log
        const dryRunLog = logInfo.mock.calls.find(c =>
            typeof c[0] === 'object' && (c[0] as Record<string, unknown>).op === 'antirug.dry-run.would-have-sold',
        ) || logWarn.mock.calls.find(c =>
            typeof c[0] === 'object' && (c[0] as Record<string, unknown>).op === 'antirug.dry-run.would-have-sold',
        );
        expect(dryRunLog).toBeTruthy();

        // [DRY-RUN] alert with the verbatim prefix per D-DRY-TELEMETRY
        expect(sendCtxAlertMock).toHaveBeenCalled();
        const alertMessage = sendCtxAlertMock.mock.calls[0][1] as string;
        expect(alertMessage).toMatch(/\[DRY-RUN\] Anti-rug/);
    });

    it("Test 9: liveExecute=true + CB tripped logs suppression + returns false WITHOUT executeFullSell", async () => {
        const { triggerAntiRugExit } = await import('../../../src/anti-rug/exitTrigger');

        isCircuitBreakerTrippedMock.mockReturnValue(true);
        const ctx = buildCtx({ liveExecute: true });
        const result = await triggerAntiRugExit(
            ctx as Parameters<typeof triggerAntiRugExit>[0],
            V2_DEX as Parameters<typeof triggerAntiRugExit>[1],
            '0xToken00000000000000000000000000000000T02',
            null,
            43,
            makeEvaluation(),
        );

        expect(result).toBe(false);
        expect(executeFullSellMock).not.toHaveBeenCalled();
        const cbSuppressLog = [...logFatal.mock.calls, ...logError.mock.calls, ...logWarn.mock.calls]
            .find(c => typeof c[0] === 'object' && (c[0] as Record<string, unknown>).op === 'antirug.cb-tripped.exit-suppressed');
        expect(cbSuppressLog).toBeTruthy();
    });

    it("Test 10: liveExecute=true + CB not tripped calls clearAllTimersForToken FIRST then executeFullSell with reasonDetail", async () => {
        const { triggerAntiRugExit } = await import('../../../src/anti-rug/exitTrigger');

        isCircuitBreakerTrippedMock.mockReturnValue(false);
        executeFullSellMock.mockResolvedValue(true);

        const ctx = buildCtx({ liveExecute: true });
        await triggerAntiRugExit(
            ctx as Parameters<typeof triggerAntiRugExit>[0],
            V2_DEX as Parameters<typeof triggerAntiRugExit>[1],
            '0xToken00000000000000000000000000000000T03',
            null,
            44,
            makeEvaluation({ lpPct: 75, dest: '0xbad', sellSimPct: null, v2Pct: 88 }),
        );

        // Order: clearAllTimersForToken THEN executeFullSell
        expect(clearAllTimersForTokenMock).toHaveBeenCalledWith('eth', '0xToken00000000000000000000000000000000T03');
        expect(executeFullSellMock).toHaveBeenCalled();
        const clearOrder = clearAllTimersForTokenMock.mock.invocationCallOrder[0];
        const execOrder = executeFullSellMock.mock.invocationCallOrder[0];
        expect(clearOrder).toBeLessThan(execOrder);

        // Bridge args
        const args = executeFullSellMock.mock.calls[0];
        expect(args[2]).toBe('0xToken00000000000000000000000000000000T03'); // tokenAddress
        expect(args[3]).toBe(null); // feeTier
        expect(args[4]).toBe('anti-rug'); // reason
        expect(args[5]).toBe(44); // tradeId
        const reasonDetail = args[6] as string;
        expect(reasonDetail).toContain('LP removed 75% by 0xbad');
        // Falls back to v2ReservePctBelow when sellSim is null
        expect(reasonDetail).toContain('88');
    });

    it('Test 11: executeFullSell success → incrementCircuitBreaker called', async () => {
        const { triggerAntiRugExit } = await import('../../../src/anti-rug/exitTrigger');

        isCircuitBreakerTrippedMock.mockReturnValue(false);
        executeFullSellMock.mockResolvedValue(true);

        const ctx = buildCtx({ liveExecute: true });
        const result = await triggerAntiRugExit(
            ctx as Parameters<typeof triggerAntiRugExit>[0],
            V2_DEX as Parameters<typeof triggerAntiRugExit>[1],
            '0xToken00000000000000000000000000000000T04',
            null,
            45,
            makeEvaluation(),
        );

        expect(result).toBe(true);
        expect(incrementCircuitBreakerMock).toHaveBeenCalledTimes(1);
    });

    it('Test 12: executeFullSell failure → incrementCircuitBreaker STILL called', async () => {
        const { triggerAntiRugExit } = await import('../../../src/anti-rug/exitTrigger');

        isCircuitBreakerTrippedMock.mockReturnValue(false);
        executeFullSellMock.mockResolvedValue(false); // failure

        const ctx = buildCtx({ liveExecute: true });
        const result = await triggerAntiRugExit(
            ctx as Parameters<typeof triggerAntiRugExit>[0],
            V2_DEX as Parameters<typeof triggerAntiRugExit>[1],
            '0xToken00000000000000000000000000000000T05',
            null,
            46,
            makeEvaluation(),
        );

        expect(result).toBe(false);
        expect(incrementCircuitBreakerMock).toHaveBeenCalledTimes(1);
    });

    it("Test 13: emits broadcast('antirug_state_update', ...) with state='exit-fired' live / 'would-have-sold' dry-run", async () => {
        const { triggerAntiRugExit } = await import('../../../src/anti-rug/exitTrigger');

        // Dry-run path
        const ctxDry = buildCtx({ liveExecute: false });
        await triggerAntiRugExit(
            ctxDry as Parameters<typeof triggerAntiRugExit>[0],
            V2_DEX as Parameters<typeof triggerAntiRugExit>[1],
            '0xTok06',
            null,
            106,
            makeEvaluation(),
        );
        const dryBroadcast = broadcastMock.mock.calls.find(c =>
            c[0] === 'antirug_state_update' && (c[1] as Record<string, unknown>).state === 'would-have-sold',
        );
        expect(dryBroadcast).toBeTruthy();

        broadcastMock.mockClear();

        // Live path
        isCircuitBreakerTrippedMock.mockReturnValue(false);
        executeFullSellMock.mockResolvedValue(true);
        const ctxLive = buildCtx({ liveExecute: true });
        await triggerAntiRugExit(
            ctxLive as Parameters<typeof triggerAntiRugExit>[0],
            V2_DEX as Parameters<typeof triggerAntiRugExit>[1],
            '0xTok07',
            null,
            107,
            makeEvaluation(),
        );
        const liveBroadcast = broadcastMock.mock.calls.find(c =>
            c[0] === 'antirug_state_update' && (c[1] as Record<string, unknown>).state === 'exit-fired',
        );
        expect(liveBroadcast).toBeTruthy();
    });
});
