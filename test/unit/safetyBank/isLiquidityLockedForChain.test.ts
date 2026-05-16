// test/unit/safetyBank/isLiquidityLockedForChain.test.ts
// HONEY-11 regression contract for isLiquidityLockedForChain (tokenSafety.ts:346-352).
// Asserts the gate NEVER returns its safe-equivalent (`true` = locked = safe) on edge cases.
// Unsafe semantic for this gate is INVERTED: `false` = unlocked = unsafe = block buy;
//                                            `true` = locked = safe.
//
// Edge cases exercised:
//   1) Underlying API (axios) throws AND the burn fallback fails: must return false
//      (unsafe — block the buy). NEVER return true vacuously.
//   2) API returns an empty-locks payload: must return false (no lock = unsafe).
//   3) Observable effect: a structured warn log was emitted on the fallback path
//      (proves the gate exercised the underlying behavior, not a method-name probe).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChainContext } from '../../../src/chainRegistry';

const MOCK_PAIR = '0xabcdef1234567890abcdef1234567890abcdef12';

// ---- Mock axios so unicrypt API call paths are intercepted ----
const mockAxiosGet = vi.fn();
vi.mock('axios', () => ({
    default: { get: mockAxiosGet, post: vi.fn() },
}));

// ---- Mock retry to invoke the inner fn directly ----
vi.mock('../../../src/utils/retry', () => ({
    retry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// ---- Mock the module-level logger used inside safetyProviders/unicrypt.ts ----
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

// ---- Mock ethers Contract so the burn-fallback Contract construction is captured ----
const balanceOfMock = vi.fn();
const totalSupplyMock = vi.fn();
vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function () {
            return {
                balanceOf: balanceOfMock,
                totalSupply: totalSupplyMock,
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
    mockAxiosGet.mockReset();
    balanceOfMock.mockReset();
    totalSupplyMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();
    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('isLiquidityLockedForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (false) when both the Unicrypt API AND the burn fallback fail', async () => {
        // Unicrypt API throws → falls back to burn check.
        // Burn check Contract calls throw → fallback returns false.
        // End result MUST be false (not vacuously true / "locked").
        mockAxiosGet.mockRejectedValueOnce(new Error('Unicrypt 503'));
        balanceOfMock.mockRejectedValueOnce(new Error('eth_call failed'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.isLiquidityLockedForChain(ctx, MOCK_PAIR);

        // Unsafe-equivalent: false (= unlocked = block the buy).
        // Must NOT vacuously return true ("locked" without evidence).
        expect(result).toBe(false);
    });

    it('returns unsafe (false) on malformed/empty Unicrypt response (no locks array)', async () => {
        // Unicrypt returns a response with no .locks field → falls back to burn check.
        // Burn check returns false (not enough burn).
        mockAxiosGet.mockResolvedValueOnce({ data: {} });
        balanceOfMock.mockResolvedValueOnce(0n);
        totalSupplyMock.mockResolvedValueOnce(1_000_000n);
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.isLiquidityLockedForChain(ctx, MOCK_PAIR);

        expect(result).toBe(false);
    });

    it('exercises the underlying behavior — a fallback warn log was emitted with check tag (D-04 observable effect)', async () => {
        // Force fallback path and assert the structured warn log fires with the
        // discriminating `check: 'unicrypt'` tag (proves we entered the gate's body
        // and traversed the failure path — NOT a method-name probe).
        mockAxiosGet.mockRejectedValueOnce(new Error('Unicrypt timeout'));
        balanceOfMock.mockRejectedValueOnce(new Error('eth_call failed'));
        const ctx = makeMockCtx();

        await tokenSafetyModule.isLiquidityLockedForChain(ctx, MOCK_PAIR);

        // Observable effect: the structured warn log on the fallback path.
        expect(loggerWarnMock).toHaveBeenCalledWith(
            expect.objectContaining({ check: 'unicrypt' }),
            expect.anything()
        );
    });
});
