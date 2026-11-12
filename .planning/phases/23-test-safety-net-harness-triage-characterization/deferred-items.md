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

- Tests that cold-import `src/bot` (or `src/anti-rug/detector`) inside a test body run against testTimeout and slow 6 to 9x at the full run's peak
  status: open (mitigated per test)
  **Found by:** orchestrator, wave 6 gate (2026-11-12). The full parallel run took 192 s (136 s at the wave 5 gate), and six tests whose first test does `vi.resetModules()` then `await import('src/bot')` (or the detector) inside its body reached 51 to 71 percent of their limits. Three integration files started within 54 ms of each other and ended within about 120 ms, each paying the same cold module-graph compile at once: 1.1 to 1.8 s alone, 10.6 to 10.7 s under the run.
  **Mitigation (this commit):** the six measured tests got explicit limits with the measured times in a comment (45 s integration, 20 s unit), the per-test rule the phase uses (aeec076, 23-12, 23-13), not a project-wide change.
  **Still open:** the same pattern exists in other files that happened to run at a quieter moment: test/integration/anti-rug/botWiring.test.ts test/integration/anti-rug/multiSignalEnd2End.test.ts test/integration/anti-rug/wsReconnectBackfill.test.ts test/integration/killswitchCheckpoints.test.ts test/integration/midRunWalletCheck.test.ts test/integration/pauseFlow.test.ts test/integration/preflightInvocation.test.ts test/integration/v2HoneypotIntegration.test.ts test/integration/v3HoneypotIntegration.test.ts test/integration/v3LiquidityWait.test.ts test/unit/anti-rug/detectorEvaluator.test.ts test/unit/anti-rug/detectorRegistry.test.ts test/unit/anti-rug/dryRunTimestamp.test.ts test/unit/bot/buyNonceLock.test.ts test/unit/bot/deliberateBuyAffordability.test.ts test/unit/bot/deliberateBuyArmMonitoring.test.ts test/unit/bot/exitFailedHeldResume.test.ts test/unit/bot/noDoubleBuyReconcile.test.ts test/unit/bot/snipeFailClean.test.ts . A Phase 28 test-hygiene fix should remove the class at its root (for example a warm import in beforeAll, which runs against hookTimeout, or one shared import per file), not keep adding limits. Until then the orchestrator's wave gates list every test at or over half its real limit and act on it.
  **Update (plan 23-18, 2026-11-12):** test/integration/anti-rug/botWiring.test.ts now does its first `await import('src/bot')` in a file-level `beforeAll` (hookTimeout 10 s) and never calls `vi.resetModules()`, so it no longer has this pattern. Its slowest test in the 23-18 full run took 131 ms (Test 31, which opens a real temp SQLite file). The other files listed above are unchanged.

- `.planning/audit/tools/test-identity.ts` cannot honour a rename of a describe level
  status: open
  **Found by:** plan 23-18 (2026-11-12), converting test/integration/anti-rug/botWiring.test.ts.
  **What:** `compareFile` (test-identity.ts:212-221) matches a rails-test-edits.json `title_before` against the last title level only and keeps every describe level unchanged. A describe rename, such as botWiring's `Source-text wiring guards (Tests 22-26)`, which now names tests that read no source, would report every test under it as `missing`. 23-26 would then need an `AC-38 removed:` line for tests that were not removed.
  **What 23-18 did:** kept that describe title, with a comment in the test file saying why. No test title changed.
  **Why deferred:** test-identity.ts is a Phase 22 audit tool. Changing what it matches is outside a test-conversion plan and would need re_audit ledger rows. Plans 23-31, 23-30 and 23-19 hit the same limit if a describe title of theirs states "source-text". A later test-hygiene plan (Phase 28) can add full-path renames (for example a `title_path_before` field) and then rename that describe.

- `test/fixtures/api.fixtures.ts` fails a strict type check (TS2322 at line 12: `honeypotChecker` is optional in the fixture but required by `ChainConfig`)
  status: open
  **Found by:** plan 23-30 (2026-11-12), a strict scratch tsconfig over its three converted test files and scripts/red-proof-conversions.ts; those four files are clean, and the error comes from the fixture they import.
  **What:** no tsconfig compiles test/ (tsconfig.json and tsconfig.bot.json include src/**/* only), so this fixture's type error never surfaces in CI. Same class as AUD-TESTU-008 (unit type gates never run).
  **Why deferred:** the fixture is outside plan 23-30's files and changes no test result. A Phase 28 test-hygiene plan that adds a test tsconfig should fix it with the rest of that class.

- `test/realpath/triage/fixtures/AUD-API-002-restart.ts` is on the AC-37 source-text gate's allow list (it reads src/bot.ts by name)
  status: open (owner Phase 24)
  **Found by:** plan 23-19 (2026-11-12). The standing gate `test/unit/sourceTextGate.test.ts` scans every source file under test/ (operator ruling: helpers and fixtures too, not only `*.test.ts`), and this fixture's `onRestartSource()` (line 43) reads `src/bot.ts` to hash the private `onRestart` closure its mirror copies.
  **Ruling:** operator, before 23-19 was dispatched, chose "Allow-list it (Recommended)" (the "(Recommended)" label was the orchestrator's). The hash only pins the mirror to the real private closure, which Phase 23 cannot reach without booting the bot; the AUD-API-002 tests themselves assert behavior.
  **What Phase 24 must do:** the AUD-API-002 fix changes `onRestart`, so the fixture's hash check then fails by design ("onRestart changed"). Phase 24 replaces the mirror with the real path (the dashboard Start callback reached without a mirror) and removes the fixture's entry from `ALLOW_LIST` in `test/unit/sourceTextGate.test.ts` in the same change.

- `test/unit/mevStrategies/inclusionReconciliation.test.ts` fails a strict type check in three helper-logic tests it already had (TS2345: `affordableFeeInputs()` lacks the now-required `chainPriorityWei` of `computeAffordablePriorityFee`'s input)
  status: open
  **Found by:** plan 23-19 (2026-11-12), a strict scratch tsconfig over the files it converted. The same three errors are present in the file at HEAD before 23-19 (checked on a copy of the HEAD version); 23-19 changed none of those lines, and its own new code type-checks clean.
  **What:** no tsconfig compiles test/, so the error never surfaces (the AUD-TESTU-008 class). At run time the missing field is `undefined`, so these tests may exercise a different fee path than their names say; that is for the fixing plan to judge.
  **Why deferred:** outside 23-19's conversion scope (scope boundary rule). A Phase 28 test-hygiene plan that adds a test tsconfig should fix it with the rest of that class (see also the `test/fixtures/api.fixtures.ts` entry above).

- The harness launch helpers `fireNewPair` / `fireNewPool` (`test/realpath/harness/world.ts`, `signLaunch`) sign the deployer's launch by the chain profile (type 2 wherever the profile has a base fee), so a scenario on a legacy-fee node (`node.setFees({ legacy: true })`) cannot launch through them: the node refuses the launch as "transaction type not supported"
  status: open
  **Found by:** plan 23-22 (2026-11-12), the `fee-gas-eth-v2-legacy` scenario.
  **What:** `signLaunch` picks type 0 only when `CHAIN_NODE[chain].baseFeePerGas` is 0 (bsc), not from the node's own fee mode. 23-22 launched its legacy ETH pair with a file-local type-0 launch on the public FakeNode API (`fireLegacyPair` in `test/realpath/scenarios/riskAndFees.test.ts`: same deployer key, router call, reserves and PairCreated log), so no harness change was needed and no Harness Gap was raised (a fixture beside the test could supply it).
  **Why deferred:** the harness is read-only for scenario plans. A later harness owner can make `signLaunch` follow the node's fee mode and then drop the file-local launch; that would not change any recording (the launch transaction is foreign and is not on the timeline).
