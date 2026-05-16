// test/unit/safetyBank/isLiquiditySufficientForChain.test.ts
// HONEY-11 regression contract for isLiquiditySufficientForChain (tokenSafety.ts:421-447).
// Asserts the gate NEVER returns its safe-equivalent (`true` = sufficient) on edge cases.
// Unsafe semantic: `false` = insufficient liquidity = block buy.
//
// Current production code (line 444) catches RPC errors and returns `false` —
// this is the correct fail-closed semantic. This regression test LOCKS that
// behavior so any future regression that flips it to `return true` on error
// (a vacuous-pass class bug) fails CI.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChainContext } from '../../../src/chainRegistry';

const MOCK_PAIR = '0xabcdef1234567890abcdef1234567890abcdef12';

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

// ---- Mock Contract methods used by the gate ----
const token0Mock = vi.fn();
const token1Mock = vi.fn();
const getReservesMock = vi.fn();

vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function () {
            return {
                token0: token0Mock,
                token1: token1Mock,
                getReserves: getReservesMock,
            };
        }),
    };
});

// ---- Per-context (ctx.log) mocks ----
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
    token0Mock.mockReset();
    token1Mock.mockReset();
    getReservesMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();
    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('isLiquiditySufficientForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (false) when the underlying RPC getReserves throws', async () => {
        // Pair RPC fails → catch path → fail-closed return false.
        token0Mock.mockResolvedValueOnce('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'); // WETH
        token1Mock.mockResolvedValueOnce('0xtoken');
        getReservesMock.mockRejectedValueOnce(new Error('eth_call getReserves failed'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.isLiquiditySufficientForChain(ctx, MOCK_PAIR);

        // Critical: must NOT return true on RPC error (vacuous "sufficient" pass).
        expect(result).toBe(false);
    });

    it('returns unsafe (false) on malformed response (token0 throws — partial pair shape)', async () => {
        token0Mock.mockRejectedValueOnce(new Error('Pair has no token0 method — malformed contract'));
        token1Mock.mockResolvedValueOnce('0xanything');
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.isLiquiditySufficientForChain(ctx, MOCK_PAIR);

        expect(result).toBe(false);
    });

    it('exercises the underlying behavior — a structured warn log was emitted with check tag (D-04 observable effect)', async () => {
        // Force the catch path and verify the warn log was emitted.
        getReservesMock.mockRejectedValueOnce(new Error('boom'));
        token0Mock.mockResolvedValueOnce('0xtoken');
        token1Mock.mockResolvedValueOnce('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
        const ctx = makeMockCtx();

        await tokenSafetyModule.isLiquiditySufficientForChain(ctx, MOCK_PAIR);

        expect(loggerWarnMock).toHaveBeenCalledWith(
            expect.objectContaining({ check: 'liquidity' }),
            expect.anything()
        );
    });
});
