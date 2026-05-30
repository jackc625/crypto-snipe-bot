# Phase 20 — Deferred Items (out-of-scope discoveries)

Items found during plan execution that are NOT caused by the current plan's
changes. Logged per the executor scope-boundary rule; NOT fixed in-plan.

> **RESOLVED 2026-05-25 (user-approved at wave-0 gate):** All 12 pre-existing
> test failures below were fixed by restoring the missing `src/utils/db` mock
> exports — `forceWalCheckpoint: vi.fn()` in `pauseCli.test.ts`,
> `pauseFlow.test.ts`, `midRunWalletCheck.test.ts`; `getStaleTradesQuery: { all: dbAllMock }`
> in `staleData.test.ts`. Full suite now green (unit 57/57 files, integration
> 27/27 files). Test-only change; no production code touched. The sections below
> are retained as the historical diagnosis.

## 20-08 (CORS + dashboard-api-key gap closure)

### Pre-existing: `test/unit/preflight/staleData.test.ts` — 4 failing tests (db mock mismatch)

- **Found during:** 20-08 Task 2 regression sweep of `test/unit/preflight/`.
- **Symptom:** All 4 `checkStaleData` tests fail (`getStaleTradesQuery` is
  `undefined` → `.all()` throws `TypeError: Cannot read properties of undefined`).
- **Root cause:** The WR-06 refactor (shipped at/before commit `c2c724d`,
  Phase 20 Plan 20-02 area) changed `checkStaleData` in `src/preflight.ts:517`
  to use the cached prepared statement `getStaleTradesQuery.all(...)` imported
  from `src/utils/db`. The test's `vi.mock('../../../src/utils/db', ...)` block
  (staleData.test.ts:37-46) still only mocks `db.prepare(...).all` and
  `getAntirugDryRunStarted` — it does NOT export a mocked `getStaleTradesQuery`.
  So the import resolves to `undefined` and the call throws.
- **Verified pre-existing:** `git show c2c724d:src/preflight.ts` already uses
  `getStaleTradesQuery.all(...)`, and `git show c2c724d:test/.../staleData.test.ts`
  already lacks the `getStaleTradesQuery` mock. Predates all 20-08 changes.
- **Out of scope for 20-08:** 20-08 touches only `validateCrossEnvRules`
  (Rule 5) + `crossEnvRules.test.ts` + `src/api/server.ts` CORS. `checkStaleData`
  and its test are untouched by this plan.
- **Suggested fix (future):** add `getStaleTradesQuery: { all: dbAllMock }` to the
  `src/utils/db` mock in `staleData.test.ts` (replacing/augmenting the
  `db.prepare` shim), so the cached-statement path is exercised. Owner: whoever
  re-opens the OPS-LIVE-06 stale-data test (Plan 20-02 / 20-06 area).

## 20-09 (CLI dashboard URL derivation + clear connection errors)

### Pre-existing: `test/integration/pauseCli.test.ts` — 4 failing tests (db mock missing `forceWalCheckpoint`)

- **Found during:** 20-09 Task 2 verify run (`npx vitest run --project integration
  test/integration/pauseCli.test.ts`).
- **Symptom:** Tests 1, 2, 3, 5 (the `OPS-LIVE-11 CLI HTTP flow` block) fail with
  `expected 500 to be 200` on the `/api/controls/{pause,resume}` action POST;
  Test 5 additionally sees `broadcast` called 0 times.
- **Root cause:** The CR-04 WAL-fsync fix added `forceWalCheckpoint()` to BOTH
  `src/api/routes/controls.ts` POST `/pause` (line 254) and POST `/resume`
  (line 274), imported from `src/utils/db`. The test's
  `vi.mock('../../src/utils/db', ...)` block (pauseCli.test.ts:43-50) mocks
  `db`, `setPauseState`, `clearPauseState`, `getPauseState` but does NOT export
  a mocked `forceWalCheckpoint`. So the import resolves to `undefined`, calling
  it throws `TypeError`, the route's try/catch returns `res.status(500)`, and the
  throw happens BEFORE the `broadcast('pause_state_change', ...)` call → Test 5's
  broadcast never fires. Identical failure shape to the documented 20-08
  `staleData.test.ts` break (db mock missing a newly-added export).
- **Verified pre-existing:** `git show HEAD~1:src/api/routes/controls.ts` already
  imports + calls `forceWalCheckpoint()` at lines 254/274, and
  `git show HEAD~1:test/integration/pauseCli.test.ts` already lacks the
  `forceWalCheckpoint` mock export (db mock at lines 47-49 only). Predates all
  20-09 changes (commit `1182765` and the Task 2 edits).
- **Out of scope for 20-09:** 20-09 touches only `scripts/pause.ts`,
  `scripts/resume.ts` (CLI URL derivation + connection-error catch),
  `src/config.ts` (DASHBOARD_URL description string), and APPENDS a `20-09`
  static-grep describe block to `pauseCli.test.ts`. It does NOT modify
  `controls.ts`, the db mock, `forceWalCheckpoint`, or Tests 1–5. The 8 new
  20-09 grep tests (4 pause.ts + 4 resume.ts) all PASS.
- **Suggested fix (future):** add `forceWalCheckpoint: vi.fn()` to the
  `src/utils/db` mock in `pauseCli.test.ts:43-50`. Owner: whoever owns the CR-04
  WAL-fsync change / re-opens the OPS-LIVE-09 pause/resume HTTP-flow tests.

## Post-Wave-0 gate sweep (orchestrator) — 2026-05-25

The executors only ran their own scoped test files, so the full-suite run at the
wave-0 post-merge gate surfaced **two additional integration files** failing from
the SAME `forceWalCheckpoint` mock gap. Documented here for completeness.

**Full pre-existing failure inventory (12 tests) — none caused by gap plans 08/09/10:**

| Suite | File | Failed | Root cause |
|-------|------|--------|------------|
| unit | `test/unit/preflight/staleData.test.ts` | 4 | mock missing `getStaleTradesQuery` export |
| integration | `test/integration/pauseCli.test.ts` | 4 | mock missing `forceWalCheckpoint` export |
| integration | `test/integration/pauseFlow.test.ts` | 3 (Tests 5/6/8) | mock missing `forceWalCheckpoint` export |
| integration | `test/integration/midRunWalletCheck.test.ts` | 1 (undercut→pause path) | mock missing `forceWalCheckpoint` export |

- **Causation ruled out:** `git log c2c724d..HEAD` touches NONE of `src/api/routes/controls.ts`,
  `src/utils/db.ts`, `src/bot.ts`, `test/integration/pauseFlow.test.ts`, or
  `test/integration/midRunWalletCheck.test.ts`. These files are byte-identical to the
  pre-gap commit, so the gap-closure work cannot have introduced these failures.
- **Root cause confirmed by vitest:** `Error: [vitest] No "forceWalCheckpoint" export is
  defined on the "../../src/utils/db" mock.` → `controls.ts:254/274` calls it → throws →
  route returns 500 → `broadcast('pause_state_change', …)` never fires.
- **Gap work is clean:** tsc `--noEmit` clean ×3 (root + bot + dashboard); all gap-specific
  tests pass (crossEnvRules 10/10, pauseCli 20-09 grep block 8/8, pauseBanner 29/29).
- **Suggested fix (trivial, test-only):** add `forceWalCheckpoint: vi.fn()` to the
  `src/utils/db` mock in `pauseFlow.test.ts` + `midRunWalletCheck.test.ts`, and
  `getStaleTradesQuery: { all: vi.fn() }` to `staleData.test.ts`.
