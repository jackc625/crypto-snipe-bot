---
status: testing
phase: 11-dashboard-accuracy-bot-wiring
source: [11-00-SUMMARY.md, 11-01-SUMMARY.md, 11-02-SUMMARY.md, 11-03-SUMMARY.md, 11-04-SUMMARY.md]
started: 2026-04-01T19:30:00Z
updated: 2026-04-01T19:30:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Cold Start Smoke Test
expected: |
  Kill any running bot process. Start the bot from scratch with `npx ts-node src/bot.ts`.
  Bot boots without errors, connects to configured chains, starts API server,
  and a GET to /api/health returns a valid JSON response with status fields.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running bot process. Start from scratch with `npx ts-node src/bot.ts`. Bot boots without errors, API server starts, GET /api/health returns valid JSON.
result: [pending]

### 2. Live Prices on Positions Endpoint
expected: With the bot running, GET /api/positions returns positions with `unrealizedPnl` and `priceStale` fields populated. Positions with available on-chain prices show numeric unrealizedPnl values. The response comes from the shared buildPositionsWithLivePrices helper.
result: [pending]

### 3. Stale Price Indicator in Dashboard
expected: On the Positions page, any position where the live on-chain price is unavailable shows the price in a warning color (amber/yellow) with a "(stale)" suffix and a tooltip explaining the price is from the last known value.
result: [pending]

### 4. Unrealized P&L Display
expected: The Positions table displays unrealized P&L (not just realized P&L). The column shows the computed value from `(currentPrice/1e18) + sell_revenue - buy_cost - sell_gas`. Sorting by P&L uses the unrealized value.
result: [pending]

### 5. Telegram Connection Status in Sidebar
expected: The dashboard Sidebar footer shows Telegram connection status below the WebSocket status. Three possible states: "Telegram: Connected" (green dot), "Telegram: Disconnected" (red dot), or "Telegram: Not configured" (red dot with distinct label).
result: [pending]

### 6. Chain Restart Returns Warnings
expected: When restarting a chain via the Chain Controls page, if any DEX listener fails to restart, the response includes a `warnings` array. A dismissible warning banner appears on the ChainStatusCard showing the partial failure details.
result: [pending]

### 7. Health Endpoint Telegram Fields
expected: GET /api/health returns JSON with `telegramConnected` (boolean) and `telegramError` (string or null) fields reflecting the current Telegram listener state.
result: [pending]

### 8. WebSocket Position Broadcast
expected: With the dashboard open, positions data updates in real-time via WebSocket every ~5 seconds. The broadcast uses the same shared buildPositionsWithLivePrices helper as the REST endpoint, so live prices and unrealizedPnl are included in push updates.
result: [pending]

### 9. Test Suite Passes
expected: Running `npx vitest run` completes with all 225+ tests passing and zero failures. Unit tests cover positions helper, chain restart, and telegram listener. Integration tests cover positions, chains, health, and WS push endpoints.
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0
blocked: 0

## Gaps

[none yet]
