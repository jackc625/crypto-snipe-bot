---
phase: 11-dashboard-accuracy-bot-wiring
verified: 2026-04-01T19:19:18Z
status: passed
score: 3/3 must-haves verified
re_verification: false
---

# Phase 11: Dashboard Accuracy & Bot Integration Wiring — Verification Report

**Phase Goal:** Dashboard shows accurate live data and all bot subsystems are properly wired into the multi-chain orchestrator
**Verified:** 2026-04-01T19:19:18Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | GET /api/positions returns live on-chain price, not highWaterMark | ✓ VERIFIED | `positions.ts` delegates entirely to `buildPositionsWithLivePrices`; no `highWaterMark` reference in route file |
| 2 | POST /api/chains/:name/start re-attaches factory event listeners via onRestart callback | ✓ VERIFIED | `chains.ts` calls `onRestart(ctx)` and returns `result.warnings`; bot.ts builds onRestart with WS reconnect + MEV check + `startDexListener` per DEX |
| 3 | telegramListener is imported and started within the multi-chain bot orchestrator | ✓ VERIFIED | `bot.ts` line 56 imports `startTelegramListener`, line 1025 calls `telegramHandle = await startTelegramListener(contexts)`, shutdown handler disconnects on SIGTERM |

**Score:** 3/3 success criteria verified

---

### Observable Truths (derived from success criteria + plan must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `buildPositionsWithLivePrices` calls `queryPrice` in parallel for open positions | ✓ VERIFIED | `positions.ts` helper uses `Promise.all(openTrades.map(async...))` with `await queryPrice(ctx, dex, trade.token, ...)` |
| 2 | `queryPrice` failure falls back to `highWaterMark` with `priceStale: true` | ✓ VERIFIED | Lines 109–112 of helper: `if (currentPrice === null && exitState) { currentPrice = exitState.highWaterMark; priceStale = true; }` |
| 3 | `startTelegramListener` is optional — missing env vars return `{ client: null, connected: false }` | ✓ VERIFIED | Lines 47–49 of `telegramListener.ts`: checks TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION; logs warning and returns null handle if missing |
| 4 | Telegram whitelist uses OR logic (sender OR channel whitelisted; empty = allow all) | ✓ VERIFIED | Lines 77–82: `senderAllowed = allowedSenders.size === 0 \|\| ...has(senderId)`, `channelAllowed = allowedChannels.size === 0 \|\| ...has(chatId)`, rejects only when BOTH fail |
| 5 | Multi-chain routing calls `getCode` on each chain's httpProvider | ✓ VERIFIED | Lines 103–112: `contexts.map(async ctx => ctx.httpProvider.getCode(address))` filters non-`0x` results |
| 6 | onRestart callback reconnects WS, checks MEV, re-attaches DEX listeners | ✓ VERIFIED | `bot.ts` lines 967–1011: `removeWsProvider` + `getWsProvider`, `createMevStrategy(...).healthCheck()`, `startDexListener(ctx, dex, registry)` per DEX |
| 7 | Chain restart POST response includes `warnings` array | ✓ VERIFIED | `chains.ts` lines 158–163: `res.json({ ok: true, chain, status: 'running', warnings: result.warnings })` |
| 8 | GET /health includes `telegramConnected` and `telegramError` | ✓ VERIFIED | `health.ts` lines 84–85: `telegramConnected: telegramStatus.connected`, `telegramError: telegramStatus.error` |
| 9 | WebSocket 5s push uses `buildPositionsWithLivePrices`, same as REST endpoint | ✓ VERIFIED | `server.ts` lines 98: `const positions = await buildPositionsWithLivePrices(contexts)` inside `setInterval(..., 5000)` |
| 10 | Dashboard `Position` type includes `priceStale` and `unrealizedPnl` fields | ✓ VERIFIED | `dashboard/src/types/api.ts` lines 19–20 |
| 11 | `PositionTable` shows warning-colored price with `(stale)` suffix when `priceStale` is true | ✓ VERIFIED | Lines 104–111: `text-warning` class conditional, `(stale)` span, tooltip title |
| 12 | `Sidebar` shows Telegram status with three labels (connected/disconnected/not-configured) | ✓ VERIFIED | Lines 62–76 of `Sidebar.tsx` |
| 13 | `Layout.tsx` derives `telegramStatus` from health data and passes to `Sidebar` | ✓ VERIFIED | Lines 20–24 of `Layout.tsx`: derives from `healthData?.telegramConnected`, passes as `<Sidebar telegramStatus={telegramStatus} .../>` |
| 14 | `ChainStatusCard` shows dismissible warning banner when warnings are present | ✓ VERIFIED | Lines 70–89 of `ChainStatusCard.tsx`: conditional banner with `border-warning`, dismiss button with `aria-label="Dismiss warnings"` |
| 15 | `ChainControls` manages per-chain warning state and passes to `ChainStatusCard` | ✓ VERIFIED | Line 23: `const [chainWarnings, setChainWarnings] = useState<Record<string, string[]>>({})`, line 73–75: captures from response, lines 150–155: passes to card |

**Score:** 15/15 truths verified

---

### Required Artifacts

| Artifact | Level 1: Exists | Level 2: Substantive | Level 3: Wired | Status |
|----------|----------------|---------------------|----------------|--------|
| `src/api/helpers/positions.ts` | ✓ | ✓ 145 lines, exports `buildPositionsWithLivePrices` + `LivePosition` | ✓ Imported by `server.ts` and `routes/positions.ts` | ✓ VERIFIED |
| `src/telegramListener.ts` | ✓ | ✓ 137 lines, exports `startTelegramListener` + `TelegramListenerHandle` | ✓ Imported by `bot.ts` | ✓ VERIFIED |
| `src/alphaDrop.ts` | ✓ | ✓ 95 lines, exports `handleAlphaDropForChain` + legacy `handleAlphaDrop` | ✓ Imported by `telegramListener.ts` | ✓ VERIFIED |
| `src/api/routes/positions.ts` | ✓ | ✓ 32 lines, delegates fully to helper | ✓ Mounted at `/api/positions` in `server.ts` | ✓ VERIFIED |
| `src/api/routes/chains.ts` | ✓ | ✓ 187 lines, `RestartChainListenersCallback` returns `Promise<{warnings:string[]}>` | ✓ `onRestart` passed from `server.ts` from `bot.ts` | ✓ VERIFIED |
| `src/api/routes/health.ts` | ✓ | ✓ 92 lines, `getTelegramStatus` param, `telegramConnected`/`telegramError` in response | ✓ Called with getter from `server.ts` | ✓ VERIFIED |
| `src/api/server.ts` | ✓ | ✓ 133 lines, `onRestart` + `getTelegramStatus` params, WS push with shared helper | ✓ Called from `bot.ts` with all args | ✓ VERIFIED |
| `src/bot.ts` | ✓ | ✓ `export async function startDexListener`, `onRestart` closure, `startTelegramListener` call, shutdown disconnect | ✓ Wired end-to-end | ✓ VERIFIED |
| `dashboard/src/types/api.ts` | ✓ | ✓ `priceStale`, `unrealizedPnl`, `sellRevenue` in `Position`; `telegramConnected`, `telegramError` in `HealthResponse` | ✓ Consumed by `PositionTable`, `Sidebar`, `Layout` | ✓ VERIFIED |
| `dashboard/src/components/PositionTable.tsx` | ✓ | ✓ Stale indicator, tooltip, `(stale)` span, `unrealizedPnl ?? pnl` P&L | ✓ Used in dashboard overview page | ✓ VERIFIED |
| `dashboard/src/components/Sidebar.tsx` | ✓ | ✓ `telegramStatus` prop, three-state labels, `StatusDot` with `connected`/`disconnected` only | ✓ Rendered by `Layout.tsx` | ✓ VERIFIED |
| `dashboard/src/components/Layout.tsx` | ✓ | ✓ Derives `telegramStatus` from `healthData`, passes to `<Sidebar>` | ✓ Wraps all dashboard pages | ✓ VERIFIED |
| `dashboard/src/components/ChainStatusCard.tsx` | ✓ | ✓ `warnings` prop, `border-warning` banner, dismiss button with `aria-label` | ✓ Rendered by `ChainControls.tsx` with state | ✓ VERIFIED |
| `dashboard/src/pages/ChainControls.tsx` | ✓ | ✓ `chainWarnings` state, captures from start response, passes to card, clears on new action | ✓ Route page | ✓ VERIFIED |
| `test/unit/positionsHelper.test.ts` | ✓ | ✓ 185 lines (min 80), real imports, 6 test cases | ✓ Imports `buildPositionsWithLivePrices` from helper | ✓ VERIFIED |
| `test/unit/chainRestart.test.ts` | ✓ | ✓ 96 lines (min 60), 5 test cases testing `removeWsProvider`, `getWsProvider`, `createMevStrategy` | ✓ Tests component functions of the onRestart closure | ✓ VERIFIED |
| `test/unit/telegramListener.test.ts` | ✓ | ✓ 272 lines (min 80), imports `startTelegramListener`, tests missing env, connect failure, whitelist OR logic, multi-chain routing | ✓ Imports from `src/telegramListener.ts` | ✓ VERIFIED |
| `test/integration/api/positions.test.ts` | ✓ | ✓ 192 lines (min 40), tests `priceStale` and `unrealizedPnl` fields | ✓ Mocks `buildPositionsWithLivePrices` | ✓ VERIFIED |
| `test/integration/api/chains.test.ts` | ✓ | ✓ 251 lines (min 40), tests `warnings` array from `onRestart` callback | ✓ Uses `chainRoutes` with mock callback | ✓ VERIFIED |
| `test/integration/api/health.test.ts` | ✓ | ✓ 133 lines (min 30), tests `telegramConnected` true/false/default | ✓ Uses `healthRoutes` with mock getter | ✓ VERIFIED |
| `test/integration/api/wsPush.test.ts` | ✓ | ✓ 233 lines (min 30), mocks `buildPositionsWithLivePrices` and `broadcast`, verifies 5s interval calls helper | ✓ Tests `startApiServer` broadcast behavior | ✓ VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `src/api/routes/positions.ts` | `src/api/helpers/positions.ts` | `import { buildPositionsWithLivePrices }` | ✓ WIRED | Line 8 of positions.ts |
| `src/api/server.ts` | `src/api/helpers/positions.ts` | `import { buildPositionsWithLivePrices }` | ✓ WIRED | Line 25 of server.ts |
| `src/bot.ts` | `src/telegramListener.ts` | `import { startTelegramListener, TelegramListenerHandle }` | ✓ WIRED | Line 56 of bot.ts |
| `src/bot.ts` | `src/api/server.ts` | `startApiServer(contexts, onRestart, getTelegramStatus)` | ✓ WIRED | Line 1017 of bot.ts passes both args |
| `src/telegramListener.ts` | `src/alphaDrop.ts` | `import { handleAlphaDropForChain }` | ✓ WIRED | Line 9 of telegramListener.ts |
| `src/alphaDrop.ts` | `src/chainRegistry.ts` | `import type { ChainContext, DexConfigV2 }` | ✓ WIRED | Lines 2–3 of alphaDrop.ts |
| `src/api/helpers/positions.ts` | `src/exitEngine.ts` | `import { queryPrice, exitConfig }` | ✓ WIRED | Line 8 of helper |
| `src/api/server.ts` | `src/api/routes/chains.ts` | `chainRoutes(contexts, stoppedChains, onRestart)` | ✓ WIRED | Line 68 of server.ts |
| `src/api/server.ts` | `src/api/routes/health.ts` | `healthRoutes(contexts, getTelegramStatus)` | ✓ WIRED | Line 58 of server.ts |
| `dashboard/src/components/Layout.tsx` | `dashboard/src/components/Sidebar.tsx` | passes `telegramStatus` prop | ✓ WIRED | Lines 20–24, 36 of Layout.tsx |
| `dashboard/src/pages/ChainControls.tsx` | `dashboard/src/components/ChainStatusCard.tsx` | passes `warnings` and `onDismissWarnings` | ✓ WIRED | Lines 150–155 of ChainControls.tsx |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/api/routes/positions.ts` | `positions` (from `buildPositionsWithLivePrices`) | `getPnL()` → DB query + `queryPrice()` → on-chain RPC | Yes — `getPnL()` queries SQLite; `queryPrice()` queries on-chain router | ✓ FLOWING |
| `src/api/server.ts` WS broadcast | `positions` (from `buildPositionsWithLivePrices`) | Same as above | Yes | ✓ FLOWING |
| `src/api/routes/health.ts` | `telegramStatus` | Closure `getTelegramStatus()` reading mutable `telegramHandle` in bot.ts | Yes — reflects live connection state | ✓ FLOWING |
| `src/api/routes/chains.ts` POST start | `warnings` | `onRestart(ctx)` closure calling `strategy.healthCheck()` + `startDexListener` | Yes — real async operations with real error collection | ✓ FLOWING |
| `dashboard/src/components/Sidebar.tsx` | `telegramStatus` | `useApi('/health')` → `healthData.telegramConnected` | Yes — derived from live API call in Layout | ✓ FLOWING |

---

### Behavioral Spot-Checks

Step 7b: Spot-checks requiring a running server are skipped (cannot start the bot in verification context). The TypeScript compilation acts as a primary structural check.

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| Phase 11 files compile without TS errors | `npx tsc --noEmit \| grep -v db.ts` | No output (no errors from Phase 11 files) | ✓ PASS |
| `buildPositionsWithLivePrices` exported | `grep "export.*buildPositionsWithLivePrices" src/api/helpers/positions.ts` | Match found line 52 | ✓ PASS |
| `startTelegramListener` exported | `grep "export.*startTelegramListener" src/telegramListener.ts` | Match found line 41 | ✓ PASS |
| `startDexListener` exported from bot.ts | `grep "export.*startDexListener" src/bot.ts` | Match found line 749 | ✓ PASS |
| `onRestart` builds warnings array | `grep "return { warnings }" src/bot.ts` | Match found in onRestart closure | ✓ PASS |
| No `main()` invocation in telegramListener.ts | `grep -v comment` for `main()` | Only comment reference "instead of standalone main()" in doc comment, no actual call | ✓ PASS |
| No `process.stdin.resume()` in telegramListener.ts | Text search | Not found | ✓ PASS |
| `positionRoutes` does NOT reference `highWaterMark` | Text search in routes/positions.ts | Not found | ✓ PASS |

---

### Requirements Coverage

| Requirement | Phase | Description | Plans | Status | Evidence |
|-------------|-------|-------------|-------|--------|----------|
| DASH-01 | Phase 11 | Web dashboard displays real-time open positions with current P&L per token and chain | 11-01, 11-02, 11-03, 11-04 | ✓ SATISFIED | `buildPositionsWithLivePrices` calls `queryPrice` on-chain; positions route and WS push both use it; PositionTable shows live prices with stale fallback |
| DASH-03 | Phase 11 | Bot controls accessible from dashboard (start/stop per chain, adjust snipe parameters) | 11-02, 11-03, 11-04 | ✓ SATISFIED | Chain restart `onRestart` callback re-attaches DEX listeners; returns `warnings` array; dashboard shows dismissible warning banner |
| FIX-09 | Phase 11 | Telegram alpha listener only processes messages from whitelisted sender IDs | 11-01, 11-02, 11-04 | ✓ SATISFIED | `startTelegramListener` preserves OR whitelist logic; multi-chain routing via `getCode`; integrated into bot.ts orchestrator with graceful shutdown |

No orphaned requirements found. REQUIREMENTS.md Traceability section maps exactly DASH-01, DASH-03, FIX-09 to Phase 11 — all accounted for.

---

### Anti-Patterns Found

| File | Pattern Checked | Result | Severity |
|------|-----------------|--------|----------|
| `src/api/routes/positions.ts` | `highWaterMark` reference | None found | — |
| `src/api/routes/positions.ts` | `getExitState` reference | None found (moved to helper) | — |
| `src/telegramListener.ts` | `main()` invocation | None found | — |
| `src/telegramListener.ts` | `process.stdin.resume()` | None found | — |
| `src/telegramListener.ts` | `dotenv.config()` | None found | — |
| All Phase 11 files | TODO/FIXME/PLACEHOLDER | None found | — |
| `test/unit/*.test.ts` | `it.todo` stubs remaining | None found (all replaced with real tests) | — |
| `src/utils/db.ts` | Pre-existing TS error (`getPnLChartData` redeclare) | Present but pre-dates Phase 11; not introduced by this phase | ℹ️ Info — pre-existing, not a Phase 11 gap |

No blockers found.

---

### Human Verification Required

#### 1. Live Price Display in Browser

**Test:** Start the bot with valid RPC URLs and open the dashboard. Observe the Positions page.
**Expected:** Open positions show a live current price fetched via `queryPrice`. When the RPC is unreachable or `queryPrice` returns null, the price cell is yellow with "(stale)" suffix and tooltip "Live price unavailable. Showing last known value."
**Why human:** Cannot run RPC queries against live chain in verification context.

#### 2. Telegram Status in Sidebar

**Test:** Start the bot with Telegram env vars set → observe sidebar. Then start without them → observe sidebar.
**Expected:** With vars: green StatusDot, "Telegram: Connected". Without vars: red StatusDot, "Telegram: Not configured".
**Why human:** Requires running UI and Telegram API connection.

#### 3. Chain Restart Warning Banner

**Test:** Stop a chain via dashboard → Start it → observe the ChainStatusCard if MEV is unreachable.
**Expected:** Yellow left-border banner shows each warning string with a dismiss (×) button. Clicking dismiss clears the banner.
**Why human:** Requires end-to-end wired bot + MEV service in a degraded state.

---

### Gaps Summary

No gaps found. All three success criteria are verified with substantive implementations wired end-to-end through the backend and frontend:

1. **DASH-01 (live prices):** `buildPositionsWithLivePrices` in `src/api/helpers/positions.ts` calls `queryPrice` in parallel for every open position, falls back to `highWaterMark` with `priceStale=true`. The positions REST route and 5-second WebSocket push both use this helper. The dashboard `PositionTable` renders the stale indicator.

2. **DASH-03 (chain restart wiring):** The `onRestart` closure in `startMultiChainBot` reconnects the WebSocket provider, runs a MEV health check, and calls `startDexListener` for each DEX on the chain. Failures are collected as strings in a `warnings` array. `chainRoutes` returns this array in the POST response and `ChainControls.tsx` displays it in a dismissible banner on `ChainStatusCard`.

3. **FIX-09 (Telegram integration):** `src/telegramListener.ts` exports `startTelegramListener(contexts)` which is called in `bot.ts` after `startApiServer`. Missing env vars produce a graceful null-handle return. The whitelist OR logic is preserved. Multi-chain routing uses `getCode` across all chain httpProviders. The shutdown handler calls `telegramHandle.client.disconnect()`.

---

_Verified: 2026-04-01T19:19:18Z_
_Verifier: Claude (gsd-verifier)_
