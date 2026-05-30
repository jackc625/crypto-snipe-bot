---
phase: 06-risk-management
plan: 01
subsystem: risk
tags: [sqlite, better-sqlite3, pino, risk-management, position-sizing, circuit-breaker]

# Dependency graph
requires:
  - phase: 03-sqlite-storage-code-quality
    provides: SQLite trades table with chain/status/amount_in columns, prepared statement pattern
  - phase: 04-multi-chain-architecture
    provides: ChainConfig with snipeAmount/maxCapital, per-chain env var pattern
provides:
  - "canSnipe() gate function checking 5 risk rules in sequence"
  - "recordSnipe() for post-TX cooldown tracking per chain"
  - "getPortfolioExposure() for queryable total/per-chain deployed capital"
  - "4 risk-specific DB prepared statements (getOpenPositionCount, getTotalExposure, getDeployedCapitalByChain, getDailyRealizedLoss)"
  - "5 risk env vars with sensible defaults (MAX_OPEN_POSITIONS, MAX_TOTAL_EXPOSURE, DAILY_LOSS_PCT, SNIPE_COOLDOWN_MS, MAX_POSITION_SIZE)"
affects: [06-02 integration plan, bot.ts snipe pipeline, web dashboard risk display]

# Tech tracking
tech-stack:
  added: []
  patterns: [result-object-gate-pattern, per-chain-cooldown-map, db-backed-risk-state]

key-files:
  created: [src/riskManager.ts]
  modified: [src/utils/db.ts, src/config.ts, .env.example]

key-decisions:
  - "RiskCheckResult object with reason+details instead of boolean for actionable logging/alerting"
  - "In-memory Map for cooldowns (ephemeral by design, resets on restart are safe per D-09)"
  - "Inline prepared statement for exposureByChain GROUP BY query (consistent with Phase 3 resumeMonitoring pattern)"
  - "All 5 checks in strict sequence with fast-fail: position_size, daily_loss_limit, max_positions, cooldown, exposure_cap"

patterns-established:
  - "Result Object Gate: canSnipe returns {allowed, reason, details} for structured rejection handling"
  - "Risk Config Loading: flat env vars with parseFloat/parseInt defaults loaded once at module init"

requirements-completed: [RISK-01, RISK-02, RISK-03, RISK-04, RISK-05]

# Metrics
duration: 4min
completed: 2026-03-23
---

# Phase 6 Plan 01: Risk Management Core Module Summary

**Standalone risk gate module with 5 sequential checks (position size, daily loss circuit breaker, max positions, cooldown, exposure cap) backed by SQLite queries and in-memory cooldown Map**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-23T20:36:07Z
- **Completed:** 2026-03-23T20:40:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created src/riskManager.ts as a standalone, independently testable risk gate module with canSnipe/recordSnipe/getPortfolioExposure exports
- Added 4 risk-specific DB prepared statements to db.ts following existing pattern (getOpenPositionCount, getTotalExposure, getDeployedCapitalByChain, getDailyRealizedLoss)
- Added 5 optional risk env var specs to config.ts and documented them in .env.example with defaults and explanations
- All 5 RISK requirements (RISK-01 through RISK-05) implemented as sequential fast-fail checks in canSnipe()

## Task Commits

Each task was committed atomically:

1. **Task 1: Add risk-specific DB queries to db.ts and risk env vars to config.ts** - `56bdc17` (feat)
2. **Task 2: Create src/riskManager.ts with canSnipe gate and exposure query** - `121e151` (feat)

## Files Created/Modified
- `src/riskManager.ts` - Standalone risk gate module: canSnipe (5 checks), recordSnipe (cooldown), getPortfolioExposure (DB query)
- `src/utils/db.ts` - 4 new risk prepared statements for position count, exposure, per-chain capital, daily loss
- `src/config.ts` - 5 new optional env var specs in REQUIRED_ENV_VARS array
- `.env.example` - Risk Management section documenting all 5 env vars with defaults and explanations

## Decisions Made
- Used RiskCheckResult object with reason and details fields instead of boolean return, enabling structured logging and Telegram alerting of specific rejection reasons
- Kept cooldown tracking in ephemeral in-memory Map (resets on restart are safe per D-09) rather than DB-persisted
- Used inline prepared statement for exposureByChain GROUP BY query (consistent with Phase 3 resumeMonitoring pattern per STATE.md decision)
- Ordered checks as: position_size -> daily_loss_limit -> max_positions -> cooldown -> exposure_cap (cheapest/fastest checks first)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- node_modules not present in worktree; ran `npm install --legacy-peer-deps` (consistent with Phase 02 decision) before TypeScript verification. Not a deviation, standard worktree setup.

## User Setup Required

None - all risk env vars are optional with sensible defaults. Users can customize via .env file.

## Next Phase Readiness
- Risk module is complete and compiles clean, ready for Plan 02 integration into bot.ts snipe pipeline
- canSnipe() designed to be called at top of handleNewPairForChain() and handleNewV3PoolForChain() before safety checks
- recordSnipe() designed to be called after successful TX submission (replacing recordCapitalDeployed)

## Self-Check: PASSED

All files exist, all commits verified, TypeScript compiles clean.

---
*Phase: 06-risk-management*
*Completed: 2026-03-23*
