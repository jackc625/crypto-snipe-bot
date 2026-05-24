---
status: partial
phase: 20-going-live-ops-hardening
source: [20-VERIFICATION.md]
started: 2026-05-24T23:30:00Z
updated: 2026-05-24T23:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. npm run preflight smoke test against live RPC
expected: Script exits 0 and prints per-chain pass/fail summary without starting the bot; no `startMultiChainBot` log line appears. On any FATAL, exit non-zero with structured pino error pointing to docs/operations/going-live.md.
result: [pending]

### 2. Dashboard pause banner visual + WS event delivery
expected: With dashboard open in browser, `npm run pause -- --reason 'smoke'` causes red full-bleed BOT PAUSED banner to appear immediately; `npm run resume` removes it. Banner survives page navigation. WS push (not polling) drives both transitions.
result: [pending]

### 3. Multi-stage kill-switch timing under live MEV conditions
expected: Press dashboard pause button while bot is mid-evaluation; CP1 fires on next PairCreated event after pause; `sendTxWithRetry` is never called for that event; pino info `op:killswitch.cp1` appears in logs.
result: [pending]

### 4. D-PAUSED-RESTART full positive observable
expected: Seed `pause_state.paused=1` in `data/bot.db`, restart bot — all chain listeners attach, dashboard responds 200, exit monitors run for open positions, first new `PairCreated` triggers CP1 early-return (no buy). Operator-pressed pause survives a full reboot.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
