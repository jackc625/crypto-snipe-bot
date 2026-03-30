---
phase: 10-partial-sell-revenue-fix
plan: 01
subsystem: database
tags: [sqlite, sql, pnl, partial-sell, exposure, risk-management, group-by, correlated-subquery]

# Dependency graph
requires:
  - phase: 07-smart-exit-strategies
    provides: "partial_sell trade rows inserted by exit engine, exit_state table"
  - phase: 03-sqlite-storage-code-quality
    provides: "SQLite prepared statements, PnLResult interface, CAST/COALESCE SQL pattern"
  - phase: 06-risk-management
    provides: "exposureByChain inline prepared statement, getTotalExposure, getDailyRealizedLoss"
provides:
  - "getPnLQuery with GROUP BY aggregation returning one row per buy with aggregated sell_revenue from sell + partial_sell"
  - "PnLResult interface with buy_id, sell_count, buy_status fields; sell_revenue/sell_gas now number types"
  - "getTotalExposure and getDeployedCapitalByChain subtracting partial sell proceeds via correlated subquery"
  - "getDailyRealizedLoss including partial_sell events in daily loss circuit breaker"
  - "New getPnLChartData query returning per-event sell rows sorted by timestamp for cumulative P&L chart"
  - "New PnLChartDataRow interface exported from db.ts"
  - "exposureByChain in riskManager.ts subtracting partial sell proceeds"
affects: [api-routes, dashboard, positions, trades, risk-endpoints]

# Tech tracking
tech-stack:
  added: []
  patterns: [GROUP BY aggregation for 1:N sell relationships, correlated subquery for exposure reduction, per-event chart data query with pro-rated buy cost]

key-files:
  created: []
  modified:
    - src/utils/db.ts
    - src/riskManager.ts
    - test/unit/db.test.ts
    - test/unit/riskManager.test.ts

key-decisions:
  - "GROUP BY b.id for P&L aggregation over CTE or subquery -- simpler, standard SQL, one-pass"
  - "COUNT(s.id) not COUNT(*) for sell_count to avoid counting NULL LEFT JOIN matches"
  - "AND s.timestamp >= b.timestamp in JOINs to scope sell rows to their corresponding buy"
  - "Correlated subquery for exposure reduction rather than JOIN -- cleaner for single-value subtraction"
  - "Per-event chart data as separate query (getPnLChartData) not modification to getPnL -- different granularity needs"

patterns-established:
  - "GROUP BY b.id for 1:N buy-to-sell aggregation in P&L queries"
  - "Correlated subquery pattern: COALESCE((SELECT SUM(...) FROM trades ps WHERE ps.action = 'partial_sell'), 0) for exposure reduction"
  - "s.timestamp >= b.timestamp constraint in all buy-sell JOINs to prevent cross-contamination across same-token re-buys"

requirements-completed: [DB-04, DASH-02]

# Metrics
duration: 7min
completed: 2026-03-30
---

# Phase 10 Plan 01: Partial Sell Revenue Fix Summary

**Rewrote 6 SQL queries in db.ts and 1 in riskManager.ts to aggregate partial_sell + sell events, subtract partial sell proceeds from exposure, and provide per-event chart data**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-30T18:03:34Z
- **Completed:** 2026-03-30T18:11:27Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- All 5 existing db.ts financial queries rewritten to include partial_sell rows via `IN ('sell', 'partial_sell')` join conditions
- New getPnLChartData query exported for per-event P&L chart visualization (D-07)
- PnLResult interface extended with buy_id, sell_count, buy_status fields; sell_revenue/sell_gas changed from string|null to number
- exposureByChain in riskManager.ts uses correlated subquery to subtract partial sell proceeds from per-chain exposure
- 10 new test cases (9 db + 1 riskManager) validating all query changes, full unit suite (95 tests) green

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite db.ts queries and PnLResult interface** - `a4a7abb` (test: TDD RED) + `bd72c5f` (feat: TDD GREEN)
2. **Task 2: Rewrite riskManager.ts exposureByChain query** - `4c5a735` (test: TDD RED) + `e6d99d3` (feat: TDD GREEN)

_TDD tasks have two commits each (test -> feat)_

## Files Created/Modified
- `src/utils/db.ts` - 5 query rewrites (getPnLQuery, getTotalExposure, getDeployedCapitalByChain, getDailyRealizedLoss, new getPnLChartData) + PnLResult/PnLChartDataRow interfaces
- `src/riskManager.ts` - exposureByChain correlated subquery for partial sell subtraction
- `test/unit/db.test.ts` - 9 new test cases in 'P&L with partial sells (Phase 10)' describe block
- `test/unit/riskManager.test.ts` - 1 new test case in 'getPortfolioExposure with partial sells (Phase 10)' describe block

## Decisions Made
- GROUP BY b.id chosen for P&L aggregation (simpler than CTE, standard SQL, single-pass)
- COUNT(s.id) not COUNT(*) prevents null LEFT JOIN matches from inflating sell_count
- s.timestamp >= b.timestamp added to all JOINs as safety for same-token re-buy edge case (Pitfall 5)
- Separate getPnLChartData query (not modifying getPnL) because chart needs per-event granularity vs per-position aggregation
- Equal pro-rating via total_sells count for chart data points (simpler, cumulative sum converges correctly)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Downstream Impact Note

The PnLResult interface change (sell_revenue from string|null to number, realized_pnl from number|null to number, new buy_status field) affects API route consumers in positions.ts, trades.ts, risk.ts, and health.ts. These consumers currently use `t.sell_time === null` for open/closed detection which will break for positions with partial sells (sell_time now shows latest partial sell timestamp). Plan 02 addresses API consumer updates.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Data layer complete: all financial queries include partial_sell rows
- API consumers need updating (Plan 02) to use buy_status instead of sell_time for open/closed detection
- Dashboard will automatically receive correct aggregated data once API layer is updated

## Self-Check: PASSED

All 4 modified/created files verified on disk. All 4 commit hashes (a4a7abb, bd72c5f, 4c5a735, e6d99d3) verified in git log.

---
*Phase: 10-partial-sell-revenue-fix*
*Completed: 2026-03-30*
