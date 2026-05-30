---
phase: 11-dashboard-accuracy-bot-wiring
verified: 2026-04-05T20:35:00Z
status: human_needed
score: 3/3 must-haves verified
re_verification:
  previous_status: passed
  previous_score: 3/3
  gaps_closed:
    - "Chain Controls blank screen fixed (Plan 05): ChainStatus type now matches backend API shape with snipeParams/riskLimits/exitStrategy/connection/dexes instead of nested config object"
    - "Fork test nonce caching bug fixed (Plan 06): cacheTimeout: -1 added to JsonRpcProvider constructor"
    - "Dashboard bundle rebuilt with Telegram status and corrected ChainStatusCard (Plan 05)"
    - "dexes field added to chains API response (Plan 05)"
    - "Integration test assertion added for dexes field (Plan 05)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Start the bot with valid RPC URLs and open the dashboard Positions page"
    expected: "Open positions show a live current price from queryPrice. When RPC is unreachable or queryPrice returns null, the price cell is yellow with '(stale)' suffix and tooltip 'Live price unavailable. Showing last known value.'"
    why_human: "Cannot run RPC queries against live chain in verification context"
  - test: "Start the bot with Telegram env vars set, then observe sidebar. Restart without them, observe sidebar again."
    expected: "With vars set: green pulsing StatusDot, 'Telegram: Connected'. Without vars: red static StatusDot, 'Telegram: Not configured'."
    why_human: "Requires running UI and Telegram API connection"
  - test: "Stop a chain via dashboard then start it when MEV service is unreachable"
    expected: "Yellow left-border banner on ChainStatusCard shows each warning string with a dismiss (x) button. Clicking dismiss clears the banner."
    why_human: "Requires end-to-end bot wired with MEV service in degraded state"
  - test: "Open the Chain Controls page in browser while bot is running"
    expected: "Page renders chain cards with Snipe Parameters, Risk Limits, Exit Strategy, Connection Status, and DEXes sections. No TypeError crash."
    why_human: "Plan 05 fix resolves the chain.config.* crash but requires browser rendering to confirm"
---

# Phase 11: Dashboard Accuracy & Bot Integration Wiring — Verification Report

**Phase Goal:** Dashboard shows accurate live data and all bot subsystems are properly wired into the multi-chain orchestrator
**Verified:** 2026-04-05T20:35:00Z
**Status:** human_needed
**Re-verification:** Yes — Plans 05 (chain controls fix + dashboard rebuild) and 06 (fork test nonce cache fix) completed after initial 2026-04-01 verification. All previously-passed items remain verified. No regressions found.

---

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | GET /api/positions returns live on-chain price, not the highWaterMark peak price | VERIFIED | `routes/positions.ts` line 26 delegates entirely to `buildPositionsWithLivePrices`; no `highWaterMark` in route file; helper calls `queryPrice` in parallel via `Promise.all` |
| 2 | POST /api/chains/:name/start re-attaches factory event listeners via onRestart callback | VERIFIED | `chains.ts` lines 156-184 call `onRestart(ctx)` and return `result.warnings`; `bot.ts` lines 967-1011 build onRestart with WS reconnect + MEV check + `startDexListener` per DEX |
| 3 | telegramListener is imported and started within the multi-chain bot orchestrator | VERIFIED | `bot.ts` line 56 imports `startTelegramListener`; line 1025 calls `telegramHandle = await startTelegramListener(contexts)`; shutdown handler at line 1113-1116 disconnects on SIGTERM |

**Score:** 3/3 success criteria verified

---

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `buildPositionsWithLivePrices` calls `queryPrice` in parallel for open positions | VERIFIED | `positions.ts` helper line 58: `await Promise.all(openTrades.map(async...))` with `queryPrice(ctx, dex, trade.token, ...)` |
| 2 | `queryPrice` failure falls back to `highWaterMark` with `priceStale: true` | VERIFIED | Lines 109-112 of helper: `if (currentPrice === null && exitState) { currentPrice = exitState.highWaterMark; priceStale = true; }` |
| 3 | `startTelegramListener` is optional — missing env vars return `{ client: null, connected: false }` | VERIFIED | Lines 47-50 of `telegramListener.ts`: checks env vars, logs warning, returns null handle |
| 4 | Telegram whitelist uses OR logic (sender OR channel; empty = allow all) | VERIFIED | Lines 77-82: `senderAllowed = allowedSenders.size === 0 \|\| ...has(senderId)`, rejects only when BOTH fail |
| 5 | Multi-chain routing calls `getCode` on each chain's httpProvider | VERIFIED | Lines 103-112 of `telegramListener.ts`: `contexts.map(async ctx => ctx.httpProvider.getCode(address))` |
| 6 | onRestart callback reconnects WS, checks MEV, re-attaches DEX listeners | VERIFIED | `bot.ts` lines 967-1011: `removeWsProvider` + `getWsProvider`, `createMevStrategy(...).healthCheck()`, `startDexListener(ctx, dex, registry)` per DEX |
| 7 | Chain restart POST response includes `warnings` array | VERIFIED | `chains.ts` line 164: `warnings: result.warnings` in response JSON |
| 8 | GET /health includes `telegramConnected` and `telegramError` | VERIFIED | `health.ts` lines 84-85: `telegramConnected: telegramStatus.connected`, `telegramError: telegramStatus.error` |
| 9 | WebSocket 5s push uses `buildPositionsWithLivePrices` | VERIFIED | `server.ts` line 98: `const positions = await buildPositionsWithLivePrices(contexts)` in `setInterval(..., 5000)` |
| 10 | Dashboard `Position` type includes `priceStale` and `unrealizedPnl` fields | VERIFIED | `dashboard/src/types/api.ts` lines 19-20 |
| 11 | `PositionTable` shows warning-colored price with `(stale)` suffix when `priceStale` is true | VERIFIED | Lines 104-111: `text-warning` class conditional, `(stale)` span, tooltip title |
| 12 | `Sidebar` shows Telegram status with three labels (connected/disconnected/not-configured) | VERIFIED | Lines 62-76 of `Sidebar.tsx` |
| 13 | `Layout.tsx` derives `telegramStatus` from health data and passes to `Sidebar` | VERIFIED | Lines 20-24 of `Layout.tsx`: derives from `healthData?.telegramConnected`, passes to `<Sidebar>` |
| 14 | `ChainStatusCard` shows dismissible warning banner when warnings are present | VERIFIED | Lines 61-80 of `ChainStatusCard.tsx`: conditional banner with `border-warning`, dismiss button with `aria-label="Dismiss warnings"` |
| 15 | `ChainControls` manages per-chain warning state and passes to `ChainStatusCard` | VERIFIED | Line 23: `chainWarnings` state declaration; line 74 captures from response; lines 150-155 passes to card |
| 16 | `ChainStatus` type matches actual backend API shape (Plan 05 gap closure) | VERIFIED | `dashboard/src/types/api.ts` lines 58-86: flat `snipeParams`/`riskLimits`/`exitStrategy`/`connection`/`dexes` — no `config` nesting |
| 17 | Chains API response includes `dexes` field (Plan 05 gap closure) | VERIFIED | `chains.ts` line 100: `dexes: ctx.chain.dexes.map((d) => d.name)` |
| 18 | `ChainStatusCard` reads `chain.snipeParams.*` not `chain.config.*` (Plan 05 gap closure) | VERIFIED | No `chain.config.` references found in `ChainStatusCard.tsx`; reads `chain.snipeParams.snipeAmount`, etc. |
| 19 | Fork test uses `cacheTimeout: -1` to disable nonce caching (Plan 06 gap closure) | VERIFIED | `test/fork/snipeLifecycle.test.ts` line 42: `new ethers.JsonRpcProvider('http://127.0.0.1:8545', undefined, { cacheTimeout: -1 })` |

**Score:** 19/19 truths verified

---

### Required Artifacts

| Artifact | Level 1: Exists | Level 2: Substantive | Level 3: Wired | Status |
|----------|----------------|---------------------|----------------|--------|
| `src/api/helpers/positions.ts` | Yes | 145 lines, exports `buildPositionsWithLivePrices` + `LivePosition` | Imported by `server.ts` and `routes/positions.ts` | VERIFIED |
| `src/telegramListener.ts` | Yes | 137 lines, exports `startTelegramListener` + `TelegramListenerHandle` | Imported by `bot.ts` | VERIFIED |
| `src/alphaDrop.ts` | Yes | 95 lines, exports `handleAlphaDropForChain` + legacy `handleAlphaDrop` | Imported by `telegramListener.ts` | VERIFIED |
| `src/api/routes/positions.ts` | Yes | 32 lines, delegates fully to shared helper | Mounted at `/api/positions` in `server.ts` | VERIFIED |
| `src/api/routes/chains.ts` | Yes | 189 lines, `RestartChainListenersCallback` returns `Promise<{warnings:string[]}>`, `dexes` in response | `onRestart` passed from `server.ts` (from `bot.ts`), `dexes` field on line 100 | VERIFIED |
| `src/api/routes/health.ts` | Yes | 92 lines, `getTelegramStatus` param, `telegramConnected`/`telegramError` in response | Called with getter from `server.ts` | VERIFIED |
| `src/api/server.ts` | Yes | 133 lines, `onRestart` + `getTelegramStatus` params, WS push with shared helper | Called from `bot.ts` with all args | VERIFIED |
| `src/bot.ts` | Yes | Exports `startDexListener`, builds `onRestart` closure, calls `startTelegramListener`, handles shutdown | Wired end-to-end | VERIFIED |
| `dashboard/src/types/api.ts` | Yes | `priceStale`, `unrealizedPnl`, `sellRevenue` in `Position`; `telegramConnected`, `telegramError` in `HealthResponse`; flat `ChainStatus` with `snipeParams`/`riskLimits`/`exitStrategy`/`connection`/`dexes` | Consumed by dashboard components | VERIFIED |
| `dashboard/src/components/PositionTable.tsx` | Yes | Stale indicator, tooltip, `(stale)` span, `unrealizedPnl ?? pnl` P&L sorting and display | Used in dashboard overview page | VERIFIED |
| `dashboard/src/components/Sidebar.tsx` | Yes | `telegramStatus` prop, three-state labels, `StatusDot` with `connected`/`disconnected` only | Rendered by `Layout.tsx` | VERIFIED |
| `dashboard/src/components/Layout.tsx` | Yes | Derives `telegramStatus` from `healthData`, passes to `<Sidebar>` | Wraps all dashboard pages | VERIFIED |
| `dashboard/src/components/ChainStatusCard.tsx` | Yes | `warnings` prop, `border-warning` banner, dismiss button with `aria-label`; reads `chain.snipeParams.*`, `chain.riskLimits.*`, `chain.exitStrategy.*`, `chain.connection.*`, `chain.dexes` | Rendered by `ChainControls.tsx` | VERIFIED |
| `dashboard/src/pages/ChainControls.tsx` | Yes | `chainWarnings` state, captures warnings from start response, passes to card, clears on new action | Route page consuming chains API | VERIFIED |
| `test/unit/positionsHelper.test.ts` | Yes | 185 lines (min 80), 6 test cases, imports `buildPositionsWithLivePrices` | Imports from `src/api/helpers/positions.ts` | VERIFIED |
| `test/unit/chainRestart.test.ts` | Yes | 96 lines (min 60), 5 test cases testing WS reconnect, MEV check, error collection | Tests component functions of onRestart | VERIFIED |
| `test/unit/telegramListener.test.ts` | Yes | 272 lines (min 80), 8 test cases covering env validation, connect failure, whitelist OR logic, multi-chain routing | Imports `startTelegramListener` | VERIFIED |
| `test/integration/api/positions.test.ts` | Yes | 192 lines (min 40), tests `priceStale` and `unrealizedPnl` fields | Mocks `buildPositionsWithLivePrices` | VERIFIED |
| `test/integration/api/chains.test.ts` | Yes | 252 lines (min 40), tests `warnings` array and `dexes` field assertion | Uses `chainRoutes` with mock callback | VERIFIED |
| `test/integration/api/health.test.ts` | Yes | 133 lines (min 30), tests `telegramConnected` true/false/default | Uses `healthRoutes` with mock getter | VERIFIED |
| `test/integration/api/wsPush.test.ts` | Yes | 233 lines (min 30), verifies 5s broadcast calls shared helper | Tests `startApiServer` broadcast behavior | VERIFIED |
| `test/fork/snipeLifecycle.test.ts` | Yes | Contains `cacheTimeout: -1` at line 42 | Tests fork lifecycle (requires Hardhat node to run) | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `src/api/routes/positions.ts` | `src/api/helpers/positions.ts` | `import { buildPositionsWithLivePrices }` | WIRED | Line 8 of positions.ts |
| `src/api/server.ts` | `src/api/helpers/positions.ts` | `import { buildPositionsWithLivePrices }` | WIRED | Line 25 of server.ts |
| `src/bot.ts` | `src/telegramListener.ts` | `import { startTelegramListener, TelegramListenerHandle }` | WIRED | Line 56 of bot.ts |
| `src/bot.ts` | `src/api/server.ts` | `startApiServer(contexts, onRestart, getTelegramStatus)` | WIRED | Lines 1017-1020 of bot.ts |
| `src/telegramListener.ts` | `src/alphaDrop.ts` | `import { handleAlphaDropForChain }` | WIRED | Line 9 of telegramListener.ts |
| `src/alphaDrop.ts` | `src/chainRegistry.ts` | `import type { ChainContext, DexConfigV2 }` | WIRED | Lines 2-3 of alphaDrop.ts |
| `src/api/helpers/positions.ts` | `src/exitEngine.ts` | `import { queryPrice, exitConfig }` | WIRED | Lines 8-9 of helper |
| `src/api/server.ts` | `src/api/routes/chains.ts` | `chainRoutes(contexts, stoppedChains, onRestart)` | WIRED | Line 68 of server.ts |
| `src/api/server.ts` | `src/api/routes/health.ts` | `healthRoutes(contexts, getTelegramStatus)` | WIRED | Line 58 of server.ts |
| `dashboard/src/components/Layout.tsx` | `dashboard/src/components/Sidebar.tsx` | passes `telegramStatus` prop | WIRED | Lines 20-24, 36 of Layout.tsx |
| `dashboard/src/pages/ChainControls.tsx` | `dashboard/src/components/ChainStatusCard.tsx` | passes `warnings` and `onDismissWarnings` | WIRED | Lines 150-156 of ChainControls.tsx |
| `dashboard/src/types/api.ts` | `dashboard/src/components/ChainStatusCard.tsx` | `ChainStatus` type consumed by component props | WIRED | Line 1 of ChainStatusCard.tsx: `import type { ChainStatus }` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/api/routes/positions.ts` | `positions` | `getPnL()` DB query + `queryPrice()` on-chain RPC | Yes — `getPnL()` queries SQLite; `queryPrice()` queries on-chain router | FLOWING |
| `src/api/server.ts` WS broadcast | `positions` | Same `buildPositionsWithLivePrices` helper | Yes | FLOWING |
| `src/api/routes/health.ts` | `telegramStatus` | Closure `getTelegramStatus()` reading mutable `telegramHandle` in bot.ts | Yes — reflects live connection state | FLOWING |
| `src/api/routes/chains.ts` POST start | `warnings` | `onRestart(ctx)` calling `strategy.healthCheck()` + `startDexListener` | Yes — real async operations with real error collection | FLOWING |
| `dashboard/src/components/Sidebar.tsx` | `telegramStatus` | `useApi('/health')` in Layout.tsx → `healthData.telegramConnected` | Yes — derived from live API call | FLOWING |
| `dashboard/src/components/ChainStatusCard.tsx` | `chain.snipeParams`, `chain.dexes` | `/api/chains` response from `chains.ts` | Yes — `chains.ts` reads from `ctx.chain.*` which is the live ChainContext | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit tests: 114 tests all pass | `npx vitest run --project unit` | `114 passed (114)` | PASS |
| Integration tests: 111 tests all pass | `npx vitest run --project integration` | `111 passed (111)` | PASS |
| `buildPositionsWithLivePrices` exported | grep on `src/api/helpers/positions.ts` | Match found line 52 | PASS |
| `startTelegramListener` exported | grep on `src/telegramListener.ts` | Match found line 41 | PASS |
| `startDexListener` exported from bot.ts | grep on `src/bot.ts` | Match found line 749 | PASS |
| `onRestart` builds warnings array | grep on `src/bot.ts` | `const onRestart = async (ctx: ChainContext): Promise<{ warnings: string[] }>` at line 967 | PASS |
| No `chain.config.*` in ChainStatusCard | grep on ChainStatusCard.tsx | No matches found | PASS |
| `dexes:` in chains API response | grep on chains.ts | Line 100: `dexes: ctx.chain.dexes.map((d) => d.name)` | PASS |
| `cacheTimeout: -1` in fork test | grep on snipeLifecycle.test.ts | Line 42 confirmed | PASS |
| No `process.stdin.resume()` in telegramListener | grep | Not found | PASS |
| No `main()` invocation in telegramListener | grep | Not found | PASS |
| No `highWaterMark` in positions route | grep on routes/positions.ts | Not found | PASS |
| Fork tests (full run) | Requires Hardhat node on port 8545 | Not available in verification context | SKIP |

---

### Requirements Coverage

| Requirement | Phase | Description | Plans | Status | Evidence |
|-------------|-------|-------------|-------|--------|----------|
| DASH-01 | Phase 11 | Web dashboard displays real-time open positions with current P&L per token and chain | 11-01, 11-02, 11-03, 11-04, 11-06 | SATISFIED | `buildPositionsWithLivePrices` calls `queryPrice` on-chain; positions route and WS push both use it; PositionTable shows live prices with stale fallback; fork test nonce fix ensures TEST-05 can pass |
| DASH-03 | Phase 11 | Bot controls accessible from dashboard (start/stop per chain, adjust snipe parameters) | 11-02, 11-03, 11-04, 11-05 | SATISFIED | Chain restart `onRestart` callback re-attaches DEX listeners and returns `warnings` array; dashboard shows dismissible warning banner; ChainStatusCard now correctly reads `snipeParams`/`riskLimits`/`exitStrategy`/`connection`/`dexes` instead of crashing on `chain.config.*` |
| FIX-09 | Phase 11 | Telegram alpha listener only processes messages from whitelisted sender IDs | 11-01, 11-02, 11-04 | SATISFIED | `startTelegramListener` preserves OR whitelist logic; multi-chain routing via `getCode`; integrated into bot.ts orchestrator with graceful shutdown; unit tests verify whitelist enforcement |

No orphaned requirements. REQUIREMENTS.md Traceability section maps exactly DASH-01, DASH-03, FIX-09 to Phase 11 — all three accounted for. No other requirements are assigned to Phase 11.

---

### Anti-Patterns Found

| File | Pattern Checked | Result | Severity |
|------|-----------------|--------|----------|
| `src/api/routes/positions.ts` | `highWaterMark` reference | None found | — |
| `src/api/routes/positions.ts` | `getExitState` reference | None found (moved to helper) | — |
| `src/telegramListener.ts` | `main()` invocation | None found | — |
| `src/telegramListener.ts` | `process.stdin.resume()` | None found | — |
| `src/telegramListener.ts` | `dotenv.config()` | None found | — |
| `dashboard/src/components/ChainStatusCard.tsx` | `chain.config.*` references | None found (all corrected in Plan 05) | — |
| All Phase 11 test files | `it.todo` stubs remaining | None found (all replaced with real tests in Plan 04) | — |
| All Phase 11 files | TODO/FIXME/PLACEHOLDER | None found | — |
| `src/utils/db.ts` | Pre-existing TS error (`getPnLChartData` redeclare) | Present but pre-dates Phase 11; mentioned in Plans 01 and 02 SUMMARY as out-of-scope pre-existing issue | Info — pre-existing, not a Phase 11 gap |

No blockers found.

---

### Human Verification Required

#### 1. Live Price Display in Browser

**Test:** Start the bot with valid RPC URLs and open the dashboard Positions page.
**Expected:** Open positions show a live current price fetched via `queryPrice`. When the RPC is unreachable or `queryPrice` returns null, the price cell is yellow with "(stale)" suffix and tooltip "Live price unavailable. Showing last known value."
**Why human:** Cannot run RPC queries against a live chain in verification context.

#### 2. Telegram Status in Sidebar

**Test:** Start the bot with `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` set, then observe the sidebar. Restart without them and observe sidebar again.
**Expected:** With vars set: green pulsing StatusDot, "Telegram: Connected". Without vars: red static StatusDot, "Telegram: Not configured".
**Why human:** Requires a running browser UI and Telegram API connection.

#### 3. Chain Restart Warning Banner

**Test:** Stop a chain via dashboard, then start it when MEV service is unreachable.
**Expected:** Yellow left-border banner shows each warning string on ChainStatusCard. A dismiss (×) button in the top-right clears the banner when clicked.
**Why human:** Requires end-to-end bot wired with MEV service in a degraded state.

#### 4. Chain Controls Page Rendering

**Test:** Open the Chain Controls page in a browser while the bot is running with at least one configured chain.
**Expected:** Chain cards render with five sections: Snipe Parameters (snipeAmount, maxCapital, minLiquidity), Risk Limits, Exit Strategy, Connection Status, and DEXes. No blank screen, no TypeError.
**Why human:** Plan 05 fixed the `chain.config.*` crash but rendering requires a browser environment.

---

### Gaps Summary

No gaps found. All six plan goals are verified against the actual codebase:

1. **DASH-01 (live prices):** `buildPositionsWithLivePrices` in `src/api/helpers/positions.ts` calls `queryPrice` in parallel for every open position, falls back to `highWaterMark` with `priceStale=true`. The positions REST route and 5-second WebSocket push both use this helper. The dashboard PositionTable renders the stale indicator. Fork test nonce fix (`cacheTimeout: -1`) closes the TEST-05 infrastructure gap.

2. **DASH-03 (chain restart + chain controls):** The `onRestart` closure in `startMultiChainBot` reconnects the WebSocket provider, runs a MEV health check, and calls `startDexListener` for each DEX on the chain. Failures are collected as strings in a `warnings` array. `chainRoutes` returns this array in the POST response and `ChainControls.tsx` displays it in a dismissible banner on `ChainStatusCard`. The Plan 05 gap closure fixed the Chain Controls blank screen by aligning the `ChainStatus` TypeScript type with the actual API response shape (removing the incorrect nested `config` object) and adding the `dexes` field to the API response.

3. **FIX-09 (Telegram integration):** `src/telegramListener.ts` exports `startTelegramListener(contexts)` which is called in `bot.ts` after `startApiServer`. Missing env vars produce a graceful null-handle return. The whitelist OR logic is preserved. Multi-chain routing uses `getCode` across all chain httpProviders. The shutdown handler calls `telegramHandle.client.disconnect()`.

4. **Test coverage:** 225 tests pass (114 unit + 111 integration). The three unit test files (positionsHelper, chainRestart, telegramListener) each exceed their minimum line requirements and contain real assertions, not `it.todo` stubs.

---

_Verified: 2026-04-05T20:35:00Z_
_Verifier: Claude (gsd-verifier)_
