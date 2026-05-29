// test/unit/exitEngine/partialSellDecoupled.test.ts
// Phase 21.2 Plan 21.2-13 / Task 4 — WR-06 regression.
//
// WR-06: executePartialSell was still `await`ed INLINE on the poll tick
// (pollExitStrategy step 3). It calls sendTxWithRetry → submitWithReconciliation,
// which polls a bounded confirm window (default 45s) per attempt, so a partial-
// sell trigger BLOCKED that position's poll cycle (and serialized on withNonceLock)
// for tens of seconds — reintroducing the overruns:true poll-loop starvation
// Finding C removed, for partial sells. The worker header even ASSERTED
// "partial-sell stays on the poll tick — it is non-blocking," which was false
// given the reconciliation window.
//
// FIX: route the partial-sell trigger through a dedicated NON-BLOCKING dispatch
// (dispatchPartialSell) so the poll tick returns 'continue' immediately, mirroring
// the full-sell triggers. overruns must stay FALSE under a real (slow) partial-
// sell submit.
//
// THE CARDINAL LESSON: this test drives a REAL poll tick (resumeExitMonitor) with
// partial tiers configured and a SLOW partial submit (sendTxWithRetry never
// resolves within the cycle). If the partial were still awaited inline, durationMs
// would be huge and overruns:true (the RED). Decoupled, the cycle stays fast.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

// Config WITH a partial tier so the poll tick triggers a partial sell (2x:50%).
vi.mock('../../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15,
        trailingMinPct: 5,
        trailingMaxPct: 40,
        stopLossPercent: 25,
        partialSellTargets: '2x:50', // sell 50% at 2x
        exitPollIntervalMs: 5000,
        urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03,
        volatilityMaxSamples: 60,
        volatilityMinSamples: 12,
        slippagePercent: 5,
    },
}));

vi.mock('../../../src/utils/exitManager', () => ({
    tryAcquireSellLock: vi.fn().mockReturnValue(true),
    releaseSellLock: vi.fn(),
    clearAllTimersForToken: vi.fn(),
    registerExitMonitor: vi.fn(),
    tryEnqueuePosition: vi.fn().mockReturnValue(true),
    releasePositionQueue: vi.fn(),
}));

// REAL withNonceLock (the partial submit serializes through it). NOT mocked.
vi.mock('../../../src/utils/nonceAuthority', async () => {
    const actual = await vi.importActual<typeof import('../../../src/utils/nonceAuthority')>(
        '../../../src/utils/nonceAuthority',
    );
    return { ...actual };
});

vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: vi.fn() }));

// sendTxWithRetry: controllable. Default a slow (never-resolving-in-cycle) submit
// to prove the poll tick does NOT block on it.
let sendImpl: () => Promise<string> = () => new Promise<string>(() => { /* never */ });
const sendTxWithRetryMock = vi.fn(() => sendImpl());
vi.mock('../../../src/utils/txManager', () => ({ sendTxWithRetry: sendTxWithRetryMock }));

vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: vi.fn().mockResolvedValue({ amountOut: '1', gasCost: '1', blockNumber: 1 }),
}));
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: vi.fn() }));

const priceState = { amountOut: 1000n };
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(1_000_000_000_000_000_000n);
        this.allowance = () => Promise.resolve(0n);
        this.approve = () => Promise.resolve({ wait: () => Promise.resolve(null) });
        this.getAmountsOut = () => Promise.resolve([0n, priceState.amountOut]);
        this.interface = { encodeFunctionData: () => '0xdeadbeef' };
    }
    return { ...actual, Contract: MockContract };
});

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

// entry=500 so the current price 1000 == 2x → the 2x:50% tier triggers.
const STATE_ROW = {
    trade_id: 500,
    entry_price: 500,
    high_water_mark: 1000,
    trailing_activated: 0,
    partial_tiers_completed: '[]',
    original_token_amount: '1000000000000000000',
    urgency_start_ts: Date.now(),
    volatility_samples: '[]',
};

function pollCycleLog(log: CtxLog): Record<string, unknown> | undefined {
    for (const call of log.info.mock.calls) {
        const arg = call[0];
        if (arg && typeof arg === 'object' && arg.op === 'exit.poll.cycle') return arg;
    }
    return undefined;
}

function partialSubmittedLog(log: CtxLog): Record<string, unknown> | undefined {
    for (const call of log.info.mock.calls) {
        const arg = call[0];
        if (arg && typeof arg === 'object' && arg.op === 'exit.partial.submitted') return arg;
    }
    return undefined;
}

let perfSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
    upsertExitStateRun.mockReset();
    getExitStateGet.mockReset().mockReturnValue({ ...STATE_ROW });
    sendTxWithRetryMock.mockClear();
    priceState.amountOut = 1000n; // 2x
    sendImpl = () => new Promise<string>(() => { /* never resolves within the cycle */ });
    vi.useFakeTimers();
});

afterEach(() => {
    perfSpy?.mockRestore();
    perfSpy = undefined;
    vi.useRealTimers();
});

describe('Phase 21.2 / WR-06 — partial sell is decoupled from the poll tick (overruns stays false)', () => {
    it('a partial-sell trigger with a SLOW submit keeps the poll cycle FAST (overruns:false)', async () => {
        // performance.now() before/after pollExitStrategy. Decoupled, the delta is
        // tiny → force [t0=0, t1=20]. If the partial were awaited inline against the
        // never-resolving sendTxWithRetry, the cycle would never even emit its log.
        let i = 0;
        const seq = [0, 20];
        perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
            const v = seq[Math.min(i, seq.length - 1)];
            i += 1;
            return v;
        });

        const mod = await import('../../../src/exitEngine');
        const { ctx, log } = buildCtx();
        await mod.resumeExitMonitor(
            ctx as Parameters<typeof mod.resumeExitMonitor>[0],
            V2_DEX as unknown as Parameters<typeof mod.resumeExitMonitor>[1],
            '0xToken00000000000000000000000000000000T50',
            null,
            '0.01',
            500,
        );

        await vi.advanceTimersByTimeAsync(5000);

        // The poll cycle emitted its telemetry — proving the tick RETURNED (it did
        // NOT block on the never-resolving partial submit).
        const telemetry = pollCycleLog(log);
        expect(telemetry).toBeDefined();
        expect(telemetry!.durationMs).toBe(20);
        expect(telemetry!.overruns).toBe(false); // 20ms << 5000ms budget
        expect(telemetry!.budgetMs).toBe(5000);

        // The partial sell WAS dispatched off-tick (its submit boundary was reached).
        expect(partialSubmittedLog(log)).toBeDefined();
        expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1);

        // Clear the registered interval so the fake clock has nothing pending.
        const exitMgr = await import('../../../src/utils/exitManager');
        for (const c of (exitMgr.registerExitMonitor as ReturnType<typeof vi.fn>).mock.calls) {
            clearInterval(c[2] as ReturnType<typeof setInterval>);
        }
    });

    it('the interval stays ARMED after a partial trigger (poll returns continue, not exited)', async () => {
        perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
        const mod = await import('../../../src/exitEngine');
        const { ctx, log } = buildCtx();
        await mod.resumeExitMonitor(
            ctx as Parameters<typeof mod.resumeExitMonitor>[0],
            V2_DEX as unknown as Parameters<typeof mod.resumeExitMonitor>[1],
            '0xToken00000000000000000000000000000000T51',
            null,
            '0.01',
            501,
        );

        await vi.advanceTimersByTimeAsync(5000);
        const first = log.info.mock.calls.filter(
            (c) => c[0] && typeof c[0] === 'object' && c[0].op === 'exit.poll.cycle',
        ).length;
        await vi.advanceTimersByTimeAsync(5000);
        const second = log.info.mock.calls.filter(
            (c) => c[0] && typeof c[0] === 'object' && c[0].op === 'exit.poll.cycle',
        ).length;

        expect(first).toBeGreaterThanOrEqual(1);
        expect(second).toBeGreaterThan(first); // timer still armed → another cycle ran

        const exitMgr = await import('../../../src/utils/exitManager');
        for (const c of (exitMgr.registerExitMonitor as ReturnType<typeof vi.fn>).mock.calls) {
            clearInterval(c[2] as ReturnType<typeof setInterval>);
        }
    });
});
