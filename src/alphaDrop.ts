import { getPairAddressFromToken } from "./utils/pairDiscovery"; // You'll write this helper
import { handleNewPair } from "./bot";
import { CONFIG } from "./config";
import { sendTelegramAlert } from "./utils/notifier";
import { ethers } from "ethers";

export async function handleAlphaDrop(tokenAddress: string) {
    try {
        const pairAddress = await getPairAddressFromToken(tokenAddress);

        if (!pairAddress) {
            console.warn("❌ Could not find pair for token:", tokenAddress);
            await sendTelegramAlert(`❌ *No pair found* for \`${tokenAddress}\``);
            return;
        }

        const token0 = await getToken0FromPair(pairAddress);
        const token1 = await getToken1FromPair(pairAddress);

        await handleNewPair(token0, token1, pairAddress);
    } catch (e) {
        console.error("🚨 Error in handleAlphaDrop:", e);
        await sendTelegramAlert(`🚨 *Error handling drop for* \`${tokenAddress}\``);
    }
}

async function getToken0FromPair(pairAddress: string): Promise<string> {
    const pairABI = ["function token0() view returns (address)"];
    const provider = new ethers.JsonRpcProvider(CONFIG.rpc[CONFIG.network]);
    const pair = new ethers.Contract(pairAddress, pairABI, provider);
    return pair.token0();
}

async function getToken1FromPair(pairAddress: string): Promise<string> {
    const pairABI = ["function token1() view returns (address)"];
    const provider = new ethers.JsonRpcProvider(CONFIG.rpc[CONFIG.network]);
    const pair = new ethers.Contract(pairAddress, pairABI, provider);
    return pair.token1();
}