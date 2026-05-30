---
phase: 07-smart-exit-strategies
plan: 03
subsystem: trading
tags: [exit-engine, bot-integration, monitor-consolidation, position-management]

# Dependency graph
requires:
  - phase: 07-smart-exit-strategies (plan 01)
    provides: exitEngine.ts with startExitMonitor/resumeExitMonitor and exit_state DB schema
  - phase: 07-smart-exit-strategies (plan 02)
    provides: poll loop with trailing stops, partial sells, volatility adaptation, urgency
provides:
  - Unified exit engine wired into all 4 handler entry points in bot.ts
  - Legacy monitor functions eliminated (~490 lines removed per D-22)
  - Token balance capture after buy TX for partial sell calculations
  - Trade ID lookup for exit_state linkage
affects: [future-phases, dashboard, testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single exit engine call replaces 3 separate monitor registrations"
    - "Legacy ChainContext construction for backward-compat single-chain path"

key-files:
  created: []
  modified:
    - src/bot.ts

key-decisions:
  - "Used CONFIG.network for legacy handleNewPair trade ID lookup (matches existing insertTrade chain field)"
  - "Legacy single-chain resumeMonitoring builds full ChainContext inline for resumeExitMonitor compatibility"
  - "Kept maybeApprove/maybeApproveForChain functions despite being unused after sell function removal (no noUnusedLocals compiler flag)"

patterns-established:
  - "Exit monitoring via single startExitMonitor call per buy, not 3 separate registrations"
  - "Resume monitoring via single resumeExitMonitor call per pending trade"

requirements-completed: [EXIT-01, EXIT-02, EXIT-03, EXIT-04]

# Metrics
duration: 8min
completed: 2026-03-26
---

# Phase 7 Plan 3: Bot Integration Summary

**Unified exit engine wired into all bot.ts handlers, replacing 12 legacy monitor/sell functions with startExitMonitor/resumeExitMonitor calls**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-26T03:41:31Z
- **Completed:** 2026-03-26T03:49:36Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Wired startExitMonitor into handleNewPairForChain, handleNewV3PoolForChain, and legacy handleNewPair with token balance capture and trade ID lookup
- Rewrote resumeMultiChainMonitoring and resumeMonitoring to use resumeExitMonitor with trade ID from DB
- Removed 12 legacy functions (~490 lines): 3 executeSell variants, 3 monitorStopLoss variants, 3 monitorTakeProfit variants, 3 scheduleTimedSell variants
- Cleaned up unused imports (registerStopLoss, registerTakeProfit, registerTimedSell, tryAcquireSellLock, clearAllTimersForToken, isShutdownInProgress)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire exit engine into handler functions and capture token balance** - `968886b` (feat)
2. **Task 2: Remove legacy monitor functions and sell functions from bot.ts** - `b7050b3` (refactor)

## Files Created/Modified
- `src/bot.ts` - Rewired all handler entry points to use unified exit engine, removed 12 legacy monitor/sell functions

## Decisions Made
- Used CONFIG.network (not hardcoded 'mainnet') for legacy handleNewPair trade ID lookup to match existing insertTrade chain field
- Built full ChainContext inline in legacy resumeMonitoring to satisfy resumeExitMonitor interface
- Kept maybeApprove/maybeApproveForChain as dead code since TypeScript compiler doesn't enforce noUnusedLocals

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 7 smart exit strategies fully integrated: exitEngine.ts (Plans 01+02) now wired into bot.ts (Plan 03)
- All exit logic consolidated into single exit engine -- trailing stops, partial sells, volatility adaptation, time-weighted urgency
- Ready for Phase 7 Plan 04 (validation/verification) or next phase

## Self-Check: PASSED

All files exist, all commits verified, TypeScript compiles clean, tests pass.

---
*Phase: 07-smart-exit-strategies*
*Completed: 2026-03-26*
