---
phase: 08-monitoring-web-dashboard
plan: 03
subsystem: api
tags: [express, rest-api, chain-control, force-sell, emergency-sell, exit-engine]

# Dependency graph
requires:
  - phase: 07-smart-exit-strategies
    provides: "executeFullSell, exitConfig, clearAllTimersForToken, tryAcquireSellLock"
  - phase: 04-multi-chain-architecture
    provides: "ChainContext, ChainConfig, DexConfig types"
  - phase: 03-sqlite-storage-code-quality
    provides: "SQLite trades table, db prepared statements"
provides:
  - "GET /api/chains endpoint with per-chain status and read-only config display"
  - "POST /api/chains/:name/stop and /start for chain listener control"
  - "POST /api/controls/force-sell/:tradeId for single position sell"
  - "POST /api/controls/emergency-sell for all-positions sell"
  - "Express server.ts mounting chain and control routes under /api"
  - "Shared test fixtures for API route testing"
affects: [08-04, 08-05, 08-06, dashboard-frontend]

# Tech tracking
tech-stack:
  added: [express, "@types/express"]
  patterns: ["Express Router per-route-module", "mock ChainContext fixtures for testing", "raw http request helper for Vitest Express tests"]

key-files:
  created:
    - src/api/routes/chains.ts
    - src/api/routes/controls.ts
    - src/api/server.ts
    - tests/api/chains.test.ts
    - tests/api/controls.test.ts
    - tests/fixtures/api.fixtures.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Force sell delegates lock management to executeFullSell instead of duplicating tryAcquireSellLock in route handler (prevents non-reentrant lock deadlock)"
  - "Sequential execution for emergency sell (not Promise.allSettled) for safer sell mutex management"
  - "maskUrl extracts hostname via URL constructor for safe RPC URL display"
  - "RestartChainListenersCallback is optional -- graceful degradation when bot doesn't provide restart function"

patterns-established:
  - "API route modules export factory functions accepting ChainContext[] and shared state"
  - "Mock ChainContext fixtures in tests/fixtures/api.fixtures.ts for all API route tests"
  - "Pitfall 3 prevention: clearAllTimersForToken before sell operations"

requirements-completed: [DASH-03]

# Metrics
duration: 15min
completed: 2026-03-26
---

# Phase 08 Plan 03: Bot Control API Routes Summary

**Express chain start/stop and force/emergency sell routes with Pitfall 3 sell-mutex safety and 20 passing tests**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-26T18:53:30Z
- **Completed:** 2026-03-26T19:08:30Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Chain status endpoint serves running/stopped/disconnected with masked RPC URLs and read-only config display (snipeParams, riskLimits, exitStrategy, connection)
- Chain stop removes WS event listeners but keeps exit monitoring active per D-14
- Force sell follows safe mutex sequence per Pitfall 3: clear timers then let executeFullSell handle its own lock acquisition
- Emergency sell iterates all pending positions sequentially with per-position error tracking
- Express server.ts mounts both route modules and exposes stoppedChains shared state
- 20 tests covering all route operations pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Chain status and control routes** - `92e656a` (feat)
2. **Task 2: Force sell and emergency sell control routes** - `cbd8b21` (feat)

## Files Created/Modified
- `src/api/routes/chains.ts` - GET /chains status, POST stop/start with maskUrl helper
- `src/api/routes/controls.ts` - POST force-sell/:tradeId and emergency-sell with Pitfall 3 prevention
- `src/api/server.ts` - Express server mounting routes under /api prefix with stoppedChains Set
- `tests/api/chains.test.ts` - 11 tests for chain status and control routes
- `tests/api/controls.test.ts` - 9 tests for force sell and emergency sell
- `tests/fixtures/api.fixtures.ts` - Mock ChainContext, ChainConfig, and trade row factories
- `package.json` - Added express and @types/express dependencies
- `package-lock.json` - Updated lockfile

## Decisions Made
- **Force sell lock delegation:** The plan specified manually calling tryAcquireSellLock before executeFullSell, but executeFullSell already acquires the lock internally (non-reentrant). Calling it twice would deadlock. Solution: clear timers first (Pitfall 3), then let executeFullSell handle its own lock lifecycle.
- **Sequential emergency sell:** Used sequential iteration instead of Promise.allSettled to prevent multiple concurrent sell lock acquisitions competing with each other.
- **Optional restart callback:** chainRoutes accepts an optional RestartChainListenersCallback since startDexListener is not exported from bot.ts. Graceful degradation with informative response when callback not provided.
- **urgency-market-sell reason:** Used existing executeFullSell reason union value 'urgency-market-sell' for force sell operations since the function's type doesn't include 'force-sell'.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed sell lock deadlock in force sell sequence**
- **Found during:** Task 2 (force sell implementation)
- **Issue:** Plan specified calling tryAcquireSellLock before executeFullSell, but executeFullSell already acquires the same non-reentrant lock internally. This would always deadlock.
- **Fix:** Removed manual lock acquisition from route handler. Route calls clearAllTimersForToken first (Pitfall 3), then delegates entirely to executeFullSell which handles its own lock/unlock in a try/finally.
- **Files modified:** src/api/routes/controls.ts
- **Verification:** 9 control tests pass including lock-held scenario returning 409
- **Committed in:** cbd8b21 (Task 2 commit)

**2. [Rule 3 - Blocking] Installed missing Express dependency**
- **Found during:** Task 1 (chain routes implementation)
- **Issue:** Express was not in package.json dependencies -- route modules cannot compile without it
- **Fix:** Ran `npm install --legacy-peer-deps express @types/express`
- **Files modified:** package.json, package-lock.json
- **Verification:** TypeScript imports resolve, all tests pass
- **Committed in:** 92e656a (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug prevention, 1 blocking dependency)
**Impact on plan:** Both auto-fixes essential for correctness and compilation. No scope creep.

## Issues Encountered
None beyond the documented deviations.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Chain and control routes ready for mounting in bot.ts when server integration is implemented
- stoppedChains shared state ready for WebSocket broadcast of chain status changes
- API fixtures in tests/fixtures/api.fixtures.ts ready for reuse by future route tests
- Express server.ts ready for health check, data routes, auth middleware, and WebSocket setup in subsequent plans

## Self-Check: PASSED

All 7 created files verified on disk. Both task commits (92e656a, cbd8b21) verified in git log.

---
*Phase: 08-monitoring-web-dashboard*
*Completed: 2026-03-26*
