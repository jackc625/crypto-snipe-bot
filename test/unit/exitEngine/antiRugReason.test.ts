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
//   Test 6 (INVERTED — Phase 21.2 / Plan 21.2-07, Finding D): on a failed exit
//           of a STILL-HELD position (re-fetched balanceOf > dust), executeFullSell
//           does NOT call unsubscribeAntiRug and does NOT call deleteExitState —
//           it KEEPS anti-rug + the poll timer and persists exit_failed_held. The
//           PRE-21.2-07 assertion (the error path unsubscribes "per D-TERMINATION")
//           ENCODED THE CAPITAL-SAFETY BUG (it stripped rug protection from a still-
//           held position — the LADYS harm). D-TERMINATION correctly means "tear
//           down when the position CLOSES"; balanceOf is the source of truth.
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
// Phase 21.2 / Plan 21.2-07 (Finding D): the balance-truth catch persists
// exit_failed_held via markExitFailedHeld INSTEAD of deleteExitState on a still-
// held failure. getExitState is now consulted for the dust threshold's
// original_token_amount + the re-read exit_failure_count, so it returns a
// controllable row (the inverted Test 6 dials a large original so a held balance
// reads as > dust).
const markExitFailedHeldRun = vi.fn();
let exitStateRow: Record<string, unknown> | undefined = undefined;
function setExitStateRow(row: Record<string, unknown> | undefined) { exitStateRow = row; }

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: () => exitStateRow },
    deleteExitState: { run: deleteExitStateRun },
    markExitFailedHeld: { run: markExitFailedHeldRun },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
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
// Phase 21.2-07: hasExitMonitorTimer gates the re-arm decision; registerExitMonitor
// is the observable effect of a re-arm (resumeExitMonitor re-creates the interval).
const hasExitMonitorTimerMock = vi.fn();
const registerExitMonitorMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    tryAcquireSellLock: tryAcquireSellLockMock,
    releaseSellLock: releaseSellLockMock,
    clearAllTimersForToken: clearAllTimersForTokenMock,
    registerExitMonitor: registerExitMonitorMock,
    hasExitMonitorTimer: hasExitMonitorTimerMock,
    tryEnqueuePosition: vi.fn().mockReturnValue(true),
    releasePositionQueue: vi.fn(),
}));

// Phase 21.2-07: the still-held keep-monitoring path re-arms via resumeExitMonitor,
// which (for a row present) only re-creates the interval; the nonce authority +
// reconciliation are mocked so any code path that touches them stays in-process.
const withNonceLockMock = vi.fn(async (_addr: string, op: () => Promise<unknown>) => op());
vi.mock('../../../src/utils/nonceAuthority', () => ({
    withNonceLock: withNonceLockMock,
}));
vi.mock('../../../src/utils/mevStrategies/reconciliation', () => ({
    reconcileInclusion: vi.fn().mockResolvedValue({ outcome: 'not-landed', hash: null }),
    buildReconcileConfig: vi.fn().mockReturnValue({ confirmWindowMs: 1000, pollMs: 100 }),
}));

const sendCtxAlertMock = vi.fn();
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: sendCtxAlertMock,
}));

const sendTxWithRetryMock = vi.fn();
// Phase 21.2 / Plan 21.2-06: executeFullSell's private leg now routes through
// escalatePrivateSell (the Finding A inclusion ladder). Default LANDED so these
// Phase 19 reason-union / cleanup tests keep their original success semantics.
const escalatePrivateSellMock = vi.fn();
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    escalatePrivateSell: escalatePrivateSellMock,
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
            // Phase 21.2-07: the still-held re-arm path calls resumeExitMonitor,
            // which reads ctx.chain.snipeAmount as the buy-amount baseline
            // (parseEther) — mirror the startup resume convention (bot.ts:1289).
            snipeAmount: '0.01',
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
    markExitFailedHeldRun.mockReset();
    clearAllTimersForTokenMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);
    releaseSellLockMock.mockReset();
    registerExitMonitorMock.mockReset();
    // Default: the poll timer is still armed (a failed ROUTINE exit never cleared
    // it). The inverted Test 6 flips this to false to observe the anti-rug re-arm.
    hasExitMonitorTimerMock.mockReset().mockReturnValue(true);
    sendCtxAlertMock.mockReset();
    sendTxWithRetryMock.mockReset().mockResolvedValue('0xtxhash');
    // Default: the private leg LANDS (inclusion ladder happy path) so the
    // success / zero-balance cleanup assertions are unchanged from Phase 19.
    escalatePrivateSellMock.mockReset().mockResolvedValue({ landed: true, txHash: '0xtxhash' });
    decodeReceiptMock.mockReset().mockResolvedValue({
        amountOut: '1000000000',
        gasCost: '0',
        blockNumber: 18_000_000,
    });
    unregisterAntiRugPositionMock.mockReset();
    // Default: no exit_state row → dust threshold falls to its absolute floor, so
    // the default 1_000n mockBalance reads as a genuine close on the success path
    // (Tests 4/5 unchanged). Tests that exercise the still-held branch set a row.
    setExitStateRow(undefined);
    setMockBalance(1_000n);
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

        it("Test 3b: gasMultiplier is threaded into the private escalation (Gap-1 closure + Finding A)", () => {
            // Phase 19 Gap-1 closure: the multiplier MUST actually reach the MEV
            // strategy. The pre-Gap-1 code discarded gasMultiplier via `void` —
            // this guard prevents that regression from creeping back in.
            expect(exitEngineSource).not.toContain('void gasMultiplier');
            // Phase 21.2-06 (Finding A inclusion ladder): the full-sell private leg
            // is now escalatePrivateSell(txBuilder, ctx, attempts, gasMultiplier) —
            // the multiplier remains threaded through to the MEV strategy (escalate
            // PrivateSell forwards it to sendTxWithRetry). Assert the gasMultiplier
            // reaches the private escalation as its final positional arg.
            const escalateWithGasMultiplier = /escalatePrivateSell\(\s*txBuilder\s*,\s*ctx\s*,[\s\S]{0,80}gasMultiplier\s*\)/;
            expect(escalateWithGasMultiplier.test(exitEngineSource)).toBe(true);
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

        it('Test 6 (INVERTED — Finding D): a failed exit on a STILL-HELD position KEEPS anti-rug + the poll timer + persists exit_failed_held (does NOT unsubscribe / deleteExitState)', async () => {
            const { executeFullSell, _resetRoutinePauseForTesting } = await import('../../../src/exitEngine');
            _resetRoutinePauseForTesting();

            // Force the private escalation to throw → executeFullSell takes the
            // catch branch. The CATCH now re-fetches balanceOf and gates teardown
            // on it (21.2-07 balance-truth). Configure the position as STILL HELD:
            //   * a large original_token_amount so the dust threshold is large…
            //   * …but a balanceOf WAY above dust (the LADYS evidence amount).
            escalatePrivateSellMock.mockReset().mockRejectedValueOnce(new Error('tx revert'));
            setExitStateRow({
                trade_id: 44,
                entry_price: 1,
                high_water_mark: 1,
                trailing_activated: 0,
                partial_tiers_completed: '[]',
                original_token_amount: '252930777000000000000', // ~252.9 (the LADYS held amount)
                urgency_start_ts: Date.now(),
                volatility_samples: '[1]',
                exit_failure_count: 1,
                exit_status: 'exit_failed_held',
            });
            // balanceOf returns the still-held LADYS amount (>> dust) on BOTH the
            // initial read and the catch re-fetch.
            setMockBalance(252_930_777_000_000_000_000n);
            // The anti-rug live-exit path cleared the poll timer before the sell
            // (exitTrigger.ts:222); simulate that so the re-arm is observable.
            hasExitMonitorTimerMock.mockReturnValue(false);

            const ctx = buildCtx();
            const result = await executeFullSell(
                ctx,
                V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
                '0xToken00000000000000000000000000000000T03',
                null,
                'anti-rug',
                44,
                'Still-held failed exit (keep monitoring)',
            );

            // Restore default balance for sibling tests.
            setMockBalance(1_000n);

            expect(result).toBe(false);
            // THE CROWN-JEWEL INVERSION: a failed STILL-HELD exit must NOT strip
            // rug protection and must NOT delete the restart-resume state.
            expect(unregisterAntiRugPositionMock).not.toHaveBeenCalled();
            expect(deleteExitStateRun).not.toHaveBeenCalled();
            // It persists the distinct failed-held lifecycle status instead.
            expect(markExitFailedHeldRun).toHaveBeenCalledWith(44);
            // And it re-arms the routine poll timer (the position keeps being
            // monitored AND retried — BOTH anti-rug + a poll timer present).
            expect(registerExitMonitorMock).toHaveBeenCalled();
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

        it('Test 8 (Finding D verification): a FAILED executePartialSell leaves the position open — no double-sell teardown, anti-rug NOT torn down', async () => {
            // RESEARCH Candidate-Escalation #1: executePartialSell shares the
            // "submit-report may lie" class but is lower-stakes. It must NOT tear
            // down anti-rug on a failure (it leaves the position open for the next
            // cycle). Runtime assertion (complements Test 7's source-text guard).
            const { executePartialSell, VolatilityTracker } = await import('../../../src/exitEngine');

            // Force the partial submit to throw → the partial catch (Pitfall 6:
            // does NOT kill the monitor, returns false, leaves the position open).
            sendTxWithRetryMock.mockReset().mockRejectedValueOnce(new Error('partial revert'));

            const ctx = buildCtx();
            const state = {
                tradeId: 60,
                entryPrice: 1,
                highWaterMark: 2,
                trailingActivated: true,
                completedTierIndices: new Set<number>(),
                originalTokenAmount: 1_000n,
                urgencyStartTs: Date.now(),
                volatilityTracker: new VolatilityTracker(),
            };

            const result = await executePartialSell(
                ctx,
                V2_DEX as unknown as Parameters<typeof executePartialSell>[1],
                '0xToken00000000000000000000000000000000T08',
                null,
                500n,
                [{ tier: { multiple: 2, percent: 50 }, index: 0 }],
                state,
                2.0,
            );

            expect(result).toBe(false);
            // The position stays OPEN: no teardown of anti-rug, no exit_state delete.
            expect(unregisterAntiRugPositionMock).not.toHaveBeenCalled();
            expect(deleteExitStateRun).not.toHaveBeenCalled();
            // It did not record a 'sold' close (no double-sell / no false success).
            expect(insertTradeRun).not.toHaveBeenCalled();
        });

        it('Test 9 (D-NONCE-AUTHORITY-ALL): the anti-rug-triggered exit submit routes through withNonceLock', async () => {
            // The anti-rug sell flows detector → triggerAntiRugExit → executeFullSell,
            // whose every signing submit (approval + the escalated sell, and the
            // worker drain) is wrapped in withNonceLock(ctx.wallet.address, ...).
            // Assert the authority layer is exercised on a (successful) anti-rug exit.
            const { executeFullSell } = await import('../../../src/exitEngine');
            withNonceLockMock.mockClear();

            const ctx = buildCtx();
            const result = await executeFullSell(
                ctx,
                V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
                '0xToken00000000000000000000000000000000T09',
                null,
                'anti-rug',
                61,
                'nonce-wrapped anti-rug exit',
            );

            expect(result).toBe(true);
            // The approval submit (V2 path) routes through the per-wallet nonce lock.
            expect(withNonceLockMock).toHaveBeenCalled();
            expect(withNonceLockMock.mock.calls[0][0]).toBe(ctx.wallet.address);
        });
    });
});
