---
phase: 03-sqlite-storage-code-quality
plan: 03
subsystem: infra, logging
tags: [pino, structured-logging, provider-singleton, abi-centralization, console-removal]

# Dependency graph
requires:
  - phase: 03-sqlite-storage-code-quality
    plan: 01
    provides: logger.ts (pino), provider.ts (getProvider), abis.ts (FACTORY_ABI, PAIR_ABI)
provides:
  - Six supporting files migrated to pino structured logging
  - alphaDrop.ts using singleton provider and centralized PAIR_ABI
  - pairDiscovery.ts using singleton provider and centralized FACTORY_ABI
  - Zero console.log/warn/error calls remaining in supporting files
affects: [03-04, all-consumer-files]

# Tech tracking
tech-stack:
  added: []
  patterns: [pino-child-logger-per-module, structured-log-context-objects, debug-level-for-sensitive-data]

key-files:
  created: []
  modified: [src/alphaDrop.ts, src/utils/pairDiscovery.ts, src/utils/txManager.ts, src/utils/notifier.ts, src/utils/retry.ts, src/telegramListener.ts]

key-decisions:
  - "Consolidated getToken0FromPair/getToken1FromPair into single getTokenFromPair(pairAddress, index) function"
  - "Telegram message text logged at debug level only (not info) to prevent sensitive alpha leakage"
  - "Matched addresses logged at debug level for same security reason"
  - "Error message strings stripped of emoji for clean machine-parseable output"

patterns-established:
  - "Child logger per module: const log = logger.child({ module: 'name' })"
  - "Structured context in first arg: log.warn({ err, token }, 'message')"
  - "Sensitive data at debug level: log.debug({ messageLength }, 'Incoming message')"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03]

# Metrics
duration: 9min
completed: 2026-03-22
---

# Phase 3 Plan 3: Supporting Files Migration Summary

**Six supporting files migrated from console.log/warn/error to pino structured logging, with provider and ABI consolidation in alphaDrop.ts and pairDiscovery.ts**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-22T19:35:45Z
- **Completed:** 2026-03-22T19:45:18Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Replaced all console.log/warn/error calls in 6 supporting files with pino structured logging (16 console calls total)
- Replaced 2 inline JsonRpcProvider instantiations in alphaDrop.ts with getProvider() singleton
- Replaced 3 inline ABI arrays (2 pair ABIs in alphaDrop.ts, 1 factory ABI in pairDiscovery.ts) with centralized imports
- Consolidated duplicate getToken0FromPair/getToken1FromPair into single getTokenFromPair function
- Stripped all emoji from log messages, Error strings, and code comments across all 6 files
- Applied debug-level logging for sensitive data (message text, matched addresses in telegramListener.ts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate alphaDrop.ts and pairDiscovery.ts (provider + ABI + logging)** - `8085d42` (feat)
2. **Task 2: Migrate txManager.ts, notifier.ts, retry.ts, and telegramListener.ts (logging only)** - `27241f0` (feat)

## Files Created/Modified
- `src/alphaDrop.ts` - Alpha drop handler with getProvider(), PAIR_ABI, and pino logging
- `src/utils/pairDiscovery.ts` - Pair discovery with getProvider(), FACTORY_ABI, and pino logging
- `src/utils/txManager.ts` - Transaction manager with pino logging, emoji-free error messages
- `src/utils/notifier.ts` - Notifier with pino logging for alert failure diagnostics
- `src/utils/retry.ts` - Retry utility with pino structured logging
- `src/telegramListener.ts` - Telegram listener with 8 console calls replaced by pino, sensitive data at debug level

## Decisions Made
- Consolidated getToken0FromPair and getToken1FromPair into single getTokenFromPair(pairAddress, 0|1) to eliminate code duplication
- Telegram message text logged at debug level only (not info) to prevent sensitive alpha signal leakage in production logs
- Matched contract addresses also at debug level for same security reason
- Error message strings cleaned of emoji for machine-parseable output (grep-friendly, JSON-safe)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored notifier.ts and retry.ts from main working directory**
- **Found during:** Task 2 (reading files for migration)
- **Issue:** Both files were empty (0 bytes) in the worktree -- content existed only in the main repo working tree, not committed to any branch
- **Fix:** Copied original content from main repo working directory, then applied logging migration
- **Files modified:** src/utils/notifier.ts, src/utils/retry.ts
- **Verification:** Files contain full original logic plus pino logging, type-check passes
- **Committed in:** 27241f0 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** File restoration was necessary to have content to migrate. No scope creep.

## Issues Encountered
- Pre-existing type errors in scripts/ directory and src/bot.ts (CONFIG property types, missing Hardhat artifacts) are unrelated to this plan and were not addressed. Zero new type errors introduced by this plan's changes.

## User Setup Required

None - no external service configuration required. All changes are internal refactoring.

## Next Phase Readiness
- All six supporting files now use pino structured logging
- Combined with Plan 01 (foundation) and Plan 02 (core files), the codebase should have zero console.log calls remaining in src/
- Plan 04 can proceed with final verification sweep and any remaining cleanup
- No blockers identified

## Self-Check: PASSED

All 6 files verified present. Both task commits (8085d42, 27241f0) verified in git log.

---
*Phase: 03-sqlite-storage-code-quality*
*Completed: 2026-03-22*
