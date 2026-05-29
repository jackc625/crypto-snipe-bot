// test/unit/bot/noDoubleBuyReconcile.test.ts
// Phase 21.3 / Plan 21.3-00 (Wave-0 Nyquist stubs) — STOP-THE-LINE-05-C.
//
// These are it.skip baselines: each title names the CONCRETE observable the
// implementation plan (21.3-03) must assert when it un-skips and fills them.
// No hollow expect(true) (D-04).
//
// REAL-PATH / NO-PHANTOM DISCIPLINE (the CR-02 cardinal lesson, mirrored from
// test/unit/exitEngine/noDoubleSellReconcile.test.ts):
// CR-02 shipped on the SELL leg because a test mocked escalatePrivateSell +
// reconcileInclusion and asserted on the MOCKED return values, never on HASH
// EQUALITY between the pre-signed handle and the tx the strategy actually
// broadcast — so it could not see the guard reconciling a PHANTOM (never-
// broadcast) hash. The no-double-BUY guard MUST be tested on the REAL path:
// REAL escalatePrivateBuy -> REAL sendTxWithRetry -> REAL MevStrategy (which
// broadcasts and returns hash H via BroadcastHandle.signedTxHash) -> REAL
// submitWithReconciliation. Spy ONLY reconcileInclusion (to READ the probed hash
// and CONTROL the outcome) + the external boundaries (DB / notifier). Assert HASH
// EQUALITY: the hash the guard reconciles EQUALS the broadcast hash H — never a
// pre-signed phantom the private leg derived locally.

import { describe, it } from 'vitest';

describe('Phase 21.3 — no-double-buy guard (STOP-THE-LINE-05-C) [Wave-0 Nyquist stub]', () => {
    it.skip('REAL-PATH: the no-double-buy guard reconciles the hash the strategy ACTUALLY broadcast (BroadcastHandle.signedTxHash) — HASH EQUALITY, never a pre-signed phantom');

    it.skip('reconcile outcome included -> ABORT the public buy (private landed late), record the real hash');

    it.skip('reconcile outcome landed-not-ours / inconclusive -> FAIL-CLOSED, do NOT broadcast the public buy');

    it.skip('defense-in-depth: before the public buy, balanceOf(token)!=0 OR nonce-consumed -> ABORT (stricter than the sell guard)');
});
