// test/unit/exitEngine/pollTelemetry.test.ts
// Phase 21 Plan 21-01 / Task 2 — EXIT-LIVE-01: each exit poll cycle emits a
// budget-vs-actual telemetry log. Both setInterval bodies (startExitMonitor and
// resumeExitMonitor) wrap the await pollExitStrategy(...) call with a
// performance.now() delta and emit ONE log per cycle:
//
//   { op: 'exit.poll.cycle', token, positions: 1, durationMs: <number>,
//     budgetMs: <pollIntervalMs=5000>, overruns: <boolean> }
//
// Locked schema (CONTEXT Claude's-Discretion + REQUIREMENTS EXIT-LIVE-01):
//   - positions: 1  — the engine runs ONE setInterval PER open position, so each
//     cycle evaluates exactly one position (derived from loop scope, no new timer).
//   - overruns (PLURAL) — boolean durationMs > budgetMs. The field NAME is locked
//     to `overruns`; this test asserts it is NOT spelled `overrun`.
//   - budgetMs equals the configured pollIntervalMs (5000 in the mocked config).
//
// This is additive logging only: timing wraps the existing call (no new await),
// and the clearInterval / interval-period semantics are unchanged.
//
// Test strategy: drive a single real poll tick via resumeExitMonitor (DB-state
// path needs no price for setup), control the measured duration by mocking
// performance.now() to return a deterministic delta, and assert the captured
// ctx.log.info call carrying op:'exit.poll.cycle'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// Module mocks (mirror opEnrichment.test.ts / antiRugReason.test.ts)
// -----------------------------------------------------------------------------

const upsertExitStateRun = vi.fn();
const getExitStateGet = vi.fn();

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: vi.fn() },
    updateTradeStatus: { run: vi.fn() },
    upsertExitState: { run: upsertExitStateRun },
    getExitState: { get: getExitStateGet },
    deleteExitState: { run: vi.fn() },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    },
}));

vi.mock('../../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15,
        trailingMinPct: 5,
        trailingMaxPct: 40,
        stopLossPercent: 25,
        partialSellTargets: '', // no partial tiers — keeps the poll tick simple
        exitPollIntervalMs: 5000,
        urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03,
        volatilityMaxSamples: 60,
        volatilityMinSamples: 12,
    },
}));

const registerExitMonitorMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    tryAcquireSellLock: vi.fn().mockReturnValue(true),
    releaseSellLock: vi.fn(),
    clearAllTimersForToken: vi.fn(),
    registerExitMonitor: registerExitMonitorMock,
}));

vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: vi.fn() }));
vi.mock('../../../src/utils/txManager', () => ({ sendTxWithRetry: vi.fn().mockResolvedValue('0xtxhash') }));
vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: vi.fn().mockResolvedValue({ amountOut: '1', gasCost: '1', blockNumber: 1 }),
}));
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: vi.fn() }));

// ethers Contract mock with a controllable price (getAmountsOut) so queryPrice
// returns a number and the poll cycle runs to the telemetry log without exiting.
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(1_000_000_000_000_000_000n);
        this.allowance = () => Promise.resolve(0n);
        this.approve = () => Promise.resolve({ wait: () => Promise.resolve(null) });
        // price == entry so no trigger fires; cycle returns 'continue'
        this.getAmountsOut = () => Promise.resolve([0n, 1000n]);
        this.interface = { encodeFunctionData: () => '0xdeadbeef' };
    }
    return { ...actual, Contract: MockContract };
});

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

type LogSpy = ReturnType<typeof vi.fn>;
interface CtxLog { info: LogSpy; warn: LogSpy; debug: LogSpy; error: LogSpy; }

function buildCtx(): { ctx: unknown; log: CtxLog } {
    const log: CtxLog = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const ctx = {
        chain: {
            name: 'eth',
            displayName: '[ETH]',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            gas: { multiplier: 1.2, maxGasLimit: 500_000n },
            antiRug: { liveExecute: true, gasMultiplier: 2.0 },
        },
        wallet: { address: '0x1111111111111111111111111111111111111111' },
        httpProvider: {},
        log,
    };
    return { ctx, log };
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

// Persisted exit_state row so resumeExitMonitor takes the DB-state path (no
// price query needed for setup; entry==current price so no trigger fires).
const STATE_ROW = {
    trade_id: 300,
    entry_price: 1000,
    high_water_mark: 1000,
    trailing_activated: 0,
    partial_tiers_completed: '[]',
    original_token_amount: '1000000000000000000',
    urgency_start_ts: Date.now(),
    volatility_samples: '[]',
};

// Pull the single poll-cycle telemetry log object from a ctx.log spy.
function pollCycleLog(log: CtxLog): Record<string, unknown> | undefined {
    for (const call of log.info.mock.calls) {
        const arg = call[0];
        if (arg && typeof arg === 'object' && arg.op === 'exit.poll.cycle') return arg;
    }
    return undefined;
}

let perfSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
    upsertExitStateRun.mockReset();
    getExitStateGet.mockReset().mockReturnValue({ ...STATE_ROW });
    registerExitMonitorMock.mockReset();
    vi.useFakeTimers();
});

afterEach(() => {
    perfSpy?.mockRestore();
    perfSpy = undefined;
    // Clear any registered interval so the fake-timer clock has nothing pending.
    for (const c of registerExitMonitorMock.mock.calls) {
        clearInterval(c[2] as ReturnType<typeof setInterval>);
    }
    vi.useRealTimers();
});

// Drive one poll tick and return the captured telemetry object.
// durationMs is forced by the sequence of performance.now() return values:
// the implementation calls performance.now() once before and once after the
// await, so [t0, t1] yields durationMs = t1 - t0.
async function runOnePollCycle(
    monitor: 'start' | 'resume',
    perfSequence: number[],
): Promise<{ telemetry: Record<string, unknown> | undefined; log: CtxLog }> {
    let i = 0;
    perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
        const v = perfSequence[Math.min(i, perfSequence.length - 1)];
        i += 1;
        return v;
    });

    const mod = await import('../../../src/exitEngine');
    const { ctx, log } = buildCtx();

    if (monitor === 'resume') {
        await mod.resumeExitMonitor(
            ctx as Parameters<typeof mod.resumeExitMonitor>[0],
            V2_DEX as unknown as Parameters<typeof mod.resumeExitMonitor>[1],
            '0xToken00000000000000000000000000000000T30',
            null,
            '0.01',
            300,
        );
    } else {
        await mod.startExitMonitor(
            ctx as Parameters<typeof mod.startExitMonitor>[0],
            V2_DEX as unknown as Parameters<typeof mod.startExitMonitor>[1],
            '0xToken00000000000000000000000000000000T31',
            null,
            '0.01',
            301,
            1_000_000_000_000_000_000n,
        );
    }

    // Advance one interval period + flush the async tick.
    await vi.advanceTimersByTimeAsync(5000);
    return { telemetry: pollCycleLog(log), log };
}

// -----------------------------------------------------------------------------
// Tests — resumeExitMonitor body
// -----------------------------------------------------------------------------

describe('EXIT-LIVE-01 — resumeExitMonitor poll-cycle telemetry', () => {
    it('emits op:exit.poll.cycle with positions:1, numeric durationMs, budgetMs:5000', async () => {
        // t0=100, t1=150 → durationMs=50 (well under 5000 budget → overruns:false)
        const { telemetry } = await runOnePollCycle('resume', [100, 150]);

        expect(telemetry).toBeDefined();
        expect(telemetry!.op).toBe('exit.poll.cycle');
        expect(telemetry!.positions).toBe(1);
        expect(typeof telemetry!.durationMs).toBe('number');
        expect(Number.isFinite(telemetry!.durationMs as number)).toBe(true);
        expect(telemetry!.durationMs).toBe(50);
        expect(telemetry!.budgetMs).toBe(5000);
    });

    it('overruns:false when the poll completes within budget', async () => {
        // durationMs = 4999 < 5000 → overruns false
        const { telemetry } = await runOnePollCycle('resume', [0, 4999]);
        expect(telemetry).toBeDefined();
        expect(telemetry!.overruns).toBe(false);
    });

    it('overruns:true when the poll exceeds budget', async () => {
        // durationMs = 6000 > 5000 → overruns true
        const { telemetry } = await runOnePollCycle('resume', [0, 6000]);
        expect(telemetry).toBeDefined();
        expect(telemetry!.overruns).toBe(true);
    });

    it('the field is spelled "overruns" (plural), not "overrun"', async () => {
        const { telemetry } = await runOnePollCycle('resume', [0, 100]);
        expect(telemetry).toBeDefined();
        expect(Object.keys(telemetry!)).toContain('overruns');
        expect(Object.keys(telemetry!)).not.toContain('overrun');
    });
});

// -----------------------------------------------------------------------------
// Tests — startExitMonitor body (the SECOND setInterval that must get the same wrap)
// -----------------------------------------------------------------------------

describe('EXIT-LIVE-01 — startExitMonitor poll-cycle telemetry (both bodies wrapped)', () => {
    it('startExitMonitor body also emits op:exit.poll.cycle with the full locked schema', async () => {
        // For startExitMonitor the first performance.now() call is the cycle t0
        // and the second is t1. The initial entryPrice query happens before the
        // interval is created (no performance.now there), so the sequence maps to
        // the first poll cycle. t0=10, t1=42 → durationMs=32.
        const { telemetry } = await runOnePollCycle('start', [10, 42]);

        expect(telemetry).toBeDefined();
        expect(telemetry!.op).toBe('exit.poll.cycle');
        expect(telemetry!.positions).toBe(1);
        expect(typeof telemetry!.durationMs).toBe('number');
        expect(telemetry!.budgetMs).toBe(5000);
        expect(typeof telemetry!.overruns).toBe('boolean');
    });
});
