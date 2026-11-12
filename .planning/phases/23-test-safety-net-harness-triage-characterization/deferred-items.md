# Phase 23 Deferred Items

## Deferred Items

- `test/unit/bot/buyNonceLock.test.ts` "exposes submitBuyTx (the nonce-locked buy-submit seam)" runs close to the unit project's 5 s default
  status: closed, no change needed (orchestrator, 2026-11-11, after 23-12)
  **Found by:** plan 23-12, full railed npm test on Node 22 (2026-11-11).
  **What:** the test body is one `typeof` check; its time is the `beforeEach` cold import of `src/bot` through Vitest (`vi.resetModules()` then `await import('../../../src/bot')`). Measured 3.2 s in the full parallel run and 4.1 s in a two-file run (65 to 82 percent of 5 s). It passed both times.
  **Why deferred:** the cost is the import of src/bot, not anything plan 23-12 changed, so it is outside 23-12's scope (scope boundary rule). A later plan that sees it time out should give that file an explicit limit with the measured times, as 23-12 did for `test/unit/realpathMockGate.test.ts` and the AUD-EXIT-003 NaN test.
  **Resolution:** the 3.2 to 4.1 s is spent inside `beforeEach`, and Vitest times a hook against `hookTimeout`, not `testTimeout`. `vitest.config.ts` sets only `testTimeout` (unit 5000), so `hookTimeout` takes Vitest 4.1.1's default of 10 s (`resolved.hookTimeout ??= resolved.browser.enabled ? 3e4 : 1e4` in node_modules/vitest/dist/chunks/coverage.CJ2HXVIG.js:516; hooks run under `withTimeout(..., runner.config.hookTimeout)` in node_modules/@vitest/runner/dist/chunk-artifact.js). Against its real limit the import is 32 to 41 percent, under the half-limit rule, and the test body itself is one `typeof` check. The 65 to 82 percent figure compared hook time with the test limit. No explicit limit added. Re-open only if a full run reports "Hook timed out" for this file, or if the import alone passes 5 s.

- `.planning/audit/AUDIT-FINDINGS.md` does not show any Phase 23 triage record
  status: open
  **Found by:** plan 23-16 Task 3 (2026-11-12), re-rendering after the TRIAGE-REVIEW-01 register changes.
  **What:** `.planning/audit/tools/render.ts` never reads a finding's `triage` block (the file has no reference to `triage`), so the outcome, `ruling_ref`, `fork_ref`, `proven_claims` and `open_claims` of every population entry are absent from AUDIT-FINDINGS.md, and the review records under `.planning/audit/reviews/` are not rendered either. The re-render after 23-16's register changes was byte-identical to the committed file. The JSON register and `check.ts --stage triage` remain the source of truth; the human-readable render lags them.
  **Why deferred:** render.ts is a Phase 22 tool (last changed in 239d812) and also renders OPERATOR-DECISIONS.md, whose hash is still the Phase 22 seal's `render_sha256.decisions`; changing what it renders is outside plan 23-16 (record the operator's rulings), and nothing a gate checks depends on it. A later plan (Phase 24 planning, or Phase 28 test hygiene) should add a triage column or section and the review records to the render.
