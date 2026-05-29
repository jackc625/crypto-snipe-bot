// test/unit/exitEngine/exitWorkerRealPath.test.ts
// Phase 21.2 Plan 21.2-12 / Task 1 — CR-01 regression: the re-entrant
// withNonceLock deadlock on the worker exit path.
//
// THE CARDINAL LESSON (21.2-REVIEW.md): CR-01 shipped because every test that
// touched the worker exit path MOCKED the mechanism that breaks —
// exitWorker.test.ts substitutes a fake executor via _setSellExecutorForTesting
// (the REAL executeFullSell never runs), and exitInclusionLadder.test.ts mocks
// withNonceLock to a non-serializing passthrough (`op()`), which deletes the
// promise-chaining that DEADLOCKS. So neither test could ever observe the
// double-lock hang.
//
// This test deliberately exercises the REAL path:
//   * the REAL ExitWorker.drain (NO _setSellExecutorForTesting — the worker
//     drives its default realSellExecutor === executeFullSell)
//   * the REAL withNonceLock (nonceAuthority is NOT mocked — the genuine
//     non-reentrant promise-chain mutex is in play)
//   * a mocked ERC-20 whose allowance (0) < balance FORCES ensureApproval to
//     actually run an approve under withNonceLock(ctx.wallet.address, ...)
//
// Against the PRE-FIX code the worker drain wraps the whole submit in
// withNonceLock (exitEngine.ts:1254) and executeFullSell then re-acquires the
// SAME wallet's lock for its approval (exitEngine.ts:826/829) → the inner
// acquire waits for the outer to settle, the outer waits for the inner →
// PERMANENT DEADLOCK. The drain promise NEVER resolves, so this test TIMES OUT
// (the RED proof). It also proves the orphaned executeFullSell never reaches its
// finally{releaseSellLock}: the per-token sell-lock stays stranded and a
// subsequent DIRECT anti-rug exit cannot acquire it.
//
// After the CR-01 fix (single-level locking — the worker no longer wraps the
// executor in withNonceLock; executeFullSell's own per-signing-site locks
// serialize it) the drain RESOLVES, the sell-lock is released, and a follow-up
// tryAcquireSellLock succeeds.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// Module mocks — ONLY the external boundaries. We do NOT mock nonceAuthority
// (the deadlock mechanism), the worker, executeFullSell, or ensureApproval.
// The private leg (escalatePrivateSell) is mocked to "not landed" with NO
// lastSignedHash so the ladder goes straight to the no-double-sell guard's
// balanceOf branch and then the public fallback — exercising the SECOND
// withNonceLock-wrapped signing sites (the approval + swap in
// executePublicFallbackSell). sendTxWithRetry is mocked (unused on this branch
// but imported by exitEngine).
// -----------------------------------------------------------------------------

const insertTradeRun = vi.fn();
const updateTradeStatusRun = vi.fn();
const deleteExitStateRun = vi.fn();
const markExitFailedHeldRun = vi.fn();

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: () => ({
        trade_id: 1, entry_price: 1, high_water_mark: 1, trailing_activated: 0,
        partial_tiers_completed: '[]', original_token_amount: '1000000',
        urgency_start_ts: Date.now(), volatility_samples: '[1]',
        exit_failure_count: 0, exit_status: null,
    }) },
    deleteExitState: { run: deleteExitStateRun },
    markExitFailedHeld: { run: markExitFailedHeldRun },
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
        slippagePercent: 5,
    },
}));

vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: vi.fn() }));

const sendTxWithRetryMock = vi.fn();
const escalatePrivateSellMock = vi.fn();
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    escalatePrivateSell: escalatePrivateSellMock,
}));

vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: vi.fn().mockResolvedValue({ amountOut: '1', gasCost: '1', blockNumber: 1 }),
}));
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: vi.fn() }));

// CRITICAL: nonceAuthority is NOT mocked. The REAL withNonceLock (the
// non-reentrant promise-chain mutex) is what makes the double-lock deadlock.

// Mock ethers Contract so allowance (0) < balance FORCES the approval branch to
// fire (which signs an approve INSIDE withNonceLock). The approve + swap each
// "wait" resolves so a single-level-locked submit can complete; only the
// re-entrant double-lock can hang it.
let balanceSequence: bigint[] = [];
let balanceCallCount = 0;
const approveMock = vi.fn();
const swapFeeOnTransferMock = vi.fn();
const getAmountsOutMock = vi.fn();

function nextBalance(): bigint {
    const idx = Math.min(balanceCallCount, balanceSequence.length - 1);
    balanceCallCount++;
    return balanceSequence[idx] ?? 0n;
}

vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(nextBalance());
        this.allowance = () => Promise.resolve(0n); // < balance → approval fires
        this.approve = approveMock;
        this.getAmountsOut = getAmountsOutMock;
        this.swapExactTokensForETHSupportingFeeOnTransferTokens = swapFeeOnTransferMock;
        this.interface = { encodeFunctionData: () => '0xdeadbeef' };
    }
    return { ...actual, Contract: MockContract };
});

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x12970E6868f88f6557B76120662c1B3E50A646bf'; // LADYS mainnet

function buildCtx() {
    return {
        chain: {
            name: 'eth',
            displayName: '[ETH]',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            gas: { multiplier: 1.2, maxGasLimit: 500_000n },
            antiRug: { liveExecute: true, gasMultiplier: 2.0 },
        },
        wallet: { address: WALLET },
        httpProvider: {
            getTransactionCount: vi.fn().mockResolvedValue(7),
        },
        log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
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

/**
 * Resolve when the per-position queue lock for {chain, token} has been released
 * (the worker's drain finally ran), or reject after `timeoutMs`. A pending
 * (deadlocked) drain never releases the lock, so this rejects → the RED proof.
 */
function waitForPositionReleased(
    exitMgr: typeof import('../../../src/utils/exitManager'),
    chain: string,
    token: string,
    timeoutMs: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
            // tryEnqueuePosition returns true iff the position is FREE. If free,
            // immediately release it again so we don't strand it ourselves.
            if (exitMgr.tryEnqueuePosition(chain, token)) {
                exitMgr.releasePositionQueue(chain, token);
                resolve();
                return;
            }
            if (Date.now() >= deadline) {
                reject(new Error('worker drain did not settle within budget (deadlock)'));
                return;
            }
            setTimeout(tick, 5);
        };
        tick();
    });
}

let mod: typeof import('../../../src/exitEngine');
let nonceMod: typeof import('../../../src/utils/nonceAuthority');
let exitMgr: typeof import('../../../src/utils/exitManager');

beforeEach(async () => {
    vi.resetModules();
    mod = await import('../../../src/exitEngine');
    nonceMod = await import('../../../src/utils/nonceAuthority');
    exitMgr = await import('../../../src/utils/exitManager');
    nonceMod._resetNonceChainsForTesting();
    exitMgr._resetSellLocksForTesting();

    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    deleteExitStateRun.mockReset();
    markExitFailedHeldRun.mockReset();
    sendTxWithRetryMock.mockReset();

    // Private leg: NOT landed, and NO lastSignedHash → the no-double-sell guard
    // skips reconcile (2a) and goes straight to the balanceOf branch (2b) and the
    // public fallback — exercising the SECOND set of withNonceLock-wrapped signing
    // sites (the public-fallback approval + swap). This is the path the worker's
    // outer lock deadlocks against.
    escalatePrivateSellMock.mockReset().mockResolvedValue({ landed: false });

    // approve + swap each resolve cleanly so a single-level-locked submit COMPLETES.
    approveMock.mockReset().mockResolvedValue({ wait: vi.fn().mockResolvedValue(null) });
    swapFeeOnTransferMock.mockReset().mockResolvedValue({
        hash: '0xpublicsellhash',
        wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18_000_123 }),
    });
    getAmountsOutMock.mockReset().mockResolvedValue([0n, 1_000_000_000_000_000n]);

    // call 1 = initial balance, call 2 = guard re-fetch (held), call 3 = post-sell.
    balanceSequence = [1_000_000n, 1_000_000n, 0n];
    balanceCallCount = 0;
});

afterEach(() => {
    mod._resetExitWorkerForTesting?.();
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 21.2 / CR-01 — worker exit path does NOT re-entrant-deadlock (REAL path)', () => {
    it('a REAL worker→executeFullSell→approval exit RESOLVES (no deadlock) and releases the sell-lock', async () => {
        // Drive the REAL worker with its REAL default executor (executeFullSell)
        // and the REAL withNonceLock. NO _setSellExecutorForTesting here.
        const enqueued = mod.enqueueExit(item({ tokenAddress: TOKEN, reason: 'trailing-stop', tradeId: 200 }));
        expect(enqueued).toBe(true);

        // The drain must settle (release the per-position queue lock) within a
        // short budget. Against the PRE-FIX double-lock the inner approval lock
        // waits on the outer worker lock forever → this rejects (RED). After the
        // fix it resolves well under budget.
        await expect(
            waitForPositionReleased(exitMgr, 'eth', TOKEN, 2_000),
        ).resolves.toBeUndefined();

        // The public-fallback swap actually fired (the submit completed, it did
        // not hang before the swap). Proves we exercised the real signing path.
        expect(swapFeeOnTransferMock).toHaveBeenCalledTimes(1);
        // The approval fired under the lock too (allowance 0 < balance).
        expect(approveMock).toHaveBeenCalled();
    });

    it('after the worker exit settles, a subsequent DIRECT anti-rug exit can acquire the sell-lock (it is not stranded)', async () => {
        mod.enqueueExit(item({ tokenAddress: TOKEN, reason: 'stop-loss', tradeId: 201 }));

        await expect(
            waitForPositionReleased(exitMgr, 'eth', TOKEN, 2_000),
        ).resolves.toBeUndefined();

        // The per-token SELL lock (acquired+released INSIDE executeFullSell's
        // finally{releaseSellLock}) must be free now. Against the pre-fix deadlock
        // executeFullSell never reaches its finally → this lock stays held → the
        // direct anti-rug exit (exitTrigger → tryAcquireSellLock) is permanently
        // blocked for this token.
        expect(exitMgr.tryAcquireSellLock('eth', TOKEN)).toBe(true);
        exitMgr.releaseSellLock('eth', TOKEN);
    });
});
