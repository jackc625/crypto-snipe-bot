---
phase: 08-monitoring-web-dashboard
plan: 05
subsystem: ui
tags: [react, dashboard, trade-history, risk-exposure, chain-controls, charts]

# Dependency graph
requires:
  - phase: 08-04
    provides: React SPA scaffold with Overview page, Layout, shared hooks and components
  - phase: 08-03
    provides: Chain controls and emergency sell API endpoints
provides:
  - Trade History page with paginated table, chain/outcome/time-range filters, CSV export
  - Risk & Exposure page with P&L chart (Lightweight Charts), exposure donut (Chart.js), risk gauges
  - Chain Controls page with per-chain start/stop, config display, emergency sell-all with CONFIRM gate
  - All 4 dashboard pages complete and routed in App.tsx
affects: [08-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [lightweight-charts v5 addSeries API, Chart.js center text plugin, discriminated union dialog state]

key-files:
  created:
    - dashboard/src/pages/TradeHistory.tsx
    - dashboard/src/pages/RiskExposure.tsx
    - dashboard/src/pages/ChainControls.tsx
    - dashboard/src/components/TradeTable.tsx
    - dashboard/src/components/TimeRangeSelector.tsx
    - dashboard/src/components/PnLChart.tsx
    - dashboard/src/components/ExposureDonut.tsx
    - dashboard/src/components/RiskGauge.tsx
    - dashboard/src/components/ChainStatusCard.tsx
    - dashboard/src/components/EmergencyConfirmDialog.tsx
  modified:
    - dashboard/src/App.tsx

decisions:
  - "lightweight-charts v5 uses chart.addSeries(AreaSeries, opts) instead of v4 chart.addAreaSeries(opts)"
  - "EmergencyConfirmDialog composes ConfirmDialog with requireConfirmText=CONFIRM rather than duplicating dialog UI"
  - "Discriminated union type for dialog state in ChainControls (none|stop|start|emergency) for type-safe dialog management"
  - "Chart.js centerText plugin for donut center label rather than absolute positioned overlay div"

metrics:
  duration: 9min
  completed: 2026-03-26
---

# Phase 8 Plan 5: Dashboard Pages (Trade History, Risk & Exposure, Chain Controls) Summary

Three remaining dashboard pages built with 10 new components: paginated trade table with CSV export, TradingView Lightweight Charts P&L visualization with green/red area series, Chart.js exposure donut with chain-colored segments, risk gauge progress bars, and per-chain control cards with emergency sell-all requiring typed CONFIRM.

## What Was Built

### Task 1: Trade History Page

Created the Trade History page (`TradeHistory.tsx`) with:
- **TimeRangeSelector** component: button group for 24h/7d/30d/All with active highlight
- **TradeTable** component: all 4 column groups (Core: token/chain/status/P&L, Timing: buy/sell/duration, Amounts: entry/exit/gas, Exit: pool type/fee tier) with client-side sorting and pagination footer showing "Showing X-Y of Z trades"
- **TradeHistory page**: filter bar with time range, chain dropdown (All/ETH/BSC/BASE/ARB), outcome dropdown (All/Profit/Loss), "Apply Filters" button, "Export CSV" button triggering blob download, skeleton loading state, empty state matching UI-SPEC copywriting

### Task 2: Risk & Exposure, Chain Controls, Emergency Sell

Created the Risk & Exposure page (`RiskExposure.tsx`) with:
- **PnLChart**: TradingView Lightweight Charts v5 wrapper with two area series (green above zero, red below zero), dark theme matching surface colors, TimeRangeSelector integrated
- **ExposureDonut**: Chart.js Doughnut with chain-colored segments (ETH #627eea, BSC #f0b90b, Base #0052ff, ARB #28a0f0), center text plugin showing "Total Exposure" label and formatted value
- **RiskGauge**: horizontal progress bar with color transitions at 70% (accent to warning) and 90% (warning to loss)
- Two-column responsive layout: P&L chart spanning left, donut and gauges stacked right

Created the Chain Controls page (`ChainControls.tsx`) with:
- **ChainStatusCard**: status dot + display name, start/stop buttons with correct colors, 4 read-only config sections (Snipe Parameters, Risk Limits, Exit Strategy, Connection Status), masked RPC URL
- **EmergencyConfirmDialog**: composes ConfirmDialog with requireConfirmText="CONFIRM", destructive variant, all UI-SPEC copywriting
- Stop/Start confirmation dialogs with exact copywriting from UI-SPEC
- Emergency sell-all button with double confirmation, error handling per UI-SPEC error states

Updated App.tsx to replace all placeholder routes with actual page components.

## Verification

- TypeScript: `npx tsc --noEmit` exits 0
- Vite build: `npx vite build` succeeds (593KB bundle including charting libraries)
- All UI-SPEC copywriting verified present in source files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] lightweight-charts v5 API change**
- **Found during:** Task 2
- **Issue:** Plan specified `chart.addAreaSeries(options)` which was the v4 API. Lightweight-charts v5.1 uses `chart.addSeries(AreaSeries, options)` with the `AreaSeries` definition object.
- **Fix:** Changed import to include `AreaSeries` from `lightweight-charts` and updated calls to `chart.addSeries(AreaSeries, opts)`
- **Files modified:** `dashboard/src/components/PnLChart.tsx`
- **Commit:** 1037cad

## Commits

| # | Hash | Description |
|---|------|-------------|
| 1 | ecd1706 | feat(08-05): Trade History page with paginated table and CSV export |
| 2 | 1037cad | feat(08-05): Risk & Exposure page, Chain Controls page, emergency sell, and App routing |

## Known Stubs

None. All pages are fully wired to API endpoints with proper data fetching, error handling, and loading states.

## Self-Check: PASSED

- All 10 created files verified present on disk
- Both commits (ecd1706, 1037cad) verified in git log
- SUMMARY.md verified present
