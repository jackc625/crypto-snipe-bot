---
status: complete
phase: 11-dashboard-accuracy-bot-wiring
source: [11-VERIFICATION.md]
started: 2026-04-05T20:36:00Z
updated: 2026-04-05T21:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Live Price Display on Positions Page
expected: Open positions show a live current price from queryPrice. When RPC is unreachable or queryPrice returns null, the price cell is yellow with '(stale)' suffix and tooltip 'Live price unavailable. Showing last known value.'
result: skipped
reason: Can't replicate scenario in testing right now

### 2. Telegram Status in Sidebar
expected: With Telegram env vars set: green pulsing StatusDot, 'Telegram: Connected'. Without vars: red static StatusDot, 'Telegram: Not configured'.
result: pass

### 3. Chain Restart Warning Banner
expected: Yellow left-border banner on ChainStatusCard shows each warning string with a dismiss (x) button. Clicking dismiss clears the banner.
result: skipped
reason: Cannot trigger warning state in current environment

### 4. Chain Controls Page Rendering
expected: Page renders chain cards with Snipe Parameters, Risk Limits, Exit Strategy, Connection Status, and DEXes sections. No TypeError crash.
result: pass

## Summary

total: 4
passed: 2
issues: 0
pending: 0
skipped: 2
blocked: 0

## Gaps
