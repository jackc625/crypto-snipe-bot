// Phase 20 / Plan 20-00 / OPS-LIVE-01 — Wave 0 test stub. Implementation lands in plan 20-02.
//
// Covers the wiring point at `startMultiChainBot` where preflight() MUST be invoked
// BETWEEN buildChainRegistry() and the chain-context creation loop. Per D-PREFLIGHT-FLOW
// (20-CONTEXT.md), preflight collects all per-chain failures and exits non-zero if any
// chain failed — the operator sees a full per-restart picture, not a "fix one, restart"
// treadmill.
//
// Observable assertions per D-04:
//   - vi.fn() preflight mock invoked exactly once between buildChainRegistry() and the
//     chain-context loop (call-order spy on both functions)
//   - vi.spyOn(process, 'exit') records a single call with arg `1` on FATAL
//   - PASS path → preflight returns, chain-context creation continues (subsequent
//     ChainContextManager.add(...) spy fires per ENABLED_CHAINS entry)
//
// Plan 20-02 will replace it.skip with it, vi.doMock '../../src/preflight' to capture
// the call, and dynamic-import `../../src/bot` to drive startMultiChainBot.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('preflight() invocation', () => {
    beforeEach(() => {
        // Plan 20-02 will: vi.doMock '../../src/preflight' (preflightMock = vi.fn()),
        // vi.doMock '../../src/utils/db' (no real I/O), spy buildChainRegistry,
        // spy ChainContextManager.add, vi.spyOn(process, 'exit').
    });

    afterEach(() => {
        // Plan 20-02 will: vi.restoreAllMocks() + vi.resetModules().
    });

    it.skip('reason: pending impl in plan 20-02 — asserts preflightMock invoked exactly once between buildChainRegistry() and the chain-context loop (call-order spy: buildChainRegistry.calls.length === 1 BEFORE preflightMock.calls.length === 1 BEFORE ChainContextManager.add)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts process.exit(1) called exactly once (recorded by vi.spyOn(process, exit)) when preflight() throws / returns FATAL — ChainContextManager.add NEVER invoked (chain-context loop never reached)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts preflight PASS path leads to chain-context creation continuing — ChainContextManager.add spy fires once per ENABLED_CHAINS entry; process.exit NOT called', () => {
        /* impl */
    });
});
