# Phase 23 Deferred Items

## Deferred Items

- `test/unit/bot/buyNonceLock.test.ts` "exposes submitBuyTx (the nonce-locked buy-submit seam)" runs close to the unit project's 5 s default
  status: open
  **Found by:** plan 23-12, full railed npm test on Node 22 (2026-11-11).
  **What:** the test body is one `typeof` check; its time is the `beforeEach` cold import of `src/bot` through Vitest (`vi.resetModules()` then `await import('../../../src/bot')`). Measured 3.2 s in the full parallel run and 4.1 s in a two-file run (65 to 82 percent of 5 s). It passed both times.
  **Why deferred:** the cost is the import of src/bot, not anything plan 23-12 changed, so it is outside 23-12's scope (scope boundary rule). A later plan that sees it time out should give that file an explicit limit with the measured times, as 23-12 did for `test/unit/realpathMockGate.test.ts` and the AUD-EXIT-003 NaN test.
