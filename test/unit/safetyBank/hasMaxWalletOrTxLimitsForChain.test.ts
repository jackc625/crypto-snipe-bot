// test/unit/safetyBank/hasMaxWalletOrTxLimitsForChain.test.ts
// HONEY-11 regression contract for hasMaxWalletOrTxLimitsForChain (tokenSafety.ts:513-550).
// Asserts the gate NEVER returns its safe-equivalent (`false` = no limits) on edge cases.
// Unsafe semantic: `true` = anti-bot limits detected = block buy.
//
// Current production code (line 548) catches RPC errors and returns `true` —
// the correct fail-closed semantic. This regression test LOCKS it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChainContext } from '../../../src/chainRegistry';

const MOCK_TOKEN = '0x1234567890abcdef1234567890abcdef12345678';

// ---- Module-level logger mock ----
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

// ---- Mock Contract methods ----
const mockTotalSupply = vi.fn();
const mockMaxWalletAmount = vi.fn();
const mockMaxWallet = vi.fn();
const mockMaxTxAmount = vi.fn();
const mockMaxTransactionAmount = vi.fn();

vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function () {
            return {
                totalSupply: mockTotalSupply,
                maxWalletAmount: mockMaxWalletAmount,
                maxWallet: mockMaxWallet,
                maxTxAmount: mockMaxTxAmount,
                maxTransactionAmount: mockMaxTransactionAmount,
            };
        }),
    };
});

const loggerWarnMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerDebugMock = vi.fn();
const loggerErrorMock = vi.fn();

function makeMockCtx(): ChainContext {
    return {
        chain: {
            chainId: 1,
            name: 'eth',
            displayName: '[ETH]',
            enabled: true,
            nativeCurrency: 'ETH',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            httpRpcUrl: '',
            wsRpcUrl: null,
            dexes: [],
            mevStrategy: 'flashbots',
            mevConfig: {},
            safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
            gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 500000n },
            snipeAmount: '0.01',
            maxCapital: '0.1',
            explorerUrl: 'https://etherscan.io',
            minLiquidityThreshold: '1',
        },
        httpProvider: {} as unknown as ChainContext['httpProvider'],
        wsProvider: null,
        wallet: { address: '0xMockWallet' } as unknown as ChainContext['wallet'],
        log: {
            info: loggerInfoMock,
            warn: loggerWarnMock,
            debug: loggerDebugMock,
            error: loggerErrorMock,
            fatal: vi.fn(),
            child: () => ({ info: loggerInfoMock, warn: loggerWarnMock, debug: loggerDebugMock, error: loggerErrorMock }),
        } as unknown as ChainContext['log'],
    } as ChainContext;
}

let tokenSafetyModule: typeof import('../../../src/utils/tokenSafety');

beforeEach(async () => {
    mockTotalSupply.mockReset();
    mockMaxWalletAmount.mockReset().mockRejectedValue(new Error('not found'));
    mockMaxWallet.mockReset().mockRejectedValue(new Error('not found'));
    mockMaxTxAmount.mockReset().mockRejectedValue(new Error('not found'));
    mockMaxTransactionAmount.mockReset().mockRejectedValue(new Error('not found'));
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();
    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('hasMaxWalletOrTxLimitsForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (true) when the underlying ERC20 totalSupply throws', async () => {
        // totalSupply RPC fails → outer catch → fail-closed return true.
        mockTotalSupply.mockRejectedValueOnce(new Error('eth_call totalSupply failed'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.hasMaxWalletOrTxLimitsForChain(ctx, MOCK_TOKEN);

        // Critical: must NOT return false on RPC error (vacuous "no limits" pass).
        expect(result).toBe(true);
    });

    it('returns unsafe (true) on a detected anti-bot limit (maxWalletAmount < 1% of totalSupply)', async () => {
        // Production line 536: percent < 0.01 → return true.
        // totalSupply = 1_000_000; maxWalletAmount = 100 (0.0001% — anti-bot limit).
        mockTotalSupply.mockResolvedValueOnce(1_000_000n);
        mockMaxWalletAmount.mockReset().mockResolvedValueOnce(100n);
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.hasMaxWalletOrTxLimitsForChain(ctx, MOCK_TOKEN);

        expect(result).toBe(true);
    });

    it('exercises the underlying behavior — a structured warn log was emitted with check tag (D-04 observable effect)', async () => {
        // Force the outer catch path and verify the warn log fires.
        mockTotalSupply.mockRejectedValueOnce(new Error('boom'));
        const ctx = makeMockCtx();

        await tokenSafetyModule.hasMaxWalletOrTxLimitsForChain(ctx, MOCK_TOKEN);

        expect(loggerWarnMock).toHaveBeenCalledWith(
            expect.objectContaining({ check: 'maxLimits' }),
            expect.anything()
        );
    });
});
