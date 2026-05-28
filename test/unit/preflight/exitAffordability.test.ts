// Phase 21.2 / Plan 21.2-08 / STOP-THE-LINE-04-A — buy-time entry affordability gate.
//
// Finding A (D-EXIT-AFFORDABILITY-GATE): NEVER enter a position the wallet cannot
// guarantee an exit from. At the snipe path, just before the buy submit, the gate
// refuses the snipe unless the wallet balance covers
//   snipeValue + worstCaseBuyGas + worstCasePublicSellGas + buffer.
//
// The NEW term — worstCasePublicSellGas — prices the GUARANTEED PUBLIC exit:
//   maxGasLimit × (baseFee × EXIT_GATE_SELL_GAS_BUFFER) + approvalGas
// i.e. a NORMAL-priced public sell (no high private priority fee). That is the
// whole point: the always-available exit must always be affordable.
//
// Capital-safety invariant: the gate FAILS CLOSED on any RPC error (balance or
// fee-data read throwing) — it REFUSES rather than risk an unexitable entry.
//
// Test contract (per 21.2-08-PLAN <behavior>):
//   1. refuse thin       — balance below the floor → passed:false, structured payload
//   2. pass affordable   — balance above the floor → passed:true
//   3. fail closed       — balance/baseFee fetch throws → passed:false (refuse)
//   4. public-exit math  — worstCasePublicSellGas = maxGasLimit × (baseFee ×
//                          EXIT_GATE_SELL_GAS_BUFFER) + approvalGas (normal-priced),
//                          NOT maxGasLimit × a high private priority fee.
//
// Mirrors the test/unit/preflight/walletBalance.test.ts harness shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

// Logger mock — capture .info / .warn / .error / .fatal across all child loggers.
const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const logFatal = vi.fn();
const logDebug = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: logInfo,
            warn: logWarn,
            error: logError,
            fatal: logFatal,
            debug: logDebug,
        }),
        info: logInfo,
        warn: logWarn,
        error: logError,
        fatal: logFatal,
        debug: logDebug,
    },
}));

// MEV strategies — the gate does not call MEV, but preflight imports txManager.
vi.mock('../../../src/utils/txManager', () => ({
    createMevStrategy: vi.fn(() => ({ healthCheck: vi.fn().mockResolvedValue(true), name: 'mock' })),
    sendTxWithRetry: vi.fn(),
}));

// Notifier — disable Telegram + WS broadcast during preflight tests.
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn(),
    sendTelegramAlert: vi.fn(),
    sendChainAlert: vi.fn(),
}));

// DB mocks — preflight imports getAntirugDryRunStarted + getStaleTradesQuery.
vi.mock('../../../src/utils/db', () => ({
    getAntirugDryRunStarted: { get: vi.fn(() => undefined) },
    getStaleTradesQuery: { all: vi.fn(() => []) },
    db: {},
}));

// ---------------------------------------------------------------------------
// Helpers — a minimal chain shape the gate consumes (httpProvider + wallet +
// gas config + snipeAmount + gasBuffer), mirroring walletBalance.test.ts.
// ---------------------------------------------------------------------------

interface MockGasConfig {
    type: 'eip1559' | 'legacy';
    multiplier: number;
    maxGasLimit: bigint;
}

interface MockChain {
    name: string;
    nativeCurrency: string;
    snipeAmount: string;
    gasBuffer: string;
    gas: MockGasConfig;
    wallet: { address: string };
    httpProvider: {
        getBalance: ReturnType<typeof vi.fn>;
        getFeeData: ReturnType<typeof vi.fn>;
    };
}

// Defaults: eth-like. maxGasLimit 300k. snipe 0.003. gasBuffer 0.005 (the fixed
// cushion). baseFee 20 gwei (maxFeePerGas 30 gwei, priority 10 gwei so
// baseFee = maxFee - priority = 20 gwei).
const BASE_FEE_WEI = ethers.parseUnits('20', 'gwei');
const PRIORITY_WEI = ethers.parseUnits('10', 'gwei');
const MAX_FEE_WEI = BASE_FEE_WEI + PRIORITY_WEI; // 30 gwei

function makeMockChain(overrides: Partial<MockChain> = {}): MockChain {
    return {
        name: 'eth',
        nativeCurrency: 'ETH',
        snipeAmount: '0.003',
        gasBuffer: '0.005',
        gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
        wallet: { address: '0x' + 'b'.repeat(40) },
        httpProvider: {
            getBalance: vi.fn(),
            getFeeData: vi.fn().mockResolvedValue({
                maxFeePerGas: MAX_FEE_WEI,
                maxPriorityFeePerGas: PRIORITY_WEI,
                gasPrice: MAX_FEE_WEI,
            }),
        },
        ...overrides,
    };
}

const ORIGINAL_ENV = { ...process.env };

// EXIT_GATE_SELL_GAS_BUFFER default per config.ts / .env.example.
const EXIT_GATE_BUFFER_DEFAULT = 2.0;

describe('checkEntryExitAffordability (buy-time entry gate)', () => {
    beforeEach(() => {
        logInfo.mockClear();
        logWarn.mockClear();
        logError.mockClear();
        logFatal.mockClear();
        logDebug.mockClear();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.EXIT_GATE_SELL_GAS_BUFFER;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...ORIGINAL_ENV };
    });

    // -- helper to compute the expected floor exactly the way the gate must --
    function expectedFloorWei(chain: MockChain, buffer = EXIT_GATE_BUFFER_DEFAULT): bigint {
        const snipeValue = ethers.parseEther(chain.snipeAmount);
        // worst-case buy gas: maxGasLimit × maxFeePerGas (the max the buy can pay).
        const buyGas = chain.gas.maxGasLimit * MAX_FEE_WEI;
        // worst-case PUBLIC sell gas: maxGasLimit × (baseFee × buffer) + approvalGas.
        const bufferedBaseFee = (BASE_FEE_WEI * BigInt(Math.round(buffer * 100))) / 100n;
        const approvalGas = 60_000n * bufferedBaseFee;
        const sellGas = chain.gas.maxGasLimit * bufferedBaseFee + approvalGas;
        const cushion = ethers.parseEther(chain.gasBuffer);
        return snipeValue + buyGas + sellGas + cushion;
    }

    it('Test 1 (refuse thin): balance below the floor REFUSES the snipe (passed:false) + structured payload', async () => {
        const chain = makeMockChain();
        const floor = expectedFloorWei(chain);
        // 1 wei below the floor → must refuse.
        chain.httpProvider.getBalance.mockResolvedValue(floor - 1n);

        const { checkEntryExitAffordability } = await import('../../../src/preflight');
        const result = await checkEntryExitAffordability(chain as never);

        expect(result.passed).toBe(false);
        expect(result.check).toBe('entry-exit-affordability');
        expect(result.chain).toBe('eth');
        expect(result.reason).toMatch(/exit|afford|floor/i);
        expect(result.details).toBeDefined();
        expect(result.details?.balance).toBeDefined();
        expect(result.details?.floor).toBeDefined();
        // The worst-case PUBLIC sell gas term must be surfaced in the payload.
        expect(result.details?.worstCasePublicSellGas).toBeDefined();
    });

    it('Test 2 (pass affordable): balance at/above the floor PASSES (snipe proceeds)', async () => {
        const chain = makeMockChain();
        const floor = expectedFloorWei(chain);
        // Exactly at the floor → passes (>= floor).
        chain.httpProvider.getBalance.mockResolvedValue(floor);

        const { checkEntryExitAffordability } = await import('../../../src/preflight');
        const atFloor = await checkEntryExitAffordability(chain as never);
        expect(atFloor.passed).toBe(true);

        // Comfortably above → also passes.
        chain.httpProvider.getBalance.mockResolvedValue(floor + ethers.parseEther('1'));
        const above = await checkEntryExitAffordability(chain as never);
        expect(above.passed).toBe(true);
    });

    it('Test 3 (fail closed on RPC error): a balance fetch that throws REFUSES (does not proceed)', async () => {
        const chain = makeMockChain();
        chain.httpProvider.getBalance.mockRejectedValue(new Error('RPC down'));

        const { checkEntryExitAffordability } = await import('../../../src/preflight');
        const result = await checkEntryExitAffordability(chain as never);

        expect(result.passed).toBe(false);
        expect(result.check).toBe('entry-exit-affordability');
        expect(result.reason).toMatch(/threw|RPC|fail/i);
        expect(result.details?.err).toBeDefined();
    });

    it('Test 3b (fail closed on RPC error): a getFeeData fetch that throws REFUSES', async () => {
        const chain = makeMockChain();
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('100'));
        chain.httpProvider.getFeeData.mockRejectedValue(new Error('fee oracle down'));

        const { checkEntryExitAffordability } = await import('../../../src/preflight');
        const result = await checkEntryExitAffordability(chain as never);

        expect(result.passed).toBe(false);
        expect(result.reason).toMatch(/threw|fee|fail/i);
    });

    it('Test 4 (public-exit math): worstCasePublicSellGas = maxGasLimit × (baseFee × EXIT_GATE_SELL_GAS_BUFFER) + approvalGas (normal-priced, NOT a high private priority fee)', async () => {
        const { computeWorstCasePublicExitGas } = await import('../../../src/preflight');

        const sellGasLimit = 300_000n;
        const approvalGasLimit = 60_000n;
        const buffer = 2.0;

        const got = computeWorstCasePublicExitGas({
            baseFeeWei: BASE_FEE_WEI,
            sellGasLimit,
            approvalGasLimit,
            sellGasBuffer: buffer,
        });

        // Expected: (sellGasLimit + approvalGasLimit) × (baseFee × buffer).
        const bufferedBaseFee = (BASE_FEE_WEI * BigInt(Math.round(buffer * 100))) / 100n;
        const expected = (sellGasLimit + approvalGasLimit) * bufferedBaseFee;
        expect(got).toBe(expected);

        // CRITICAL: it prices a NORMAL-priced public sell. A high private priority
        // fee (e.g. the 25-gwei sell ceiling) must NOT appear in the term. Compute
        // what the WRONG (private-ceiling) term would be and assert we are far below it.
        const wrongPrivateCeiling = ethers.parseUnits('25', 'gwei');
        const wrongTerm = (sellGasLimit + approvalGasLimit) * (BASE_FEE_WEI + wrongPrivateCeiling);
        expect(got).toBeLessThan(wrongTerm);
    });

    it('Test 4b (buffer is env-tunable): EXIT_GATE_SELL_GAS_BUFFER override flows into the gate floor', async () => {
        // Raise the buffer → the floor rises → a balance that passed at default now fails.
        const chain = makeMockChain();
        const floorAtDefault = expectedFloorWei(chain, EXIT_GATE_BUFFER_DEFAULT);
        // Fund exactly at the default floor (passes at default).
        chain.httpProvider.getBalance.mockResolvedValue(floorAtDefault);

        process.env.EXIT_GATE_SELL_GAS_BUFFER = '3.0';
        const { checkEntryExitAffordability } = await import('../../../src/preflight');
        const result = await checkEntryExitAffordability(chain as never);
        // Higher buffer → higher floor → the same balance now REFUSES.
        expect(result.passed).toBe(false);
    });

    it('uses bigint precision (no float drift) — the floor is an exact wei BigInt', async () => {
        const chain = makeMockChain();
        const floor = expectedFloorWei(chain);
        chain.httpProvider.getBalance.mockResolvedValue(floor);
        const { checkEntryExitAffordability } = await import('../../../src/preflight');
        const atFloor = await checkEntryExitAffordability(chain as never);
        expect(atFloor.passed).toBe(true);
        // One wei below → refuse (exact boundary).
        chain.httpProvider.getBalance.mockResolvedValue(floor - 1n);
        const below = await checkEntryExitAffordability(chain as never);
        expect(below.passed).toBe(false);
    });
});
