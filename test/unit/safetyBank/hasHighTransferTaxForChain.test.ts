// test/unit/safetyBank/hasHighTransferTaxForChain.test.ts
// HONEY-11 regression contract for hasHighTransferTaxForChain (tokenSafety.ts:475-508).
// Asserts the gate NEVER returns its safe-equivalent (`false` = no high tax) on edge cases.
// Unsafe semantic: `true` = high tax = block buy.
//
// Current production code (line 506) catches RPC errors and returns `true` —
// the correct fail-closed semantic. This regression test LOCKS it.
//
// Observable-effect note (D-04): the plan's <action> block specified
// `mockContract.staticCall` as the observable for this gate, but the
// production code at lines 484-496 calls `router.getAmountsOut` and
// `routerWithSigner.swapExactETHForTokens` directly — there is no
// `.staticCall` on either path. The structurally equivalent observable
// is `getAmountsOut` (the first RPC call the gate makes). This deviates
// from the plan spec strictly to align the assertion with the actual
// underlying behavior — Rule 1 (auto-fix) applied to the spec to match
// the production code shape, not to weaken the test.

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

// ---- Mock Contract methods ----
const mockGetAmountsOut = vi.fn();
const mockSwapExactETHForTokens = vi.fn();

vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function () {
            return {
                getAmountsOut: mockGetAmountsOut,
                swapExactETHForTokens: mockSwapExactETHForTokens,
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
    mockGetAmountsOut.mockReset();
    mockSwapExactETHForTokens.mockReset();
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
            getAmountsOut: mockGetAmountsOut,
            swapExactETHForTokens: mockSwapExactETHForTokens,
        };
    });

    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('hasHighTransferTaxForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (true) when the underlying router getAmountsOut throws', async () => {
        mockGetAmountsOut.mockRejectedValueOnce(new Error('execution reverted: INVALID_PATH'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.hasHighTransferTaxForChain(ctx, MOCK_ROUTER, MOCK_TOKEN);

        // Critical: must NOT return false on RPC error (vacuous "no high tax" pass).
        expect(result).toBe(true);
    });

    it('returns unsafe (true) when the swap simulation throws after a valid getAmountsOut', async () => {
        mockGetAmountsOut.mockResolvedValueOnce([10n ** 16n, 1000n]);
        mockSwapExactETHForTokens.mockRejectedValueOnce(new Error('execution reverted: TAX_TRANSFER_FAILED'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.hasHighTransferTaxForChain(ctx, MOCK_ROUTER, MOCK_TOKEN);

        expect(result).toBe(true);
    });

    it('exercises the underlying behavior — getAmountsOut was actually invoked on the router (D-04 observable effect)', async () => {
        // Provide a benign success path so we can observe the underlying call.
        mockGetAmountsOut.mockResolvedValueOnce([10n ** 16n, 1000n]);
        mockSwapExactETHForTokens.mockResolvedValueOnce([10n ** 16n, 1000n]); // 0% tax
        const ctx = makeMockCtx();

        await tokenSafetyModule.hasHighTransferTaxForChain(ctx, MOCK_ROUTER, MOCK_TOKEN);

        // Observable effect: the gate actually hit the underlying router method.
        // (See header comment for why getAmountsOut substitutes for the plan-specified staticCall.)
        expect(mockGetAmountsOut).toHaveBeenCalled();
        expect(mockGetAmountsOut).toHaveBeenCalledTimes(1);
    });
});
