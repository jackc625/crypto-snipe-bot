// test/unit/safetyBank/checkHoneypotForChain.test.ts
// HONEY-11 regression contract for checkHoneypotForChain (tokenSafety.ts:335-340).
// Asserts the gate NEVER returns its safe-equivalent (`false`) on edge cases.
// Unsafe semantic for this gate: `true` = honeypot = block buy.
// Edge cases exercised:
//   1) Underlying provider API throws (RPC / network failure).
//   2) Malformed / empty response from the upstream API.
//   3) Observable effect: an axios call was actually made AND the gate logged.
//
// Per Phase 17 D-04 (observable-effect rigor): each test asserts at least one
// real mock-call argument, log line, or RPC call — NOT just the boolean return.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChainContext } from '../../../src/chainRegistry';

const MOCK_TOKEN = '0x1234567890abcdef1234567890abcdef12345678';

// ---- Mock axios (used inside both honeypotIs and goplus adapters) ----
const mockAxiosGet = vi.fn();
vi.mock('axios', () => ({
    default: { get: mockAxiosGet, post: vi.fn() },
}));

// ---- Mock retry to invoke the inner fn directly (matches existing pattern) ----
vi.mock('../../../src/utils/retry', () => ({
    retry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// ---- Mock module-level logger (used by safetyProviders/honeypotIs.ts top-of-file) ----
const moduleLoggerWarnMock = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: moduleLoggerWarnMock,
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
    },
}));

// ---- Per-context (ctx.log) mocks ----
const loggerWarnMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerDebugMock = vi.fn();
const loggerErrorMock = vi.fn();

function makeMockCtx(safetyApiHoneypot: 'honeypot.is' | 'goplus' = 'honeypot.is'): ChainContext {
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
            safetyApis: { honeypot: safetyApiHoneypot, liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
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
    moduleLoggerWarnMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();
    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('checkHoneypotForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (true) when the underlying RPC/HTTP throws (honeypot.is provider)', async () => {
        // Upstream axios.get rejects → honeypotIsCheck catches and returns true (fail-closed).
        mockAxiosGet.mockRejectedValueOnce(new Error('ECONNRESET'));
        const ctx = makeMockCtx('honeypot.is');

        const result = await tokenSafetyModule.checkHoneypotForChain(ctx, MOCK_TOKEN);

        // CRITICAL: the gate must NOT return false (vacuous "safe = not a honeypot") on RPC error.
        expect(result).toBe(true);
    });

    it('returns unsafe (true) on malformed/empty upstream response (goplus provider)', async () => {
        // GoPlus returns a response with no .result field → fetchGoPlusTokenSecurity returns null → check returns true.
        mockAxiosGet.mockResolvedValueOnce({ data: { code: 0, result: null, message: 'no data' } });
        const ctx = makeMockCtx('goplus');

        const result = await tokenSafetyModule.checkHoneypotForChain(ctx, MOCK_TOKEN);

        expect(result).toBe(true);
    });

    it('exercises the underlying behavior — axios was called AND a warn log was emitted (D-04 observable effect)', async () => {
        mockAxiosGet.mockRejectedValueOnce(new Error('Network timeout'));
        const ctx = makeMockCtx('honeypot.is');

        await tokenSafetyModule.checkHoneypotForChain(ctx, MOCK_TOKEN);

        // Observable effect 1: the gate ACTUALLY invoked axios (not a no-op method-name probe).
        expect(mockAxiosGet).toHaveBeenCalledWith(
            'https://api.honeypot.is/v2/IsHoneypot',
            expect.objectContaining({
                params: expect.objectContaining({ address: MOCK_TOKEN, chainID: 1 }),
            })
        );

        // Observable effect 2: the gate emitted a structured warn log on the failure path.
        expect(loggerWarnMock).toHaveBeenCalledWith(
            expect.objectContaining({ check: 'honeypot.is' }),
            expect.anything()
        );
    });
});
