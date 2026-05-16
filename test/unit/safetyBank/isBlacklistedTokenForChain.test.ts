// test/unit/safetyBank/isBlacklistedTokenForChain.test.ts
// HONEY-11 regression contract for isBlacklistedTokenForChain (tokenSafety.ts:357-361).
// Asserts the gate NEVER returns its safe-equivalent (`false`) on edge cases.
// Unsafe semantic for this gate: `true` = blacklisted = block buy.
//
// AUDIT-DISCOVERED BUG (HONEY-11 fix-in-flight):
//   Current production code (lines 357-361) has NO try/catch around
//   `ctx.httpProvider.getCode(...)`. An RPC throw propagates up the
//   Promise.all chain. While `Promise.all`'s reject would block the buy at
//   the call-site, this is fragile and violates the "every gate fail-closed
//   in isolation" convention shared by the other 7 gates.
//
//   This test asserts the POST-FIX contract: `result === true` on RPC error
//   (fail-closed within the gate). The test FAILS against current production
//   code and PASSES after Task 2's try/catch retrofit lands. This is the
//   harm-prevention contract surfacing the audit-discovered bug.
//
// Per Phase 17 D-04 (observable-effect rigor): test 3 asserts
// `provider.getCode` was actually called — the gate exercised the underlying
// behavior, NOT just method-name probing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChainContext } from '../../../src/chainRegistry';

const MOCK_TOKEN = '0x1234567890abcdef1234567890abcdef12345678';

// ---- Module-level logger mock (matches existing tokenSafety.test.ts pattern) ----
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

// ---- Per-context (ctx.log) mocks ----
const loggerWarnMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerDebugMock = vi.fn();
const loggerErrorMock = vi.fn();

// ---- Mock httpProvider.getCode ----
const getCodeMock = vi.fn();

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
        httpProvider: {
            getCode: getCodeMock,
        } as unknown as ChainContext['httpProvider'],
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
    getCodeMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();
    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('isBlacklistedTokenForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (true) when the underlying RPC getCode throws (fail-closed)', async () => {
        // HONEY-11 fix-in-flight: this is the audit-discovered bug.
        // Production code at lines 357-361 currently lacks try/catch.
        // This test asserts the POST-Task-2 contract.
        getCodeMock.mockRejectedValueOnce(new Error('eth_getCode failed: connection reset'));
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.isBlacklistedTokenForChain(ctx, MOCK_TOKEN);

        // CRITICAL: must NOT return false (vacuous "safe = not blacklisted") on RPC error.
        // Must NOT propagate (would crash the Promise.all parallel bank in fragile ways).
        // Must return true (block the buy).
        expect(result).toBe(true);
    });

    it('returns unsafe (true) on malformed/empty bytecode response (no contract at address)', async () => {
        // Edge case: getCode returns '0x' (no contract). Per current logic this returns
        // false (no antibot selectors found in '0x'), which is the same safe-equivalent
        // as the V3 vacuous-pass bug. However per the audit findings inventory the
        // disposition is "no contract is handled by isKnownBadToken upstream" — for THIS
        // test, we exercise a different malformed shape: bytecode is null/undefined.
        // Current code: `bytecode.includes(sig)` throws on null/undefined, which exercises
        // the same RPC-throw fail-closed path (post-fix). Pre-fix: this also propagates.
        getCodeMock.mockResolvedValueOnce(null as unknown as string);
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.isBlacklistedTokenForChain(ctx, MOCK_TOKEN);

        // Post-fix contract: any unexpected shape from getCode must NOT return false.
        // (If the getCode contract changes, the gate still defends the buy.)
        expect(result).toBe(true);
    });

    it('exercises the underlying behavior — provider.getCode was called with the token address (D-04 observable effect)', async () => {
        // Provide a benign success path so we can observe the getCode call without
        // worrying about the fail-closed disposition.
        getCodeMock.mockResolvedValueOnce('0x6080604052' /* no antibot selectors */);
        const ctx = makeMockCtx();

        await tokenSafetyModule.isBlacklistedTokenForChain(ctx, MOCK_TOKEN);

        // Observable effect: the gate ACTUALLY hit the underlying RPC method.
        // This rules out a method-name-probe / vacuous bypass at the unit level.
        expect(getCodeMock).toHaveBeenCalledWith(MOCK_TOKEN);
        expect(getCodeMock).toHaveBeenCalledTimes(1);
    });
});
