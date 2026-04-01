// src/alphaDrop.ts
// Alpha drop handler for both legacy single-chain and multi-chain routing.
// handleAlphaDropForChain discovers which DEX the token is on by querying factories,
// then routes to the appropriate handleNewPairForChain or handleNewV3PoolForChain.

import { Contract } from 'ethers';
import type { ChainContext, DexConfigV2 } from './chainRegistry';
import { PAIR_ABI, FACTORY_ABI, V3_FACTORY_ABI } from './utils/abis';
import { sendTelegramAlert } from './utils/notifier';
import { logger } from './utils/logger';

// Legacy single-chain imports (kept for backward compatibility)
import { getPairAddressFromToken } from './utils/pairDiscovery';
import { handleNewPair } from './bot';
import { getProvider } from './utils/provider';

const log = logger.child({ module: 'alphaDrop' });

// ---------------------------------------------------------------------------
// Multi-chain alpha drop handler (D-16, D-17)
// ---------------------------------------------------------------------------

/**
 * Multi-chain alpha drop handler.
 * Discovers which DEX the token is on by querying each factory,
 * then routes to the appropriate handleNewPairForChain or handleNewV3PoolForChain.
 */
export async function handleAlphaDropForChain(ctx: ChainContext, tokenAddress: string): Promise<void> {
    try {
        // Try each DEX factory to find the pair/pool
        for (const dex of ctx.chain.dexes) {
            if (dex.dexType === 'v2') {
                const factory = new Contract(dex.factoryAddress, FACTORY_ABI, ctx.httpProvider);
                const pairAddress: string = await factory.getPair(tokenAddress, ctx.chain.wethAddress);
                if (pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000') {
                    const pair = new Contract(pairAddress, PAIR_ABI, ctx.httpProvider);
                    const token0: string = await pair.token0();
                    const token1: string = await pair.token1();
                    // Dynamic import to avoid circular dependency (alphaDrop <- telegramListener, bot -> alphaDrop)
                    const { handleNewPairForChain } = await import('./bot');
                    await handleNewPairForChain(ctx, dex as DexConfigV2, token0, token1, pairAddress);
                    return;
                }
            }
            // V3: check if pool exists for common fee tiers
            if (dex.dexType === 'v3') {
                const v3Factory = new Contract(dex.factoryAddress, V3_FACTORY_ABI, ctx.httpProvider);
                for (const feeTier of [500, 3000, 10000]) {
                    const pool: string = await v3Factory.getPool(tokenAddress, ctx.chain.wethAddress, feeTier);
                    if (pool && pool !== '0x0000000000000000000000000000000000000000') {
                        const { handleNewV3PoolForChain } = await import('./bot');
                        await handleNewV3PoolForChain(ctx, dex, tokenAddress, ctx.chain.wethAddress, feeTier, pool, 0);
                        return;
                    }
                }
            }
        }
        log.warn({ token: tokenAddress, chain: ctx.chain.name }, 'No pair/pool found on any DEX for chain');
        await sendTelegramAlert(`${ctx.chain.displayName} No pair found for \`${tokenAddress}\``);
    } catch (e) {
        log.error({ err: e, token: tokenAddress, chain: ctx.chain.name }, 'Error in handleAlphaDropForChain');
        await sendTelegramAlert(`${ctx.chain.displayName} Error handling drop for \`${tokenAddress}\``);
    }
}

// ---------------------------------------------------------------------------
// Legacy single-chain handler (backward compatibility)
// ---------------------------------------------------------------------------

export async function handleAlphaDrop(tokenAddress: string) {
    try {
        const pairAddress = await getPairAddressFromToken(tokenAddress);

        if (!pairAddress) {
            log.warn({ token: tokenAddress }, 'Could not find pair for token');
            await sendTelegramAlert(`*No pair found* for \`${tokenAddress}\``);
            return;
        }

        const token0 = await getTokenFromPair(pairAddress, 0);
        const token1 = await getTokenFromPair(pairAddress, 1);

        await handleNewPair(token0, token1, pairAddress);
    } catch (e) {
        log.error({ err: e, token: tokenAddress }, 'Error in handleAlphaDrop');
        await sendTelegramAlert(`*Error handling drop for* \`${tokenAddress}\``);
    }
}

async function getTokenFromPair(pairAddress: string, index: 0 | 1): Promise<string> {
    const provider = getProvider();
    const pair = new Contract(pairAddress, PAIR_ABI, provider);
    return index === 0 ? pair.token0() : pair.token1();
}
