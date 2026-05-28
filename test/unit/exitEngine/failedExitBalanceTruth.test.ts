// test/unit/exitEngine/failedExitBalanceTruth.test.ts
// Phase 21.2 / Plan 21.2-07 — Finding D balance-truth teardown.
// D-FAILED-EXIT-KEEP-MONITORING + D-BALANCE-IS-TRUTH + D-PERSIST-FAILED-HELD.
//
// THE CAPITAL-SAFETY CROWN JEWEL. The cardinal invariant under test: a failed
// exit must NEVER strip anti-rug protection from a STILL-HELD position. Teardown
// is gated on a RE-FETCHED on-chain balanceOf (the only signal that did not lie
// in the LADYS harm). All assertions are OBSERVABLE-EFFECT based (no hollow
// expect(true)): unsubscribeAntiRug / deleteExitState NOT called on a still-held
// failure; markExitFailedHeld called; registerExitMonitor (re-arm) called; the
// routine pause skips a 6th submit; anti-rug bypasses the pause.
//
// Mock harness mirrors antiRugReason.test.ts (the Finding-D regression sibling).
//
// Tests:
//   1 CANONICAL keep-monitoring: failed exit, balanceOf > dust → KEEP anti-rug
//     (unsubscribe NOT called), NO deleteExitState, markExitFailedHeld called,
//     poll timer re-armed.
//   2 Genuine close: failed exit, balanceOf <= dust → teardown (unsubscribe +
//     deleteExitState) exactly as a real close.
//   3 Bounded routine retries: after N=5 routine failures the position pauses; a
//     6th ROUTINE trigger does NOT submit (escalatePrivateSell not called).
//   4 Anti-rug bypasses the pause: with routine paused, an anti-rug exit STILL
//     submits (escalatePrivateSell called).
//   5 Re-arm after a failed anti-rug exit on a still-held position: timer was
//     cleared (hasExitMonitorTimer=false) → registerExitMonitor re-armed AND
//     anti-rug KEPT (BOTH present).
//   6 Dust threshold boundary: exactly at the dust threshold → closed (teardown);
//     just above → held (keep monitoring).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const insertTradeRun = vi.fn();
const updateTradeStatusRun = vi.fn();
const deleteExitStateRun = vi.fn();
const markExitFailedHeldRun = vi.fn();
const upsertExitStateRun = vi.fn();

// getExitState drives BOTH readOriginalTokenAmount (dust threshold) AND the
// re-read of exit_failure_count after markExitFailedHeld. We make it return a
// controllable row so the test can dial original_token_amount + the counter.
let exitStateRow: {
    trade_id: number;
    entry_price: number;
    high_water_mark: number;
    trailing_activated: number;
    partial_tiers_completed: string;
    original_token_amount: string;
    urgency_start_ts: number;
    volatility_samples: string;
    exit_failure_count?: number;
    exit_status?: string | null;
} = {
    trade_id: 1,
    entry_price: 1,
    high_water_mark: 1,
    trailing_activated: 0,
    partial_tiers_completed: '[]',
    original_token_amount: '1000000000000000000000', // 1000e18 — a large original
    urgency_start_ts: Date.now(),
    volatility_samples: '[1]',
    exit_failure_count: 0,
    exit_status: null,
};
function setExitFailureCount(n: number) { exitStateRow.exit_failure_count = n; }
function setOriginalTokenAmount(s: string) { exitStateRow.original_token_amount = s; }

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    upsertExitState: { run: upsertExitStateRun },
    getExitState: { get: () => exitStateRow },
    deleteExitState: { run: deleteExitStateRun },
    markExitFailedHeld: { run: markExitFailedHeldRun },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
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
const registerExitMonitorMock = vi.fn();
const hasExitMonitorTimerMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    tryAcquireSellLock: tryAcquireSellLockMock,
    releaseSellLock: releaseSellLockMock,
    clearAllTimersForToken: clearAllTimersForTokenMock,
    registerExitMonitor: registerExitMonitorMock,
    hasExitMonitorTimer: hasExitMonitorTimerMock,
    tryEnqueuePosition: vi.fn().mockReturnValue(true),
    releasePositionQueue: vi.fn(),
}));

const withNonceLockMock = vi.fn(async (_addr: string, op: () => Promise<unknown>) => op());
vi.mock('../../../src/utils/nonceAuthority', () => ({
    withNonceLock: withNonceLockMock,
}));

const sendCtxAlertMock = vi.fn();
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: sendCtxAlertMock,
}));

const sendTxWithRetryMock = vi.fn();
const escalatePrivateSellMock = vi.fn();
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    escalatePrivateSell: escalatePrivateSellMock,
}));

const reconcileInclusionMock = vi.fn();
const buildReconcileConfigMock = vi.fn();
vi.mock('../../../src/utils/mevStrategies/reconciliation', () => ({
    reconcileInclusion: reconcileInclusionMock,
    buildReconcileConfig: buildReconcileConfigMock,
}));

const decodeReceiptMock = vi.fn();
vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: decodeReceiptMock,
}));

const unregisterAntiRugPositionMock = vi.fn();
vi.mock('../../../src/anti-rug/detector', () => ({
    unregisterAntiRugPosition: unregisterAntiRugPositionMock,
}));

// MockContract.balanceOf returns the head of a queue (so we can simulate the
// initial balance read THEN the post-sell / catch re-fetch returning a different
// value). When the queue is exhausted, the last value repeats.
let balanceQueue: bigint[] = [1_000_000_000_000_000_000_000n];
function setBalanceSequence(...vals: bigint[]) { balanceQueue = vals.slice(); }
function nextBalance(): bigint {
    if (balanceQueue.length > 1) return balanceQueue.shift()!;
    return balanceQueue[0];
}
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(nextBalance());
        this.allowance = () => Promise.resolve(0n);
        this.approve = () => Promise.resolve({ wait: () => Promise.resolve(null) });
        this.getAmountsOut = () => Promise.resolve([0n, 0n]);
        this.swapExactTokensForETHSupportingFeeOnTransferTokens = () =>
            Promise.resolve({ hash: '0xpublic', wait: () => Promise.resolve({ blockNumber: 1 }) });
        this.interface = { encodeFunctionData: () => '0xdeadbeef' };
    }
    return { ...actual, Contract: MockContract };
});

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function buildCtx() {
    return {
        chain: {
            name: 'eth',
            displayName: '[ETH]',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            snipeAmount: '0.01',
            gas: { multiplier: 1.2, maxGasLimit: 500_000n },
            antiRug: { liveExecute: true, gasMultiplier: 2.0 },
        },
        wallet: { address: '0x1111111111111111111111111111111111111111' },
        httpProvider: {},
        log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() },
    } as unknown as Parameters<typeof import('../../../src/exitEngine').executeFullSell>[0];
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};
const TOKEN = '0xToken00000000000000000000000000000000T07';

// Large held balance (well above the dust threshold for a 1000e18 original).
const HELD = 252_930_777_000_000_000_000n;

beforeEach(async () => {
    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    deleteExitStateRun.mockReset();
    markExitFailedHeldRun.mockReset();
    upsertExitStateRun.mockReset();
    clearAllTimersForTokenMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);
    releaseSellLockMock.mockReset();
    registerExitMonitorMock.mockReset();
    // Default: the timer IS still armed (a failed ROUTINE exit never cleared it),
    // so the re-arm does NOT double-fire. Anti-rug tests flip this to false.
    hasExitMonitorTimerMock.mockReset().mockReturnValue(true);
    withNonceLockMock.mockClear();
    sendCtxAlertMock.mockReset();
    sendTxWithRetryMock.mockReset().mockResolvedValue('0xtxhash');
    escalatePrivateSellMock.mockReset();
    reconcileInclusionMock.mockReset().mockResolvedValue({ outcome: 'not-landed', hash: null });
    buildReconcileConfigMock.mockReset().mockReturnValue({ confirmWindowMs: 1000, pollMs: 100 });
    decodeReceiptMock.mockReset().mockResolvedValue({ amountOut: '1', gasCost: '0', blockNumber: 1 });
    unregisterAntiRugPositionMock.mockReset();
    setExitFailureCount(0);
    setOriginalTokenAmount('1000000000000000000000');
    setBalanceSequence(HELD);
    delete process.env.EXIT_DUST_THRESHOLD_BPS;
    delete process.env.EXIT_ROUTINE_MAX_FAILURES;

    const { _resetRoutinePauseForTesting } = await import('../../../src/exitEngine');
    _resetRoutinePauseForTesting();
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 21.2 / Finding D — balance-truth failed-exit teardown', () => {
    it('Test 1 (CANONICAL): a failed exit on a STILL-HELD position KEEPS anti-rug + persists exit_failed_held + re-arms the poll timer', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');
        // The private leg throws → catch. balanceOf re-fetch returns HELD (> dust).
        escalatePrivateSellMock.mockRejectedValueOnce(new Error('tx revert'));
        setBalanceSequence(HELD, HELD);
        // Simulate the anti-rug path having cleared the timer before the sell so
        // the re-arm is observable (registerExitMonitor called).
        hasExitMonitorTimerMock.mockReturnValue(false);

        const ctx = buildCtx();
        const result = await executeFullSell(
            ctx, V2_DEX as never, TOKEN, null, 'anti-rug', 44, 'still-held failure',
        );

        expect(result).toBe(false);
        // CROWN JEWEL: rug protection KEPT + state KEPT.
        expect(unregisterAntiRugPositionMock).not.toHaveBeenCalled();
        expect(deleteExitStateRun).not.toHaveBeenCalled();
        // exit_failed_held persisted (status + counter increment).
        expect(markExitFailedHeldRun).toHaveBeenCalledWith(44);
        // Poll timer re-armed (the position keeps being monitored/retried).
        expect(registerExitMonitorMock).toHaveBeenCalled();
    });

    it('Test 2: a failed exit on a GENUINELY-CLOSED position (balanceOf <= dust) tears down exactly as a real close', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');
        escalatePrivateSellMock.mockRejectedValueOnce(new Error('tx revert'));
        // Initial balance non-zero (so we get past the zero-balance early return),
        // then the catch re-fetch returns 0 → genuine close.
        setBalanceSequence(HELD, 0n);

        const ctx = buildCtx();
        const result = await executeFullSell(
            ctx, V2_DEX as never, TOKEN, null, 'anti-rug', 45, 'closed failure',
        );

        expect(result).toBe(false);
        // Genuine close → FULL teardown.
        expect(deleteExitStateRun).toHaveBeenCalledWith(45);
        expect(unregisterAntiRugPositionMock).toHaveBeenCalledWith('eth', 45);
        // NOT persisted as failed-held (it closed).
        expect(markExitFailedHeldRun).not.toHaveBeenCalled();
    });

    it('Test 3: after N=5 consecutive ROUTINE failures, routine retries pause — a 6th routine trigger does NOT submit', async () => {
        process.env.EXIT_ROUTINE_MAX_FAILURES = '5';
        const { executeFullSell } = await import('../../../src/exitEngine');

        // The 5th failure pushes exit_failure_count to 5 → pause set.
        setExitFailureCount(5);
        escalatePrivateSellMock.mockRejectedValueOnce(new Error('tx revert'));
        setBalanceSequence(HELD, HELD);

        const ctx = buildCtx();
        const r5 = await executeFullSell(ctx, V2_DEX as never, TOKEN, null, 'stop-loss', 46, 'routine failure 5');
        expect(r5).toBe(false);
        expect(markExitFailedHeldRun).toHaveBeenCalledWith(46);

        // 6th ROUTINE trigger while paused → skipped before any submit.
        escalatePrivateSellMock.mockClear();
        const r6 = await executeFullSell(ctx, V2_DEX as never, TOKEN, null, 'stop-loss', 46, 'routine trigger 6');
        expect(r6).toBe(false);
        expect(escalatePrivateSellMock).not.toHaveBeenCalled();
    });

    it('Test 4: with routine retries paused, an ANTI-RUG exit STILL fires (bypasses the pause)', async () => {
        process.env.EXIT_ROUTINE_MAX_FAILURES = '5';
        const { executeFullSell, isRoutinePaused } = await import('../../../src/exitEngine');

        // Drive a routine failure that trips the pause.
        setExitFailureCount(5);
        escalatePrivateSellMock.mockRejectedValueOnce(new Error('tx revert'));
        setBalanceSequence(HELD, HELD);
        const ctx = buildCtx();
        await executeFullSell(ctx, V2_DEX as never, TOKEN, null, 'stop-loss', 47, 'routine failure 5');
        expect(isRoutinePaused('eth', TOKEN)).toBe(true);

        // Now an anti-rug exit: it must NOT be skipped — it submits.
        escalatePrivateSellMock.mockReset();
        escalatePrivateSellMock.mockResolvedValue({ landed: true, txHash: '0xanti' });
        setBalanceSequence(HELD, 0n); // sell succeeds + closes
        const rAnti = await executeFullSell(ctx, V2_DEX as never, TOKEN, null, 'anti-rug', 47, 'anti-rug bypass');
        expect(escalatePrivateSellMock).toHaveBeenCalled();
        expect(rAnti).toBe(true);
    });

    it('Test 5: a failed ANTI-RUG exit on a still-held position re-arms the poll timer AND keeps anti-rug (BOTH present)', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');
        // The anti-rug path clears the timer before the sell (exitTrigger.ts:222);
        // simulate that the timer is now absent.
        hasExitMonitorTimerMock.mockReturnValue(false);
        escalatePrivateSellMock.mockRejectedValueOnce(new Error('tx revert'));
        setBalanceSequence(HELD, HELD);

        const ctx = buildCtx();
        await executeFullSell(ctx, V2_DEX as never, TOKEN, null, 'anti-rug', 48, 'anti-rug failed still-held');

        // BOTH: poll timer re-armed AND anti-rug NOT unsubscribed.
        expect(registerExitMonitorMock).toHaveBeenCalled();
        expect(unregisterAntiRugPositionMock).not.toHaveBeenCalled();
    });

    it('Test 6: dust threshold boundary — exactly at threshold = closed (teardown); just above = held (keep monitoring)', async () => {
        process.env.EXIT_DUST_THRESHOLD_BPS = '1'; // 0.01% of 1000e18 = 1e17
        const original = '1000000000000000000000'; // 1000e18
        setOriginalTokenAmount(original);
        const dust = (1000000000000000000000n * 1n) / 10_000n; // 1e17

        // --- AT the dust threshold → treated as CLOSED ---
        const { executeFullSell } = await import('../../../src/exitEngine');
        escalatePrivateSellMock.mockRejectedValueOnce(new Error('revert'));
        setBalanceSequence(HELD, dust); // re-fetch returns exactly dust
        const ctxClosed = buildCtx();
        await executeFullSell(ctxClosed, V2_DEX as never, TOKEN, null, 'anti-rug', 49, 'at-threshold');
        expect(deleteExitStateRun).toHaveBeenCalledWith(49);
        expect(unregisterAntiRugPositionMock).toHaveBeenCalledWith('eth', 49);

        // --- JUST ABOVE the dust threshold → treated as HELD ---
        deleteExitStateRun.mockReset();
        unregisterAntiRugPositionMock.mockReset();
        markExitFailedHeldRun.mockReset();
        escalatePrivateSellMock.mockReset().mockRejectedValueOnce(new Error('revert'));
        setBalanceSequence(HELD, dust + 1n); // one wei above dust
        const ctxHeld = buildCtx();
        await executeFullSell(ctxHeld, V2_DEX as never, TOKEN, null, 'anti-rug', 50, 'just-above-threshold');
        expect(deleteExitStateRun).not.toHaveBeenCalled();
        expect(unregisterAntiRugPositionMock).not.toHaveBeenCalled();
        expect(markExitFailedHeldRun).toHaveBeenCalledWith(50);
    });
});
