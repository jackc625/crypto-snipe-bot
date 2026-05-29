// test/unit/bot/noDoubleBuyReconcile.test.ts
// Phase 21.3 / Plan 21.3-03 — STOP-THE-LINE-05-C: the no-double-BUY guard (the
// highest-stakes inversion of the 21.2 no-double-sell — a double-BUY spends real
// ETH twice for one intent, UNrecoverable).
//
// REAL-PATH / NO-PHANTOM DISCIPLINE (the CR-02 cardinal lesson, mirrored from
// test/unit/exitEngine/noDoubleSellReconcile.test.ts): the guard MUST reconcile the
// hash the strategy ACTUALLY broadcast (BroadcastHandle.signedTxHash), never a
// locally pre-signed phantom. So this test exercises the REAL chain:
//   REAL escalatePrivateBuy -> REAL sendTxWithRetry -> REAL passthrough MevStrategy
//   (which broadcasts via wallet.sendTransaction and returns hash H via the
//   BroadcastHandle) -> REAL submitWithReconciliation.
// We spy ONLY reconcileInclusion (to READ the probed hash and CONTROL the outcome)
// plus the external boundaries (DB / notifier / the preflight affordability gate /
// the relay HTTP — there is none on passthrough). We assert HASH EQUALITY: the hash
// the guard reconciles EQUALS the broadcast hash H.
//
// The 5 outcomes (acceptance):
//   included                       -> 0 public buys (record the real hash)
//   landed-not-ours / inconclusive -> 0 public buys (fail-closed)
//   not-landed + balanceOf != 0    -> 0 public buys (chain-truth abort)
//   not-landed + nonce-consumed    -> 0 public buys (chain-truth abort)
//   not-landed + clean             -> exactly 1 public buy

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// External-boundary mocks ONLY. We do NOT mock txManager (escalatePrivateBuy /
// sendTxWithRetry are REAL), nor the MEV strategy, nor submitWithReconciliation.
// reconcileInclusion is the ONE thing we spy.
// -----------------------------------------------------------------------------

const insertTradeRun = vi.fn();
const updateTradeStatusRun = vi.fn();
const recordSnipeMock = vi.fn();

vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    isTokenSniped: { get: vi.fn().mockReturnValue(false) },
    getTradeIdForPendingToken: { get: vi.fn() },
    getPauseState: { get: () => ({ paused: 0 }) },
    setPauseState: { run: vi.fn() },
    forceWalCheckpoint: vi.fn(),
    getResumeExitMonitorTrades: { all: vi.fn().mockReturnValue([]) },
    getResumeAntiRugTrades: { all: vi.fn().mockReturnValue([]) },
}));

vi.mock('../../../src/riskManager', () => ({
    canSnipe: vi.fn().mockReturnValue({ allowed: true }),
    recordSnipe: recordSnipeMock,
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() }) },
}));

// The mode-aware affordability gate — REAL gate logic is plan 02's concern (its own
// tests). Here we mock it to PASS so the deliberate path proceeds; the mode-threading
// is asserted via the mock's recorded call args.
const checkEntryExitAffordabilityMock = vi.fn().mockResolvedValue({ passed: true, reason: '', details: {} });
vi.mock('../../../src/preflight', () => ({
    preflight: vi.fn(),
    checkWalletBalance: vi.fn(),
    checkEntryExitAffordability: checkEntryExitAffordabilityMock,
}));

const sendCtxAlertMock = vi.fn();
vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: sendCtxAlertMock, sendTelegramAlert: vi.fn() }));

vi.mock('../../../src/api/ws/broadcaster', () => ({ broadcast: vi.fn() }));

// The ONE spy: reconcileInclusion. Records every (hash, nonce) and returns a
// controllable outcome. The strategy's internal reconcile uses it (must return
// 'not-landed' so the private leg does NOT land); the guard uses it on
// priv.lastSignedHash (the hash we assert HASH EQUALITY on).
const reconcileCalls: { hash: string; nonce: number }[] = [];
let reconcileImpl: (hash: string, nonce: number) => { outcome: string; hash?: string; receipt?: unknown } =
    () => ({ outcome: 'not-landed' });
const reconcileInclusionMock = vi.fn(async (hash: string, nonce: number) => {
    reconcileCalls.push({ hash, nonce });
    return reconcileImpl(hash, nonce);
});
vi.mock('../../../src/utils/mevStrategies/reconciliation', async () => {
    const actual = await vi.importActual<
        typeof import('../../../src/utils/mevStrategies/reconciliation')
    >('../../../src/utils/mevStrategies/reconciliation');
    return { ...actual, reconcileInclusion: reconcileInclusionMock };
});

// -----------------------------------------------------------------------------
// ethers Contract mock — the router (getAmountsOut + the public FoT buy) and the
// token (balanceOf). The private leg's tx is built via router.interface.encode and
// broadcast by the passthrough strategy via ctx.wallet.sendTransaction -> H.
// -----------------------------------------------------------------------------

let tokenBalance: bigint = 0n;
const swapFoTBuyMock = vi.fn();
const getAmountsOutMock = vi.fn();

vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(tokenBalance);
        this.getAmountsOut = getAmountsOutMock;
        this.swapExactETHForTokensSupportingFeeOnTransferTokens = swapFoTBuyMock;
        this.interface = {
            encodeFunctionData: () => '0xdeadbeef',
        };
    }
    return { ...actual, Contract: MockContract };
});

// -----------------------------------------------------------------------------
// Fixtures — the BROADCAST hash H the passthrough strategy returns from
// wallet.sendTransaction. The guard must reconcile THIS, not a throwaway.
// -----------------------------------------------------------------------------

const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x12970E6868f88f6557B76120662c1B3E50A646bf'; // LADYS mainnet
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const BROADCAST_HASH_H = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0001';
const SUBMITTED_NONCE = 7;
const AMOUNT_IN = 10_000_000_000_000_000n; // 0.01 ETH

let latestNonceValue = SUBMITTED_NONCE;

function makeWallet() {
    return {
        address: WALLET,
        // The passthrough strategy broadcasts via sendTransaction and returns
        // tx.hash. This is the REAL broadcast hash H. tx.wait(3) rejects ->
        // nativeConfirmed:false -> the strategy reconciles (our mocked
        // reconcileInclusion -> not-landed by default).
        sendTransaction: vi.fn().mockResolvedValue({
            hash: BROADCAST_HASH_H,
            wait: vi.fn().mockRejectedValue(new Error('wait timeout — defer to reconcile')),
        }),
        // populateTransaction is used by the deliberate private tx builder.
        populateTransaction: vi.fn().mockImplementation(async (tx: Record<string, unknown>) => ({ ...tx })),
    };
}

function buildCtx() {
    return {
        chain: {
            name: 'base',
            displayName: '[BASE]',
            mevStrategy: 'passthrough' as const,
            mevConfig: {},
            wethAddress: WETH,
            snipeAmount: '0.01',
            gas: { multiplier: 1.2, maxGasLimit: 500_000n },
        },
        wallet: makeWallet(),
        httpProvider: {
            getTransactionCount: vi.fn().mockImplementation(async () => latestNonceValue),
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
    };
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

const SAVED_ENV: Record<string, string | undefined> = {
    MEV_CONFIRM_WINDOW_MS: process.env.MEV_CONFIRM_WINDOW_MS,
    MEV_CONFIRM_POLL_MS: process.env.MEV_CONFIRM_POLL_MS,
    DELIBERATE_BUY_PRIVATE_ATTEMPTS: process.env.DELIBERATE_BUY_PRIVATE_ATTEMPTS,
};

afterEach(() => {
    for (const [k, v] of Object.entries(SAVED_ENV)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

beforeEach(async () => {
    vi.resetModules();
    process.env.MEV_CONFIRM_WINDOW_MS = '20';
    process.env.MEV_CONFIRM_POLL_MS = '5';
    process.env.DELIBERATE_BUY_PRIVATE_ATTEMPTS = '1'; // 1 quick private attempt → fast

    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    recordSnipeMock.mockReset();
    sendCtxAlertMock.mockReset();
    checkEntryExitAffordabilityMock.mockReset().mockResolvedValue({ passed: true, reason: '', details: {} });
    reconcileInclusionMock.mockClear();
    reconcileCalls.length = 0;
    reconcileImpl = () => ({ outcome: 'not-landed' });

    swapFoTBuyMock.mockReset().mockResolvedValue({
        hash: '0xpublicbuyhash',
        wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18_000_123 }),
    });
    getAmountsOutMock.mockReset().mockResolvedValue([0n, 1_000_000_000_000_000_000n]);

    tokenBalance = 0n;
    latestNonceValue = SUBMITTED_NONCE;
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 21.3 — no-double-buy guard (STOP-THE-LINE-05-C) [REAL-PATH]', () => {
    it('REAL-PATH: the guard reconciles the hash the strategy ACTUALLY broadcast (BroadcastHandle.signedTxHash) — HASH EQUALITY, never a pre-signed phantom', async () => {
        // not-landed everywhere → the private leg surfaces lastSignedHash = H and the
        // guard 2a reconciles it. balanceOf 0 + nonce unconsumed → the public buy
        // would proceed, but we only assert the probed-hash equality here.
        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        expect(reconcileCalls.length).toBeGreaterThan(0);
        const probedHashes = reconcileCalls.map((c) => c.hash);
        // CRITICAL: H appears as a probed hash (the guard reconciled the broadcast hash).
        expect(probedHashes).toContain(BROADCAST_HASH_H);
        // The guard probe (the LAST reconcile call, after the private leg surfaced
        // lastSignedHash) reconciles H + the submitted nonce specifically.
        const guardProbe = reconcileCalls[reconcileCalls.length - 1];
        expect(guardProbe.hash).toBe(BROADCAST_HASH_H);
        expect(guardProbe.nonce).toBe(SUBMITTED_NONCE);
    });

    it('reconcile outcome included -> ABORT the public buy (private landed late), record the real hash', async () => {
        reconcileImpl = (hash: string) =>
            hash === BROADCAST_HASH_H
                ? { outcome: 'included', hash: BROADCAST_HASH_H, receipt: { status: 1 } }
                : { outcome: 'not-landed' };

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        // included → 0 public buys; the real reconciled hash is recorded + returned.
        expect(swapFoTBuyMock).not.toHaveBeenCalled();
        expect(result).toBe(BROADCAST_HASH_H);
        expect(insertTradeRun).toHaveBeenCalledTimes(1);
        expect(insertTradeRun.mock.calls[0][0].txHash).toBe(BROADCAST_HASH_H);
    });

    it('reconcile outcome landed-not-ours -> FAIL-CLOSED, do NOT broadcast the public buy', async () => {
        reconcileImpl = (hash: string) =>
            hash === BROADCAST_HASH_H ? { outcome: 'landed-not-ours' } : { outcome: 'not-landed' };
        // Even though balanceOf would be 0, the inconclusive reconcile fails closed FIRST.
        tokenBalance = 0n;

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        expect(swapFoTBuyMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
        expect(insertTradeRun).not.toHaveBeenCalled();
    });

    it('reconcile outcome reverted -> FAIL-CLOSED, do NOT broadcast the public buy', async () => {
        reconcileImpl = (hash: string) =>
            hash === BROADCAST_HASH_H ? { outcome: 'reverted', receipt: { status: 0 } } : { outcome: 'not-landed' };

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        expect(swapFoTBuyMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('not-landed + balanceOf(token) != 0 -> ABORT (stricter than the sell guard: tokens already received)', async () => {
        reconcileImpl = () => ({ outcome: 'not-landed' });
        tokenBalance = 5_000_000n; // tokens already received → private buy DID land
        latestNonceValue = SUBMITTED_NONCE; // nonce NOT consumed (so balance is the trip)

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        expect(swapFoTBuyMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('not-landed + nonce consumed -> ABORT (stricter than the sell guard: a same-nonce tx landed)', async () => {
        reconcileImpl = () => ({ outcome: 'not-landed' });
        tokenBalance = 0n; // balance clean...

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];
        // The strategy submits at SUBMITTED_NONCE; AFTER the private submit a
        // same-nonce tx lands → the guard's chain-truth getTransactionCount('latest')
        // reports an ADVANCED nonce. Return SUBMITTED_NONCE for the strategy's submit
        // probe(s), then SUBMITTED_NONCE+1 for the guard's chain-truth check.
        let nonceCalls = 0;
        (ctx.httpProvider.getTransactionCount as ReturnType<typeof vi.fn>).mockImplementation(async () => {
            nonceCalls += 1;
            return nonceCalls <= 1 ? SUBMITTED_NONCE : SUBMITTED_NONCE + 1;
        });

        const result = await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        expect(swapFoTBuyMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('not-landed + balanceOf == 0 + nonce NOT consumed -> the public buy is broadcast exactly ONCE', async () => {
        reconcileImpl = () => ({ outcome: 'not-landed' });
        tokenBalance = 0n;
        latestNonceValue = SUBMITTED_NONCE; // clean — nonce not consumed

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        // Exactly one public FoT buy; the real public hash is recorded + returned.
        expect(swapFoTBuyMock).toHaveBeenCalledTimes(1);
        expect(result).toBe('0xpublicbuyhash');
        expect(insertTradeRun).toHaveBeenCalledTimes(1);
        expect(insertTradeRun.mock.calls[0][0].txHash).toBe('0xpublicbuyhash');
        // The public FoT buy sends ETH value and NO approve (a buy spends ETH).
        const swapArgs = swapFoTBuyMock.mock.calls[0];
        const overrides = swapArgs[swapArgs.length - 1];
        expect(overrides.value).toBe(AMOUNT_IN);
    });

    it('the deliberate path requests mode=deliberate on the affordability gate (D-BUY-AFFORDABILITY-EXTEND)', async () => {
        reconcileImpl = () => ({ outcome: 'not-landed' });
        tokenBalance = 0n;
        latestNonceValue = SUBMITTED_NONCE;

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        await executeDeliberateBuy(ctx, TOKEN, AMOUNT_IN, V2_DEX as never);

        // checkEntryExitAffordability(chain, mode) — the 2nd arg is 'deliberate'.
        expect(checkEntryExitAffordabilityMock).toHaveBeenCalled();
        expect(checkEntryExitAffordabilityMock.mock.calls[0][1]).toBe('deliberate');
    });
});
