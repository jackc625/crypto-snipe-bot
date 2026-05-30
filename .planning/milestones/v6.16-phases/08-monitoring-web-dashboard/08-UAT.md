---
status: partial
phase: 08-monitoring-web-dashboard
source: 08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md
started: 2026-03-27T00:00:00Z
updated: 2026-03-27T15:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running bot process. Start the bot from scratch with `npx ts-node src/bot.ts`. The bot boots without errors, the API server starts on the configured port (default 8080), and GET /health returns HTTP 200 with JSON containing chain connectivity info, open positions count, exposure, and daily P&L.
result: pass (after fix 5b48911)

### 2. Dashboard Login
expected: Open browser to the dashboard URL (e.g. http://localhost:8080). You see a login page with an API key input field. Enter your DASHBOARD_API_KEY and submit. You are redirected to the Overview page and a session cookie is set (httpOnly, sameSite strict).
result: issue
reported: "Login works and dashboard renders for a split second, then screen clears to blank. No error messages in terminal console."
severity: blocker

### 3. Overview Command Center
expected: After login, the Overview page shows 4 stat cards at the top: Total P&L, Open Positions, Total Exposure, and 24h P&L. Below that, a position table lists any open positions. An event feed panel shows recent notification events with severity-colored entries.
result: pass

### 4. Sidebar Navigation
expected: A collapsible sidebar appears on the left with navigation links to Overview, Trade History, Risk & Exposure, and Chain Controls. Clicking the collapse button shrinks the sidebar. The collapsed/expanded state persists across page navigations. A WebSocket connection indicator dot is visible in the sidebar.
result: pass

### 5. Position Table with Exit Details
expected: On the Overview page, open positions show token name, chain, entry price, current value, and P&L. Clicking/expanding a row reveals exit strategy details (urgency %, high-water mark, partial tier progress). A "Force Sell" button appears on each position row.
result: issue
reported: "Two minor issues: (1) Dashboard shows a ~2-year-old position with no P&L that is obviously not a real open position (stale data). (2) After expanding a row, there is no way to collapse it again."
severity: minor

### 6. Trade History Page
expected: Navigate to Trade History via sidebar. A paginated table shows trade records with columns for token, chain, status, P&L, buy/sell times, duration, amounts, and exit info. Filter controls for time range (24h/7d/30d/All), chain, and outcome (Profit/Loss) are available. An "Apply Filters" button refreshes the data. Pagination footer shows "Showing X-Y of Z trades".
result: pass

### 7. Trade CSV Export
expected: On the Trade History page, clicking "Export CSV" downloads a .csv file containing the trade data with ISO date timestamps and all relevant columns.
result: pass

### 8. Risk & Exposure Page
expected: Navigate to Risk & Exposure via sidebar. A P&L chart (TradingView Lightweight Charts) displays cumulative P&L as green area above zero and red area below zero, with a time range selector (24h/7d/30d/All). An exposure donut chart shows per-chain allocation with chain-colored segments and a center label showing total exposure. Risk gauge bars show position count, exposure, and daily loss utilization with color transitions at 70% and 90%.
result: pass

### 9. Chain Controls Page
expected: Navigate to Chain Controls via sidebar. Per-chain status cards show chain name, status dot (running/stopped/disconnected), and Start/Stop buttons. Each card displays read-only config sections: Snipe Parameters, Risk Limits, Exit Strategy, and Connection Status with masked RPC URLs. An "Emergency Sell All" button is visible at the top or bottom of the page.
result: blocked
blocked_by: server
reason: "No chains connected — RPC ECONNREFUSED 127.0.0.1:8545. Page shows correct empty state but can't verify chain cards without a live RPC connection."

### 10. Emergency Sell Confirmation
expected: Clicking "Emergency Sell All" opens a confirmation dialog requiring you to type "CONFIRM" in an input field before the action can proceed. The dialog shows a destructive (red) variant with warning text about selling all positions.
result: pass

### 11. Force Sell Confirmation
expected: Clicking "Force Sell" on a position row opens a confirmation dialog. The dialog explains the action and requires confirmation before executing the sell.
result: pass

### 12. Real-Time WebSocket Updates
expected: While the bot is running and the dashboard is open, new events (trade executions, alerts) appear automatically in the Overview event feed without refreshing the page. The event feed shows severity-colored entries with filter chips for filtering by type.
result: skipped

## Summary

total: 12
passed: 9
issues: 3
pending: 0
skipped: 1
blocked: 1

## Gaps

- truth: "Bot boots without errors and API server starts on configured port, GET /health returns HTTP 200 with chain connectivity and position data"
  status: fixed
  reason: "User reported: Bot crashes on startup with PathError: Missing parameter name at index 1: * in path-to-regexp at src/api/server.ts:75. Express 5 rejects wildcard '*' route syntax."
  severity: blocker
  test: 1
  root_cause: "Express 5 uses path-to-regexp v8 which requires named wildcard parameters. The SPA catch-all route at server.ts:75 uses bare '*' which was valid in Express 4 but not Express 5. Must change to '/{*path}' syntax."
  artifacts:
    - path: "src/api/server.ts"
      issue: "Line 75: app.get('*', ...) uses Express 4 wildcard syntax, crashes with Express 5 path-to-regexp"
  missing: []
  fix_commit: "5b48911"

- truth: "Position table shows only real open positions and expanded rows can be collapsed"
  status: failed
  reason: "User reported: (1) Dashboard shows a ~2-year-old position with no P&L that is obviously not a real open position (stale data). (2) After expanding a row, there is no way to collapse it again."
  severity: minor
  test: 5
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "After login, Overview page renders and stays visible with stat cards, position table, and event feed"
  status: failed
  reason: "User reported: Login works and dashboard renders for a split second, then screen clears to blank. No error messages in terminal console."
  severity: blocker
  test: 2
  root_cause: "WebSocket broadcaster (server.ts:111) sends positions as aggregate stats object {open, totalExposure, dailyPnL} but frontend useWebSocket.ts:70 expects Position[] array. After ~5s the first WS message overwrites positions state with a non-array object, causing positions.reduce() in Overview.tsx:27 to throw, unmounting the React tree."
  artifacts:
    - path: "src/api/ws/broadcaster.ts"
      issue: "positions_update event sends aggregate stats object instead of Position[] array"
    - path: "dashboard/src/hooks/useWebSocket.ts"
      issue: "Line 70: casts msg.data.positions as Position[] but receives an object"
    - path: "dashboard/src/pages/Overview.tsx"
      issue: "Line 27: positions.reduce() throws when positions is not an array"
  missing:
    - "Fix data contract: broadcaster should send Position[] or use a different event type for aggregate stats"
  debug_session: ""
