---
status: resolved
phase: 01-bug-fixes-hardening
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md]
started: 2026-03-19T20:00:00Z
updated: 2026-03-19T21:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Startup Env Var Validation
expected: Remove or unset a required env var (e.g., PRIVATE_KEY or TELEGRAM_API_ID) from your .env file, then start the bot. The bot should immediately exit with a clear error message listing each missing env var and its description. It should NOT crash with an undefined/null reference error.
result: pass

### 2. Unsupported Network Error
expected: Set CONFIG.network (NETWORK env var) to an unsupported value like "polygon" or "arbitrum", then start the bot. The bot should throw an explicit error listing valid network options (sepolia, mainnet), NOT a cryptic undefined URL error.
result: issue
reported: "CONFIG.network is hardcoded to 'sepolia' in config.ts line 51 instead of being configurable via NETWORK env var. Can't test unsupported network without editing source code. Also no .env.example file exists documenting required and optional env vars."
severity: major

### 3. Graceful Shutdown
expected: Start the bot normally, then press Ctrl+C (or send SIGTERM). The bot should log cleanup steps (clearing timers, removing listeners, flushing state) and exit cleanly within a few seconds. It should NOT hang indefinitely or leave orphan timers.
result: pass

### 4. Telegram Whitelist - Backward Compatible
expected: Leave TELEGRAM_ALLOWED_SENDERS and TELEGRAM_ALLOWED_CHANNELS env vars unset or empty. Start the bot with Telegram connected. All incoming messages should be processed normally (no filtering). Behavior should be identical to before the whitelist feature was added.
result: skipped
reason: Cannot test Telegram integration currently

### 5. Telegram Whitelist - Filtering Active
expected: Set TELEGRAM_ALLOWED_SENDERS to a specific user ID (or TELEGRAM_ALLOWED_CHANNELS to a specific channel ID). Start the bot. Messages from allowed senders/channels should be processed. Messages from non-whitelisted sources should be silently rejected, with debug-level log showing the rejected sender ID, chat ID, and first 50 chars of the message.
result: skipped
reason: Cannot test Telegram integration currently

### 6. Flashbots Relay Network Selection
expected: With CONFIG.network set to "sepolia", the bot should use the Sepolia Flashbots relay (relay-sepolia.flashbots.net). With "mainnet", it should use the mainnet relay. You can verify by checking startup logs or by reviewing that the relay URL logged matches your configured network.
result: pass

### 7. TypeScript Compilation
expected: Run `npx tsc --noEmit` from the project root. The project should compile without errors related to the new/modified files (exitManager.ts, bot.ts, storage.ts, flashbots.ts, txManager.ts, config.ts, telegramListener.ts). Pre-existing errors in unrelated files are acceptable.
result: pass

## Summary

total: 7
passed: 4
issues: 1
pending: 0
skipped: 2

## Gaps

- truth: "Network should be configurable via env var, not hardcoded in source"
  status: resolved
  reason: "User reported: CONFIG.network is hardcoded to 'sepolia' in config.ts instead of being driven by a NETWORK env var. Cannot switch networks without editing source."
  severity: major
  test: 2
  root_cause: "Multi-network plumbing partially built but never connected at input layer. FLASHBOTS_RELAYS supports both networks, but CONFIG.network is a string literal. Additionally, rpc map has no mainnet entry."
  artifacts:
    - path: "src/config.ts"
      issue: "Line 51: hardcoded 'sepolia'. Lines 43-46: rpc map missing mainnet. Lines 13-24: REQUIRED_ENV_VARS missing NETWORK."
    - path: "src/utils/flashbots.ts"
      issue: "Lines 5-8: FLASHBOTS_RELAYS already supports both networks (downstream ready)"
  missing:
    - "Read process.env.NETWORK with default 'sepolia', validate against known keys"
    - "Add NETWORK to REQUIRED_ENV_VARS as optional"
    - "Add mainnet RPC entry (or reuse ALCHEMY_URL since user sets correct one per network)"
  debug_session: ".planning/debug/config-network-hardcoded-no-env-example.md"

- truth: "Project should have .env.example documenting all required and optional env vars"
  status: resolved
  reason: "User reported: No .env.example exists. New env vars added (TELEGRAM_ALLOWED_SENDERS, TELEGRAM_ALLOWED_CHANNELS) are undiscoverable without reading source code."
  severity: major
  test: 2
  root_cause: "Internal env var registry (REQUIRED_ENV_VARS array) was never externalized into a .env.example file. Phase 01 added 2 optional vars, making documentation gap worse."
  artifacts:
    - path: "src/config.ts"
      issue: "Lines 13-24: REQUIRED_ENV_VARS array is source of truth but not externalized"
    - path: "src/telegramListener.ts"
      issue: "Lines 17-22: new optional vars consumed here"
  missing:
    - "Create .env.example at project root with all 8 required + 2 optional vars with placeholder values and comments"
    - "Include NETWORK var from Gap 1 fix as optional"
  debug_session: ".planning/debug/config-network-hardcoded-no-env-example.md"
