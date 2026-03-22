import { Contract } from "ethers";
import { CONFIG } from "../config";
import { getProvider } from "./provider";
import { FACTORY_ABI } from "./abis";
import { logger } from "./logger";

const log = logger.child({ module: 'pairDiscovery' });

export async function getPairAddressFromToken(tokenAddress: string): Promise<string | null> {
    const provider = getProvider();
    const factory = new Contract(CONFIG.factoryAddress, FACTORY_ABI, provider);

    try {
        const pair = await factory.getPair(CONFIG.wethAddress, tokenAddress);
        return pair !== "0x0000000000000000000000000000000000000000" ? pair : null;
    } catch (e) {
        log.warn({ err: e, token: tokenAddress }, 'Pair discovery failed');
        return null;
    }
}