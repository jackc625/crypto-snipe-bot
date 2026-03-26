---
phase: 08-monitoring-web-dashboard
verified: 2026-03-26T20:25:00Z
status: gaps_found
score: 4/5 success criteria verified
gaps:
  - truth: "Backend TypeScript compilation succeeds (npx tsc --noEmit exits 0)"
    status: failed
    reason: "6 TypeScript errors in src/api route files: query param type narrowing (req.params.name typed as string | string[]) in chains.ts and controls.ts, and inline asyncHandler next parameter typed as Function in positions.ts, risk.ts, trades.ts"
    artifacts:
      - path: "src/api/routes/chains.ts"
        issue: "Lines 113, 140: req.params.name typed as string | string[] — .toLowerCase() call fails TS strict check"
      - path: "src/api/routes/controls.ts"
        issue: "Line 52: req.params.tradeId typed as string | string[] — parseInt() call fails TS strict check"
      - path: "src/api/routes/positions.ts"
        issue: "Line 16: inline asyncHandler uses Function type for next parameter — too broad for TS strict mode"
      - path: "src/api/routes/risk.ts"
        issue: "Line 16: same inline asyncHandler Function type issue"
      - path: "src/api/routes/trades.ts"
        issue: "Line 12: same inline asyncHandler Function type issue"
    missing:
      - "Cast req.params.name and req.params.tradeId to string in chains.ts and controls.ts (e.g., String(req.params.name))"
      - "Type next parameter as NextFunction in inline asyncHandler in positions.ts, risk.ts, trades.ts (import NextFunction from express)"
  - truth: "All automated tests pass (health test: returns chain details)"
    status: failed
    reason: "Test expects latestBlock=12345 but createMockChainContext fixture returns 12345678 — a test/fixture mismatch introduced when fixture was updated in Plan 03 without updating the health test assertion"
    artifacts:
      - path: "tests/api/health.test.ts"
        issue: "Line 92: expects chains[0].latestBlock to be 12345 but fixture getBlockNumber returns 12345678"
      - path: "tests/fixtures/api.fixtures.ts"
        issue: "Line 48: getBlockNumber returns 12345678, inconsistent with health test expectation of 12345"
    missing:
      - "Align fixture and test: either change fixture getBlockNumber to return 12345 to match the original plan specification, or update the test assertion to match the current fixture value (12345678)"
human_verification:
  - test: "Visual dashboard navigation"
    expected: "All 4 pages (Overview, Trade History, Risk & Exposure, Chain Controls) render correctly with dark theme. No white backgrounds. Sidebar collapses to icon-only rail."
    why_human: "Visual rendering cannot be verified programmatically. Requires browser check."
  - test: "Real-time WebSocket position updates"
    expected: "With bot running, position table on Overview page updates every 5 seconds as the broadcaster pushes positions_update events"
    why_human: "Requires running bot process and live WebSocket connection"
  - test: "Force sell and emergency sell end-to-end"
    expected: "Force sell button triggers actual sell on chain. Emergency sell-all with CONFIRM gate sells all open positions."
    why_human: "Requires live chain context and open positions to verify sell execution flow"
---

# Phase 8: Monitoring & Web Dashboard — Verification Report

**Phase Goal:** A web interface provides real-time visibility into all bot operations, positions, risk metrics, and historical performance
**Verified:** 2026-03-26T20:25:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (From ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | HTTP health check endpoint returns bot liveness, per-chain connectivity status, and open position count | VERIFIED | `src/api/routes/health.ts` exists, returns `{ status, uptime, chains, positions }` with 200/503 status codes based on chain connectivity. Wired into server.ts at `/health`. |
| 2 | Dashboard displays all open positions with current P&L, token name, chain, entry price, current price — updating in real time | VERIFIED | `src/api/routes/positions.ts` serves open positions with exit state. `dashboard/src/pages/Overview.tsx` renders them via `useWs()` context receiving `positions_update` events every 5 seconds. |
| 3 | Historical trade log is filterable by chain, date range, and profit/loss outcome | VERIFIED | `src/api/routes/trades.ts` supports `chain`, `from`, `to`, `outcome` query params with 7-day default. `dashboard/src/pages/TradeHistory.tsx` renders filter bar and calls `/api/trades`. |
| 4 | Bot can be started/stopped per chain and snipe parameters adjusted from the dashboard without restarting the process | VERIFIED | `src/api/routes/chains.ts` exports `POST /:name/stop` (removes WS listeners, adds to stoppedChains) and `POST /:name/start`. `dashboard/src/pages/ChainControls.tsx` calls these endpoints with confirmation dialogs. |
| 5 | Risk dashboard shows portfolio exposure, daily P&L curve, and position limit utilization | VERIFIED | `src/api/routes/risk.ts` serves `/exposure`, `/pnl`, `/limits`. `dashboard/src/pages/RiskExposure.tsx` renders PnLChart (Lightweight Charts), ExposureDonut (Chart.js), and RiskGauge components. |

**Score:** 5/5 success criteria functionally verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/api/server.ts` | Express + HTTP + WebSocket server factory | VERIFIED | Exports `startApiServer(contexts)`, mounts all routes, handles WebSocket upgrade, broadcasts every 5s |
| `src/api/middleware/auth.ts` | Session cookie auth | VERIFIED | Exports `loginHandler`, `authMiddleware`, `validateSession`. httpOnly, sameSite strict. |
| `src/api/middleware/errorHandler.ts` | Async error wrapper | VERIFIED | Exports `asyncHandler` and `errorMiddleware` |
| `src/api/routes/health.ts` | GET /health factory | VERIFIED | Returns chain connectivity, position count, exposure, dailyPnL |
| `src/api/routes/auth.ts` | POST /api/auth/login | VERIFIED | Routes to loginHandler |
| `src/api/routes/positions.ts` | GET /api/positions | VERIFIED | Returns open positions with exit state, urgency %, high-water mark |
| `src/api/routes/trades.ts` | GET /api/trades + /export | VERIFIED | Paginated, filtered; CSV export with Content-Disposition header |
| `src/api/routes/risk.ts` | GET /api/risk/* | VERIFIED | /exposure, /pnl (cumulative), /limits (utilization) |
| `src/api/routes/chains.ts` | GET /api/chains + stop/start | VERIFIED | Status with masked RPC URLs, read-only config, stop/start with stoppedChains Set |
| `src/api/routes/controls.ts` | Force sell + emergency sell | VERIFIED | Pitfall 3 prevention (clearAllTimersForToken before executeFullSell), sequential emergency sell |
| `src/api/ws/broadcaster.ts` | Typed WS broadcast | VERIFIED | broadcast(), addClient(), getClientCount() with OPEN-state check |
| `src/api/ws/handler.ts` | WebSocket upgrade handler | VERIFIED | Session cookie validation, only accepts /ws path |
| `dashboard/src/App.tsx` | 4-page React SPA | VERIFIED | BrowserRouter with AuthGuard, WebSocketProvider, all 4 routes wired |
| `dashboard/src/pages/Overview.tsx` | Command center | VERIFIED | Stat cards, PositionTable, EventFeed, risk gauges, force sell dialog |
| `dashboard/src/pages/TradeHistory.tsx` | Trade log | VERIFIED | Filters, pagination, CSV export, TimeRangeSelector |
| `dashboard/src/pages/RiskExposure.tsx` | Risk charts | VERIFIED | PnLChart, ExposureDonut, RiskGauge components |
| `dashboard/src/pages/ChainControls.tsx` | Chain controls | VERIFIED | ChainStatusCard per chain, start/stop with ConfirmDialog, emergency sell with CONFIRM gate |
| `dashboard/src/hooks/useWebSocket.ts` | WS hook with reconnect | VERIFIED | 3-second auto-reconnect, handles positions_update, notification, chain_status events |
| `dashboard/src/index.css` | Tailwind v4 @theme tokens | VERIFIED | All color/font tokens match UI-SPEC exactly including `--color-surface: #0f172a` |
| `src/bot.ts` | startApiServer wiring | VERIFIED | Imports and calls `startApiServer(contexts)` after chain listeners, `apiServer.close()` in shutdown |
| `src/utils/notifier.ts` | Notification broadcast bridge | VERIFIED | Imports `broadcast`, calls `broadcast('notification', ...)` in both `sendTelegramAlert` and `sendCtxAlert` |
| `.env.example` | Dashboard env vars | VERIFIED | DASHBOARD_API_KEY, DASHBOARD_PORT=8080, DASHBOARD_HOST=127.0.0.1, 0.0.0.0 remote note |
| `tests/fixtures/api.fixtures.ts` | Mock ChainContext | VERIFIED | createMockChainContext, createDisconnectedContext, MOCK_API_KEY |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/api/server.ts` | `src/api/routes/health.ts` | `app.use('/health', healthRoutes(contexts))` | WIRED | Line 55 of server.ts |
| `src/api/server.ts` | `src/api/middleware/auth.ts` | `app.use('/api', authMiddleware, apiRouter)` | WIRED | Line 67 of server.ts |
| `src/api/ws/handler.ts` | `src/api/middleware/auth.ts` | `validateSession(token)` on upgrade | WIRED | Line 54 of handler.ts |
| `src/bot.ts` | `src/api/server.ts` | `startApiServer(contexts)` call | WIRED | Line 966 of bot.ts; shutdown at line 1039 |
| `src/utils/notifier.ts` | `src/api/ws/broadcaster.ts` | `broadcast('notification', ...)` | WIRED | Lines 54 and 91 of notifier.ts |
| `dashboard/src/hooks/useApi.ts` | `/api/*` | `fetch` with `credentials: 'include'` | WIRED | Cookie auth present |
| `dashboard/src/hooks/useWebSocket.ts` | `/ws` | `new WebSocket(...)` with auto-reconnect | WIRED | 3s reconnect at line 98 |
| `dashboard/src/pages/Overview.tsx` | `useWebSocket.ts` | `positions_update` events drive table | WIRED | `useWs()` consumed at line 12; positions fed to PositionTable |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `src/api/routes/health.ts` | `posResult`, `exposure`, `pnlRows` | `getOpenPositionCount.get()`, `getPortfolioExposure()`, `getPnL()` | Yes — DB queries and riskManager | FLOWING |
| `src/api/routes/positions.ts` | `allTrades`, `exitState` | `getPnL()`, `getExitState.get(tradeId)` | Yes — DB queries | FLOWING |
| `src/api/routes/trades.ts` | `trades` | `getPnL({ chain, fromTimestamp, toTimestamp })` | Yes — DB query with filters | FLOWING |
| `src/api/routes/risk.ts` | `exposure`, `trades`, `posResult`, `expResult` | `getPortfolioExposure()`, `getPnL()`, `getOpenPositionCount.get()`, `getTotalExposure.get()` | Yes — DB queries and riskManager | FLOWING |
| `dashboard/src/pages/Overview.tsx` | `positions` | `useWs()` context, seeded by `positions_update` WS events and REST on reconnect | Yes — WS events from broadcaster, backed by DB queries in server.ts interval | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Dashboard TypeScript compiles | `cd dashboard && npx tsc --noEmit` | Zero errors | PASS |
| Dashboard Vite build produces artifacts | `cd dashboard && npx vite build` | 593KB bundle in dashboard/dist/assets/ | PASS |
| API tests pass (45/46) | `npx vitest run tests/api/` | 45 passed, 1 failed (fixture/assertion mismatch in health test) | PARTIAL |
| Backend TypeScript compilation | `npx tsc --noEmit` | 6 errors in src/api route files | FAIL |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|---------|
| MON-01 | 08-01, 08-06 | HTTP health check endpoint exposes bot liveness, chain connectivity status, and open position count | SATISFIED | `src/api/routes/health.ts` returns 200/503 with chain array, open count, exposure. Wired in both server.ts and bot.ts. |
| DASH-01 | 08-02, 08-04 | Web dashboard displays real-time open positions with current P&L per token and chain | SATISFIED | Positions API + Overview page + WebSocket push every 5s. PositionTable with expandable rows showing exit state, urgency, P&L. |
| DASH-02 | 08-02, 08-05 | Historical trade log with filtering by chain, date range, and profit/loss | SATISFIED | `src/api/routes/trades.ts` with all filters, pagination, CSV export. TradeHistory page with Apply Filters and Export CSV buttons. |
| DASH-03 | 08-03, 08-05 | Bot controls accessible from dashboard (start/stop per chain, adjust snipe parameters) | SATISFIED | chainRoutes stop/start with stoppedChains, controlRoutes force/emergency sell. ChainControls page with confirmation dialogs and emergency CONFIRM gate. |
| DASH-04 | 08-02, 08-04, 08-05 | Risk dashboard shows portfolio exposure, daily P&L curve, and position limit utilization | SATISFIED | `/api/risk/exposure`, `/pnl`, `/limits` endpoints. RiskExposure page with PnLChart (Lightweight Charts), ExposureDonut (Chart.js), RiskGauge components. |

**Requirements coverage: 5/5 — all phase 8 requirements implemented**

---

### Anti-Patterns Found

| File | Lines | Pattern | Severity | Impact |
|------|-------|---------|----------|--------|
| `src/api/routes/chains.ts` | 113, 140 | `req.params.name.toLowerCase()` — params typed as `string \| string[]` | Warning | TypeScript compilation fails; runtime behavior works because Express always provides string params |
| `src/api/routes/controls.ts` | 52 | `req.params.tradeId` passed to parseInt — typed as `string \| string[]` | Warning | Same as above — TS error, runtime safe |
| `src/api/routes/positions.ts` | 16 | Inline asyncHandler next typed as `Function` | Warning | TS strict mode error; functional at runtime |
| `src/api/routes/risk.ts` | 16 | Same inline asyncHandler pattern | Warning | Same |
| `src/api/routes/trades.ts` | 12 | Same inline asyncHandler pattern | Warning | Same |
| `tests/fixtures/api.fixtures.ts` | 48 | `getBlockNumber: async () => 12345678` — inconsistent with health.test.ts assertion of `12345` | Warning | 1 test failure in `returns chain details` — does not represent an implementation defect |

None of the above anti-patterns are blockers for runtime behavior. The TypeScript errors are strict-mode type narrowing issues, not logic errors. Express always provides string path params; the errors are annotation-only.

---

### Human Verification Required

#### 1. Visual Dashboard Rendering

**Test:** Start bot with `npx ts-node src/bot.ts` (requires valid .env). In another terminal: `cd dashboard && npm run dev`. Open http://localhost:5173.
**Expected:** Dark theme throughout (background #0f172a). Login page with "Dashboard Login" heading. After login, Overview with 4 stat cards and sidebar with 4 nav items. Sidebar collapses to icon-only rail.
**Why human:** Visual appearance cannot be verified programmatically.

#### 2. Real-Time Position Updates

**Test:** With bot running and at least one open position, watch the Overview page positions table.
**Expected:** Table updates every 5 seconds as the broadcaster pushes `positions_update` events with current P&L values.
**Why human:** Requires live chain connections and active positions to observe real-time updates.

#### 3. Chain Start/Stop Controls

**Test:** Navigate to Chain Controls page. Click "Stop Listening" on an active chain, confirm the dialog.
**Expected:** Chain card status changes to "Stopped". New pair/pool events stop arriving for that chain. Existing positions continue to be monitored by exit engine.
**Why human:** Requires running bot with active chain listeners to observe behavioral change.

#### 4. Emergency Sell Confirmation Gate

**Test:** Navigate to Chain Controls page. Click "Emergency Sell All Positions". Type anything other than "CONFIRM" in the input.
**Expected:** "Sell All Positions" button remains disabled until exact text "CONFIRM" is entered.
**Why human:** Input validation behavior requires interactive browser testing.

---

### Gaps Summary

Two gaps prevent a clean PASSED status:

**Gap 1 — TypeScript compilation errors (6 errors):** Pre-existing issues noted in 08-06 SUMMARY. Three route files (positions.ts, risk.ts, trades.ts) use an inline `asyncHandler` that types the `next` parameter as `Function` rather than `NextFunction`. Two route files (chains.ts, controls.ts) access `req.params.name` / `req.params.tradeId` without narrowing the type from `string | string[]` to `string`. These are annotation errors — runtime behavior is correct. Fix: import `NextFunction` from express in the three route files and cast `req.params.*` values.

**Gap 2 — One failing test (fixture/assertion mismatch):** `tests/api/health.test.ts` line 92 asserts `chains[0].latestBlock` equals `12345`, but `createMockChainContext` in `api.fixtures.ts` returns `12345678` from `getBlockNumber`. The original Plan 01 specification called for the fixture to return `12345`; this was changed when Plan 03 updated the fixture. Fix: update fixture to return `12345` (matching original spec) OR update the test assertion to accept `12345678`.

Both gaps are narrow, isolated, and do not affect the functional correctness of the dashboard at runtime.

---

_Verified: 2026-03-26T20:25:00Z_
_Verifier: Claude (gsd-verifier)_
