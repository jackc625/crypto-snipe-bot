// test/unit/tokenSafety.test.ts
// Unit tests for the 9-stage token safety validation pipeline (TEST-01).
// All API calls mocked via vi.mock -- zero network calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockProvider } from '../helpers/mockProvider';
import {
    MOCK_TOKEN_ADDRESS,
    MOCK_PAIR_ADDRESS,
    mockHoneypotResponse,
    mockHoneypotHoneypotResponse,
    mockUnicryptResponse,
} from '../fixtures/tokenSafety.fixtures';

// ---- Shared mock functions ----

const mockAxiosGet = vi.fn();

vi.mock('axios', () => ({
    default: { get: mockAxiosGet, post: vi.fn() },
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

vi.mock('../../src/config', () => ({
    CONFIG: {
        honeypotCheckURL: 'https://api.honeypot.is/v2/IsHoneypot?address=',
        routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        snipeAmountETH: '0.01',
        walletPrivateKey: '0x' + '1'.repeat(64),
        network: 'mainnet',
        stopLossPercent: 25,
    },
}));

const mockProviderInstance = createMockProvider();

vi.mock('../../src/utils/provider', () => ({
    getProvider: vi.fn(() => mockProviderInstance),
    getWsProvider: vi.fn(),
}));

vi.mock('../../src/utils/retry', () => ({
    retry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// Mock for Contract methods -- each test sets up per-instance returns
const mockStaticCallSwap = vi.fn();
const mockGetAmountsOut = vi.fn();
const mockBalanceOf = vi.fn();
const mockToken0 = vi.fn();
const mockToken1 = vi.fn();
const mockGetReserves = vi.fn();
const mockTotalSupply = vi.fn();
const mockSymbol = vi.fn();
const mockName = vi.fn();
const mockDecimals = vi.fn();
const mockTradingEnabled: ReturnType<typeof vi.fn> & { catch?: unknown } = vi.fn();
const mockSwapExactETHForTokens = vi.fn();
const mockApprove = vi.fn().mockResolvedValue(true);
const mockMaxWalletAmount = vi.fn().mockRejectedValue(new Error('not found'));
const mockMaxWallet = vi.fn().mockRejectedValue(new Error('not found'));
const mockMaxTxAmount = vi.fn().mockRejectedValue(new Error('not found'));
const mockMaxTransactionAmount = vi.fn().mockRejectedValue(new Error('not found'));

// Mock ethers module -- intercept Contract constructor
vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
            const instance: Record<string, unknown> = {
                // Router methods
                swapExactETHForTokens: Object.assign(mockSwapExactETHForTokens, {
                    staticCall: mockStaticCallSwap,
                }),
                swapExactTokensForETHSupportingFeeOnTransferTokens: {
                    staticCall: vi.fn(),
                },
                getAmountsOut: mockGetAmountsOut,
                // Pair methods
                token0: mockToken0,
                token1: mockToken1,
                getReserves: mockGetReserves,
                // ERC20 methods
                balanceOf: mockBalanceOf,
                totalSupply: mockTotalSupply,
                approve: mockApprove,
                symbol: mockSymbol,
                name: mockName,
                decimals: mockDecimals,
                tradingEnabled: mockTradingEnabled,
                // Limit methods
                maxWalletAmount: mockMaxWalletAmount,
                maxWallet: mockMaxWallet,
                maxTxAmount: mockMaxTxAmount,
                maxTransactionAmount: mockMaxTransactionAmount,
            };
            return instance;
        }),
        Wallet: vi.fn().mockImplementation(function () {
            return { address: '0xMockWallet' };
        }),
    };
});

// Dynamic import after mocks -- avoids side effects from module-level code
let tokenSafetyModule: typeof import('../../src/utils/tokenSafety');

beforeEach(async () => {
    // Reset individual mock call histories / return values
    mockAxiosGet.mockReset();
    mockStaticCallSwap.mockReset();
    mockGetAmountsOut.mockReset();
    mockSwapExactETHForTokens.mockReset();
    // Re-attach staticCall after reset (Object.assign is lost on mockReset)
    (mockSwapExactETHForTokens as Record<string, unknown>).staticCall = mockStaticCallSwap;
    mockBalanceOf.mockReset();
    mockToken0.mockReset();
    mockToken1.mockReset();
    mockGetReserves.mockReset();
    mockTotalSupply.mockReset();
    mockSymbol.mockReset();
    mockName.mockReset();
    mockDecimals.mockReset();
    mockTradingEnabled.mockReset();
    mockApprove.mockReset().mockResolvedValue(true);
    mockMaxWalletAmount.mockReset().mockRejectedValue(new Error('not found'));
    mockMaxWallet.mockReset().mockRejectedValue(new Error('not found'));
    mockMaxTxAmount.mockReset().mockRejectedValue(new Error('not found'));
    mockMaxTransactionAmount.mockReset().mockRejectedValue(new Error('not found'));
    mockProviderInstance.getCode = vi.fn().mockResolvedValue('0x6080604052');

    // Re-register Contract mock implementation (mockReset: true in config clears it)
    const { Contract, Wallet } = await import('ethers') as Record<string, ReturnType<typeof vi.fn>>;
    Contract.mockImplementation(function () {
        return {
            swapExactETHForTokens: Object.assign(mockSwapExactETHForTokens, {
                staticCall: mockStaticCallSwap,
            }),
            swapExactTokensForETHSupportingFeeOnTransferTokens: {
                staticCall: vi.fn(),
            },
            getAmountsOut: mockGetAmountsOut,
            token0: mockToken0,
            token1: mockToken1,
            getReserves: mockGetReserves,
            balanceOf: mockBalanceOf,
            totalSupply: mockTotalSupply,
            approve: mockApprove,
            symbol: mockSymbol,
            name: mockName,
            decimals: mockDecimals,
            tradingEnabled: mockTradingEnabled,
            maxWalletAmount: mockMaxWalletAmount,
            maxWallet: mockMaxWallet,
            maxTxAmount: mockMaxTxAmount,
            maxTransactionAmount: mockMaxTransactionAmount,
        };
    });
    Wallet.mockImplementation(function () {
        return { address: '0xMockWallet' };
    });

    // Re-register getProvider mock
    const providerMod = await import('../../src/utils/provider') as Record<string, ReturnType<typeof vi.fn>>;
    providerMod.getProvider.mockReturnValue(mockProviderInstance);

    tokenSafetyModule = await import('../../src/utils/tokenSafety');
});

// ============================================================
// 1. checkHoneypot (3 tests + 1 extra)
// ============================================================
describe('checkHoneypot', () => {
    it('returns false (safe) when API says token is not a honeypot', async () => {
        mockAxiosGet.mockResolvedValueOnce({ data: mockHoneypotResponse() });
        const result = await tokenSafetyModule.checkHoneypot(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(false);
    });

    it('returns true (honeypot) when API says token is a honeypot', async () => {
        mockAxiosGet.mockResolvedValueOnce({ data: mockHoneypotHoneypotResponse() });
        const result = await tokenSafetyModule.checkHoneypot(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(true);
    });

    it('falls back to staticCall when API fails and returns false on success', async () => {
        mockAxiosGet.mockRejectedValueOnce(new Error('API timeout'));
        mockStaticCallSwap.mockResolvedValueOnce([0n, 1000n]);
        const result = await tokenSafetyModule.checkHoneypot(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(false);
    });

    it('falls back to staticCall when API fails and returns true on revert', async () => {
        mockAxiosGet.mockRejectedValueOnce(new Error('API timeout'));
        mockStaticCallSwap.mockRejectedValueOnce(new Error('execution reverted'));
        const result = await tokenSafetyModule.checkHoneypot(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(true);
    });
});

// ============================================================
// 2. isBlacklistedToken (2 tests)
// ============================================================
describe('isBlacklistedToken', () => {
    it('returns false for a token without anti-bot selectors', async () => {
        mockProviderInstance.getCode = vi.fn().mockResolvedValue('0x6080604052600436106100');
        const result = await tokenSafetyModule.isBlacklistedToken(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(false);
    });

    it('returns true for a token with anti-bot selectors in bytecode', async () => {
        // Include the full 0xdd62ed3e selector string in the bytecode
        mockProviderInstance.getCode = vi.fn().mockResolvedValue('0x608060405260043610610000630xdd62ed3e00');
        const result = await tokenSafetyModule.isBlacklistedToken(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(true);
    });
});

// ============================================================
// 3. isLiquidityLocked (3 tests)
// ============================================================
describe('isLiquidityLocked', () => {
    it('returns false when Unicrypt API returns empty locks array', async () => {
        mockAxiosGet.mockResolvedValueOnce({ data: { locks: [] } });
        const result = await tokenSafetyModule.isLiquidityLocked(MOCK_PAIR_ADDRESS);
        expect(result).toBe(false);
    });

    it('returns true when Unicrypt returns locks with future unlock dates', async () => {
        mockAxiosGet.mockResolvedValueOnce({ data: mockUnicryptResponse() });
        const result = await tokenSafetyModule.isLiquidityLocked(MOCK_PAIR_ADDRESS);
        expect(result).toBe(true);
    });

    it('falls back to burn check when Unicrypt API fails', async () => {
        mockAxiosGet.mockRejectedValueOnce(new Error('API timeout'));
        // Burn check: balanceOf(dead) / totalSupply > 0.9
        mockBalanceOf.mockResolvedValueOnce(950000n);
        mockTotalSupply.mockResolvedValueOnce(1000000n);
        const result = await tokenSafetyModule.isLiquidityLocked(MOCK_PAIR_ADDRESS);
        expect(result).toBe(true);
    });
});

// ============================================================
// 4. checkTokenMetadata (2 tests)
// ============================================================
describe('checkTokenMetadata', () => {
    it('returns true (safe) when token has valid metadata', async () => {
        mockSymbol.mockResolvedValueOnce('TEST');
        mockName.mockResolvedValueOnce('Test Token');
        mockDecimals.mockResolvedValueOnce(18);
        // tradingEnabled?.() -- mock as a function that returns a resolved promise
        mockTradingEnabled.mockResolvedValueOnce(true);
        const result = await tokenSafetyModule.checkTokenMetadata(MOCK_TOKEN_ADDRESS, mockProviderInstance as never);
        expect(result).toBe(true);
    });

    it('returns false (unsafe) when token symbol is too short', async () => {
        mockSymbol.mockResolvedValueOnce('T');
        mockName.mockResolvedValueOnce('Test Token');
        mockDecimals.mockResolvedValueOnce(18);
        mockTradingEnabled.mockResolvedValueOnce(true);
        const result = await tokenSafetyModule.checkTokenMetadata(MOCK_TOKEN_ADDRESS, mockProviderInstance as never);
        expect(result).toBe(false);
    });
});

// ============================================================
// 5. simulateSwap (2 tests)
// ============================================================
describe('simulateSwap', () => {
    it('returns true when staticCall to swapExactETHForTokens succeeds', async () => {
        mockStaticCallSwap.mockResolvedValueOnce([0n, 1000n]);
        const result = await tokenSafetyModule.simulateSwap(MOCK_TOKEN_ADDRESS, mockProviderInstance as never, '0xwallet');
        expect(result).toBe(true);
    });

    it('returns false when staticCall reverts', async () => {
        mockStaticCallSwap.mockRejectedValueOnce(new Error('execution reverted'));
        const result = await tokenSafetyModule.simulateSwap(MOCK_TOKEN_ADDRESS, mockProviderInstance as never, '0xwallet');
        expect(result).toBe(false);
    });
});

// ============================================================
// 6. isLiquiditySufficient (2 tests)
// ============================================================
describe('isLiquiditySufficient', () => {
    it('returns true when WETH reserves exceed 1 ETH threshold', async () => {
        mockToken0.mockResolvedValueOnce('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
        mockToken1.mockResolvedValueOnce(MOCK_TOKEN_ADDRESS);
        mockGetReserves.mockResolvedValueOnce({
            reserve0: 2000000000000000000n, // 2 ETH
            reserve1: 1000000000000000000000n,
        });
        const result = await tokenSafetyModule.isLiquiditySufficient(MOCK_PAIR_ADDRESS);
        expect(result).toBe(true);
    });

    it('returns false when WETH reserves below 1 ETH threshold', async () => {
        mockToken0.mockResolvedValueOnce('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
        mockToken1.mockResolvedValueOnce(MOCK_TOKEN_ADDRESS);
        mockGetReserves.mockResolvedValueOnce({
            reserve0: 500000000000000000n, // 0.5 ETH
            reserve1: 1000000000000000000000n,
        });
        const result = await tokenSafetyModule.isLiquiditySufficient(MOCK_PAIR_ADDRESS);
        expect(result).toBe(false);
    });
});

// ============================================================
// 7. isKnownBadToken (2 tests)
// ============================================================
describe('isKnownBadToken', () => {
    it('returns false for a valid token contract not in blocklist', async () => {
        mockProviderInstance.getCode = vi.fn().mockResolvedValue('0x6080604052');
        const result = await tokenSafetyModule.isKnownBadToken(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(false);
    });

    it('returns true when no contract code found at address', async () => {
        mockProviderInstance.getCode = vi.fn().mockResolvedValue('0x');
        const result = await tokenSafetyModule.isKnownBadToken(MOCK_TOKEN_ADDRESS);
        expect(result).toBe(true);
    });
});

// ============================================================
// 8. hasHighTransferTax — DELETED (Phase 21.1 review-fix, WR-01)
// ------------------------------------------------------------
// The function was deleted from src/utils/tokenSafety.ts: it was a
// signer-connected swapExactETHForTokens(0n, …, {value}) WITHOUT .staticCall (a
// real on-chain buy inside a "safety check") with broken NaN tax math, and had
// ZERO live callers. These 2 tests, which exercised the deleted function
// directly, are removed with it (D-DELETE-LEGACY — no re-introduction hazard).
// Deletion is asserted in inclusionReconciliation.test.ts (the tokenSafety module
// no longer exports the *ForChain twin) and re-verified by the WR-01 zero-caller
// grep in the review-fix SUMMARY.
// ============================================================

// ============================================================
// 9. hasMaxWalletOrTxLimits (2 tests)
// ============================================================
describe('hasMaxWalletOrTxLimits', () => {
    it('returns false when no limit functions are found on token', async () => {
        mockTotalSupply.mockResolvedValueOnce(1000000n);
        // All limit methods throw (default mock behavior) -- no limits found
        const result = await tokenSafetyModule.hasMaxWalletOrTxLimits(MOCK_TOKEN_ADDRESS, mockProviderInstance as never, '0xwallet');
        expect(result).toBe(false);
    });

    it('returns true when totalSupply call fails (safest fallback)', async () => {
        mockTotalSupply.mockRejectedValueOnce(new Error('call failed'));
        const result = await tokenSafetyModule.hasMaxWalletOrTxLimits(MOCK_TOKEN_ADDRESS, mockProviderInstance as never, '0xwallet');
        expect(result).toBe(true);
    });
});
