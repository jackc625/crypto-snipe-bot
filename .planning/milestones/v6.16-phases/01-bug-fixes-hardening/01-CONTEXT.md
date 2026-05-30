# Phase 1: Bug Fixes & Hardening - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix race conditions, re-enable safety checks, add graceful shutdown and startup validation in the existing single-chain Ethereum sniper bot. The bot must operate reliably without losing money to preventable bugs. No new capabilities — only fixing what's broken and hardening what exists.

</domain>

<decisions>
## Implementation Decisions

### Exit conflict resolution
- Shared per-token mutex: first exit mechanism (stop-loss, take-profit, or timed sell) to acquire the lock proceeds; others see the flag and skip
- On sell TX failure: alert via Telegram with error details, mark position as 'failed', stop all monitoring for that token — no automatic retry
- Balance check every poll: each 15s monitoring loop checks wallet balance for the token; if zero, clear interval and stop monitoring
- After sell cleanup: Claude's discretion on whether to clear all loops immediately on confirmed sell vs. keep as fallback

### Shutdown & restart behavior
- Graceful shutdown on SIGTERM/SIGINT: clear all intervals/timeouts, flush state to disk, exit cleanly within 5 seconds — do NOT attempt to sell open positions
- Resume monitoring on restart: read persisted state, find tokens with status 'pending', restart stop-loss/take-profit/timed-sell loops for them
- Timed sell on resume: reset the timer to a fresh duration (don't calculate remaining time from buy timestamp)

### Telegram sender whitelist
- Whitelisted IDs configured via environment variable: comma-separated sender IDs in `TELEGRAM_ALLOWED_SENDERS` and channel/group IDs in `TELEGRAM_ALLOWED_CHANNELS`
- Both user IDs and channel/group IDs are whitelisted — messages from non-whitelisted sources are rejected
- Non-whitelisted messages: log sender ID and message snippet at debug level, then drop — no Telegram alert, no silent discard

### Sell simulation policy
- Sell simulation (simulateSell) is always-on in production — no toggle, no bypass
- Hard block on simulation failure: if simulateSell returns false, the buy is skipped entirely with a Telegram alert explaining why
- Simulation method: Claude's discretion on whether to use fee-on-transfer variant only or try both standard and fee-on-transfer

### Claude's Discretion
- Post-sell cleanup strategy (immediate cleanup vs. fallback loops)
- Sell simulation method choice (fee-on-transfer only vs. both methods)
- Exact mutex implementation pattern
- Error message formatting for startup validation failures

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — FIX-01 through FIX-09 define all bug fixes and hardening requirements for this phase

### Codebase analysis
- `.planning/codebase/CONCERNS.md` — Known bugs, race conditions, security issues, and fragile areas with file locations and fix approaches

### Core files with bugs
- `src/bot.ts` — Stop-loss/take-profit race condition (lines 54-164), timed sell with no cancellation (lines 166-203), disabled sell simulation (lines 236-243)
- `src/utils/txManager.ts` — Nonce never incremented on Flashbots retry (line 15-29)
- `src/utils/flashbots.ts` — Hardcoded mainnet relay (line 12)
- `src/config.ts` — No env var validation, non-null assertions throughout
- `src/telegramListener.ts` — No sender whitelist, processes all messages (lines 30-67)
- `src/utils/storage.ts` — Synchronous writes, no concurrency control, no state flush on shutdown

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/retry.ts`: Exponential backoff retry utility — can be used for sell retry if approach changes
- `src/utils/notifier.ts`: `sendTelegramAlert()` already handles Telegram bot API notifications
- `src/utils/storage.ts`: `updateTokenStatus()` already supports 'sold'/'failed' status — mutex can use this as coordination point

### Established Patterns
- Config via environment variables loaded in `src/config.ts` with dotenv — whitelist should follow same pattern
- All monitoring uses `setInterval` with manual `clearInterval` — shutdown handler needs a registry of active intervals
- Inline ABI definitions per file (not centralized) — Phase 1 doesn't need to change this (Phase 3 concern)

### Integration Points
- `handleNewPair()` in `src/bot.ts` is the main entry point — exit mechanisms are started here after successful buy
- `startBot()` creates the factory event listener — shutdown handler needs access to this listener to remove it
- `telegramListener.ts` `main()` creates the Telegram client — whitelist check inserts into the event handler

</code_context>

<specifics>
## Specific Ideas

- User was unaware of the timed sell feature — ensure all exit mechanisms are clearly documented in code comments for maintainability
- Timed sell was confirmed as valuable for new token sniping (liquidity can evaporate, sideways trading ties up capital)
- Duration tuning (5 min may be too short) is deferred to Phase 7 (Smart Exit Strategies)

</specifics>

<deferred>
## Deferred Ideas

- Timed sell duration tuning (currently 5 min, may need 15-30 min) — Phase 7: Smart Exit Strategies
- Emergency sell-all-positions on shutdown — could be revisited as a configurable option in later phases

</deferred>

---

*Phase: 01-bug-fixes-hardening*
*Context gathered: 2026-03-19*
