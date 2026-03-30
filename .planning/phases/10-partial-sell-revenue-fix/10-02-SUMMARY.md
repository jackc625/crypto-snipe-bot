---
phase: 10-partial-sell-revenue-fix
plan: 02
subsystem: api
tags: [express, api-routes, dashboard, react, partial-sell, pnl-chart, csv-export, trade-history]

# Dependency graph
requires:
  - phase: 10-partial-sell-revenue-fix
    provides: "PnLResult with buy_id, sell_count, buy_status; getPnLChartData query; aggregated sell_revenue/sell_gas numbers"
  - phase: 08-web-dashboard
    provides: "Express API routes (trades.ts, risk.ts, positions.ts), dashboard components (TradeTable.tsx, Trade type)"
provides:
  - "trades.ts API using buy_status for open/closed detection and including sellCount in response"
  - "trades.ts CSV export with Sell Count column"
  - "risk.ts /pnl endpoint using getPnLChartData for per-event cumulative P&L with pro-rated buy cost"
  - "positions.ts filtering open positions by buy_status instead of sell_time"
  - "Dashboard Trade interface with sellCount: number and action: 'open' | 'closed'"
  - "TradeTable sell count indicator showing '(N sells)' when sellCount > 1"
  - "Integration tests validating sellCount, open-status-via-buy_status, and per-event P&L chart data"
affects: [dashboard-pages, trade-history-ui, risk-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [buy_status-based open/closed detection replacing sell_time null check, pro-rated buy cost for per-event P&L chart]

key-files:
  created: []
  modified:
    - src/api/routes/trades.ts
    - src/api/routes/risk.ts
    - src/api/routes/positions.ts
    - dashboard/src/types/api.ts
    - dashboard/src/components/TradeTable.tsx
    - test/integration/api/trades.test.ts
    - test/integration/api/risk.test.ts
    - test/integration/api/positions.test.ts

key-decisions:
  - "buy_status-based open/closed detection in all 3 API routes replaces sell_time null check -- positions with partial sells have non-null sell_time but are still open"
  - "Pro-rated buy cost for P&L chart: buy_cost / total_sells per event gives correct cumulative convergence"
  - "Sell count indicator only shown when sellCount > 1 to avoid visual noise on single-sell positions"

patterns-established:
  - "buy_status field as canonical open/closed signal -- never use sell_time for status detection"
  - "getPnLChartData for time-series chart data, getPnL for aggregated trade history -- different granularity queries"

requirements-completed: [DB-04, DASH-02]

# Metrics
duration: 9min
completed: 2026-03-30
---

# Phase 10 Plan 02: API and Dashboard Wiring for Partial Sell Revenue Summary

**Wired updated P&L data through 3 API routes (trades, risk, positions) to dashboard with sell count indicators and per-event chart data using buy_status-based open/closed detection**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-30T18:16:47Z
- **Completed:** 2026-03-30T18:26:33Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- All 3 API routes (trades.ts, risk.ts, positions.ts) updated to consume Plan 01's new PnLResult fields
- trades.ts uses buy_status for open/closed detection and includes sellCount in both JSON response and CSV export
- risk.ts /pnl endpoint replaced with getPnLChartData for per-event P&L chart including partial_sell events (D-07)
- positions.ts filters by buy_status='pending' instead of sell_time=null (fixes Pitfall 4 from context)
- Dashboard Trade type updated with sellCount and action:'open'|'closed', TradeTable shows "(N sells)" indicator
- All 196 tests pass (unit + integration) with updated mocks matching new PnLResult interface

## Task Commits

Each task was committed atomically:

1. **Task 1: Update API routes to consume new PnLResult fields and getPnLChartData** - `105c55b` (feat)
2. **Task 2: Update dashboard Trade type and TradeTable sell count indicator** - `a25c1b7` (feat)

## Files Created/Modified
- `src/api/routes/trades.ts` - buy_status open/closed, sellCount field, Sell Count CSV column
- `src/api/routes/risk.ts` - getPnLChartData import, per-event /pnl handler with pro-rated buy cost
- `src/api/routes/positions.ts` - buy_status='pending' filter for open positions
- `dashboard/src/types/api.ts` - Trade interface: action:'open'|'closed', sellCount:number
- `dashboard/src/components/TradeTable.tsx` - Removed hasExitRevenue, trade.action status, sell count indicator
- `test/integration/api/trades.test.ts` - Updated mocks, added sellCount + open-status tests
- `test/integration/api/risk.test.ts` - getPnLChartData mock, D-07 per-event test
- `test/integration/api/positions.test.ts` - Updated mocks with buy_status field

## Decisions Made
- buy_status-based open/closed detection in all routes -- sell_time can be non-null for open positions with partial sells
- Pro-rated buy cost via e.buy_cost / e.total_sells for P&L chart -- simpler than weighted allocation, cumulative sum converges correctly
- Sell count indicator only shown when > 1 to keep UI clean for single-sell positions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated positions.test.ts mocks for buy_status-based filtering**
- **Found during:** Task 2 (integration test run)
- **Issue:** positions.test.ts mock data lacked buy_status field, causing positions to be filtered out (0 results instead of expected 1)
- **Fix:** Added buy_id, sell_count, buy_status fields to all 3 mock objects in positions.test.ts
- **Files modified:** test/integration/api/positions.test.ts
- **Verification:** All 196 tests pass
- **Committed in:** a25c1b7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix -- positions tests would fail without updated mocks. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full data pipeline complete: partial_sell revenue visible from DB queries through API to dashboard
- All financial queries (P&L, exposure, daily loss, chart) include partial_sell events
- All API consumers use buy_status for open/closed detection
- Dashboard shows sell count indicator for multi-sell positions
- Phase 10 complete -- no further plans needed

## Known Stubs
None -- all data sources are wired through from Plan 01 queries to API responses to dashboard rendering.

## Self-Check: PASSED

All 8 modified files verified on disk. Both commit hashes (105c55b, a25c1b7) verified in git log.

---
*Phase: 10-partial-sell-revenue-fix*
*Completed: 2026-03-30*
