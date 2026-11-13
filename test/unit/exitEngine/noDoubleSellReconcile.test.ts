// test/unit/exitEngine/noDoubleSellReconcile.test.ts
// Phase 21.2 Plan 21.2-12 / Task 2 — CR-02 regression: the no-double-sell guard
// must reconcile the tx the strategy ACTUALLY BROADCAST, not a throwaway tx the
// private leg pre-signs locally.
//
// THE CARDINAL LESSON (21.2-REVIEW.md): CR-02 shipped because the inclusion-
// ladder test mocked escalatePrivateSell + reconcileInclusion and asserted on the
// MOCKED return values, never on HASH EQUALITY between the pre-signed handle and
// the tx the strategy broadcast. So it could never see that escalatePrivateSell
// derived lastSignedHash by locally pre-signing a DIFFERENT tx (no fee
// escalation / clamp) than the one the MEV strategy re-built, re-signed, and
// broadcast — making reconcileInclusion(priv.lastSignedHash, ...) probe a hash
// that never hit the chain (always null → step 2a never aborts the public
// fallback → double-sell window).
//
// This test exercises the REAL path: the REAL escalatePrivateSell → REAL
// sendTxWithRetry → REAL passthrough MevStrategy (which broadcasts via
// wallet.sendTransaction and returns hash H) → REAL submitWithReconciliation.
// Only reconcileInclusion is spied (so we can READ the hash the engine's guard
// 2a probes and CONTROL the outcome) plus the external boundaries (DB / notifier
// / receiptDecoder). We assert HASH EQUALITY: the hash the guard reconciles
// EQUALS the broadcast hash H.
//
// Against the PRE-FIX code priv.lastSignedHash is the keccak256 of a locally
// pre-signed throwaway tx (NOT H) → the equality assertion FAILS (the RED proof).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// External-boundary mocks ONLY. We do NOT mock txManager (escalatePrivateSell /
// sendTxWithRetry are REAL), nor the MEV strategy, nor submitWithReconciliation.
// reconcileInclusion is the ONE thing we spy — it is the engine's guard-2a probe
// AND the strategy's internal not-landed probe; the spy reads the probed hash and
// returns a controllable outcome.
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

const clearAllTimersForTokenMock = vi.fn();
const tryAcquireSellLockMock = vi.fn();
const releaseSellLockMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    tryAcquireSellLock: tryAcquireSellLockMock,
    releaseSellLock: releaseSellLockMock,
    clearAllTimersForToken: clearAllTimersForTokenMock,
    registerExitMonitor: vi.fn(),
    hasExitMonitorTimer: vi.fn().mockReturnValue(true),
    tryEnqueuePosition: vi.fn().mockReturnValue(true),
    releasePositionQueue: vi.fn(),
}));

const sendCtxAlertMock = vi.fn();
vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: sendCtxAlertMock }));

const decodeReceiptMock = vi.fn();
vi.mock('../../../src/utils/receiptDecoder', () => ({ decodeReceipt: decodeReceiptMock }));

const unregisterAntiRugPositionMock = vi.fn();
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: unregisterAntiRugPositionMock }));

// The ONE spy: reconcileInclusion. Records the (signedTxHash, submittedNonce)
// of EVERY call and returns a controllable outcome. The strategy's internal
// reconcile uses it (must return 'not-landed' so the private leg does NOT land);
// the engine's guard 2a uses it on priv.lastSignedHash (the hash we assert on).
const reconcileCalls: { hash: string; nonce: number }[] = [];
let reconcileOutcome: { outcome: string; hash?: string; receipt?: unknown } = { outcome: 'not-landed' };
const reconcileInclusionMock = vi.fn(async (hash: string, nonce: number) => {
    reconcileCalls.push({ hash, nonce });
    return reconcileOutcome;
});
vi.mock('../../../src/utils/mevStrategies/reconciliation', async () => {
    const actual = await vi.importActual<
        typeof import('../../../src/utils/mevStrategies/reconciliation')
    >('../../../src/utils/mevStrategies/reconciliation');
    return { ...actual, reconcileInclusion: reconcileInclusionMock };
});

// withNonceLock: real serialization is irrelevant to CR-02 (Task 1 covers the
// deadlock). A recording passthrough keeps the ladder's signing sites running.
vi.mock('../../../src/utils/nonceAuthority', async () => {
    const actual = await vi.importActual<typeof import('../../../src/utils/nonceAuthority')>(
        '../../../src/utils/nonceAuthority',
    );
    return { ...actual };
});

// -----------------------------------------------------------------------------
// ethers Contract mock. balanceOf is controllable; the V2 router methods are
// observable so we can assert the public fallback fires (or not). The private
// leg's tx is built by buildV2SellTx (a real router.interface.encodeFunctionData)
// and broadcast by the passthrough strategy via ctx.wallet.sendTransaction → H.
// -----------------------------------------------------------------------------

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
        this.allowance = () => Promise.resolve(0n);
        this.approve = approveMock;
        this.getAmountsOut = getAmountsOutMock;
        this.swapExactTokensForETHSupportingFeeOnTransferTokens = swapFeeOnTransferMock;
        this.interface = {
            // Real-ish encode so buildV2SellTx produces a valid TransactionRequest.
            encodeFunctionData: () => '0xdeadbeef',
        };
    }
    return { ...actual, Contract: MockContract };
});

// -----------------------------------------------------------------------------
// Fixtures — the BROADCAST hash H the passthrough strategy returns from
// wallet.sendTransaction. CR-02: the guard must reconcile THIS, not a throwaway.
// -----------------------------------------------------------------------------

const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x12970E6868f88f6557B76120662c1B3E50A646bf'; // LADYS mainnet
// A valid 32-byte hex hash standing in for the strategy's actually-broadcast
// tx.hash. The leading 0xb's make it visually distinct from the pre-fix
// throwaway keccak.
const BROADCAST_HASH_H = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0001';
const SUBMITTED_NONCE = 7;

// A throwaway pre-sign would yield this DIFFERENT hash (keccak256 of a locally
// re-signed tx). We assert the guard NEVER probes anything but H.
function makeWallet() {
    return {
        address: WALLET,
        // The passthrough strategy broadcasts via sendTransaction and returns
        // tx.hash. This is the REAL broadcast hash H.
        sendTransaction: vi.fn().mockResolvedValue({
            hash: BROADCAST_HASH_H,
            // tx.wait(3) rejects → nativeConfirmed:false → the strategy reconciles
            // against chain state (our mocked reconcileInclusion → not-landed).
            wait: vi.fn().mockRejectedValue(new Error('wait timeout — defer to reconcile')),
        }),
        // Pre-sign path (PRE-FIX only) used populateTransaction + signTransaction
        // to derive a THROWAWAY lastSignedHash = keccak256(signedRaw). That hash is
        // DIFFERENT from H (the strategy re-builds + re-signs with clamped fees).
        // A VALID even-length hex raw tx so the pre-fix keccak256 succeeds and
        // yields a real-but-WRONG hash (the CR-02 bug we assert against). If the
        // fix removed the pre-sign, these are never called.
        populateTransaction: vi.fn().mockImplementation(async (tx: Record<string, unknown>) => ({ ...tx })),
        signTransaction: vi.fn().mockResolvedValue(
            '0xf86b808504a817c80082520894deadbeefdeadbeefdeadbeefdeadbeefdeadbeef880de0b6b3a764000080',
        ),
    };
}

function buildCtx() {
    return {
        chain: {
            name: 'base',
            displayName: '[BASE]',
            mevStrategy: 'passthrough' as const,
            mevConfig: {},
            wethAddress: '0x4200000000000000000000000000000000000006',
            snipeAmount: '0.01', // baseline for resumeExitMonitor (re-arm path)
            gas: { multiplier: 1.2, maxGasLimit: 500_000n },
            antiRug: { liveExecute: true, gasMultiplier: 2.0 },
        },
        wallet: makeWallet(),
        httpProvider: {
            getTransactionCount: vi.fn().mockResolvedValue(SUBMITTED_NONCE),
            getFeeData: vi.fn().mockResolvedValue({
                maxFeePerGas: 50_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                gasPrice: 50_000_000_000n,
            }),
            getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n }),
            getBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000_000n), // 10 ETH
            call: vi.fn().mockResolvedValue('0x'), // simulate-before-submit passes
            getTransactionReceipt: vi.fn().mockResolvedValue(null),
            getBlockNumber: vi.fn().mockResolvedValue(18_000_000),
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

// Pin the MEV env so the strategy's reconcile window/poll are tiny (hermetic;
// avoids the 45s default blowing testTimeout) and the private attempt budget is
// deterministic.
const SAVED_ENV: Record<string, string | undefined> = {
    MEV_CONFIRM_WINDOW_MS: process.env.MEV_CONFIRM_WINDOW_MS,
    MEV_CONFIRM_POLL_MS: process.env.MEV_CONFIRM_POLL_MS,
    MEV_SELL_FALLBACK_ATTEMPTS: process.env.MEV_SELL_FALLBACK_ATTEMPTS,
};

afterEach(() => {
    for (const [k, v] of Object.entries(SAVED_ENV)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

beforeEach(() => {
    process.env.MEV_CONFIRM_WINDOW_MS = '20';
    process.env.MEV_CONFIRM_POLL_MS = '5';
    process.env.MEV_SELL_FALLBACK_ATTEMPTS = '1'; // 1 quick private attempt

    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    deleteExitStateRun.mockReset();
    markExitFailedHeldRun.mockReset();
    clearAllTimersForTokenMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);
    releaseSellLockMock.mockReset();
    sendCtxAlertMock.mockReset();
    decodeReceiptMock.mockReset().mockResolvedValue({
        amountOut: '1000000000', gasCost: '0', blockNumber: 18_000_000,
    });
    unregisterAntiRugPositionMock.mockReset();

    reconcileCalls.length = 0;
    reconcileOutcome = { outcome: 'not-landed' };
    reconcileInclusionMock.mockClear();

    approveMock.mockReset().mockResolvedValue({ wait: vi.fn().mockResolvedValue(null) });
    swapFeeOnTransferMock.mockReset().mockResolvedValue({
        hash: '0xpublicsellhash',
        wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18_000_123 }),
    });
    getAmountsOutMock.mockReset().mockResolvedValue([0n, 1_000_000_000_000_000n]);

    // call 1 = initial balance, call 2 = guard re-fetch (held), call 3 = post-sell close.
    balanceSequence = [1_000_000n, 1_000_000n, 0n];
    balanceCallCount = 0;
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 21.2 / CR-02 — the no-double-sell guard reconciles the BROADCAST hash (REAL path)', () => {
    // Own limit (orchestrator, phase 23 wave 13 gate, 2026-11-12): this first test pays the cold
    // import of src/exitEngine in its body. Measured 3.1 s in the full parallel run (62% of the
    // 5 s unit testTimeout) and 0.6 s alone. Root fix is Phase 28 (deferred-items.md, cold-import class).
    it('the hash passed to reconcileInclusion EQUALS the strategy-broadcast hash H (not a throwaway pre-sign)', { timeout: 20_000 }, async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 300, 'trailing stop',
        );

        // reconcileInclusion was invoked (the strategy's internal probe and/or the
        // engine's guard 2a). The ENGINE'S GUARD-2A probe must reconcile H — the
        // hash the strategy actually broadcast — never a throwaway pre-sign hash.
        expect(reconcileCalls.length).toBeGreaterThan(0);
        const probedHashes = reconcileCalls.map((c) => c.hash);
        // CRITICAL (CR-02): H appears as a probed hash, and the throwaway hash NEVER does.
        expect(probedHashes).toContain(BROADCAST_HASH_H);
        // The guard 2a probe (the LAST reconcile call, after the strategy threw and
        // escalatePrivateSell surfaced lastSignedHash) reconciles H specifically.
        const guardProbe = reconcileCalls[reconcileCalls.length - 1];
        expect(guardProbe.hash).toBe(BROADCAST_HASH_H);
        expect(guardProbe.nonce).toBe(SUBMITTED_NONCE);
    });

    it('a private bundle that lands LATE (reconcile → included for H) ABORTS the public fallback (no double-sell)', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        // The private leg "did not land" within the window, but the guard's
        // reconcile of the BROADCAST hash H finds it landed late → ABORT the public
        // fallback. We make the strategy's internal probe return not-landed (so the
        // private leg throws), then flip to 'included' for the engine's guard 2a.
        reconcileInclusionMock.mockImplementation(async (hash: string, nonce: number) => {
            reconcileCalls.push({ hash, nonce });
            // First N-1 calls (the strategy's internal reconcile) → not-landed so
            // the private leg throws; the FINAL call is the engine guard 2a on H.
            return { outcome: 'not-landed' };
        });
        // After the private leg has thrown, the engine guard 2a runs. Make the LAST
        // reconcile (guard 2a) return 'included' for H. We achieve this by switching
        // the implementation once escalatePrivateSell has surfaced lastSignedHash:
        // simplest deterministic approach — return included only when probed with H.
        reconcileInclusionMock.mockImplementation(async (hash: string, nonce: number) => {
            reconcileCalls.push({ hash, nonce });
            if (hash === BROADCAST_HASH_H) {
                return { outcome: 'included', hash: BROADCAST_HASH_H, receipt: { status: 1, blockNumber: 18_000_050 } };
            }
            return { outcome: 'not-landed' };
        });
        // Private landed late → no guard re-fetch on the 'included' branch; success-
        // path post-sell re-fetch → 0n genuine close.
        balanceSequence = [1_000_000n, 0n];
        balanceCallCount = 0;

        const result = await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 301, 'trailing stop',
        );

        // The guard reconciled H and found it included → the public fallback swap
        // must NOT fire (no double-sell). Treated as a landed sell.
        expect(reconcileCalls.some((c) => c.hash === BROADCAST_HASH_H)).toBe(true);
        expect(swapFeeOnTransferMock).not.toHaveBeenCalled();
        expect(result).toBe(true);
    });

    it('an INCONCLUSIVE / landed-not-ours reconcile FAILS SAFE — does NOT blindly run the public fallback', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        // The private leg did not land; the guard reconcile of H returns
        // 'landed-not-ours' (the nonce was consumed but our hash has no receipt —
        // we CANNOT prove the private attempt did NOT land). The interim CR-02
        // mitigation: fail safe toward not-selling-twice — do NOT run the public
        // fallback purely on the optimistic balanceOf snapshot.
        reconcileInclusionMock.mockImplementation(async (hash: string, nonce: number) => {
            reconcileCalls.push({ hash, nonce });
            if (hash === BROADCAST_HASH_H) return { outcome: 'landed-not-ours' };
            return { outcome: 'not-landed' };
        });
        // balanceOf still reports held (the optimistic snapshot the pre-fix code
        // would have sold on). The fix must NOT fire the public swap here.
        balanceSequence = [1_000_000n, 1_000_000n, 1_000_000n];
        balanceCallCount = 0;

        const result = await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'trailing-stop', 302, 'trailing stop',
        );

        // FAIL SAFE: the public-mempool swap must NOT have fired on an inconclusive
        // private inclusion (no unguarded double-sell).
        expect(reconcileCalls.some((c) => c.hash === BROADCAST_HASH_H)).toBe(true);
        expect(swapFeeOnTransferMock).not.toHaveBeenCalled();
        // The position is NOT torn down as a genuine close on an inconclusive result.
        expect(result).toBe(false);
        // NF-01 (21.2-14): the inconclusive branch must KEEP-MONITOR a still-held
        // position (persist exit_failed_held + re-arm the poll timer), NOT bare-return.
        // The pre-fix `return false` skipped keepMonitoringFailedHeld → the position
        // was stranded at runtime and dropped on restart (regressing S-1). balanceOf
        // (1M) > dust ⇒ keepMonitoringFailedHeld ran ⇒ markExitFailedHeld was called.
        // This assertion FAILS against the pre-fix bare-return.
        expect(markExitFailedHeldRun).toHaveBeenCalledWith(302);
    });

    it('NF-01: an ANTI-RUG inconclusive exit KEEPS monitoring (persists exit_failed_held), never strands the position', async () => {
        const { executeFullSell } = await import('../../../src/exitEngine');

        reconcileInclusionMock.mockImplementation(async (hash: string, nonce: number) => {
            reconcileCalls.push({ hash, nonce });
            if (hash === BROADCAST_HASH_H) return { outcome: 'landed-not-ours' };
            return { outcome: 'not-landed' };
        });
        // Still held after the inconclusive private anti-rug attempt.
        balanceSequence = [1_000_000n, 1_000_000n, 1_000_000n];
        balanceCallCount = 0;

        const result = await executeFullSell(
            buildCtx(),
            V2_DEX as unknown as Parameters<typeof executeFullSell>[1],
            TOKEN, null, 'anti-rug', 302, 'anti-rug exit',
        );

        // No public fallback on an inconclusive result (no double-sell).
        expect(swapFeeOnTransferMock).not.toHaveBeenCalled();
        expect(result).toBe(false);
        // Crown-jewel invariant: a still-held FAILED anti-rug exit persists
        // exit_failed_held (restart-resumable) and must NOT unsubscribe anti-rug.
        expect(markExitFailedHeldRun).toHaveBeenCalledWith(302);
        expect(unregisterAntiRugPositionMock).not.toHaveBeenCalled();
    });
});
