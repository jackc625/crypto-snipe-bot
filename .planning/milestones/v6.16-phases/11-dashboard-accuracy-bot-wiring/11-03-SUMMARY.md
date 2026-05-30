---
phase: 11-dashboard-accuracy-bot-wiring
plan: 03
subsystem: ui, dashboard
tags: [react, tailwind, typescript, live-prices, telegram, chain-restart]

# Dependency graph
requires:
  - phase: 11-dashboard-accuracy-bot-wiring
    plan: 01
    provides: LivePosition interface with priceStale, unrealizedPnl, sellRevenue fields; HealthResponse with telegramConnected/telegramError
  - phase: 08-dashboard
    provides: Sidebar, Layout, ChainStatusCard, PositionTable, ChainControls components
provides:
  - Dashboard Position type extended with priceStale, unrealizedPnl, sellRevenue
  - Dashboard HealthResponse type extended with telegramConnected, telegramError
  - Stale price visual indicator in PositionTable (warning color + suffix + tooltip)
  - Unrealized P&L display replacing realized P&L in PositionTable
  - Telegram connection status in Sidebar footer
  - Dismissible chain restart warning banner in ChainStatusCard
  - Per-chain warning state management in ChainControls
affects: [11-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [health-data-derived-ui-state, per-entity-warning-state-management]

key-files:
  created: []
  modified:
    - dashboard/src/types/api.ts
    - dashboard/src/components/PositionTable.tsx
    - dashboard/src/components/Sidebar.tsx
    - dashboard/src/components/Layout.tsx
    - dashboard/src/components/ChainStatusCard.tsx
    - dashboard/src/pages/ChainControls.tsx

key-decisions:
  - "Layout.tsx fetches /health via useApi to derive telegramStatus -- avoids adding telegram state to WebSocket context"
  - "telegramStatus 'not-configured' treated as 'disconnected' for StatusDot (red dot) but with distinct label text for user clarity"
  - "Per-chain warnings stored as Record<string, string[]> in ChainControls state, cleared on new start/stop action"
  - "version field kept in HealthResponse for backward compatibility even though backend may not return it"

patterns-established:
  - "Health-derived UI state: Layout fetches /health and passes derived props to child components"
  - "Per-entity dismissible warning: warnings keyed by entity name in Record, dismissed by deleting key"

requirements-completed: [DASH-01, DASH-03, FIX-09]

# Metrics
duration: 5min
completed: 2026-04-01
---

# Phase 11 Plan 03: Dashboard Frontend Updates Summary

**Dashboard displays stale price indicators, unrealized P&L, Telegram connection status, and dismissible chain restart warnings**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-01T18:46:49Z
- **Completed:** 2026-04-01T18:52:07Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Extended Position and HealthResponse TypeScript interfaces with new backend fields (priceStale, unrealizedPnl, sellRevenue, telegramConnected, telegramError)
- PositionTable shows warning-colored stale prices with "(stale)" suffix and tooltip, and uses unrealizedPnl for P&L display
- Sidebar footer displays Telegram connection status with three states (Connected/Disconnected/Not configured) using StatusDot component
- ChainStatusCard renders dismissible warning banner when chain restart returns warnings
- ChainControls manages per-chain warning state, captures warnings from start response, and clears on new actions

## Task Commits

Each task was committed atomically:

1. **Task 1: Update TypeScript types and PositionTable for live prices** - `9d79a7c` (feat)
2. **Task 2: Add Telegram status to Sidebar, update Layout, and add restart warnings** - `57b6318` (feat)

## Files Created/Modified
- `dashboard/src/types/api.ts` - Added priceStale, unrealizedPnl, sellRevenue to Position; telegramConnected, telegramError to HealthResponse
- `dashboard/src/components/PositionTable.tsx` - Stale price indicator with warning color/tooltip; unrealizedPnl for P&L display and sorting
- `dashboard/src/components/Sidebar.tsx` - Telegram status line below WS status with three-state label
- `dashboard/src/components/Layout.tsx` - Fetches /health, derives telegramStatus, passes to Sidebar
- `dashboard/src/components/ChainStatusCard.tsx` - Dismissible warning banner for restart warnings
- `dashboard/src/pages/ChainControls.tsx` - Per-chain warning state management with capture and dismiss handlers

## Decisions Made
- Layout.tsx fetches /health via useApi to derive telegramStatus rather than adding telegram state to the WebSocket context. This keeps the WebSocket context focused on real-time streaming data.
- The telegramStatus 'not-configured' state uses StatusDot 'disconnected' (red) but shows distinct label text "Telegram: Not configured" for user clarity, matching the UI-SPEC Sidebar Footer specification.
- Per-chain warnings stored as Record<string, string[]> in ChainControls state. Warnings are cleared on new start/stop action to prevent stale warning display.
- Kept version field in HealthResponse interface for backward compatibility.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all UI components are wired to real API data sources. Stale price, unrealized P&L, telegram status, and chain warnings all consume live backend data.

## Next Phase Readiness
- Dashboard now fully displays all enriched data from Plan 01/02 backend changes
- Ready for Plan 04 test coverage of the new UI behaviors

## Self-Check: PASSED

All 6 modified files exist on disk. Both task commits verified (9d79a7c, 57b6318). TypeScript compilation passes.
