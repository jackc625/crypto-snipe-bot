// src/utils/safetyProviders/goplus.ts
// GoPlus Security API adapter for multi-chain safety checks.
// Covers ALL four chains: ETH (1), BSC (56), Base (8453), Arbitrum (42161).
// API: GET https://api.gopluslabs.io/api/v1/token_security/{chain_id}?contract_addresses={address}
// No API key needed for basic use.

import axios from 'axios';
import { retry } from '../retry';
import { logger } from '../logger';
import type { ChainContext } from '../../chainRegistry';

const log = logger.child({ module: 'safety-goplus' });

const GOPLUS_BASE_URL = 'https://api.gopluslabs.io/api/v1';

export interface GoPlusTokenResult {
    is_honeypot?: string;          // '0' or '1'
    buy_tax?: string;              // percentage string
    sell_tax?: string;             // percentage string
    is_open_source?: string;       // '0' or '1'
    is_proxy?: string;             // '0' or '1'
    lp_holders?: Array<{
        address: string;
        is_locked: number;         // 0 or 1
        percent: number;
        locked_detail?: Array<{ end_time: string }>;
    }>;
}

async function fetchGoPlusTokenSecurity(chainId: number, tokenAddress: string): Promise<GoPlusTokenResult | null> {
    try {
        const { data } = await retry(() =>
            axios.get(`${GOPLUS_BASE_URL}/token_security/${chainId}`, {
                params: { contract_addresses: tokenAddress },
                timeout: 10000,
            })
        );

        if (data.code !== 1 || !data.result) {
            log.warn({ chainId, token: tokenAddress }, 'GoPlus returned no data');
            return null;
        }

        return data.result[tokenAddress.toLowerCase()] || null;
    } catch (err) {
        log.warn({ err, chainId, token: tokenAddress }, 'GoPlus API request failed');
        return null;
    }
}

export async function goplusHoneypotCheck(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    const result = await fetchGoPlusTokenSecurity(ctx.chain.chainId, tokenAddress);
    if (!result) return true; // default to blocking if API fails
    return result.is_honeypot === '1';
}

export async function goplusLiquidityLockCheck(ctx: ChainContext, pairAddress: string): Promise<boolean> {
    // GoPlus checks LP holder lock status
    const result = await fetchGoPlusTokenSecurity(ctx.chain.chainId, pairAddress);
    if (!result || !result.lp_holders) return false; // no lock info = not locked

    const now = Math.floor(Date.now() / 1000);
    return result.lp_holders.some(holder => {
        if (holder.is_locked !== 1) return false;
        // Check if lock is still active
        if (holder.locked_detail && holder.locked_detail.length > 0) {
            return holder.locked_detail.some(detail => parseInt(detail.end_time) > now);
        }
        return holder.is_locked === 1;
    });
}

export async function goplusTokenSecurity(ctx: ChainContext, tokenAddress: string): Promise<GoPlusTokenResult | null> {
    return fetchGoPlusTokenSecurity(ctx.chain.chainId, tokenAddress);
}
