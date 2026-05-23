// src/utils/honeypot/index.ts
// HONEY-05 dispatch entry point. Routes between Option-D (on-chain
// HoneypotChecker contract) and Option-C (`eth_simulateV1` stub) based
// on `ctx.chain.honeypotChecker.method`, AND between V2 / V3 paths
// based on `dex.dexType` per iter-2 Blocker #1.
//
// CRITICAL: NEVER throws on unknown method (D-UNKNOWN-POLICY one-shot
// skip — caller handles uniformly). All branches return HoneypotResult.
//
// Plan 18-06 promoted `honeypotChecker` to a required field on the
// source-of-truth `ChainConfig` interface (src/chainRegistry.ts), so
// the declaration-merge augmentation that plan 18-02 used as a bridge
// is removed. Reading the field directly off `ctx.chain` is now
// type-safe and does not need a NULL_CFG fallback.
//
// Plan 18-09 extends the signature with an optional `feeTier` parameter
// for the V3 path (iter-2 Blocker #1). Plan 18-10 wires bot.ts:411-416
// to pass the V3 pool's feeTier through this dispatch into
// simulateViaContractV3; V2 callers omit the argument. Default 3000
// (0.3%, the most common V3 fee tier) preserves a sane fallback if a
// caller forgets to pass it, but in production the V3 handler ALWAYS
// supplies the runtime feeTier.

import type { ChainContext, DexConfig } from '../../chainRegistry';
import type { HoneypotCheckerConfig, HoneypotResult } from './types';
import { simulateViaContractV2, simulateViaContractV3 } from './checkerContract';
import { simulateViaSimulator } from './simulator';

/**
 * Pre-buy honeypot roundtrip dispatch. Routes on:
 *   - `ctx.chain.honeypotChecker.method`: 'on-chain-contract' | 'eth_simulateV1'
 *   - `dex.dexType`: 'v2' | 'v3'
 *
 * Returns a discriminated HoneypotResult. NEVER throws — bad methods
 * and missing config flow through `verdict: 'unknown'` per
 * D-UNKNOWN-POLICY (one-shot skip, no retry, no fallback).
 *
 * @param feeTier — V3-only runtime parameter (pool's fee tier from the
 *                  V3 pool-detection event). V2 dispatch ignores it.
 *                  Defaults to 3000 (0.3%) per iter-2 Blocker #1 spec
 *                  if the caller omits it.
 */
export async function simulateHoneypotRoundtrip(
    ctx: ChainContext,
    dex: DexConfig,
    token: string,
    feeTier?: number,
): Promise<HoneypotResult> {
    const cfg: HoneypotCheckerConfig = ctx.chain.honeypotChecker;

    if (cfg.method === 'on-chain-contract') {
        if (!cfg.deployedAddress) {
            return {
                verdict: 'unknown',
                reason: 'no-deployed-address',
                evidence: { method: 'on-chain-contract', dexType: dex.dexType },
            };
        }
        if (dex.dexType === 'v2') {
            return simulateViaContractV2(ctx, dex, token, cfg.deployedAddress);
        }
        if (dex.dexType === 'v3') {
            return simulateViaContractV3(ctx, dex, token, cfg.deployedAddress, feeTier ?? 3000);
        }
    }

    if (cfg.method === 'eth_simulateV1') {
        return simulateViaSimulator(ctx, dex, token);
    }

    return {
        verdict: 'unknown',
        reason: `bad-method:${String(cfg.method)}`,
        evidence: { method: cfg.method, dexType: dex.dexType },
    };
}
