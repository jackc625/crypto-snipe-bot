---
phase: 01-bug-fixes-hardening
verified: 2026-03-19T22:00:00Z
status: passed
score: 15/15 must-haves verified
re_verification:
  previous_status: passed
  previous_score: 13/13
  gaps_closed:
    - "NETWORK env var controls CONFIG.network — no longer hardcoded to 'sepolia'"
    - ".env.example exists documenting all 8 required and 3 optional env vars"
  gaps_remaining: []
  regressions: []
---

# Phase 01: Bug Fixes & Hardening Verification Report

**Phase Goal:** Fix critical bugs and harden the bot for reliable operation — race conditions, Flashbots relay, nonce management, exit lifecycle, config validation, and Telegram access control.
**Verified:** 2026-03-19T22:00:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plan 01-04 added NETWORK env var and .env.example)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Stop-loss and take-profit cannot both execute a sell for the same token — first acquires lock, second skips | VERIFIED | `executeSell` calls `tryAcquireSellLock`; returns early if already locked (bot.ts:70-73) |
| 2 | When any exit mechanism sells a token, all other timers are cancelled | VERIFIED | `clearAllTimersForToken` called on both success (line 100) and failure (line 106) paths of `executeSell` |
| 3 | SIGTERM/SIGINT triggers orderly shutdown: timers cleared, factory listener removed, state flushed, exit within 5s | VERIFIED | `initShutdownHandler` registers both signals; calls `clearAllTimers()`, `factory.removeAllListeners()`, `flushState()`; 5s force-exit with `.unref()` (exitManager.ts:84-118) |
| 4 | If token balance is zero, monitoring interval clears itself and updates status | VERIFIED | Balance-zero check at start of both `monitorStopLoss` (bot.ts:127-134) and `monitorTakeProfit` (bot.ts:168-176) intervals; also in `executeSell` (bot.ts:79-84) |
| 5 | Sell simulation runs before every buy — if it fails, buy is skipped with Telegram alert | VERIFIED | `simulateSell` called unconditionally at bot.ts:235-240; not commented out |
| 6 | On restart, tokens with status 'pending' get fresh monitoring loops resumed | VERIFIED | `resumeMonitoring()` at bot.ts:343-363; called in `startBot()` at line 368 |
| 7 | Flashbots relay URL and network name selected dynamically from CONFIG.network | VERIFIED | `FLASHBOTS_RELAYS` map in flashbots.ts:5-8; lookup at line 14 using `CONFIG.network` |
| 8 | Each Flashbots bundle retry uses incrementing nonce (baseNonce + retryCount) | VERIFIED | `baseNonce` at txManager.ts:15; `nonce: baseNonce + retries` at line 29 |
| 9 | Unsupported network throws explicit error rather than using wrong relay | VERIFIED | Explicit `throw new Error(...)` at flashbots.ts:16 when relay lookup returns undefined |
| 10 | Bot startup validates all required env vars with clear error listing, then process.exit(1) | VERIFIED | `validateEnvVars()` called at config.ts:41 before any exports; 8 required vars validated; `[STARTUP ERROR]` message with missing var list |
| 11 | Only messages from whitelisted sender IDs or channel IDs are processed | VERIFIED | `allowedSenders`/`allowedChannels` Sets parsed from env at telegramListener.ts:17-22; check at lines 44-50 as first action in handler |
| 12 | Rejected messages logged at debug level with sender ID, chat ID, snippet | VERIFIED | `console.debug("[TELEGRAM] Rejected message from sender=...")` at telegramListener.ts:48 |
| 13 | Whitelist parsed from comma-separated env vars into Sets for O(1) lookup | VERIFIED | `new Set(...split(',').map().filter())` pattern at telegramListener.ts:17-22 |
| 14 | NETWORK env var controls which network the bot connects to, defaulting to 'sepolia' when unset | VERIFIED | `const networkInput = (process.env.NETWORK \|\| 'sepolia').toLowerCase()` at config.ts:53; `CONFIG.network: networkInput` at line 63 |
| 15 | .env.example exists at project root documenting all required and optional env vars with placeholder values | VERIFIED | `.env.example` present at project root; 8 required + 3 optional vars with sections, placeholders, and [REQUIRED]/[OPTIONAL] markers |

**Score:** 15/15 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/utils/exitManager.ts` | Per-token sell mutex, timer registry, shutdown handler | VERIFIED | 119 lines; exports 9 functions: tryAcquireSellLock, releaseSellLock, registerStopLoss, registerTakeProfit, registerTimedSell, clearAllTimersForToken, clearAllTimers, initShutdownHandler, isShutdownInProgress |
| `src/bot.ts` | Unified executeSell, timer registration, sell simulation, resume | VERIFIED | executeSell with mutex (lines 66-109); monitorStopLoss/TakeProfit register timers; scheduleTimedSell registers timeout; simulateSell active (line 235); resumeMonitoring called in startBot (line 368) |
| `src/utils/storage.ts` | getState and flushState exports | VERIFIED | Both functions exported at lines 49-55 |
| `src/utils/flashbots.ts` | Dynamic relay selection from CONFIG.network | VERIFIED | FLASHBOTS_RELAYS map; runtime lookup at line 14; explicit throw on unknown network at line 16 |
| `src/utils/txManager.ts` | Nonce incrementing on each retry | VERIFIED | `nonce: baseNonce + retries` at line 29; baseNonce fetched from provider at line 15 |
| `src/config.ts` | Startup env var validation, NETWORK env var, mainnet RPC entry | VERIFIED | validateEnvVars() at line 41; networkInput from process.env.NETWORK with 'sepolia' default at line 53; rpc map has sepolia, mainnet, bsc entries (lines 44-48); network validation before CONFIG export (lines 55-59); NETWORK in REQUIRED_ENV_VARS as optional (line 24) |
| `src/telegramListener.ts` | Sender/channel whitelist filtering | VERIFIED | allowedSenders/allowedChannels Sets; whitelist check first in handler; debug logging; handleAlphaDrop call preserved |
| `.env.example` | All 8 required + 3 optional env vars documented | VERIFIED | File exists; contains PRIVATE_KEY, ALCHEMY_URL, FLASHBOTS_AUTH_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION (required) and NETWORK, TELEGRAM_ALLOWED_SENDERS, TELEGRAM_ALLOWED_CHANNELS (optional) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/bot.ts` | `src/utils/exitManager.ts` | import tryAcquireSellLock, register*, clearAllTimersForToken, initShutdownHandler | WIRED | Import at bot.ts:21-29; all 6 imported functions actively called |
| `src/bot.ts` | `src/utils/storage.ts` | import getState for resume, flushState via exitManager for shutdown | WIRED | `getState` imported at bot.ts:19; used in resumeMonitoring at line 344 |
| `src/utils/exitManager.ts` | `src/utils/storage.ts` | import flushState for shutdown handler | WIRED | `import { flushState } from "./storage"` at exitManager.ts:2; called at line 95 |
| `src/utils/flashbots.ts` | `src/config.ts` | import CONFIG for network selection | WIRED | `import { CONFIG, SupportedNetwork } from "../config"` at flashbots.ts:3; CONFIG.network used at line 14 |
| `src/utils/txManager.ts` | `src/utils/flashbots.ts` | import getFlashbotsProvider | WIRED | `import { getFlashbotsProvider } from "./flashbots"` at txManager.ts:3; called at line 14 |
| `src/config.ts` | `process.env` | validateEnvVars checks required vars before exports | WIRED | validateEnvVars() at line 41; `export const rpc` at line 44 — validation runs first |
| `src/config.ts` | `process.env.NETWORK` | env var read with default and validation | WIRED | `(process.env.NETWORK \|\| 'sepolia').toLowerCase()` at line 53; validated against rpc keys at lines 54-59; consumed as CONFIG.network at line 63 |
| `src/utils/flashbots.ts` | `CONFIG.network` | FLASHBOTS_RELAYS lookup using env-driven network value | WIRED | `FLASHBOTS_RELAYS[CONFIG.network]` at line 14; CONFIG.network now sourced from NETWORK env var end-to-end |
| `src/telegramListener.ts` | `process.env.TELEGRAM_ALLOWED_SENDERS` | parsed into Set for whitelist | WIRED | `process.env.TELEGRAM_ALLOWED_SENDERS` at telegramListener.ts:18; used in allowedSenders Set |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FIX-01 | 01-01 | Mutex-based exit mediation prevents double-sell | SATISFIED | tryAcquireSellLock in executeSell; lock check and early return at bot.ts:70-73 |
| FIX-02 | 01-02 | Flashbots relay selected dynamically from configured chain | SATISFIED | FLASHBOTS_RELAYS map with sepolia/mainnet; CONFIG.network lookup at flashbots.ts:14 |
| FIX-03 | 01-02 | Nonce increments on each bundle retry | SATISFIED | baseNonce + retries at txManager.ts:29 |
| FIX-04 | 01-01 | Sell simulation re-enabled before every buy | SATISFIED | simulateSell at bot.ts:235; not commented; hard block on failure |
| FIX-05 | 01-01 | Graceful SIGTERM/SIGINT handling | SATISFIED | initShutdownHandler with clearAllTimers + removeAllListeners + flushState; called in startBot |
| FIX-06 | 01-03, 01-04 | Startup env var validation with clear error messages AND env-driven network selection | SATISFIED | validateEnvVars() lists all 8 required vars with descriptions + process.exit(1); NETWORK env var drives CONFIG.network with validation; .env.example documents all 11 vars |
| FIX-07 | 01-01 | Timed sell cancelled when position already sold | SATISFIED | clearAllTimersForToken called after every executeSell path (success + failure + zero-balance) |
| FIX-08 | 01-01 | Monitoring loops exit when balance reaches zero | SATISFIED | balance.isZero() check at start of monitorStopLoss and monitorTakeProfit intervals |
| FIX-09 | 01-03 | Telegram alpha listener only processes whitelisted senders | SATISFIED | allowedSenders/allowedChannels Sets; first-action check in handler; debug logging of rejections |

All 9 requirement IDs from REQUIREMENTS.md Phase 01 section are covered. No orphaned requirements.

**Note on FIX-06 scope expansion:** Plan 01-04 extended FIX-06 beyond "startup validation" to include env-driven network selection. The ROADMAP success criterion #2 ("validates all environment variables and reports clear errors for any that are missing") is now fully met, plus UAT gaps are closed.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/bot.ts` | 28 | `isShutdownInProgress` imported but never called in file | Info | Dead import; no functional impact |
| `src/bot.ts` | — | `releaseSellLock` never called after sell completes | Info | Lock entry persists in memory Map after each sell; not a correctness bug because clearAllTimersForToken cancels all monitoring so the locked token is never re-entered |
| `src/utils/flashbots.ts` | 3 | `SupportedNetwork` imported but not used as a type annotation in the file | Info | Dead import; TypeScript does not error because it is a type-only import from a module that also provides values |
| `src/telegramListener.ts` | 55, 61 | Diagnostic `console.log` statements present ("Incoming message:" and "Matches:") marked "remove later" | Warning | Intended to be removed — will produce verbose output per message in production |

---

### Human Verification Required

None — all observable truths for this phase are verifiable programmatically through code inspection.

---

### Gaps Summary

No gaps. All 9 requirements are fully implemented, all artifacts are substantive (not stubs), all key links are wired end-to-end.

**Gap closure from plan 01-04 confirmed:**

1. `CONFIG.network` is now driven by `process.env.NETWORK` with a `'sepolia'` default and explicit validation against `Object.keys(rpc)`. Setting `NETWORK=polygon` would produce `[STARTUP ERROR] Unsupported network: "polygon"` listing valid options before any connection is attempted.

2. `.env.example` exists at the project root documenting all 11 environment variables (8 required, 3 optional) with section groupings, placeholder values, and [REQUIRED]/[OPTIONAL] markers. New contributors and new environments can onboard without reading source code.

**Persistent informational items (not blockers):**

1. **Diagnostic console.log statements** in `src/telegramListener.ts` (lines 55, 61) are marked for removal but do not affect correctness. Will produce one log line per Telegram message in production.

2. **`releaseSellLock` is exported but never called.** Safe because monitoring loops are cancelled via `clearAllTimersForToken` after every sell, preventing re-entry. If a "retry on failed sell" flow is added in a future phase, this will need addressing.

3. **`isShutdownInProgress` is imported in bot.ts (line 28) but never used.** Dead import.

---

### Commit Verification

All commits documented in summaries exist in git history:

| Commit | Plan | Description |
|--------|------|-------------|
| `241f92a` | 01-01 Task 1 | Create exitManager.ts with mutex and timer registry |
| `c6de4da` | 01-01 Task 2 | Restructure bot.ts exit lifecycle |
| `d8070c4` | 01-02 Task 1 | Dynamic Flashbots relay + nonce fix |
| `87ac148` | 01-03 Task 2 | Telegram sender/channel whitelist |
| `2285e57` | 01-04 Task 1 | Make CONFIG.network env-driven with validation |
| `39f1fad` | 01-04 Task 2 | Create .env.example documenting all env vars |

---

_Verified: 2026-03-19T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
