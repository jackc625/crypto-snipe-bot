---
phase: 07-smart-exit-strategies
plan: 02
subsystem: exit-engine
tags: [exit-engine, trailing-stop, partial-sell, volatility, urgency, mev-protection, poll-loop]

# Dependency graph
requires:
  - phase: 07-smart-exit-strategies
    plan: 01
    provides: "ExitConfig, VolatilityTracker, pure computation helpers, DB statements, exit_state table"
provides:
  - "startExitMonitor() -- unified entry point for position exit management"
  - "resumeExitMonitor() -- restart-resilient state reload from DB"
  - "pollExitStrategy() -- 8-step deterministic exit evaluation loop"
  - "queryPrice() -- V2/V3 price dispatcher"
  - "executeFullSell()/executePartialSell() -- MEV-protected sell execution"
  - "formatExitReason() -- notification formatting"
affects:
  - "src/bot.ts -- Plan 03 will wire startExitMonitor into snipe handlers"

# Tech stack
added: []
patterns:
  - "txBuilder factory pattern: buildV2SellTx/buildV3SellTx return async () => TransactionRequest for sendTxWithRetry"
  - "Deterministic poll order: price -> HWM -> partials -> trailing -> stop-loss -> urgency -> persist"
  - "ensureApproval outside MEV path: approvals sent directly, swaps through sendTxWithRetry"

# Key files
created: []
modified:
  - path: src/exitEngine.ts
    changes: "Added 622 lines: queryPrice, buildV2SellTx, buildV3SellTx, ensureApproval, executeFullSell, executePartialSell, formatExitReason, pollExitStrategy, startExitMonitor, resumeExitMonitor"

# Decisions
key-decisions:
  - "txBuilder factory pattern for MEV-protected sells -- buildV2SellTx/buildV3SellTx return closures compatible with sendTxWithRetry"
  - "Approval sent directly (no MEV protection needed) while swap TX routes through sendTxWithRetry"
  - "Partial sell failure does NOT kill exit monitor (Pitfall 6) -- logs warning, retries next cycle"
  - "Full sell failure marks trade as failed and cleans up all timers/state"
  - "resumeExitMonitor creates fresh state for pre-Phase7 trades using current balance as approximation"

# Metrics
duration: 6min
completed: "2026-03-26T03:36:08Z"
tasks_completed: 2
tasks_total: 2
files_modified: 1
---

# Phase 7 Plan 02: Exit Engine Core -- Poll Loop & Sell Execution Summary

Unified exit engine poll loop with MEV-protected sell execution via sendTxWithRetry txBuilder factories for V2/V3 DEX dispatch

## What Was Built

### Task 1: Price Query, Sell Execution, and Notification Helpers (84e6730)

Added 6 functions to exitEngine.ts that form the I/O layer for the exit engine:

- **queryPrice()**: Dispatches to V2 `getAmountsOut` or V3 `QuoterV2.quoteExactInputSingle` based on DexConfig discriminated union. Returns Number for ratio comparisons, null on error.
- **buildV2SellTx() / buildV3SellTx()**: Factory functions returning `() => Promise<TransactionRequest>` closures that encode swap calldata. V2 uses `swapExactTokensForETH`, V3 uses `exactInputSingle` wrapped in `multicall` with deadline.
- **ensureApproval()**: Checks current allowance and approves if needed. Runs outside MEV protection (approval does not need it).
- **executeFullSell()**: Handles trailing-stop, stop-loss, and urgency exits. Acquires sell lock, checks balance, builds txBuilder, routes through `sendTxWithRetry(txBuilder, ctx)`, records trade, cleans up timers and DB state. On failure, marks trade failed and cleans up.
- **executePartialSell()**: Handles tier-based partial sells. Clamps amount to actual balance (Pitfall 7), routes through sendTxWithRetry, records as `partial_sell` trade row, marks tiers completed. On failure, logs warning but does NOT kill monitor (Pitfall 6).
- **formatExitReason()**: Formats detailed Telegram notification text with strategy context (peak, pullback %, P&L %, price multiple).

### Task 2: startExitMonitor, pollExitStrategy, resumeExitMonitor (96b61a9)

Added 3 functions completing the exit engine:

- **pollExitStrategy()**: The 8-step deterministic loop called every 5 seconds per position:
  1. Query price (skip cycle on null)
  2. Update high-water mark and volatility tracker
  3. Check partial sell tiers (combined gap sell via D-08)
  4. Compute effective trailing stop % (volatility widens, urgency tightens)
  5. Check trailing stop trigger (only at >= 2x)
  6. Check fixed stop-loss (below 2x only)
  7. Urgency hard exit at 30-minute deadline
  8. Persist state to DB

- **startExitMonitor()**: Public entry point. Queries initial price, builds ExitStateData, seeds volatility tracker, persists to DB, creates 5s setInterval, registers in timer registry.

- **resumeExitMonitor()**: Restart-resilient entry point. Loads exit_state from DB if available, otherwise creates fresh state using current balance as original token amount approximation. Resumes poll loop.

## Decisions Made

1. **txBuilder factory pattern**: buildV2SellTx/buildV3SellTx return closures that produce TransactionRequest objects, matching sendTxWithRetry's expected signature. This keeps swap encoding lazy and composable.

2. **Approval outside MEV path**: Token approvals are sent directly since they don't need MEV protection. Only the swap transaction routes through sendTxWithRetry.

3. **Partial sell resilience**: Failure does NOT kill the exit monitor -- just logs warning and retries next cycle. Full sell failure marks trade failed and cleans up everything.

4. **Pre-Phase7 trade handling**: resumeExitMonitor uses current wallet balance as originalTokenAmount approximation when no exit_state row exists.

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all functions are fully implemented. The it.todo test stubs from Plan 00/01 remain but are out of scope for this plan.

## Verification

- `npx tsc --noEmit` compiles with zero errors
- `npx vitest run` reports 0 failures (1 passed, 37 todo stubs from Plan 00)
- exitEngine.ts is 911 lines total (289 from Plan 01 + 622 from Plan 02)
- All sell transactions route through sendTxWithRetry (no direct DEX calls)
- releaseSellLock in finally block of both executeFullSell and executePartialSell
- State persisted via upsertExitState.run after every poll cycle and state change

## Self-Check: PASSED

- [x] src/exitEngine.ts exists (911 lines)
- [x] Commit 84e6730 exists (Task 1)
- [x] Commit 96b61a9 exists (Task 2)
- [x] All exports present: startExitMonitor, resumeExitMonitor, queryPrice, executeFullSell, executePartialSell, formatExitReason
- [x] No direct DEX swap calls (0 matches for direct router calls)
- [x] TypeScript compiles clean
- [x] Tests pass
