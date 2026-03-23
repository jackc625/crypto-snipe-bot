// src/utils/safetyProviders/unicrypt.ts
// Unicrypt liquidity lock checker for ETH.
// API: GET https://api.unicrypt.network/api/v2/locker/pair/{pairAddress}?chainId={chainId}
// Falls back to on-chain burn check if API is unavailable.

import axios from 'axios';
import { Contract } from 'ethers';
import { retry } from '../retry';
import { logger } from '../logger';
import { PAIR_ABI } from '../abis';
import type { ChainContext } from '../../chainRegistry';

const log = logger.child({ module: 'safety-unicrypt' });
const UNICRYPT_API = 'https://api.unicrypt.network/api/v2/locker/pair/';

export async function unicryptLockCheck(ctx: ChainContext, pairAddress: string): Promise<boolean> {
    try {
        const { data } = await retry(() =>
            axios.get(`${UNICRYPT_API}${pairAddress}?chainId=${ctx.chain.chainId}`)
        );
        const locks = data.locks;

        if (!locks || locks.length === 0) {
            ctx.log.warn({ pair: pairAddress, check: 'unicrypt' }, 'No liquidity lock found');
            return false;
        }

        const now = Date.now() / 1000;
        return locks.some((lock: any) => lock.unlock_date > now);
    } catch (e) {
        ctx.log.warn({ pair: pairAddress, check: 'unicrypt', fallback: 'burnCheck' }, 'Unicrypt API failed, falling back to burn check');
        return await fallbackCheckBurned(ctx, pairAddress);
    }
}

async function fallbackCheckBurned(ctx: ChainContext, pairAddress: string): Promise<boolean> {
    try {
        const pair = new Contract(pairAddress, PAIR_ABI, ctx.httpProvider);
        const burned = await pair.balanceOf('0x000000000000000000000000000000000000dEaD');
        const total = await pair.totalSupply();
        const percentBurned = Number(burned) / Number(total);

        if (percentBurned > 0.9) {
            ctx.log.info({ pair: pairAddress, percentBurned: (percentBurned * 100).toFixed(1) }, 'LP appears burned');
            return true;
        }
        return false;
    } catch (e) {
        ctx.log.warn({ err: e, check: 'burnFallback' }, 'Burn fallback failed');
        return false;
    }
}
