---
status: partial
phase: 08-monitoring-web-dashboard
source: 08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md
started: 2026-03-27T00:00:00Z
updated: 2026-03-27T14:53:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running bot process. Start the bot from scratch with `npx ts-node src/bot.ts`. The bot boots without errors, the API server starts on the configured port (default 8080), and GET /health returns HTTP 200 with JSON containing chain connectivity info, open positions count, exposure, and daily P&L.
result: issue
reported: "Bot crashes on startup with PathError: Missing parameter name at index 1: * in path-to-regexp at src/api/server.ts:75. Express 5 rejects wildcard '*' route syntax."
severity: blocker

### 2. Dashboard Login
expected: Open browser to the dashboard URL (e.g. http://localhost:8080). You see a login page with an API key input field. Enter your DASHBOARD_API_KEY and submit. You are redirected to the Overview page and a session cookie is set (httpOnly, sameSite strict).
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 3. Overview Command Center
expected: After login, the Overview page shows 4 stat cards at the top: Total P&L, Open Positions, Total Exposure, and 24h P&L. Below that, a position table lists any open positions. An event feed panel shows recent notification events with severity-colored entries.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 4. Sidebar Navigation
expected: A collapsible sidebar appears on the left with navigation links to Overview, Trade History, Risk & Exposure, and Chain Controls. Clicking the collapse button shrinks the sidebar. The collapsed/expanded state persists across page navigations. A WebSocket connection indicator dot is visible in the sidebar.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 5. Position Table with Exit Details
expected: On the Overview page, open positions show token name, chain, entry price, current value, and P&L. Clicking/expanding a row reveals exit strategy details (urgency %, high-water mark, partial tier progress). A "Force Sell" button appears on each position row.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 6. Trade History Page
expected: Navigate to Trade History via sidebar. A paginated table shows trade records with columns for token, chain, status, P&L, buy/sell times, duration, amounts, and exit info. Filter controls for time range (24h/7d/30d/All), chain, and outcome (Profit/Loss) are available. An "Apply Filters" button refreshes the data. Pagination footer shows "Showing X-Y of Z trades".
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 7. Trade CSV Export
expected: On the Trade History page, clicking "Export CSV" downloads a .csv file containing the trade data with ISO date timestamps and all relevant columns.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 8. Risk & Exposure Page
expected: Navigate to Risk & Exposure via sidebar. A P&L chart (TradingView Lightweight Charts) displays cumulative P&L as green area above zero and red area below zero, with a time range selector (24h/7d/30d/All). An exposure donut chart shows per-chain allocation with chain-colored segments and a center label showing total exposure. Risk gauge bars show position count, exposure, and daily loss utilization with color transitions at 70% and 90%.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 9. Chain Controls Page
expected: Navigate to Chain Controls via sidebar. Per-chain status cards show chain name, status dot (running/stopped/disconnected), and Start/Stop buttons. Each card displays read-only config sections: Snipe Parameters, Risk Limits, Exit Strategy, and Connection Status with masked RPC URLs. An "Emergency Sell All" button is visible at the top or bottom of the page.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 10. Emergency Sell Confirmation
expected: Clicking "Emergency Sell All" opens a confirmation dialog requiring you to type "CONFIRM" in an input field before the action can proceed. The dialog shows a destructive (red) variant with warning text about selling all positions.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 11. Force Sell Confirmation
expected: Clicking "Force Sell" on a position row opens a confirmation dialog. The dialog explains the action and requires confirmation before executing the sell.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

### 12. Real-Time WebSocket Updates
expected: While the bot is running and the dashboard is open, new events (trade executions, alerts) appear automatically in the Overview event feed without refreshing the page. The event feed shows severity-colored entries with filter chips for filtering by type.
result: blocked
blocked_by: server
reason: "Bot crashes on startup (Test 1 blocker), server not running"

## Summary

total: 12
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 11

## Gaps

- truth: "Bot boots without errors and API server starts on configured port, GET /health returns HTTP 200 with chain connectivity and position data"
  status: failed
  reason: "User reported: Bot crashes on startup with PathError: Missing parameter name at index 1: * in path-to-regexp at src/api/server.ts:75. Express 5 rejects wildcard '*' route syntax."
  severity: blocker
  test: 1
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
