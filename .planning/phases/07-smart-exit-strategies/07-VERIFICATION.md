---
phase: 07-smart-exit-strategies
verified: 2026-03-25T23:57:00Z
status: human_needed
score: 4/4 must-haves verified
human_verification:
  - test: "Open a position and observe the exit engine poll loop running: check that trailing stop activates at 2x, partial sells execute at configured tiers, and urgency hard sell fires at the 30-minute mark"
    expected: "Single setInterval-based monitor fires, records exit_state to SQLite every 5s, executes partial sells via sendTxWithRetry, triggers full sell via trailing stop, urgency, or fixed stop-loss"
    why_human: "Live on-chain price queries (getAmountsOut / QuoterV2.quoteExactInputSingle) and sendTxWithRetry require real providers and wallet credentials; cannot verify MEV routing path in isolation"
  - test: "Restart the bot mid-position and verify resumeExitMonitor loads persisted state from exit_state table"
    expected: "highWaterMark, completedTierIndices, and urgencyStartTs survive the restart; trailing activation is preserved; urgency clock continues from original start time"
    why_human: "Requires a live SQLite DB row with a pending buy trade linked to an exit_state row; cannot replicate with static file checks"
---

# Phase 7: Smart Exit Strategies Verification Report

**Phase Goal:** Positions are managed with intelligent exit strategies that lock in profits, scale out at targets, and adapt to market conditions
**Verified:** 2026-03-25T23:57:00Z
**Status:** human_needed (4/4 automated checks passed; 2 items require live runtime verification)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Trailing stop-loss tracks price high-water mark and triggers a sell when price drops a configured percentage from the peak | VERIFIED | `pollExitStrategy` Steps 2+5: `state.highWaterMark` updated every tick, sell triggered when `currentPrice <= highWaterMark * (1 - effectivePct/100)` |
| 2 | Partial sell orders execute at configured price milestones (e.g., sell 50% at 2x, 25% at 5x) with the remainder trailing | VERIFIED | `pollExitStrategy` Step 3: `getUnfilledTiers` + `calculatePartialSellAmount` + `executePartialSell` called each cycle; gap-sell D-08 combines all missed tiers |
| 3 | Stop-loss and take-profit thresholds widen or tighten based on measured token price volatility | VERIFIED | `VolatilityTracker.getMultiplier()` returns CV-based multiplier; `computeEffectiveTrailingPct` applies it — wider stop for high volatility, clamped to min/max |
| 4 | Exit parameters become more aggressive as a position ages — tighter stops and lower profit targets over time | VERIFIED | `computeUrgencyMultiplier` linear curve from 1.0 at t=0 to 0.0 at 30 min; multiplied into `computeEffectiveTrailingPct`; hard market sell at deadline (urgencyMult <= 0.0) |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `vitest.config.ts` | Vitest configuration with correct include pattern | VERIFIED | `defineConfig` present; `include: ['tests/**/*.test.ts']` |
| `tests/exitEngine.test.ts` | Test stubs for EXIT-01 through EXIT-04 | VERIFIED | `describe('EXIT-01...')` through `describe('EXIT-04...')` all present; 37 `.todo` stubs + 1 passing fixture smoke test |
| `tests/fixtures/exitEngine.fixtures.ts` | Shared fixtures with mock factories | VERIFIED | 69 lines; exports `createMockExitState`, `createMockTiers`, `priceSequences`, `createMockExitStateRow` |
| `src/config.ts` | Exit strategy config vars in CONFIG and REQUIRED_ENV_VARS | VERIFIED | `TRAILING_STOP_PCT` in REQUIRED_ENV_VARS; `trailingStopPct`, `partialSellTargets`, `exitPollIntervalMs`, `urgencyWindowMs` in CONFIG |
| `src/utils/db.ts` | exit_state table, schema v3, partial_sell action | VERIFIED | `CURRENT_SCHEMA_VERSION = 3`; `CREATE TABLE IF NOT EXISTS exit_state`; `action IN ('buy', 'sell', 'partial_sell', 'fail')`; `upsertExitState`, `getExitState`, `deleteExitState`, `getTradeIdForPendingToken` exported |
| `src/utils/exitManager.ts` | registerExitMonitor and exitMonitorInterval timer support | VERIFIED | `exitMonitorInterval?` in `TokenTimers`; `export function registerExitMonitor(` present; `clearAllTimersForToken` and `clearAllTimers` both handle `exitMonitorInterval` |
| `src/exitEngine.ts` | Full exit engine: types, VolatilityTracker, poll loop, startExitMonitor, resumeExitMonitor | VERIFIED | 911 lines; all 4 interfaces, 1 class, 14 exported functions including `startExitMonitor` (line 778) and `resumeExitMonitor` (line 847) |
| `src/bot.ts` | Rewired handlers using unified exit engine; legacy monitors removed | VERIFIED | 1151 lines; `startExitMonitor` called in `handleNewPairForChain`, `handleNewV3PoolForChain`, legacy `handleNewPair`; `resumeExitMonitor` in both resume functions; 0 references to removed legacy functions |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/config.ts` | `src/exitEngine.ts` | `exitConfig` values consumed by exit engine | VERIFIED | `buildExitConfig()` reads `CONFIG.trailingStopPct`, `CONFIG.partialSellTargets`, `CONFIG.exitPollIntervalMs`, etc. |
| `src/utils/db.ts` | `src/exitEngine.ts` | exit_state table used by engine for persistence | VERIFIED | `upsertExitState.run(serializeExitState(state))` called after every poll cycle and at state changes |
| `src/exitEngine.ts` | `src/utils/db.ts` | upsertExitState / getExitState / deleteExitState | VERIFIED | Import line 12: `import { insertTrade, updateTradeStatus, upsertExitState, getExitState, deleteExitState } from './utils/db'`; all 3 used in `pollExitStrategy`, `startExitMonitor`, `resumeExitMonitor`, `executeFullSell` |
| `src/exitEngine.ts` | `src/utils/exitManager.ts` | tryAcquireSellLock / releaseSellLock / registerExitMonitor | VERIFIED | Import line 11 + usage in `executeFullSell` (lock/unlock), `executePartialSell` (lock/unlock), `startExitMonitor` (registerExitMonitor), `resumeExitMonitor` (registerExitMonitor) |
| `src/exitEngine.ts` | `src/utils/notifier.ts` | sendCtxAlert for exit event notifications | VERIFIED | `sendCtxAlert` called in `executeFullSell` and `executePartialSell` on success and failure |
| `src/exitEngine.ts` | `src/utils/txManager.ts` | sendTxWithRetry for MEV-protected sell transactions | VERIFIED | `sendTxWithRetry(txBuilder, ctx)` called in both `executeFullSell` and `executePartialSell`; no direct DEX router calls from sell paths |
| `src/bot.ts` | `src/exitEngine.ts` | import startExitMonitor, resumeExitMonitor | VERIFIED | Line 41: `import { startExitMonitor, resumeExitMonitor } from './exitEngine'` |
| `src/bot.ts handleNewPairForChain` | `src/exitEngine.ts startExitMonitor` | startExitMonitor(ctx, dex, targetToken, null, ...) | VERIFIED | `startExitMonitor(ctx, dex, targetToken, null, ctx.chain.snipeAmount, tradeRow.id, originalTokenAmount)` at line 350 |
| `src/bot.ts handleNewV3PoolForChain` | `src/exitEngine.ts startExitMonitor` | startExitMonitor(ctx, dex, targetToken, feeTier, ...) | VERIFIED | `startExitMonitor(ctx, dex, targetToken, feeTier, ctx.chain.snipeAmount, tradeRow.id, originalTokenAmount)` at line 536 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `pollExitStrategy` | `currentPrice` | `queryPrice()` dispatches to `router.getAmountsOut` (V2) or `quoter.quoteExactInputSingle.staticCall` (V3) | Yes — live contract calls | FLOWING |
| `executeFullSell` / `executePartialSell` | `txHash` | `sendTxWithRetry(txBuilder, ctx)` with real txBuilder closures (buildV2SellTx / buildV3SellTx) | Yes — encoded real swap calldata | FLOWING |
| `resumeExitMonitor` | `state` (ExitStateData) | `getExitState.get(tradeId)` queries exit_state table; deserializes full state including `highWaterMark`, `completedTierIndices`, `volatilitySamples` | Yes — SQLite prepared statement | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| vitest runs with 0 failures | `npx vitest run --reporter=verbose` | 1 passed, 37 todo, 0 failures | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | Exit code 0, no output | PASS |
| exitEngine.ts exports startExitMonitor | grep check | Found at line 778 | PASS |
| bot.ts has no legacy monitor functions | grep for `function monitorStopLoss\|monitorTakeProfit\|scheduleTimedSell\|executeSell(` | 0 matches | PASS |
| bot.ts imports startExitMonitor | grep check | Line 41 confirmed | PASS |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| EXIT-01 | 07-00, 07-01, 07-02, 07-03 | Trailing stop-loss tracks price high-water mark and sells on configured percentage pullback from peak | SATISFIED | `pollExitStrategy` Steps 2+5; `trailingActivated` set at 2x; trigger check `currentPrice <= highWaterMark * (1 - effectivePct/100)`; `executeFullSell` with reason 'trailing-stop' |
| EXIT-02 | 07-00, 07-01, 07-02, 07-03 | Partial sells execute at configurable price targets (e.g., sell 50% at 2x, 25% at 5x) with the remainder trailing | SATISFIED | `parsePartialSellTargets` parses env string; `getUnfilledTiers` detects reached/missed tiers; `calculatePartialSellAmount` uses originalTokenAmount (D-07); `executePartialSell` routes through sendTxWithRetry |
| EXIT-03 | 07-00, 07-01, 07-02, 07-03 | Stop-loss and take-profit thresholds adjust dynamically based on measured token price volatility | SATISFIED | `VolatilityTracker` CV-based multiplier; `computeEffectiveTrailingPct` applies volMultiplier * urgencyMultiplier; clamped to trailingMinPct/trailingMaxPct |
| EXIT-04 | 07-00, 07-01, 07-02, 07-03 | Exit urgency escalates as position ages — tighter stops and lower targets over time | SATISFIED | `computeUrgencyMultiplier` linear curve 1.0→0.0 over 30-min window; urgencyMult <= 0.0 triggers hard market sell; urgencyStartTs set at monitor start, persisted to DB |

All 4 requirements mapped to Phase 7 in REQUIREMENTS.md are SATISFIED. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/exitEngine.test.ts` | 9-19 | Pure function imports commented out (`parsePartialSellTargets`, `computeUrgencyMultiplier`, etc.) | Warning | All behavior tests are `.todo` stubs — none of the pure functions are actually called from tests. The functions are fully implemented and used in production code, but the unit test coverage is deferred. |

**Stub classification note:** The `.todo` test stubs are NOT production stubs. They are test scaffolding from the Wave-0 TDD approach. The production implementations in `src/exitEngine.ts` are substantive and wired. The import block being commented out means Plan 01/02's intent to "fill in test bodies" was not completed for the pure functions. This is a warning, not a blocker — the phase goal concerns position management behavior, not test coverage completeness.

---

### Human Verification Required

#### 1. Live Exit Engine Poll Cycle

**Test:** Deploy a test position, set `TRAILING_STOP_PCT=15` and `PARTIAL_SELL_TARGETS=2x:50`, wait for the 5-second poll loop to fire. Observe bot logs for `Exit engine tick` debug lines showing `priceMultiple`, `hwm`, `effectivePct`.
**Expected:** Tick logs appear every 5 seconds. At 2x, log `'Trailing stop activated at 2x'`. At a 15% pullback from peak, `executeFullSell` fires and inserts a sell row in the trades table.
**Why human:** Live provider connection, wallet credentials, and an actual token position are required. Cannot mock `getAmountsOut` / `quoteExactInputSingle` without an RPC endpoint.

#### 2. State Persistence and Bot Restart

**Test:** Start a position, let it run for 30+ seconds (several poll cycles), then kill and restart the bot. Observe that `resumeExitMonitor` is called and logs `'Resumed exit monitor from DB state'` with the correct `highWaterMark`.
**Expected:** `highWaterMark` in the resumed state matches the value that was persisted before restart. `urgencyStartTs` continues from the original timestamp (urgency does not reset on restart). `completedTierIndices` reflects any partial sells that already executed.
**Why human:** Requires a running SQLite database with a live pending buy trade and exit_state row; bot restart sequence cannot be safely simulated with static checks.

---

### Gaps Summary

No blocking gaps. All 4 success criteria are satisfied by substantive, wired, and data-flowing code. The only open item is human verification of live runtime behavior (price queries, sell execution, restart resilience).

**Notable non-blocking observation:** The test file's import block for pure functions (`parsePartialSellTargets`, `computeUrgencyMultiplier`, `computeEffectiveTrailingPct`, etc.) remains commented out, meaning all EXIT-01 through EXIT-04 unit tests are `.todo` stubs. The production behavior is fully implemented, but unit test coverage of the pure functions was not delivered by this phase. If test coverage is a hard requirement, this would be a gap; the current phase goal ("positions managed with intelligent exit strategies") does not mandate test coverage.

---

_Verified: 2026-03-25T23:57:00Z_
_Verifier: Claude (gsd-verifier)_
