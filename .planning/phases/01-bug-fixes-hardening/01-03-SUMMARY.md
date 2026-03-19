---
phase: 01-bug-fixes-hardening
plan: 03
subsystem: config, telegram
tags: [env-validation, telegram-whitelist, startup-checks, security]

# Dependency graph
requires: []
provides:
  - "Startup env var validation with clear error messages (validateEnvVars)"
  - "Telegram sender/channel whitelist filtering with debug logging"
affects: [02-ethers-v6-migration, 04-multi-chain]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-fast env var validation at module load time before CONFIG construction"
    - "Set-based whitelist parsing from comma-separated env vars for O(1) lookup"
    - "Manual event handler filtering with debug logging (not built-in GramJS filtering)"

key-files:
  created: []
  modified:
    - src/config.ts
    - src/telegramListener.ts

key-decisions:
  - "Manual whitelist check inside handler instead of GramJS NewMessage({fromUsers, chats}) to enable debug logging of rejected messages"
  - "Empty whitelist means allow-all for backward compatibility"
  - "BigInteger senderId/chatId converted via .toString() for string comparison against env var values"

patterns-established:
  - "Env var validation: define REQUIRED_ENV_VARS spec array, validate before exports"
  - "Telegram whitelist: parse env vars into Sets, check sender OR channel match"

requirements-completed: [FIX-06, FIX-09]

# Metrics
duration: 13min
completed: 2026-03-19
---

# Phase 01 Plan 03: Config Validation & Telegram Whitelist Summary

**Startup env var validation with fail-fast error listing, and Telegram sender/channel whitelist with debug-level rejection logging**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-19T19:43:26Z
- **Completed:** 2026-03-19T19:56:18Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Bot startup validates all 8 required env vars before CONFIG construction; missing vars produce clear error listing each var with its description, then exit(1)
- Telegram listener filters messages by sender ID and channel/group ID whitelist parsed from comma-separated env vars into Sets for O(1) lookup
- Rejected messages logged at debug level with sender ID, chat ID, and message snippet (first 50 chars)
- Backward compatible: empty whitelist env vars = allow all messages through

## Task Commits

Each task was committed atomically:

1. **Task 1: Add startup env var validation to config.ts** - `d8070c4` (feat) - pre-existing: committed as part of 01-02 plan execution when writing full file from empty stub
2. **Task 2: Add Telegram sender/channel whitelist to telegramListener.ts** - `87ac148` (feat)

## Files Created/Modified

- `src/config.ts` - Added EnvVarSpec interface, REQUIRED_ENV_VARS array (8 required + 2 optional), validateEnvVars() function called at module load time
- `src/telegramListener.ts` - Added allowedSenders/allowedChannels Set parsing from env vars, whitelist check as first action in event handler with debug logging for rejected messages

## Decisions Made

- Used manual whitelist check inside handler rather than GramJS `NewMessage({fromUsers, chats})` because built-in filtering silently drops messages without logging, and user decision requires debug-level logging of rejected messages
- When both whitelist Sets are empty, all messages pass through (backward compatible with existing deployments that have no whitelist configured)
- A message is allowed if EITHER its sender is whitelisted OR its chat/channel is whitelisted; both must fail for rejection
- Used `.toString()` on BigInteger senderId/chatId (from big-integer library, not native bigint) for correct string comparison against env var values

## Deviations from Plan

### Note on Task 1

Task 1 (env var validation in config.ts) was already committed as part of plan 01-02 execution (`d8070c4`). The prior executor wrote the full config.ts file content (from an empty stub) and included the validation block. The working tree file matched HEAD, so no new commit was needed for Task 1. The code was verified to meet all acceptance criteria.

No other deviations. Task 2 executed exactly as written.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Task 1 was pre-completed by prior plan execution. No scope creep.

## Issues Encountered

- Task 1 code was already present in HEAD from plan 01-02 commit (d8070c4) because prior executor wrote full file from empty stub and included validation block. Verified correct and moved to Task 2.

## User Setup Required

Users should add these optional env vars to their `.env` file for Telegram whitelist filtering:
- `TELEGRAM_ALLOWED_SENDERS` - Comma-separated Telegram user IDs (e.g., `123456789,987654321`)
- `TELEGRAM_ALLOWED_CHANNELS` - Comma-separated Telegram channel/group IDs (e.g., `-1001234567890,-1009876543210`)

If not set, all messages are processed (backward compatible).

## Next Phase Readiness

- All 9 bug fixes across plans 01-01, 01-02, and 01-03 are now complete
- Phase 01 (bug-fixes-hardening) is ready for verification
- Config validation ensures fail-fast on missing env vars
- Telegram whitelist secures message processing pipeline

## Self-Check: PASSED

- [x] src/config.ts exists with validateEnvVars
- [x] src/telegramListener.ts exists with whitelist filtering
- [x] 01-03-SUMMARY.md created
- [x] Commit d8070c4 (Task 1 - pre-existing) found
- [x] Commit 87ac148 (Task 2) found

---
*Phase: 01-bug-fixes-hardening*
*Completed: 2026-03-19*
