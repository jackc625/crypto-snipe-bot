// src/utils/honeypot/index.ts
// HONEY-05 dispatch entry point. Routes between Option-D (on-chain
// HoneypotChecker contract) and Option-C (`eth_simulateV1` stub) based
// on `ctx.chain.honeypotChecker.method`, AND between V2 / V3 paths
// based on `dex.dexType` per iter-2 Blocker #1.
//
// CRITICAL: NEVER throws on unknown method (D-UNKNOWN-POLICY one-shot
// skip — caller handles uniformly). All branches return HoneypotResult.

import type { ChainContext, DexConfig } from '../../chainRegistry';
import type { HoneypotCheckerConfig, HoneypotResult } from './types';
import { simulateViaContractV2, simulateViaContractV3 } from './checkerContract';
import { simulateViaSimulator } from './simulator';

// ---------------------------------------------------------------------------
// Module augmentation: extend ChainConfig with the `honeypotChecker` field.
//
// Plan 18-02 ships the types and dispatch wiring; plan 18-06 lands the
// chainRegistry.ts source-of-truth extension that promotes this field
// onto the real `ChainConfig` interface (with templates populating it
// per chain). Until then, declaration-merging the field here keeps tsc
// clean while preserving runtime correctness (any chain not yet wired
// up flows through the `bad-method` branch and returns `unknown`).
// ---------------------------------------------------------------------------
declare module '../../chainRegistry' {
    interface ChainConfig {
        honeypotChecker?: HoneypotCheckerConfig;
    }
}

const NULL_CFG: HoneypotCheckerConfig = {
    deployedAddress: null,
    method: 'on-chain-contract',
    maxBuyTaxBps: 0,
    maxSellTaxBps: 0,
};

/**
 * Pre-buy honeypot roundtrip dispatch. Routes on:
 *   - `ctx.chain.honeypotChecker.method`: 'on-chain-contract' | 'eth_simulateV1'
 *   - `dex.dexType`: 'v2' | 'v3'
 *
 * Returns a discriminated HoneypotResult. NEVER throws — bad methods
 * and missing config flow through `verdict: 'unknown'` per
 * D-UNKNOWN-POLICY (one-shot skip, no retry, no fallback).
 */
export async function simulateHoneypotRoundtrip(
    ctx: ChainContext,
    dex: DexConfig,
    token: string,
): Promise<HoneypotResult> {
    const cfg: HoneypotCheckerConfig = ctx.chain.honeypotChecker ?? NULL_CFG;

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
            return simulateViaContractV3(ctx, dex, token, cfg.deployedAddress);
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
