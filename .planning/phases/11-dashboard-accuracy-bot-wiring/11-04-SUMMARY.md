---
phase: 11-dashboard-accuracy-bot-wiring
plan: 04
subsystem: testing
tags: [vitest, unit-tests, integration-tests, positions, chain-restart, telegram, websocket, live-prices]

# Dependency graph
requires:
  - phase: 11-dashboard-accuracy-bot-wiring
    plan: 01
    provides: buildPositionsWithLivePrices helper, startTelegramListener function, TelegramListenerHandle interface
  - phase: 11-dashboard-accuracy-bot-wiring
    plan: 02
    provides: Positions route wired to shared helper, chain restart with warnings, health telegram status, onRestart callback, WS push using shared helper
  - phase: 09-testing-infrastructure
    provides: vitest config with unit/integration projects, test fixtures
provides:
  - Unit tests for buildPositionsWithLivePrices (live price, stale fallback, P&L computation, filtering, parallel queries)
  - Unit tests for chain restart callback operations (WS reconnect, MEV health check, error collection)
  - Unit tests for startTelegramListener (env validation, connection failure, whitelist OR logic via event handler capture, multi-chain routing)
  - Integration tests for positions endpoint with priceStale and unrealizedPnl response fields
  - Integration tests for chain restart with warnings array (D-12)
  - Integration tests for health endpoint with telegramConnected/telegramError (D-19)
  - Integration test for WebSocket broadcast using shared buildPositionsWithLivePrices helper (DASH-01-e)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [class-based-mock-for-telegram-client, fake-timers-for-cooldown-bypass, vi-doMock-for-module-reset, fire-and-forget-catch-mock-restore]

key-files:
  created:
    - test/integration/api/wsPush.test.ts
  modified:
    - test/unit/positionsHelper.test.ts
    - test/unit/chainRestart.test.ts
    - test/unit/telegramListener.test.ts
    - test/integration/api/positions.test.ts
    - test/integration/api/chains.test.ts
    - test/integration/api/health.test.ts

key-decisions:
  - "Class-based mock for TelegramClient to survive vitest mockReset:true config (vi.fn().mockImplementation resets on each test)"
  - "Fake timers with 30s-apart base times per test to bypass telegramListener 5s cooldown without vi.resetModules()"
  - "Positions integration test now mocks buildPositionsWithLivePrices directly instead of db/exitEngine (route delegates entirely)"
  - "wsPush test uses vi.resetModules + vi.advanceTimersByTimeAsync to verify 5s broadcast interval calls shared helper"

patterns-established:
  - "Mock restore pattern: when vi.clearAllMocks wipes fire-and-forget mock (.mockResolvedValue), re-set in beforeEach"
  - "Unique addresses per telegram test: avoid module-level processedContracts Set dedup across tests"

requirements-completed: [DASH-01, DASH-03, FIX-09]

# Metrics
duration: 13min
completed: 2026-04-01
---

# Phase 11 Plan 04: Tests Summary

**Unit and integration tests for live-price positions helper, chain restart warnings, telegram whitelist enforcement, and WS broadcast verification**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-01T18:59:15Z
- **Completed:** 2026-04-01T19:12:28Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Replaced 3 Wave 0 stub files with full unit test implementations (19 tests total: 6 positions, 5 chain restart, 8 telegram)
- Updated 3 existing integration test files with new test cases for priceStale, unrealizedPnl, warnings array, and telegram status
- Created new wsPush integration test verifying WebSocket broadcast uses shared buildPositionsWithLivePrices helper
- Full test suite (225 tests) passes with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Unit tests for positions helper, chain restart, and telegram listener** - `a10773b` (test)
2. **Task 2: Update integration tests and add wsPush test** - `aa016e2` (test)

## Files Created/Modified
- `test/unit/positionsHelper.test.ts` - 6 unit tests: live price, stale fallback, P&L computation, closed trade filtering, no-context handling, parallel queries
- `test/unit/chainRestart.test.ts` - 5 unit tests: WS reconnect, MEV health check (healthy/unhealthy), full flow simulation, error collection
- `test/unit/telegramListener.test.ts` - 8 unit tests: missing env vars, connection failure, successful connect, whitelist rejection/OR-sender/OR-channel/empty via event handler capture, multi-chain routing with getCode
- `test/integration/api/positions.test.ts` - Rewrote to mock buildPositionsWithLivePrices; 5 tests covering priceStale, unrealizedPnl, stale price, empty positions, contexts passthrough
- `test/integration/api/chains.test.ts` - Added 3 restart tests: warnings from onRestart, empty warnings on success, no-callback warning
- `test/integration/api/health.test.ts` - Added 3 telegram tests: connected, not-configured, default when no getter
- `test/integration/api/wsPush.test.ts` - New file with 3 tests: broadcast calls shared helper, broadcasts positions data, skips when no clients

## Decisions Made
- Used class-based mock (real class in `vi.mock` factory) for TelegramClient instead of `vi.fn().mockImplementation` to survive vitest `mockReset: true` config that resets mock implementations between tests.
- Employed `vi.useFakeTimers({ now: baseTime })` with 30s-apart base times per test to bypass the telegramListener module-level 5-second cooldown (`lastProcessed`) without needing `vi.resetModules()` (which would break the top-level import pattern).
- Changed positions integration test from mocking db/exitEngine individually to mocking `buildPositionsWithLivePrices` directly, since the route now delegates entirely to the shared helper.
- wsPush test uses `vi.resetModules()` in beforeEach and `vi.advanceTimersByTimeAsync(5100)` to trigger the 5-second broadcast interval in server.ts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Class-based TelegramClient mock for mockReset compatibility**
- **Found during:** Task 1 (telegram listener tests)
- **Issue:** `vi.fn().mockImplementation(function(this) { ... })` pattern was reset by vitest's `mockReset: true` config, causing `client.connect()` to return undefined and enter the catch block
- **Fix:** Replaced with a real class `MockTelegramClient` in the mock factory whose methods delegate to module-level mock functions (not affected by mockReset)
- **Files modified:** test/unit/telegramListener.test.ts
- **Verification:** All 8 telegram tests pass
- **Committed in:** a10773b (Task 1 commit)

**2. [Rule 1 - Bug] Fake timers for telegram cooldown bypass**
- **Found during:** Task 1 (telegram listener tests)
- **Issue:** Module-level `lastProcessed` cooldown (5s) caused test interference -- subsequent tests' event handler calls were silently skipped
- **Fix:** Used `vi.useFakeTimers({ now: baseTime })` with unique base times 30s apart per test, plus unique contract addresses per test
- **Files modified:** test/unit/telegramListener.test.ts
- **Verification:** All whitelist and routing tests pass independently and together
- **Committed in:** a10773b (Task 1 commit)

**3. [Rule 1 - Bug] Restore handleAlphaDropForChain mock after clearAllMocks**
- **Found during:** Task 1 (telegram listener tests)
- **Issue:** `vi.clearAllMocks()` removed `mockResolvedValue(undefined)` from the alphaDrop mock, causing `.catch()` on undefined to throw TypeError
- **Fix:** Added `(handleAlphaDropForChain as any).mockResolvedValue(undefined)` to beforeEach
- **Files modified:** test/unit/telegramListener.test.ts
- **Verification:** Fire-and-forget `.catch()` in telegramListener source works correctly
- **Committed in:** a10773b (Task 1 commit)

**4. [Rule 3 - Blocking] handleUpgrade mock factory returns stable function**
- **Found during:** Task 2 (wsPush integration test)
- **Issue:** `vi.fn().mockReturnValue(() => {})` for handleUpgrade was reset by mockReset, causing `server.on('upgrade', undefined)` to throw ERR_INVALID_ARG_TYPE
- **Fix:** Changed mock to plain function `handleUpgrade: () => () => {}` (not a vi.fn, so not affected by mockReset)
- **Files modified:** test/integration/api/wsPush.test.ts
- **Verification:** All 3 wsPush tests pass
- **Committed in:** aa016e2 (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 blocking)
**Impact on plan:** All fixes were necessary to make tests work correctly with vitest's mockReset behavior. No scope creep.

## Issues Encountered
- vitest `mockReset: true` in vitest.config.ts resets all mock implementations between tests, requiring careful restoration of mock behaviors in beforeEach hooks. This is a project-wide pattern to be aware of when writing new test files.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all test files contain full implementations with real assertions.

## Next Phase Readiness
- All Phase 11 requirements (DASH-01, DASH-03, FIX-09) are now tested end-to-end
- 225 tests passing across unit, integration, and existing test suites
- Phase 11 is complete: foundation modules, backend wiring, UI updates, and tests all delivered

## Self-Check: PASSED
