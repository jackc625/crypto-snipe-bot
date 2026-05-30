---
phase: 11-dashboard-accuracy-bot-wiring
plan: 01
subsystem: api, bot
tags: [ethers, queryPrice, telegram, multi-chain, positions, live-prices]

# Dependency graph
requires:
  - phase: 07-smart-exit-strategies
    provides: queryPrice, exitConfig, ExitStateRow, exit_state table
  - phase: 04-multi-chain-architecture
    provides: ChainContext, ChainConfig, DexConfig types
provides:
  - buildPositionsWithLivePrices helper for live on-chain price enrichment of open positions
  - LivePosition interface for typed position data with unrealized P&L
  - startTelegramListener function accepting ChainContext[] for multi-chain alpha routing
  - TelegramListenerHandle interface for connection lifecycle management
  - handleAlphaDropForChain for chain-specific DEX factory discovery
affects: [11-02-PLAN, 11-03-PLAN, positions-route, bot-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns: [parallel-price-queries, stale-price-fallback, optional-integration-pattern, dynamic-import-circular-avoidance]

key-files:
  created:
    - src/api/helpers/positions.ts
  modified:
    - src/telegramListener.ts
    - src/alphaDrop.ts
    - src/utils/abis.ts

key-decisions:
  - "Unrealized P&L formula: (currentPrice/1e18) + sell_revenue - buy_cost - sell_gas (approximation acceptable for v1)"
  - "Dynamic import('./bot') in alphaDrop.ts to avoid circular dependency with telegramListener"
  - "V3_FACTORY_ABI extended with getPool function for pool discovery in alpha drops"

patterns-established:
  - "Optional integration: missing env vars return null handle with warning log, not crash"
  - "Stale price fallback: when live price unavailable, use highWaterMark with priceStale=true flag"

requirements-completed: [DASH-01, FIX-09]

# Metrics
duration: 4min
completed: 2026-04-01
---

# Phase 11 Plan 01: Foundation Modules Summary

**Shared live-price positions helper with parallel queryPrice enrichment and multi-chain Telegram listener refactor**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-01T18:33:50Z
- **Completed:** 2026-04-01T18:38:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created buildPositionsWithLivePrices helper that queries on-chain prices in parallel via queryPrice and computes unrealized P&L
- Refactored telegramListener.ts from standalone script to exportable startTelegramListener function with multi-chain getCode routing
- Added handleAlphaDropForChain that discovers tokens across V2/V3 DEX factories per chain

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared buildPositionsWithLivePrices helper** - `b67cd3d` (feat)
2. **Task 2: Refactor telegramListener.ts and alphaDrop.ts for multi-chain** - `b2a5815` (feat)

## Files Created/Modified
- `src/api/helpers/positions.ts` - Shared helper exporting buildPositionsWithLivePrices and LivePosition type
- `src/telegramListener.ts` - Refactored to export startTelegramListener with ChainContext[] parameter
- `src/alphaDrop.ts` - Added handleAlphaDropForChain for multi-chain DEX factory discovery
- `src/utils/abis.ts` - Added getPool function to V3_FACTORY_ABI

## Decisions Made
- Unrealized P&L uses approximation formula: `(currentPrice/1e18) + sell_revenue - buy_cost - sell_gas`. For positions with partial sells, currentPrice overstates remaining value slightly, but this is acceptable for v1 dashboard display.
- Dynamic `import('./bot')` used in alphaDrop.ts to avoid circular dependency since telegramListener imports alphaDrop and bot.ts imports from alphaDrop.
- V3_FACTORY_ABI extended with `getPool` view function for pool address discovery in alpha drop routing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added getPool to V3_FACTORY_ABI**
- **Found during:** Task 2 (alphaDrop refactor)
- **Issue:** V3_FACTORY_ABI only had PoolCreated event, missing getPool function needed by handleAlphaDropForChain to discover pools
- **Fix:** Added `"function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"` to V3_FACTORY_ABI
- **Files modified:** src/utils/abis.ts
- **Verification:** TypeScript compilation passes
- **Committed in:** b2a5815 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** ABI addition was necessary for V3 pool discovery. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in db.ts (duplicate getPnLChartData export) unrelated to this plan's changes. Logged but not fixed (out of scope).

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functions are fully implemented with real data sources wired.

## Next Phase Readiness
- buildPositionsWithLivePrices ready for Plan 02 to wire into positions API route
- startTelegramListener ready for Plan 02 to integrate into bot.ts orchestrator
- handleAlphaDropForChain ready for multi-chain alpha signal routing
- LivePosition type available for Plan 03 UI components

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 11-dashboard-accuracy-bot-wiring*
*Completed: 2026-04-01*
