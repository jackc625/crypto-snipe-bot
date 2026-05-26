// test/fork/helpers/realMainnetGate.ts
// Phase 21 plan 21-02 Task 1 — EXIT-LIVE-08 test-safety gate (D-GATE-BOTH-LAYERS layer b).
//
// Centralizes the chainId===1 / ALLOW_REAL_MAINNET=1 guard that previously
// lived inline in honeypotChecker.fork.test.ts:57-63 (`isHardhatFork`). This is
// PURE test infrastructure (D-ROLLBACK): there is no production-code change and
// no bypass beyond the explicit ALLOW_REAL_MAINNET=1 opt-in.
//
// Two layers enforce the guard (D-GATE-BOTH-LAYERS):
//   (a) a GLOBAL tripwire in test/fork/setup.ts that aborts the whole fork run
//       if the spawned node reports chainId 1 without ALLOW_REAL_MAINNET=1
//       (protects every test, including future ones that forget to opt in); and
//   (b) the per-test decorator `requireRealMainnetGate()` exported here, an
//       explicit intent marker any deliberate real-mainnet test must call.
//
// The local `hardhat node --fork` reports chainId 31337 (NOT 1) even when
// forking mainnet, so both layers pass naturally in CI; the guard only fires
// against a misconfigured real-mainnet RPC. CI NEVER sets ALLOW_REAL_MAINNET.

import { ethers } from 'ethers';

/**
 * Hardhat default account #0 — preloaded with 10000 ETH on a local fork.
 *
 * D-TEST-WALLET-FORKONLY: this is a throwaway, fork-ONLY signing key with zero
 * real ETH. Fork tests sign with THIS key only.
 *
 * The production wallet key `process.env.PRIVATE_KEY` (loaded at
 * src/utils/provider.ts:59 and src/chainRegistry.ts:1067) must NEVER be
 * imported into any test — doing so would put the funded prod wallet at risk
 * of an accidental real-mainnet transaction. This constant exists precisely so
 * tests never reach for the prod key.
 */
export const FORK_ONLY_TEST_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/**
 * The centralized fork predicate (D-GATE-BOTH-LAYERS).
 *
 * Copied verbatim from honeypotChecker.fork.test.ts:57-63 so there is a single
 * source of truth for the gate logic.
 *
 * Resolves `true` when it is safe to transact — i.e. the connected provider is
 * NOT real mainnet (chainId !== 1), OR the operator has explicitly opted in via
 * ALLOW_REAL_MAINNET=1. Resolves `false` when the provider reports chainId 1 and
 * the gate is unset.
 */
export function isHardhatFork(provider: ethers.JsonRpcProvider): Promise<boolean> {
    return provider.getNetwork().then((n) => {
        // hardhat node default chainId is 31337; mainnet is 1.
        // Per Pitfall F: only allow chainId !== 1 OR ALLOW_REAL_MAINNET=1.
        return Number(n.chainId) !== 1 || process.env.ALLOW_REAL_MAINNET === '1';
    });
}

/**
 * Per-test decorator (D-GATE-BOTH-LAYERS layer b).
 *
 * Reads the connected provider's chainId. If it reports chainId 1 (real
 * mainnet) AND ALLOW_REAL_MAINNET is not exactly '1', throws loudly to abort
 * the test before any transaction is built. Otherwise resolves (the local
 * 31337 fork passes naturally, and an explicit ALLOW_REAL_MAINNET=1 opt-in is
 * honored).
 *
 * The observable effect (D-04) is the thrown Error vs the resolved promise.
 */
export async function requireRealMainnetGate(provider: ethers.JsonRpcProvider): Promise<void> {
    const network = await provider.getNetwork();
    if (Number(network.chainId) === 1 && process.env.ALLOW_REAL_MAINNET !== '1') {
        throw new Error(
            'Refusing to run against chainId 1 (mainnet) without ALLOW_REAL_MAINNET=1 — ' +
                'this guard protects the prod wallet from accidental transactions',
        );
    }
}
