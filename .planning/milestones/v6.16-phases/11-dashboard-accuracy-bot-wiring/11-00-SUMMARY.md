---
phase: 11-dashboard-accuracy-bot-wiring
plan: 00
subsystem: testing
tags: [vitest, unit-tests, stubs, wave-0]

# Dependency graph
requires: []
provides:
  - "Test stub scaffolds for positionsHelper, chainRestart, telegramListener"
  - "Wave 0 Nyquist-compliant test contract before implementation"
affects: [11-dashboard-accuracy-bot-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "it.todo() stubs for behavioral contract before implementation"

key-files:
  created:
    - test/unit/positionsHelper.test.ts
    - test/unit/chainRestart.test.ts
    - test/unit/telegramListener.test.ts
  modified: []

key-decisions:
  - "Pure it.todo stubs with no source imports -- modules do not exist yet"
  - "19 total todo markers covering all VALIDATION.md behaviors"

patterns-established:
  - "Wave 0 stub pattern: it.todo markers establish test contract before implementation begins"

requirements-completed: [DASH-01, DASH-03, FIX-09]

# Metrics
duration: 1min
completed: 2026-04-01
---

# Phase 11 Plan 00: Wave 0 Test Stubs Summary

**19 it.todo test stubs across 3 files establishing behavioral contracts for positions helper, chain restart, and telegram listener before implementation**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-01T18:33:44Z
- **Completed:** 2026-04-01T18:34:35Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- Created test stubs for buildPositionsWithLivePrices (6 todos) covering live price, stale fallback, PnL computation, parallel queries, and filtering
- Created test stubs for chain restart callback operations (5 todos) covering WS reconnect, MEV health, DEX listener starts, and warning collection
- Created test stubs for startTelegramListener (8 todos) covering env validation, connect failure, whitelist logic, and multi-chain routing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create unit test stubs for all three modules** - `3100bae` (test)

## Files Created/Modified
- `test/unit/positionsHelper.test.ts` - 6 it.todo stubs for buildPositionsWithLivePrices behaviors
- `test/unit/chainRestart.test.ts` - 5 it.todo stubs for chain restart callback operations
- `test/unit/telegramListener.test.ts` - 8 it.todo stubs for startTelegramListener behaviors

## Decisions Made
- Pure it.todo stubs with no source module imports -- the target modules (e.g., src/api/helpers/positions.ts) do not exist yet, so importing would cause compilation errors
- 19 total todo markers covering all behaviors from VALIDATION.md, ensuring Plan 04 has a complete test contract to fill in

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 stubs in place; Plans 01-04 can run vitest verification against these files (todos are skipped, not failures)
- Plan 04 will replace these stubs with full test implementations

## Self-Check: PASSED

- All 4 files verified present on disk
- Commit 3100bae verified in git log

---
*Phase: 11-dashboard-accuracy-bot-wiring*
*Completed: 2026-04-01*
