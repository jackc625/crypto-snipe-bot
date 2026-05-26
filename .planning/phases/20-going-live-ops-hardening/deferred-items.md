# Phase 20 — Deferred Items (out-of-scope discoveries)

Items found during plan execution that are NOT caused by the current plan's
changes. Logged per the executor scope-boundary rule; NOT fixed in-plan.

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
