import { JsonRpcProvider } from "ethers";
import { CONFIG } from "../config";
import type { ChainContext } from '../chainRegistry';

/**
 * Chain-aware gas options.
 * Reads gas type (eip1559 vs legacy) and multiplier from ChainContext.
 * Handles both EIP-1559 (ETH/Base/Arb) and legacy (BSC) gas pricing.
 */
export async function getGasOptionsForChain(ctx: ChainContext) {
    const feeData = await ctx.httpProvider.getFeeData();
    const gasConfig = ctx.chain.gas;

    if (gasConfig.type === 'eip1559' && feeData.maxFeePerGas) {
        return {
            maxFeePerGas: feeData.maxFeePerGas * BigInt(Math.round(gasConfig.multiplier * 100)) / 100n,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            gasLimit: gasConfig.maxGasLimit,
        };
    }

    // Legacy gas pricing (BSC)
    const gasPrice = feeData.gasPrice
        ? feeData.gasPrice * BigInt(Math.round(gasConfig.multiplier * 100)) / 100n
        : undefined;

    return {
        gasPrice,
        gasLimit: gasConfig.maxGasLimit,
    };
}

/**
 * Legacy gas options function (unchanged).
 * Uses global CONFIG for gas multiplier and fixed 300k gas limit.
 */
export async function getGasOptions(provider: JsonRpcProvider) {
    const feeData = await provider.getFeeData();

    const gasPrice = feeData.gasPrice
        ? feeData.gasPrice * BigInt(Math.round(CONFIG.gasMultiplier * 100)) / 100n
        : undefined;

    return {
        gasPrice,
        gasLimit: 300_000n,
    };
}
