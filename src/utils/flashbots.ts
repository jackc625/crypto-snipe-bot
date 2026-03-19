import { providers, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { CONFIG, SupportedNetwork } from "../config";

const FLASHBOTS_RELAYS: Record<string, { url: string; network: string }> = {
    sepolia: { url: "https://relay-sepolia.flashbots.net", network: "sepolia" },
    mainnet: { url: "https://relay.flashbots.net", network: "mainnet" },
};

export async function getFlashbotsProvider(
    provider: providers.JsonRpcProvider,
    authSigner: Wallet
): Promise<FlashbotsBundleProvider> {
    const relay = FLASHBOTS_RELAYS[CONFIG.network];
    if (!relay) {
        throw new Error(`No Flashbots relay configured for network: ${CONFIG.network}. Supported: ${Object.keys(FLASHBOTS_RELAYS).join(", ")}`);
    }
    return await FlashbotsBundleProvider.create(
        provider,
        authSigner,
        relay.url,
        relay.network
    );
}
