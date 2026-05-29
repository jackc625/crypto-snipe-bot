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
import type { MevStrategy, BroadcastHandle } from './mevStrategies/types';
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
 *   sendTxWithRetry(txBuilder, ctx, walletOrRetries?, useFlashbots?, maxRetries?, gasMultiplier?, broadcast?)
 * for the existing call sites (exitEngine passes args 3-5 as `undefined` and
 * the multiplier in slot 6). The middle slots are vestigial from the removed
 * legacy overload — only `walletOrRetries` (as a retry count) and
 * `gasMultiplier` are honored on the dispatch path; `providerOrCtx` must be a
 * `ChainContext`.
 *
 * `broadcast` (optional, Phase 21.2-12 / CR-02): a side-channel the strategy
 * populates with the ACTUALLY-BROADCAST signed-tx hash + submitted nonce so the
 * exit ladder's no-double-sell guard reconciles the REAL broadcast tx. Existing
 * callers that omit it are unaffected (the return value is unchanged).
 */
export async function sendTxWithRetry(
    txBuilder: () => Promise<TransactionRequest>,
    providerOrCtx: JsonRpcProvider | ChainContext,
    walletOrRetries?: Wallet | number,
    _useFlashbots?: boolean,
    maxRetries?: number,
    gasMultiplier?: number,
    broadcast?: BroadcastHandle
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
    // WR-04 (21.2-13): honor an EXPLICIT numeric retry budget — including 0 (and a
    // negative, which the sell ladder uses to mean "zero private attempts → go
    // straight to the public fallback"). The old `… || 3` treated 0 as falsy and
    // silently promoted it to 3 (→ up to 4 submissions), defeating an operator's
    // (or the anti-rug path's) "no/one quick private attempt" budget and delaying
    // the guaranteed public exit. Only when NO explicit budget is supplied (buys:
    // walletOrRetries + maxRetries both undefined) does the default 3 apply — so
    // BUY retry behavior is unchanged (4 attempts).
    const explicitRetries = typeof walletOrRetries === 'number' ? walletOrRetries : maxRetries;
    const retries = explicitRetries ?? 3;
    const strategy = createMevStrategy(ctx.chain);

    ctx.log.info({ chain: ctx.chain.name, strategy: strategy.name, gasMultiplier: gasMultiplier ?? 1.0 }, 'Dispatching TX via MEV strategy');

    const tx = await txBuilder();
    return strategy.sendTransaction(tx, ctx.wallet, ctx.httpProvider, retries, gasMultiplier, broadcast);
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
 *      escalation budget; `lastSignedHash` + `lastNonce` are the ACTUALLY-
 *      BROADCAST signed-tx hash + the submitted nonce of the LAST attempt (the
 *      strategy's real broadcast handle — NOT a throwaway local pre-sign), so the
 *      engine's no-double-sell guard can re-run `reconcileInclusion` on the tx
 *      that ACTUALLY hit the chain before any public fallback (the LADYS /
 *      STOP-THE-LINE-02 late-land guard; CR-02 fix, 21.2-12).
 */
export interface PrivateSellResult {
    landed: boolean;
    /** Real on-chain hash when landed:true. */
    txHash?: string;
    /** ACTUALLY-BROADCAST signed-tx hash of the last attempt (for the no-double-sell guard). */
    lastSignedHash?: string;
    /** ACTUALLY-SUBMITTED nonce of the last attempt (for the no-double-sell guard). */
    lastNonce?: number;
}

/**
 * Run the PRIVATE escalation leg of the inclusion ladder and normalize the
 * outcome to {@link PrivateSellResult}.
 *
 * CR-02 fix (21.2-12): the no-double-sell handle (`lastSignedHash`/`lastNonce`)
 * is the tx the strategy ACTUALLY BROADCAST — captured via a {@link BroadcastHandle}
 * side-channel the strategy populates after every submit — NOT a throwaway tx
 * pre-signed here. The old pre-sign re-built the tx WITHOUT the strategy's
 * fee escalation / affordability clamp / chainId / type, so its keccak256 hash
 * differed from the broadcast tx and `reconcileInclusion` always probed a phantom
 * hash (its receipt was forever null → step 2a could never abort the public
 * fallback → double-sell window). The strategy is still the SOLE broadcaster
 * (no double-submit) — the side-channel only SURFACES what it sent.
 *
 * @param attempts reason-aware private-attempt BUDGET = the number of private
 *                 SUBMISSIONS to make before the public fallback (anti-rug → 1;
 *                 routine → MEV_SELL_FALLBACK_ATTEMPTS, default 2; 0 → go straight
 *                 to public). WR-05 (21.2-13): the shared reconciliation loop runs
 *                 `attempt = 0 .. maxRetries` INCLUSIVE → maxRetries+1 submissions,
 *                 so the budget→maxRetries mapping is `maxRetries = budget - 1`
 *                 (budget 1 → maxRetries 0 → 1 submission; budget 2 → maxRetries 1
 *                 → 2 submissions; budget 0 → maxRetries -1 → the loop body never
 *                 runs → 0 submissions). This makes the OBSERVED private-submission
 *                 count equal the documented budget. The shared loop bound is
 *                 UNCHANGED (so buys, which pass no explicit retries → default 3 →
 *                 4 attempts, are unaffected); only the sell-side mapping moved.
 */
export async function escalatePrivateSell(
    txBuilder: () => Promise<TransactionRequest>,
    ctx: ChainContext,
    attempts: number,
    gasMultiplier?: number
): Promise<PrivateSellResult> {
    // The side-channel the strategy populates with the ACTUALLY-BROADCAST signed-
    // tx hash + submitted nonce of its LAST attempt — even when it throws (genuine
    // not-landed / ceiling-hit). This is the stable, ON-CHAIN handle the
    // no-double-sell guard probes (CR-02). NO local pre-sign.
    const broadcast: BroadcastHandle = {};

    // WR-05: budget (submissions) → maxRetries. A budget of 0 maps to -1, which
    // the WR-04-fixed sendTxWithRetry honors verbatim (NOT promoted to 3): the
    // shared loop's `attempt <= cfg.maxRetries` is then false at attempt 0, so no
    // private submission is made and the ladder goes straight to the public
    // fallback (the guaranteed exit).
    const maxRetries = attempts - 1;

    try {
        // The strategy owns nonce-safe retry + receipt+nonce reconciliation; it
        // returns the REAL hash even on a late land (so `landed:true` already
        // covers the LADYS late-inclusion at the strategy layer). It also writes
        // the broadcast handle even on this success path.
        const txHash = await sendTxWithRetry(txBuilder, ctx, maxRetries, undefined, undefined, gasMultiplier, broadcast);
        return { landed: true, txHash };
    } catch (e) {
        // Genuine not-landed / ceiling-hit (the strategy threw). This is NOT a
        // hard error for the ladder — the public-mempool fallback is the
        // guaranteed exit. PRESERVE the bare-string guard (Flashbots bundle.wait()
        // rejects with a string, not an Error — Finding B root cause). The
        // broadcast handle holds the LAST attempt's real hash + nonce (or stays
        // empty if the strategy threw BEFORE its first submit, e.g. attempt-0
        // unaffordable — in which case the guard falls back to balanceOf truth).
        ctx.log.warn(
            { err: e instanceof Error ? e.message : String(e), op: 'exit.private.not-landed' },
            'Private escalation did not land within the budget — proceeding to the no-double-sell guard + public fallback',
        );
        return { landed: false, lastSignedHash: broadcast.signedTxHash, lastNonce: broadcast.submittedNonce };
    }
}

// ---------------------------------------------------------------------------
// escalatePrivateBuy -- the PRIVATE leg of the deliberate buy inclusion ladder
// (Phase 21.3 / Plan 21.3-03, STOP-THE-LINE-05-B/C, D-DELIBERATE-PRIVATE-FIRST +
// D-NO-DOUBLE-BUY). The EXACT byte-for-byte mirror of escalatePrivateSell above,
// inverted to the buy direction.
// ---------------------------------------------------------------------------

/**
 * Structured outcome of a private-escalation BUY attempt for the deliberate
 * inclusion ladder. The buy mirror of {@link PrivateSellResult}: it normalizes
 * BOTH the landed and the genuinely-not-landed paths into a structured result so
 * the deliberate path can fall through to the no-double-buy guard + public-mempool
 * fallback WITHOUT treating a not-landed bundle as a hard error.
 *   - `landed:true`  → the private bundle was included (possibly late-reconciled by
 *      21.1's receipt+nonce probe); `txHash` is the REAL on-chain hash.
 *   - `landed:false` → the private bundle genuinely did not land within the budget;
 *      `lastSignedHash` + `lastNonce` are the ACTUALLY-BROADCAST signed-tx hash + the
 *      submitted nonce of the LAST attempt (the strategy's real broadcast handle —
 *      NOT a throwaway local pre-sign), so the no-double-buy guard can re-run
 *      `reconcileInclusion` on the tx that ACTUALLY hit the chain before any public
 *      buy (CR-02 lesson). A double-BUY spends real ETH twice (UNrecoverable), so the
 *      buy guard is STRICTER than the sell: it ALSO requires balanceOf(token)==0 AND
 *      nonce-not-consumed before broadcasting the public buy.
 *
 * NOTE: the genuine SNIPE path (submitBuyTx, no explicit retries → default 3 → 4
 * attempts, private-only, fail-clean) is UNCHANGED — only the explicitly-invoked
 * deliberate path (scripts/deliberate-buy.ts → executeDeliberateBuy) calls this.
 */
export interface PrivateBuyResult {
    landed: boolean;
    /** Real on-chain hash when landed:true. */
    txHash?: string;
    /** ACTUALLY-BROADCAST signed-tx hash of the last attempt (for the no-double-buy guard). */
    lastSignedHash?: string;
    /** ACTUALLY-SUBMITTED nonce of the last attempt (for the no-double-buy guard). */
    lastNonce?: number;
}

/**
 * Run the PRIVATE escalation leg of the deliberate buy inclusion ladder and
 * normalize the outcome to {@link PrivateBuyResult}. The exact mirror of
 * {@link escalatePrivateSell}.
 *
 * CR-02 fix (carried to the buy leg): the no-double-buy handle
 * (`lastSignedHash`/`lastNonce`) is the tx the strategy ACTUALLY BROADCAST —
 * captured via a {@link BroadcastHandle} side-channel the strategy populates after
 * every submit — NOT a throwaway tx pre-signed here. NO local pre-sign: a re-built
 * tx has a different keccak256 hash and `reconcileInclusion` would forever probe a
 * phantom hash (its receipt always null → the guard could never abort the public
 * buy → double-spend window). The strategy stays the SOLE broadcaster; the
 * side-channel only SURFACES what it sent.
 *
 * The deliberate buy uses NORMAL escalation (no gasMultiplier — the multiplier slot
 * stays undefined; that hook is the anti-rug exit's, not the buy's).
 *
 * @param attempts the deliberate private-attempt BUDGET = the number of private
 *                 SUBMISSIONS to make before the public fallback
 *                 (DELIBERATE_BUY_PRIVATE_ATTEMPTS, default 2). WR-05 budget→maxRetries
 *                 mapping: the shared reconciliation loop runs `attempt = 0 .. maxRetries`
 *                 INCLUSIVE → maxRetries+1 submissions, so `maxRetries = budget - 1`
 *                 (budget 2 → maxRetries 1 → 2 submissions). The shared loop bound is
 *                 UNCHANGED, so the genuine snipe path (no explicit retries → default 3
 *                 → 4 attempts) is unaffected.
 */
export async function escalatePrivateBuy(
    txBuilder: () => Promise<TransactionRequest>,
    ctx: ChainContext,
    attempts: number,
): Promise<PrivateBuyResult> {
    // The side-channel the strategy populates with the ACTUALLY-BROADCAST signed-
    // tx hash + submitted nonce of its LAST attempt — even when it throws (genuine
    // not-landed / ceiling-hit). This is the stable, ON-CHAIN handle the
    // no-double-buy guard probes (CR-02). NO local pre-sign.
    const broadcast: BroadcastHandle = {};

    // WR-05: budget (submissions) → maxRetries. The deliberate budget defaults to 2
    // → maxRetries 1 → 2 private submissions. A budget of 0 maps to -1, which the
    // WR-04-fixed sendTxWithRetry honors verbatim (NOT promoted to 3): no private
    // submission is made and the deliberate ladder goes straight to the no-double-buy
    // guard + public fallback.
    const maxRetries = attempts - 1;

    try {
        // The strategy owns nonce-safe retry + receipt+nonce reconciliation; it
        // returns the REAL hash even on a late land (so `landed:true` already covers
        // late inclusion at the strategy layer). It also writes the broadcast handle
        // even on this success path. NO gasMultiplier (normal escalation).
        const txHash = await sendTxWithRetry(txBuilder, ctx, maxRetries, undefined, undefined, undefined, broadcast);
        return { landed: true, txHash };
    } catch (e) {
        // Genuine not-landed / ceiling-hit (the strategy threw). This is NOT a hard
        // error for the deliberate ladder — the no-double-buy-guarded public fallback
        // is the manual escape. PRESERVE the bare-string guard (Flashbots bundle.wait()
        // rejects with a string, not an Error — Finding B root cause). The broadcast
        // handle holds the LAST attempt's real hash + nonce (or stays empty if the
        // strategy threw BEFORE its first submit, e.g. attempt-0 unaffordable — in which
        // case the guard falls back to the stricter balanceOf+nonce chain-is-truth check).
        ctx.log.warn(
            { err: e instanceof Error ? e.message : String(e), op: 'buy.private.not-landed' },
            'Private deliberate-buy escalation did not land within the budget — proceeding to the no-double-buy guard + public fallback',
        );
        return { landed: false, lastSignedHash: broadcast.signedTxHash, lastNonce: broadcast.submittedNonce };
    }
}
