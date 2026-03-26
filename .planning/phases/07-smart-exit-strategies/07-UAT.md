---
status: complete
phase: 07-smart-exit-strategies
source: [07-00-SUMMARY.md, 07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md]
started: 2026-03-26T04:00:00Z
updated: 2026-03-26T04:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running bot process. Run `npx tsc --noEmit` — compiles with zero errors. Run `npx vitest run` — 0 failures (1 pass, 37 todo stubs). DB schema v3 migration is ready.
result: pass

### 2. Exit Strategy Config Parsing
expected: New env vars (TRAILING_STOP_PCT, TRAILING_MIN_PCT, TRAILING_MAX_PCT, PARTIAL_SELL_TARGETS, STOP_LOSS_PCT) all have sensible defaults. Bot starts without setting any of them. Setting `PARTIAL_SELL_TARGETS=2x:50,5x:25` parses into sorted PartialTier array.
result: issue
reported: "Fail. You never updated the .env.example in order for me to know that we needed these values, so they are missing from my .env"
severity: major

### 3. DB Schema v3 — exit_state Table
expected: After DB init, `exit_state` table exists with columns: trade_id, high_water_mark, partial_tiers_completed, volatility_samples, urgency_start_ts, original_token_amount, created_at, updated_at. Foreign key references trades(id). The trades table accepts 'partial_sell' as an action type.
result: pass

### 4. Exit Engine Wired Into All Buy Handlers
expected: After a successful buy, `startExitMonitor()` is called in all 3 handler paths (handleNewPairForChain, handleNewV3PoolForChain, handleNewPair). Token balance is captured after buy TX for partial sell calculations. Trade ID is looked up for exit_state linkage. No separate stop-loss/take-profit/timed-sell registrations.
result: skipped
reason: Bot is not wired completely yet

### 5. Legacy Monitor Functions Removed
expected: bot.ts no longer contains: executeSell, executeSellForChain, executeSellV3ForChain, monitorStopLoss, monitorStopLossForChain, monitorStopLossV3ForChain, monitorTakeProfit, monitorTakeProfitForChain, monitorTakeProfitV3ForChain, scheduleTimedSell, scheduleTimedSellForChain, scheduleTimedSellV3ForChain. ~490 lines removed.
result: pass

### 6. Poll Loop Deterministic Order
expected: pollExitStrategy follows 8-step order: (1) query price, (2) update HWM + volatility, (3) check partial sell tiers, (4) compute effective trailing %, (5) trailing stop check at >=2x, (6) fixed stop-loss below 2x, (7) urgency hard exit at 30min, (8) persist state to DB.
result: pass

### 7. MEV-Protected Sell Execution
expected: All sell transactions (full and partial) route through sendTxWithRetry using txBuilder factory closures — no direct DEX router calls. V2 uses swapExactTokensForETH, V3 uses exactInputSingle via multicall. Approvals are sent directly (outside MEV path).
result: pass

### 8. Resume Monitoring After Restart
expected: On bot restart, resumeExitMonitor loads exit_state from DB for each pending position. High-water mark, completed tier indices, and volatility samples are restored. For pre-Phase7 trades with no exit_state row, fresh state is created using current balance as approximation.
result: pass

## Summary

total: 8
passed: 6
issues: 1
pending: 0
skipped: 1
blocked: 0

## Gaps

- truth: "New exit strategy env vars documented in .env.example so users know to configure them"
  status: failed
  reason: "User reported: Fail. You never updated the .env.example in order for me to know that we needed these values, so they are missing from my .env"
  severity: major
  test: 2
  root_cause: ".env.example was not updated when 5 new exit strategy env vars were added to src/config.ts (lines 59-63): TRAILING_STOP_PCT, TRAILING_MIN_PCT, TRAILING_MAX_PCT, PARTIAL_SELL_TARGETS, STOP_LOSS_PCT"
  artifacts:
    - path: ".env.example"
      issue: "Missing 5 exit strategy env var entries"
    - path: "src/config.ts"
      issue: "Defines vars with defaults but .env.example not kept in sync"
  missing:
    - "Add TRAILING_STOP_PCT, TRAILING_MIN_PCT, TRAILING_MAX_PCT, PARTIAL_SELL_TARGETS, STOP_LOSS_PCT with descriptions and defaults to .env.example"
