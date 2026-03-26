# Phase 8: Monitoring & Web Dashboard - Research

**Researched:** 2026-03-26
**Domain:** Full-stack web dashboard (Express.js backend + React/Vite SPA frontend) with real-time WebSocket communication
**Confidence:** HIGH

## Summary

Phase 8 adds an HTTP API server (Express.js) running in the same process as the bot, a WebSocket push layer for real-time updates, and a React SPA frontend built with Vite + Tailwind CSS. The dashboard reads exclusively from existing data sources (SQLite via `db.ts`, `riskManager.ts`, `exitEngine.ts`, in-memory `ChainContext[]`) and adds control endpoints for chain start/stop, force sell, and emergency sell-all.

The existing codebase provides all necessary data access functions already exported (`getPnL`, `getPortfolioExposure`, `getOpenPositionCount`, `getTotalExposure`, `getExitState`, etc.). The main integration point is `startMultiChainBot()` in `bot.ts`, where the Express server starts alongside chain listeners, receiving the `ChainContext[]` array for status queries and control operations.

For the frontend discretion areas: **React** (not Preact) is recommended because the ecosystem maturity and library compatibility outweigh the bundle size difference for a single-operator dashboard. **ws** (not Socket.IO) is recommended because the dashboard has a single client (the operator), no rooms/broadcasting complexity, and ws is 13x more popular by downloads with lower overhead. **TradingView Lightweight Charts** is recommended for the P&L line chart -- purpose-built for financial data at 45KB. A standard donut chart from **Chart.js** handles the exposure visualization.

**Primary recommendation:** Use Express 4.22.x (proven stable), ws 8.x for WebSocket push, React 19 + Vite 8 + Tailwind CSS 4 for the SPA, and TradingView Lightweight Charts for financial charting.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Web framework is Express.js
- **D-03:** Dashboard runs in the same process as the bot. Express server starts inside bot.ts alongside chain listeners
- **D-04:** CSS framework is Tailwind CSS. Dark theme only (D-06)
- **D-05:** Dashboard uses charts + tables
- **D-07:** Frontend source code lives in `dashboard/` at project root with its own package.json and Vite config. Build output served by Express as static files
- **D-08:** Real-time updates via WebSocket push
- **D-09:** Position data updates every 5 seconds, matching exit engine poll interval
- **D-10:** Live notifications feed with rolling buffer of 100 events in browser
- **D-12:** Dashboard provides start/stop per chain with read-only parameter display. Parameters changed via env vars and restart only
- **D-13:** Chain start/stop requires confirmation dialog
- **D-14:** When chain stopped, existing positions continue being monitored. Only new listeners stop
- **D-15:** Emergency sell-all with double confirmation (dialog + type "CONFIRM")
- **D-16:** Per-position force sell with confirmation
- **D-17:** Authentication via API key / bearer token. `DASHBOARD_API_KEY` env var
- **D-18:** Login flow: POST `/api/auth/login` returns httpOnly session cookie
- **D-19:** Binds to localhost by default. `DASHBOARD_HOST` env var for remote access
- **D-20:** Health check `GET /health` is unauthenticated
- **D-21:** Dashboard port defaults to 8080. `DASHBOARD_PORT` env var
- **D-22:** Primary view is overview/command center
- **D-23:** Multi-page with collapsible sidebar
- **D-24:** Pages: Overview, Trade History, Risk & Exposure, Chain Controls
- **D-25:** Trade history: paginated tables (25-50 rows), server-side filtering
- **D-26:** CSV export for filtered results
- **D-27:** Trade history columns: Core, Timing, Amounts, Exit details
- **D-28:** Default time range last 7 days, expandable to 24h, 30d, all time
- **D-29:** Health check returns comprehensive data: liveness, per-chain status, position summary, bot version
- **D-30:** HTTP 200 = all good, 503 = degraded
- **D-31:** P&L as cumulative line chart, green above zero, red below
- **D-32:** P&L chart time range: 24h/7d/30d/All, default 7d
- **D-33:** Portfolio exposure as donut chart by chain
- **D-34:** Position rows show exit strategy info
- **D-35:** Position rows are expandable
- **D-36:** Notification feed shows all event types
- **D-37:** Feed has filter chips by category and chain
- **D-38:** Severity color coding: green/yellow/red/blue
- **D-39:** No audio alerts
- **D-40:** Controls are per-chain (not per-DEX)
- **D-41:** Read-only config display includes snipe params, risk limits, exit config, connection status
- **D-42:** REST endpoints use /api prefix. Health at /health
- **D-43:** WebSocket typed JSON events: `{type, data}`
- **D-44:** API server code in `src/api/` with server.ts, routes/, middleware/

### Claude's Discretion
- Frontend framework choice (React SPA vs server-rendered vs lightweight alternative)
- WebSocket library choice (ws vs Socket.IO)
- Charting library selection
- Express middleware stack (cors, helmet, cookie-parser, etc.)
- Session management implementation
- WebSocket reconnection logic on client
- Dashboard component architecture and state management
- Vite configuration and build pipeline
- Exact REST endpoint signatures and response shapes
- Error response format
- How chain start/stop is implemented internally
- How emergency sell-all and force sell trigger exit engine
- Exact pagination implementation
- Position row compact vs expanded column breakdown

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MON-01 | HTTP health check endpoint exposes bot liveness, chain connectivity status, and open position count | Express route at `GET /health` (unauthenticated), reads from ChainContext[] for connectivity + `getOpenPositionCount()` from db.ts |
| DASH-01 | Web dashboard displays real-time open positions with current P&L per token and chain | WebSocket push every 5s with position data from `getPnL()` + exit_state table; React table component with expandable rows |
| DASH-02 | Historical trade log with filtering by chain, date range, and profit/loss | REST endpoint with server-side pagination using `getPnL(filters)` from db.ts; React paginated table with filter controls |
| DASH-03 | Bot controls accessible from dashboard (start/stop per chain, adjust snipe parameters) | REST endpoints for chain toggle (start/stop listeners in ChainContext[]); read-only config display from ChainConfig |
| DASH-04 | Risk dashboard shows portfolio exposure, daily P&L curve, and position limit utilization | `getPortfolioExposure()` feeds donut chart; P&L query feeds cumulative line chart via Lightweight Charts; position limits from riskManager config |
</phase_requirements>

## Standard Stack

### Core (Bot-side API layer -- added to root package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 4.22.1 | HTTP server framework | D-01 locked decision. v4.22.x is the most proven Express version with full TypeScript support. Express 5 exists but v4 has better middleware ecosystem compatibility and zero migration risk |
| ws | 8.20.0 | WebSocket server | Lightweight, 109M weekly downloads, zero dependencies. Single-operator dashboard needs no rooms/namespaces/fallback transports. Direct integration with Express HTTP server via `upgrade` event |
| cookie-parser | 1.4.7 | Parse Cookie headers | Required for httpOnly session cookie auth (D-18) |
| helmet | 8.1.0 | Security headers | Sets Content-Security-Policy, X-Frame-Options, etc. Critical for a dashboard that controls real money |
| cors | 2.8.6 | CORS middleware | Needed during development when Vite dev server runs on different port |
| uuid | 13.0.0 | Session token generation | Cryptographically random session IDs for cookie-based auth |
| @types/express | 5.0.6 | TypeScript types | Express type definitions |
| @types/ws | 8.18.1 | TypeScript types | ws type definitions |
| @types/cookie-parser | 1.4.10 | TypeScript types | cookie-parser type definitions |
| @types/cors | 2.8.19 | TypeScript types | cors type definitions |
| @types/uuid | 11.0.0 | TypeScript types | uuid type definitions |

### Frontend (dashboard/ -- separate package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 19.2.4 | UI framework | Mature ecosystem, extensive component libraries, best tooling support. React 19 is stable with improved performance |
| react-dom | 19.2.4 | React DOM renderer | Required for browser React rendering |
| react-router-dom | 7.13.2 | Client-side routing | Multi-page SPA navigation (D-23/D-24: Overview, Trade History, Risk, Chain Controls) |
| lightweight-charts | 5.1.0 | Financial line charts | TradingView's chart library at 45KB. Purpose-built for P&L curves (D-31/D-32). Apache 2.0 license |
| chart.js | 4.5.1 | Donut/gauge charts | Exposure donut chart (D-33) and risk gauge visualizations. Chart.js is the most popular general charting library |
| react-chartjs-2 | 5.3.0 | Chart.js React wrapper | Declarative React bindings for Chart.js |
| vite | 8.0.3 | Build tool | Fast dev server + production bundler (D-07). Native ESM, HMR |
| @vitejs/plugin-react | 6.0.1 | Vite React plugin | JSX transform and React Fast Refresh |
| tailwindcss | 4.2.2 | CSS framework | D-04 locked decision. v4 has zero-config Vite integration via @tailwindcss/vite |
| @tailwindcss/vite | 4.2.2 | Tailwind Vite plugin | First-party Vite integration. No PostCSS config or tailwind.config.js needed in v4 |
| typescript | 5.8.3 | TypeScript compiler | Match bot's TypeScript version for consistency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React 19 | Preact 10 | 3KB vs 40KB gzipped. But single-operator dashboard doesn't need micro-optimization; React has better library compat |
| ws 8 | Socket.IO 4 | Socket.IO adds rooms, namespaces, auto-reconnect. Overhead not justified for single-client push model. ws is simpler |
| Chart.js | Recharts | Recharts is React-native but heavier. Chart.js + react-chartjs-2 is lighter for just donut + gauge charts |
| Express 4 | Express 5 | Express 5.2.1 is now stable, but middleware ecosystem (helmet, cors, cookie-parser) has longer track record on v4 |
| TradingView Lightweight Charts | Recharts/Victory | Lightweight Charts is purpose-built for financial time series; Recharts is general-purpose and lacks financial chart features |

**Installation (bot-side, root):**
```bash
npm install express ws cookie-parser helmet cors uuid
npm install -D @types/express @types/ws @types/cookie-parser @types/cors @types/uuid
```

**Installation (frontend, dashboard/):**
```bash
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm install react-router-dom lightweight-charts chart.js react-chartjs-2
npm install -D tailwindcss @tailwindcss/vite
```

## Architecture Patterns

### Recommended Project Structure

```
crypto-snipe-bot/
├── src/
│   ├── api/                      # D-44: API server code
│   │   ├── server.ts             # Express + WebSocket server setup
│   │   ├── middleware/
│   │   │   ├── auth.ts           # Cookie-based auth middleware
│   │   │   └── errorHandler.ts   # Centralized error responses
│   │   ├── routes/
│   │   │   ├── health.ts         # GET /health (unauthenticated)
│   │   │   ├── auth.ts           # POST /api/auth/login
│   │   │   ├── positions.ts      # GET /api/positions
│   │   │   ├── trades.ts         # GET /api/trades, GET /api/trades/export
│   │   │   ├── risk.ts           # GET /api/risk/exposure, GET /api/risk/pnl
│   │   │   ├── chains.ts         # GET /api/chains, POST /api/chains/:name/start|stop
│   │   │   └── controls.ts       # POST /api/controls/emergency-sell, POST /api/controls/force-sell/:tradeId
│   │   └── ws/
│   │       ├── handler.ts        # WebSocket connection + auth
│   │       └── broadcaster.ts    # Typed event broadcasting to connected clients
│   ├── bot.ts                    # Modified: starts API server after chain listeners
│   └── ...existing files
├── dashboard/                    # D-07: Frontend source
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # Router + layout wrapper
│       ├── index.css             # Tailwind import
│       ├── hooks/
│       │   ├── useWebSocket.ts   # WebSocket connection + reconnect
│       │   └── useApi.ts         # REST API fetch wrapper with auth
│       ├── pages/
│       │   ├── Overview.tsx      # D-22: Command center
│       │   ├── TradeHistory.tsx  # D-25: Paginated trade log
│       │   ├── RiskExposure.tsx  # D-31/D-33: Charts
│       │   └── ChainControls.tsx # D-40: Per-chain controls
│       ├── components/
│       │   ├── Layout.tsx        # D-23: Sidebar + main content
│       │   ├── Sidebar.tsx       # Collapsible nav
│       │   ├── StatCard.tsx      # Top-level metric cards
│       │   ├── PositionTable.tsx # D-34/D-35: Expandable rows
│       │   ├── TradeTable.tsx    # D-27: Full-featured trade table
│       │   ├── PnLChart.tsx      # D-31: Lightweight Charts wrapper
│       │   ├── ExposureDonut.tsx # D-33: Chart.js donut
│       │   ├── EventFeed.tsx     # D-36: Live notification feed
│       │   ├── FilterChips.tsx   # D-37: Category/chain filters
│       │   └── ConfirmDialog.tsx # D-13/D-15/D-16: Confirmation modals
│       ├── types/
│       │   └── api.ts            # Shared API response types
│       └── utils/
│           └── formatters.ts     # P&L formatting, time formatting, etc.
└── ...existing files
```

### Pattern 1: Same-Process API Server

**What:** Express HTTP server + WebSocket server initialized inside `startMultiChainBot()` after chain listeners start. The `ChainContext[]` array is captured in closure and shared with route handlers.

**When to use:** D-03 mandates same-process architecture.

**Example:**
```typescript
// src/api/server.ts
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import type { ChainContext } from '../chainRegistry';

export function startApiServer(contexts: ChainContext[]): void {
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ server });

    // Middleware
    app.use(express.json());
    app.use(cookieParser());
    app.use(helmet());

    // Routes receive contexts via closure
    app.use('/health', healthRoutes(contexts));
    app.use('/api', authMiddleware, apiRoutes(contexts));

    // WebSocket upgrade with auth
    server.on('upgrade', (req, socket, head) => {
        // Validate session cookie before upgrade
    });

    const host = process.env.DASHBOARD_HOST || '127.0.0.1';
    const port = parseInt(process.env.DASHBOARD_PORT || '8080', 10);
    server.listen(port, host);
}
```

### Pattern 2: WebSocket Typed Event Broadcasting

**What:** Server pushes typed JSON events to all authenticated WebSocket clients. Events have discriminated union type field for client-side routing.

**When to use:** D-43 specifies typed JSON events.

**Example:**
```typescript
// src/api/ws/broadcaster.ts
type WsEventType = 'positions_update' | 'trade_event' | 'chain_status' | 'notification';

interface WsEvent {
    type: WsEventType;
    data: unknown;
    timestamp: number;
}

const clients = new Set<WebSocket>();

export function broadcast(event: WsEvent): void {
    const msg = JSON.stringify(event);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}
```

### Pattern 3: Route Factory with Context Injection

**What:** Route files export factory functions that receive `ChainContext[]` and return Express Router. Avoids global state.

**When to use:** All API routes need access to chain state.

**Example:**
```typescript
// src/api/routes/chains.ts
import { Router } from 'express';
import type { ChainContext } from '../../chainRegistry';

export function chainRoutes(contexts: ChainContext[]): Router {
    const router = Router();

    router.get('/', (req, res) => {
        const chains = contexts.map(ctx => ({
            name: ctx.chain.name,
            displayName: ctx.chain.displayName,
            enabled: true,  // in contexts array means enabled
            // ...status info
        }));
        res.json({ chains });
    });

    return router;
}
```

### Pattern 4: httpOnly Cookie Session (no express-session)

**What:** Lightweight session management using `res.cookie()` + `cookie-parser`. Login endpoint validates API key, generates UUID session token, stores in in-memory Map, sets httpOnly cookie.

**When to use:** D-17/D-18 specify API key auth with httpOnly cookie. Single-operator model doesn't need session store.

**Example:**
```typescript
// src/api/middleware/auth.ts
import { v4 as uuidv4 } from 'uuid';

const sessions = new Map<string, { createdAt: number }>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function loginHandler(req, res) {
    if (req.body.apiKey !== process.env.DASHBOARD_API_KEY) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    const token = uuidv4();
    sessions.set(token, { createdAt: Date.now() });
    res.cookie('session', token, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: SESSION_TTL_MS,
        secure: process.env.NODE_ENV === 'production',
    });
    res.json({ ok: true });
}

export function authMiddleware(req, res, next) {
    const token = req.cookies?.session;
    const session = token ? sessions.get(token) : null;
    if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
```

### Pattern 5: Chain Start/Stop via Listener Management

**What:** Stopping a chain removes factory event listeners (WebSocket `removeAllListeners` or clears polling interval). Starting re-attaches listeners. Exit monitors continue running for existing positions (D-14).

**When to use:** D-12/D-14/D-40 specify per-chain start/stop behavior.

**Key insight:** The `ChainContext` object stays in the array (exit monitors reference it). Only the event subscription is toggled. A `stoppedChains` Set tracks which chains have listeners disabled.

### Pattern 6: Force Sell / Emergency Sell via Exit Engine

**What:** Force sell triggers the same sell logic as the exit engine (`sendTxWithRetry` with MEV protection), but initiated via API call instead of price threshold. Must acquire the sell mutex (`tryAcquireSellLock`) first to prevent double-sells.

**When to use:** D-15/D-16 specify force sell and emergency sell-all.

**Key insight:** The sell mutex in `exitManager.ts` (`tryAcquireSellLock`) is the critical safety mechanism. Force sell must: (1) acquire lock, (2) build sell TX, (3) submit, (4) update DB status, (5) clear exit monitor timers, (6) release lock. Emergency sell-all iterates all pending positions.

### Anti-Patterns to Avoid

- **Polling from dashboard:** Never have the React SPA poll REST endpoints for position data. Use WebSocket push (D-08). REST is for initial load and user-triggered actions only.
- **Separate data queries:** Never query SQLite from the API routes using raw SQL. Use the existing prepared statements from `db.ts` (getPnL, getOpenPositionCount, etc.).
- **Direct process.exit in API handlers:** Control endpoints should never crash the bot. Chain stop removes listeners gracefully.
- **Storing dashboard state in SQLite:** Dashboard UI state (sidebar collapsed, filter selections) stays in browser localStorage. No new tables needed for dashboard state.
- **Running Vite dev server in production:** In production, Express serves the pre-built static files from `dashboard/dist/`. Vite is dev-only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP security headers | Custom header middleware | `helmet` | 11+ security headers with sensible defaults, OWASP-recommended |
| Cookie parsing | Manual `req.headers.cookie` parsing | `cookie-parser` | Handles signed cookies, edge cases, URL decoding |
| CORS | Custom Access-Control headers | `cors` | Preflight OPTIONS handling, credential support, origin validation |
| WebSocket protocol | Raw TCP or HTTP long-polling | `ws` | Binary frames, ping/pong keepalive, backpressure, per-message compression |
| Financial line charts | Custom canvas/SVG rendering | `lightweight-charts` | 45KB, handles crosshair, time axis, series types, responsive resize |
| Donut/gauge charts | Custom SVG donut | `chart.js` + `react-chartjs-2` | Animation, tooltips, responsive, accessibility |
| UUID generation | `Math.random()` or `crypto.randomBytes` formatting | `uuid` v13 | RFC 9562 compliant, uses `crypto.getRandomValues()` |
| CSS utility framework | Custom CSS classes | Tailwind CSS v4 | Consistent spacing/colors, dark theme, responsive |

**Key insight:** This phase is primarily a "wiring" exercise -- connecting existing data sources to a visual layer. The data access functions are already implemented. The complexity is in the frontend UI and the WebSocket real-time plumbing, not in business logic.

## Common Pitfalls

### Pitfall 1: WebSocket Authentication Bypass
**What goes wrong:** WebSocket connections skip Express middleware. If auth is only on REST routes, WebSocket is unauthenticated.
**Why it happens:** WebSocket upgrade happens at the HTTP server level, not through Express routing.
**How to avoid:** Validate session cookie during the `upgrade` event on the HTTP server, before completing the WebSocket handshake. Reject unauthorized upgrades with 401.
**Warning signs:** WebSocket connects without login; any browser tab can see live data.

### Pitfall 2: Process Crash from API Error
**What goes wrong:** An unhandled error in an API route handler (e.g., DB query fails) crashes the entire bot process.
**Why it happens:** Express error handling requires explicit error middleware. Async route handlers that throw without try/catch become unhandled rejections.
**How to avoid:** Wrap all async route handlers in try/catch. Add Express error middleware as last `app.use()`. Never let API errors propagate to the event loop.
**Warning signs:** Bot stops after opening dashboard page; uncaught promise rejection in logs.

### Pitfall 3: Sell Mutex Deadlock on Force Sell
**What goes wrong:** Force sell from dashboard tries to acquire sell lock while exit engine already holds it. Or vice versa: exit engine detects threshold during force sell.
**Why it happens:** The sell lock in `exitManager.ts` is non-reentrant. If force sell doesn't properly clear the exit monitor first, both can race.
**How to avoid:** Force sell should: (1) clear exit monitor timers for the token first (`clearAllTimersForToken`), (2) then acquire lock, (3) execute sell. This eliminates the race by stopping the competing timer before acquiring the lock.
**Warning signs:** Force sell "hangs" or returns error; position remains after force sell attempt.

### Pitfall 4: Stale ChainContext After Stop/Start
**What goes wrong:** Stopping a chain destroys the WebSocket provider. Re-starting the chain needs a fresh provider, but the old ChainContext reference has a dead provider.
**Why it happens:** JavaScript objects are mutable references. If route handlers capture the original ChainContext, stopping and re-creating won't update those references.
**How to avoid:** Use a mutable wrapper (e.g., `Map<string, ChainContext>`) that routes always read from, rather than capturing the array directly. When a chain restarts, replace the map entry.
**Warning signs:** Chain shows "connected" after restart but no events detected; "WebSocket is not open" errors.

### Pitfall 5: Vite Build Path Mismatch
**What goes wrong:** Express serves `dashboard/dist/` in production, but the Vite build output includes hashed filenames and the SPA `index.html` fallback doesn't work.
**Why it happens:** SPA routing requires all non-API, non-static requests to return `index.html`. If Express doesn't have a catch-all route after static middleware, refreshing on `/trades` returns 404.
**How to avoid:** Configure Express: (1) `express.static('dashboard/dist')` for built assets, (2) catch-all `app.get('*', (req, res) => res.sendFile('dashboard/dist/index.html'))` after all API routes. API routes MUST be registered before the catch-all.
**Warning signs:** Page works on initial load but 404 on browser refresh; assets load but no HTML.

### Pitfall 6: WebSocket Message Flooding
**What goes wrong:** Broadcasting position updates every 5s to N clients sends full position data even if nothing changed. If many positions exist, messages become large.
**Why it happens:** Naive broadcasting sends full state on every tick.
**How to avoid:** Send a lightweight heartbeat with change detection. Only broadcast full position data when values actually change. Use a hash/checksum of the last sent state to detect changes.
**Warning signs:** Browser DevTools shows identical large WS messages every 5s; browser memory grows.

### Pitfall 7: Cookie Not Sent to WebSocket
**What goes wrong:** Browser WebSocket API doesn't let you set custom headers. If the session cookie has `sameSite: strict` and the WebSocket connects to a different origin/port, the cookie is not sent.
**Why it happens:** During development, Vite dev server runs on port 5173 and API on port 8080. Cross-origin cookie restrictions apply.
**How to avoid:** In development, configure Vite proxy for `/api` and `/ws` paths to forward to Express. In production, same origin (same port) so no issue. Set `sameSite: 'lax'` during development if needed.
**Warning signs:** WebSocket connects but server sees no session cookie; auth fails on WS upgrade.

### Pitfall 8: Express Static Middleware Before API Routes
**What goes wrong:** If `express.static` or the SPA catch-all is registered before API routes, all requests including `/api/*` get served `index.html`.
**Why it happens:** Express middleware order matters. First match wins.
**How to avoid:** Register routes in this exact order: (1) `/health`, (2) `/api/*`, (3) `express.static()`, (4) SPA catch-all.
**Warning signs:** API calls return HTML instead of JSON; 200 status but response is the dashboard HTML.

## Code Examples

### Health Check Endpoint (MON-01)

```typescript
// src/api/routes/health.ts
import { Router } from 'express';
import type { ChainContext } from '../../chainRegistry';
import { getOpenPositionCount, getTotalExposure } from '../../utils/db';
import { getPortfolioExposure } from '../../riskManager';

export function healthRoutes(contexts: ChainContext[]): Router {
    const router = Router();
    const startTime = Date.now();

    router.get('/', async (req, res) => {
        const chainStatuses = await Promise.all(contexts.map(async (ctx) => {
            try {
                const blockNumber = await ctx.httpProvider.getBlockNumber();
                return {
                    name: ctx.chain.name,
                    displayName: ctx.chain.displayName,
                    connected: true,
                    latestBlock: blockNumber,
                    wsConnected: ctx.wsProvider !== null,
                };
            } catch {
                return {
                    name: ctx.chain.name,
                    displayName: ctx.chain.displayName,
                    connected: false,
                    latestBlock: null,
                    wsConnected: false,
                };
            }
        }));

        const degraded = chainStatuses.some(c => !c.connected);
        const positions = (getOpenPositionCount.get() as { count: number }).count;
        const exposure = getPortfolioExposure();

        res.status(degraded ? 503 : 200).json({
            status: degraded ? 'degraded' : 'ok',
            uptime: Math.floor((Date.now() - startTime) / 1000),
            chains: chainStatuses,
            positions: {
                open: positions,
                totalExposure: exposure.total,
                dailyPnL: 0, // computed from getPnL with 24h filter
            },
        });
    });

    return router;
}
```

### WebSocket Push Loop (DASH-01)

```typescript
// src/api/ws/broadcaster.ts
import type WebSocket from 'ws';

const authenticatedClients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
    authenticatedClients.add(ws);
    ws.on('close', () => authenticatedClients.delete(ws));
}

export function broadcast(type: string, data: unknown): void {
    if (authenticatedClients.size === 0) return;
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    for (const client of authenticatedClients) {
        if (client.readyState === 1 /* OPEN */) {
            client.send(message);
        }
    }
}

// Called every 5 seconds from a setInterval in server.ts
export function broadcastPositionUpdate(positionData: unknown): void {
    broadcast('positions_update', positionData);
}
```

### SPA Catch-All with Express Static

```typescript
// In src/api/server.ts after all API routes
import path from 'path';

const dashboardDist = path.join(process.cwd(), 'dashboard', 'dist');

// Serve built frontend assets
app.use(express.static(dashboardDist));

// SPA fallback: all unmatched GET requests return index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(dashboardDist, 'index.html'));
});
```

### Vite Dev Proxy Configuration

```typescript
// dashboard/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:8080',
            '/health': 'http://127.0.0.1:8080',
            '/ws': {
                target: 'ws://127.0.0.1:8080',
                ws: true,
            },
        },
    },
    build: {
        outDir: 'dist',
    },
});
```

### Tailwind CSS v4 Dark Theme Setup

```css
/* dashboard/src/index.css */
@import "tailwindcss";

@theme {
    --color-surface: #0f172a;
    --color-surface-light: #1e293b;
    --color-surface-lighter: #334155;
    --color-accent: #3b82f6;
    --color-profit: #22c55e;
    --color-loss: #ef4444;
    --color-warning: #eab308;
    --color-info: #3b82f6;
    --font-mono: 'JetBrains Mono', monospace;
}
```

### Client-Side WebSocket Hook with Reconnect

```typescript
// dashboard/src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react';

interface WsEvent {
    type: string;
    data: unknown;
    timestamp: number;
}

export function useWebSocket(onEvent: (event: WsEvent) => void) {
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();

    const connect = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
            setConnected(false);
            // Reconnect after 3 seconds
            reconnectTimeout.current = setTimeout(connect, 3000);
        };
        ws.onmessage = (e) => {
            const event = JSON.parse(e.data) as WsEvent;
            onEvent(event);
        };

        wsRef.current = ws;
    }, [onEvent]);

    useEffect(() => {
        connect();
        return () => {
            clearTimeout(reconnectTimeout.current);
            wsRef.current?.close();
        };
    }, [connect]);

    return { connected };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express 4 + manual middleware | Express 5 with async error handling | 2024-10 (v5.0.0 stable) | v5 supports async route handlers natively. We use v4 for ecosystem stability but note v5 is available |
| Tailwind CSS v3 + postcss + config.js | Tailwind CSS v4 + @tailwindcss/vite | 2025-01 (v4.0) | Zero-config Vite plugin, CSS-based theme instead of JS config, 5x faster builds |
| Socket.IO for all WebSocket needs | ws for simple push, Socket.IO for complex multi-room | Ongoing trend | ws download count (109M/week) vs Socket.IO (8M/week). Industry moving to ws for simpler use cases |
| Create React App | Vite | 2023+ | CRA is deprecated. Vite is the standard React build tool |
| Chart.js v2 with jQuery | TradingView Lightweight Charts + Chart.js v4 | 2023+ | Specialized financial charts + general-purpose charts as complementary tools |

**Deprecated/outdated:**
- Create React App: officially deprecated, replaced by Vite
- Express 3.x: long EOL
- Socket.IO v2/v3: current is v4.8.3
- Tailwind CSS v3: v4 is the current major, though v3 remains supported

## Open Questions

1. **How to handle chain restart after stop?**
   - What we know: Stopping removes event listeners. ChainContext has httpProvider, wsProvider, wallet.
   - What's unclear: Does wsProvider need to be re-created? Can we re-subscribe to events on the same provider?
   - Recommendation: Test whether `wsProvider.on('PairCreated', ...)` works after `removeAllListeners()`. If not, create a fresh WebSocket provider on restart. Store a `stoppedChains` Set for quick status checks.

2. **Exact pagination strategy for trade history?**
   - What we know: SQLite supports `LIMIT ? OFFSET ?`. D-25 specifies 25-50 rows per page.
   - What's unclear: Whether to use offset-based or cursor-based pagination.
   - Recommendation: Use offset-based (`LIMIT 25 OFFSET ?`). Trade history is append-only and queried with time filters, so offset pagination is simple and sufficient. Cursor-based is over-engineering for a single-operator dashboard.

3. **How to inject notification events into the WebSocket feed?**
   - What we know: `sendTelegramAlert()` and `sendCtxAlert()` are the notification points. Exit engine has sell events.
   - What's unclear: Whether to modify existing notification functions or use a separate event emitter.
   - Recommendation: Create a lightweight event bus (Node.js `EventEmitter`). Existing notification points emit events to the bus. The WebSocket broadcaster subscribes to the bus. This avoids modifying `notifier.ts` or `exitEngine.ts` directly -- just add emitter calls alongside existing `sendCtxAlert` calls in `bot.ts`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | Yes | v22.16.0 | -- |
| npm | Package management | Yes | 9.9.4 | -- |
| TypeScript | Compilation | Yes | 5.8.3 | -- |
| Vitest | Test framework | Yes | 4.1.1 (devDependency) | -- |
| SQLite (better-sqlite3) | Data layer | Yes | 12.8.0+ (dependency) | -- |

**Missing dependencies with no fallback:** None -- all are installable via npm.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `vitest.config.ts` (exists, includes `tests/**/*.test.ts`) |
| Quick run command | `npx vitest run tests/dashboard.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MON-01 | Health check returns liveness, chain status, position count | unit | `npx vitest run tests/api/health.test.ts -t "health" --reporter=verbose` | Wave 0 |
| MON-01 | Health check returns 503 when chain disconnected | unit | `npx vitest run tests/api/health.test.ts -t "degraded" --reporter=verbose` | Wave 0 |
| DASH-01 | Positions API returns open positions with P&L | unit | `npx vitest run tests/api/positions.test.ts --reporter=verbose` | Wave 0 |
| DASH-02 | Trade history filters by chain, date range, P&L | unit | `npx vitest run tests/api/trades.test.ts -t "filter" --reporter=verbose` | Wave 0 |
| DASH-02 | Trade history pagination (25 rows, offset) | unit | `npx vitest run tests/api/trades.test.ts -t "pagination" --reporter=verbose` | Wave 0 |
| DASH-03 | Chain start/stop toggles listeners | unit | `npx vitest run tests/api/chains.test.ts --reporter=verbose` | Wave 0 |
| DASH-03 | Force sell acquires mutex and executes | unit | `npx vitest run tests/api/controls.test.ts -t "force" --reporter=verbose` | Wave 0 |
| DASH-04 | Risk API returns exposure by chain | unit | `npx vitest run tests/api/risk.test.ts --reporter=verbose` | Wave 0 |
| AUTH | Login returns httpOnly cookie on valid API key | unit | `npx vitest run tests/api/auth.test.ts --reporter=verbose` | Wave 0 |
| AUTH | Middleware rejects requests without valid session | unit | `npx vitest run tests/api/auth.test.ts -t "reject" --reporter=verbose` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/api/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/api/health.test.ts` -- covers MON-01
- [ ] `tests/api/positions.test.ts` -- covers DASH-01
- [ ] `tests/api/trades.test.ts` -- covers DASH-02
- [ ] `tests/api/chains.test.ts` -- covers DASH-03
- [ ] `tests/api/controls.test.ts` -- covers DASH-03 (force sell / emergency sell)
- [ ] `tests/api/risk.test.ts` -- covers DASH-04
- [ ] `tests/api/auth.test.ts` -- covers authentication
- [ ] `tests/fixtures/api.fixtures.ts` -- shared mock ChainContext, mock DB data

**Note:** Frontend React components are NOT unit tested in this phase. The dashboard is a visualization layer -- correctness is validated by API tests (data contract) + manual inspection. Component tests can be added in a future testing phase if desired.

## Project Constraints (from CLAUDE.md)

- **Entry point:** `npx ts-node src/bot.ts` -- dashboard server must be started from within bot.ts, not as a separate process
- **TypeScript:** Strict mode, ES2022 target, commonjs module format
- **Logging:** Pino structured logger with child loggers per module (`logger.child({ module: 'api' })`)
- **DB access:** Via exported prepared statements from `src/utils/db.ts`, never raw SQL in API routes
- **Named exports only:** No default exports (codebase convention)
- **camelCase files:** New files follow camelCase: `server.ts`, `broadcaster.ts`, `health.ts`
- **Import order:** External libs, then config, then utils, then types
- **RTK prefixed commands:** All bash commands should use `rtk` prefix per global CLAUDE.md

## Sources

### Primary (HIGH confidence)
- npm registry -- verified all package versions via `npm view` on 2026-03-26
- Existing codebase -- `src/utils/db.ts`, `src/riskManager.ts`, `src/exitEngine.ts`, `src/bot.ts`, `src/chainRegistry.ts`, `src/utils/exitManager.ts` read directly
- `.planning/phases/08-monitoring-web-dashboard/08-CONTEXT.md` -- all 44 decisions read

### Secondary (MEDIUM confidence)
- [Express v5.1.0 release announcement](https://expressjs.com/2025/03/31/v5-1-latest-release.html) -- confirmed Express 5 is stable but chose v4 for ecosystem maturity
- [Tailwind CSS v4.0 release blog](https://tailwindcss.com/blog/tailwindcss-v4) -- confirmed zero-config Vite plugin approach
- [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) -- confirmed 45KB, Apache 2.0, React examples
- [Node.js WebSocket ws vs Socket.IO comparison](https://dev.to/alex_aslam/nodejs-websockets-when-to-use-ws-vs-socketio-and-why-we-switched-di9) -- confirmed ws advantage for simple push model
- [Express httpOnly cookie auth guide](https://www.alaminshaikh.com/blog/create-secure-authentication-using-http-only-cookies-in-expressjs) -- confirmed manual cookie auth pattern

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All versions verified via npm registry on research date. Express/ws/React are mature, well-documented libraries.
- Architecture: HIGH - Same-process pattern is straightforward Node.js. All integration points verified in existing codebase source.
- Pitfalls: HIGH - Based on direct code analysis (sell mutex, WebSocket auth, Express middleware order) and established web development patterns.

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable technologies, 30-day validity)
