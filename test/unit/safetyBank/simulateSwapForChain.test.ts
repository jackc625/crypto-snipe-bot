// test/unit/safetyBank/simulateSwapForChain.test.ts
// HONEY-11 regression contract for simulateSwapForChain (tokenSafety.ts:392-416).
// Asserts the gate NEVER returns its safe-equivalent (`true` = swap simulated) on edge cases.
// Unsafe semantic: `false` = swap reverted = block buy.
//
// Current production code (line 414) catches RPC reverts and returns `false` —
// the correct fail-closed semantic. This regression test LOCKS it.
//
// Observable-effect note (D-04): asserts that staticCall was actually invoked —
// proves the gate executes the underlying router behavior, not a method-name probe.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChainContext } from '../../../src/chainRegistry';

const MOCK_TOKEN = '0x1234567890abcdef1234567890abcdef12345678';
const MOCK_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

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

// ---- Mock Contract.swapExactETHForTokens.staticCall ----
const mockStaticCallSwap = vi.fn();
const mockSwapExactETHForTokens = vi.fn();

vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function () {
            return {
                swapExactETHForTokens: Object.assign(mockSwapExactETHForTokens, {
                    staticCall: mockStaticCallSwap,
                }),
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
    mockStaticCallSwap.mockReset();
    mockSwapExactETHForTokens.mockReset();
    (mockSwapExactETHForTokens as Record<string, unknown>).staticCall = mockStaticCallSwap;
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();

    // Re-register Contract mock implementation. vitest.config.ts sets
    // `mockReset: true` for the `unit` project, which clears mock implementations
    // between tests. Without this re-registration, Contract() returns undefined
    // and the underlying method mocks never get hit. (Matches the pattern in
    // test/unit/tokenSafety.test.ts:144-173.)
    const { Contract } = await import('ethers') as Record<string, ReturnType<typeof vi.fn>>;
    Contract.mockImplementation(function () {
        return {
            swapExactETHForTokens: Object.assign(mockSwapExactETHForTokens, {
                staticCall: mockStaticCallSwap,
            }),
        };
    });

    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('simulateSwapForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (false) when the underlying router staticCall reverts (honeypot revert)', async () => {
        mockStaticCallSwap.mockRejectedValueOnce(new Error('execution reverted: TRANSFER_FROM_FAILED'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.simulateSwapForChain(ctx, MOCK_ROUTER, MOCK_TOKEN);

        // Critical: must NOT return true on revert (vacuous "swap OK" pass — exact V3 bug class).
        expect(result).toBe(false);
    });

    it('returns unsafe (false) on RPC-level failure (network error, NOT a contract revert)', async () => {
        mockStaticCallSwap.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.simulateSwapForChain(ctx, MOCK_ROUTER, MOCK_TOKEN);

        expect(result).toBe(false);
    });

    it('exercises the underlying behavior — staticCall was actually invoked on the router (D-04 observable effect)', async () => {
        mockStaticCallSwap.mockResolvedValueOnce([0n, 1000n]);
        const ctx = makeMockCtx();

        await tokenSafetyModule.simulateSwapForChain(ctx, MOCK_ROUTER, MOCK_TOKEN);

        // Observable effect: the gate ACTUALLY called the router's swap simulation,
        // proving the gate exercised the underlying behavior (not a method-name probe).
        expect(mockStaticCallSwap).toHaveBeenCalled();
        expect(mockStaticCallSwap).toHaveBeenCalledTimes(1);
    });
});
