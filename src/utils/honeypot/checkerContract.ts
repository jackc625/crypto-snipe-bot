// src/utils/honeypot/checkerContract.ts
//
// NOT_IMPLEMENTED: checkerContract wave-5 deliverable
//
// PHASE 18 PLACEHOLDER — plan 18-09 OVERWRITES this file with the real
// Option-D wrapper implementations (V2 + V3, multi-amount probe, tax
// threshold enforcement). The literal sentinel comment above
// (`NOT_IMPLEMENTED: checkerContract wave-5 deliverable`) is REQUIRED:
// plan 18-09 Task 1 acceptance criterion grep-asserts the sentinel is
// ABSENT post-overwrite (iter-2 Warning #9 sentinel-grep gate).
//
// Both V2 and V3 placeholder exports exist so the dispatch layer
// (`src/utils/honeypot/index.ts`) can import them at compile time
// before plan 18-09 lands. Until then, they return `verdict: 'unknown'`
// with a `NOT_IMPLEMENTED` reason — never throw, per D-UNKNOWN-POLICY.

import type { ChainContext, DexConfig } from '../../chainRegistry';
import type { HoneypotResult } from './types';

/**
 * V2 Option-D wrapper placeholder. Plan 18-09 implements:
 *   provider.call → encodeFunctionData('checkV2', [...]) → parseError →
 *   discriminated verdict (multi-amount aggregation per HONEY-10).
 */
export async function simulateViaContractV2(
    _ctx: ChainContext,
    _dex: DexConfig,
    _token: string,
    _deployedAddress: string,
): Promise<HoneypotResult> {
    return {
        verdict: 'unknown',
        reason: 'NOT_IMPLEMENTED: checkerContract wave-5 deliverable',
        evidence: { method: 'on-chain-contract', dexType: 'v2' },
    };
}

/**
 * V3 Option-D wrapper placeholder (iter-2 Blocker #1). Plan 18-09 implements:
 *   provider.call → encodeFunctionData('checkV3', [swapRouter, quoter,
 *   token, amountIn, fee]) → parseError → discriminated verdict.
 */
export async function simulateViaContractV3(
    _ctx: ChainContext,
    _dex: DexConfig,
    _token: string,
    _deployedAddress: string,
): Promise<HoneypotResult> {
    return {
        verdict: 'unknown',
        reason: 'NOT_IMPLEMENTED: checkerContract wave-5 deliverable',
        evidence: { method: 'on-chain-contract', dexType: 'v3' },
    };
}
