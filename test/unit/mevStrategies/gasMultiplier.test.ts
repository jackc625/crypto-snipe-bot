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

    // Phase 21.1 NOTE: the passthrough strategy routes through
    // submitWithReconciliation, whose D-FEE-ESCALATION supplies a per-attempt
    // priority fee with a 1-gwei floor (MEV_PRIORITY_FEE_STEP_GWEI default).
    // CR-01 fix (review-fix): the multiplier-scaled chain priority is folded in as
    // the competitive FLOOR of the DESIRED fee BEFORE the affordability/ceiling
    // clamp, and the strategy uses the CLAMPED a.priorityFeeWei DIRECTLY (no second
    // max() against the unclamped chain rate). The clamp — min(MEV_MAX_PRIORITY_FEE_GWEI
    // ceiling=5 gwei default, affordabilityBound) — is therefore the FINAL authority
    // on the submitted fee, and maxFeePerGas = baseFee + that clamped priority.
    // These tests prove the Phase 19 gasMultiplier still ELEVATES the bid (toward
    // the cap) while NEVER exceeding the load-bearing ceiling.
    it("Test 7: gasMultiplier=2.0 elevates the bid toward — but never past — the 5-gwei ceiling on EIP-1559 chain", async () => {
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
        // desired = max(3gwei×2 = 6gwei multiplier floor, 1gwei step) = 6 gwei, then
        // CLAMPED to min(5gwei ceiling, huge bound) = 5 gwei. The multiplier elevated
        // the bid above the 3-gwei chain rate, but the ceiling is the final authority
        // (CR-01: pre-fix this was 6 gwei — the ceiling was bypassed).
        expect(capturedTx.maxPriorityFeePerGas).toBe(5_000_000_000n);
        // maxFee = baseFee 47gwei + clamped priority 5gwei = 52 gwei (consistent with
        // the affordability reserve model; CR-01/WR-03 — pre-fix this was 100 gwei).
        expect(capturedTx.maxFeePerGas).toBe(52_000_000_000n);
        // Invariant: priority never exceeds the cap (valid EIP-1559 tx).
        expect((capturedTx.maxPriorityFeePerGas as bigint) <= (capturedTx.maxFeePerGas as bigint)).toBe(true);
        // Load-bearing CR-01 assertion: the submitted priority never exceeds the
        // 5-gwei ceiling even though the multiplier-scaled chain rate (6 gwei) did.
        expect((capturedTx.maxPriorityFeePerGas as bigint) <= 5_000_000_000n).toBe(true);
    });

    it("Test 8: gasMultiplier=undefined uses the raw chain priority when it is below the ceiling", async () => {
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
        // desired = max(3gwei chain floor, 1gwei step) = 3 gwei; CLAMP = min(5gwei, huge)
        // = 3 gwei (below the ceiling, so the chain rate passes through unchanged).
        expect(capturedTx.maxPriorityFeePerGas).toBe(3_000_000_000n);
        // maxFee = baseFee 47gwei + 3gwei = 50 gwei.
        expect(capturedTx.maxFeePerGas).toBe(50_000_000_000n);
    });

    it("Test 9: gasMultiplier=2.0 on the legacy fallback bids baseFee + the ceiling-clamped priority (never the unclamped 2x rate)", async () => {
        // Legacy fallback (no EIP-1559 field). Realistic GWEI-scale chain gasPrice so
        // the multiplier-scaled floor is meaningful (the old 50-WEI fixture made the
        // 1-gwei escalation floor dominate, masking the clamp). chain gasPrice 4 gwei
        // → ×2 = 8 gwei; legacy competitive floor = scaledGasPrice - baseFee =
        // 8 - 4 = 4 gwei. desired = max(4gwei floor, 1gwei step) = 4 gwei; CLAMP =
        // min(5gwei ceiling, huge) = 4 gwei (below ceiling). gasPrice = baseFee 4gwei
        // + clamped priority 4gwei = 8 gwei. The multiplier reached the bid, bounded
        // by the affordability/ceiling clamp (CR-01: clamp-is-final on legacy too).
        const provider = makeProvider({ gasPrice: 4_000_000_000n });
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
        expect(capturedTx.gasPrice).toBe(8_000_000_000n);
    });

    it("Test 9b (CR-01): legacy fallback CLAMPS the bid to the ceiling when the 2x chain rate exceeds it", async () => {
        // chain gasPrice 50 gwei → ×2 = 100 gwei; legacy floor = 100 - 50 = 50 gwei.
        // desired = max(50gwei floor, 1gwei step) = 50 gwei; CLAMP = min(5gwei ceiling,
        // huge bound) = 5 gwei. gasPrice = baseFee 50gwei + clamped 5gwei = 55 gwei.
        // CR-01: pre-fix the legacy path bid max(100gwei, ...) = 100 gwei — the 5-gwei
        // ceiling was bypassed on the buy path. The clamp is now the final authority.
        const provider = makeProvider({ gasPrice: 50_000_000_000n });
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
        // baseFee (50 gwei) + ceiling-clamped priority (5 gwei) = 55 gwei, NOT 100 gwei.
        expect(capturedTx.gasPrice).toBe(55_000_000_000n);
        // The priority component never exceeds the 5-gwei ceiling.
        expect((capturedTx.gasPrice as bigint) - 50_000_000_000n <= 5_000_000_000n).toBe(true);
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

    it("Test 10: gasMultiplier=2.0 elevates BSC gasPrice toward the bid but CLAMPS to the 5-gwei ceiling (CR-01)", async () => {
        // Phase 21.1 + CR-01 review-fix: bloXroute folds the multiplier-scaled chain
        // gasPrice in as the competitive FLOOR (chainPriorityWei = scaledGasPrice -
        // baseFee) BEFORE the affordability/ceiling clamp, then bids gasPrice =
        // baseFee + the CLAMPED priority DIRECTLY (no second max() against the
        // unclamped 2x rate — that was the CR-01 bypass on the legacy path).
        const axios = await import('axios');
        const postSpy = vi.spyOn(axios.default, 'post').mockResolvedValue({ data: { result: '0xTxHashBSC' } });

        // chain gasPrice = 50 gwei → ×2 = 100 gwei; legacy floor = 100 - 50 = 50 gwei.
        // desired = max(50gwei floor, 1gwei step) = 50 gwei; CLAMP = min(5gwei ceiling,
        // huge bound) = 5 gwei. gasPrice = baseFee 50gwei + clamped 5gwei = 55 gwei.
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
        // baseFee (50 gwei) + ceiling-clamped priority (5 gwei) = 55 gwei.
        // CR-01: pre-fix this asserted 100_000_000_000n — the ceiling was bypassed.
        expect(capturedSigned.value?.gasPrice).toBe(55_000_000_000n);
        // The priority component above base never exceeds the 5-gwei ceiling.
        expect((capturedSigned.value?.gasPrice as bigint) - 50_000_000_000n <= 5_000_000_000n).toBe(true);
        postSpy.mockRestore();
    });
});
