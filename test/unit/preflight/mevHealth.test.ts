// Phase 20 / Plan 20-00 / OPS-LIVE-04 — Wave 0 test stub. Implementation lands in plan 20-02.
//
// Covers MEV strategy health checks per chain. Per-chain strategy from CHAIN_TEMPLATES:
//   - ETH → flashbots (relay.flashbots.net HEAD)
//   - BSC → bloXroute (bsc.blxrbdn.com HEAD with BLOXROUTE_AUTH_HEADER)
//   - Base → passthrough (no MEV relay; explicit { passed: true, reason: 'passthrough' })
//   - Arb → passthrough (no MEV relay; explicit { passed: true, reason: 'passthrough' })
//
// Observable assertions per D-04:
//   - pino fatal log { check: 'mev-health', strategy, endpoint } on HEAD-request failure
//   - process.exit(1) recorded on FATAL
//   - Passthrough chains return PreflightResult { passed: true, reason: 'passthrough' }
//     WITHOUT calling any healthCheck (verified via spy).
//
// Plan 20-02 will replace it.skip with it and import checkMevHealth from `../../../src/preflight`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('checkMevHealth', () => {
    beforeEach(() => {
        // Plan 20-02 will: reset createMevStrategy(chain).healthCheck spy, reset pino spy.
    });

    afterEach(() => {
        // Plan 20-02 will: vi.restoreAllMocks().
    });

    it.skip('reason: pending impl in plan 20-02 — asserts pino fatal log { check: mev-health, strategy: flashbots, endpoint: relay.flashbots.net } + process.exit(1) when Flashbots HEAD request fails on ETH', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts pino fatal log { check: mev-health, strategy: bloxroute, endpoint: bsc.blxrbdn.com } + process.exit(1) when bloXroute HEAD request fails on BSC', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts PASS (passed: true, reason: passthrough) for Base + Arb (no MEV relay) — verified by spy that healthCheck was NEVER invoked for these chains', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts PASS (passed: true, no fatal log) when createMevStrategy(eth).healthCheck() returns true', () => {
        /* impl */
    });
});
