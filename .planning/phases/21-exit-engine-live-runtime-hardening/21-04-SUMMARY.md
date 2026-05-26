---
phase: 21-exit-engine-live-runtime-hardening
plan: 04
subsystem: testing
tags: [fork-test, vitest, hardhat, ethers, exit-engine, exit_state, persistence, restart, EXIT-LIVE-02, sqlite, better-sqlite3]

# Dependency graph
requires:
  - phase: 21-exit-engine-live-runtime-hardening (plan 02)
    provides: "test/fork/helpers/realMainnetGate.ts — requireRealMainnetGate() per-test decorator + FORK_ONLY_TEST_KEY fork-only signer"
  - phase: 21-exit-engine-live-runtime-hardening (plan 03)
    provides: "test/fork/realLaunchReplay.fork.test.ts — the proven DB-isolation (DB_PATH temp file) + buildForkChainContext (mevStrategy:passthrough) + hardhat_reset/interval-mine + BOBO settled-block fixture pattern this test reuses"
  - phase: 09-testing-infra
    provides: "test/fork/setup.ts globalSetup harness (one hardhat fork node on :8545, fileParallelism:false)"
provides:
  - "test/fork/exitStatePersistence.fork.test.ts: EXIT-LIVE-02 restart-persistence fork test — asserts exit_state strategy columns (high_water_mark, trailing_activated, partial_tiers_completed, volatility_samples) IDENTICAL pre/post an exit-monitor restart, read via the DB row (getExitState / exit_state), never a log line"
  - "Evidence that the v6.16 exit engine resumes a position with identical persisted strategy state across a restart — no lost high-water-mark, no re-armed trailing stop, no re-fired partial tiers (EXIT-LIVE-02 mechanism proven on the 31337 fork; no persistence bug surfaced)"
affects: [21-06, 21-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level restart simulation (Shape B): clearAllTimersForToken drops the in-memory poll interval + state object (process-death analog), then resumeExitMonitor reloads PURELY from the durable exit_state DB row — exercises the write-every-cycle + reload-from-DB persistence contract without an OS signal or loading the prod wallet key"
    - "Two-tier fork test: a deterministic engine-serialize round-trip (the robust gate) + a higher-fidelity real-poll-loop variant (real handler buy + whale pump drives high_water_mark/trailing through pollExitStrategy) — both assert the same DB-row equality across the restart boundary"
    - "Durable-row proof via a SEPARATE read-only better-sqlite3 connection (not the engine's writer singleton), so the assertion reads what is actually on disk"

key-files:
  created:
    - test/fork/exitStatePersistence.fork.test.ts
  modified: []

key-decisions:
  - "Restart SHAPE B (module-level clearAllTimersForToken + resumeExitMonitor) chosen over SHAPE A (spawn bot + OS SIGTERM): Shape A would load the prod PRIVATE_KEY at bot boot (violates D-TEST-WALLET-FORKONLY) AND Windows has no real catchable TERM signal (the dev host's gracefulShutdown WAL-flush would not run deterministically; child trees survive). Shape B exercises the identical persistence contract."
  - "Asserted columns: high_water_mark, trailing_activated, partial_tiers_completed (the real exit_state strategy-state columns — RESEARCH Pitfall 1: there is NO poll_position/cursor column; 'poll position' maps to these), plus volatility_samples, entry_price, original_token_amount."
  - "No hard/uncatchable kill used in either shape (acceptance forbids it — it races the WAL flush under synchronous=NORMAL)."
  - "Reused Plan 21-03's BOBO settled-block fixture for the real-poll-loop variant (an established, liquid, LP-burned ETH V2 token the REAL handler can buy), pumping >=2x then HOLDING (no price drop) so no exit fires and deletes the row before the snapshot."

patterns-established:
  - "Pattern 1: Restart-persistence fork test — establish non-default exit_state via the engine's OWN serialize+upsert (the exact poll-loop write), snapshot the durable row, drop the in-memory monitor, resumeExitMonitor-reload from DB, assert strategy columns byte-identical."
  - "Pattern 2: Pump-and-HOLD to keep a position open while asserting its persisted exit-strategy state (no downward tick => trailing/stop-loss never trigger => exit_state row survives for the snapshot)."

requirements-completed: [EXIT-LIVE-02]

# Metrics
duration: ~70min
completed: 2026-05-26
---

# Phase 21 Plan 04: EXIT-LIVE-02 exit_state Restart-Persistence Fork Test Summary

**A Vitest fork test proves the exit engine reloads IDENTICAL `exit_state` strategy columns (`high_water_mark`, `trailing_activated`, `partial_tiers_completed`, `volatility_samples`) across an exit-monitor restart — asserted on the durable DB row via `getExitState`, using a module-level `clearAllTimersForToken` + `resumeExitMonitor` restart (the documented Shape-B fallback) because Shape A would load the prod wallet key and Windows lacks a real TERM signal.**

## Performance

- **Duration:** ~70 min (incl. baseline + isolation + two full-suite fork runs, each spinning up a real Hardhat fork node)
- **Started:** 2026-05-26T~21:30Z
- **Completed:** 2026-05-26T~22:05Z
- **Tasks:** 1
- **Files modified:** 1 (created); 530 insertions, 0 deletions

## Accomplishments
- **EXIT-LIVE-02 restart-persistence fork test** (`test/fork/exitStatePersistence.fork.test.ts`, 2 tests) — both asserting the `exit_state` strategy-state columns are IDENTICAL before and after an exit-monitor restart, read from the DB row (D-OP-DB-TRUTH), never a log line.
  - **Test 1 (deterministic, the robust gate):** establishes non-default state (HWM advanced >2x entry, `trailing_activated=1`, tier `[0]` completed, real volatility samples) via the engine's OWN `serializeExitState` + `upsertExitState` (the exact write the poll loop makes at `exitEngine.ts:770/832/894`), snapshots the durable row through a separate read-only connection, drops the in-memory monitor (`registerExitMonitor` then `clearAllTimersForToken` — the process-death analog), reloads via `resumeExitMonitor` (the real `getExitState -> deserializeExitState` path), and asserts every strategy column identical + the `deserializeExitState` round-trip reproduces the values.
  - **Test 2 (higher fidelity, real poll loop):** a REAL `handleNewPairForChain` buy of the BOBO fixture token + a whale pump >=2x drives `high_water_mark`/`trailing_activated` through the engine's OWN `pollExitStrategy` cycles (persisted every tick), then the same module-level restart + `resumeExitMonitor` reload asserts the columns identical.
- **No persistence bug surfaced** — the exit_state columns are durably identical across the restart boundary in BOTH paths. No D-STOP-THE-LINE escalation for EXIT-LIVE-02.
- **Zero `src/` production code modified** (verified: the task commit touches only the test file; the exit-engine op/telemetry changes in `src/exitEngine.ts` were authored by Plans 21-01, not this plan).
- **Full fork suite stays green:** 6 files / 35 tests (baseline) -> **7 files / 37 tests, exit 0** with this file added.

## Task Commits

Each task was committed atomically:

1. **Task 1: exitStatePersistence.fork.test.ts (restart-persistence, identical exit_state columns)** - `74922a1` (test)

_Single test-only task; no TDD multi-commit split (this is an automated test addition, not behavior-adding source — D-STOP-THE-LINE forbids product-code changes here). The commit was amended once to fold in comment-only acceptance-grep rephrasings (see Deviations)._

**Plan metadata:** committed separately (this SUMMARY) — STATE.md/ROADMAP.md are owned by the orchestrator this run and are intentionally NOT touched here.

## Files Created/Modified
- `test/fork/exitStatePersistence.fork.test.ts` (created) — EXIT-LIVE-02 restart-persistence fork test (2 tests). Mirrors Plan 21-03's `realLaunchReplay` DB-isolation + ChainContext patterns; signs only with `FORK_ONLY_TEST_KEY`; gates with `requireRealMainnetGate`; isolates the DB to a temp `DB_PATH`.

## Restart Shape — Which Was Used and WHY (plan-required disclosure)

**SHAPE B (module-level): `clearAllTimersForToken` + `resumeExitMonitor`.** This is the plan's documented fallback (Open Question #4). SHAPE A (process-level: spawn the bot, deliver an OS TERM signal, restart) was **attempted-and-rejected** for two blocking reasons:

1. **Prod-key safety (D-TEST-WALLET-FORKONLY).** Booting `src/bot.ts` (`startMultiChainBot`) loads the production wallet key env var at module init (`src/utils/provider.ts:59`, `src/chainRegistry.ts:1067`). A test is forbidden from ever loading the prod key — so a real bot-process spawn cannot honor the fork-only-wallet rule.
2. **Windows has no real catchable TERM signal (dev-host harness note).** A graceful-term signal terminates abruptly on win32 and child trees survive (port-8545 leak), so the `gracefulShutdown -> closeDb()` WAL-flush the term path relies on does not run deterministically.

Shape B exercises the **same persistence contract** Shape A would: the engine's write-every-cycle `upsertExitState.run(serializeExitState(state))` followed by `resumeExitMonitor`'s reload via `getExitState.get(tradeId) -> deserializeExitState`. `clearInterval`/`clearAllTimersForToken` stands in for the process death (the in-memory `state` object is discarded; only the durable DB row survives). A hard/uncatchable kill is never used (acceptance forbids it — it races the WAL flush under `synchronous=NORMAL`).

## Columns Asserted (plan-required disclosure)

The persisted strategy-state columns of `exit_state` (`src/utils/db.ts:67-77`), via a read-only connection to the row `getExitState` reads:
- `high_water_mark` — identical (advanced above entry in both tests)
- `trailing_activated` — identical (=1 / armed in both tests)
- `partial_tiers_completed` — identical (`[0]` in Test 1)
- `volatility_samples` — identical (also part of the persisted strategy state)
- `entry_price`, `original_token_amount` — identical (the carried-forward non-strategy columns)

Per RESEARCH Pitfall 1: there is NO `poll_position`/`poll_count`/`cursor` column; "poll position" maps to these strategy-state columns (the poll loop re-derives everything else from the current price each cycle).

## Decisions Made
- Made **Test 1 the deterministic, must-pass gate** for the EXIT-LIVE-02 contract (no price/timing dependence), and **Test 2 the higher-fidelity variant** that establishes state through the genuine poll loop. Both assert the same DB-row equality, so the gate is robust even if the live buy/pump is environment-sensitive.
- Used a **separate read-only better-sqlite3 connection** for the assertion (not the engine writer singleton) to prove the row is durable on disk.
- **Pumped-and-HELD** (no price drop) in Test 2 so neither the trailing stop nor stop-loss fires (which would `deleteExitState`) before the pre-restart snapshot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug (test data)] Test 1's synthetic `trades.amount_in` used wei; corrected to native ETH units**
- **Found during:** Task 1 (first isolation run)
- **Issue:** Test 1 seeded a synthetic `trades` row (for the `exit_state` FK) with `amount_in = parseEther('0.05')` (wei). `getTotalExposure` (`src/utils/db.ts:389`) does `CAST(amount_in AS REAL)` and treats it as NATIVE ETH (the real buy path records `ctx.chain.snipeAmount = '0.05'`, native — `src/bot.ts:432`). The wei value (5e16) blew past the risk-gate exposure cap, so Test 2's REAL `handleNewPairForChain` buy was blocked at `canSnipe` ("Risk check failed") and produced no buy row -> Test 2 failed.
- **Diagnosis (not dismissed):** traced the fast failure to the risk-manager `exposure_cap` rule by reading the handler trail (`"Risk check failed"` in the run log) and `getTotalExposure`'s SQL. Confirmed it is a TEST-DATA defect, NOT a product bug and NOT an exit-state-persistence issue.
- **Fix:** Test 1's synthetic row now uses `amountIn: '0.05'` (native units) and `status: 'sold'` (a CLOSED position — zero open-count, zero exposure), so it never perturbs Test 2's risk gate. Added an explanatory comment.
- **Files modified:** test/fork/exitStatePersistence.fork.test.ts
- **Verification:** Re-ran isolation -> both tests pass (2/2, exit 0); full fork suite -> 7 files / 37 tests, exit 0.
- **Committed in:** `74922a1` (Task 1 commit)

**2. [Rule 1 - Acceptance-grep compliance] Removed literal `SIGKILL` / `process.env.PRIVATE_KEY` tokens from comments**
- **Found during:** Task 1 (acceptance-criteria grep check)
- **Issue:** The plan's acceptance criteria require `grep` to return 0 for `SIGKILL` and for `process.env.PRIVATE_KEY` ANYWHERE in the test. My documentation comments mentioned both literals (explaining what the test deliberately avoids), so the greps returned 3 each — non-executable, but failing the literal acceptance.
- **Fix:** Rephrased the comments to convey the same safety intent without the forbidden literal strings ("a hard/uncatchable kill"; "the production wallet key env var"). No code/logic change.
- **Files modified:** test/fork/exitStatePersistence.fork.test.ts
- **Verification:** `grep -c SIGKILL` = 0; `grep -c process.env.PRIVATE_KEY` = 0; `grep -c PRIVATE_KEY` = 0. Re-ran isolation -> 2/2 pass, exit 0. Typecheck clean.
- **Committed in:** `74922a1` (folded into the Task 1 commit via `--amend`)

---

**Total deviations:** 2 auto-fixed (1 test-data bug, 1 acceptance-grep compliance — both test-only).
**Impact on plan:** Both were necessary for a correct, acceptance-compliant test. No `src/` product code touched (D-STOP-THE-LINE honored). No scope creep.

## Issues Encountered
- **Background log noise (non-blocking):** during the full fork suite, the anti-rug detector emits `op:antirug.http-polling.error` lines (its HTTP `eth_getLogs` against Alchemy returns 400 during the BOBO replay window). This is pre-existing noise from Plan 21-03's `realLaunchReplay` file (the anti-rug poller running against the fork), unrelated to this plan; all 37 tests pass regardless. Not investigated further — it does not affect any test result and is out of this plan's scope.
- **Output-capture artifact:** piping `npm run test:fork` through `tee | grep` dropped the per-test `✓` lines from one captured stream; re-ran with a clean redirect to confirm both of this file's tests show `✓` and the suite totals 7/37 (exit 0). No impact on results.

## User Setup Required
None — no external service configuration required. The test signs with the fork-only Hardhat account #0 key (`FORK_ONLY_TEST_KEY`); the production wallet key is never loaded; `ALLOW_REAL_MAINNET` stays unset (the local fork reports chainId 31337 and passes the gate naturally).

## Threat Model Coverage
- **T-21-04-01** (signing with the prod wallet) -> mitigated: `requireRealMainnetGate(provider)` before any tx; only `FORK_ONLY_TEST_KEY` signs; `grep` confirms zero `PRIVATE_KEY` references; local fork = 31337.
- **T-21-04-02** (a flaky test that intermittently loses last-cycle state reported as a pass) -> mitigated: Shape B asserts the already-persisted every-cycle upsert; no hard kill (no WAL-flush race); the deterministic Test 1 is timing-independent; Test 2 pumps-and-holds so no exit fires before the snapshot.
- **T-21-04-03** (asserting persistence from a log line) -> mitigated: the assertion reads the `exit_state` DB row via a read-only connection (the same row `getExitState` reads), never the 'Resumed exit monitor from DB state' log.
- **T-21-04-SC** (package installs) -> mitigated: zero new packages (reused installed `ethers` 6.16, `hardhat` 2.26, `better-sqlite3` ^12.8, `vitest` ^4.1).

## Next Phase Readiness
- EXIT-LIVE-02 mechanism is proven on the fork. Per D-EVIDENCE-BAR, the deferred-item closure for the live-runtime items is the job of the live-capture + `v6.17-VERIFICATION-EVIDENCE.md` work (EXIT-LIVE-11) — EXIT-LIVE-02 is the automated-test requirement and is satisfied here; a fork pass is acceptable closure for -02 specifically (it is an automated SIGTERM/restart test, not one of the 6 live-mainnet-artifact items).
- No blockers introduced. No exit-state-persistence bug found (no phase-21.1 escalation from this plan). The separate V3-buy tax-gate bug found by Plan 21-03 (recorded in `21-STOP-THE-LINE-01-v3-buy-tax-gate.md`) is unrelated and untouched.

## Self-Check: PASSED

All claimed artifacts and commits verified on disk:
- FOUND: `test/fork/exitStatePersistence.fork.test.ts`
- FOUND commit `74922a1` (Task 1)
- VERIFIED: isolation run `npx vitest run --project fork test/fork/exitStatePersistence.fork.test.ts` -> 2/2 pass, exit 0
- VERIFIED: full `npm run test:fork` -> 7 files / 37 tests pass, exit 0 (baseline was 6/35)
- VERIFIED: `grep` SIGKILL = 0, process.env.PRIVATE_KEY = 0; getExitState/high_water_mark/trailing_activated/partial_tiers_completed/resumeExitMonitor/clearAllTimersForToken/FORK_ONLY_TEST_KEY/requireRealMainnetGate all present
- VERIFIED: `git show --name-only 74922a1` = test file only (zero `src/` production changes)
- VERIFIED: `tsc -p tsconfig.json` (src) exit 0; standalone strict typecheck of the test file exit 0

---
*Phase: 21-exit-engine-live-runtime-hardening*
*Completed: 2026-05-26*
