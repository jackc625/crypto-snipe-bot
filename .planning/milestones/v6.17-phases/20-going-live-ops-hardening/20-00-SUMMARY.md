---
phase: 20-going-live-ops-hardening
plan: 00
subsystem: testing
tags: [vitest, test-stubs, nyquist-baseline, wave-0, ops-live]

# Dependency graph
requires:
  - phase: 17-tech-debt
    provides: D-09 `.todo` ban CI guard + D-04 observable-effect rigor; both invariants preserved by this plan
  - phase: 18-honeypot-detection-rebuild
    provides: HoneypotChecker contract + chainRegistry.honeypotChecker.deployedAddress field used by `checkHoneypotCheckerCode` stubs
  - phase: 19-anti-rug-runtime-monitoring
    provides: `chain_state` table + anti-rug detector that records `antirug_dry_run_started`; the antiRugLiveGate stub asserts the 7-day floor against this column (added in Plan 20-03 schema v5→v6)
provides:
  - 14 Wave-0 vitest test-stub files (8 unit + 6 integration) covering OPS-LIVE-01..11 + schema v5→v6 migration
  - Concrete D-04 observable-effect contracts in `it.skip` reason strings — each names the pino field shape, process.exit code, SQLite row, broadcast event, or spy-call assertion the implementation plan will exercise
  - Nyquist validation baseline: vitest now discovers every OPS-LIVE-NN requirement as a skipped test, documented as a gap
  - Hand-off contract: Plans 20-02..05 flip `it.skip` → `it` and populate bodies; no scaffolding work needed
affects:
  - 20-02-preflight (implements walletBalance, rpcHealth, mevHealth, honeypotCheckerCode, crossEnvRules, staleData, antiRugLiveGate, preflightInvocation)
  - 20-03-schema-migration (implements pauseStateMigration v5→v6)
  - 20-04-killswitch-pause (implements killswitchCheckpoints, pauseFlow, midRunWalletCheck)
  - 20-05-cli-scripts (implements preflightCli, pauseCli)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 test stubs via `it.skip('reason: pending impl in plan 20-XX — asserts {observable}', () => { /* impl */ })`"
    - "D-04 observable-effect rigor: every `it.skip` reason string names a concrete observable (pino field, process.exit code, SQLite row, broadcast event, spy call) — no `expect(true).toBe(true)` hollow filler"
    - "Per-file header comment naming Phase / Plan / Requirement ID + implementation plan target — operator can grep `Plan 20-02 will` to find every stub the next plan must populate"

key-files:
  created:
    - "test/unit/preflight/walletBalance.test.ts (56 LOC, 6 it.skip — OPS-LIVE-02 startup)"
    - "test/unit/preflight/rpcHealth.test.ts (54 LOC, 4 it.skip — OPS-LIVE-03)"
    - "test/unit/preflight/mevHealth.test.ts (43 LOC, 4 it.skip — OPS-LIVE-04)"
    - "test/unit/preflight/honeypotCheckerCode.test.ts (39 LOC, 3 it.skip — OPS-LIVE-05)"
    - "test/unit/preflight/crossEnvRules.test.ts (61 LOC, 6 it.skip — OPS-LIVE-07)"
    - "test/unit/preflight/staleData.test.ts (45 LOC, 4 it.skip — OPS-LIVE-06)"
    - "test/unit/preflight/antiRugLiveGate.test.ts (55 LOC, 4 it.skip — OPS-LIVE-07 D-ANTIRUG-LIVE-GATE-CODE)"
    - "test/unit/db/pauseStateMigration.test.ts (58 LOC, 6 it.skip — schema v5→v6 D-PAUSE-STORAGE)"
    - "test/integration/preflightInvocation.test.ts (43 LOC, 3 it.skip — OPS-LIVE-01 wiring)"
    - "test/integration/killswitchCheckpoints.test.ts (84 LOC, 8 it.skip — OPS-LIVE-08 CP1/CP2/CP3 × V2/V3)"
    - "test/integration/pauseFlow.test.ts (63 LOC, 5 it.skip — OPS-LIVE-09 restart survival)"
    - "test/integration/preflightCli.test.ts (47 LOC, 4 it.skip — OPS-LIVE-10 npm run preflight)"
    - "test/integration/pauseCli.test.ts (50 LOC, 5 it.skip — OPS-LIVE-11 npm run pause/resume)"
    - "test/integration/midRunWalletCheck.test.ts (54 LOC, 4 it.skip — OPS-LIVE-02 mid-run path)"
  modified: []

key-decisions:
  - "Plan 20-00 produces test STUBS only — does NOT complete OPS-LIVE-01..11; those requirements remain Pending in REQUIREMENTS.md until Plans 20-02..05 land their implementations and flip skip→it"
  - "Per-file header comment names the target implementation plan (20-02 / 20-03 / 20-04 / 20-05) so the next-plan executor can grep `Plan 20-XX will` to enumerate every stub it must populate"
  - "killswitchCheckpoints.test.ts uses one `describe` block per checkpoint × dex-version (V2 CP1, V2 CP2, ..., V3 CP3, cross-cutting) instead of a single `describe` with 8 nested its — keeps the test-output tree readable when Plan 20-04 flips skip→it"
  - "midRunWalletCheck.test.ts T-20-04 idempotency assertion (no-duplicate-alert-when-already-paused) included in Wave-0 stubs even though the threat model registers it as `accept` for the stub plan — surfaces the mitigation requirement to Plan 20-04's executor"

patterns-established:
  - "Wave-0 stub-before-impl: ship test files with `it.skip` and concrete-observable reason strings BEFORE the source modules exist; vitest discovers them as documented gaps (extends Phase 17's D-04 rigor to a fresh plan-level workflow)"
  - "Reason-string contract: implementation plans treat the `it.skip` reason string as a binding contract for what assertion to write; no separate spec doc required"

requirements-completed: []  # Plan 20-00 ships stubs only; OPS-LIVE-01..11 close in implementation plans 20-02..05

# Metrics
duration: 10min
completed: 2026-05-24
---

# Phase 20 Plan 20-00: Wave-0 Test Stubs Summary

**14 vitest test stubs (37 unit + 29 integration = 66 `it.skip`) covering every OPS-LIVE-NN requirement with concrete D-04 observable contracts in the skip-reason strings — Nyquist validation baseline established before any preflight implementation lands.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-24T19:42:00Z
- **Completed:** 2026-05-24T19:52:14Z
- **Tasks:** 2
- **Files created:** 14
- **Total LOC added:** 752

## Accomplishments

- 8 unit-test stub files under `test/unit/preflight/` + `test/unit/db/` (37 `it.skip`) covering OPS-LIVE-02..07 startup-path checks + D-PAUSE-STORAGE schema migration
- 6 integration-test stub files under `test/integration/` (29 `it.skip`) covering OPS-LIVE-01 wiring point, OPS-LIVE-08 multi-stage kill-switch (CP1/CP2/CP3 × V2/V3 + 2 cross-cutting), OPS-LIVE-09 pause restart survival, OPS-LIVE-10/11 operator CLIs, OPS-LIVE-02 mid-run wallet undercut path
- D-09 `.todo` ban CI guard preserved: 0 `it.todo` / `test.todo` / `describe.todo` introduced
- D-04 observable-effect rigor preserved: 0 `expect(true).toBe(true)` hollow filler
- Full unit suite: 487 passed + 37 skipped (no regressions; +37 new skips matches Wave-0 stub count exactly)
- Full integration suite: 169 passed + 29 skipped (no regressions; +29 new skips matches Wave-0 stub count exactly)
- TSC clean across all 3 tsconfig projects (`tsconfig.json` + `tsconfig.bot.json` + `dashboard/tsconfig.json`)
- vitest discovers all 14 new files via existing `unit` + `integration` projects — zero `vitest.config.ts` changes

## Task Commits

Each task was committed atomically:

1. **Task 1: 8 unit-test stubs (OPS-LIVE-02..07 + schema v5→v6)** — `4327725` (test)
2. **Task 2: 6 integration-test stubs (OPS-LIVE-01/08/09/10/11 + mid-run wallet)** — `5a2a195` (test)

**Plan metadata:** `[final-commit-hash]` (docs: complete plan)

## Files Created/Modified

### Unit tests (Task 1 — commit `4327725`)

| File | LOC | it.skip | Coverage |
|------|-----|---------|----------|
| `test/unit/preflight/walletBalance.test.ts` | 56 | 6 | OPS-LIVE-02 startup; D-BALANCE-FLOOR (snipeAmount × maxOpenPositions + GAS_BUFFER); ethers.parseEther precision |
| `test/unit/preflight/rpcHealth.test.ts` | 54 | 4 | OPS-LIVE-03 chainId match + block-age tolerance (~5× block-time) |
| `test/unit/preflight/mevHealth.test.ts` | 43 | 4 | OPS-LIVE-04 Flashbots ETH / bloXroute BSC HEAD; Base + Arb passthrough skip |
| `test/unit/preflight/honeypotCheckerCode.test.ts` | 39 | 3 | OPS-LIVE-05 on-chain code presence; null deployedAddress FATAL |
| `test/unit/preflight/crossEnvRules.test.ts` | 61 | 6 | OPS-LIVE-07 cross-rule matrix (MEV / Telegram 5-tuple / per-chain RPC + checker) |
| `test/unit/preflight/staleData.test.ts` | 45 | 4 | OPS-LIVE-06 per D-STALE-THRESHOLDS (120s warn / 600s error) |
| `test/unit/preflight/antiRugLiveGate.test.ts` | 55 | 4 | OPS-LIVE-07 D-ANTIRUG-LIVE-GATE-CODE 7-day floor |
| `test/unit/db/pauseStateMigration.test.ts` | 58 | 6 | schema v5→v6 D-PAUSE-STORAGE pause_state + chain_state.antirug_dry_run_started ALTER |

### Integration tests (Task 2 — commit `5a2a195`)

| File | LOC | it.skip | Coverage |
|------|-----|---------|----------|
| `test/integration/preflightInvocation.test.ts` | 43 | 3 | OPS-LIVE-01 startMultiChainBot wiring — preflight() between buildChainRegistry + chain-context loop |
| `test/integration/killswitchCheckpoints.test.ts` | 84 | 8 | OPS-LIVE-08 — V2 × CP1/CP2/CP3 + V3 × CP1/CP2/CP3 + 2 cross-cutting (pause=0 baseline + mid-handler flip) |
| `test/integration/pauseFlow.test.ts` | 63 | 5 | OPS-LIVE-09 — SQLite persistence + restart-survival via tmp DB_PATH; D-PAUSED-RESTART boot-time pause invariant |
| `test/integration/preflightCli.test.ts` | 47 | 4 | OPS-LIVE-10 — `npm run preflight` exit codes (0/1/1) + no-bot-spawn invariant |
| `test/integration/pauseCli.test.ts` | 50 | 5 | OPS-LIVE-11 — `npm run pause`/`resume` CLIs; DASHBOARD_API_KEY auth gate; broadcast WS event |
| `test/integration/midRunWalletCheck.test.ts` | 54 | 4 | OPS-LIVE-02 mid-run path; T-20-04 idempotency mitigation (no duplicate alerts when already paused) |

**Totals:** 14 files / 752 LOC / 66 `it.skip` blocks.

## Sample of D-04 Observable-Noun Discipline (3 example skip-reason strings)

These demonstrate the binding contract Plan 20-02..05 must populate:

1. **`walletBalance.test.ts:37`** —
   > `'reason: pending impl in plan 20-02 — asserts pino fatal log fields { check: wallet-balance, passed: false, reason: wallet balance below floor: ... } + process.exit(1) when balance < floor (eth 0.001 < 0.008 ETH)'`
   > Concrete observables: (a) pino fatal log payload shape, (b) `process.exit(1)` spy assertion.

2. **`killswitchCheckpoints.test.ts:CP3 V3`** —
   > `'reason: pending impl in plan 20-04 — asserts pino info { op: killswitch.cp3, token, tradeId, feeTier: 3000, reason: global-pause-after-submit } + insertTrade.run STILL called + startExitMonitor STILL called for V3 path when pause flipped between MEV-submit and trade-record'`
   > Concrete observables: (a) pino info payload with `feeTier`, (b) `insertTrade.run` spy STILL invoked, (c) `startExitMonitor` spy STILL invoked.

3. **`midRunWalletCheck.test.ts:T-20-04`** —
   > `'reason: pending impl in plan 20-04 — asserts idempotent re-fire (T-20-04 mitigation): when mid-run check fires a SECOND time while pause_state.paused=1 already, broadcast NOT called again AND sendCtxAlert NOT called again — single alert per pause cycle, not flood'`
   > Concrete observables: (a) broadcast spy `.calls.length === 1` not 2, (b) sendCtxAlert spy `.calls.length === 1` not 2.

## Decisions Made

- **Plan 20-00 = stubs only, not implementation:** the 14 files document the test contract for Plans 20-02..05; OPS-LIVE-01..11 stay Pending in REQUIREMENTS.md. The plan's `requirements` frontmatter field lists them as "tests for these requirements ship in this plan" — not "these requirements close here". REQUIREMENTS.md rows update when implementation plans land. (No `requirements mark-complete` call from this plan.)
- **Per-file header comment names target implementation plan:** every stub file's top-of-file comment names the plan number (20-02 / 20-03 / 20-04 / 20-05) that will flip skip→it. Implementation-plan executors `grep "Plan 20-02 will"` to enumerate every stub their plan must populate. Eliminates the per-stub spec doc that an alternative organization would require.
- **killswitchCheckpoints uses one describe-block per CP × dex-version (8 describes / 1 it each):** alternative was a single `describe('killswitch')` with 8 nested its. The chosen shape keeps the vitest output tree readable per-CP — when Plan 20-04 flips skip→it, the operator can read "V2 CP1: passing | V2 CP2: failing because getAmountsOut spy never called" instead of one wall of test names.
- **midRunWalletCheck T-20-04 idempotency assertion included even though threat model registers T-20-04 as `accept` for the stub plan:** surfaces the idempotency requirement to Plan 20-04's executor. Threat model `accept` disposition was about the STUB plan introducing no idempotency code; the IMPL plan (20-04) must implement the mitigation — the stub establishes the test contract for it.

## Deviations from Plan

None — plan executed exactly as written.

Both tasks followed the per-file specification in `<action>` sections verbatim. All acceptance criteria verified pre-commit. No deviation rules triggered (no auto-fix bugs, no missing critical functionality, no architectural changes).

The plan-level verification (all 14 files present + full unit + integration suites green + tsc x 3 clean) passed without iteration.

## Issues Encountered

- **vitest `--reporter=basic` not supported in v4.1.1:** the plan's `<verify>` block suggested `--reporter=verbose 2>&1 | grep -E "(skipped|passed)"`. Used default reporter instead (which already prints `Test Files X skipped` + `Tests X skipped` summary lines). No deviation impact — verification still confirms discovery.
- **`grep -c "it\.skip"` returns 1 extra hit per file** because each stub file's header comment block names the pattern in its docstring (e.g., walletBalance.test.ts:18 — `// (a) replace it.skip(...) with it(...)`). Comment-mention is intentional (operator hand-off doc) and not an actual test. Verified with line-by-line read; actual `it.skip(` invocation count matches per-file spec exactly (walletBalance: 6, rpcHealth: 4, mevHealth: 4, honeypotCheckerCode: 3, crossEnvRules: 6, staleData: 4, antiRugLiveGate: 4, pauseStateMigration: 6).

## Self-Check: PASSED

**Files verified to exist:**
- All 14 listed `test/**/*.test.ts` paths checked via `[ -f $f ]`; every file FOUND. (See plan-level verification output above.)

**Commits verified in git log:**
- `4327725` (Task 1): FOUND via `git log --oneline --all | grep -q 4327725`
- `5a2a195` (Task 2): FOUND via `git log --oneline --all | grep -q 5a2a195`

**Plan-level checks:**
- 14 file existence: PASSED
- Full unit suite no regressions: PASSED (487 passed + 37 skipped; 0 failures)
- Full integration suite no regressions: PASSED (169 passed + 29 skipped; 0 failures)
- TSC clean across all 3 tsconfig projects: PASSED
- `.todo` ban CI guard still passes: PASSED (0 matches across `test/`)
- `expect(true).toBe(true)` count: 0 across all 14 new files

## User Setup Required

None — no external service configuration required.

## Hand-off Note to Plans 20-02..05

To populate any stub:

1. `grep -l "Plan 20-02 will" test/unit/preflight/ test/integration/` lists every file the named plan owns
2. Flip `it.skip(...)` → `it(...)` for each stub the plan's `<action>` implements
3. Replace `() => { /* impl */ }` body with the assertion described in the `it.skip` reason string — the reason string is a binding contract; no spec doc to consult
4. The per-file `beforeEach` / `afterEach` blocks already comment what mocks need wiring (e.g., `// Plan 20-02 will: reset httpProvider.getNetwork mock, reset pino spy.`); follow those prompts

**Plan ownership map** (which implementation plan populates which stub file):

| File | Owner Plan |
|------|-----------|
| `test/unit/preflight/walletBalance.test.ts` | 20-02 (preflight module) |
| `test/unit/preflight/rpcHealth.test.ts` | 20-02 |
| `test/unit/preflight/mevHealth.test.ts` | 20-02 |
| `test/unit/preflight/honeypotCheckerCode.test.ts` | 20-02 |
| `test/unit/preflight/crossEnvRules.test.ts` | 20-02 |
| `test/unit/preflight/staleData.test.ts` | 20-02 |
| `test/unit/preflight/antiRugLiveGate.test.ts` | 20-02 |
| `test/unit/db/pauseStateMigration.test.ts` | 20-03 (schema v5→v6 migration) |
| `test/integration/preflightInvocation.test.ts` | 20-02 (preflight wiring at startMultiChainBot) |
| `test/integration/killswitchCheckpoints.test.ts` | 20-04 (kill-switch CP1/CP2/CP3) |
| `test/integration/pauseFlow.test.ts` | 20-04 |
| `test/integration/preflightCli.test.ts` | 20-05 (operator CLIs) |
| `test/integration/pauseCli.test.ts` | 20-05 |
| `test/integration/midRunWalletCheck.test.ts` | 20-04 (mid-run undercut wiring) |

## Next Phase Readiness

- Wave-0 test baseline locked. Plan 20-01 (REQUIREMENTS.md row refinements per D-BALANCE-FLOOR + D-STALE-THRESHOLDS) can proceed in parallel.
- Plans 20-02 through 20-05 can each pick up their stub files (per ownership map above) and begin TDD-style flip-to-active.
- No blockers introduced. Phase 20 plan set (8 plans / 6 waves) unblocked through Wave 0 completion.

---
*Phase: 20-going-live-ops-hardening*
*Completed: 2026-05-24*
