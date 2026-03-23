// src/utils/txManager.ts
// Transaction submission manager with MEV strategy dispatch.
// Supports both legacy single-chain (provider+wallet+useFlashbots) and
// new multi-chain (ChainContext) calling conventions.
import { JsonRpcProvider, Wallet } from "ethers";
import type { TransactionRequest } from "ethers";
import { getFlashbotsProvider } from "./flashbots";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { logger } from "./logger";
import type { MevStrategy } from './mevStrategies/types';
import { FlashbotsMevStrategy } from './mevStrategies/flashbots';
import { BloxrouteMevStrategy } from './mevStrategies/bloxroute';
import { PassthroughMevStrategy } from './mevStrategies/passthrough';
import type { ChainConfig, ChainContext } from '../chainRegistry';

const log = logger.child({ module: 'txManager' });

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
// sendTxWithRetry -- multi-chain overload + legacy overload
// ---------------------------------------------------------------------------

/**
 * Send a transaction with MEV protection and retry logic.
 *
 * **Multi-chain overload** (preferred):
 *   sendTxWithRetry(txBuilder, ctx, maxRetries?)
 *   Dispatches to the correct MEV strategy based on ctx.chain.mevStrategy.
 *
 * **Legacy overload** (backward compat -- use ChainContext version for multi-chain):
 *   sendTxWithRetry(txBuilder, provider, wallet, useFlashbots?, maxRetries?)
 *   Existing Flashbots/direct submission logic, unchanged from pre-refactor.
 */
export async function sendTxWithRetry(
    txBuilder: () => Promise<TransactionRequest>,
    providerOrCtx: JsonRpcProvider | ChainContext,
    walletOrRetries?: Wallet | number,
    useFlashbots?: boolean,
    maxRetries?: number
): Promise<string | void> {
    // Duck-type check for ChainContext
    if (
        providerOrCtx !== null &&
        typeof providerOrCtx === 'object' &&
        'chain' in providerOrCtx &&
        'httpProvider' in providerOrCtx
    ) {
        // --- New multi-chain path ---
        const ctx = providerOrCtx as ChainContext;
        const retries = (typeof walletOrRetries === 'number' ? walletOrRetries : maxRetries) || 3;
        const strategy = createMevStrategy(ctx.chain);

        ctx.log.info({ chain: ctx.chain.name, strategy: strategy.name }, 'Dispatching TX via MEV strategy');

        const tx = await txBuilder();
        return strategy.sendTransaction(tx, ctx.wallet, ctx.httpProvider, retries);
    }

    // --- Legacy single-chain path (existing code, unchanged) ---
    // Legacy overload -- use ChainContext version for multi-chain
    const provider = providerOrCtx as JsonRpcProvider;
    const wallet = walletOrRetries as Wallet;
    const useFb = useFlashbots ?? true;
    const retries = maxRetries ?? 3;

    const authSigner = new Wallet(process.env.FLASHBOTS_AUTH_KEY!);
    const flashbotsProvider: FlashbotsBundleProvider = await getFlashbotsProvider(provider, authSigner);
    const baseNonce = await provider.getTransactionCount(wallet.address, "latest");

    let attempt = 0;

    while (attempt <= retries) {
        try {
            const txRequest = await txBuilder();
            const gasLimit = txRequest.gasLimit || 300_000n;
            const gasPrice = (await provider.getFeeData()).gasPrice;

            const populatedTx: TransactionRequest = {
                ...txRequest,
                gasLimit,
                gasPrice,
                nonce: baseNonce + attempt,
                chainId: (await provider.getNetwork()).chainId,
            };

            if (useFb) {
                const targetBlock = (await provider.getBlockNumber()) + 1;

                const bundle = await flashbotsProvider.sendBundle(
                    [
                        {
                            signer: wallet,
                            transaction: populatedTx,
                        },
                    ],
                    targetBlock
                );

                // Type-safe error handling
                if ("error" in bundle) {
                    throw new Error(`Flashbots error: ${bundle.error.message}`);
                }

                const waitResponse = await bundle.wait();

                if (waitResponse === 0) {
                    log.info({ block: targetBlock }, 'Flashbots bundle included');
                    return;
                } else {
                    throw new Error(`Flashbots bundle not included in block ${targetBlock}`);
                }

            } else {
                const tx = await wallet.sendTransaction(populatedTx);
                log.info({ attempt: attempt + 1, txHash: tx.hash }, 'TX sent');

                const receipt = await tx.wait(3);
                if (receipt && receipt.status === 1) {
                    log.info({ block: receipt.blockNumber }, 'TX confirmed');
                    return;
                } else {
                    throw new Error("TX failed or receipt is null");
                }
            }
        } catch (err) {
            log.warn({ attempt: attempt + 1, maxRetries: retries, err }, 'TX retry');
            attempt++;
        }
    }

    throw new Error("Max retries reached, TX not mined");
}
