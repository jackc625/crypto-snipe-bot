import { Contract, ethers } from "ethers";
import { CONFIG } from "../config";

export async function getPairAddressFromToken(tokenAddress: string): Promise<string | null> {
    const factoryAbi = [
        "function getPair(address tokenA, address tokenB) external view returns (address pair)"
    ];

    const provider = new ethers.JsonRpcProvider(CONFIG.rpc[CONFIG.network]);
    const factory = new Contract(CONFIG.factoryAddress, factoryAbi, provider);

    try {
        const pair = await factory.getPair(CONFIG.wethAddress, tokenAddress);
        return pair !== "0x0000000000000000000000000000000000000000" ? pair : null;
    } catch (e) {
        console.warn("🔍 Pair discovery failed:", e);
        return null;
    }
}