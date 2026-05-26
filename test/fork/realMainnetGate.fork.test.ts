// test/fork/realMainnetGate.fork.test.ts
// Phase 21 plan 21-02 Task 1 — meta-test for the EXIT-LIVE-08 test-safety gate.
//
// Proves the per-test decorator `requireRealMainnetGate` and the centralized
// predicate `isHardhatFork` behave correctly at the trust boundary
// (D-GATE-BOTH-LAYERS layer b). The observable effect (D-04) is a thrown Error
// vs a resolved promise — asserted directly, no hollow expect(true).
//
// These cases use PROVIDER STUBS (no real network, no fork node calls): each
// stub reports a chosen chainId via a fake getNetwork(). process.env is
// restored after every case so the global ALLOW_REAL_MAINNET state is never
// leaked across tests. This file lives in the `fork` project (its globalSetup
// spins up the hardhat node for the other fork tests), but it does NOT itself
// connect to that node.

import { describe, it, expect, afterEach } from 'vitest';
import type { ethers } from 'ethers';
import { isHardhatFork, requireRealMainnetGate, FORK_ONLY_TEST_KEY } from './helpers/realMainnetGate';

// Minimal provider stub: only getNetwork() is exercised by the gate logic.
// Cast through unknown to the JsonRpcProvider shape the helpers accept.
function stubProvider(chainId: number): ethers.JsonRpcProvider {
    return {
        getNetwork: async () => ({ chainId: BigInt(chainId) }),
    } as unknown as ethers.JsonRpcProvider;
}

describe('Phase 21 plan 21-02 — EXIT-LIVE-08 real-mainnet gate (D-GATE-BOTH-LAYERS layer b)', () => {
    const originalAllow = process.env.ALLOW_REAL_MAINNET;

    afterEach(() => {
        // Restore the env var to its pre-test value (delete if it was unset).
        if (originalAllow === undefined) {
            delete process.env.ALLOW_REAL_MAINNET;
        } else {
            process.env.ALLOW_REAL_MAINNET = originalAllow;
        }
    });

    describe('requireRealMainnetGate (the per-test decorator)', () => {
        it('THROWS when chainId === 1 and ALLOW_REAL_MAINNET is unset', async () => {
            delete process.env.ALLOW_REAL_MAINNET;
            await expect(requireRealMainnetGate(stubProvider(1))).rejects.toThrow(
                /chainId 1 \(mainnet\) without ALLOW_REAL_MAINNET=1/,
            );
        });

        it('does NOT throw when chainId is 31337 (the local fork) — gate unset', async () => {
            delete process.env.ALLOW_REAL_MAINNET;
            await expect(requireRealMainnetGate(stubProvider(31337))).resolves.toBeUndefined();
        });

        it('does NOT throw when chainId === 1 but ALLOW_REAL_MAINNET === "1" (explicit opt-in)', async () => {
            process.env.ALLOW_REAL_MAINNET = '1';
            await expect(requireRealMainnetGate(stubProvider(1))).resolves.toBeUndefined();
        });

        it('STILL throws when chainId === 1 and ALLOW_REAL_MAINNET is set to a non-"1" value', async () => {
            // Only an exact '1' opts in; '0'/'true'/etc. must NOT bypass the guard.
            process.env.ALLOW_REAL_MAINNET = '0';
            await expect(requireRealMainnetGate(stubProvider(1))).rejects.toThrow(
                /ALLOW_REAL_MAINNET=1/,
            );
        });
    });

    describe('isHardhatFork (the centralized predicate)', () => {
        it('returns false for chainId 1 with the gate unset', async () => {
            delete process.env.ALLOW_REAL_MAINNET;
            await expect(isHardhatFork(stubProvider(1))).resolves.toBe(false);
        });

        it('returns true for chainId 31337 (local fork)', async () => {
            delete process.env.ALLOW_REAL_MAINNET;
            await expect(isHardhatFork(stubProvider(31337))).resolves.toBe(true);
        });

        it('returns true for chainId 1 when ALLOW_REAL_MAINNET === "1"', async () => {
            process.env.ALLOW_REAL_MAINNET = '1';
            await expect(isHardhatFork(stubProvider(1))).resolves.toBe(true);
        });
    });

    describe('FORK_ONLY_TEST_KEY (D-TEST-WALLET-FORKONLY)', () => {
        it('is the Hardhat default account #0 throwaway key (never the prod wallet)', () => {
            expect(FORK_ONLY_TEST_KEY).toBe(
                '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            );
        });
    });
});
