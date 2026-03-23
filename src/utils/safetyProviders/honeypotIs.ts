// src/utils/safetyProviders/honeypotIs.ts
// honeypot.is API adapter for chain-aware honeypot detection.
// Supports: ETH (chainId 1), BSC (chainId 56), Base (chainId 8453).
// API: GET https://api.honeypot.is/v2/IsHoneypot?address={token}&chainID={chainId}

import axios from 'axios';
import { retry } from '../retry';
import { logger } from '../logger';
import type { ChainContext } from '../../chainRegistry';

const log = logger.child({ module: 'safety-honeypotIs' });

export async function honeypotIsCheck(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    try {
        const { data } = await retry(() =>
            axios.get('https://api.honeypot.is/v2/IsHoneypot', {
                params: {
                    address: tokenAddress,
                    chainID: ctx.chain.chainId,
                },
                timeout: 10000,
            })
        );

        if (data.honeypotResult) {
            return data.honeypotResult.isHoneypot === true;
        }

        // Fallback to v1 response format
        return data.isHoneypot === true;
    } catch (err) {
        ctx.log.warn({ err, token: tokenAddress, check: 'honeypot.is' }, 'honeypot.is API failed');
        return true; // default to blocking on API failure
    }
}
