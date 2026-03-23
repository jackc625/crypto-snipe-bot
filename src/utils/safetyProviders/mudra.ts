// src/utils/safetyProviders/mudra.ts
// Mudra Locker checker for BSC liquidity locks.
// API: GET https://api.mudra.website/api/v1/locker/pair/{pairAddress}
// Falls back to GoPlus liquidity lock check if Mudra API is unavailable.

import axios from 'axios';
import { retry } from '../retry';
import { logger } from '../logger';
import type { ChainContext } from '../../chainRegistry';

const log = logger.child({ module: 'safety-mudra' });

export async function mudraLockCheck(ctx: ChainContext, pairAddress: string): Promise<boolean> {
    try {
        const { data } = await retry(() =>
            axios.get(`https://api.mudra.website/api/v1/locker/pair/${pairAddress}`, {
                timeout: 10000,
            })
        );

        if (!data || !data.data || !data.data.locks || data.data.locks.length === 0) {
            ctx.log.warn({ pair: pairAddress, check: 'mudra' }, 'No Mudra lock found');
            return false;
        }

        const now = Math.floor(Date.now() / 1000);
        return data.data.locks.some((lock: any) => lock.unlockDate > now);
    } catch (e) {
        ctx.log.warn({ err: e, pair: pairAddress, check: 'mudra' }, 'Mudra API failed');
        // Fallback to GoPlus for BSC liquidity lock check
        try {
            const { goplusLiquidityLockCheck } = await import('./goplus');
            return await goplusLiquidityLockCheck(ctx, pairAddress);
        } catch (fallbackErr) {
            ctx.log.warn({ err: fallbackErr, pair: pairAddress, check: 'mudra-fallback' }, 'GoPlus fallback also failed');
            return false;
        }
    }
}
