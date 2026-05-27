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
