// test/unit/bot/deliberateBuyAffordability.test.ts
// Phase 21.3 / Plan 21.3-06 — CR-01 + HI-01 (capital-safety: a deliberate buy
// must NEVER enter a position it cannot exit).
//
// THE CR-01/CR-02 CARDINAL LESSON (the exact failure the deep review caught):
// every prior deliberate test used AMOUNT_IN === parseEther(snipeAmount), so the
// gate's snipeAmount-vs-amountInWei substitution was invisible. THESE tests
// DIVERGE them: the deliberate amountInWei is LARGER than snipeAmount, on a thin
// wallet, exercising the REAL checkEntryExitAffordability gate (NOT mocked) so
// CR-01 is proven end-to-end on the real path the 21-07 retry runs.
//
// REAL-PATH discipline (mirrors noDoubleBuyReconcile.test.ts): we exercise the
// real executeDeliberateBuy → enforceEntryExitAffordability → REAL
// checkEntryExitAffordability chain. We mock ONLY external boundaries
// (DB / notifier / WS / riskManager / logger) and the txManager private leg + the
// preflight's *other* heavy exports — checkEntryExitAffordability stays REAL.
//
// CR-01 RED: a deliberate amountInWei > parseEther(snipeAmount) on a wallet that
//   covers the snipe floor but NOT the deliberate floor is REFUSED at the gate
//   (no private submit, no public swap). Against pre-fix code the gate prices
//   snipeAmount and wrongly PASSES → the private/public legs run.
// HI-01 RED: a base-fee RISE between the gate and the public broadcast aborts the
//   public buy fail-closed (no swapExactETHForTokensSupportingFeeOnTransferTokens
//   call). Against pre-fix code the public leg had no re-check → it broadcasts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

// -----------------------------------------------------------------------------
// External-boundary mocks ONLY.
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
    getAntirugDryRunStarted: { get: vi.fn(() => undefined) },
    getStaleTradesQuery: { all: vi.fn(() => []) },
}));

vi.mock('../../../src/riskManager', () => ({
    canSnipe: vi.fn().mockReturnValue({ allowed: true }),
    recordSnipe: recordSnipeMock,
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() }) },
}));

const sendCtxAlertMock = vi.fn();
vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: sendCtxAlertMock, sendTelegramAlert: vi.fn(), sendChainAlert: vi.fn() }));

vi.mock('../../../src/api/ws/broadcaster', () => ({ broadcast: vi.fn() }));

// txManager: mock createMevStrategy/sendTxWithRetry (boundary) but keep
// escalatePrivateBuy REAL so the deliberate ladder behaves like production.
// We control escalatePrivateBuy's landing by mocking it directly — its internal
// real path is covered by noDoubleBuyReconcile.test.ts; here CR-01/HI-01 are the
// focus and the private leg is a controlled NOT-LANDED so the ladder reaches the
// public broadcast (HI-01's re-check site).
const escalatePrivateBuyMock = vi.fn();
vi.mock('../../../src/utils/txManager', async () => {
    const actual = await vi.importActual<typeof import('../../../src/utils/txManager')>('../../../src/utils/txManager');
    return { ...actual, escalatePrivateBuy: escalatePrivateBuyMock };
});

// PREFLIGHT: keep checkEntryExitAffordability REAL (the CR-01 unit under test).
// Override only the heavy startup-flow exports the bot module imports so the
// import graph stays hermetic.
vi.mock('../../../src/preflight', async () => {
    const actual = await vi.importActual<typeof import('../../../src/preflight')>('../../../src/preflight');
    return {
        ...actual,
        preflight: vi.fn(),
        preflightDryRun: vi.fn(),
    };
});

// reconcileInclusion: the no-double-buy guard probes it after the private leg.
// Default 'not-landed' so a clean wallet reaches the public broadcast.
let reconcileImpl: () => { outcome: string; hash?: string } = () => ({ outcome: 'not-landed' });
const reconcileInclusionMock = vi.fn(async () => reconcileImpl());
vi.mock('../../../src/utils/mevStrategies/reconciliation', async () => {
    const actual = await vi.importActual<typeof import('../../../src/utils/mevStrategies/reconciliation')>(
        '../../../src/utils/mevStrategies/reconciliation',
    );
    return { ...actual, reconcileInclusion: reconcileInclusionMock };
});

// -----------------------------------------------------------------------------
// ethers Contract mock — router (getAmountsOut + public FoT buy) + token balanceOf.
// We keep the REAL `ethers` namespace (parseEther/formatEther/parseUnits) so the
// gate math is real; only Contract is stubbed.
// -----------------------------------------------------------------------------
let tokenBalance: bigint = 0n;
const swapFoTBuyMock = vi.fn();
const getAmountsOutMock = vi.fn();
const getPairMock = vi.fn();

vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: Record<string, unknown>) {
        this.balanceOf = () => Promise.resolve(tokenBalance);
        this.getAmountsOut = getAmountsOutMock;
        this.swapExactETHForTokensSupportingFeeOnTransferTokens = swapFoTBuyMock;
        this.getPair = getPairMock;
        this.interface = { encodeFunctionData: () => '0xdeadbeef' };
    }
    return { ...actual, Contract: MockContract };
});

// -----------------------------------------------------------------------------
// Fixtures — snipeAmount is 0.01 ETH; the DELIBERATE amount is LARGER (0.05 ETH).
// This divergence is the whole point (CR-01 was masked when they were equal).
// -----------------------------------------------------------------------------
const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x12970E6868f88f6557B76120662c1B3E50A646bf'; // LADYS mainnet
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const BROADCAST_HASH_H = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0001';
const SUBMITTED_NONCE = 7;

const SNIPE_AMOUNT = '0.01';
const SNIPE_VALUE_WEI = ethers.parseEther(SNIPE_AMOUNT);
const DELIBERATE_AMOUNT_WEI = ethers.parseEther('0.05'); // 5x the snipe amount

const MAX_GAS_LIMIT = 300_000n;
const GAS_BUFFER = '0.005';
// Gate fee model: baseFee 20 gwei, priority 10 gwei, maxFee 30 gwei.
const BASE_FEE_WEI = ethers.parseUnits('20', 'gwei');
const PRIORITY_WEI = ethers.parseUnits('10', 'gwei');
const MAX_FEE_WEI = BASE_FEE_WEI + PRIORITY_WEI;
const EXIT_GATE_BUFFER = 2.0;
const DELIBERATE_BUY_BUFFER = 2.0;

// Compute the gate floor for a given buyValueWei (the CR-01 contract). Mirrors
// preflight.checkEntryExitAffordability's deliberate math exactly.
function deliberateFloorWei(buyValueWei: bigint): bigint {
    const buyGas = MAX_GAS_LIMIT * MAX_FEE_WEI;
    const bufferedBaseFee = (BASE_FEE_WEI * BigInt(Math.round(EXIT_GATE_BUFFER * 100))) / 100n;
    const approvalGas = 60_000n * bufferedBaseFee;
    const sellGas = MAX_GAS_LIMIT * bufferedBaseFee + approvalGas;
    const cushion = ethers.parseEther(GAS_BUFFER);
    const delibBufferedBaseFee = (BASE_FEE_WEI * BigInt(Math.round(DELIBERATE_BUY_BUFFER * 100))) / 100n;
    const delibReserve = MAX_GAS_LIMIT * delibBufferedBaseFee; // approvalGas 0n for a buy
    return buyValueWei + buyGas + sellGas + cushion + delibReserve;
}

let latestNonceValue = SUBMITTED_NONCE;
let balanceWei = ethers.parseEther('10'); // overridden per-test
let getFeeDataImpl: () => Record<string, bigint> = () => ({
    maxFeePerGas: MAX_FEE_WEI,
    maxPriorityFeePerGas: PRIORITY_WEI,
    gasPrice: MAX_FEE_WEI,
});

function makeWallet() {
    return {
        address: WALLET,
        sendTransaction: vi.fn().mockResolvedValue({
            hash: BROADCAST_HASH_H,
            wait: vi.fn().mockRejectedValue(new Error('wait timeout — defer to reconcile')),
        }),
        populateTransaction: vi.fn().mockImplementation(async (tx: Record<string, unknown>) => ({ ...tx })),
    };
}

function buildCtx() {
    return {
        chain: {
            name: 'eth',
            displayName: '[ETH]',
            nativeCurrency: 'ETH',
            mevStrategy: 'passthrough' as const,
            mevConfig: {},
            wethAddress: WETH,
            snipeAmount: SNIPE_AMOUNT,
            gasBuffer: GAS_BUFFER,
            gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: MAX_GAS_LIMIT },
        },
        wallet: makeWallet(),
        httpProvider: {
            getTransactionCount: vi.fn().mockImplementation(async () => latestNonceValue),
            getFeeData: vi.fn().mockImplementation(async () => getFeeDataImpl()),
            getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
            getBalance: vi.fn().mockImplementation(async () => balanceWei),
            call: vi.fn().mockResolvedValue('0x'),
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
    EXIT_GATE_SELL_GAS_BUFFER: process.env.EXIT_GATE_SELL_GAS_BUFFER,
    DELIBERATE_BUY_GAS_BUFFER: process.env.DELIBERATE_BUY_GAS_BUFFER,
    DELIBERATE_BUY_PRIVATE_ATTEMPTS: process.env.DELIBERATE_BUY_PRIVATE_ATTEMPTS,
    MEV_CONFIRM_WINDOW_MS: process.env.MEV_CONFIRM_WINDOW_MS,
    MEV_CONFIRM_POLL_MS: process.env.MEV_CONFIRM_POLL_MS,
};

afterEach(() => {
    for (const [k, v] of Object.entries(SAVED_ENV)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.resetModules();
    delete process.env.EXIT_GATE_SELL_GAS_BUFFER;
    delete process.env.DELIBERATE_BUY_GAS_BUFFER;
    process.env.DELIBERATE_BUY_PRIVATE_ATTEMPTS = '1';
    process.env.MEV_CONFIRM_WINDOW_MS = '20';
    process.env.MEV_CONFIRM_POLL_MS = '5';

    insertTradeRun.mockReset();
    updateTradeStatusRun.mockReset();
    recordSnipeMock.mockReset();
    sendCtxAlertMock.mockReset();
    reconcileInclusionMock.mockClear();
    reconcileImpl = () => ({ outcome: 'not-landed' });

    // Private leg: NOT landed, surfaces a reconcilable hash + nonce so the ladder
    // reaches the no-double-buy guard → (clean) → the public broadcast (HI-01 site).
    escalatePrivateBuyMock.mockReset().mockResolvedValue({
        landed: false,
        lastSignedHash: BROADCAST_HASH_H,
        lastNonce: SUBMITTED_NONCE,
    });

    swapFoTBuyMock.mockReset().mockResolvedValue({
        hash: '0xpublicbuyhash',
        wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18_000_123 }),
    });
    getAmountsOutMock.mockReset().mockResolvedValue([0n, 1_000_000_000_000_000_000n]);
    getPairMock.mockReset().mockResolvedValue('0xpa1r000000000000000000000000000000000001');

    tokenBalance = 0n;
    latestNonceValue = SUBMITTED_NONCE;
    balanceWei = ethers.parseEther('10');
    getFeeDataImpl = () => ({ maxFeePerGas: MAX_FEE_WEI, maxPriorityFeePerGas: PRIORITY_WEI, gasPrice: MAX_FEE_WEI });
});

describe('Phase 21.3-06 — deliberate-buy affordability (CR-01 + HI-01) [REAL-PATH, REAL gate]', () => {
    // -------------------------------------------------------------------------
    // CR-01: the gate prices the REAL amountInWei, not snipeAmount.
    // -------------------------------------------------------------------------
    it('CR-01: a deliberate amountInWei (0.05) > snipeAmount (0.01) on a thin wallet is REFUSED at the gate — NO private submit, NO public swap', async () => {
        // Fund the wallet so it covers the DELIBERATE floor priced at the SNIPE
        // amount (what the pre-fix gate prices) but NOT the floor priced at the
        // real 0.05 spend. 1 wei below the real deliberate floor → must refuse.
        balanceWei = deliberateFloorWei(DELIBERATE_AMOUNT_WEI) - 1n;
        // Sanity: this same balance comfortably covers the snipe-priced floor.
        expect(balanceWei).toBeGreaterThan(deliberateFloorWei(SNIPE_VALUE_WEI));

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, DELIBERATE_AMOUNT_WEI, V2_DEX as never);

        // Refused at the gate → null, and NEITHER leg ran.
        expect(result).toBeNull();
        expect(escalatePrivateBuyMock).not.toHaveBeenCalled();
        expect(swapFoTBuyMock).not.toHaveBeenCalled();
        expect(insertTradeRun).not.toHaveBeenCalled();
    });

    it('CR-01 (counter-case): the SAME wallet balance ALLOWS a buy priced at the snipe amount (proves the divergence is the cause, not a thin wallet)', async () => {
        // Same balance as the refused case, but a deliberate amount == snipe amount
        // → the gate (priced on the real amount) now passes and the ladder runs.
        balanceWei = deliberateFloorWei(DELIBERATE_AMOUNT_WEI) - 1n;
        tokenBalance = 0n;
        latestNonceValue = SUBMITTED_NONCE;

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, SNIPE_VALUE_WEI, V2_DEX as never);

        // Gate passes at the small amount → private leg runs → public fallback fires.
        expect(escalatePrivateBuyMock).toHaveBeenCalled();
        expect(swapFoTBuyMock).toHaveBeenCalledTimes(1);
        expect(result).toBe('0xpublicbuyhash');
    });

    it('CR-01: a deliberate amount the wallet CAN afford passes the gate and proceeds (no false refusal)', async () => {
        balanceWei = deliberateFloorWei(DELIBERATE_AMOUNT_WEI) + ethers.parseEther('1');
        tokenBalance = 0n;
        latestNonceValue = SUBMITTED_NONCE;

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, DELIBERATE_AMOUNT_WEI, V2_DEX as never);

        expect(escalatePrivateBuyMock).toHaveBeenCalled();
        expect(swapFoTBuyMock).toHaveBeenCalledTimes(1);
        expect(result).toBe('0xpublicbuyhash');
    });

    // -------------------------------------------------------------------------
    // HI-01: the public leg re-checks live affordability immediately before the
    // broadcast. A base-fee rise after the gate must abort fail-closed.
    // -------------------------------------------------------------------------
    it('HI-01: a base-fee RISE between the gate and the public broadcast aborts the public buy fail-closed — NO swap call, returns null', async () => {
        // The wallet passes the gate at the LOW base fee (deliberate amount affordable),
        // with only a THIN margin above the deliberate floor.
        balanceWei = deliberateFloorWei(DELIBERATE_AMOUNT_WEI) + ethers.parseEther('0.001');
        tokenBalance = 0n;
        latestNonceValue = SUBMITTED_NONCE;

        // After the gate read, the base fee SPIKES 50x (calm-gas → congestion). The
        // pre-broadcast re-check reads the live (spiked) fee + balance and must abort.
        let feeReads = 0;
        getFeeDataImpl = () => {
            feeReads += 1;
            if (feeReads <= 1) {
                // gate read — calm gas (the deliberate amount is affordable here).
                return { maxFeePerGas: MAX_FEE_WEI, maxPriorityFeePerGas: PRIORITY_WEI, gasPrice: MAX_FEE_WEI };
            }
            // pre-broadcast re-check — base fee spiked.
            const spikedBase = BASE_FEE_WEI * 50n;
            const spikedMax = spikedBase + PRIORITY_WEI;
            return { maxFeePerGas: spikedMax, maxPriorityFeePerGas: PRIORITY_WEI, gasPrice: spikedMax };
        };

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, DELIBERATE_AMOUNT_WEI, V2_DEX as never);

        // The gate passed (private leg ran), but the pre-broadcast re-check caught
        // the base-fee rise → the public swap is NEVER called, returns null.
        expect(escalatePrivateBuyMock).toHaveBeenCalled();
        expect(swapFoTBuyMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
        expect(insertTradeRun).not.toHaveBeenCalled();
        // A structured refusal alert fired (D-ALERTS).
        const alertMsgs = sendCtxAlertMock.mock.calls.map((c) => String(c[1] ?? ''));
        expect(alertMsgs.some((m) => /afford|refus|exit|reserve/i.test(m))).toBe(true);
    });

    it('HI-01: when gas stays calm the pre-broadcast re-check passes and the public buy broadcasts exactly once', async () => {
        balanceWei = deliberateFloorWei(DELIBERATE_AMOUNT_WEI) + ethers.parseEther('1');
        tokenBalance = 0n;
        latestNonceValue = SUBMITTED_NONCE;
        // Fee stays calm across both reads (default getFeeDataImpl).

        const { executeDeliberateBuy } = await import('../../../src/bot');
        const ctx = buildCtx() as unknown as Parameters<typeof executeDeliberateBuy>[0];

        const result = await executeDeliberateBuy(ctx, TOKEN, DELIBERATE_AMOUNT_WEI, V2_DEX as never);

        expect(swapFoTBuyMock).toHaveBeenCalledTimes(1);
        expect(result).toBe('0xpublicbuyhash');
    });
});
