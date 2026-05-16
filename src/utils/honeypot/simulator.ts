// src/utils/honeypot/simulator.ts
// Option-C (`eth_simulateV1`) Phase 18 STUB ONLY.
//
// Per CONTEXT.md canonical_refs line 281 ("stub/skeleton only") and
// Deferred Ideas line 421 ("Option C full implementation — v6.18+"),
// this file returns `verdict: 'unknown'` with a `NOT_IMPLEMENTED` reason.
// Activated only if a specific chain's Option D deploy path is genuinely
// blocked in a future milestone.
//
// Per D-UNKNOWN-POLICY this stub MUST return — never throw — so the
// dispatch layer handles uniformly (one-shot skip, no retry).

import type { ChainContext, DexConfig } from '../../chainRegistry';
import type { HoneypotResult } from './types';

export async function simulateViaSimulator(
    _ctx: ChainContext,
    _dex: DexConfig,
    _token: string,
): Promise<HoneypotResult> {
    return {
        verdict: 'unknown',
        reason: 'NOT_IMPLEMENTED: eth_simulateV1 path is stubbed in Phase 18',
        evidence: { method: 'eth_simulateV1' },
    };
}
