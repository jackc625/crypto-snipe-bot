// test/unit/mevStrategies/flashbotsMultiBuilder.test.ts
// Phase 21.3 / Plan 21.3-00 (Wave-0 Nyquist stubs) — STOP-THE-LINE-05-A + -D.
//
// These are it.skip baselines: each title names the CONCRETE observable the
// implementation plan (21.3-01) must assert when it un-skips and fills them.
// No hollow expect(true) (D-04) — a .skip with a precise title is the Nyquist
// baseline that makes the verification map real before any production code ships.
//
// LANDMINE (KEY RESEARCH FINDING — assert the WIRE BODY, NOT a call count):
// the installed @flashbots/ethers-provider-bundle@1.0.0 SILENTLY DROPS the
// `builders` field, so multi-builder fanout is a RAW eth_sendBundle JSON-RPC call
// reusing signBundle + the X-Flashbots-Signature header. A test that mocks the
// library and asserts a call COUNT is BLIND to the dropped field — it would pass
// against the broken library path. The unit test MUST inspect the actual
// eth_sendBundle wire body (the JSON params) and assert `builders` is the
// non-empty MEV_BUILDERS array.
//
// CANONICAL REGRESSION: "a staticCall-valid buy that Flashbots won't include at
// calm gas now lands." That regression is realized by THIS multi-builder wire-body
// proof (builder coverage is the root cause, not underpricing) PLUS the fork
// wiring stub in test/fork/deliberateBuyReplay.fork.test.ts.

import { describe, it } from 'vitest';

describe('Phase 21.3 — multi-builder eth_sendBundle fanout (STOP-THE-LINE-05-A/-D) [Wave-0 Nyquist stub]', () => {
    it.skip('raw eth_sendBundle wire body carries a non-empty builders array = MEV_BUILDERS (NOT a call-count — blind to the library-drops-builders trap)');

    it.skip('the SAME signed-tx bytes are submitted to block+1 .. block+MEV_BUY_TARGET_BLOCKS (identical deterministic hash across N blocks; sign once)');

    it.skip('on a not-landed/included attempt logs op:flashbots.bundle.stats with consideredByBuilders/sealedByBuilders pubkeys + isSimulated from getBundleStatsV2, and NO FLASHBOTS_AUTH_KEY / no signed raw tx');
});
