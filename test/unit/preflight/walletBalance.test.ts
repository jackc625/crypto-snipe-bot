// Phase 20 / Plan 20-02 / OPS-LIVE-02 — Live tests for checkWalletBalance.
//
// Covers per-chain wallet floor enforcement (D-BALANCE-FLOOR):
//   floor = snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER
//
// Each test constructs a minimal mock ChainConfig with snipeAmount, gasBuffer,
// nativeCurrency, name, and an httpProvider stub whose getBalance returns a
// scripted wei BigInt. The pino fatal spy + log child are intercepted via
// vi.mock('../../../src/utils/logger'). process.exit is NOT spied here — the
// PreflightResult API surface separates the FATAL path (preflight()) from the
// pure-check path (checkWalletBalance()); checkWalletBalance returns the
// result without exiting.

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

// MEV strategies — checkWalletBalance does not call MEV, but other preflight
// functions imported indirectly may; stub to avoid network calls.
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

// DB mocks — preflight imports getAntirugDryRunStarted; stub for the test.
vi.mock('../../../src/utils/db', () => ({
    getAntirugDryRunStarted: { get: vi.fn(() => undefined) },
    db: {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockChain {
    name: string;
    nativeCurrency: string;
    snipeAmount: string;
    gasBuffer: string;
    chainId: number;
    blockAgeToleranceSec: number;
    envPrefix: string;
    mevStrategy: 'flashbots' | 'bloxroute' | 'passthrough';
    honeypotChecker: { deployedAddress: string | null };
    wallet: { address: string };
    httpProvider: { getBalance: ReturnType<typeof vi.fn> };
}

function makeMockChain(overrides: Partial<MockChain> = {}): MockChain {
    return {
        name: 'eth',
        nativeCurrency: 'ETH',
        snipeAmount: '0.003',
        gasBuffer: '0.005',
        chainId: 1,
        blockAgeToleranceSec: 300,
        envPrefix: 'ETH',
        mevStrategy: 'flashbots',
        honeypotChecker: { deployedAddress: '0x' + 'a'.repeat(40) },
        wallet: { address: '0x' + 'b'.repeat(40) },
        httpProvider: { getBalance: vi.fn() },
        ...overrides,
    };
}

const ORIGINAL_ENV = { ...process.env };

describe('checkWalletBalance', () => {
    beforeEach(() => {
        logInfo.mockClear();
        logWarn.mockClear();
        logError.mockClear();
        logFatal.mockClear();
        logDebug.mockClear();
        // Reset MAX_OPEN_POSITIONS to default
        delete process.env.MAX_OPEN_POSITIONS;
        process.env = { ...ORIGINAL_ENV };
        delete process.env.MAX_OPEN_POSITIONS;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...ORIGINAL_ENV };
    });

    it('passes (passed: true) when balance > floor (eth 0.01 > 0.008 ETH floor at MAX_OPEN_POSITIONS=1)', async () => {
        process.env.MAX_OPEN_POSITIONS = '1';
        // floor = 0.003 × 1 + 0.005 = 0.008 ETH
        const chain = makeMockChain();
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('0.01'));
        const { checkWalletBalance } = await import('../../../src/preflight');
        const result = await checkWalletBalance(chain as never);
        expect(result.passed).toBe(true);
        expect(result.check).toBe('wallet-balance');
        expect(logFatal).not.toHaveBeenCalled();
    });

    it('fails (passed: false) when balance < floor and emits structured payload + reason', async () => {
        process.env.MAX_OPEN_POSITIONS = '1';
        const chain = makeMockChain();
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('0.001'));
        const { checkWalletBalance } = await import('../../../src/preflight');
        const result = await checkWalletBalance(chain as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('wallet-balance');
        expect(result.chain).toBe('eth');
        expect(result.reason).toMatch(/wallet balance below floor/i);
        expect(result.details).toBeDefined();
        expect(result.details?.balance).toBeDefined();
        expect(result.details?.floor).toBeDefined();
        expect(result.details?.snipeAmount).toBe('0.003');
        expect(result.details?.maxOpenPositions).toBe(1);
        expect(result.details?.gasBuffer).toBe('0.005');
    });

    it('passes at boundary (balance === floor exactly, e.g. eth 0.008 === 0.008 ETH at MAX=1)', async () => {
        process.env.MAX_OPEN_POSITIONS = '1';
        // floor = 0.003 × 1 + 0.005 = 0.008 ETH
        const chain = makeMockChain();
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('0.008'));
        const { checkWalletBalance } = await import('../../../src/preflight');
        const result = await checkWalletBalance(chain as never);
        expect(result.passed).toBe(true);
    });

    it('consumes gasBuffer override (ETH_GAS_BUFFER=0.010 → chain.gasBuffer is read into floor)', async () => {
        process.env.MAX_OPEN_POSITIONS = '1';
        // chain.gasBuffer comes from the chain object (chainRegistry already applied env overlay)
        const chain = makeMockChain({ gasBuffer: '0.010' });
        // floor = 0.003 × 1 + 0.010 = 0.013 ETH
        // Balance just under floor must FAIL
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('0.012'));
        const { checkWalletBalance } = await import('../../../src/preflight');
        const result = await checkWalletBalance(chain as never);
        expect(result.passed).toBe(false);
        expect(result.details?.gasBuffer).toBe('0.010');
        // Balance at floor passes
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('0.013'));
        const passResult = await checkWalletBalance(chain as never);
        expect(passResult.passed).toBe(true);
    });

    it('consumes MAX_OPEN_POSITIONS env (MAX=3 → floor = 0.003 × 3 + 0.005 = 0.014 ETH)', async () => {
        process.env.MAX_OPEN_POSITIONS = '3';
        const chain = makeMockChain();
        // 0.013 < 0.014 → FAIL
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('0.013'));
        const { checkWalletBalance } = await import('../../../src/preflight');
        const result = await checkWalletBalance(chain as never);
        expect(result.passed).toBe(false);
        expect(result.details?.maxOpenPositions).toBe(3);
        // 0.014 === floor → PASS
        chain.httpProvider.getBalance.mockResolvedValue(ethers.parseEther('0.014'));
        const passResult = await checkWalletBalance(chain as never);
        expect(passResult.passed).toBe(true);
    });

    it('uses ethers.parseEther precision (0.003 + 0.005 → exact 8e15 wei BigInt, not 0.00799999...)', async () => {
        process.env.MAX_OPEN_POSITIONS = '1';
        const chain = makeMockChain();
        // 8e15 wei = 0.008 ether; exact boundary
        const exactFloorWei = 8_000_000_000_000_000n;
        chain.httpProvider.getBalance.mockResolvedValue(exactFloorWei);
        const { checkWalletBalance } = await import('../../../src/preflight');
        const result = await checkWalletBalance(chain as never);
        expect(result.passed).toBe(true);
        // Just below
        chain.httpProvider.getBalance.mockResolvedValue(exactFloorWei - 1n);
        const failResult = await checkWalletBalance(chain as never);
        expect(failResult.passed).toBe(false);
    });
});
