---
phase: 08-monitoring-web-dashboard
plan: 01
subsystem: api
tags: [express, websocket, ws, cookie-auth, helmet, cors, health-check]

# Dependency graph
requires:
  - phase: 06-risk-management
    provides: getPortfolioExposure(), getOpenPositionCount, getTotalExposure from DB
  - phase: 03-sqlite-storage-code-quality
    provides: SQLite DB, getPnL(), pino logger
provides:
  - Express + HTTP + WebSocket server factory (startApiServer)
  - GET /health endpoint with chain connectivity and position data
  - Cookie-based session auth (loginHandler, authMiddleware, validateSession)
  - WebSocket upgrade handler with session validation
  - Typed event broadcaster for real-time position updates
  - Error handler middleware (asyncHandler, errorMiddleware)
  - Test fixtures with mock ChainContext helpers
  - Wave 0 test stubs for positions, trades, risk, chains, controls
affects: [08-02-data-routes, 08-03-control-routes, 08-04-frontend-foundation, 08-05-frontend-pages, 08-06-integration]

# Tech tracking
tech-stack:
  added: [express@5.2, ws@8.20, cookie-parser@1.4, helmet@8.1, cors@2.8, uuid@13.0]
  patterns: [route-factory-pattern, session-map-auth, asyncHandler-wrapper, typed-ws-events]

key-files:
  created:
    - src/api/server.ts
    - src/api/middleware/auth.ts
    - src/api/middleware/errorHandler.ts
    - src/api/routes/health.ts
    - src/api/routes/auth.ts
    - src/api/ws/broadcaster.ts
    - src/api/ws/handler.ts
    - tests/fixtures/api.fixtures.ts
    - tests/api/health.test.ts
    - tests/api/auth.test.ts
    - tests/api/positions.test.ts
    - tests/api/trades.test.ts
    - tests/api/risk.test.ts
    - tests/api/chains.test.ts
    - tests/api/controls.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Express 5.x used (latest stable available at install time)"
  - "In-memory Map for sessions with 24h TTL -- simple, fits single-process bot architecture"
  - "Manual cookie parsing in WebSocket upgrade handler since cookie-parser middleware doesn't run on upgrade events"
  - "noServer mode for WebSocketServer -- upgrade handled via HTTP server event for session validation"

patterns-established:
  - "Route factory pattern: healthRoutes(contexts) returns Router bound to data sources"
  - "asyncHandler wrapper: catches async errors and forwards to Express error middleware"
  - "Session Map with validateSession(): shared between HTTP middleware and WS upgrade handler"
  - "Mock ChainContext fixtures: createMockChainContext/createDisconnectedContext for API tests"

requirements-completed: [MON-01]

# Metrics
duration: 11min
completed: 2026-03-26
---

# Phase 8 Plan 01: API Server Foundation Summary

**Express API server with /health endpoint (200/503), cookie-based auth, WebSocket infrastructure, and Wave 0 test stubs using ws + helmet + cors**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-26T18:53:26Z
- **Completed:** 2026-03-26T19:05:00Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments
- Health endpoint returns chain connectivity, open positions, exposure, and daily P&L with HTTP 200/503 status codes
- Cookie-based session auth with httpOnly + sameSite strict; login validates DASHBOARD_API_KEY
- WebSocket upgrade handler validates session cookie before completing handshake
- Position broadcaster pushes typed JSON events every 5 seconds to authenticated clients
- 7 passing tests (3 health + 4 auth), 14 todo stubs for Wave 0 compliance

## Task Commits

Each task was committed atomically:

1. **Task 1: Install backend dependencies and create test fixtures + stubs** - `a89aa38` (chore)
2. **Task 2: Express server, health endpoint, auth middleware, WebSocket infrastructure** - `c7752b8` (feat)

## Files Created/Modified
- `src/api/server.ts` - Express + HTTP + WebSocket server factory with graceful shutdown
- `src/api/middleware/auth.ts` - Session cookie auth: loginHandler, authMiddleware, validateSession
- `src/api/middleware/errorHandler.ts` - asyncHandler wrapper and Express error middleware
- `src/api/routes/health.ts` - GET /health route factory with chain connectivity checks
- `src/api/routes/auth.ts` - POST /api/auth/login route
- `src/api/ws/broadcaster.ts` - Typed event broadcasting to authenticated WebSocket clients
- `src/api/ws/handler.ts` - WebSocket upgrade handler with session validation
- `tests/fixtures/api.fixtures.ts` - Mock ChainContext, disconnected context, MOCK_API_KEY
- `tests/api/health.test.ts` - Health endpoint tests (200 ok, 503 degraded, chain details)
- `tests/api/auth.test.ts` - Auth login + middleware tests (valid/invalid key, session flow)
- `tests/api/positions.test.ts` - Wave 0 stubs (2 todos)
- `tests/api/trades.test.ts` - Wave 0 stubs (4 todos)
- `tests/api/risk.test.ts` - Wave 0 stubs (3 todos)
- `tests/api/chains.test.ts` - Wave 0 stubs (3 todos)
- `tests/api/controls.test.ts` - Wave 0 stubs (2 todos)
- `package.json` - Added express, ws, cookie-parser, helmet, cors, uuid + types

## Decisions Made
- Express 5.x used (latest stable available at install time) -- backward compatible with Express 4 patterns
- In-memory Map for sessions with 24h TTL -- simple, fits single-process bot architecture; no Redis needed
- Manual cookie parsing in WebSocket upgrade handler since cookie-parser middleware doesn't run on HTTP upgrade events
- noServer mode for WebSocketServer -- upgrade handled via HTTP server event for session validation before handshake
- Tests use Node http module directly instead of supertest to avoid adding another dependency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## Known Stubs
None - all implementation files are fully wired. The it.todo stubs in test files are intentional Wave 0 markers per VALIDATION.md and will be filled in by Plans 02/03.

## User Setup Required
None - no external service configuration required. DASHBOARD_API_KEY env var is documented but not required until the dashboard is used.

## Next Phase Readiness
- API server skeleton ready for data routes (Plan 02: positions, trades, risk endpoints)
- Auth middleware available for protecting all /api/* routes
- WebSocket broadcaster ready for real-time position data (Plan 02 will wire actual position queries)
- Test fixtures established for all subsequent API test files

## Self-Check: PASSED

All 15 created files verified present. Both task commits (a89aa38, c7752b8) verified in git log.

---
*Phase: 08-monitoring-web-dashboard*
*Completed: 2026-03-26*
