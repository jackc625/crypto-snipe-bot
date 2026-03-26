# Phase 8: Monitoring & Web Dashboard - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

A web interface providing real-time visibility into all bot operations, positions, risk metrics, and historical performance. Includes an HTTP health check endpoint for monitoring tools, a multi-page dashboard with WebSocket-driven live updates, bot controls (start/stop per chain, emergency sell, force sell), and an authenticated API layer. The dashboard runs in the same process as the bot for direct access to in-memory state. No new trading logic, safety checks, or exit strategies -- only surfacing existing data and adding control endpoints.

</domain>

<decisions>
## Implementation Decisions

### Tech stack & architecture
- **D-01:** Web framework is **Express.js**. Fits the existing Node.js/TypeScript stack, mature ecosystem, simple to add.
- **D-02:** Frontend approach is **Claude's discretion** -- pick the best option (React SPA, server-rendered, or lightweight framework) based on project needs and complexity.
- **D-03:** Dashboard runs in the **same process** as the bot. Express server starts inside `bot.ts` alongside chain listeners. Direct access to in-memory chain contexts, exit monitors, and SQLite. Single process to deploy.
- **D-04:** CSS framework is **Tailwind CSS**. Utility-first, fast to build, great dark theme support.
- **D-05:** Dashboard uses **charts + tables**. Charting library for P&L curves and exposure visualization. Data tables for positions and trade history.
- **D-06:** **Dark theme only**. Crypto/trading dashboards are universally dark-themed. No light theme toggle.
- **D-07:** Frontend source code lives in **`dashboard/`** at project root. Separate directory with its own package.json and Vite config. Build output served by Express as static files.

### Real-time data delivery
- **D-08:** Real-time updates via **WebSocket push**. Full duplex, server pushes position updates, new trades, and chain status changes.
- **D-09:** Position data updates every **5 seconds**, matching the exit engine's poll interval (Phase 7 D-04). Natural heartbeat.
- **D-10:** Dashboard includes a **live notifications feed** showing events as they happen. Rolling buffer of **100 events** in the browser.
- **D-11:** WebSocket library choice is **Claude's discretion** -- pick `ws` (raw/lightweight) or Socket.IO based on what fits best.

### Bot controls & safety
- **D-12:** Dashboard provides **start/stop per chain** with **read-only parameter display**. Parameters are changed via env vars and restart, not from the dashboard.
- **D-13:** Chain start/stop requires a **confirmation dialog** -- prevents accidental clicks on a dashboard that controls real money.
- **D-14:** When a chain is stopped, **existing positions continue being monitored** by the exit engine. Only new pair/pool listeners stop. Orderly wind-down.
- **D-15:** Dashboard includes an **emergency sell-all button** with **double confirmation** (confirm dialog + type "CONFIRM"). Nuclear option for emergencies.
- **D-16:** Each open position has a **force sell button** with confirmation. Triggers market sell for that specific token.

### Auth & access control
- **D-17:** Authentication via **API key / bearer token**. Set `DASHBOARD_API_KEY` in .env. Single-operator model.
- **D-18:** Login flow: POST `/api/auth/login` with API key returns an **httpOnly session cookie**. Subsequent requests use the cookie. XSS-resistant.
- **D-19:** Dashboard binds to **localhost (127.0.0.1) by default**. Configurable via `DASHBOARD_HOST` env var for remote access. Defense in depth.
- **D-20:** Health check endpoint (`GET /health`) is **unauthenticated**. Standard for monitoring tools.
- **D-21:** Dashboard port defaults to **8080**. Configurable via `DASHBOARD_PORT` env var.

### Dashboard layout & pages
- **D-22:** Primary view is an **overview / command center**: stat cards (total P&L, open positions, exposure), positions table, risk gauges, live event feed.
- **D-23:** Navigation is **multi-page with collapsible sidebar**. Sidebar collapses to icon-only rail for more screen space.
- **D-24:** Pages: **Overview** (home/command center), **Trade History** (filtered trade log), **Risk & Exposure** (charts/metrics), **Chain Controls** (per-chain toggles and config display).

### Historical trade log
- **D-25:** Trade history uses **paginated tables** (25-50 rows per page). Server-side filtering.
- **D-26:** **CSV export** supported -- download button exports filtered results. Useful for tax reporting.
- **D-27:** Table columns include **all four groups**: Core (token, chain, action, P&L), Timing (date, duration held), Amounts (entry, exit, gas), Exit details (strategy, peak price).
- **D-28:** Default time range is **last 7 days**. Expandable to 24h, 30d, or all time.

### Health check endpoint
- **D-29:** `GET /health` returns **comprehensive data**: liveness + uptime, per-chain connectivity status, position summary (count + exposure + daily P&L), bot version + config summary.
- **D-30:** Uses **HTTP status codes**: 200 = all good, 503 = degraded (e.g., chain disconnected). Monitoring tools alert on non-200.

### Risk dashboard
- **D-31:** P&L over time shown as a **cumulative line chart**. Green above zero, red below.
- **D-32:** P&L chart time range selector: **24h / 7d / 30d / All**. Default 7d.
- **D-33:** Portfolio exposure shown as a **donut chart by chain**. Color-coded per chain with total in center.

### Open positions display
- **D-34:** Each position row shows exit strategy info: **exit mode indicator** (trailing stop/fixed SL/urgency), **partial sell progress**, **high-water mark**, **time held + urgency percentage**.
- **D-35:** Position rows are **expandable** -- compact view with key info, click to expand for exit details, partial sells, volatility, gas.

### Notification feed
- **D-36:** Feed shows **all event types**: trade events (snipes, sells), risk events (rejections, circuit breaker), system events (connections, toggles), error events (failures).
- **D-37:** Feed has **filter chips** to show/hide event categories and filter by chain. Reduces noise during busy periods.
- **D-38:** Events use **severity color coding**: green for profits/success, yellow for warnings/risk, red for errors/losses, blue for system info.
- **D-39:** **No audio alerts**. Telegram already handles push notifications.

### Chain controls page
- **D-40:** Controls are **per-chain** (not per-DEX). Stopping a chain stops all DEX listeners on that chain. Matches ChainContext architecture.
- **D-41:** Read-only config display includes: **snipe parameters**, **risk limits**, **exit strategy config**, **connection status** (masked RPC URL, WebSocket status, last block, chain ID).

### API design
- **D-42:** REST endpoints use **/api** prefix. Health check at `/health` (no prefix).
- **D-43:** WebSocket messages use **typed JSON events**: `{type: 'positions_update' | 'trade_event' | 'chain_status', data: {...}}`. Type field enables client-side routing.
- **D-44:** API server code lives in **`src/api/`** directory with `server.ts` (Express setup), routes/, and middleware/. Part of the bot's TypeScript compilation.

### Claude's Discretion
- Frontend framework choice (React SPA vs server-rendered vs lightweight alternative)
- WebSocket library choice (ws vs Socket.IO)
- Charting library selection (Chart.js, Recharts, Lightweight Charts, etc.)
- Express middleware stack (cors, helmet, cookie-parser, etc.)
- Session management implementation (express-session, custom, etc.)
- WebSocket reconnection logic on the client side
- Dashboard component architecture and state management
- Vite configuration and build pipeline details
- Exact REST endpoint signatures and response shapes
- Error response format for API endpoints
- How chain start/stop is implemented internally (removing/re-adding listeners)
- How the emergency sell-all and force sell trigger the exit engine
- Exact pagination implementation (offset vs cursor)
- Position row compact vs expanded column breakdown

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- MON-01 (health check), DASH-01 through DASH-04 (dashboard features)

### Data layer (queried by dashboard)
- `src/utils/db.ts` -- Trades table, exit_state table, `getPnL()`, `getOpenPositionCount()`, `getTotalExposure()`, `getDeployedCapitalByChain()`, `getDailyRealizedLoss()`, `getExitState`, `getTradesByToken`
- `src/riskManager.ts` -- `canSnipe()` gate, `getPortfolioExposure()` (total + byChain), `recordSnipe()`
- `src/exitEngine.ts` -- `startExitMonitor()`, `resumeExitMonitor()`, `ExitStateData`, `ExitConfig`, `exitConfig`, `formatExitReason()`

### Bot integration points (dashboard connects here)
- `src/bot.ts` -- `startMultiChainBot()` (main entry), `ChainContext` type, factory listeners, WebSocket reconnect, graceful shutdown handler
- `src/chainRegistry.ts` -- `ChainConfig` interface, `ChainContext` type, `buildChainConfig()`, `buildChainContext()`
- `src/config.ts` -- CONFIG object, env var validation, exit strategy config

### Notification system (events to surface in dashboard feed)
- `src/utils/notifier.ts` -- `sendTelegramAlert()`, `sendCtxAlert()` -- dashboard feed should hook into the same notification points
- `src/utils/logger.ts` -- Pino structured logger -- error/warn events may feed into the dashboard notification feed

### Prior phase context
- `.planning/phases/03-sqlite-storage-code-quality/03-CONTEXT.md` -- SQLite as sole source of truth, structured logging, singleton providers
- `.planning/phases/06-risk-management/06-CONTEXT.md` -- DB-backed risk management, canSnipe gate, exposure tracking
- `.planning/phases/07-smart-exit-strategies/07-CONTEXT.md` -- Unified exit engine, 5s poll interval, exit_state table, partial sells, volatility adaptation

### Codebase analysis
- `.planning/codebase/ARCHITECTURE.md` -- Overall architecture layers
- `.planning/codebase/CONVENTIONS.md` -- Code patterns to maintain
- `.planning/codebase/STRUCTURE.md` -- Directory layout, where to add new code

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/db.ts`: Full data layer with trades, exit_state, P&L queries, position counts, exposure calculations. All dashboard data reads go through existing prepared statements.
- `src/riskManager.ts`: `getPortfolioExposure()` returns `{total, byChain}` -- directly feeds the risk dashboard donut chart and exposure gauges.
- `src/exitEngine.ts`: `ExitStateData` contains high_water_mark, partial_tiers_completed, urgency_start_ts, volatility_samples -- all data needed for position detail expansion.
- `src/utils/notifier.ts`: `sendTelegramAlert()` / `sendCtxAlert()` -- notification calls can be extended to also push events to the WebSocket feed.
- `src/utils/logger.ts`: Pino structured logger with child loggers per module -- can add a custom pino transport or destination that pipes log events to the dashboard feed.

### Established Patterns
- SQLite as sole source of truth (Phase 3) -- dashboard reads from same DB, no data duplication
- Structured JSON logging with pino (Phase 3) -- can leverage for dashboard event feed
- Per-chain env var naming: `{PREFIX}_SNIPE_AMOUNT`, `{PREFIX}_MAX_CAPITAL` (Phase 4) -- new dashboard env vars follow same pattern
- ChainContext with httpProvider, wsProvider, wallet, chain config (Phase 4) -- dashboard accesses these for status display
- Per-token sell mutex in exitManager (Phase 1) -- force sell must acquire same mutex
- DexConfig discriminated union (Phase 5) -- V2/V3 DEX info available for chain controls display

### Integration Points
- `startMultiChainBot()` in `bot.ts` -- start Express server here alongside chain listeners
- `ChainContext[]` array in bot.ts -- expose to API routes for chain status and start/stop control
- `handleNewPairForChain()` / `handleNewV3PoolForChain()` -- notification points for trade events
- `exitEngine.ts` sell events -- notification points for exit events (trailing stop, partial sell, urgency)
- Graceful shutdown handler in bot.ts -- dashboard server cleanup added here

</code_context>

<specifics>
## Specific Ideas

- Command center overview as the primary landing page -- everything visible at a glance without clicking. Stat cards at top, positions table, risk gauges and live feed below.
- 5-second WebSocket push interval matches the exit engine's own poll cycle -- dashboard and bot are in sync, no independent timers.
- Same-process architecture means the dashboard has zero-latency access to ChainContext, exit monitors, and risk manager -- no IPC overhead.
- Emergency sell-all with double confirmation (dialog + type "CONFIRM") prevents accidental nuclear option while keeping it accessible for genuine emergencies.
- Per-position force sell gives granular control without the all-or-nothing approach.
- Chain stop keeps exit monitoring active -- ensures no unmonitored positions that could silently drain capital.
- Health check returns HTTP 503 on degraded state so monitoring tools (UptimeRobot, Healthchecks.io) can auto-alert without parsing response bodies.
- CSV export on trade history covers tax reporting needs without building a dedicated reporting feature.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 08-monitoring-web-dashboard*
*Context gathered: 2026-03-26*
