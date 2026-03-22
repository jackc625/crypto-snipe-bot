import { getPairAddressFromToken } from "./utils/pairDiscovery";
import { handleNewPair } from "./bot";
import { sendTelegramAlert } from "./utils/notifier";
import { Contract } from "ethers";
import { getProvider } from "./utils/provider";
import { PAIR_ABI } from "./utils/abis";
import { logger } from "./utils/logger";

const log = logger.child({ module: 'alphaDrop' });

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