# Phase 8: Monitoring & Web Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 08-monitoring-web-dashboard
**Areas discussed:** Tech stack & architecture, Real-time data delivery, Bot controls & safety, Auth & access control, Dashboard layout & pages, Historical trade log, Health check details, Notification feed content, Risk dashboard details, Open positions display, Chain controls page, API design

---

## Tech stack & architecture

### Web framework

| Option | Description | Selected |
|--------|-------------|----------|
| Express.js (Recommended) | Most mature, huge ecosystem, simple to add | ✓ |
| Fastify | Faster, built-in schema validation, modern API | |
| Hono | Ultra-lightweight, modern, minimal footprint | |

**User's choice:** Express.js
**Notes:** Fits existing Node.js/TypeScript stack naturally

### Frontend approach

| Option | Description | Selected |
|--------|-------------|----------|
| React SPA (Recommended) | Separate React app with Vite, rich interactivity | |
| Server-rendered HTML | Express serves HTML with templates + vanilla JS | |
| Vue SPA | Vue 3 app bundled with Vite | |
| You decide | Claude picks based on project needs | ✓ |

**User's choice:** You decide (Claude's discretion)

### Process model

| Option | Description | Selected |
|--------|-------------|----------|
| Same process (Recommended) | Express inside bot.ts, direct access to state | ✓ |
| Separate process | Standalone server reading same SQLite DB | |
| You decide | Claude picks | |

**User's choice:** Same process

### Charts

| Option | Description | Selected |
|--------|-------------|----------|
| Charts + tables (Recommended) | Charting library for P&L curves, exposure charts | ✓ |
| Tables and numbers only | Minimal, no chart library | |
| You decide | Claude picks | |

**User's choice:** Charts + tables

### Theme

| Option | Description | Selected |
|--------|-------------|----------|
| Dark theme only (Recommended) | Standard for crypto/trading dashboards | ✓ |
| Light theme only | Simple, high contrast | |
| Both (toggle) | User switches between dark and light | |
| You decide | Claude picks | |

**User's choice:** Dark theme only

### CSS approach

| Option | Description | Selected |
|--------|-------------|----------|
| Tailwind CSS (Recommended) | Utility-first, fast to build | ✓ |
| Plain CSS / CSS Modules | No framework dependency | |
| You decide | Claude picks | |

**User's choice:** Tailwind CSS

### Frontend location

| Option | Description | Selected |
|--------|-------------|----------|
| dashboard/ at project root (Recommended) | Separate directory, own package.json | ✓ |
| src/dashboard/ | Inside existing src/, shares bot's config | |
| You decide | Claude picks | |

**User's choice:** dashboard/ at project root

---

## Real-time data delivery

### Transport mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| WebSocket (Recommended) | Full duplex, server pushes updates | ✓ |
| Server-Sent Events (SSE) | One-way server push over HTTP | |
| Polling (REST) | Dashboard polls every N seconds | |

**User's choice:** WebSocket

### Update frequency

| Option | Description | Selected |
|--------|-------------|----------|
| Every 5 seconds (Recommended) | Matches exit engine's 5s poll interval | ✓ |
| Every 1 second | Near real-time, higher load | |
| On-change only | Push only when data changes | |

**User's choice:** Every 5 seconds

### Live notifications feed

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, live feed (Recommended) | Scrolling log of events in browser | ✓ |
| No, Telegram is enough | Skip in-dashboard feed | |
| You decide | Claude decides | |

**User's choice:** Yes, live feed

### WebSocket library

| Option | Description | Selected |
|--------|-------------|----------|
| ws (raw) (Recommended) | Lightweight, no client dependency | |
| Socket.IO | Auto-reconnect, rooms, binary, fallback | |
| You decide | Claude picks | ✓ |

**User's choice:** You decide (Claude's discretion)

### Feed buffer size

| Option | Description | Selected |
|--------|-------------|----------|
| Last 100 events (Recommended) | Rolling buffer, enough context | ✓ |
| Last 500 events | Deeper history, may get noisy | |
| You decide | Claude picks | |

**User's choice:** Last 100 events

---

## Bot controls & safety

### Control level

| Option | Description | Selected |
|--------|-------------|----------|
| Start/stop per chain + view params (Recommended) | Toggle sniping on/off, view-only config | ✓ |
| Full runtime control | Adjust parameters live without restart | |
| View only, no controls | Pure monitoring, no actions | |

**User's choice:** Start/stop per chain + view params

### Confirmation step

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, confirm dialog (Recommended) | Prevents accidental clicks | ✓ |
| No, instant toggle | Acts immediately | |
| You decide | Claude picks | |

**User's choice:** Yes, confirm dialog

### Stop behavior for existing positions

| Option | Description | Selected |
|--------|-------------|----------|
| Keep monitoring exits (Recommended) | Stop new snipes, keep exit monitoring | ✓ |
| Stop everything | Stop new snipes AND exit monitoring | |
| You decide | Claude picks | |

**User's choice:** Keep monitoring exits

### Emergency sell all

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, with double confirm (Recommended) | Two-step: confirm + type CONFIRM | ✓ |
| No | No emergency sell, manage via process | |
| You decide | Claude decides | |

**User's choice:** Yes, with double confirm

### Per-position force sell

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, per-position (Recommended) | Each position has a Sell button with confirm | ✓ |
| No, exit engine only | Automated exit strategies only | |
| You decide | Claude decides | |

**User's choice:** Yes, per-position

---

## Auth & access control

### Protection method

| Option | Description | Selected |
|--------|-------------|----------|
| API key / bearer token (Recommended) | DASHBOARD_API_KEY in .env | ✓ |
| Username + password | Basic auth, login form | |
| Local-only binding | Only localhost, no auth needed | |
| You decide | Claude picks | |

**User's choice:** API key / bearer token

### Network binding

| Option | Description | Selected |
|--------|-------------|----------|
| Localhost only by default (Recommended) | 127.0.0.1, configurable via env var | ✓ |
| All interfaces (0.0.0.0) | Accessible from network immediately | |
| You decide | Claude picks | |

**User's choice:** Localhost only by default

### Health check auth

| Option | Description | Selected |
|--------|-------------|----------|
| No auth on health check (Recommended) | Standard for monitoring tools | ✓ |
| Auth required on everything | Even health check needs API key | |
| You decide | Claude picks | |

**User's choice:** No auth on health check

### Auth mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Header + cookie session (Recommended) | Login returns httpOnly cookie | ✓ |
| Bearer token header only | Stateless, every request includes key | |
| You decide | Claude picks | |

**User's choice:** Header + cookie session

### Port

| Option | Description | Selected |
|--------|-------------|----------|
| 3000 (Recommended) | Standard Node.js default | |
| 8080 | Common alternative, avoids conflicts | ✓ |
| You decide | Claude picks | |

**User's choice:** 8080

---

## Dashboard layout & pages

### Primary view

| Option | Description | Selected |
|--------|-------------|----------|
| Overview / command center (Recommended) | Stat cards, positions, risk gauges, event feed | ✓ |
| Positions-first | Large positions table, sidebar stats | |
| You decide | Claude designs | |

**User's choice:** Overview / command center

### Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Single page with sections (Recommended) | Everything on one scrollable page | |
| Multi-page with sidebar nav | Separate routes, sidebar navigation | ✓ |
| Tabs on single page | Tab bar switching views | |
| You decide | Claude picks | |

**User's choice:** Multi-page with sidebar nav

### Pages (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Overview (home) | Command center landing page | ✓ |
| Trade History | Full trade log with filtering | ✓ |
| Risk & Exposure | Charts, metrics, daily P&L | ✓ |
| Chain Controls | Per-chain toggles, config display | ✓ |

**User's choice:** All four pages selected

### Collapsible sidebar

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, collapsible (Recommended) | Full sidebar collapses to icon-only rail | ✓ |
| Fixed full sidebar | Always shows labels | |
| You decide | Claude picks | |

**User's choice:** Yes, collapsible

---

## Historical trade log

### Pagination

| Option | Description | Selected |
|--------|-------------|----------|
| Paginated table (Recommended) | Classic pagination, 25-50 rows/page | ✓ |
| Infinite scroll | Load more on scroll | |
| You decide | Claude picks | |

**User's choice:** Paginated table

### Export

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, CSV export (Recommended) | Download filtered results as CSV | ✓ |
| No export | View-only in browser | |
| You decide | Claude decides | |

**User's choice:** Yes, CSV export

### Columns (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Core: Token, Chain, Action, P&L | Minimum useful set | ✓ |
| Timing: Date, Duration held | Strategy tuning info | ✓ |
| Amounts: Entry, Exit, Gas | Full financial detail | ✓ |
| Exit details: Strategy, Peak | Exit engine behavior | ✓ |

**User's choice:** All four column groups

### Default time range

| Option | Description | Selected |
|--------|-------------|----------|
| Last 7 days (Recommended) | Expandable to 24h, 30d, all time | ✓ |
| Last 24 hours | Most recent day only | |
| All time | Everything from beginning | |
| You decide | Claude picks | |

**User's choice:** Last 7 days

---

## Health check details

### Data returned (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Liveness + uptime | Status, uptime, memory | ✓ |
| Per-chain connectivity | Connected/disconnected, last block | ✓ |
| Position summary | Position count, exposure, daily P&L | ✓ |
| Bot version + config | Version, chain count, sniping status | ✓ |

**User's choice:** All four data groups

### HTTP status codes

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, HTTP codes (Recommended) | 200 = ok, 503 = degraded | ✓ |
| Always 200, status in body | Always 200 with JSON status | |
| You decide | Claude picks | |

**User's choice:** Yes, HTTP codes

---

## Notification feed content

### Event types (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Trade events | Snipes, buys, sells | ✓ |
| Risk events | Rejections, circuit breaker | ✓ |
| System events | Connections, toggles | ✓ |
| Error events | Failures, RPC errors | ✓ |

**User's choice:** All four event types

### Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, filter chips (Recommended) | Toggle chips for categories and chain | ✓ |
| No filtering, show all | Simple scrolling feed | |
| You decide | Claude picks | |

**User's choice:** Yes, filter chips

### Color coding

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, severity colors (Recommended) | Green/yellow/red/blue by severity | ✓ |
| No colors, plain list | Text-only with timestamps | |
| You decide | Claude picks | |

**User's choice:** Yes, severity colors

### Audio alerts

| Option | Description | Selected |
|--------|-------------|----------|
| No audio (Recommended) | Visual-only, Telegram handles push | ✓ |
| Optional audio toggle | Muted by default, toggle for errors | |
| You decide | Claude picks | |

**User's choice:** No audio

---

## Risk dashboard details

### P&L chart type

| Option | Description | Selected |
|--------|-------------|----------|
| Line chart (Recommended) | Cumulative P&L over time | ✓ |
| Bar chart per day | Daily bars, green/red | |
| Both line + bars | Dual chart, most info | |
| You decide | Claude picks | |

**User's choice:** Line chart

### Exposure visualization

| Option | Description | Selected |
|--------|-------------|----------|
| Donut chart by chain (Recommended) | Donut/pie per chain, total in center | ✓ |
| Horizontal bar chart | Stacked deployed vs available | |
| Just numbers / cards | Stat cards per chain | |
| You decide | Claude picks | |

**User's choice:** Donut chart by chain

### P&L chart time ranges

| Option | Description | Selected |
|--------|-------------|----------|
| 24h / 7d / 30d / All (Recommended) | Four preset buttons, default 7d | ✓ |
| Custom date picker | Full calendar picker | |
| You decide | Claude picks | |

**User's choice:** 24h / 7d / 30d / All

---

## Open positions display

### Exit strategy info (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Exit mode indicator | Badge showing active strategy | ✓ |
| Partial sell progress | Tiers completed info | ✓ |
| High-water mark | Peak price since entry | ✓ |
| Time held / urgency | Position age and urgency % | ✓ |

**User's choice:** All four info groups

### Row expandability

| Option | Description | Selected |
|--------|-------------|----------|
| Expandable rows (Recommended) | Compact + click to expand | ✓ |
| All inline | Every column visible at once | |
| You decide | Claude picks | |

**User's choice:** Expandable rows

---

## Chain controls page

### Control granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chain (Recommended) | One toggle per chain | ✓ |
| Per-DEX | Separate toggle per DEX per chain | |
| You decide | Claude picks | |

**User's choice:** Per-chain

### Config info displayed (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Snipe parameters | Snipe amount, max capital, DEX names | ✓ |
| Risk limits | Max positions, daily loss, cooldown | ✓ |
| Exit strategy config | Trailing stop %, partial targets, urgency | ✓ |
| Connection status | RPC (masked), WS status, last block | ✓ |

**User's choice:** All four config groups

---

## API design

### REST prefix

| Option | Description | Selected |
|--------|-------------|----------|
| /api (Recommended) | Standard prefix, health at /health | ✓ |
| /api/v1 | Versioned, more verbose | |
| You decide | Claude picks | |

**User's choice:** /api

### WebSocket message format

| Option | Description | Selected |
|--------|-------------|----------|
| Typed JSON events (Recommended) | {type, data} with routing | ✓ |
| Topic-based channels | Subscribe to specific topics | |
| You decide | Claude picks | |

**User's choice:** Typed JSON events

### API code location

| Option | Description | Selected |
|--------|-------------|----------|
| src/api/ directory (Recommended) | src/api/ with server.ts, routes/, middleware/ | ✓ |
| src/dashboard/ for backend | Groups all dashboard backend code | |
| You decide | Claude picks | |

**User's choice:** src/api/ directory

---

## Claude's Discretion

- Frontend framework choice (React SPA vs server-rendered vs lightweight)
- WebSocket library choice (ws vs Socket.IO)
- Charting library selection
- Express middleware stack
- Session management implementation
- Internal architecture decisions

## Deferred Ideas

None -- discussion stayed within phase scope
