---
phase: 20-going-live-ops-hardening
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, schema-migration, pause-state, anti-rug, prepared-statements]

# Dependency graph
requires:
  - phase: 20-going-live-ops-hardening
    provides: "Plan 20-00 Wave-0 vitest test stubs (pauseStateMigration.test.ts with 6 it.skip blocks across the 10 schema-v6 behaviors + 2 production integrations)"
provides:
  - "Schema migration v5→v6 in src/utils/db.ts — pause_state table (single-row, audit-columned) + antirug_dry_run_started column on chain_state"
  - "5 new prepared statements exported from src/utils/db.ts: getPauseState, setPauseState, clearPauseState, setAntirugDryRunStarted, getAntirugDryRunStarted"
  - "REQUIREMENTS.md OPS-LIVE-02 reworded per D-BALANCE-FLOOR (operational floor formula vs maxCapital ceiling)"
  - "REQUIREMENTS.md OPS-LIVE-06 reworded per D-STALE-THRESHOLDS (2-min/10-min operationally-meaningful thresholds vs 10s/20s poll-cycle noise)"
  - "Production data/bot.db migrated in-place to user_version=6 on module load"
affects: [20-02-preflight-module, 20-03-anti-rug-timestamp-wiring, 20-04-bot-wiring-killswitch, 20-05-dashboard-pause-controls, 20-06-dashboard-pause-banner, 20-07-runbook-move]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies; better-sqlite3 v12.8.0 already installed
  patterns:
    - "Schema migration v5→v6: db.transaction() wraps DDL for atomicity (RESEARCH §1 A1)"
    - "ALTER column-existence guard via PRAGMA table_info — defense-in-depth pattern from v3→v4 migration"
    - "INSERT OR IGNORE for single-row seed (id=1) prevents double-insert on migration re-run"
    - "COALESCE-on-conflict idempotent UPSERT pattern for first-write-wins anti-rug timestamp"

key-files:
  created: []
  modified:
    - "src/utils/db.ts (+85 lines: schema bump, v6 migration block, 5 prepared statements, 5 exports)"
    - "test/unit/db/pauseStateMigration.test.ts (it.skip stubs flipped to 12 live it() blocks — 10 in-memory + 2 production integration)"
    - "test/unit/db/lpBaselineMigration.test.ts (line 207: toBe(5) → toBeGreaterThanOrEqual(5) — Rule 1 deviation)"
    - ".planning/REQUIREMENTS.md (OPS-LIVE-02 line 66 + OPS-LIVE-06 line 70 reworded)"

key-decisions:
  - "Schema v6 migration is a single atomic transaction wrapping both DDL operations (pause_state CREATE + chain_state ALTER) per D-PAUSE-STORAGE additive-only rule"
  - "setAntirugDryRunStarted uses COALESCE-on-conflict so the FIRST call per chain wins (first dry-run start ts is preserved across subsequent restarts) — anchors D-ANTIRUG-LIVE-GATE-CODE 7-day floor"
  - "OPS-LIVE-02 floor formula refined from maxCapital to operational floor — bot funded at 0.0124 ETH < 1.0 ETH maxCapital would have FATAL-exited at startup despite being capable of running one snipe"
  - "OPS-LIVE-06 threshold refined from 10s/20s to 2-min/10-min — original wording would have flooded operator with normal-poll-cycle noise"

patterns-established:
  - "Schema migration framework continues additive-only invariant: every migration v1→v5→v6 has ADDED tables/columns; never modified or dropped (Phase 18+19 carry-forward)"
  - "Pause-state model: single-row table (id=1 CHECK) with audit columns (paused_at, paused_by, reason) — pattern reused for any future single-flag global state"
  - "REQUIREMENTS.md row reword for decision-driven refinement: when CONTEXT.md decision contradicts REQUIREMENTS-as-written, the planner reword updates the row text in-place (no new requirement row needed)"

requirements-completed: [OPS-LIVE-02, OPS-LIVE-06, OPS-LIVE-09]

# Metrics
duration: ~25min
completed: 2026-05-24
---

# Phase 20 Plan 01: Schema v5→v6 Migration + REQUIREMENTS.md Reword Summary

**Schema migration v5→v6 with atomic db.transaction() DDL (pause_state single-row table + antirug_dry_run_started column on chain_state) + 5 new prepared statements exported; REQUIREMENTS.md OPS-LIVE-02 + OPS-LIVE-06 reworded per D-BALANCE-FLOOR and D-STALE-THRESHOLDS**

## Performance

- **Duration:** ~25 min (Task 1: ~20min by prior agent; Task 2: ~5min this continuation)
- **Started:** 2026-05-24T20:00:00Z (Task 1 RED)
- **Completed:** 2026-05-24T20:11:05Z (Task 2 commit)
- **Tasks:** 2/2
- **Files modified:** 4 (src/utils/db.ts, pauseStateMigration.test.ts, lpBaselineMigration.test.ts, REQUIREMENTS.md)

## Accomplishments

- Schema v5→v6 migration shipped in `src/utils/db.ts` — single atomic `db.transaction()` block creates `pause_state` table (id INTEGER PK CHECK(id=1), paused INTEGER DEFAULT 0, paused_at/paused_by/reason nullable) and adds `antirug_dry_run_started INTEGER` column to existing `chain_state` table
- 5 new prepared statements exported (`getPauseState` / `setPauseState` / `clearPauseState` / `setAntirugDryRunStarted` / `getAntirugDryRunStarted`) — downstream consumers for Plans 20-02 (preflight + mid-run wallet undercut), 20-04 (controls.ts endpoints), 20-05 (anti-rug detector first-time-start path)
- Production `data/bot.db` migrated in-place from user_version=5 to user_version=6 on first module load post-merge — confirmed via `node -e "...pragma('user_version')..."` returning `[{user_version: 6}]`
- REQUIREMENTS.md OPS-LIVE-02 row reflects D-BALANCE-FLOOR operational floor formula (`snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER`); REQUIREMENTS.md OPS-LIVE-06 row reflects D-STALE-THRESHOLDS 2-min warn / 10-min error envs (`STALE_WARN_SEC` / `STALE_ERROR_SEC`)
- Full unit suite 499 passed + 31 skipped (+12 new passes for pauseStateMigration; -6 stubs flipped from skip→active) with zero regressions across 47 test files; tsc clean across all 3 tsconfig projects (tsconfig.json + tsconfig.bot.json + dashboard/tsconfig.json)
- A1 ASSUMPTION VERIFIED: `db.transaction()` accepts DDL (CREATE TABLE + ALTER TABLE) on better-sqlite3 v12.8.0 — fall-back (ALTER column-existence guard via PRAGMA table_info) ships as defense-in-depth per the plan's threat-model T-20-W1-04 mitigation

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: flip pauseStateMigration stubs to live failing tests** — `131b54b` (test)
2. **Task 1 GREEN: schema migration v5→v6 + 5 prepared statements + 5 exports** — `103e953` (feat)
3. **Task 2: reword REQUIREMENTS.md OPS-LIVE-02 + OPS-LIVE-06** — `67db735` (docs)

**Plan metadata:** _(this SUMMARY + STATE + ROADMAP commit lands after this file is written)_

_Note: Task 1 followed TDD cycle (RED → GREEN); Task 2 is a non-TDD doc reword._

## Files Created/Modified

- `src/utils/db.ts` (+85 lines net) — `CURRENT_SCHEMA_VERSION` 5→6 (line 27); `if (version < 6) { ... }` block wraps `CREATE TABLE pause_state` + `INSERT OR IGNORE` seed-row + `PRAGMA table_info('chain_state')` ALTER guard + `ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER` in single `db.transaction()(...)`; 5 prepared statements declared + appended to export block at lines 504-522
- `test/unit/db/pauseStateMigration.test.ts` — Plan 20-00 it.skip stubs flipped to 12 live `it()` blocks: 10 in-memory schema/statement tests covering all 10 behaviors from the plan + 2 production integration tests (file-backed DB at `data/bot.db` confirms post-migration user_version=6 + 5 exports symbol-presence). Pattern matches Phase 19 `lpBaselineMigration.test.ts` (tmp-DB-path via `os.tmpdir() + uuid` in beforeEach + `fs.unlinkSync` in afterEach)
- `test/unit/db/lpBaselineMigration.test.ts` (line 207) — **Auto-fix deviation (see below)**: `expect(version).toBe(5)` → `expect(version).toBeGreaterThanOrEqual(5)` so the Phase 19 test does not silently fail every time the schema migrates forward
- `.planning/REQUIREMENTS.md` (2 lines changed: 66 + 70) — OPS-LIVE-02 + OPS-LIVE-06 reworded per RESEARCH §Refinement Targets verbatim text

## Decisions Made

Carried forward from CONTEXT.md (no novel plan-time decisions; all deviations from REQUIREMENTS-as-written were pre-resolved):

- **D-PAUSE-STORAGE** (CONTEXT.md): single-row pause_state shape with audit columns
- **D-ANTIRUG-LIVE-GATE-CODE** (CONTEXT.md): `antirug_dry_run_started` column on `chain_state` (not a new table) + COALESCE-on-conflict idempotent write so first-call-per-chain wins
- **D-BALANCE-FLOOR** (CONTEXT.md): OPS-LIVE-02 row rewording refines REQUIREMENTS-as-written
- **D-STALE-THRESHOLDS** (CONTEXT.md): OPS-LIVE-06 row rewording refines REQUIREMENTS-as-written
- **A1 verification (RESEARCH §1)**: `db.transaction()` accepts DDL on better-sqlite3 v12.8.0 — confirmed at run-time; ALTER guard stays as defense-in-depth per T-20-W1-04

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed implicit Phase 19 schema-floor assertion that was coupled to v5 being permanent**
- **Found during:** Task 1 GREEN (after schema v6 migration shipped, `lpBaselineMigration.test.ts` line 207 started failing: `expected 6 to be 5`)
- **Issue:** Phase 19 Plan 19-01's test was asserting the literal value `5` for `user_version` AFTER `runFullMigration()` — this silently coupled the Phase 19 test to v5 being the permanent latest schema. Every future schema bump would break this test cosmetically without indicating any real problem.
- **Fix:** Changed `expect(version).toBe(5)` → `expect(version).toBeGreaterThanOrEqual(5)`. The intent of Phase 19's test is "v5 schema is the FLOOR" (i.e., lp_baseline + chain_state are present); the GREATER assertion preserves that intent while staying forward-compatible with v6, v7, v8...
- **Files modified:** `test/unit/db/lpBaselineMigration.test.ts` (line 207)
- **Verification:** Full unit suite 499 passed including the Phase 19 test (`lpBaselineMigration > schema v4→v5 migration > applies v5 schema_version after migrate`); zero regressions
- **Committed in:** `103e953` (folded into Task 1 GREEN commit per Rule 1 inline-fix protocol)

---

**Total deviations:** 1 auto-fixed (1 bug fix-in-flight)
**Impact on plan:** Auto-fix was a pre-existing test invariant bug that would have surfaced on every future schema migration. Folded into Task 1 GREEN per Rule 1 inline-fix protocol (CLAUDE.md merge-commit safety alert: the change is additive — `.toBe(5)` → `.toBeGreaterThanOrEqual(5)` preserves the original `expected behaviour`, no destruction). No scope creep.

## Issues Encountered

None — Task 1 and Task 2 each executed exactly as written in the plan's `<action>` block. The agent split: Task 1 by prior executor (commits `131b54b` RED + `103e953` GREEN) before stopping; Task 2 + ship-checks + SUMMARY by continuation agent in this session.

## User Setup Required

None — no new env vars introduced in this plan (Plan 20-02 owns `<CHAIN>_GAS_BUFFER` / `MID_RUN_CHECK_INTERVAL_SEC` / `STALE_WARN_SEC` / `STALE_ERROR_SEC` registration per D-ENV-EXAMPLE). The 5 new prepared statements are consumed in-process by future plans (no operator-visible API change).

## Hand-off to Downstream Plans

The 5 new prepared statements are import-ready via `import { getPauseState, setPauseState, clearPauseState, setAntirugDryRunStarted, getAntirugDryRunStarted } from './utils/db'` (relative paths vary per consumer):

- **Plan 20-02 (preflight module):** `getAntirugDryRunStarted(chain)` consumed by D-ANTIRUG-LIVE-GATE-CODE 7-day floor check; `getPauseState()` + `setPauseState()` consumed by mid-run wallet undercut handler
- **Plan 20-03 (anti-rug detector wiring):** `setAntirugDryRunStarted(chain, now, now)` called at `startChainAntiRugListener` first-time-start path (COALESCE-on-conflict makes the call idempotent across restarts)
- **Plan 20-04 (bot.ts wiring + kill-switch):** `getPauseState()` consumed by 3 killswitch checkpoints (CP1 post-safety-bank, CP2 post-bundle-build, CP3 post-MEV-submit audit-only)
- **Plan 20-05 (controls.ts pause/resume endpoints):** `setPauseState()` + `clearPauseState()` consumed by `POST /api/pause` and `POST /api/resume` routes
- **Plan 20-07 (runbook docs):** OPS-LIVE-02 + OPS-LIVE-06 refined row text consumed by `docs/operations/going-live.md` preflight failure-modes section

## A1 Verification (RESEARCH §1 question)

**Q:** Does `db.transaction()` accept DDL (CREATE TABLE + ALTER TABLE) on better-sqlite3 v12.8.0?

**A:** **YES.** The migration `db.transaction(() => { db.exec('CREATE TABLE...'); db.exec('ALTER TABLE...'); })()` block ran cleanly on the production `data/bot.db` file (and on all 12 in-memory test runs) — no error, atomic commit, both objects materialized. The ALTER column-existence guard (PRAGMA table_info → `columns.some(c => c.name === 'antirug_dry_run_started')`) stays in the v6 migration block as defense-in-depth per the plan's threat-model T-20-W1-04 mitigation, so if A1 ever regresses in a future better-sqlite3 release, the migration still won't error on re-run.

## Self-Check: PASSED

- [x] `src/utils/db.ts` exists and contains `CURRENT_SCHEMA_VERSION = 6` at line 27 — VERIFIED
- [x] Production `data/bot.db` user_version = 6 — VERIFIED (`[{user_version: 6}]`)
- [x] Commit `131b54b` exists in git log — VERIFIED
- [x] Commit `103e953` exists in git log — VERIFIED
- [x] Commit `67db735` exists in git log — VERIFIED (Task 2 REQUIREMENTS.md commit)
- [x] Full unit suite passes: 499 passed / 31 skipped / 0 failed — VERIFIED
- [x] `pauseStateMigration.test.ts` specifically: 12/12 passed — VERIFIED
- [x] tsc clean across tsconfig.json + tsconfig.bot.json + dashboard/tsconfig.json — VERIFIED
- [x] All 6 Task 2 acceptance criteria pass (grep checks for `snipeAmount × maxOpenPositions`, `paused_by='preflight'`, `STALE_WARN_SEC.*STALE_ERROR_SEC`, `operationally-meaningful thresholds`, no `OPS-LIVE-02.*maxCapital`, no `OPS-LIVE-06.*2× the current poll interval`) — VERIFIED
- [x] Only lines 66 + 70 changed in REQUIREMENTS.md (`git diff --stat`: 2 insertions + 2 deletions; non-OPS-LIVE-02/06 grep returns empty) — VERIFIED

## Next Plan Readiness

- Plan 20-02 (preflight module) is unblocked: schema v6 + 5 prepared statements are import-ready; OPS-LIVE-02 + OPS-LIVE-06 refined text is the verbatim acceptance criterion for plan 20-02 wallet-balance check + plan 20-06 stale-data warnings.
- Plan 20-03 (anti-rug `setAntirugDryRunStarted` wiring) is unblocked: prepared statement is exported and tested.
- Wave-1 of Phase 20 is COMPLETE; Wave-2 plans (20-02 + 20-03 + 20-04) can run in parallel.

---
*Phase: 20-going-live-ops-hardening*
*Plan: 20-01*
*Completed: 2026-05-24*
