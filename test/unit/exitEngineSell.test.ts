// test/unit/exitEngineSell.test.ts
// Execution-path tests for executeFullSell and executePartialSell.
// Mocks decodeReceipt, sendTxWithRetry, and insertTrade to verify that decoded
// receipt data flows into insertTrade.run with non-null values, and that nulls
// are recorded when the legacy txManager path returns void.
//
// This file replaces the weaker grep-only verification from the initial
// 14-02-PLAN.md per REVIEWS.md action 8 (Codex HIGH severity).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock dependencies that exitEngine.ts imports at top level ----

const insertTradeRun = vi.fn();
const updateTradeStatusRun = vi.fn();
const deleteExitStateRun = vi.fn();

vi.mock('../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: deleteExitStateRun },
    // Phase 21.2-07: executeFullSell's balance-truth teardown persists a
    // still-held failed exit via markExitFailedHeld instead of deleteExitState.
    markExitFailedHeld: { run: vi.fn() },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

vi.mock('../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15,
        trailingMinPct: 5,
        trailingMaxPct: 40,
        stopLossPercent: 25,
        partialSellTargets: '2x:50,5x:25',
        exitPollIntervalMs: 5000,
        urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03,
        volatilityMaxSamples: 60,
        volatilityMinSamples: 12,
    },
}));

const tryAcquireSellLockMock = vi.fn().mockReturnValue(true);
vi.mock('../../src/utils/exitManager', () => ({
    tryAcquireSellLock: tryAcquireSellLockMock,
    releaseSellLock: vi.fn(),
    registerExitMonitor: vi.fn(),
    clearAllTimersForToken: vi.fn(),
    // Phase 21.2-07: executeFullSell's re-arm predicate (keepMonitoringFailedHeld)
    // reads hasExitMonitorTimer; return true so the happy-path full sells under
    // test report "timer still armed" and do not change behavior here. The
    // per-position queue helpers are also imported at module top.
    hasExitMonitorTimer: vi.fn().mockReturnValue(true),
    tryEnqueuePosition: vi.fn().mockReturnValue(true),
    releasePositionQueue: vi.fn(),
}));

vi.mock('../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn().mockResolvedValue(undefined),
}));

const sendTxWithRetryMock = vi.fn();
// Phase 21.2 / Plan 21.2-06: executeFullSell's private leg now routes through
// escalatePrivateSell (the Finding A inclusion ladder). The full-sell tests set
// this per-case; executePartialSell still uses sendTxWithRetry directly.
const escalatePrivateSellMock = vi.fn();
vi.mock('../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    escalatePrivateSell: escalatePrivateSellMock,
}));

// The no-double-sell guard probe (reconcileInclusion). Default not-landed.
const reconcileInclusionMock = vi.fn();
vi.mock('../../src/utils/mevStrategies/reconciliation', async () => {
    const actual = await vi.importActual<
        typeof import('../../src/utils/mevStrategies/reconciliation')
    >('../../src/utils/mevStrategies/reconciliation');
    return { ...actual, reconcileInclusion: reconcileInclusionMock };
});

// withNonceLock: passthrough wrapper (runs the op) for the nonce-locked submits.
vi.mock('../../src/utils/nonceAuthority', () => ({
    withNonceLock: vi.fn(async (_addr: string, op: () => Promise<unknown>) => op()),
}));

const decodeReceiptMock = vi.fn();
vi.mock('../../src/utils/receiptDecoder', () => ({
    decodeReceipt: decodeReceiptMock,
}));

// Mock ethers Contract so we don't actually hit a chain.
// Use a real class (not vi.fn().mockImplementation) so vitest's `mockReset: true`
// (set in vitest.config.ts) does NOT wipe the constructor between tests.
// `mockBalanceSequence` lets a test return a reduced/zero balance on the guard
// re-fetch (the no-double-sell sell-only-held / abort-on-zero paths).
let mockBalanceSequence: bigint[] = [1000000000000000000n];
let mockBalanceCall = 0;
function setBalanceSequence(seq: bigint[]) { mockBalanceSequence = seq; mockBalanceCall = 0; }
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    class MockContract {
        async balanceOf() {
            const idx = Math.min(mockBalanceCall, mockBalanceSequence.length - 1);
            mockBalanceCall++;
            return mockBalanceSequence[idx];
        }
        async allowance() { return 1n << 200n; } // huge allowance, no approval needed
        async approve() { return { wait: async () => ({}) }; }
        async getAmountsOut() { return [0n, 1000000000000000n]; }
        async swapExactTokensForETHSupportingFeeOnTransferTokens() {
            return { hash: '0xpublicfallback', wait: async () => ({ status: 1, blockNumber: 1 }) };
        }
    }
    return {
        ...actual,
        Contract: MockContract,
    };
});

// Import after mocks
let executeFullSell: typeof import('../../src/exitEngine')['executeFullSell'];
let executePartialSell: typeof import('../../src/exitEngine')['executePartialSell'];

const mockDex = {
    name: 'uni-v2',
    dexType: 'v2' as const,
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
} as any;

const mockCtx = {
    chain: {
        name: 'eth',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        gas: { maxGasLimit: 300_000n },
        mevStrategy: 'flashbots',
    },
    httpProvider: {} as any,
    wallet: { address: '0x1234567890abcdef1234567890abcdef12345678' } as any,
    log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
} as any;

beforeEach(async () => {
    // Note: vitest config has mockReset: true which resets call history but not implementations.
    // Re-establish the implementations the tests depend on.
    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    deleteExitStateRun.mockReset();
    sendTxWithRetryMock.mockReset();
    escalatePrivateSellMock.mockReset();
    reconcileInclusionMock.mockReset().mockResolvedValue({ outcome: 'not-landed' });
    decodeReceiptMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);
    setBalanceSequence([1000000000000000000n]);

    const mod = await import('../../src/exitEngine');
    executeFullSell = mod.executeFullSell;
    executePartialSell = mod.executePartialSell;
});

describe('executeFullSell — receipt decoding integration', () => {
    it('records non-null amountOut/gasCost/block when decodeReceipt returns data', async () => {
        // Private leg LANDS with the real hash → decodeReceipt runs on it.
        escalatePrivateSellMock.mockResolvedValue({
            landed: true,
            txHash: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc0',
        });
        decodeReceiptMock.mockResolvedValue({
            amountOut: '1000000000000000000',
            gasCost: '300000000000000',
            blockNumber: 12345,
        });
        // Phase 21.2-07 (D-BALANCE-IS-TRUTH): executeFullSell now re-fetches
        // balanceOf AFTER the sell and lets it — not the submit report — decide
        // teardown. Model a GENUINE close: read #1 (initial) = full balance so
        // the sell proceeds; read #2 (post-sell) = 0 so balanceOf confirms the
        // position closed and the success path returns true.
        setBalanceSequence([1000000000000000000n, 0n]);

        const ok = await executeFullSell(
            mockCtx,
            mockDex,
            '0xtokenaddress0000000000000000000000000000',
            null,
            'trailing-stop',
            1,
            'test reason',
        );

        expect(ok).toBe(true);
        expect(decodeReceiptMock).toHaveBeenCalledTimes(1);
        expect(decodeReceiptMock).toHaveBeenCalledWith(
            '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc0',
            mockCtx.httpProvider,
            mockCtx.chain.wethAddress,
            mockCtx.wallet.address,
        );
        expect(insertTradeRun).toHaveBeenCalledTimes(1);
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'sell',
                amountOut: '1000000000000000000',
                gasCost: '300000000000000',
                block: 12345,
            }),
        );
    });

    it('skips decodeReceipt and records nulls on a no-new-tx close (guard aborts public fallback — already sold)', async () => {
        // Phase 21.2-06: the legacy "sendTxWithRetry returns void" path was deleted
        // in 21.1. The equivalent no-new-tx close under the inclusion ladder is the
        // no-double-sell guard ABORTING the public fallback because the re-fetched
        // balance is 0 (the private bundle already sold). No new tx → txHash stays
        // null → decodeReceipt is skipped → the sell row records nulls.
        escalatePrivateSellMock.mockResolvedValue({
            landed: false,
            lastSignedHash: '0xlast',
            lastNonce: 5,
        });
        reconcileInclusionMock.mockResolvedValue({ outcome: 'not-landed' });
        // Initial balance read = 1 token; guard re-fetch = 0 (already sold).
        setBalanceSequence([1000000000000000000n, 0n]);
        decodeReceiptMock.mockResolvedValue({
            amountOut: 'SHOULD_NOT_BE_USED',
            gasCost: 'SHOULD_NOT_BE_USED',
            blockNumber: 99999,
        });

        const ok = await executeFullSell(
            mockCtx,
            mockDex,
            '0xtokenaddress0000000000000000000000000000',
            null,
            'trailing-stop',
            1,
            'test reason',
        );

        expect(ok).toBe(true);
        expect(decodeReceiptMock).not.toHaveBeenCalled();
        expect(insertTradeRun).toHaveBeenCalledTimes(1);
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'sell',
                amountOut: null,
                gasCost: null,
                block: null,
            }),
        );
    });
});

describe('executePartialSell — receipt decoding integration', () => {
    it('records non-null amountOut/gasCost/block when decodeReceipt returns data', async () => {
        sendTxWithRetryMock.mockResolvedValue('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '500000000000000000',
            gasCost: '150000000000000',
            blockNumber: 67890,
        });

        const state = {
            tradeId: 2,
            entryPrice: 1000,
            highWaterMark: 2500,
            trailingActivated: true,
            completedTierIndices: new Set<number>(),
            originalTokenAmount: 1000000000000000000n,
            urgencyStartTs: Date.now(),
            volatilityTracker: { getMultiplier: () => 1.0, addSample: vi.fn(), toJSON: () => '[]' } as any,
        };
        const tiers = [{ tier: { multiple: 2, percent: 50 }, index: 0 }];

        const ok = await executePartialSell(
            mockCtx,
            mockDex,
            '0xtokenaddress0000000000000000000000000000',
            null,
            500000000000000000n,
            tiers,
            state,
            2.0,
        );

        expect(ok).toBe(true);
        expect(decodeReceiptMock).toHaveBeenCalledTimes(1);
        expect(insertTradeRun).toHaveBeenCalledTimes(1);
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'partial_sell',
                amountOut: '500000000000000000',
                gasCost: '150000000000000',
                block: 67890,
            }),
        );
    });
});

// ---------------------------------------------------------------------------
// Phase 17 / DEBT-05 retroactive harm-prevention block.
// Phase 7 EXIT-01: executeFullSell accepts reason='stop-loss' as the discriminant
// and inserts an action='sell' row.
//
// SCOPE NOTE (WR-01 follow-up): This describe verifies the call-shape contract for
// reason='stop-loss' — i.e. that executeFullSell, when invoked with that exact
// reason string, submits a sell tx and writes a 'sell' DB row. It does NOT
// drive pollExitStrategy end-to-end; the wiring at src/exitEngine.ts:747-760
// (currentPrice <= entryPrice*(1-stopLossPct/100) → executeFullSell call) is
// covered by integration tests elsewhere. A regression that swapped the
// literal 'stop-loss' to 'trailing-stop' at exitEngine.ts:758 would NOT be
// caught by this describe — the describe-block claim has been downgraded to
// match the actual coverage. See test/integration/exitMonitor.test.ts for the
// polling-path tests.
// ---------------------------------------------------------------------------

describe('Phase 7 EXIT-01: executeFullSell accepts reason="stop-loss" discriminant and inserts action="sell" row', () => {
    it('submits sell tx and inserts a sell row when invoked with reason="stop-loss"', async () => {
        // Mock matrix already in scope from top of file.
        // The existing receipt-decoding tests cover executeFullSell call shape;
        // this test reinforces that the reason='stop-loss' discriminant is accepted and round-trips.

        // Phase 21.2-06: the full-sell submit now runs the inclusion ladder; the
        // private leg lands with the real hash (the success path is unchanged).
        escalatePrivateSellMock.mockResolvedValue({
            landed: true,
            txHash: '0xstoplossharmprevhash00000000000000000000000000000000000000000000',
        });
        decodeReceiptMock.mockResolvedValue({
            amountOut: '750000000000000000',
            gasCost: '200000000000000',
            blockNumber: 88888,
        });
        // Phase 21.2-07 (D-BALANCE-IS-TRUTH): model a GENUINE close so the
        // post-sell balanceOf re-fetch confirms the position closed (read #1 =
        // full balance → sell proceeds; read #2 = 0 → success path returns true).
        setBalanceSequence([1000000000000000000n, 0n]);

        // Drive executeFullSell directly with reason='stop-loss' (matches src/exitEngine.ts:758 call shape).
        // This validates the call shape; the upstream polling logic that computes the threshold
        // and dispatches with that exact reason string is intentionally NOT exercised here.
        const ok = await executeFullSell(
            mockCtx,
            mockDex,
            '0xharmprevtoken000000000000000000000000000',
            null,             // feeTier
            'stop-loss',      // EXIT-01 reason discriminant
            42,               // tradeId
            'Stop-loss harm-prevention test reason',
        );

        // D-04 observable effect 1: sell call returned true
        expect(ok).toBe(true);
        // D-04 observable effect 2: sell transaction submitted (via the private leg
        // of the inclusion ladder — escalatePrivateSell).
        expect(escalatePrivateSellMock).toHaveBeenCalledTimes(1);
        // D-04 observable effect 3: DB row inserted with action='sell'
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'sell',
                amountOut: '750000000000000000',
            }),
        );
    });
});

// ---------------------------------------------------------------------------
// Phase 17 / DEBT-05 retroactive harm-prevention block.
// Phase 10 partial-sell: partial_sell row insertion records non-null amountOut
// from decodeReceipt (legacy path returns null on void txHash, exercised by
// separate test).
//
// SCOPE NOTE (WR-02 follow-up): This describe verifies the row-insertion contract
// for executePartialSell — i.e. that when decodeReceipt returns data, insertTrade
// is called with action='partial_sell' and a non-null amountOut. It does NOT
// drive pollExitStrategy end-to-end; the wiring at src/exitEngine.ts:697-717
// (getUnfilledTiers → executePartialSell call) is covered by integration tests
// elsewhere. A regression that broke getUnfilledTiers or removed the
// executePartialSell call from the poll loop would NOT be caught by this
// describe — the describe-block claim has been downgraded to match the actual
// coverage.
// ---------------------------------------------------------------------------

describe('Phase 10 partial-sell: row insertion records non-null amountOut from decodeReceipt', () => {
    it('insertTrade is called with action="partial_sell" and non-null amountOut from decodeReceipt', async () => {
        sendTxWithRetryMock.mockResolvedValue('0xpartialsellharmprevhash000000000000000000000000000000000000000000');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '500000000000000000',
            gasCost: '150000000000000',
            blockNumber: 67890,
        });

        // ExitStateData shape per src/types — reuse the same loose-cast pattern as the existing
        // `executePartialSell — receipt decoding integration` describe at line 206+.
        const state = {
            tradeId: 7,
            entryPrice: 1000,
            highWaterMark: 2500,
            trailingActivated: true,
            completedTierIndices: new Set<number>(),
            originalTokenAmount: '1000000000000000000',
            urgencyStartTs: Date.now(),
            // NF-03 (21.2-14): executePartialSell now persists synchronously via
            // serializeExitState, which reads volatilityTracker.toJSON(); supply a
            // minimal stub so the persist does not throw in this loose-cast mock.
            volatilityTracker: { toJSON: () => '[]' },
        } as any;

        // Construct a minimal `tiers: { tier: PartialTier, index: number }[]` argument.
        // The PartialTier shape is `{ multiple: number, percent: number }` per exitConfig.partialSellTiers.
        // For this test we use a single-tier 50% sell at the 2x multiple ('tier-2x').
        const tiers = [
            { tier: { multiple: 2, percent: 50 }, index: 0 },
        ];

        // Invoke executePartialSell with the EXACT 8-parameter signature from src/exitEngine.ts:531-540.
        // Order: ctx, dex, tokenAddress, feeTier, sellAmount (bigint), tiers, state, currentMultiple.
        const result = await executePartialSell(
            mockCtx,
            mockDex,
            '0xpartialharmprevtoken00000000000000000000',
            null,                                  // feeTier (number | null)
            500_000_000_000_000_000n,              // sellAmount (bigint) — 0.5 ETH worth, matches mock amountOut
            tiers,                                 // tiers array (per PartialTier shape)
            state,                                 // ExitStateData (loose cast)
            2.0,                                   // currentMultiple (number) — at 2x trigger
        );

        // D-04 observable effect 1: insertTrade called with action='partial_sell' AND non-null amountOut
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'partial_sell',
                amountOut: '500000000000000000',  // non-null, matches mock
                gasCost: expect.any(String),
                block: expect.any(Number),
            }),
        );
        // D-04 observable effect 2: decodeReceipt was actually used (not the legacy null path)
        expect(decodeReceiptMock).toHaveBeenCalledTimes(1);

        // result is a return-status sentinel; the harm-prevention claim is on the DB-row side
        expect(result).toBe(true);
    });
});
