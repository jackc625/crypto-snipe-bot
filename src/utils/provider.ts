// src/utils/provider.ts
// Singleton provider factory -- caches one JsonRpcProvider per network key.
import { ethers, JsonRpcProvider, Wallet } from 'ethers';
import { CONFIG } from '../config';

const providers = new Map<string, JsonRpcProvider>();

export function getProvider(network?: string): JsonRpcProvider {
    const net = network || CONFIG.network;
    let provider = providers.get(net);
    if (!provider) {
        const rpcUrl = CONFIG.rpc[net as keyof typeof CONFIG.rpc];
        if (!rpcUrl) {
            throw new Error(`No RPC URL configured for network: ${net}`);
        }
        provider = new ethers.JsonRpcProvider(rpcUrl);
        providers.set(net, provider);
    }
    return provider;
}

export function getWallet(network?: string): Wallet {
    return new ethers.Wallet(CONFIG.walletPrivateKey, getProvider(network));
}
