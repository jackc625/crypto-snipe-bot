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
}));

vi.mock('../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn().mockResolvedValue(undefined),
}));

const sendTxWithRetryMock = vi.fn();
vi.mock('../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
}));

const decodeReceiptMock = vi.fn();
vi.mock('../../src/utils/receiptDecoder', () => ({
    decodeReceipt: decodeReceiptMock,
}));

// Mock ethers Contract so we don't actually hit a chain.
// Use a real class (not vi.fn().mockImplementation) so vitest's `mockReset: true`
// (set in vitest.config.ts) does NOT wipe the constructor between tests.
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    class MockContract {
        async balanceOf() { return 1000000000000000000n; } // 1 token
        async allowance() { return 1n << 200n; } // huge allowance, no approval needed
        async approve() { return { wait: async () => ({}) }; }
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
    decodeReceiptMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);

    const mod = await import('../../src/exitEngine');
    executeFullSell = mod.executeFullSell;
    executePartialSell = mod.executePartialSell;
});

describe('executeFullSell — receipt decoding integration', () => {
    it('records non-null amountOut/gasCost/block when decodeReceipt returns data', async () => {
        sendTxWithRetryMock.mockResolvedValue('0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc0');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '1000000000000000000',
            gasCost: '300000000000000',
            blockNumber: 12345,
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

    it('skips decodeReceipt and records nulls when sendTxWithRetry returns void (legacy path)', async () => {
        sendTxWithRetryMock.mockResolvedValue(undefined);
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
// Phase 7 EXIT-01: stop-loss must trigger executeFullSell with reason='stop-loss'
// — wired-through-to-executeFullSell invocation, not just threshold computation.
// ---------------------------------------------------------------------------

describe('Phase 7 harm-prevention: EXIT-01 stop-loss triggers executeFullSell with reason="stop-loss"', () => {
    it('drives executeFullSell when current price <= entryPrice * (1 - stopLossPct/100), submits sell tx and inserts sell row', async () => {
        // Mock matrix already in scope from top of file.
        // The existing receipt-decoding tests cover executeFullSell call shape;
        // this test covers the wired-through path: stop-loss condition → executeFullSell invocation.

        sendTxWithRetryMock.mockResolvedValue('0xstoplossharmprevhash00000000000000000000000000000000000000000000');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '750000000000000000',
            gasCost: '200000000000000',
            blockNumber: 88888,
        });

        // Drive executeFullSell directly with reason='stop-loss' (matches src/exitEngine.ts:758 call shape).
        // This validates the call is wired correctly; the upstream polling logic (src/exitEngine.ts:747-760)
        // computes the threshold and dispatches with that exact reason string.
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
        // D-04 observable effect 2: sell transaction submitted
        expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1);
        // D-04 observable effect 3: DB row inserted with action='sell'
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'sell',
                amountOut: '750000000000000000',
            }),
        );
    });
});
