---
status: complete
phase: 10-partial-sell-revenue-fix
source: [10-01-SUMMARY.md, 10-02-SUMMARY.md]
started: 2026-03-31T00:00:00Z
updated: 2026-03-31T00:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. P&L Aggregates Partial Sell Revenue
expected: In the trade history view, a position with a buy + partial_sell + final sell shows ONE aggregated row with combined sell_revenue from all sell events. sell_revenue is a number reflecting total proceeds from both sell types.
result: pass
verified: code audit — getPnLQuery uses GROUP BY b.id with SUM() over IN ('sell', 'partial_sell') join. PnLResult.sell_revenue is number type, COALESCE'd to 0.

### 2. Open Position Not Falsely Closed by Partial Sell
expected: A position that has had partial sells but NOT a final sell still appears as "open" in the positions list. The buy_status-based detection correctly identifies it as open despite having a non-null sell_time from the partial sell.
result: pass
verified: code audit — positions.ts:34 filters by buy_status === 'pending', trades.ts:68 uses buy_status for action field. sell_time no longer used for status detection.

### 3. Sell Count Indicator in Trade Table
expected: In the dashboard trade table, a position with multiple sell events (e.g., 1 partial_sell + 1 sell = 2 sells) shows "(2 sells)" indicator. A position with only 1 sell does NOT show any sell count indicator (clean UI for single-sell).
result: pass
verified: code audit — TradeTable.tsx:196-200 conditionally renders "(N sells)" only when sellCount > 1 via (trade.sellCount ?? 0) > 1 guard.

### 4. CSV Export Includes Sell Count
expected: Downloading the trade CSV export includes a "Sell Count" column. Positions with multiple sells show the correct count. Single-sell positions show 1.
result: pass
verified: code audit — trades.ts:122 includes 'Sell Count' header, trades.ts:133 outputs String(t.sell_count) per row.

### 5. Per-Event P&L Chart Data
expected: The /api/pnl endpoint returns individual data points for each sell and partial_sell event (not aggregated per position). Each data point includes a pro-rated buy cost, enabling a cumulative P&L chart that shows revenue accruing over time through partial sells.
result: pass
verified: code audit — risk.ts:58 calls getPnLChartData, risk.ts:64-66 pro-rates buy_cost/total_sells per event, accumulates running sum for cumulative chart.

### 6. Exposure Reduced by Partial Sell Proceeds
expected: Portfolio exposure metrics (per-chain and total) subtract partial sell proceeds from the exposure calculation. A position that has been partially sold shows reduced exposure compared to a position with no sells, even before the final sell.
result: pass
verified: code audit — db.ts getTotalExposure and getDeployedCapitalByChain both use correlated subquery subtracting SUM of partial_sell amount_out. riskManager.ts exposureByChain uses same pattern.

### 7. Daily Loss Circuit Breaker Includes Partial Sells
expected: Realized losses from partial_sell events count toward the daily realized loss total used by the circuit breaker. If a partial sell realizes a loss, it reduces the remaining daily loss budget.
result: pass
verified: code audit — db.ts getDailyRealizedLoss:298 uses IN ('sell', 'partial_sell') in join condition.

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
