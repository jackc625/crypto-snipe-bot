---
status: partial
phase: 06-risk-management
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md]
started: 2026-03-23T21:00:00Z
updated: 2026-03-24T01:32:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running bot process. Start the bot from scratch. The bot boots without errors, connects to configured chains, and begins listening for new pairs/pools. No risk-related import errors or missing function crashes.
result: pass

### 2. Risk Env Var Defaults
expected: Start the bot WITHOUT any risk env vars set in .env. The bot starts normally using default values (MAX_OPEN_POSITIONS=10, MAX_TOTAL_EXPOSURE=10.0, DAILY_LOSS_PCT=10, SNIPE_COOLDOWN_MS=30000). No errors about missing risk configuration.
result: pass

### 3. Risk Gate Blocks Over-Sized Position
expected: Set MAX_POSITION_SIZE to a value lower than your chain's snipeAmount (e.g., MAX_POSITION_SIZE=0.001). When a new pair/pool is detected, the bot logs a risk rejection with reason "position_size" and details showing the attempted amount vs the limit. The snipe does NOT proceed to safety checks.
result: blocked
blocked_by: server
reason: "No RPC connection available — bot cannot detect new pairs without a running node"

### 4. Risk Gate Blocks Max Positions Exceeded
expected: Set MAX_OPEN_POSITIONS=0. When a new pair/pool is detected, the bot logs a risk rejection with reason "max_positions" showing current count vs limit. The snipe does NOT proceed.
result: blocked
blocked_by: server
reason: "No RPC connection available — bot cannot detect new pairs without a running node"

### 5. Telegram Alert on Risk Rejection
expected: When a risk check blocks a snipe (any of the above tests), a Telegram message is sent showing the token address, the rejection reason (e.g., "position_size", "max_positions"), and the specific details (e.g., "0.1 ETH > max 0.001 ETH").
result: blocked
blocked_by: server
reason: "No RPC connection available — requires live pair detection to trigger risk rejection and Telegram alert"

### 6. Legacy Capital Tracking Removed
expected: Search bot.ts for `capitalDeployed`, `canDeployCapital`, or `recordCapitalDeployed`. None of these exist — they have been fully replaced by the riskManager module. The bot uses `canSnipe()` and `recordSnipe()` instead.
result: pass

### 7. Risk Gate Fires Before Safety Checks
expected: With a risk rejection active (e.g., MAX_OPEN_POSITIONS=0), trigger a new pair detection. The bot should reject immediately with the risk reason and NOT make any external API calls (sell simulation, honeypot check). Verify by checking that no safety-check logs appear after the risk rejection log.
result: blocked
blocked_by: server
reason: "No RPC connection available — bot cannot detect new pairs without a running node"

## Summary

total: 7
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 4

## Gaps

[none yet]
