// test/unit/exitEngine/antiRugBounded.test.ts
// Phase 21.2 Plan 21.2-13 / Task 2 — WR-02 + WR-03 regression.
//
// WR-02: the anti-rug exit (anti-rug/exitTrigger.ts) calls executeFullSell
// DIRECTLY (not via the serial ExitWorker), so it NEVER passes through the
// worker's wall-clock watchdog. The MOST time-critical exit (an active rug)
// could therefore hang for minutes on a stalled bundle.wait()/RPC, parking the
// single Node event loop — the exact T-21.2-HANGSUBMIT symptom Finding B set out
// to bound. (The watchdog header claimed it bounds "EACH submit"; it bounded
// only WORKER submits.)
//
// WR-03: because anti-rug never enqueues, the priority-queue rank-0 pre-emption
// the worker header documented was DEAD in production — a comment-vs-code
// mismatch. Per D-QUALITY-FIRST we keep the DIRECT path for immediacy (a rug is
// happening NOW; routing it behind possibly-queued routine exits would delay it)
// but BOUND it with the same wall-clock budget, and CORRECT the worker-header /
// reasonRank comments so they no longer promise a queue pre-emption that does not
// happen.
//
// THE CARDINAL LESSON: this test exercises the REAL bounding path (the real
// withTimeout race against the budget) with FAKE TIMERS — it does NOT mock the
// bound. A submit that NEVER resolves must be FREED by the budget (the awaiting
// triggerAntiRugExit resolves to false), not hang forever. Against the PRE-FIX
// code (executeFullSell awaited with no bound) the promise never settles → the
// test's bounded wait times out (the RED proof).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mocks — the exitEngine.executeFullSell boundary (we control whether it hangs),
// plus the leaves of exitTrigger's import graph. We do NOT mock withTimeout (the
// bounding mechanism under test).
// -----------------------------------------------------------------------------

const executeFullSellMock = vi.fn();
vi.mock('../../../src/exitEngine', () => ({
    executeFullSell: executeFullSellMock,
}));

vi.mock('../../../src/utils/exitManager', () => ({
    clearAllTimersForToken: vi.fn(),
}));

// sendCtxAlert MUST return a promise (production calls `.catch(...)` on it).
const sendCtxAlertMock = vi.fn(() => Promise.resolve(undefined));
vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: sendCtxAlertMock }));
vi.mock('../../../src/api/ws/broadcaster', () => ({ broadcast: vi.fn() }));
vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() }) },
}));

const isCircuitBreakerTrippedMock = vi.fn().mockReturnValue(false);
const incrementCircuitBreakerMock = vi.fn();
vi.mock('../../../src/anti-rug/circuitBreaker', () => ({
    isCircuitBreakerTripped: isCircuitBreakerTrippedMock,
    incrementCircuitBreaker: incrementCircuitBreakerMock,
}));

let mod: typeof import('../../../src/anti-rug/exitTrigger');

const TOKEN = '0x12970E6868f88f6557B76120662c1B3E50A646bf';

function buildCtx() {
    return {
        chain: {
            name: 'eth',
            displayName: '[ETH]',
            antiRug: { liveExecute: true, gasMultiplier: 2.0 },
        },
        wallet: { address: '0x1111111111111111111111111111111111111111' },
        httpProvider: {},
        log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    };
}

const V2_DEX = { dexType: 'v2' as const, name: 'uniswap-v2', routerAddress: '0xrouter' };

const EVAL = {
    verdict: 'unsafe' as const,
    signals: {
        lpRemovedPct: 80,
        destination: '0xdead000000000000000000000000000000000000',
        allowlistHit: 'miss' as const,
        sellSimSlippagePct: 50,
        v2ReservePctBelow: null,
    },
};

beforeEach(async () => {
    vi.resetModules();
    process.env.WATCHDOG_BUDGET_MS = '1000'; // small budget for the test
    mod = await import('../../../src/anti-rug/exitTrigger');
    executeFullSellMock.mockReset();
    isCircuitBreakerTrippedMock.mockReset().mockReturnValue(false);
    incrementCircuitBreakerMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env.WATCHDOG_BUDGET_MS;
});

describe('Phase 21.2 / WR-02 — the anti-rug exit is wall-clock-bounded (REAL bounding path)', () => {
    it('a STALLED anti-rug submit is FREED by the budget — triggerAntiRugExit resolves (does not hang)', async () => {
        vi.useFakeTimers();
        // executeFullSell never resolves — the pre-fix direct await would hang here.
        executeFullSellMock.mockImplementation(() => new Promise<boolean>(() => { /* never */ }));

        const ctx = buildCtx() as unknown as Parameters<typeof mod.triggerAntiRugExit>[0];
        const p = mod.triggerAntiRugExit(
            ctx, V2_DEX as unknown as Parameters<typeof mod.triggerAntiRugExit>[1],
            TOKEN, null, 42, EVAL,
        );

        // Settled flag — observable proof the awaiting path was freed.
        let settled = false;
        let value: boolean | undefined;
        void p.then((v) => { settled = true; value = v; });

        // Before the budget: still pending.
        await vi.advanceTimersByTimeAsync(500);
        expect(settled).toBe(false);

        // Cross the budget → the bound frees the awaiting path.
        await vi.advanceTimersByTimeAsync(700);
        await p;
        expect(settled).toBe(true);
        // A timed-out anti-rug exit is a FAILURE outcome (false) — the position is
        // not torn down; it stays held + monitored and retries on the next cycle.
        expect(value).toBe(false);
        // executeFullSell was actually invoked (we bounded the REAL call, not a stub path).
        expect(executeFullSellMock).toHaveBeenCalledTimes(1);
    });

    it('a timed-out anti-rug exit still records toward the circuit breaker (a consumed trigger slot)', async () => {
        vi.useFakeTimers();
        executeFullSellMock.mockImplementation(() => new Promise<boolean>(() => { /* never */ }));

        const ctx = buildCtx() as unknown as Parameters<typeof mod.triggerAntiRugExit>[0];
        const p = mod.triggerAntiRugExit(
            ctx, V2_DEX as unknown as Parameters<typeof mod.triggerAntiRugExit>[1],
            TOKEN, null, 42, EVAL,
        );
        await vi.advanceTimersByTimeAsync(1200);
        await p;

        expect(incrementCircuitBreakerMock).toHaveBeenCalledTimes(1);
        // The recorded outcome is the failure variant.
        const evt = incrementCircuitBreakerMock.mock.calls[0][1] as { outcome: string };
        expect(evt.outcome).toBe('exit-fired-failure');
    });

    it('a FAST anti-rug submit (resolves under budget) passes its value straight through (no false-abort)', async () => {
        executeFullSellMock.mockResolvedValue(true);
        const ctx = buildCtx() as unknown as Parameters<typeof mod.triggerAntiRugExit>[0];
        const result = await mod.triggerAntiRugExit(
            ctx, V2_DEX as unknown as Parameters<typeof mod.triggerAntiRugExit>[1],
            TOKEN, null, 42, EVAL,
        );
        expect(result).toBe(true);
        const evt = incrementCircuitBreakerMock.mock.calls[0][1] as { outcome: string };
        expect(evt.outcome).toBe('exit-fired-success');
    });
});
