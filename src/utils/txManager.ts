// src/utils/txManager.ts
// Transaction submission manager with MEV strategy dispatch.
// Multi-chain (ChainContext) calling convention only: sendTxWithRetry
// delegates wholly to the per-chain MevStrategy (which owns retry +
// nonce-safe + inclusion-reconciliation logic). The legacy single-chain
// Flashbots branch was deleted in Phase 21.1 (D-DELETE-LEGACY): it carried
// the identical premature-failure + incrementing-nonce-on-retry
// false-negative/double-spend bug as the pre-fix FlashbotsMevStrategy and had
// zero live callers, so per D-ROLLBACK (no legacy fallback paths) it was a
// re-introduction hazard and removed entirely.
import type { TransactionRequest, JsonRpcProvider, Wallet } from "ethers";
import { keccak256 } from "ethers";
import type { MevStrategy } from './mevStrategies/types';
import { FlashbotsMevStrategy } from './mevStrategies/flashbots';
import { BloxrouteMevStrategy } from './mevStrategies/bloxroute';
import { PassthroughMevStrategy } from './mevStrategies/passthrough';
import type { ChainConfig, ChainContext } from '../chainRegistry';

// ---------------------------------------------------------------------------
// MEV strategy factory
// ---------------------------------------------------------------------------

/**
 * Create the correct MevStrategy implementation for a given chain config.
 * Maps chain.mevStrategy to: flashbots (ETH), bloxroute (BSC), passthrough (Base/Arb).
 * Exported for health check loops in the bot orchestrator (Plan 04).
 */
export function createMevStrategy(chain: ChainConfig): MevStrategy {
    switch (chain.mevStrategy) {
        case 'flashbots':
            return new FlashbotsMevStrategy(chain.mevConfig);
        case 'bloxroute':
            return new BloxrouteMevStrategy(chain.mevConfig);
        case 'passthrough':
            return new PassthroughMevStrategy(chain.name);
        default: {
            // Exhaustive check -- TypeScript will error if a new MevStrategyType is added
            const _exhaustive: never = chain.mevStrategy;
            throw new Error(`Unknown MEV strategy: ${_exhaustive}`);
        }
    }
}

// ---------------------------------------------------------------------------
// sendTxWithRetry -- multi-chain dispatch
// ---------------------------------------------------------------------------

/**
 * Send a transaction with MEV protection and retry logic.
 *
 * Dispatches to the correct MEV strategy based on `ctx.chain.mevStrategy`.
 * All retry / nonce-safety / inclusion-reconciliation logic lives in the
 * strategy (the dispatcher delegates wholly), so the returned value is always
 * the strategy's real on-chain tx hash (`Promise<string>`).
 *
 * Optional `gasMultiplier` elevates EIP-1559 maxFee/priorityFee or legacy
 * gasPrice on the populated tx (Phase 19 anti-rug exit passes
 * `ctx.chain.antiRug.gasMultiplier` when reason='anti-rug').
 *
 * The arg shape is kept as
 *   sendTxWithRetry(txBuilder, ctx, walletOrRetries?, useFlashbots?, maxRetries?, gasMultiplier?)
 * for the existing call sites (exitEngine passes args 3-5 as `undefined` and
 * the multiplier in slot 6). The middle slots are vestigial from the removed
 * legacy overload — only `walletOrRetries` (as a retry count) and
 * `gasMultiplier` are honored on the dispatch path; `providerOrCtx` must be a
 * `ChainContext`.
 */
export async function sendTxWithRetry(
    txBuilder: () => Promise<TransactionRequest>,
    providerOrCtx: JsonRpcProvider | ChainContext,
    walletOrRetries?: Wallet | number,
    _useFlashbots?: boolean,
    maxRetries?: number,
    gasMultiplier?: number
): Promise<string> {
    // Duck-type check for ChainContext. The legacy single-chain Flashbots path
    // was deleted (D-DELETE-LEGACY); a non-ChainContext arg is now a caller bug.
    if (
        providerOrCtx === null ||
        typeof providerOrCtx !== 'object' ||
        !('chain' in providerOrCtx) ||
        !('httpProvider' in providerOrCtx)
    ) {
        throw new Error(
            'sendTxWithRetry requires a ChainContext as the 2nd argument (the legacy provider+wallet overload was removed in Phase 21.1).'
        );
    }

    // --- Multi-chain dispatch ---
    // `_useFlashbots` arg slot is unused (the dispatcher picks the strategy via
    // ctx.chain.mevStrategy); the `gasMultiplier` slot is the Phase 19 /
    // D-RACE-TELEMETRY hook for elevating anti-rug exit gas.
    const ctx = providerOrCtx as ChainContext;
    const retries = (typeof walletOrRetries === 'number' ? walletOrRetries : maxRetries) || 3;
    const strategy = createMevStrategy(ctx.chain);

    ctx.log.info({ chain: ctx.chain.name, strategy: strategy.name, gasMultiplier: gasMultiplier ?? 1.0 }, 'Dispatching TX via MEV strategy');

    const tx = await txBuilder();
    return strategy.sendTransaction(tx, ctx.wallet, ctx.httpProvider, retries, gasMultiplier);
}

// ---------------------------------------------------------------------------
// escalatePrivateSell -- the PRIVATE leg of the Finding A inclusion ladder
// (Phase 21.2 / Plan 21.2-06, D-EXIT-INCLUSION + D-FALLBACK-NO-DOUBLE-SELL)
// ---------------------------------------------------------------------------

/**
 * Structured outcome of a private-escalation sell attempt for the inclusion
 * ladder. Unlike {@link sendTxWithRetry} (which returns a bare hash or THROWS on
 * genuine not-landed), this normalizes BOTH paths into a structured result so the
 * ladder can fall through to the public-mempool fallback WITHOUT treating a
 * not-landed bundle as a hard error:
 *   - `landed:true`  → the private bundle was included (possibly late-reconciled
 *      by 21.1's receipt+nonce probe); `txHash` is the REAL on-chain hash.
 *   - `landed:false` → the private bundle genuinely did not land within the
 *      escalation budget; `lastSignedHash` + `lastNonce` are the deterministic
 *      signed-tx hash + the submitted nonce of the LAST attempt, so the engine's
 *      no-double-sell guard can re-run `reconcileInclusion` on them before any
 *      public fallback (the LADYS / STOP-THE-LINE-02 late-land guard).
 */
export interface PrivateSellResult {
    landed: boolean;
    /** Real on-chain hash when landed:true. */
    txHash?: string;
    /** Deterministic signed-tx hash of the last attempt (for the no-double-sell guard). */
    lastSignedHash?: string;
    /** Submitted nonce of the last attempt (for the no-double-sell guard). */
    lastNonce?: number;
}

/**
 * Run the PRIVATE escalation leg of the inclusion ladder and normalize the
 * outcome to {@link PrivateSellResult}. The deterministic signed-tx hash + nonce
 * are captured BEFORE dispatch (by populating + locally signing the sell tx — the
 * same block-independent `signedTxHash` discipline 21.1 uses) so that, on a
 * not-landed outcome, the engine can reconcile the exact attempt against chain
 * state before falling back to the public mempool. Local signing does NOT
 * broadcast — the existing `sendTxWithRetry` strategy dispatch performs the real
 * submit, so there is no double-submit here.
 *
 * @param attempts reason-aware private-attempt budget (anti-rug → 0-1; routine →
 *                 MEV_SELL_FALLBACK_ATTEMPTS). Passed to the strategy as its
 *                 maxRetries so a not-landed bundle exhausts cleanly and returns
 *                 `landed:false` rather than spinning.
 */
export async function escalatePrivateSell(
    txBuilder: () => Promise<TransactionRequest>,
    ctx: ChainContext,
    attempts: number,
    gasMultiplier?: number
): Promise<PrivateSellResult> {
    // Capture the deterministic signed-tx hash + submitted nonce of the attempt
    // we are about to dispatch. This is block-independent (depends only on the
    // signed bytes), so it is the stable handle the no-double-sell guard probes.
    let lastSignedHash: string | undefined;
    let lastNonce: number | undefined;
    try {
        const tx = await txBuilder();
        const nonce = await ctx.httpProvider.getTransactionCount(ctx.wallet.address, 'latest');
        lastNonce = nonce;
        const populated = await ctx.wallet.populateTransaction({ ...tx, nonce });
        const signedRaw = await ctx.wallet.signTransaction(populated);
        lastSignedHash = keccak256(signedRaw);
    } catch (e) {
        // A pre-dispatch populate/sign failure is non-fatal to the ladder: the
        // guard will fall back to balanceOf-as-truth (the authoritative
        // no-double-sell signal). Log + continue to the real dispatch.
        ctx.log.warn(
            { err: e instanceof Error ? e.message : String(e), op: 'exit.private.presign-failed' },
            'Could not pre-sign the private sell attempt for the no-double-sell guard; relying on balanceOf truth',
        );
    }

    try {
        // The strategy owns nonce-safe retry + receipt+nonce reconciliation; it
        // returns the REAL hash even on a late land (so `landed:true` already
        // covers the LADYS late-inclusion at the strategy layer).
        const txHash = await sendTxWithRetry(txBuilder, ctx, attempts, undefined, undefined, gasMultiplier);
        return { landed: true, txHash };
    } catch (e) {
        // Genuine not-landed / ceiling-hit (the strategy threw). This is NOT a
        // hard error for the ladder — the public-mempool fallback is the
        // guaranteed exit. PRESERVE the bare-string guard (Flashbots bundle.wait()
        // rejects with a string, not an Error — Finding B root cause).
        ctx.log.warn(
            { err: e instanceof Error ? e.message : String(e), op: 'exit.private.not-landed' },
            'Private escalation did not land within the budget — proceeding to the no-double-sell guard + public fallback',
        );
        return { landed: false, lastSignedHash, lastNonce };
    }
}
