# Phase 10: Fix partial_sell Revenue Visibility - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 10-partial-sell-revenue-fix
**Areas discussed:** P&L aggregation, Exposure reduction, Trade history display, Daily loss accounting, Open position partial P&L, Dashboard P&L chart timing, Sell count metadata

---

## P&L Aggregation

| Option | Description | Selected |
|--------|-------------|----------|
| Aggregate per buy | One row per position. SUM all sell revenues (partial_sell + sell) into a single realized_pnl. | ✓ |
| One row per sell event | Each partial_sell and final sell gets its own P&L row with pro-rated buy cost. | |
| You decide | Claude picks the approach. | |

**User's choice:** Aggregate per buy
**Notes:** User initially asked for clarification. Explained with concrete example: 0.1 ETH buy → 3 sells totaling 0.25 ETH. Current query only sees the final 0.10 ETH sell, missing 0.15 ETH from partial sells. User understood and chose aggregation.

---

## Exposure Reduction

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, reduce exposure | Net exposure = buy cost minus partial sell revenue. More accurate, frees capital for new snipes. | ✓ |
| No, keep original buy amount | Exposure stays as full original buy until position fully closed. More conservative. | |
| You decide | Claude picks. | |

**User's choice:** Yes, reduce exposure
**Notes:** None

---

## Trade History Display

| Option | Description | Selected |
|--------|-------------|----------|
| Summary only | One row per position with aggregated P&L. Partial sell detail stays in DB. | ✓ |
| Separate line items | Each partial_sell as its own row in trade history and CSV. | |
| Summary + expandable detail | One row plus a detail endpoint for drill-down. | |
| You decide | Claude picks. | |

**User's choice:** Summary only
**Notes:** None

---

## Daily Loss Accounting

| Option | Description | Selected |
|--------|-------------|----------|
| Include all sell events | Count partial_sell P&L alongside full sell P&L in daily loss window. Profits offset losses. | ✓ |
| Only count when position fully closed | Aggregated P&L registers only at final sell. | |
| You decide | Claude picks. | |

**User's choice:** Include all sell events
**Notes:** None

---

## Open Position Partial P&L

| Option | Description | Selected |
|--------|-------------|----------|
| Show partial realized | Open positions with partial sells show partial revenue already received. | ✓ |
| Null until fully closed | P&L stays null for open positions regardless of partial sells. | |
| You decide | Claude picks. | |

**User's choice:** Show partial realized
**Notes:** None

---

## Dashboard P&L Chart Timing

| Option | Description | Selected |
|--------|-------------|----------|
| At each partial sell | Each partial sell adds a data point to cumulative P&L chart at its timestamp. | ✓ |
| Only when position closes | Full aggregated P&L appears as single point when position fully closes. | |
| You decide | Claude picks. | |

**User's choice:** At each partial sell
**Notes:** None

---

## Sell Count Metadata

| Option | Description | Selected |
|--------|-------------|----------|
| Add sell_count column | P&L query includes COUNT of sell + partial_sell rows. Dashboard can show indicator. | ✓ |
| No metadata needed | Just aggregated numbers, query detail directly if needed. | |
| You decide | Claude picks. | |

**User's choice:** Add sell_count column
**Notes:** None

---

## Claude's Discretion

- Exact SQL rewrite approach (subquery vs CTE vs GROUP BY)
- Pro-rating buy cost and gas for chart data points
- Edge case handling (partial_sell with no final sell, multiple buys of same token)
- Whether sell_count is SQL-level or API-level

## Deferred Ideas

None — discussion stayed within phase scope
