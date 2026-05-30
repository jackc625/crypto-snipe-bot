---
phase: 11-dashboard-accuracy-bot-wiring
plan: 02
subsystem: api, bot
tags: [positions, live-prices, chain-restart, telegram, websocket, onRestart, warnings]

# Dependency graph
requires:
  - phase: 11-dashboard-accuracy-bot-wiring
    plan: 01
    provides: buildPositionsWithLivePrices helper, startTelegramListener function, TelegramListenerHandle interface
  - phase: 08-web-dashboard
    provides: Express API server, WebSocket broadcaster, route factories
provides:
  - Positions route wired to shared buildPositionsWithLivePrices helper for live on-chain prices
  - Chain restart POST endpoint returning warnings array for partial failures
  - Health endpoint with telegramConnected and telegramError fields
  - bot.ts onRestart callback with WS reconnect, MEV health check, per-DEX listener restart
  - Telegram listener integrated into bot orchestrator with graceful shutdown
  - WebSocket 5s push using same shared helper as REST endpoint
  - Exported startDexListener for reuse by onRestart callback
affects: [11-03-PLAN, dashboard-ui, chain-controls]

# Tech tracking
tech-stack:
  added: []
  patterns: [onRestart-callback-with-warnings, mutable-closure-for-late-init, fire-and-forget-disconnect]

key-files:
  created: []
  modified:
    - src/api/routes/positions.ts
    - src/api/routes/chains.ts
    - src/api/routes/health.ts
    - src/bot.ts
    - src/api/server.ts

key-decisions:
  - "Mutable closure pattern for telegramHandle: declared before startApiServer, populated after, closure reads by reference"
  - "Fire-and-forget .catch() for telegram disconnect in shutdown handler (shutdown is synchronous, cannot await)"
  - "RestartChainListenersCallback returns { warnings: string[] } instead of void for D-12 partial failure reporting"

patterns-established:
  - "onRestart callback pattern: WS reconnect -> MEV health check -> per-DEX listener restart, all non-blocking with warnings"
  - "Late-init closure: declare mutable variable, pass closure to consumer, populate variable later"

requirements-completed: [DASH-01, DASH-03, FIX-09]

# Metrics
duration: 5min
completed: 2026-04-01
---

# Phase 11 Plan 02: Backend Wiring Summary

**End-to-end wiring of live-price positions, chain restart with warnings, and Telegram integration into bot orchestrator**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-01T18:47:03Z
- **Completed:** 2026-04-01T18:52:31Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Rewrote positions route to delegate entirely to shared buildPositionsWithLivePrices helper (D-06, D-08)
- Updated chain restart endpoint to return warnings array for partial DEX listener failures (D-12)
- Added telegramConnected/telegramError to health endpoint (D-19)
- Built onRestart callback in bot.ts with WS reconnect, MEV health check, and per-DEX listener restart
- Integrated startTelegramListener into startMultiChainBot with graceful degradation and shutdown disconnect
- Replaced WS broadcast with same shared helper used by REST endpoint (D-07, D-08)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite positions route, chain restart response, and health telegram status** - `fde15ac` (feat)
2. **Task 2: Wire bot.ts orchestrator and server.ts for onRestart, telegram, and WS push** - `166d547` (feat)

## Files Created/Modified
- `src/api/routes/positions.ts` - Simplified to delegate to buildPositionsWithLivePrices; removed all inline logic
- `src/api/routes/chains.ts` - RestartChainListenersCallback now returns warnings array; start handler includes warnings in response
- `src/api/routes/health.ts` - Added getTelegramStatus parameter and telegramConnected/telegramError response fields
- `src/bot.ts` - Exported startDexListener; built onRestart callback; integrated Telegram listener; added telegram disconnect to shutdown
- `src/api/server.ts` - Updated startApiServer signature with onRestart and getTelegramStatus; replaced WS broadcast with shared helper

## Decisions Made
- Used mutable closure pattern for telegramHandle: declared before startApiServer but populated after, so the getTelegramStatus closure reads the updated value by reference. This avoids blocking API startup on telegram connection.
- Fire-and-forget `.catch()` for telegram disconnect in shutdown handler since `gracefulShutdown` is synchronous and cannot await async operations.
- RestartChainListenersCallback return type changed from `Promise<void>` to `Promise<{ warnings: string[] }>` to support D-12 partial failure reporting.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in db.ts (duplicate getPnLChartData export) unrelated to this plan's changes. Same as Plan 01, logged but not fixed (out of scope).

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functions are fully implemented with real data sources wired.

## Next Phase Readiness
- All three backend requirement gaps (DASH-01, DASH-03, FIX-09) are now wired end-to-end
- Plan 03 (UI updates) can consume the updated REST/WS response shapes with live prices, warnings, and telegram status
- startDexListener export available for any future consumers needing to restart DEX listeners

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 11-dashboard-accuracy-bot-wiring*
*Completed: 2026-04-01*
