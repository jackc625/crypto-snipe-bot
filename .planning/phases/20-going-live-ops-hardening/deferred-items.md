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
