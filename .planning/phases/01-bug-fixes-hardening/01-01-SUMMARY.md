---
phase: 01-bug-fixes-hardening
plan: 01
subsystem: bot-core
tags: [mutex, timer-registry, graceful-shutdown, sell-simulation, ethers-v5]

# Dependency graph
requires: []
provides:
  - "Per-token sell mutex (tryAcquireSellLock/releaseSellLock) preventing double-sells"
  - "Timer registry (registerStopLoss/registerTakeProfit/registerTimedSell) with coordinated cleanup"
  - "Graceful shutdown handler (SIGTERM/SIGINT) with timer cleanup, listener removal, state flush"
  - "Unified executeSell() function with mutex + balance check + timer cleanup"
  - "resumeMonitoring() for restart recovery of pending tokens"
  - "getState/flushState exports from storage.ts"
affects: [01-02, 01-03, 02-ethers-migration]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-token-mutex-map, timer-registry-pattern, unified-exit-function, shutdown-handler]

key-files:
  created: [src/utils/exitManager.ts]
  modified: [src/bot.ts, src/utils/storage.ts]

key-decisions:
  - "Simple Map<string, boolean> mutex over async-mutex package -- JS single-threaded, no real concurrency"
  - "Unified executeSell() instead of inline sell logic in each exit function -- DRY + guaranteed mutex/cleanup"
  - "Safety net timeout uses .unref() to avoid keeping event loop alive"
  - "Resume checks balance before restarting monitoring -- handles tokens rugged during downtime"

patterns-established:
  - "Per-token mutex: tryAcquireSellLock before any sell, clearAllTimersForToken after"
  - "Timer registry: every setInterval/setTimeout registered, clearAllTimersForToken cancels all"
  - "Exit lifecycle: executeSell handles lock -> balance check -> sell -> status update -> timer cleanup"

requirements-completed: [FIX-01, FIX-04, FIX-05, FIX-07, FIX-08]

# Metrics
duration: 11min
completed: 2026-03-19
---

# Phase 01 Plan 01: Exit Manager & Bot Hardening Summary

**Per-token sell mutex with timer registry preventing double-sells, re-enabled sell simulation, graceful shutdown handler, and restart resume logic**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-19T19:43:08Z
- **Completed:** 2026-03-19T19:54:22Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created exitManager.ts with per-token mutex, timer registry, and shutdown handler -- eliminates the stop-loss/take-profit race condition (FIX-01)
- Restructured bot.ts with unified executeSell() function that acquires mutex, checks balance, sells, and cleans up all timers atomically (FIX-01, FIX-07, FIX-08)
- Re-enabled sell simulation before every buy with hard block on failure (FIX-04)
- Added graceful shutdown on SIGTERM/SIGINT: clears all timers, removes factory listeners, flushes state to disk (FIX-05)
- Added resumeMonitoring() to restart monitoring loops for pending tokens after bot restart (FIX-05)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create exitManager.ts and add storage exports** - `241f92a` (feat)
2. **Task 2: Restructure bot.ts exit functions** - `c6de4da` (feat)

**Plan metadata:** [pending] (docs: complete plan)

## Files Created/Modified
- `src/utils/exitManager.ts` - New module: per-token sell mutex, timer registry (stop-loss/take-profit/timed-sell), graceful shutdown handler with SIGTERM/SIGINT, isShutdownInProgress getter
- `src/bot.ts` - Restructured: unified executeSell() with mutex, balance-zero checks in monitoring loops, timer registration, sell simulation re-enabled, resumeMonitoring(), initShutdownHandler in startBot
- `src/utils/storage.ts` - Added getState() and flushState() exports for shutdown and resume

## Decisions Made
- Used simple `Map<string, boolean>` for the per-token mutex instead of async-mutex package -- JavaScript is single-threaded, so the race condition between async callbacks is safely handled by a synchronous check-and-set within a single event loop tick
- Created a unified `executeSell()` function instead of keeping inline sell logic in each exit function -- DRY pattern ensures mutex and cleanup are always applied consistently
- Safety net timeout on shutdown uses `.unref()` to prevent keeping the event loop alive if graceful shutdown completes normally
- Resume logic checks token balance before restarting monitors -- handles the case where a token was rugged or transferred during bot downtime

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed clearAllTimers Map mutation during iteration**
- **Found during:** Task 1 (exitManager.ts creation)
- **Issue:** `for (const [token] of timerRegistry)` calls `clearAllTimersForToken(token)` which deletes from the map during iteration -- unsafe mutation
- **Fix:** Changed to `Array.from(timerRegistry.keys())` to snapshot keys before iterating
- **Files modified:** src/utils/exitManager.ts
- **Verification:** Full project compiles, no runtime mutation hazard
- **Committed in:** 241f92a (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Auto-fix necessary for correctness. No scope creep.

## Issues Encountered
- Individual file type-check (`npx tsc --noEmit src/utils/exitManager.ts`) failed because it doesn't use project tsconfig.json settings -- full project compile (`npx tsc --noEmit`) passes cleanly

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Exit manager module is ready for use by plans 01-02 and 01-03
- exitManager.ts exports are stable API for bot.ts consumption
- storage.ts getState/flushState exports ready for any module needing state access

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 01-bug-fixes-hardening*
*Completed: 2026-03-19*
