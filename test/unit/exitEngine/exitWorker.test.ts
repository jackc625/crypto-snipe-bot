// test/unit/exitEngine/exitWorker.test.ts
// Phase 21.2 Plan 21.2-05 / Task 1 — Finding C decoupling: a single SERIAL
// ExitWorker drains a PRIORITY queue, submitting ONE sell at a time, with a
// PER-POSITION lock preventing re-entrant self-sell, and EVERY submit routed
// through withNonceLock(ctx.wallet.address, ...) (D-NONCE-AUTHORITY-ALL, 21.2-01).
//
// These are OBSERVABLE-EFFECT tests (no hollow assertions):
//
//   Test 1 (serial drain): enqueue two exits; with a controllable executor that
//     records start/end timestamps, assert the second submit starts ONLY AFTER
//     the first resolves — i.e. the two intervals do NOT overlap. FAILS if the
//     worker fired both concurrently.
//   Test 2 (priority ordering): enqueue a trailing-stop; while it is mid-flight
//     enqueue an anti-rug AND a (later) stop-loss; assert the anti-rug is
//     dequeued BEFORE the already-queued trailing-stop's lower-priority siblings
//     — a late anti-rug jumps the queue.
//   Test 3 (per-position lock): enqueue the same {chain:token} twice; assert the
//     executor is invoked only ONCE for it (no re-entrant self-sell); the lock
//     releases after the sell settles so a future genuine re-trigger can enqueue
//     again.
//   Test 4 (nonce wrap): the worker's executeFullSell call is routed through
//     withNonceLock(ctx.wallet.address, ...) — asserted via a spy that the lock
//     wraps the submit (and is keyed by the wallet address).
//
// The worker calls the module's real `executeFullSell` in production; for these
// timing/observability tests we substitute a controllable executor via the
// test-only seam `_setSellExecutorForTesting` (mirrors the `_reset*ForTesting`
// convention in nonceAuthority.ts / circuitBreaker.ts / detector.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// Module mocks. The worker only needs config + logger + the per-position lock
// (exitManager) + the nonce authority. We DO NOT mock executeFullSell's deep
// deps because the controllable executor seam replaces the executor wholesale.
// -----------------------------------------------------------------------------

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: vi.fn() },
    updateTradeStatus: { run: vi.fn() },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
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
        partialSellTargets: '',
        exitPollIntervalMs: 5000,
        urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03,
        volatilityMaxSamples: 60,
        volatilityMinSamples: 12,
    },
}));

vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: vi.fn() }));
vi.mock('../../../src/utils/txManager', () => ({ sendTxWithRetry: vi.fn().mockResolvedValue('0xtxhash') }));
vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: vi.fn().mockResolvedValue({ amountOut: '1', gasCost: '1', blockNumber: 1 }),
}));
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: vi.fn() }));
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(1_000_000_000_000_000_000n);
        this.allowance = () => Promise.resolve(0n);
        this.approve = () => Promise.resolve({ wait: () => Promise.resolve(null) });
        this.getAmountsOut = () => Promise.resolve([0n, 1000n]);
        this.interface = { encodeFunctionData: () => '0xdeadbeef' };
    }
    return { ...actual, Contract: MockContract };
});

// withNonceLock spy: real serialization semantics PLUS a recording wrapper so we
// can assert (Test 4) that the worker routed the submit through it keyed by the
// wallet address, AND keep the real per-wallet serial-by-construction behavior.
const withNonceLockCalls: string[] = [];
vi.mock('../../../src/utils/nonceAuthority', async () => {
    const actual = await vi.importActual<typeof import('../../../src/utils/nonceAuthority')>(
        '../../../src/utils/nonceAuthority',
    );
    return {
        ...actual,
        withNonceLock: vi.fn(async <T>(walletAddress: string, op: () => Promise<T>): Promise<T> => {
            withNonceLockCalls.push(walletAddress);
            return actual.withNonceLock(walletAddress, op);
        }),
    };
});

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const WALLET = '0x1111111111111111111111111111111111111111';

function buildCtx() {
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    return {
        chain: { name: 'eth', displayName: '[ETH]' },
        wallet: { address: WALLET },
        httpProvider: {},
        log,
    };
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

type EnqueueArg = Parameters<typeof import('../../../src/exitEngine')['enqueueExit']>[0];

function item(overrides: Partial<EnqueueArg> & { tokenAddress: string; reason: EnqueueArg['reason']; tradeId: number }): EnqueueArg {
    return {
        ctx: buildCtx() as unknown as EnqueueArg['ctx'],
        dex: V2_DEX as unknown as EnqueueArg['dex'],
        feeTier: null,
        reasonDetail: `${overrides.reason} detail`,
        ...overrides,
    } as EnqueueArg;
}

// A controllable executor: each call returns a promise the test resolves by
// hand, and every invocation records {token, reason, start, end} timestamps.
interface ExecRecord {
    token: string;
    reason: string;
    start: number;
    end: number | null;
    resolve: (v: boolean) => void;
}

function makeControllableExecutor() {
    const records: ExecRecord[] = [];
    let clock = 0;
    const executor = vi.fn((args: { tokenAddress: string; reason: string }) => {
        const rec: ExecRecord = {
            token: args.tokenAddress,
            reason: args.reason,
            start: clock++,
            end: null,
            resolve: () => {},
        };
        records.push(rec);
        return new Promise<boolean>((res) => {
            rec.resolve = (v: boolean) => {
                rec.end = clock++;
                res(v);
            };
        });
    });
    return { executor, records };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

let mod: typeof import('../../../src/exitEngine');
let nonceMod: typeof import('../../../src/utils/nonceAuthority');
let exitMgr: typeof import('../../../src/utils/exitManager');

beforeEach(async () => {
    withNonceLockCalls.length = 0;
    vi.resetModules();
    mod = await import('../../../src/exitEngine');
    nonceMod = await import('../../../src/utils/nonceAuthority');
    exitMgr = await import('../../../src/utils/exitManager');
    nonceMod._resetNonceChainsForTesting();
    // Clear any per-position lock state from a prior test.
    if (typeof (exitMgr as { _resetSellLocksForTesting?: () => void })._resetSellLocksForTesting === 'function') {
        (exitMgr as unknown as { _resetSellLocksForTesting: () => void })._resetSellLocksForTesting();
    }
});

afterEach(() => {
    mod._resetExitWorkerForTesting?.();
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('ExitWorker — serial drain (Test 1)', () => {
    it('submits the second exit only AFTER the first resolves (no overlap)', async () => {
        const { executor, records } = makeControllableExecutor();
        mod._setSellExecutorForTesting(executor);

        mod.enqueueExit(item({ tokenAddress: '0xAAA0000000000000000000000000000000000001', reason: 'stop-loss', tradeId: 1 }));
        mod.enqueueExit(item({ tokenAddress: '0xBBB0000000000000000000000000000000000002', reason: 'stop-loss', tradeId: 2 }));

        await flush();
        // Only the first should have started; the second must wait.
        expect(executor).toHaveBeenCalledTimes(1);
        expect(records[0].end).toBeNull();

        // Resolve the first; the second should now start.
        records[0].resolve(true);
        await flush();
        await flush();

        expect(executor).toHaveBeenCalledTimes(2);
        // Serial: first ended before second started (no overlap).
        expect(records[0].end).not.toBeNull();
        expect(records[1].start).toBeGreaterThan(records[0].end as number);

        records[1].resolve(true);
        await flush();
    });
});

describe('ExitWorker — priority ordering (Test 2)', () => {
    it('a late anti-rug is dequeued before an already-queued trailing-stop', async () => {
        const { executor, records } = makeControllableExecutor();
        mod._setSellExecutorForTesting(executor);

        // First exit occupies the worker (in-flight).
        mod.enqueueExit(item({ tokenAddress: '0xCCC0000000000000000000000000000000000003', reason: 'urgency-market-sell', tradeId: 3 }));
        await flush();
        expect(executor).toHaveBeenCalledTimes(1);

        // While the first is mid-flight, queue a trailing-stop (rank 2) then a
        // LATE anti-rug (rank 0). The anti-rug must jump ahead of the trailing-stop.
        mod.enqueueExit(item({ tokenAddress: '0xDDD0000000000000000000000000000000000004', reason: 'trailing-stop', tradeId: 4 }));
        mod.enqueueExit(item({ tokenAddress: '0xEEE0000000000000000000000000000000000005', reason: 'anti-rug', tradeId: 5 }));

        // Drain in order.
        records[0].resolve(true);
        await flush(); await flush();
        // Next dequeued should be the anti-rug, NOT the earlier-queued trailing-stop.
        expect(records[1].reason).toBe('anti-rug');

        records[1].resolve(true);
        await flush(); await flush();
        expect(records[2].reason).toBe('trailing-stop');

        records[2].resolve(true);
        await flush();
    });
});

describe('ExitWorker — per-position lock (Test 3)', () => {
    it('blocks a double-enqueue of the same position and releases after settle', async () => {
        const { executor, records } = makeControllableExecutor();
        mod._setSellExecutorForTesting(executor);

        const token = '0xFFF0000000000000000000000000000000000006';
        mod.enqueueExit(item({ tokenAddress: token, reason: 'stop-loss', tradeId: 6 }));
        // Second enqueue of the SAME position while in-flight/queued — must skip.
        mod.enqueueExit(item({ tokenAddress: token, reason: 'stop-loss', tradeId: 6 }));

        await flush();
        expect(executor).toHaveBeenCalledTimes(1);

        // Settle the sell; the per-position lock must release so a FUTURE genuine
        // re-trigger can enqueue again.
        records[0].resolve(true);
        await flush(); await flush();

        mod.enqueueExit(item({ tokenAddress: token, reason: 'anti-rug', tradeId: 6 }));
        await flush();
        expect(executor).toHaveBeenCalledTimes(2);

        records[1].resolve(true);
        await flush();
    });
});

describe('ExitWorker — nonce wrap (Test 4)', () => {
    it('routes the worker submit through withNonceLock keyed by the wallet address', async () => {
        const { executor, records } = makeControllableExecutor();
        mod._setSellExecutorForTesting(executor);

        mod.enqueueExit(item({ tokenAddress: '0x1230000000000000000000000000000000000007', reason: 'anti-rug', tradeId: 7 }));
        await flush();

        expect(withNonceLockCalls.length).toBeGreaterThanOrEqual(1);
        expect(withNonceLockCalls[0].toLowerCase()).toBe(WALLET.toLowerCase());

        records[0].resolve(true);
        await flush();
    });
});
