---
phase: 22-safety-rails-audit
plan: 09
subsystem: database
tags: [safe-05, safe-02, better-sqlite3, db-guards, schema-version, db-init, red-proofs, nac-06]

requires:
  - phase: 22-safety-rails-audit (22-08)
    provides: scripts/verify-prod-untouched.ts wrapper, spawnRailedChild (already carrying the input option), rail ledger
  - phase: 22-safety-rails-audit (22-05)
    provides: setup-layer DB tripwire and data fs block (the layer the src tripwire is proven independent of)
provides:
  - src/utils/repoRoot.ts findRepoRoot (repo-root anchor)
  - src/utils/dbPath.ts resolveDbPath, canonicalDbPath, assertNotProdDbUnderVitest, probeExistingDb, assertDbOpenable, openGuardedDb
  - src/utils/dbSchema.ts CURRENT_SCHEMA_VERSION and migrateSchema(db) (D-24 verbatim move)
  - src/utils/db.ts getDbFilePath() and the guarded open
  - scripts/db-init.ts plus npm run db:init (atomic, explicit creation, D-08)
  - test/unit/rails/dbTripwireSrc.test.ts, test/integration/dbGuards.test.ts, test/integration/fixtures/dbGuardChild.ts, test/integration/dbInit.test.ts
  - red-proofs/22-09-1..4
affects: [22-10, 22-11, 22-15, 22-29, phase-26, phase-27]

actuals:
  tokens: 18855
  tasks: 3
  commits: 4
plan_head_before: e4802dfc2a3ede4dbdd70730376c4bb01abec388
plan_head_after: 3e5c947f1fc876f06f47a2be71758c3035422230

tech-stack:
  added: []
  patterns:
    - "No-touch WAL probe: a WAL-mode database is probed through a private copy in the OS temp folder, because even a read-only open creates or rewrites -shm/-wal beside the real file (measured, see Issues)"
    - "Checks held at the write boundary: probe, refuse, then fileMustExist open, dev+ino identity, user_version re-read on the write handle, all before any pragma"
    - "Race hooks are a function parameter only fixtures pass; no env var or flag can reach them"
    - "A fixture proving a refusal asserts the harm first (file created or hash changed) and the message second, so RED shows the harm"

key-files:
  created:
    - src/utils/repoRoot.ts
    - src/utils/dbPath.ts
    - src/utils/dbSchema.ts
    - scripts/db-init.ts
    - test/unit/rails/dbTripwireSrc.test.ts
    - test/integration/dbGuards.test.ts
    - test/integration/fixtures/dbGuardChild.ts
    - test/integration/dbInit.test.ts
    - .planning/phases/22-safety-rails-audit/red-proofs/22-09-1-db-tripwire-src.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-09-2-version-probe.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-09-3-refuse-to-create.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-09-4-write-boundary.txt
  modified:
    - src/utils/db.ts
    - package.json

key-decisions:
  - "22-09: the DB version probe never touches the real file; a WAL-mode DB is probed through a private temp copy because a plain read-only better-sqlite3 open creates -shm and a 0-byte -wal beside a cleanly closed WAL DB and rewrites an existing -shm (measured). A live writer can tear the copy, so with -wal and -shm both present the probe falls back to the direct read-only open; otherwise it fails closed"
  - "22-09: refuse-to-create holds in two independent layers (assertDbOpenable and fileMustExist), so RED 22-09-3 must remove both; the precursor run with only the refusal removed stays GREEN"
  - "22-09: db:init refuses stale -wal/-shm/-journal files on every create or replace, wider than the plan's missing or 0-byte wording, because a -wal beside a replaced schema-empty file would be replayed into the new one"
  - "22-09: fs.statSync bigint ino is non-zero on this machine (dev reads 0 on win32), so identity is dev+ino with no fallback to size/mtime/birthtime"

patterns-established:
  - "Probe before write, re-check at the write boundary, fail closed naming the absolute path"

requirements-completed: [SAFE-05, SAFE-02]

coverage:
  - id: D1
    description: "Repo-root anchoring of DB_PATH and a src-layer Vitest tripwire on the live data folder that fires before the setup layer (AC-25, AC-14 src layer)"
    requirement: SAFE-02
    verification:
      - kind: unit
        ref: "test/unit/rails/dbTripwireSrc.test.ts (7 tests, wrapped, verdict untouched)"
        status: pass
      - kind: integration
        ref: "test/integration/dbGuards.test.ts#AC-25 repo-root anchoring from another directory"
        status: pass
    human_judgment: false
  - id: D2
    description: "Newer-schema refusal with bytes unchanged, refuse-to-create outside Vitest, write-boundary checks against delete/swap races, and a probe that leaves no trace on WAL fixtures (AC-24, AC-26)"
    requirement: SAFE-05
    verification:
      - kind: integration
        ref: "test/integration/dbGuards.test.ts (18 tests, wrapped, verdict untouched, manifest equal)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A healthy WAL-mode database still boots and npm run preflight reaches its report (no refusal on the production path)"
    requirement: SAFE-05
    verification:
      - kind: integration
        ref: "test/integration/dbGuards.test.ts#healthy WAL-mode database (the production case)"
        status: pass
    human_judgment: false
  - id: D4
    description: "migrateSchema moved verbatim into dbSchema.ts (D-24)"
    requirement: SAFE-05
    verification:
      - kind: other
        ref: "Task 2 second verify on committed blobs: 'D-24 verbatim move ok: 204 body lines byte-identical'"
        status: pass
    human_judgment: true
    rationale: "D-24 is an operator-accepted NAC-06 judgment call; 22-29 re-reviews the diff, as the decision requires"
  - id: D5
    description: "npm run db:init: atomic creation, refusals and typed confirmation (D-08)"
    requirement: SAFE-05
    verification:
      - kind: integration
        ref: "test/integration/dbInit.test.ts cases (a)-(g), (f2) (7 tests, wrapped)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Each src DB rail shown RED once with a byte-exact restore and GREEN rerun (AC-18)"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-09-1..4 (diff, command, failing excerpt, verdict untouched, restore sha256, GREEN)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 09: Src-layer DB Rail and SAFE-05 DB Guards Summary

**`DB_PATH` is now anchored to the repo root, and under Vitest `db.ts` refuses the live data folder on its own. The schema version is read without touching the file before any write. A newer schema is refused in every mode, and outside Vitest a missing or empty database is refused, with the checks held at the real write boundary. The operator has one explicit, atomic creation command, `npm run db:init`. The live `data/` matched the backup MANIFEST on every run.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-11-09T01:43:54Z
- **Completed:** 2026-11-09T02:06Z
- **Tasks:** 3/3
- **Files:** 12 created, 2 modified

## Accomplishments

- **Path anchoring.** `findRepoRoot` walks up from the module's own file to the `package.json` named `crypto-snipe-bot`. A relative `DB_PATH` resolves against that root from any working directory; a child started in `os.tmpdir()` printed `<repo>/data/bot.db` (AC-25).
- **Src tripwire.** Under Vitest, `db.ts` throws `RAIL_DB_TRIPWIRE_SRC` before any open for every spelling of a path inside `<repo>/data/` (relative, absolute, upper-cased, `-wal`). An unset or empty `DB_PATH` gets a per-worker temp file.
- **Guarded open.** `openGuardedDb` probes, refuses, then opens with `fileMustExist`, requires the same dev+ino, and re-reads `user_version` on the write handle before any pragma. A v8 fixture is refused with its hash unchanged (AC-24); missing, 0-byte, version-0 and version-0-with-objects fixtures are refused naming the absolute path (AC-26); all four delete/swap races are refused and nothing is created.
- **No-touch probe.** A test fixture confirms no new files and no changed bytes for a WAL file (no companions, `-wal`+`-shm`, `-wal` only), a rollback-journal file and a missing file. A healthy WAL database boots through `src/utils/db`, and `npm run preflight` reaches its report with no DB refusal.
- **D-24 verbatim move.** `migrateSchema` moved to `dbSchema.ts`, generated mechanically from the audit-base blob. Verify output: **`D-24 verbatim move ok: 204 body lines byte-identical`** (checked on committed blobs, `gone` and `call` both true).
- **`npm run db:init`** builds `<target>.init-<pid>.tmp`, verifies `user_version`, then renames. It refuses non-empty databases, a version-0 file holding any schema object, stale sidecars, leftover temp files, and a wrong typed path.
- **RED proofs (AC-18, src DB layer):**

| # | Rail neutralised | Run | RED result | GREEN |
|---|------------------|-----|------------|-------|
| 1 | src tripwire call | dbTripwireSrc.test.ts | 4 failed: setup layer refused with `RAIL_DB_TRIPWIRE` (3 cases) or `RAIL_DATA_TRIPWIRE` (the `-wal` case) | 7/7 |
| 2 | version refusals and re-read | dbGuards -t "v8" | v8 fixture opened, hash changed | 2/2 |
| 3 | missing/empty refusals and fileMustExist | dbGuards -t "missing" | missing fixture path was created | 2/2 |
| 4 | fileMustExist and identity check | dbGuards -t "race" | deleted path recreated, swapped v7 file opened (the v8 and v0 swaps stay refused by the re-read) | 9/9 |

Every RED run's wrapper verdict was `untouched` with the manifest equal, and each file was restored byte-exact with the sha256 equal.

## Task Commits

1. **Task 1: anchor DB_PATH, src tripwire (tracer).** `791e811` (feat). The tracer gate ran the automated verify end-to-end after the commit: unit rails 7 files / 79 tests, verdict untouched.
2. **Task 2: guards, probe, write boundary, D-24 move.** `1d1991d` (feat)
3. **Task 3: db:init and tests.** `fe4649e` (feat); **RED proofs and evidence-order test edit.** `3e5c947` (docs)

**Plan metadata:** the docs commit that follows this SUMMARY.

## Files Created/Modified

- `src/utils/repoRoot.ts`: walk-up repo-root resolver.
- `src/utils/dbPath.ts`: path resolution, tripwire, no-touch probe, refusals, `openGuardedDb`.
- `src/utils/dbSchema.ts`: schema and migrations, moved verbatim (D-24).
- `src/utils/db.ts`: uses the above, keeps its folder creation Vitest-only, adds `getDbFilePath`.
- `scripts/db-init.ts`, `package.json` (`db:init`): the only creation path.
- `test/unit/rails/dbTripwireSrc.test.ts`, `test/integration/dbGuards.test.ts`, `test/integration/fixtures/dbGuardChild.ts`, `test/integration/dbInit.test.ts`.
- `red-proofs/22-09-1..4-*.txt`.

## Decisions Made

See `key-decisions`. `db:init` uses the planned `renameSync` after re-checking the target state immediately before the rename; two concurrent `db:init` runs can only replace a just-created empty database.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, capital safety] The plan's read-only open would have touched the live file's companions**
- **Found during:** Task 2 design (measured on temp fixtures before writing code).
- **Issue:** `new Database(p, {readonly: true, fileMustExist: true})` on a cleanly closed WAL database created `<p>-shm` (32768 bytes) and a 0-byte `<p>-wal`, and it rewrote `-shm` when both companions existed. That violates "the probe must never create a file". The main file and `-wal` bytes were unchanged.
- **Fix:** rollback-journal files still use the direct read-only open (measured: it creates nothing); WAL-mode files are probed through a private temp copy of the main file and `-wal`. If a copy taken while a live writer checkpoints is torn, and `-wal` and `-shm` both exist, it falls back to the direct open (nothing new is created and a live writer rewrites `-shm` anyway); otherwise it fails closed. The write-handle re-read remains the backstop.
- **Files modified:** `src/utils/dbPath.ts`
- **Verification:** `dbGuards.test.ts` "the probe itself leaves no trace" (5 cases: snapshots before/after equal), plus the healthy WAL boot and preflight runs.
- **Committed in:** `1d1991d`

**2. [Rule 2 - Missing critical] db:init refuses stale companions on every create or replace**
- **Found during:** Task 3.
- **Issue:** the plan names stale sidecars only for a missing or 0-byte target. A `-wal` beside a schema-empty version-0 file would be replayed into the replacement.
- **Fix:** sidecars are refused for any create or replace. New test case (f2).
- **Committed in:** `fe4649e`

**3. [Rule 3 - Blocking] RED 22-09-3 needed both layers removed**
- **Found during:** RED execution.
- **Issue:** removing only the missing/empty refusals leaves `fileMustExist`, which refuses the same path. The plan's single-edit RED would not fail.
- **Fix:** the proof first records a precursor run with only the refusals removed (GREEN), then the RED run with `fileMustExist` removed as well (the missing path is created).
- **Committed in:** `3e5c947`

**4. [Rule 1 - Bug] First RED 4 attempt was invalid; the proof was rerun**
- **Found during:** RED review.
- **Issue:** the first mutation's `if (false && (...probe?.identity...))` failed ts-node's type check in the child, so all four children crashed with no output: a RED for the wrong reason.
- **Fix:** the identity `throw` line is removed instead. The rerun shows the deleted path recreated and the swapped file opened; only the valid proof is committed.
- **Committed in:** `3e5c947`

**5. [Plan wording] Task 2 "add the `input` option" to spawnRailedChild was already done**
- `test/rails/spawnRailedChild.ts` already carries `input` from 22-08; the file is not changed by this plan.

**6. [Plan wording] Test fixture details**
- `test/unit/rails/dbTripwireSrc.test.ts` leaves its fake root in the OS temp folder (protected for the worker's life, same as `dbTripwireSetup.test.ts`).
- `dbGuards.test.ts` asserts the harm (file created or hash changed) before the child's message, so a RED shows the harm, and adds the WAL no-trace and healthy-preflight cases the orchestrator asked to be proven.

---

**Total deviations:** 4 auto-fixed (2 bugs, 1 missing-critical, 1 blocking) and 2 plan-wording notes.
**Impact on plan:** deviation 1 is the substance: the plan's literal probe would have created files next to the DB. No schema, trading, transaction or signing behaviour changed.

## Issues Encountered

- **Live `data/` protection:** every Vitest run was wrapped; every verdict was `untouched` with the manifest equal. Ledger inspection showed the only `data-access-blocked` entry is the deliberate fake-root read in `railsIntegration.test.ts`, and the only `net-allow` targets are loopback (preflight dialing `127.0.0.1:1`). `nonLoopbackAllowed` 0, `telegramAllowed` 0.
- **Live DB not opened.** `src/bot.ts` was not booted and `npm run db:init` was not run; `data/bot.db`'s `-wal` and `-shm` were not touched (MANIFEST equal on every run).
- **`moduleScopeDb.cjs` now trips the src layer first** in its child (`VITEST=true`). Its check in `dbTripwireSetup.test.ts` still passes because `RAIL_DB_TRIPWIRE_SRC` contains `RAIL_DB_TRIPWIRE`. The child still proves the setup layer on a fake root before the import.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: temp-file | src/utils/dbPath.ts | The WAL probe copies the database main file and `-wal` to a private `os.tmpdir()` folder (`csb-db-probe-*`), deleted in a `finally`. Contents are trade and position rows (no secrets); a crash mid-probe can leave a copy in temp. 22-29 may confirm that is acceptable. |

## Audit Notes for 22-29

- **AUD-DB-007 and AUD-DB-006 (RC-25) mitigations are in place** (repo-root anchoring and refuse-to-create; newer-schema refusal and the no-touch probe). Their statuses are left for 22-28/22-29 to update, as the plan says.
- `.env.example` still ships a relative `DB_PATH=./data/bot.db`; the AUD-DB-007 recommendation to change it is now cosmetic because anchoring removes the cwd dependence.
- `grep -c "process.cwd()" src/utils/db.ts` is 1: the `.bot-state.json` path in `migrateJsonState` (AUD-DB-019), unchanged by this plan.
- Under Vitest each `db.ts` import with an empty `DB_PATH` leaves a small per-worker temp file in `os.tmpdir()/crypto-snipe-bot-test-db/`; 22-15 may want to sweep it.

## User Setup Required

None. The first-time command for a fresh database is `npm run db:init`.

## Next Phase Readiness

- 22-10 and later plans can rely on `src/utils/db.ts` refusing a missing or empty database outside Vitest; any flow that created the file implicitly now needs `npm run db:init` first.
- Ready for 22-10.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*

## Self-Check: PASSED

- FOUND: all 15 created/modified code, test and proof files
- FOUND: 791e811, 1d1991d, fe4649e, 3e5c947 (ancestors of HEAD); `git rev-list --count e4802df..HEAD` = 4
- Re-run after the last commit: unit rails 7 files / 79 tests; integration dbGuards + rails + dbInit 3 files / 32 tests; both wrapped, verdict untouched, manifest equal, ledger ok; `tsc` clean; D-24 check passed; `git status --porcelain src test scripts` empty
