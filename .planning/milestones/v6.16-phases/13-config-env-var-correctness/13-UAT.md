---
status: passed
phase: 13-config-env-var-correctness
source: 13-01-SUMMARY.md
started: 2026-04-06T17:00:00Z
updated: 2026-04-06T17:05:00Z
---

## Tests

### 1. STOP_LOSS_PCT Env Var Wiring
expected: Setting STOP_LOSS_PCT=10 in .env causes CONFIG.stopLossPercent to equal 10 instead of the old hardcoded 25. The value flows through to the exit engine via buildExitConfig().
result: PASS — config.ts:126 reads process.env.STOP_LOSS_PCT via parseFloat IIFE. Unit test (line 68) confirms STOP_LOSS_PCT=15 yields 15. Integration test (line 117) confirms STOP_LOSS_PCT=18 flows through buildExitConfig().stopLossPct.

### 2. STOP_LOSS_PCT Default Fallback
expected: With STOP_LOSS_PCT unset or removed from .env, CONFIG.stopLossPercent defaults to 25. No crash, no NaN.
result: PASS — Unit test (line 73) deletes env var, confirms default 25. IIFE fallback string '25' in parseFloat handles missing case.

### 3. STOP_LOSS_PCT NaN Safety
expected: Setting STOP_LOSS_PCT to an invalid value (e.g. "abc") safely falls back to 25 instead of producing NaN. The IIFE's isNaN guard handles this.
result: PASS — Unit test (line 79) sets STOP_LOSS_PCT=abc, confirms isNaN guard returns 25.

### 4. FLASHBOTS_AUTH_KEY Not Globally Required
expected: Bot starts without FLASHBOTS_AUTH_KEY set when using a non-ETH chain (e.g. ENABLED_CHAINS=bsc). Previously this would fail env validation at startup. Now FLASHBOTS_AUTH_KEY has required: false in REQUIRED_ENV_VARS.
result: PASS — config.ts:23 has required: false. Two unit tests (lines 87, 96) confirm no process.exit when key missing, including BSC-only deployment.

### 5. .env.example Documentation
expected: .env.example shows FLASHBOTS_AUTH_KEY marked as [OPTIONAL] with note "(required when eth chain enabled)". STOP_LOSS_PCT is documented with default 25.
result: PASS — .env.example:37 shows FLASHBOTS_AUTH_KEY [OPTIONAL] with eth caveat. Line 70 shows STOP_LOSS_PCT=25 [OPTIONAL].

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
