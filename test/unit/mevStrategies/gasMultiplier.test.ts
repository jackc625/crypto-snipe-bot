// test/unit/mevStrategies/gasMultiplier.test.ts
// Phase 19 Gap-1 closure (2026-05-24): proves the gasMultiplier arg added to
// MevStrategy.sendTransaction actually reaches the populated TransactionRequest
// before submission. The pre-Gap-1 code discarded the multiplier via `void
// gasMultiplier;` in src/exitEngine.ts; this test guards against regression.
import { describe, it, expect, vi } from 'vitest';
import type { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import { applyGasMultiplier } from '../../../src/utils/mevStrategies/types';
import { PassthroughMevStrategy } from '../../../src/utils/mevStrategies/passthrough';
import { BloxrouteMevStrategy } from '../../../src/utils/mevStrategies/bloxroute';

// -----------------------------------------------------------------------------
// applyGasMultiplier helper — pure unit tests
// -----------------------------------------------------------------------------

describe('Phase 19 Gap-1 closure — applyGasMultiplier helper', () => {
    it('Test 1: undefined multiplier returns fee unchanged (default — no elevation)', () => {
        expect(applyGasMultiplier(100n, undefined)).toBe(100n);
        expect(applyGasMultiplier(0n, undefined)).toBe(0n);
    });

    it('Test 2: multiplier=1 returns fee unchanged (no-op for non-anti-rug reasons)', () => {
        expect(applyGasMultiplier(100n, 1)).toBe(100n);
        expect(applyGasMultiplier(1n, 1)).toBe(1n);
    });

    it('Test 3: multiplier=2.0 doubles fee (anti-rug exit default for all chains)', () => {
        expect(applyGasMultiplier(100n, 2.0)).toBe(200n);
        expect(applyGasMultiplier(1_000_000_000n, 2.0)).toBe(2_000_000_000n);
    });

    it('Test 4: fractional multipliers honored via *100/100n bigint math (no FP drift)', () => {
        expect(applyGasMultiplier(100n, 1.5)).toBe(150n);
        expect(applyGasMultiplier(200n, 1.25)).toBe(250n);
        // 1.1 * 100 = 110 in fp64 (no drift at 2 decimals)
        expect(applyGasMultiplier(1000n, 1.1)).toBe(1100n);
    });

    it('Test 5: null fee passes through (no maxFeePerGas available on legacy-only chain)', () => {
        expect(applyGasMultiplier(null, 2.0)).toBe(null);
        expect(applyGasMultiplier(null, undefined)).toBe(null);
    });

    it('Test 6: undefined fee passes through', () => {
        expect(applyGasMultiplier(undefined, 2.0)).toBe(undefined);
    });
});

// -----------------------------------------------------------------------------
// PassthroughMevStrategy — multiplier reaches populated tx
// -----------------------------------------------------------------------------

describe('Phase 19 Gap-1 closure — PassthroughMevStrategy applies gasMultiplier', () => {
    function makeProvider(feeData: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }): JsonRpcProvider {
        return {
            getTransactionCount: vi.fn().mockResolvedValue(42),
            getFeeData: vi.fn().mockResolvedValue(feeData),
            getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n }),
        } as unknown as JsonRpcProvider;
    }

    function makeWallet(): Wallet {
        return {
            address: '0xWallet000000000000000000000000000000W01',
            sendTransaction: vi.fn().mockImplementation(async (tx: TransactionRequest) => {
                return {
                    hash: '0xTxHash00',
                    wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 999 }),
                    _capturedTx: tx,
                };
            }),
        } as unknown as Wallet;
    }

    it("Test 7: gasMultiplier=2.0 doubles maxFeePerGas + maxPriorityFeePerGas on EIP-1559 chain", async () => {
        const provider = makeProvider({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
        const wallet = makeWallet();
        const strategy = new PassthroughMevStrategy('base');
        await strategy.sendTransaction(
            { to: '0xRouter000000000000000000000000000000R01', data: '0x', gasLimit: 200_000n },
            wallet,
            provider,
            0,
            2.0,
        );
        const capturedTx = (wallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as TransactionRequest;
        expect(capturedTx.maxFeePerGas).toBe(200n);
        expect(capturedTx.maxPriorityFeePerGas).toBe(20n);
    });

    it("Test 8: gasMultiplier=undefined preserves raw maxFeePerGas (prior behavior — no elevation)", async () => {
        const provider = makeProvider({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
        const wallet = makeWallet();
        const strategy = new PassthroughMevStrategy('base');
        await strategy.sendTransaction(
            { to: '0xRouter000000000000000000000000000000R01', data: '0x', gasLimit: 200_000n },
            wallet,
            provider,
            0,
            // gasMultiplier omitted — default behavior
        );
        const capturedTx = (wallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as TransactionRequest;
        expect(capturedTx.maxFeePerGas).toBe(100n);
        expect(capturedTx.maxPriorityFeePerGas).toBe(10n);
    });

    it("Test 9: gasMultiplier=2.0 doubles legacy gasPrice when maxFeePerGas unavailable", async () => {
        const provider = makeProvider({ gasPrice: 50n });
        const wallet = makeWallet();
        const strategy = new PassthroughMevStrategy('base');
        await strategy.sendTransaction(
            { to: '0xRouter000000000000000000000000000000R01', data: '0x', gasLimit: 200_000n },
            wallet,
            provider,
            0,
            2.0,
        );
        const capturedTx = (wallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as TransactionRequest;
        expect(capturedTx.gasPrice).toBe(100n);
    });
});

// -----------------------------------------------------------------------------
// BloxrouteMevStrategy — multiplier reaches populated tx (BSC anti-rug path)
// -----------------------------------------------------------------------------

describe('Phase 19 Gap-1 closure — BloxrouteMevStrategy applies gasMultiplier', () => {
    function makeProvider(gasPrice: bigint): JsonRpcProvider {
        return {
            getTransactionCount: vi.fn().mockResolvedValue(7),
            getFeeData: vi.fn().mockResolvedValue({ gasPrice }),
        } as unknown as JsonRpcProvider;
    }

    function makeWallet(): { wallet: Wallet; capturedSigned: { value?: TransactionRequest } } {
        const captured: { value?: TransactionRequest } = {};
        const wallet = {
            address: '0xWallet000000000000000000000000000000W02',
            signTransaction: vi.fn().mockImplementation(async (tx: TransactionRequest) => {
                captured.value = tx;
                return '0xSignedBytes';
            }),
        } as unknown as Wallet;
        return { wallet, capturedSigned: captured };
    }

    it("Test 10: gasMultiplier=2.0 doubles gasPrice on BSC bloxroute path", async () => {
        // Mock axios.post to return a tx hash without making a real network call.
        const axios = await import('axios');
        const postSpy = vi.spyOn(axios.default, 'post').mockResolvedValue({ data: { result: '0xTxHashBSC' } });

        const provider = makeProvider(80n);
        const { wallet, capturedSigned } = makeWallet();
        const strategy = new BloxrouteMevStrategy({ authHeader: 'test-header' });
        await strategy.sendTransaction(
            { to: '0xRouter000000000000000000000000000000R01', data: '0x', gasLimit: 200_000n },
            wallet,
            provider,
            0,
            2.0,
        );
        expect(capturedSigned.value?.gasPrice).toBe(160n);
        postSpy.mockRestore();
    });
});
