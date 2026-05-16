// test/unit/safetyBank/checkTokenMetadataForChain.test.ts
// HONEY-11 regression contract for checkTokenMetadataForChain (tokenSafety.ts:366-387).
// Asserts the gate NEVER returns its safe-equivalent (`true` = valid metadata) on edge cases.
// Unsafe semantic: `false` = unsafe metadata = block buy.
//
// Current production code (line 386) catches RPC errors and returns `false` —
// this is the correct fail-closed semantic. This regression test LOCKS it.

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
const symbolMock = vi.fn();
const nameMock = vi.fn();
const decimalsMock = vi.fn();
const tradingEnabledMock: ReturnType<typeof vi.fn> & { catch?: unknown } = vi.fn();

vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function () {
            return {
                symbol: symbolMock,
                name: nameMock,
                decimals: decimalsMock,
                tradingEnabled: tradingEnabledMock,
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
    symbolMock.mockReset();
    nameMock.mockReset();
    decimalsMock.mockReset();
    tradingEnabledMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();
    tokenSafetyModule = await import('../../../src/utils/tokenSafety');
});

describe('checkTokenMetadataForChain regression — never returns safe on edge cases', () => {
    it('returns unsafe (false) when the underlying ERC20 symbol() throws', async () => {
        // ERC20 symbol() RPC fails → Promise.all reject → catch → fail-closed false.
        symbolMock.mockRejectedValueOnce(new Error('eth_call reverted (no symbol fn)'));
        nameMock.mockResolvedValueOnce('Token');
        decimalsMock.mockResolvedValueOnce(18);
        tradingEnabledMock.mockResolvedValueOnce(true);
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.checkTokenMetadataForChain(ctx, MOCK_TOKEN);

        // Critical: must NOT return true on RPC error (vacuous "valid metadata" pass).
        expect(result).toBe(false);
    });

    it('returns unsafe (false) on malformed response (decimals() returns out-of-range value)', async () => {
        // Production line 379: `if (decimals < 6 || decimals > 18) return false`.
        // 99 is out of the safe range — returns false BEFORE the catch path.
        symbolMock.mockResolvedValueOnce('TKN');
        nameMock.mockResolvedValueOnce('Token');
        decimalsMock.mockResolvedValueOnce(99); // malformed / suspicious
        tradingEnabledMock.mockResolvedValueOnce(true);
        const ctx = makeMockCtx();

        const result = await tokenSafetyModule.checkTokenMetadataForChain(ctx, MOCK_TOKEN);

        expect(result).toBe(false);
    });

    it('exercises the underlying behavior — a structured warn log was emitted with check tag (D-04 observable effect)', async () => {
        // Force the catch path and verify the warn log fires.
        symbolMock.mockRejectedValueOnce(new Error('boom'));
        const ctx = makeMockCtx();

        await tokenSafetyModule.checkTokenMetadataForChain(ctx, MOCK_TOKEN);

        expect(loggerWarnMock).toHaveBeenCalledWith(
            expect.objectContaining({ check: 'metadata' }),
            expect.anything()
        );
    });
});
