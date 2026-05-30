---
phase: 07-smart-exit-strategies
plan: 01
subsystem: exit-engine
tags: [trailing-stop, partial-sell, volatility, urgency, sqlite, config]

# Dependency graph
requires:
  - phase: 06-risk-management
    provides: "DB-backed trades table, risk gate infrastructure, canSnipe() pattern"
  - phase: 03-sqlite-storage-code-quality
    provides: "SQLite schema migration via user_version, prepared statements pattern"
provides:
  - "Exit strategy config vars (trailing stop, partial sell, urgency, volatility)"
  - "DB schema v3 with exit_state table and partial_sell action type"
  - "Exit engine types: PartialTier, ExitConfig, ExitStateData, ExitStateRow"
  - "VolatilityTracker class with CV-based multiplier"
  - "Pure computation helpers: urgency, trailing stop, partial sell amounts"
  - "Unified registerExitMonitor timer in exitManager.ts"
affects: [07-02-exit-engine-core, 07-03-bot-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns: [cv-based-volatility-multiplier, linear-urgency-curve, bigint-partial-sell-math]

key-files:
  created: [src/exitEngine.ts]
  modified: [src/config.ts, src/utils/db.ts, src/utils/exitManager.ts]

key-decisions:
  - "Coefficient of variation (CV = stddev/mean) chosen as volatility metric -- dimensionless, normalizes across price ranges"
  - "BigInt math for partial sell calculation to avoid precision loss with token amounts"
  - "exitMonitorInterval added alongside existing timer types (not replacing) for incremental migration"
  - "exit_state table keyed by trade_id with FOREIGN KEY to trades for referential integrity"

patterns-established:
  - "VolatilityTracker: circular buffer with JSON serialization for DB persistence and fromJSON restoration"
  - "Exit state serialization: ExitStateData (runtime) <-> ExitStateRow (DB) with serialize/deserialize helpers"
  - "Partial sell tier parsing: env var string '2x:50,5x:25' -> sorted PartialTier[] validated at startup"

requirements-completed: [EXIT-01, EXIT-02, EXIT-03, EXIT-04]

# Metrics
duration: 7min
completed: 2026-03-26
---

# Phase 7 Plan 01: Exit Engine Foundation Summary

**Exit strategy config parsing, DB schema v3 with exit_state table and partial_sell support, VolatilityTracker with CV-based multiplier, and 8 pure computation helpers for trailing stops, urgency, and partial sells**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-26T03:13:21Z
- **Completed:** 2026-03-26T03:21:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- CONFIG object extended with 9 exit strategy fields (trailing stop, partial sell, urgency, volatility) plus 5 new optional env var specs
- DB schema migrated to v3: exit_state table with high_water_mark, partial_tiers_completed, volatility_samples; trades table expanded with 'partial_sell' action type
- Created src/exitEngine.ts with 4 interfaces, 1 class (VolatilityTracker), 8 exported functions, and exitConfig constant
- exitManager.ts extended with registerExitMonitor() for unified single-interval-per-position timer

## Task Commits

Each task was committed atomically:

1. **Task 1: Add exit strategy config + DB schema v3 migration** - `5ff1517` (feat)
2. **Task 2: Simplify timer registry + create exit engine types and utilities** - `7f7639d` (feat)

## Files Created/Modified
- `src/config.ts` - Added 5 exit strategy env vars to REQUIRED_ENV_VARS + 9 exit strategy fields to CONFIG object
- `src/utils/db.ts` - Schema v3 migration: exit_state table, partial_sell action, 4 prepared statements (upsert/get/delete exit state, get trade ID for pending token)
- `src/utils/exitManager.ts` - exitMonitorInterval in TokenTimers, registerExitMonitor(), updated clear functions
- `src/exitEngine.ts` - New file: PartialTier, ExitConfig, ExitStateData, ExitStateRow interfaces; VolatilityTracker class; parsePartialSellTargets, buildExitConfig, computeUrgencyMultiplier, computeEffectiveTrailingPct, getUnfilledTiers, calculatePartialSellAmount, serializeExitState, deserializeExitState

## Decisions Made
- Coefficient of variation (CV = stddev/mean) chosen as volatility metric -- dimensionless and normalizes across price ranges per D-12
- BigInt math exclusively for partial sell token amount calculation to avoid precision loss (Pitfall 1 from research)
- registerExitMonitor clears ALL existing timers for the key before setting the new one -- safety net against timer leaks during migration
- exit_state table uses FOREIGN KEY referencing trades(id) for referential integrity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing test failures detected (4 test scaffold files from Phase 04 use `describe` without importing vitest globals). Not a regression from this plan's changes -- these tests were already failing before any modifications. Out of scope for this plan.

## User Setup Required

None - no external service configuration required. All new env vars (TRAILING_STOP_PCT, TRAILING_MIN_PCT, TRAILING_MAX_PCT, PARTIAL_SELL_TARGETS, STOP_LOSS_PCT) have sensible defaults and are optional.

## Next Phase Readiness
- All types, interfaces, and utilities are exported and ready for Plan 02 (exit engine core: startExitMonitor + pollExitStrategy)
- DB schema v3 migration and prepared statements ready for exit state persistence
- Timer registry supports the new unified exit monitor pattern

## Self-Check: PASSED

All 4 created/modified files verified on disk. Both task commits (5ff1517, 7f7639d) verified in git log.

---
*Phase: 07-smart-exit-strategies*
*Completed: 2026-03-26*
