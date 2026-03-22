---
phase: 03-sqlite-storage-code-quality
plan: 04
subsystem: database, infra
tags: [sqlite, pnl-query, json-migration, storage-deletion, console-removal]

# Dependency graph
requires:
  - phase: 03-sqlite-storage-code-quality
    plan: 01
    provides: "db.ts SQLite singleton with trades schema and prepared statements"
  - phase: 03-sqlite-storage-code-quality
    plan: 02
    provides: "bot.ts and exitManager.ts migrated away from storage.ts to db.ts"
  - phase: 03-sqlite-storage-code-quality
    plan: 03
    provides: "All supporting files migrated to pino logging, provider singleton, centralized ABIs"
provides:
  - "P&L query function (getPnL) computing realized gains via SQL JOIN on trades table"
  - "PnLResult interface with optional token/chain/date filters"
  - "Auto-migration from .bot-state.json to SQLite with .bak rename"
  - "storage.ts deleted -- SQLite is sole source of truth"
  - "Zero console.log/warn/error calls in all src/ production code"
affects: [04-multi-chain, web-dashboard, testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "P&L computed on query via SQL JOIN (not stored) per D-05"
    - "IS NULL OR column = ? pattern for optional SQL filters"
    - "CAST(COALESCE(...) AS REAL) for TEXT amount arithmetic"
    - "db.transaction() for atomic multi-row migration"
    - "Idempotent migration with count check and file existence guard"

key-files:
  created: []
  modified:
    - "src/utils/db.ts"
    - "src/config.ts"
  deleted:
    - "src/utils/storage.ts"

key-decisions:
  - "P&L query uses LEFT JOIN to include unsold positions (sell_revenue/sell_time null)"
  - "Migration converts .bot-state.json ms timestamps to seconds (SQLite schema uses unixepoch)"
  - "Migration is idempotent: skips if DB already has rows or JSON file missing"
  - "Replaced config.ts console.error with logger.fatal to achieve zero console calls in src/"

patterns-established:
  - "P&L reporting: import { getPnL } from './utils/db' with optional filters"
  - "Startup migration: runs at module load, before prepared statements"

requirements-completed: [DB-01, DB-02, DB-03, DB-04]

# Metrics
duration: 6min
completed: 2026-03-22
---

# Phase 3 Plan 4: P&L Query, JSON Migration, and storage.ts Deletion Summary

**P&L query via SQL JOIN on trades table, .bot-state.json auto-migration to SQLite with .bak rename, and storage.ts deletion completing the SQLite transition**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-22T19:52:21Z
- **Completed:** 2026-03-22T19:58:50Z
- **Tasks:** 2
- **Files modified:** 3 (1 modified, 1 modified, 1 deleted)

## Accomplishments
- Added getPnL() function with SQL LEFT JOIN computing realized P&L from raw buy/sell trade data, supporting optional filters by token, chain, and date range
- Added migrateJsonState() that imports .bot-state.json entries into SQLite trades table at startup, converts ms timestamps to seconds, and renames file to .bak
- Deleted src/utils/storage.ts confirming SQLite as sole source of truth (DB-02)
- Replaced 4 console.error calls in config.ts startup validation with logger.fatal, achieving zero console calls across all src/ production code (INFRA-01)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add P&L query and .bot-state.json migration to db.ts** - `7dc8afb` (feat)
2. **Task 2: Delete storage.ts and replace config.ts console.error with pino** - `d6223a3` (feat)

## Files Created/Modified
- `src/utils/db.ts` - Added getPnL() with SQL JOIN, PnLResult interface, migrateJsonState() with atomic transaction
- `src/config.ts` - Replaced console.error startup validation with logger.fatal structured logging
- `src/utils/storage.ts` - Deleted (SQLite is sole source of truth)

## Decisions Made
- P&L query uses LEFT JOIN so unsold positions appear with null sell_revenue/sell_time (open position visibility)
- Migration converts .bot-state.json millisecond timestamps to seconds to match SQLite schema unixepoch() convention
- Migration is idempotent via two guards: fs.existsSync check and row count > 0 skip
- Replaced config.ts console.error with logger.fatal (logger.ts has no circular dependency on config.ts since it reads LOG_LEVEL from process.env directly)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Replaced config.ts console.error calls with pino logger.fatal**
- **Found during:** Task 2 (INFRA-01 verification grep)
- **Issue:** 4 console.error calls remained in src/config.ts startup validation, failing INFRA-01 zero-console requirement
- **Fix:** Imported logger from utils/logger.ts (no circular dependency) and replaced console.error with logger.fatal structured logging
- **Files modified:** src/config.ts
- **Verification:** grep -r "console." src/ --include="*.ts" | grep -v scripts/ returns zero matches
- **Committed in:** d6223a3 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential to satisfy INFRA-01 phase success criterion. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors (CONFIG type missing factoryAddress/routerAddress/wethAddress, blocklist.ts not a module, missing better-sqlite3/pino type declarations) remain across the codebase. These are NOT introduced by this plan and exist in the worktree from prior parallel agent execution. Zero new errors from this plan's changes.

## User Setup Required

None - no external service configuration required. Migration is fully automatic on startup.

## Next Phase Readiness
- Phase 3 complete: all 4 plans executed, all INFRA and DB requirements satisfied
- SQLite with P&L queryability ready for web dashboard (Phase future)
- Structured logging ready for multi-chain observability (Phase 04)
- No blockers identified

## Self-Check: PASSED

---
*Phase: 03-sqlite-storage-code-quality*
*Completed: 2026-03-22*
