// src/utils/nonceAuthority.ts
//
// Per-wallet nonce-serialization authority (D-NONCE-AUTHORITY-ALL, Phase 21.2
// Finding C). The spine that eliminates the nonce-collision / double-spend class
// bot-wide.
//
// ── Why a per-wallet promise-chain mutex ──────────────────────────────────────
// JavaScript is single-threaded, but signing is async: two `await`ed submit
// paths for the SAME wallet can interleave at their await points and both end up
// asking the RPC for `getTransactionCount('latest')`, get the same value, and
// sign two txs against one nonce — a double-spend / nonce collision. The check-
// and-set on the module-level Map below is synchronous and atomic within a
// single event-loop tick (same atomicity reasoning as the sell-lock Map in
// `exitManager.ts`), so reading the prior tail and storing the new one cannot
// interleave. The result is that every signing op for one wallet runs strictly
// after the previous one settles — serial by construction, so no two ever
// contend for a nonce.
//
// ── COMPOSES WITH the re-fetch-'latest'-per-attempt scheme (D-NONCE-SAFE-RETRY)
// This mutex does NOT compute or cache nonces. The op passed in still re-fetches
// `provider.getTransactionCount(wallet.address, 'latest')` per attempt exactly as
// `reconciliation.ts:369-371` does. The mutex only guarantees those re-fetches
// never run concurrently for one wallet. It is additive to 21.1's scheme, not a
// replacement.
//
// ── DO NOT use ethers `NonceManager` ─────────────────────────────────────────
// `NonceManager` optimistically predicts/caches nonces locally; that is the
// OPPOSITE discipline to D-NONCE-SAFE-RETRY (which deliberately re-fetches
// 'latest' and stops on advance). `NonceManager` would fight the re-fetch scheme
// and reintroduce the very collisions this module prevents. It is intentionally
// absent here.
//
// Keying mirrors the rest of the codebase: `wallet.address.toLowerCase()`
// (lowercase so checksummed / non-checksummed / mixed-case addresses for the
// same wallet share one chain — see exitManager.ts:19-21, detector.ts registry).
//
// This is a pure primitive with no consumers yet. Later plans wrap every signing
// site in it: 21.2-05 (exit worker), 21.2-06 (inclusion ladder), 21.2-07
// (anti-rug sell), 21.2-08 (buy entry path).
import { EPOCH } from '../guards/epoch';
import { registerSingleton } from '../guards/singleton';

// One promise-chain tail per wallet address (lowercased). The stored tail NEVER
// rejects (see below) so a single failed op cannot poison the wallet's chain.
registerSingleton('nonceAuthority', __filename, EPOCH);
const chains = new Map<string, Promise<unknown>>();

/**
 * Serialize a signing operation per wallet. No two ops for the same wallet run
 * their bodies concurrently — the second starts only after the first settles
 * (resolves OR rejects). Ops for DIFFERENT wallet addresses are independent and
 * may run concurrently.
 *
 * The op itself is responsible for re-fetching the 'latest' nonce per attempt
 * (D-NONCE-SAFE-RETRY); this lock only guarantees no two ops run at once for one
 * wallet, so no two ever contend for a nonce. Never use ethers `NonceManager`.
 *
 * @param walletAddress the signing wallet's address (any case — keyed lowercase)
 * @param op the signing operation to run under the per-wallet lock
 * @returns the op's resolution; rejects with the op's error (the CALLER sees the
 *          real outcome, even though the chain's stored tail swallows it)
 */
export async function withNonceLock<T>(walletAddress: string, op: () => Promise<T>): Promise<T> {
    const key = walletAddress.toLowerCase();
    // Read the prior tail (or a resolved sentinel for the first op). The
    // get/set below is synchronous and atomic within this event-loop tick, so a
    // concurrent caller for the same key cannot observe a stale tail.
    const prior = chains.get(key) ?? Promise.resolve();
    // Chain the new op AFTER the prior one settles. `prior.catch(() => {})`
    // ensures a prior rejection does not skip this op — the queue advances on
    // success OR failure.
    const run = prior.catch(() => {}).then(op);
    // Store a NEVER-rejecting tail back into the Map so a rejected op cannot
    // break the chain (an unhandled rejection on the stored promise would also
    // surface as an uncaught error). The caller still gets the real `run`.
    chains.set(key, run.catch(() => {}));
    return run;
}

/**
 * Test-only hook: clears all per-wallet chains so tests start from a clean
 * state. Underscore prefix signals test-only (mirrors `_resetForTesting` in
 * circuitBreaker.ts / `_resetRegistryForTesting` in detector.ts).
 */
export function _resetNonceChainsForTesting(): void {
    chains.clear();
}
