// Phase 20 / Plan 20-00 / OPS-LIVE-05 — Wave 0 test stub. Implementation lands in plan 20-02.
//
// Covers HoneypotChecker on-chain code presence. Phase 18 deployed an on-chain
// HoneypotChecker contract per chain (HONEY-03..06); preflight asserts that the
// deployedAddress resolved via chainRegistry actually has bytecode (not 0x).
//
// Observable assertions per D-04:
//   - pino fatal log { check: 'honeypot-checker-code', address, code: '0x' } + remediation
//     pointer string containing `docs/operations/going-live.md` (per D-ALERTS)
//   - process.exit(1) on FATAL
//   - null deployedAddress in chainRegistry (operator forgot env override + no template
//     default) treated identically as FATAL.
//
// Plan 20-02 will replace it.skip with it and import checkHoneypotCheckerCode from
// `../../../src/preflight`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('checkHoneypotCheckerCode', () => {
    beforeEach(() => {
        // Plan 20-02 will: reset httpProvider.getCode mock, reset pino spy.
    });

    afterEach(() => {
        // Plan 20-02 will: vi.restoreAllMocks().
    });

    it.skip('reason: pending impl in plan 20-02 — asserts pino fatal log { check: honeypot-checker-code, address: 0x..., code: 0x } + remediation pointer docs/operations/going-live.md + process.exit(1) when httpProvider.getCode(deployedAddress) returns 0x', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts PASS (passed: true, no fatal log) when httpProvider.getCode(deployedAddress) returns non-empty bytecode (e.g. 0x6080604052...)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts pino fatal log + process.exit(1) when chainRegistry resolves honeypotChecker.deployedAddress === null (env unset AND template default missing) — same FATAL shape as code===0x', () => {
        /* impl */
    });
});
