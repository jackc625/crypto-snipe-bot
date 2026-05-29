// test/fork/deliberateBuyReplay.fork.test.ts
// Phase 21.3 / Plan 21.3-00 (Wave-0 Nyquist stub) — STOP-THE-LINE-05-B (wiring).
//
// This is an it.skip baseline: the title names the CONCRETE observable the
// implementation plan (21.3-04, the fork wiring proof) must assert when it
// un-skips and fills it. No hollow expect(true) (D-04).
//
// FORK HARNESS (mirrors realLaunchReplay.fork.test.ts / captureRehearsal.fork.test.ts):
// when filled, this test must run the chainId-1 tripwire setup —
// requireRealMainnetGate(provider) before any tx, sign with the FORK_ONLY_TEST_KEY
// (Hardhat account #0, fork-only, zero real ETH), NEVER process.env.PRIVATE_KEY
// (D-TEST-WALLET-FORKONLY) — and share the ONE Hardhat fork node via globalSetup.
//
// WHAT THE FORK CANNOT PROVE (D-EVIDENCE-BAR / D-EVIDENCE-BUY-INCLUSION): a local
// fork has NO Flashbots relay, so it CANNOT prove multi-builder fanout, the
// private->public transition, or LIVE calm-gas inclusion. The fork proves only
// the buy -> register -> monitor WIRING (the private leg falls back to public
// because there is no relay on the fork). Those live-inclusion claims close ONLY
// on the operator-gated 21-07 real-capital retry + the next-snipe
// flashbots_getBundleStatsV2 telemetry — NOT here.

import { describe, it } from 'vitest';

describe('Phase 21.3 — deliberate buy -> register -> monitor fork wiring (STOP-THE-LINE-05-B) [Wave-0 Nyquist stub]', () => {
    it.skip('deliberate buy -> register -> monitor end-to-end on a mainnet fork: private leg falls back to public (no relay on fork), public buy lands, trade row recorded, exit monitor armed');
});
