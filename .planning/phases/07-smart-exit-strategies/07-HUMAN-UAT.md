---
status: partial
phase: 07-smart-exit-strategies
source: [07-VERIFICATION.md]
started: 2026-03-26T00:00:00Z
updated: 2026-03-26T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live poll cycle — trailing stop, partial sells, urgency
expected: Single setInterval-based monitor fires, records exit_state to SQLite every 5s, executes partial sells via sendTxWithRetry, triggers full sell via trailing stop, urgency, or fixed stop-loss
result: [pending]

### 2. Bot restart resilience — resumeExitMonitor state persistence
expected: highWaterMark, completedTierIndices, and urgencyStartTs survive the restart; trailing activation is preserved; urgency clock continues from original start time
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
