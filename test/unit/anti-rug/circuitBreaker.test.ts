// test/unit/anti-rug/circuitBreaker.test.ts
// Phase 19 Plan 19-05 / Task 1a — src/anti-rug/circuitBreaker.ts
//
// ANTIRUG-09: Per-chain circuit breaker. Auto-disable anti-rug for a chain
// after N triggers within a rolling window. Manual operator-reset via the
// dashboard.
//
// Tests (14-20):
//
//   Test 14: incrementCircuitBreaker adds the current timestamp to the per-
//            chain history; entries older than windowHours * 3600 * 1000 ms
//            are dropped first.
//   Test 14b (Warning 11): recentTriggerEvents per chain is bounded at
//            ctx.chain.antiRug.circuitBreakerTriggers entries (default 3);
//            after the 4th increment, the OLDEST TriggerEvent is evicted;
//            getRecentTriggers(chain) returns at most circuitBreakerTriggers
//            entries.
//   Test 15: When history.length >= threshold AND chain not already tripped,
//            mark tripped, log fatal, broadcast 'cb_tripped' with last N
//            triggers, sendCtxAlert with `*[ANTI-RUG HALTED]*` prefix.
//   Test 16: When history.length < threshold, do NOT mark tripped, do NOT
//            broadcast 'cb_tripped'.
//   Test 17: isCircuitBreakerTripped(chain) returns true after tripping;
//            returns false after reset.
//   Test 18: resetCircuitBreaker(ctx) clears the per-chain history + tripped
//            state + broadcasts 'cb_reset' + logs op: 'antirug.cb-reset'.
//   Test 19: Tripped state is per-chain isolated — tripping ETH does not
//            affect BSC.
//   Test 20: Rolling-window — 3 triggers in 1h trips; 3 triggers spread over
//            2h does NOT trip.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function buildCtx(opts: {
    chain?: string;
    displayName?: string;
    triggers?: number;
    windowHours?: number;
} = {}) {
    return {
        chain: {
            name: opts.chain ?? 'eth',
            displayName: opts.displayName ?? '[ETH]',
            antiRug: {
                circuitBreakerTriggers: opts.triggers ?? 3,
                circuitBreakerWindowHours: opts.windowHours ?? 1,
            },
        },
    };
}

function makeTriggerEvent(token = '0xdead', pair = '0xpair', chain = 'eth') {
    return {
        token,
        pair,
        signals: {
            lpRemovedPct: 80,
            destination: '0xdeadbeef',
            allowlistHit: 'unsafe' as const,
            sellSimSlippagePct: null,
            v2ReservePctBelow: 90,
        },
        outcome: 'exit-fired-success',
        timestamp: Date.now(),
        chain,
    };
}

beforeEach(() => {
    logInfo.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    logFatal.mockClear();
    logDebug.mockClear();
    // mockReset (per vitest.config.ts) wipes the resolved value — restore it.
    sendCtxAlertMock.mockClear().mockResolvedValue(undefined);
    broadcastMock.mockClear();
    vi.useFakeTimers();
});

afterEach(async () => {
    vi.useRealTimers();
    const mod = await import('../../../src/anti-rug/circuitBreaker');
    if (typeof (mod as { _resetForTesting?: () => void })._resetForTesting === 'function') {
        (mod as unknown as { _resetForTesting: () => void })._resetForTesting();
    }
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 19 — Circuit breaker', () => {
    it('Test 14: incrementCircuitBreaker drops timestamps older than window before counting', async () => {
        const { incrementCircuitBreaker, isCircuitBreakerTripped } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ctx = buildCtx({ triggers: 3, windowHours: 1 });

        // T=0: add one trigger (window is 1 hour = 3,600,000ms)
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());

        // T=2h: add another trigger — the first should have been dropped
        // because it is older than the 1-hour window.
        vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());

        // T=2:30: add a third trigger
        vi.setSystemTime(new Date('2026-01-01T02:30:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());

        // CB should NOT be tripped because at T=2:30 only 2 triggers are
        // inside the 1-hour window (the T=0 one was dropped).
        expect(isCircuitBreakerTripped('eth')).toBe(false);
    });

    it('Test 14b: recentTriggerEvents ring buffer bounded at circuitBreakerTriggers entries (Warning 11)', async () => {
        const { incrementCircuitBreaker, getRecentTriggers } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ctx = buildCtx({ triggers: 3, windowHours: 1 });

        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xtok1'));
        vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xtok2'));
        vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xtok3'));
        // Fourth trigger — oldest (0xtok1) should be evicted from the ring buffer.
        vi.setSystemTime(new Date('2026-01-01T00:15:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xtok4'));

        const recent = getRecentTriggers('eth');
        expect(recent).toHaveLength(3);
        const tokens = recent.map(t => t.token);
        expect(tokens).not.toContain('0xtok1');
        expect(tokens).toContain('0xtok2');
        expect(tokens).toContain('0xtok3');
        expect(tokens).toContain('0xtok4');
    });

    it('Test 15: when threshold reached, mark tripped + broadcast cb_tripped + sendCtxAlert HALTED', async () => {
        const { incrementCircuitBreaker, isCircuitBreakerTripped } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ctx = buildCtx({ triggers: 3, windowHours: 1 });

        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xtok1'));
        vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xtok2'));
        vi.setSystemTime(new Date('2026-01-01T00:02:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xtok3'));

        expect(isCircuitBreakerTripped('eth')).toBe(true);
        expect(logFatal).toHaveBeenCalled();
        expect(broadcastMock).toHaveBeenCalledWith('cb_tripped', expect.objectContaining({ chain: 'eth' }));
        // Verify the broadcast payload includes triggers count + windowHours
        const cbTrippedCall = broadcastMock.mock.calls.find(c => c[0] === 'cb_tripped');
        expect(cbTrippedCall).toBeTruthy();
        const payload = cbTrippedCall![1] as Record<string, unknown>;
        expect(payload.triggers).toBe(3);
        expect(payload.windowHours).toBe(1);

        expect(sendCtxAlertMock).toHaveBeenCalled();
        const alertMessage = sendCtxAlertMock.mock.calls[0][1] as string;
        expect(alertMessage).toContain('[ANTI-RUG HALTED]');
    });

    it('Test 16: when history.length < threshold, do NOT trip + do NOT broadcast cb_tripped', async () => {
        const { incrementCircuitBreaker, isCircuitBreakerTripped } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ctx = buildCtx({ triggers: 3, windowHours: 1 });

        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());
        // Two only — below threshold of 3.

        expect(isCircuitBreakerTripped('eth')).toBe(false);
        expect(broadcastMock).not.toHaveBeenCalledWith('cb_tripped', expect.anything());
    });

    it('Test 17: isCircuitBreakerTripped returns true after trip, false after reset', async () => {
        const { incrementCircuitBreaker, isCircuitBreakerTripped, resetCircuitBreaker } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ctx = buildCtx({ triggers: 2, windowHours: 1 });
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());

        expect(isCircuitBreakerTripped('eth')).toBe(true);

        resetCircuitBreaker(ctx as Parameters<typeof resetCircuitBreaker>[0]);
        expect(isCircuitBreakerTripped('eth')).toBe(false);
    });

    it("Test 18: resetCircuitBreaker clears history + tripped + broadcasts cb_reset + logs op='antirug.cb-reset'", async () => {
        const { incrementCircuitBreaker, resetCircuitBreaker, getRecentTriggers } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ctx = buildCtx({ triggers: 2, windowHours: 1 });
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xt1'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xt2'));
        expect(getRecentTriggers('eth')).toHaveLength(2);

        broadcastMock.mockClear();
        logInfo.mockClear();

        resetCircuitBreaker(ctx as Parameters<typeof resetCircuitBreaker>[0]);

        expect(getRecentTriggers('eth')).toHaveLength(0);
        expect(broadcastMock).toHaveBeenCalledWith('cb_reset', expect.objectContaining({ chain: 'eth' }));
        const resetLog = logInfo.mock.calls.find(c =>
            typeof c[0] === 'object' && (c[0] as Record<string, unknown>).op === 'antirug.cb-reset',
        );
        expect(resetLog).toBeTruthy();
    });

    it('Test 19: per-chain isolation — tripping ETH does not affect BSC', async () => {
        const { incrementCircuitBreaker, isCircuitBreakerTripped } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ethCtx = buildCtx({ chain: 'eth', triggers: 2, windowHours: 1 });
        const bscCtx = buildCtx({ chain: 'bsc', triggers: 2, windowHours: 1 });

        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ethCtx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xe1', '0xp1', 'eth'));
        incrementCircuitBreaker(ethCtx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xe2', '0xp2', 'eth'));

        expect(isCircuitBreakerTripped('eth')).toBe(true);
        expect(isCircuitBreakerTripped('bsc')).toBe(false);

        // BSC adds one trigger — still below its own threshold
        incrementCircuitBreaker(bscCtx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent('0xb1', '0xpb1', 'bsc'));
        expect(isCircuitBreakerTripped('bsc')).toBe(false);
    });

    it('Test 20: rolling-window — 3 in 1h trips; 3 spread over 2h does NOT trip', async () => {
        const { incrementCircuitBreaker, isCircuitBreakerTripped } =
            await import('../../../src/anti-rug/circuitBreaker');

        const ctx = buildCtx({ triggers: 3, windowHours: 1 });

        // Trigger 3 events spread over 2 hours — none within the same 1h window.
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());
        vi.setSystemTime(new Date('2026-01-01T01:05:00Z')); // > 1h after first
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());
        vi.setSystemTime(new Date('2026-01-01T02:15:00Z')); // > 1h after second
        incrementCircuitBreaker(ctx as Parameters<typeof incrementCircuitBreaker>[0], makeTriggerEvent());

        // Each new trigger evicts the older one outside the rolling window.
        expect(isCircuitBreakerTripped('eth')).toBe(false);
    });
});
