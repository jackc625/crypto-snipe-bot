---
phase: 08-monitoring-web-dashboard
plan: 02
subsystem: api
tags: [express, rest, positions, trades, risk, csv-export, pagination, cumulative-pnl]

# Dependency graph
requires:
  - phase: 03-sqlite-storage-code-quality
    provides: "SQLite data layer with getPnL, getOpenPositionCount, getTotalExposure, getExitState"
  - phase: 06-risk-management
    provides: "getPortfolioExposure, getDailyRealizedLoss, risk config env vars"
  - phase: 07-smart-exit-strategies
    provides: "exit_state table, ExitStateRow, exitConfig with urgencyWindowMs"
provides:
  - "GET /api/positions endpoint returning open positions with exit strategy state"
  - "GET /api/trades endpoint with pagination, filtering, and 7-day default"
  - "GET /api/trades/export CSV download endpoint"
  - "GET /api/risk/exposure portfolio exposure by chain"
  - "GET /api/risk/pnl cumulative P&L data points for charting"
  - "GET /api/risk/limits position, exposure, and daily loss utilization"
  - "Server route mounting via apiRouter pattern"
affects: [08-04-frontend-overview, 08-05-frontend-risk, 08-06-frontend-trades]

# Tech tracking
tech-stack:
  added: [express]
  patterns: [router-factory, async-handler-wrapper, paginated-response, csv-export]

key-files:
  created:
    - src/api/routes/positions.ts
    - src/api/routes/trades.ts
    - src/api/routes/risk.ts
    - src/api/server.ts
    - tests/api/positions.test.ts
    - tests/api/trades.test.ts
    - tests/api/risk.test.ts
  modified: []

key-decisions:
  - "Inline asyncHandler in each route file to avoid dependency timing with parallel Plan 01 execution"
  - "Cumulative P&L computed as running sum of realized_pnl sorted by sell_time for Lightweight Charts"
  - "Risk config read from env vars at request time (not cached) matching riskManager.ts pattern"
  - "CSV export writes full string (not streamed) since trade counts are bounded"

patterns-established:
  - "Router factory: export function xRoutes(contexts?: ChainContext[]): Router"
  - "Paginated response shape: { data: [...], pagination: { page, limit, total, totalPages } }"
  - "CSV export with Content-Disposition header and ISO date filename"

requirements-completed: [DASH-01, DASH-02, DASH-04]

# Metrics
duration: 14min
completed: 2026-03-26
---

# Phase 08 Plan 02: Data API Routes Summary

**REST endpoints serving positions with exit state, paginated trade history with CSV export, and risk metrics (exposure, cumulative P&L, limits)**

## Performance

- **Duration:** 14 min
- **Started:** 2026-03-26T18:53:28Z
- **Completed:** 2026-03-26T19:08:18Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Positions endpoint returns open positions with full exit strategy state (urgency %, high-water mark, partial tier progress, volatility samples)
- Trades endpoint returns paginated, filtered history with all four column groups (core, timing, amounts, exit) and 7-day default range
- CSV export generates downloadable trade history with ISO date timestamps
- Risk endpoints provide portfolio exposure for donut chart, cumulative P&L for line chart with 24h/7d/30d/all ranges, and position/exposure/loss limit utilization
- All three route modules mounted in Express server via apiRouter pattern
- 19 tests total (4 positions + 7 trades + 8 risk), all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Positions and trades API routes** - `e686ac0` (feat)
2. **Task 2: Risk API routes and server route mounting** - `fa85d5f` (feat)

## Files Created/Modified
- `src/api/routes/positions.ts` - GET /api/positions with exit state data (D-34, D-35)
- `src/api/routes/trades.ts` - GET /api/trades (paginated, filtered) and GET /api/trades/export (CSV) (D-25, D-26, D-27, D-28)
- `src/api/routes/risk.ts` - GET /api/risk/exposure, /pnl, /limits (D-31, D-32, D-33)
- `src/api/server.ts` - Express server factory with apiRouter mounting all data routes
- `tests/api/positions.test.ts` - 4 tests for open positions with exit state
- `tests/api/trades.test.ts` - 7 tests for pagination, filtering, column groups, CSV export
- `tests/api/risk.test.ts` - 8 tests for exposure, cumulative P&L, and limit utilization

## Decisions Made
- Used inline asyncHandler in each route file rather than importing from errorHandler middleware, since Plan 01 (which creates errorHandler) runs in parallel. When merged, can consolidate to shared import.
- Risk config values (MAX_OPEN_POSITIONS, MAX_TOTAL_EXPOSURE, DAILY_LOSS_PCT) read from process.env at request time, consistent with riskManager.ts pattern.
- Cumulative P&L builds running sum of realized_pnl sorted by sell_time ascending, providing time-series data points compatible with Lightweight Charts.
- CSV export uses full string write (not streaming) since trade volumes are bounded and simplicity is preferred.
- Tests use raw Node.js http.get instead of supertest to avoid adding test dependencies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed express dependency**
- **Found during:** Task 1 (before tests could run)
- **Issue:** express was not installed (Plan 01 installs it in parallel worktree)
- **Fix:** Ran `npm install express @types/express --legacy-peer-deps`
- **Files modified:** package.json, package-lock.json (not committed - Plan 01 handles full dependency install)
- **Verification:** All tests run successfully
- **Committed in:** Not separately committed - runtime dependency for test execution

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal - express install required for test execution in parallel worktree. No scope creep.

## Issues Encountered
None

## Known Stubs
None - all endpoints fully implemented with real data queries through existing db.ts and riskManager.ts exports.

## Next Phase Readiness
- All six data API endpoints ready for frontend consumption
- Positions endpoint feeds overview table (Plan 04 frontend)
- Trades endpoint feeds history page (Plan 06 frontend)
- Risk endpoints feed charts and gauges (Plan 05 frontend)
- Server route mounting pattern established for control routes (Plan 03)

## Self-Check: PASSED

All 7 created files verified on disk. Both task commits (e686ac0, fa85d5f) verified in git log.

---
*Phase: 08-monitoring-web-dashboard*
*Completed: 2026-03-26*
