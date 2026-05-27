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
            // Phase 21.1: the passthrough wrapper now reads the balance for the
            // affordability bound (D-FEE-ESCALATION) and runs provider.call(...) as
            // simulate-before-submit (D-SIMULATE-BEFORE-SUBMIT). 10 ETH keeps the tx
            // affordable; call resolves (no revert) so the submit is reached.
            getBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000_000n), // 10 ETH
            call: vi.fn().mockResolvedValue('0x'),
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

    // Phase 21.1 NOTE: the passthrough strategy now routes through
    // submitWithReconciliation, whose D-FEE-ESCALATION supplies a per-attempt
    // priority fee with a 1-gwei floor (MEV_PRIORITY_FEE_STEP_GWEI default). The
    // strategy bids max(multiplier-scaled chain priority, helper escalation) and
    // raises maxFeePerGas to cover baseFee + that bid. These tests use realistic
    // GWEI-scale fees so the multiplier-scaled chain priority dominates the floor,
    // proving the Phase 19 gasMultiplier STILL reaches the populated priority fee.
    it("Test 7: gasMultiplier=2.0 doubles maxFeePerGas + maxPriorityFeePerGas on EIP-1559 chain", async () => {
        // chain: maxFee 50 gwei, priority 3 gwei → baseFee = 47 gwei.
        const provider = makeProvider({ maxFeePerGas: 50_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n });
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
        // priority = max(3gwei×2, 1gwei floor) = 6 gwei; the multiplier reached it.
        expect(capturedTx.maxPriorityFeePerGas).toBe(6_000_000_000n);
        // maxFee cap = max(50gwei×2=100gwei, baseFee 47gwei + 6gwei = 53gwei) = 100 gwei.
        expect(capturedTx.maxFeePerGas).toBe(100_000_000_000n);
        // Invariant: priority never exceeds the cap (valid EIP-1559 tx).
        expect((capturedTx.maxPriorityFeePerGas as bigint) <= (capturedTx.maxFeePerGas as bigint)).toBe(true);
    });

    it("Test 8: gasMultiplier=undefined preserves raw chain priority when it exceeds the escalation floor", async () => {
        // chain: maxFee 50 gwei, priority 3 gwei → baseFee = 47 gwei.
        const provider = makeProvider({ maxFeePerGas: 50_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n });
        const wallet = makeWallet();
        const strategy = new PassthroughMevStrategy('base');
        await strategy.sendTransaction(
            { to: '0xRouter000000000000000000000000000000R01', data: '0x', gasLimit: 200_000n },
            wallet,
            provider,
            0,
            // gasMultiplier omitted — no elevation, raw chain priority used.
        );
        const capturedTx = (wallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as TransactionRequest;
        // priority = max(3 gwei chain, 1 gwei floor) = 3 gwei (raw, unelevated).
        expect(capturedTx.maxPriorityFeePerGas).toBe(3_000_000_000n);
        // maxFee cap = max(50 gwei chain, baseFee 47gwei + 3gwei = 50gwei) = 50 gwei.
        expect(capturedTx.maxFeePerGas).toBe(50_000_000_000n);
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
        // Legacy path is unchanged by D-FEE-ESCALATION (BSC/legacy escalate gasPrice
        // separately in bloXroute; passthrough legacy keeps the multiplier-only bid).
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
            // Phase 21.1: bloXroute now reads the balance (affordability bound) and
            // runs provider.call(...) as simulate-before-submit. 10 ETH keeps the tx
            // affordable; call resolves (no revert) so the relay POST is reached.
            getBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000_000n), // 10 ETH
            call: vi.fn().mockResolvedValue('0x'),
            // bloXroute always reconciles against chain state (relay ACK is not
            // inclusion proof); a status-1 receipt makes the reconcile return at once.
            getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1, blockNumber: 999 }),
        } as unknown as JsonRpcProvider;
    }

    function makeWallet(): { wallet: Wallet; capturedSigned: { value?: TransactionRequest } } {
        const captured: { value?: TransactionRequest } = {};
        const wallet = {
            address: '0xWallet000000000000000000000000000000W02',
            signTransaction: vi.fn().mockImplementation(async (tx: TransactionRequest) => {
                captured.value = tx;
                // Phase 21.1: must be VALID hex — bloXroute computes the tx hash via
                // keccak256(signedRaw) for chain-state reconciliation.
                return '0xdeadbeefcafe';
            }),
        } as unknown as Wallet;
        return { wallet, capturedSigned: captured };
    }

    it("Test 10: gasMultiplier=2.0 doubles gasPrice on BSC bloxroute path", async () => {
        // Phase 21.1 NOTE: bloXroute now bids max(multiplier-scaled chain gasPrice,
        // baseFee + helper escalation). With a realistic GWEI-scale gasPrice the
        // multiplier-scaled value dominates the 1-gwei escalation floor, proving the
        // Phase 19 gasMultiplier STILL reaches the populated gasPrice.
        const axios = await import('axios');
        const postSpy = vi.spyOn(axios.default, 'post').mockResolvedValue({ data: { result: '0xTxHashBSC' } });

        // chain gasPrice = 50 gwei → ×2 = 100 gwei (dominates baseFee 50gwei + 1gwei step).
        const provider = makeProvider(50_000_000_000n);
        const { wallet, capturedSigned } = makeWallet();
        const strategy = new BloxrouteMevStrategy({ authHeader: 'test-header' });
        await strategy.sendTransaction(
            { to: '0xRouter000000000000000000000000000000R01', data: '0x', gasLimit: 200_000n },
            wallet,
            provider,
            0,
            2.0,
        );
        expect(capturedSigned.value?.gasPrice).toBe(100_000_000_000n);
        postSpy.mockRestore();
    });
});
