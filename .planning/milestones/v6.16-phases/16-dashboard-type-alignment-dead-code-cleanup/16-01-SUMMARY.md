---
phase: 16-dashboard-type-alignment-dead-code-cleanup
plan: 01
subsystem: dashboard, api
tags: [type-alignment, field-rename, react-key, trade-table]
dependency_graph:
  requires: []
  provides:
    - "Corrected Trade interface matching /api/trades response"
    - "TradeTable component using correct field names"
    - "Stable React key from buy_id in API response"
  affects:
    - dashboard/src/types/api.ts
    - dashboard/src/components/TradeTable.tsx
    - src/api/routes/trades.ts
tech_stack:
  added: []
  patterns:
    - "API response as single source of truth for TypeScript interface"
key_files:
  created: []
  modified:
    - dashboard/src/types/api.ts
    - dashboard/src/components/TradeTable.tsx
    - src/api/routes/trades.ts
decisions:
  - "API response is source of truth -- dashboard Trade interface aligned to match, not the reverse"
  - "Added id: t.buy_id to API response for stable React key rather than composite key"
metrics:
  duration: 4min
  completed: "2026-04-13T19:43:12Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 16 Plan 01: Trade Type Alignment Summary

Aligned dashboard Trade TypeScript interface with actual /api/trades JSON response shape, fixed all field references in TradeTable.tsx, and added buy_id to API response for stable React key rendering.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Align Trade interface and add buy_id to API | f11dd61 | Replaced phantom fields (txHash, exitReason, peakPrice, amount, price, gasUsed) with actual API fields (pnl, buyCost, buyGas, sellRevenue, sellGas); added id: t.buy_id to API response |
| 2 | Update TradeTable to use corrected field names | 5bb5271 | Updated SortField type, sort logic, P&L/Entry Cost/Exit Revenue/Buy Gas/Sell Gas cells to use corrected names |

## Verification Results

- `npx vitest run test/integration/api/trades.test.ts` -- 9/9 passed
- `cd dashboard && npx tsc --noEmit` -- 0 errors (clean compilation)
- Trade interface fields exactly match API response shape
- TradeTable references only fields present in corrected Trade interface
- No old field names (realizedPnl, amount, price, gasUsed, txHash, exitReason, peakPrice) remain in TradeTable

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all fields are wired to real API data.

## Self-Check: PASSED

- All 3 modified files exist on disk
- Commit f11dd61 found in git log
- Commit 5bb5271 found in git log
- SUMMARY.md exists at expected path
