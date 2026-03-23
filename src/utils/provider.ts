// src/utils/provider.ts
// Singleton provider factory -- caches providers per network key.
// Supports both HTTP (JsonRpcProvider) and WebSocket (WebSocketProvider) providers.
import { ethers, JsonRpcProvider, WebSocketProvider, Wallet } from 'ethers';
import { CONFIG } from '../config';

const httpProviders = new Map<string, JsonRpcProvider>();
const wsProviders = new Map<string, WebSocketProvider>();

/**
 * Get or create a cached HTTP JsonRpcProvider for the given network.
 * When called with an explicit rpcUrl (multi-chain path), uses that URL directly.
 * When called without rpcUrl (legacy path), falls back to CONFIG.rpc lookup.
 */
export function getProvider(network?: string, rpcUrl?: string): JsonRpcProvider {
    const key = network || CONFIG.network;
    let provider = httpProviders.get(key);
    if (!provider) {
        const url = rpcUrl || CONFIG.rpc[key as keyof typeof CONFIG.rpc];
        if (!url) {
            throw new Error(`No RPC URL configured for network: ${key}`);
        }
        provider = new ethers.JsonRpcProvider(url);
        httpProviders.set(key, provider);
    }
    return provider;
}

/**
 * Get or create a cached WebSocketProvider for the given network.
 * Returns null if wsUrl is null/empty (WebSocket not configured for this chain).
 */
export function getWsProvider(network: string, wsUrl: string | null, chainId?: number): WebSocketProvider | null {
    if (!wsUrl) return null;
    let provider = wsProviders.get(network);
    if (!provider) {
        provider = new ethers.WebSocketProvider(wsUrl, chainId);
        wsProviders.set(network, provider);
    }
    return provider;
}

/**
 * Destroy and remove a cached WebSocket provider (for cleanup/reconnect).
 */
export function removeWsProvider(network: string): void {
    const provider = wsProviders.get(network);
    if (provider) {
        provider.destroy();
        wsProviders.delete(network);
    }
}

/**
 * Get a Wallet connected to the HTTP provider for the given network.
 * When called with rpcUrl (multi-chain path), passes it through to getProvider.
 */
export function getWallet(network?: string, rpcUrl?: string): Wallet {
    return new ethers.Wallet(CONFIG.walletPrivateKey, getProvider(network, rpcUrl));
}
