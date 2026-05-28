// test/unit/exitEngine/exitInclusionLadder.test.ts
// Phase 21.2 Plan 21.2-06 / Task 1 — the Finding A inclusion ladder inside
// `executeFullSell` (D-EXIT-INCLUSION + D-FALLBACK-TRIGGER + D-FALLBACK-NO-DOUBLE-SELL).
//
// The exit now: (1) escalates the sell PRIVATELY with the independent sell-leg
// ceiling (reason-aware attempt counts: anti-rug → 0-1 quick attempts; routine →
// N=2); (2) if not included, runs the no-double-sell guard — reconcileInclusion on
// the last private attempt ABORTS the public fallback if the private bundle landed
// late (the LADYS / STOP-THE-LINE-02 false-negative class), then re-fetches
// balanceOf and sells ONLY what is still held (abort if 0); (3) submits a direct
// public-mempool sell via swapExactTokensForETHSupportingFeeOnTransferTokens
// (fee-on-transfer-safe) with reason-aware slippage. Every submit (private
// escalation + public fallback + approval) routes through withNonceLock.
//
// Mock harness modeled on test/unit/exitEngine/antiRugReason.test.ts (the
// exitEngine mock harness) + test/unit/mevStrategies/inclusionReconciliation.test.ts
// (the reconcileInclusion mock harness). The private-escalation path and the public
// fallback router are mocked so the ladder's CONTROL FLOW (when it goes public, when
// it aborts) is the observable, not the real MEV submit / on-chain swap.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const insertTradeRun = vi.fn();
const updateTradeStatusRun = vi.fn();
const deleteExitStateRun = vi.fn();
// Phase 21.2-07 (Finding D balance-truth catch): executeFullSell now re-fetches
// balanceOf on BOTH the success path and the catch, and on a still-held result
// persists exit_failed_held via markExitFailedHeld. getExitState supplies the
// dust threshold's original_token_amount. These ladder tests model a SUCCESSFUL
// public sell (post-sell balance drops to 0 → genuine close), so markExitFailedHeld
// should not normally fire — but it must be present in the mock so the catch /
// dust read never throws on a missing export.
const markExitFailedHeldRun = vi.fn();

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    upsertExitState: { run: vi.fn() },
    // A row with a modest original so the dust threshold is well below the test
    // balances; the post-sell re-fetch returning 0 reads as a genuine close.
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

const clearAllTimersForTokenMock = vi.fn();
const tryAcquireSellLockMock = vi.fn();
const releaseSellLockMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    tryAcquireSellLock: tryAcquireSellLockMock,
    releaseSellLock: releaseSellLockMock,
    clearAllTimersForToken: clearAllTimersForTokenMock,
    registerExitMonitor: vi.fn(),
    // Phase 21.2-07: the timer stays armed (these ladder positions close
    // genuinely) so the re-arm never fires here.
    hasExitMonitorTimer: vi.fn().mockReturnValue(true),
    tryEnqueuePosition: vi.fn().mockReturnValue(true),
    releasePositionQueue: vi.fn(),
}));

const sendCtxAlertMock = vi.fn();
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: sendCtxAlertMock,
}));

// The private-escalation path. The ladder calls escalatePrivateSell for the
// PRIVATE leg; it returns whether the bundle landed, and (when not) the last
// attempt's signed-tx hash + submitted nonce for the no-double-sell guard. The
// default is "not landed" so the ladder proceeds to the guard + public fallback.
// `escalatePrivateSell`'s `attempts` arg (slot 3) is asserted for reason-aware
// attempt counts (Test 4). sendTxWithRetry is also mocked (the public fallback
// does NOT use it, but exitEngine imports it).
const sendTxWithRetryMock = vi.fn();
const escalatePrivateSellMock = vi.fn();
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    escalatePrivateSell: escalatePrivateSellMock,
}));

const decodeReceiptMock = vi.fn();
vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: decodeReceiptMock,
}));

const unregisterAntiRugPositionMock = vi.fn();
vi.mock('../../../src/anti-rug/detector', () => ({
    unregisterAntiRugPosition: unregisterAntiRugPositionMock,
}));

// The no-double-sell guard probe. Default 'not-landed' so the ladder proceeds to
// the public fallback; Test 1 overrides it to 'included' to assert the ABORT.
const reconcileInclusionMock = vi.fn();
vi.mock('../../../src/utils/mevStrategies/reconciliation', async () => {
    const actual = await vi.importActual<
        typeof import('../../../src/utils/mevStrategies/reconciliation')
    >('../../../src/utils/mevStrategies/reconciliation');
    return {
        ...actual,
        reconcileInclusion: reconcileInclusionMock,
    };
});

// withNonceLock: pass-through wrapper that RECORDS its wallet-address key so the
// nonce-wrapping assertions can verify the public swap + approval each ran inside
// withNonceLock(ctx.wallet.address, ...).
const withNonceLockCalls: string[] = [];
vi.mock('../../../src/utils/nonceAuthority', () => ({
    withNonceLock: vi.fn(async (addr: string, op: () => Promise<unknown>) => {
        withNonceLockCalls.push(addr);
        return op();
    }),
}));

// Mock ethers Contract. balanceOf is controllable (drives sell-only-held +
// abort-on-zero); the V2 router methods (getAmountsOut +
// swapExactTokensForETHSupportingFeeOnTransferTokens) are observable so the
// public-fallback assertions can read amountIn / minOut. allowance returns 0 so
// the approval path fires (and is nonce-wrapped).
let balanceSequence: bigint[] = [];
let balanceCallCount = 0;
const swapFeeOnTransferMock = vi.fn();
const approveMock = vi.fn();
const getAmountsOutMock = vi.fn();

function nextBalance(): bigint {
    // Return the value at the current index, holding the last value for any
    // further calls (so the private leg's read and the guard re-fetch can differ).
    const idx = Math.min(balanceCallCount, balanceSequence.length - 1);
    balanceCallCount++;
    return balanceSequence[idx] ?? 0n;
}

vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(nextBalance());
        this.allowance = () => Promise.resolve(0n);
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
    } as unknown as Parameters<typeof import('../../../src/exitEngine').executeFullSell>[0];
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

const TOKEN = '0x12970E6868f88f6557B76120662c1B3E50A646bf'; // LADYS mainnet

// Pin the Finding A env knobs to their documented defaults so the reason-aware
// attempt-count + slippage assertions are HERMETIC regardless of the operator's
// .env (the CR-01 lesson: an operator override must not silently defeat the test).
const SAVED_ENV: Record<string, string | undefined> = {
    MEV_SELL_FALLBACK_ATTEMPTS: process.env.MEV_SELL_FALLBACK_ATTEMPTS,
    MEV_SELL_ANTIRUG_SLIPPAGE_PCT: process.env.MEV_SELL_ANTIRUG_SLIPPAGE_PCT,
};

afterEach(() => {
    for (const [k, v] of Object.entries(SAVED_ENV)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

beforeEach(() => {
    // Documented defaults (also in .env.example): routine = 2 private attempts,
    // anti-rug fallback slippage = 15%.
    process.env.MEV_SELL_FALLBACK_ATTEMPTS = '2';
    process.env.MEV_SELL_ANTIRUG_SLIPPAGE_PCT = '15';

    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    deleteExitStateRun.mockReset();
    clearAllTimersForTokenMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);
    releaseSellLockMock.mockReset();
    sendCtxAlertMock.mockReset();
    decodeReceiptMock.mockReset().mockResolvedValue({
        amountOut: '1000000000',
        gasCost: '0',
        blockNumber: 18_000_000,
    });
    unregisterAntiRugPositionMock.mockReset();
    reconcileInclusionMock.mockReset().mockResolvedValue({ outcome: 'not-landed' });

    // Private escalation: NOT landed by default → ladder goes to the guard +
    // public fallback. It reports the last attempt's signed hash + nonce so the
    // no-double-sell guard can reconcile the exact attempt.
    sendTxWithRetryMock.mockReset();
    escalatePrivateSellMock.mockReset().mockResolvedValue({
        landed: false,
        lastSignedHash: '0xlastprivateattempthash',
        lastNonce: 7,
    });

    swapFeeOnTransferMock.mockReset().mockResolvedValue({
        hash: '0xpublicsellhash',
        wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18_000_123 }),
    });
    approveMock.mockReset().mockResolvedValue({ wait: vi.fn().mockResolvedValue(null) });
    getAmountsOutMock.mockReset().mockResolvedValue([0n, 1_000_000_000_000_000n]); // ~0.001 ETH out

    markExitFailedHeldRun.mockReset();
    // Phase 21.2-07: the THIRD balanceOf read is the success-path post-sell
    // re-fetch (D-BALANCE-IS-TRUTH). A SUCCESSFUL public sell drops the balance to
    // ~0, so the trailing 0n makes the post-sell re-fetch read a GENUINE close
    // (teardown), preserving these Finding-A tests' original "sold" intent. (call
    // 1 = initial balance, call 2 = guard re-fetch / held amount, call 3 = post-sell.)
    balanceSequence = [1_000_000n, 1_000_000n, 0n];
    balanceCallCount = 0;
    withNonceLockCalls.length = 0;
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 21.2 / Finding A — executeFullSell inclusion ladder', () => {
    it('Test 1 (LADYS no-double-sell — CANONICAL): private reported not-included but reconcileInclusion finds it INCLUDED → public fallback ABORTED', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        // The private leg reports NOT landed (relay lied), but the no-double-sell
        // guard finds the last private attempt actually landed late (the LADYS /
        // STOP-THE-LINE-02 false-negative). The public fallback MUST be aborted.
        reconcileInclusionMock.mockResolvedValue({
            outcome: 'included',
            hash: '0xlateprivatelandedhash',
            receipt: { status: 1, blockNumber: 18_000_050 },
        });
        // The private bundle landed late (no guard re-fetch on the 'included'
        // branch). Calls: 1 = initial balance, 2 = success-path post-sell re-fetch
        // → 0n = genuine close (D-BALANCE-IS-TRUTH), so teardown runs as before.
        balanceSequence = [1_000_000n, 0n];
        balanceCallCount = 0;

        const result = await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 100, 'trailing stop',
        );

        // The guard ran on the last private attempt.
        expect(reconcileInclusionMock).toHaveBeenCalled();
        // CRITICAL (no-double-sell): the public swap is NOT submitted.
        expect(swapFeeOnTransferMock).not.toHaveBeenCalled();
        // Treated as a landed sell.
        expect(result).toBe(true);
        expect(updateTradeStatusRun).toHaveBeenCalledWith('sold', TOKEN.toLowerCase(), 'eth');
    });

    it('Test 2 (sell-only-held): private not-landed + reconcile not-landed → public sell uses the RE-FETCHED reduced balance as amountIn', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        // First balanceOf (private leg setup) returns the original; the guard
        // re-fetch returns a REDUCED amount → the public sell must use the reduced
        // balance as amountIn, NOT the original. The trailing 0n is the success-
        // path post-sell re-fetch (21.2-07) → genuine close → teardown.
        balanceSequence = [1_000_000n, 250_000n, 0n];
        balanceCallCount = 0;

        const result = await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 101, 'trailing stop',
        );

        expect(result).toBe(true);
        expect(swapFeeOnTransferMock).toHaveBeenCalledTimes(1);
        // amountIn (first positional arg) equals the RE-FETCHED reduced balance.
        const amountIn = swapFeeOnTransferMock.mock.calls[0][0] as bigint;
        expect(amountIn).toBe(250_000n);
    });

    it('Test 3 (abort on zero balance): re-fetched balanceOf returns 0 → public fallback aborts (no swap submitted)', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        // Private setup balance non-zero; guard re-fetch returns 0 (already sold).
        balanceSequence = [1_000_000n, 0n];
        balanceCallCount = 0;

        const result = await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 102, 'trailing stop',
        );

        // No public swap on a zero held balance.
        expect(swapFeeOnTransferMock).not.toHaveBeenCalled();
        // Zero held → the position is closed (treated as sold).
        expect(result).toBe(true);
        expect(updateTradeStatusRun).toHaveBeenCalledWith('sold', TOKEN.toLowerCase(), 'eth');
    });

    it('Test 4 (reason-aware attempts): anti-rug uses <=1 private attempt; routine uses MEV_SELL_FALLBACK_ATTEMPTS (2)', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        // Anti-rug: capture the attempt budget passed to the private escalation
        // (escalatePrivateSell arg slot 3).
        await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'anti-rug', 103, 'rug',
        );
        const antiRugAttempts = escalatePrivateSellMock.mock.calls[0][2] as number;
        expect(antiRugAttempts).toBeLessThanOrEqual(1);

        escalatePrivateSellMock.mockClear();
        // Reset the balance sequence for the SECOND executeFullSell call — the
        // anti-rug call above advanced balanceCallCount past the sequence (whose
        // tail is the post-sell 0n), so without this reset the routine call's
        // initial balance read would be 0 → zero-balance early return (no private
        // escalation). (call 1 = initial, 2 = guard re-fetch, 3 = post-sell close.)
        balanceSequence = [1_000_000n, 1_000_000n, 0n];
        balanceCallCount = 0;

        // Routine: default MEV_SELL_FALLBACK_ATTEMPTS = 2.
        await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 104, 'trailing stop',
        );
        const routineAttempts = escalatePrivateSellMock.mock.calls[0][2] as number;
        expect(routineAttempts).toBe(2);
    });

    it('Test 5 (reason-aware slippage): anti-rug public fallback uses WIDER slippage (>=10%) than a routine fallback (configured 5%)', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        // getAmountsOut → expectedOut = 1_000_000 wei so minOut math is exact.
        getAmountsOutMock.mockResolvedValue([0n, 1_000_000n]);

        // Routine fallback: 5% slippage → minOut = 950_000.
        await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 105, 'trailing stop',
        );
        const routineMinOut = swapFeeOnTransferMock.mock.calls[0][1] as bigint;

        swapFeeOnTransferMock.mockClear();
        getAmountsOutMock.mockResolvedValue([0n, 1_000_000n]);
        // Trailing 0n = the success-path post-sell re-fetch → genuine close (21.2-07).
        balanceSequence = [1_000_000n, 1_000_000n, 0n];
        balanceCallCount = 0;

        // Anti-rug fallback: wider (>=10%) slippage → minOut <= 900_000.
        await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'anti-rug', 106, 'rug',
        );
        const antiRugMinOut = swapFeeOnTransferMock.mock.calls[0][1] as bigint;

        // Anti-rug widens slippage → a LOWER minOut than routine.
        expect(antiRugMinOut).toBeLessThan(routineMinOut);
        // Routine = configured 5% slippage → minOut = 95% of expectedOut.
        expect(routineMinOut).toBe(950_000n);
        // Anti-rug >= 10% slippage → minOut <= 90% of expectedOut.
        expect(antiRugMinOut).toBeLessThanOrEqual(900_000n);
    });

    it('Test 6 (nonce-wrapped): the public fallback swap + approval each run inside withNonceLock(ctx.wallet.address, ...)', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 107, 'trailing stop',
        );

        // The public swap ran exactly once and the public-fallback approval fired.
        // EVERY signing op (private-leg approval + public-fallback approval + public
        // swap) routed through withNonceLock(ctx.wallet.address, ...). With the test
        // MockContract reporting allowance 0, both the private-leg and the public-
        // fallback approvals fire — so approveMock fires twice and there are >=3
        // nonce-lock acquisitions, all keyed on the wallet address.
        expect(swapFeeOnTransferMock).toHaveBeenCalledTimes(1);
        expect(approveMock).toHaveBeenCalledTimes(2);
        expect(withNonceLockCalls.length).toBeGreaterThanOrEqual(3);
        for (const addr of withNonceLockCalls) {
            expect(addr).toBe(WALLET);
        }
    });
});
