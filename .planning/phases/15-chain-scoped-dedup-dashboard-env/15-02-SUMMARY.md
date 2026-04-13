---
phase: 15-chain-scoped-dedup-dashboard-env
plan: 02
subsystem: config
tags: [env-validation, dashboard, fail-fast, startup, testing]

# Dependency graph
requires:
  - phase: 08-dashboard-web
    provides: "Dashboard API server with DASHBOARD_API_KEY login flow"
  - phase: 15-chain-scoped-dedup-dashboard-env (plan 01)
    provides: "Phase 15 context and chain-scoped dedup groundwork"
provides:
  - "DASHBOARD_API_KEY as a required env var with startup fail-fast validation"
  - "Unit tests proving fatal log payload names DASHBOARD_API_KEY (Codex MEDIUM)"
  - "auth.ts defense-in-depth branch documented with D-09 comment (Codex LOW)"
affects: [dashboard, deployment, env-setup]

# Tech tracking
tech-stack:
  added: []
  patterns: ["dotenv mock pattern for env-var-missing tests", "vi.mocked(logger).fatal handle for payload assertions"]

key-files:
  created: []
  modified:
    - src/config.ts
    - src/api/middleware/auth.ts
    - test/unit/configEnvVar.test.ts

key-decisions:
  - "Mock dotenv in configEnvVar tests to prevent .env file from re-injecting deleted env vars"
  - "Re-apply mockExit implementation in beforeEach to counter vitest mockReset: true config"
  - "Use vi.mocked(logger).fatal handle instead of vi.spyOn to avoid second spy layer on existing mock"

patterns-established:
  - "dotenv mock: vi.mock('dotenv', () => ({ config: vi.fn() })) for tests that delete required env vars"
  - "mockFatal payload assertion: expect.objectContaining({ missing: expect.arrayContaining([expect.stringContaining('VAR_NAME')]) })"

requirements-completed: [CHAIN-02]

# Metrics
duration: 7min
completed: 2026-04-13
---

# Phase 15 Plan 02: DASHBOARD_API_KEY Startup Validation Summary

**DASHBOARD_API_KEY added to REQUIRED_ENV_VARS with fail-fast startup validation and 3 unit tests proving fatal log names the missing variable (closes INT-DASHBOARD-API-KEY, Codex MEDIUM/LOW)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-13T02:12:50Z
- **Completed:** 2026-04-13T02:19:57Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- DASHBOARD_API_KEY declared as `required: true` in REQUIRED_ENV_VARS with exact D-07 description
- 3 new test cases: missing var exits with fatal payload naming DASHBOARD_API_KEY, present var succeeds, empty string exits -- all with explicit `mockFatal` payload assertions (closes Codex MEDIUM review concern)
- auth.ts defense-in-depth branch annotated with Phase 15 D-09 comment (closes Codex LOW review concern) -- executable code unchanged
- INT-DASHBOARD-API-KEY audit gap closed: bot now refuses to start with missing DASHBOARD_API_KEY instead of silently serving HTTP 500 on first login

## Task Commits

Each task was committed atomically:

1. **Task 1: Add DASHBOARD_API_KEY to REQUIRED_ENV_VARS, annotate auth.ts, update tests** - `63db18f` (feat)

**Plan metadata:** [pending] (docs: complete plan)

## Files Created/Modified

- `src/config.ts` - Added `DASHBOARD_API_KEY` entry to REQUIRED_ENV_VARS array with `required: true` and Dashboard section comment
- `src/api/middleware/auth.ts` - Added one comment line above the defense-in-depth `if (!expected)` branch explaining its rationale (executable code unchanged)
- `test/unit/configEnvVar.test.ts` - Added dotenv mock, logger import, mockFatal handle, DASHBOARD_API_KEY fixture entry, and 3 new test cases with payload assertions

## Key Changes

### src/config.ts diff (Edit 1)

New entry added after Telegram block, before Multi-Chain Configuration:

```typescript
// --- Dashboard ---
{ name: 'DASHBOARD_API_KEY', required: true, description: 'Dashboard login API key (required; dashboard server starts unconditionally)' },
```

### src/api/middleware/auth.ts diff (Edit 2)

Exactly one comment line added, zero executable lines modified:

```diff
+    // Defense-in-depth: startup validation (REQUIRED_ENV_VARS in config.ts) makes this branch unreachable in normal lifecycle, but it protects against test harnesses, hot-reload, and direct module imports where process.env.DASHBOARD_API_KEY can be mutated post-startup. See Phase 15 D-09.
     if (!expected) {
```

### test/unit/configEnvVar.test.ts changes (Edit 3)

- Added `vi.mock('dotenv', ...)` to prevent .env re-injection
- Added `import { logger }` resolving to mocked logger object
- Added `mockFatal = vi.mocked(logger).fatal` module-scope handle
- Added `DASHBOARD_API_KEY: 'test-dashboard-key'` to REQUIRED_ENV fixture
- Added `mockFatal.mockClear()` to beforeEach
- Added `mockExit.mockImplementation(...)` to beforeEach for vitest mockReset compatibility
- Added 3 new test cases in `DASHBOARD_API_KEY env var` describe block:
  1. `calls process.exit AND logs a fatal payload naming DASHBOARD_API_KEY when the var is unset` -- asserts mockExit(1) AND mockFatal payload contains 'DASHBOARD_API_KEY'
  2. `does not exit and does not log fatal when DASHBOARD_API_KEY is set to a non-empty string` -- asserts no exit, no fatal
  3. `calls process.exit AND logs a fatal payload naming DASHBOARD_API_KEY when the var is an empty string` -- asserts mockExit(1) AND mockFatal payload contains 'DASHBOARD_API_KEY'

## Decisions Made

- **Mock dotenv in tests:** The `.env` file on disk contains `DASHBOARD_API_KEY=password`. Without mocking dotenv, `delete process.env.DASHBOARD_API_KEY` is undone by `dotenv.config()` when config.ts re-imports, making the "missing var" test impossible. Added `vi.mock('dotenv', () => ({ config: vi.fn() }))` to give tests full control over env state.
- **Re-apply mockExit implementation in beforeEach:** The vitest config has `mockReset: true` which strips spy implementations before each test. The existing tests never relied on mockExit throwing (they only assert it was NOT called), but the new "missing var" tests need the throw to make the import reject. Added `mockExit.mockImplementation(...)` in beforeEach after the reset.
- **vi.mocked(logger).fatal over vi.spyOn:** Used `vi.mocked(logger).fatal` to capture the EXISTING mock function from the `vi.mock` block, not a new spy layer on top. This follows the plan's guidance and avoids breaking the mock-state model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added dotenv mock to prevent .env re-injection in missing-var tests**
- **Found during:** Task 1 (test execution)
- **Issue:** Tests deleting DASHBOARD_API_KEY from process.env had it re-injected by dotenv.config() inside src/config.ts reading the .env file on disk
- **Fix:** Added `vi.mock('dotenv', () => ({ config: vi.fn() }))` at the top of the test file
- **Files modified:** test/unit/configEnvVar.test.ts
- **Verification:** All 10 tests pass, including the "unset" test that now correctly triggers process.exit
- **Committed in:** 63db18f (Task 1 commit)

**2. [Rule 3 - Blocking] Re-applied mockExit implementation in beforeEach for vitest mockReset compatibility**
- **Found during:** Task 1 (test execution)
- **Issue:** vitest config `mockReset: true` strips the mockExit throwing implementation before each test. The "empty string" test called process.exit but got a different error message because the spy was no longer throwing.
- **Fix:** Added `mockExit.mockImplementation(...)` in beforeEach to re-apply the throw after vitest's automatic reset
- **Files modified:** test/unit/configEnvVar.test.ts
- **Verification:** All 10 tests pass, error messages match expected patterns
- **Committed in:** 63db18f (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes necessary for test correctness in the project's vitest configuration. No scope creep.

## Review Concerns Addressed

- **Codex MEDIUM** ("startup validation tests appear to rely on module import side effects" / "Add one assertion that the logged validation error names DASHBOARD_API_KEY"): Closed. Both failing-case tests assert `mockFatal` was called with `expect.objectContaining({ missing: expect.arrayContaining([expect.stringContaining('DASHBOARD_API_KEY')]) })`, proving the operator gets a diagnostic naming the specific missing variable.
- **Codex LOW** ("keeping the !expected branch is defensible, but it should be commented"): Closed. One-line comment added above the branch explaining its defense-in-depth rationale and tracing to Phase 15 D-09.

## Issues Encountered

None beyond the two auto-fixed blocking issues documented above.

## User Setup Required

None - no external service configuration required. Operators already need DASHBOARD_API_KEY in their .env; this change only makes the bot fail fast at startup if it is missing, instead of silently starting and returning HTTP 500.

## Test Results

- `npx tsc --noEmit`: exits 0
- `npx vitest run test/unit/configEnvVar.test.ts`: 10 tests passed (7 existing + 3 new)
- `npx vitest run test/unit/`: 154 tests passed (12 files, zero regressions)

## Next Phase Readiness

- Phase 15 is now complete (plan 01: chain-scoped dedup, plan 02: DASHBOARD_API_KEY validation)
- Both INT-DEDUP-NO-CHAIN and INT-DASHBOARD-API-KEY audit gaps are closed
- v6.16 milestone requirements satisfied

---
*Phase: 15-chain-scoped-dedup-dashboard-env*
*Completed: 2026-04-13*
