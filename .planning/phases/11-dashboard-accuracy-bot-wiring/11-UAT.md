---
status: diagnosed
phase: 11-dashboard-accuracy-bot-wiring
source: [11-00-SUMMARY.md, 11-01-SUMMARY.md, 11-02-SUMMARY.md, 11-03-SUMMARY.md, 11-04-SUMMARY.md]
started: 2026-04-01T19:30:00Z
updated: 2026-04-04T23:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running bot process. Start from scratch with `npx ts-node src/bot.ts`. Bot boots without errors, API server starts, GET /api/health returns valid JSON.
result: pass

### 2. Live Prices on Positions Endpoint
expected: With the bot running, GET /api/positions returns positions with `unrealizedPnl` and `priceStale` fields populated. Positions with available on-chain prices show numeric unrealizedPnl values. The response comes from the shared buildPositionsWithLivePrices helper.
result: pass

### 3. Stale Price Indicator in Dashboard
expected: On the Positions page, any position where the live on-chain price is unavailable shows the price in a warning color (amber/yellow) with a "(stale)" suffix and a tooltip explaining the price is from the last known value.
result: skipped
reason: No position with priceStale=true available to test visually

### 4. Unrealized P&L Display
expected: The Positions table displays unrealized P&L (not just realized P&L). The column shows the computed value from `(currentPrice/1e18) + sell_revenue - buy_cost - sell_gas`. Sorting by P&L uses the unrealized value.
result: pass

### 5. Telegram Connection Status in Sidebar
expected: The dashboard Sidebar footer shows Telegram connection status below the WebSocket status. Three possible states: "Telegram: Connected" (green dot), "Telegram: Disconnected" (red dot), or "Telegram: Not configured" (red dot with distinct label).
result: issue
reported: "No. I don't know what you're talking about. There's one dot"
severity: major

### 6. Chain Restart Returns Warnings
expected: When restarting a chain via the Chain Controls page, if any DEX listener fails to restart, the response includes a `warnings` array. A dismissible warning banner appears on the ChainStatusCard showing the partial failure details.
result: issue
reported: "that entire endpoint isnt even loading. The chain controls page. It just brings up a blank blue screen."
severity: major

### 7. Health Endpoint Telegram Fields
expected: GET /api/health returns JSON with `telegramConnected` (boolean) and `telegramError` (string or null) fields reflecting the current Telegram listener state.
result: pass

### 8. WebSocket Position Broadcast
expected: With the dashboard open, positions data updates in real-time via WebSocket every ~5 seconds. The broadcast uses the same shared buildPositionsWithLivePrices helper as the REST endpoint, so live prices and unrealizedPnl are included in push updates.
result: skipped
reason: Unable to replicate scenario due to no trades happening

### 9. Test Suite Passes
expected: Running `npx vitest run` completes with all 225+ tests passing and zero failures. Unit tests cover positions helper, chain restart, and telegram listener. Integration tests cover positions, chains, health, and WS push endpoints.
result: issue
reported: "Fork tests fail with 6 failures — token balance not zeroed after sell in snipeLifecycle.test.ts"
severity: major

## Summary

total: 9
passed: 4
issues: 3
pending: 0
skipped: 2
blocked: 0

## Gaps

- truth: "Telegram connection status visible in Sidebar footer with status dot"
  status: failed
  reason: "User reported: No. I don't know what you're talking about. There's one dot"
  severity: major
  test: 5
  root_cause: "Dashboard production bundle is stale (built 2026-03-27, Telegram feature added 2026-04-01). Bundle contains zero Telegram references. Need to rebuild dashboard."
  artifacts:
    - path: "dashboard/dist/assets/index-D6nHinxP.js"
      issue: "Stale build artifact missing Telegram status code"
  missing:
    - "Rebuild dashboard (cd dashboard && npm run build)"
  debug_session: ".planning/debug/telegram-status-missing.md"

- truth: "Chain Controls page loads and allows chain restart with warning display"
  status: failed
  reason: "User reported: that entire endpoint isnt even loading. The chain controls page. It just brings up a blank blue screen."
  severity: major
  test: 6
  root_cause: "Backend chains API response shape mismatches frontend ChainStatus type. Backend sends snipeParams/riskLimits/connection nested objects, frontend expects config object with dexes/snipeAmount/etc. ChainStatusCard crashes on chain.config.dexes (undefined.dexes TypeError). No ErrorBoundary catches the crash."
  artifacts:
    - path: "src/api/routes/chains.ts"
      issue: "Response shape uses snipeParams/connection instead of config"
    - path: "dashboard/src/types/api.ts"
      issue: "ChainStatus type expects config object not present in API response"
    - path: "dashboard/src/components/ChainStatusCard.tsx"
      issue: "Accesses chain.config.dexes which is undefined at runtime (line 108)"
  missing:
    - "Align backend response shape with frontend ChainStatus type, or update frontend to match backend"
    - "Include dexes in chains API response"
  debug_session: ".planning/debug/chain-controls-blank-screen.md"

- truth: "Full test suite passes including fork tests"
  status: failed
  reason: "User reported: Fork tests fail with 6 failures — token balance not zeroed after sell in snipeLifecycle.test.ts"
  severity: major
  test: 9
  root_cause: "ethers v6 JsonRpcProvider caches RPC responses including eth_getTransactionCount. Hardhat fork inherits high mainnet nonce (6158+) for default account. Cached stale nonce causes 'nonce too low' errors starting test 2, cascading into all subsequent tests. Pre-existing bug from phase 09, not a phase 11 regression."
  artifacts:
    - path: "test/fork/snipeLifecycle.test.ts"
      issue: "Line 42: JsonRpcProvider created without disabling response cache"
  missing:
    - "Add cacheTimeout: -1 to JsonRpcProvider constructor options"
  debug_session: ".planning/debug/fork-tests-sell-failure.md"
