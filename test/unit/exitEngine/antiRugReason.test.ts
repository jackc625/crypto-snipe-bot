// test/unit/exitEngine/antiRugReason.test.ts
// Phase 19 Plan 19-05 / Task 1a — extend exitEngine.ts `executeFullSell` reason
// union to include 'anti-rug', wire elevated-gas branch reading
// ctx.chain.antiRug.gasMultiplier, and call unsubscribeAntiRug
// (re-export of detector.unregisterAntiRugPosition) on every full-close path
// per CONTEXT.md D-TERMINATION.
//
// Tests (1-7):
//
//   Test 1: executeFullSell(..., reason='anti-rug', ...) compiles — the union
//           accepts the new variant (verified via source grep + tsc clean).
//   Test 2: When reason='anti-rug', the gas-multiplier branch reads
//           ctx.chain.antiRug.gasMultiplier (default 2.0×) — verified by
//           source-grep for the conditional gasMultiplier derivation.
//   Test 3: When reason='trailing-stop' (existing variant), executeFullSell
//           still uses ctx.chain.gas.multiplier — verified by source-grep that
//           the gasMultiplier conditional preserves the original branch for
//           non-anti-rug reasons.
//   Test 4: On the full-close success path (line 504 area), executeFullSell
//           calls unsubscribeAntiRug(ctx.chain.name, tradeId) once after
//           deleteExitState.run(tradeId).
//   Test 5: On the early-zero-balance branch (line 442-447), executeFullSell
//           ALSO calls unsubscribeAntiRug (zero-balance still closes position).
//   Test 6: On the error path (line 511-513), executeFullSell ALSO calls
//           unsubscribeAntiRug (failed exit still terminates the subscription
//           per D-TERMINATION).
//   Test 7: The partial-sell path (executePartialSell at line 531+) does NOT
//           call unsubscribeAntiRug — partial sells leave position open and
//           rug risk persists per CONTEXT.md D-TERMINATION explicit phrasing.
//
// Tests 1-3 are source-text assertions because the gas-multiplier threading
// involves the builder closures which would require deep mocking of
// sendTxWithRetry / Contract / ABI to observe; the source-text check is the
// unambiguous structural assertion and the integration path is covered by
// the existing exit-engine integration tests.
//
// Tests 4-7 are mock-based runtime assertions of unsubscribeAntiRug call
// sites.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// -----------------------------------------------------------------------------
// Mocks: db, logger, notifier, txManager, receiptDecoder, exitManager, detector
// -----------------------------------------------------------------------------

const insertTradeRun = vi.fn();
const updateTradeStatusRun = vi.fn();
const deleteExitStateRun = vi.fn();

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: deleteExitStateRun },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        }),
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

const clearAllTimersForTokenMock = vi.fn();
const tryAcquireSellLockMock = vi.fn();
const releaseSellLockMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    tryAcquireSellLock: tryAcquireSellLockMock,
    releaseSellLock: releaseSellLockMock,
    clearAllTimersForToken: clearAllTimersForTokenMock,
    registerExitMonitor: vi.fn(),
}));

const sendCtxAlertMock = vi.fn();
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: sendCtxAlertMock,
}));

const sendTxWithRetryMock = vi.fn();
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
}));

const decodeReceiptMock = vi.fn();
vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: decodeReceiptMock,
}));

// detector mock: unregisterAntiRugPosition is the symbol called from
// exitEngine via the `unsubscribeAntiRug as unregisterAntiRugPosition`
// import rename. We mock the actual export name.
const unregisterAntiRugPositionMock = vi.fn();
vi.mock('../../../src/anti-rug/detector', () => ({
    unregisterAntiRugPosition: unregisterAntiRugPositionMock,
}));

// Mock ethers Contract to short-circuit the on-chain calls inside
// executeFullSell. We need balanceOf to be controllable and allowance/
// approve to no-op so the tests stay in pure-process land.
//
// Use a `function` constructor so `new Contract(...)` works — vi.fn()-based
// implementations are not callable as constructors per vitest's spy
// implementation.
let mockBalance: bigint = 1_000n;
function setMockBalance(b: bigint) {
    mockBalance = b;
}
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: { balanceOf: () => Promise<bigint>; allowance: () => Promise<bigint>; approve: () => Promise<{ wait: () => Promise<null> }>; interface: { encodeFunctionData: () => string } }) {
        this.balanceOf = () => Promise.resolve(mockBalance);
        this.allowance = () => Promise.resolve(0n);
        this.approve = () => Promise.resolve({ wait: () => Promise.resolve(null) });
        this.interface = {
            encodeFunctionData: () => '0xdeadbeef',
        };
    }
    return {
        ...actual,
        Contract: MockContract,
    };
});

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

function buildCtx(opts: { liveExecute?: boolean; gasMultiplier?: number } = {}) {
    return {
        chain: {
            name: 'eth',
            displayName: '[ETH]',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            gas: {
                multiplier: 1.2,
                maxGasLimit: 500_000n,
            },
            antiRug: {
                liveExecute: opts.liveExecute ?? true,
                gasMultiplier: opts.gasMultiplier ?? 2.0,
            },
        },
        wallet: {
            address: '0x1111111111111111111111111111111111111111',
        },
        httpProvider: {},
        log: {
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        },
    } as unknown as Parameters<typeof import('../../../src/exitEngine').executeFullSell>[0];
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

beforeEach(() => {
    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    deleteExitStateRun.mockReset();
    clearAllTimersForTokenMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);
    releaseSellLockMock.mockReset();
    sendCtxAlertMock.mockReset();
    sendTxWithRetryMock.mockReset().mockResolvedValue('0xtxhash');
    decodeReceiptMock.mockReset().mockResolvedValue({
        amountOut: '1000000000',
        gasCost: '0',
        blockNumber: 18_000_000,
    });
    unregisterAntiRugPositionMock.mockReset();
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

const exitEngineSource = readFileSync(
    resolve(__dirname, '../../../src/exitEngine.ts'),
    'utf8',
);

describe('Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup', () => {
    describe('Reason union + gas-multiplier source assertions (Tests 1-3)', () => {
        it("Test 1: the reason parameter type includes 'anti-rug'", () => {
            // Match the union declaration: reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug',
            // Allow whitespace/newlines between members.
            const unionMatch = /reason:\s*['"]trailing-stop['"]\s*\|\s*['"]stop-loss['"]\s*\|\s*['"]urgency-market-sell['"]\s*\|\s*['"]anti-rug['"]/;
            expect(exitEngineSource).toMatch(unionMatch);
        });

        it("Test 2: when reason='anti-rug', gasMultiplier is derived from ctx.chain.antiRug.gasMultiplier", () => {
            // The implementation should contain a conditional that picks
            // ctx.chain.antiRug.gasMultiplier for the anti-rug branch.
            // We accept either an explicit ternary or a conditional assignment
            // — and allow the two halves to span multiple lines.
            const antiRugBranch = /reason\s*===\s*['"]anti-rug['"][\s\S]{0,80}ctx\.chain\.antiRug\.gasMultiplier/;
            const altBranch = /ctx\.chain\.antiRug\.gasMultiplier[\s\S]{0,80}reason\s*===\s*['"]anti-rug['"]/;
            expect(
                antiRugBranch.test(exitEngineSource) || altBranch.test(exitEngineSource),
            ).toBe(true);
        });

        it("Test 3: when reason !== 'anti-rug', gasMultiplier is undefined (raw feeData; prior behavior preserved)", () => {
            // Phase 19 Gap-1 closure (2026-05-24): the original PLAN.md design
            // attempted to swap-in ctx.chain.gas.multiplier on non-anti-rug
            // branches, but the value was being discarded via `void` and never
            // reached the MEV-strategy fee-data layer (MEV strategies have
            // always consumed raw feeData). The Gap-1 fix replaces the
            // discard with a real threading through sendTxWithRetry's
            // gasMultiplier slot. For non-anti-rug reasons (trailing-stop /
            // stop-loss / urgency-market-sell), we pass `undefined` —
            // preserving exact prior behavior at the MEV layer (raw feeData,
            // no elevation).
            const undefinedBranch = /reason\s*===\s*['"]anti-rug['"][\s\S]{0,80}:\s*undefined/;
            expect(undefinedBranch.test(exitEngineSource)).toBe(true);
        });

        it("Test 3b: gasMultiplier is threaded into sendTxWithRetry (Gap-1 closure)", () => {
            // Phase 19 Gap-1 closure: the multiplier MUST actually reach the
            // MEV strategy via sendTxWithRetry's gasMultiplier arg-6 slot.
            // The pre-Gap-1 code discarded gasMultiplier via `void` — this
            // guard prevents that regression from creeping back in.
            expect(exitEngineSource).not.toContain('void gasMultiplier');
            // sendTxWithRetry must be called with gasMultiplier as the final
            // positional arg (slots 3-5 are intentionally undefined for the
            // multi-chain ChainContext overload — see txManager.ts).
            const sendTxWithGasMultiplier = /sendTxWithRetry\(\s*txBuilder\s*,\s*ctx\s*,[\s\S]{0,80}gasMultiplier\s*\)/;
            expect(sendTxWithGasMultiplier.test(exitEngineSource)).toBe(true);
        });
    });

    describe('unsubscribeAntiRug call sites (Tests 4-7)', () => {
        it('Test 4: full-close success path calls unsubscribeAntiRug after deleteExitState.run', async () => {
            const { executeFullSell } = await import('../../../src/exitEngine');

            const ctx = buildCtx();
            const result = await executeFullSell(
                ctx,
                V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
                '0xToken00000000000000000000000000000000T01',
                null,
                'anti-rug',
                42,
                'LP removed 80% by 0xdEaD; 90% sell-sim slippage',
            );

            expect(result).toBe(true);
            expect(deleteExitStateRun).toHaveBeenCalledWith(42);
            expect(unregisterAntiRugPositionMock).toHaveBeenCalledWith('eth', 42);
            // unsubscribe is called AFTER deleteExitState — assert call order
            const deleteOrder = deleteExitStateRun.mock.invocationCallOrder[0];
            const unsubscribeOrder = unregisterAntiRugPositionMock.mock.invocationCallOrder[0];
            expect(unsubscribeOrder).toBeGreaterThan(deleteOrder);
        });

        it('Test 5: zero-balance branch ALSO calls unsubscribeAntiRug', async () => {
            const { executeFullSell } = await import('../../../src/exitEngine');

            // Force balanceOf to return 0n by flipping the shared mockBalance
            // variable consumed by the MockContract constructor in vi.mock above.
            setMockBalance(0n);

            const ctx = buildCtx();
            const result = await executeFullSell(
                ctx,
                V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
                '0xToken00000000000000000000000000000000T02',
                null,
                'anti-rug',
                43,
                'Zero balance test',
            );

            // Restore for other tests.
            setMockBalance(1_000n);

            // The zero-balance branch returns true and cleans up
            expect(result).toBe(true);
            expect(deleteExitStateRun).toHaveBeenCalledWith(43);
            expect(unregisterAntiRugPositionMock).toHaveBeenCalledWith('eth', 43);
        });

        it('Test 6: error path ALSO calls unsubscribeAntiRug', async () => {
            const { executeFullSell } = await import('../../../src/exitEngine');

            // Force sendTxWithRetry to throw so executeFullSell takes the catch branch.
            sendTxWithRetryMock.mockReset().mockRejectedValueOnce(new Error('tx revert'));

            const ctx = buildCtx();
            const result = await executeFullSell(
                ctx,
                V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
                '0xToken00000000000000000000000000000000T03',
                null,
                'anti-rug',
                44,
                'Error path test',
            );

            expect(result).toBe(false);
            expect(updateTradeStatusRun).toHaveBeenCalledWith(
                'failed',
                '0xtoken00000000000000000000000000000000t03',
                'eth',
            );
            expect(deleteExitStateRun).toHaveBeenCalledWith(44);
            expect(unregisterAntiRugPositionMock).toHaveBeenCalledWith('eth', 44);
        });

        it('Test 7: executePartialSell does NOT call unsubscribeAntiRug', async () => {
            // Partial sells leave position open per D-TERMINATION. Source-text
            // assertion is the cleanest guard: the executePartialSell function
            // body (between its declaration and the next exported function /
            // function-closer) must contain ZERO unsubscribeAntiRug or
            // unregisterAntiRugPosition references.
            //
            // Source file may use CRLF or LF endings — normalize to LF before
            // matching the function body to keep this assertion portable.
            const normalized = exitEngineSource.replace(/\r\n/g, '\n');
            const partialSellMatch = normalized.match(
                /export async function executePartialSell[\s\S]*?\n}\n/,
            );
            expect(partialSellMatch).toBeTruthy();
            const partialSellBody = partialSellMatch![0];
            expect(partialSellBody).not.toContain('unsubscribeAntiRug');
            expect(partialSellBody).not.toContain('unregisterAntiRugPosition');
        });
    });
});
