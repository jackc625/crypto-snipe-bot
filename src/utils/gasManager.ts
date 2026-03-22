import { JsonRpcProvider } from "ethers";
import { CONFIG } from "../config";

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
