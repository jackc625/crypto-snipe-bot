# Phase 10: Fix partial_sell Revenue Visibility - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Make partial sell revenue visible to all downstream consumers — P&L queries, trade history, risk calculations, dashboard P&L chart, and exposure tracking. The `partial_sell` trade rows already exist in the DB (Phase 7, D-10) but are ignored by every query that computes financial metrics. This phase fixes the SQL queries and API responses — no new exit strategy logic, no new dashboard pages, no schema changes.

</domain>

<decisions>
## Implementation Decisions

### P&L aggregation
- **D-01:** Aggregate per buy — one row per position. SUM all sell revenues (`partial_sell` + `sell`) into a single `sell_revenue` and `realized_pnl`. Downstream consumers (trade history, CSV export, dashboard) receive one summary row per position, unchanged interface.
- **D-02:** Add `sell_count` column to the P&L query — COUNT of all sell + partial_sell rows for that buy. Enables dashboard to indicate "this position had partial takes" (e.g., "3 sells" or a partial-take icon). Minimal overhead via SQL COUNT.

### Open position partial P&L
- **D-03:** Open positions with partial sells show partial realized P&L. If a position is still pending but has partial_sell rows, P&L query returns the partial sell revenue already received (not null). Gives real-time visibility into capital recovered while trailing.

### Exposure reduction
- **D-04:** Partial sell proceeds reduce reported exposure. Net exposure = original buy `amount_in` minus SUM of `partial_sell` revenue already received. `getTotalExposure`, `getDeployedCapitalByChain`, and `exposureByChain` queries all updated. Prevents the risk gate from being overly conservative by counting returned capital as still deployed.

### Daily loss accounting
- **D-05:** Include all sell events (partial_sell + sell) in the daily loss circuit breaker. `getDailyRealizedLoss` query updated to JOIN on `s.action IN ('sell', 'partial_sell')`. A partial sell profit offsets a later loss on the same token. More accurate capital flow tracking, prevents over-triggering.

### Trade history display
- **D-06:** Summary rows only in trade history table and CSV export. Partial sell detail stays in the DB but is not surfaced as separate line items. Keeps the history clean — one row per position matching the aggregated P&L.

### Dashboard P&L chart
- **D-07:** Each partial sell adds a data point to the cumulative P&L chart at the timestamp it happened. The chart's data query must return individual sell events (partial_sell + sell) sorted by timestamp, not aggregated per buy. This is a separate query from the aggregated P&L — the chart needs per-event granularity for accurate time-series plotting.

### Claude's Discretion
- Exact SQL rewrite for getPnLQuery (aggregation approach: subquery vs CTE vs GROUP BY)
- How to pro-rate buy cost and gas across partial sells for the P&L chart data points
- Whether sell_count is a separate column or derived in the API layer
- How to handle edge cases (partial_sell with no final sell yet, multiple buys of same token)
- Whether to add a dedicated chart data query or modify the existing risk/pnl endpoint

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — DB-04 (P&L per trade with realized gains/losses queryable), DASH-02 (historical trade log with filtering)

### Current implementation (being fixed)
- `src/utils/db.ts:186` — `getPnLQuery`: LEFT JOIN on `s.action = 'sell'` only — MUST be updated to include `partial_sell`
- `src/utils/db.ts:256` — `getDailyRealizedLoss`: INNER JOIN on `s.action = 'sell'` only — MUST be updated
- `src/utils/db.ts:246` — `getTotalExposure`: SUM of `amount_in` for pending buys — MUST subtract partial sell returns
- `src/utils/db.ts:252` — `getDeployedCapitalByChain`: same pattern as getTotalExposure — MUST subtract partial sell returns
- `src/riskManager.ts:48` — `exposureByChain`: SUM of `amount_in` for pending buys — MUST subtract partial sell returns

### Partial sell insertion (working correctly, not modified)
- `src/exitEngine.ts:567` — `insertTrade.run()` with `action: 'partial_sell'` — this is the source of partial sell rows

### API consumers of P&L data
- `src/api/routes/trades.ts` — Trade history and CSV export, calls `getPnL()`
- `src/api/routes/risk.ts` — Risk exposure/pnl endpoint, calls `getPnL()`
- `src/api/routes/positions.ts` — Positions endpoint, calls `getPnL()`
- `src/api/routes/health.ts` — Health endpoint, calls `getPnL()`

### Prior phase context
- `.planning/phases/07-smart-exit-strategies/07-CONTEXT.md` — D-10: partial sells recorded as `partial_sell` trade rows; D-07: percentages based on original buy amount
- `.planning/phases/03-sqlite-storage-code-quality/03-CONTEXT.md` — D-05: P&L computed on query via SQL JOIN; D-06: trades table schema

### Codebase analysis
- `.planning/codebase/ARCHITECTURE.md` — Data layer, P&L query patterns
- `.planning/codebase/CONVENTIONS.md` — Prepared statement patterns, inline queries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/db.ts`: All queries are prepared statements via `db.prepare()`. P&L, exposure, and daily loss queries follow the same pattern — parameterized SQL with CAST/COALESCE for TEXT→REAL conversion.
- `src/exitEngine.ts`: Partial sell insertion already works correctly. `insertTrade.run()` at line 567 records `action: 'partial_sell'` with `amount_out` (ETH received) and `gas_cost`.
- `src/api/routes/trades.ts`: Trade history API already filters by chain/date and supports CSV export. Interface stays the same — just data changes.

### Established Patterns
- Prepared statements with inline SQL (not extracted to separate files)
- CAST(COALESCE(field, '0') AS REAL) pattern for TEXT amount arithmetic in SQLite
- LEFT JOIN for optional sell data (positions without sells show null)
- Phase 3 D-05: P&L computed on query, never stored

### Integration Points
- `getPnL()` is the single function consumed by all API routes for financial data
- Exposure queries are consumed by `riskManager.ts` canSnipe() and `getPortfolioExposure()`
- P&L chart data endpoint in `risk.ts` uses cumulative running sum of realized_pnl sorted by sell_time

</code_context>

<specifics>
## Specific Ideas

- The P&L query rewrite likely involves changing the LEFT JOIN from `s.action = 'sell'` to `s.action IN ('sell', 'partial_sell')` with a GROUP BY on the buy row, using SUM for revenue and COUNT for sell_count
- Exposure queries need a correlated subquery or LEFT JOIN to subtract SUM of partial_sell `amount_out` from the buy `amount_in`
- The P&L chart needs per-event sell data (not aggregated) — this may require a separate query from the aggregated getPnL
- Open position partial P&L: the aggregated query with LEFT JOIN will naturally show partial revenue when no final sell exists yet

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-partial-sell-revenue-fix*
*Context gathered: 2026-03-30*
