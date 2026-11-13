---
phase: 23-test-safety-net-harness-triage-characterization
plan: 14
subsystem: testing
tags: [audit-register, triage, closes-finding, red-proof, vitest, better-sqlite3, rails]

requires:
  - phase: 22-safety-rails-audit
    provides: "the SAFE-02/04/05 rails and their RED proofs (red-proofs/INDEX.md rows 1-30) that fixed AUD-TX-004, -005, AUD-RAIL-001, -002, AUD-TESTU-001 and AUD-TESTI-011"
  - phase: 23-test-safety-net-harness-triage-characterization
    provides: "23-03: createTestDb built by the real migrateSchema, the AC-07 test, golden migration tests AC-04..06 and RED proof 23-03-ac07-red.txt; 23-04: set-triage.ts, check.ts --stage triage and the frozen 61-entry population"
provides:
  - "Seven register entries closed as fixed through set-triage.ts, each with an exact rail_test title path, a closes-finding marker beside the rail test and a recorded RED proof: AUD-TX-004, AUD-TX-005, AUD-RAIL-001, AUD-RAIL-002, AUD-TESTU-001, AUD-TESTI-011, AUD-TESTI-001"
  - "test/integration/pauseFlow.test.ts Tests 1-4 now run the real src/utils/db pause statements on a temp file the real module opens and migrates (the hand-built v6 schema copy is deleted)"
  - "createMockExitStateRow has the version 7 exit_state shape, pinned by a new helpers.smoke test to a table built by the real migrations"
  - "RED proofs 23-14-1 .. 23-14-8 (eight files, 23-14-4b included)"
  - "Every one of the 61 triage-population entries now has a triage outcome (52 confirmed, 8 fixed, 1 unreproduced); the 50 remaining --stage triage FAILs are all 23-16 work"
affects: [23-16, phase-25, phase-26, phase-28]

actuals:
  tokens: 23666
  tasks: 2
  commits: 6
plan_head_before: 09479ec469a4696bc8699a06366cd6870fc4fe3e
plan_head_after: d45807a3892f9e1c6ed5af5a5e713d04f49af8f3

tech-stack:
  added: []
  patterns:
    - "Load the real module inside a file that mocks it: process.env.DB_PATH = temp file, vi.resetModules(), vi.importActual('../../src/utils/db'); a second load on the same file is a real restart (new module instance, new connection)"
    - "RED proof with a control: apply the finding's escaped regression to src in the working tree, show the new test fails and the old test file (git show <rev>:path) stays green, restore byte for byte"
    - "Pin a fixture to the schema: Object.keys(fixture) equals PRAGMA table_info of a table built by the real migrations, and the row round-trips"

key-files:
  created:
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-1-singleton-guard.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-2-lock-refusal.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-3-vitest-config-dotenv.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-4-sentinel-env-unit.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-4b-sentinel-env-integration.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-5-db-tripwire-src.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-6-spawn-gate.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-7-pauseflow-real-statements.txt
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-14-8-exit-state-fixture-shape.txt
  modified:
    - test/integration/pauseFlow.test.ts
    - test/fixtures/exitEngine.fixtures.ts
    - test/unit/helpers.smoke.test.ts
    - test/unit/guards/singleton.test.ts
    - test/integration/processLock.test.ts
    - test/unit/rails/forkShellOnly.test.ts
    - test/unit/rails/vitestEnvFile.test.ts
    - test/unit/rails/dbTripwireSrc.test.ts
    - test/unit/rails/envSentinel.test.ts
    - test/unit/rails/notifierRefusal.test.ts
    - test/unit/rails/spawnSites.test.ts
    - test/unit/rails/childRails.test.ts
    - test/integration/rails/railsIntegration.test.ts
    - .planning/audit/findings/AUD-TX-004.json
    - .planning/audit/findings/AUD-TX-005.json
    - .planning/audit/findings/AUD-RAIL-001.json
    - .planning/audit/findings/AUD-RAIL-002.json
    - .planning/audit/findings/AUD-TESTU-001.json
    - .planning/audit/findings/AUD-TESTI-011.json
    - .planning/audit/findings/AUD-TESTI-001.json
    - .planning/audit/ledger/TESTI.json
    - .planning/audit/ledger/TESTU.json
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "Operator ruling on the 23-14 checkpoint (AUD-TESTI-001 sub-claims 3 and 4 still open after 23-03), verbatim: \"Fix now (Recommended)\". The \"(Recommended)\" label was the orchestrator's. Fixed in this plan, test files only."
  - "AUD-TESTI-001 rail_test is the AC-07 test (helpers smoke test > createTestDb returns a working in-memory DB); the pauseFlow and fixture halves are cited in the proof with their own markers and RED proofs 23-14-7 and 23-14-8"
  - "AUD-RAIL-001's rail test is forkShellOnly (d), not vitestEnvFile.test.ts as the plan named: vitestEnvFile does not catch the 2026-11-06 cause (a dotenv call in vitest.config.ts); the note says a recurrence fails the test, not that one is impossible (the Vitest main process has no rails)"
  - "RED proofs re-run on 2026-11-11 where the named test file or rail file changed after its Phase 22 proof (rows 1, 10, 18, 22, 25), plus new proofs 23-14-3 and 23-14-4b where no INDEX row existed"
  - "AUD-TESTU-019 (the unit-test migration replicas) stays its own open entry for Phase 28 and was not touched"

patterns-established:
  - "closes-finding marker beside every rail test that covers a reach of the entry (several markers per entry where it lists several reaches); check.ts needs one, 23-16 matches rail_test against the run report"
  - "Edited existing test files get a reviewed re_audit ledger row ending at the edit's commit, even base-audited ones where only --stage final would ask for it"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-TX-004 closed fixed: the duplicate-load guard refuses a require.cache reload of nonceAuthority (RED row 22, re-run as 23-14-1)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/unit/guards/singleton.test.ts#duplicate-load guard: 'nonceAuthority' > plain Node: delete require.cache and reload is refused"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-TX-005 closed fixed: a second acquire for the same wallet is refused while a real holder process lives (RED row 25, re-run as 23-14-2)"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/integration/processLock.test.ts#SAFE-04 single-instance process lock (real holder processes) > a second acquire for the same wallet is refused while the holder lives (AC-23a)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-RAIL-001 closed fixed (status confirmed -> fixed): the event's own cause, a dotenv call in vitest.config.ts, fails forkShellOnly (d) (new RED proof 23-14-3)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/unit/rails/forkShellOnly.test.ts#fork project reads only the shell and itself (AC-17) > (d) the Vitest main-process closure of both configs loads no .env"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-RAIL-002 closed fixed (candidate -> fixed): live-DB open at import refused by the src and setup tripwires, real .env reach refused by the sentinel env (RED rows 10 and 1, re-run as 23-14-5 and 23-14-4)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/unit/rails/dbTripwireSrc.test.ts#src tripwire on the live data folder (fires before the setup layer) > DB_PATH=./data/bot.db"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-TESTU-001 closed fixed (candidate -> fixed): every listed unit file's reach (live DB, real .env, Telegram) is refused by a RED-proven rail"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/unit/rails/envSentinel.test.ts#sentinel env (D-02, AC-13) > every .env.example key in process.env equals its test/.env.test value"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUD-TESTI-011 closed fixed (candidate -> fixed) for unit and integration; its fork-replay and Hardhat-child half keeps needs_fork with fork_ref UFV-04 (Phase 25)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/unit/rails/spawnSites.test.ts#spawn-site gate (SAFE-02 D-03) > no script under test/ loads a spawner or spawns, outside the allowed files"
        status: pass
    human_judgment: false
  - id: D7
    description: "AUD-TESTI-001 closed fixed (confirmed -> fixed): helper built by the real migrations (23-03), pauseFlow Tests 1-4 on the real pause statements and real migrations, v7 exit_state fixture pinned to the migrated table (operator ruling Fix now)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/unit/helpers.smoke.test.ts#helpers smoke test > createTestDb returns a working in-memory DB"
        status: pass
      - kind: integration
        ref: "test/integration/pauseFlow.test.ts#pause state restart survival (OPS-LIVE-09 / D-PAUSED-RESTART) > Test 1..Test 4"
        status: pass
      - kind: unit
        ref: "test/unit/helpers.smoke.test.ts#helpers smoke test > createMockExitStateRow has exactly the columns of the exit_state table the real migrations build"
        status: pass
    human_judgment: false
  - id: D8
    description: "Full railed suite on Node 22 green and the 61-entry population fully recorded; check.ts partial and consolidation PASS"
    requirement: AUDIT-02
    verification:
      - kind: other
        ref: "npm test (unit + integration + realpath, Node 22.16.0): 1395 passed, 0 failed, 0 skipped, 0 todo; rail ledger nonLoopbackAllowed 0, telegramAllowed 0"
        status: pass
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial (fail 0) and --stage consolidation (fail 0)"
        status: pass
    human_judgment: false

duration: 71min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 14: Close the Rail-Fixed and Helper-Schema Entries Summary

**Seven register entries closed as fixed, each with an exact rail-test title, a `closes-finding` marker beside that test and a recorded RED proof. For AUD-TESTI-001 that took real test work after the checkpoint: pauseFlow's hand-built version 6 schema copy is gone, its Tests 1-4 now run the bot's real pause statements on a database built by the real migrations, and the exit_state fixture has the version 7 shape, pinned to the real table.**

## Performance

- **Duration:** about 71 min wall-clock, including the operator wait at the checkpoint. The first executor ran from about 01:28Z to 01:53Z; this continuation ran from 02:18Z to 02:39Z.
- **Started:** 2026-11-12T01:28Z (UTC; local evening of 2026-11-11)
- **Completed:** 2026-11-12T02:39Z
- **Tasks:** 2 of 2 (Task 2 finished by this continuation)
- **Files modified:** 33 (9 RED proofs created, 24 modified)

## Accomplishments

- **First executor (Task 1 and most of Task 2):** closed AUD-TX-004, AUD-TX-005, AUD-RAIL-001, AUD-RAIL-002, AUD-TESTU-001 and AUD-TESTI-011 as fixed by their Phase 22 rails. Each has a marker beside every rail test that covers one of its reaches, a `set-triage.ts` record with the exact title path, and a RED proof. Proofs were re-run where the file had changed since Phase 22, and new proofs were written where no INDEX row existed. It also added reviewed `re_audit` rows for the ten marked files.
- **This continuation (AUD-TESTI-001, the 7th entry):**
  - pauseFlow Tests 1-4 load the real `src/utils/db` on a temp file. The real module opens the file and migrates it with the real `migrateSchema`, and the tests run its exported `setPauseState`, `getPauseState` and `clearPauseState`. Test 2 restarts the real module on the same file.
  - `createMockExitStateRow` has the version 7 columns.
  - A new smoke test pins the fixture to the migrated table.
  - The entry is closed through `set-triage.ts` with RED proofs 23-14-7 and 23-14-8.
- **Population check:** all 61 frozen entries have an outcome. None is left unrecorded.

## Task Commits

1. **Task 1 (markers for AUD-TX-004, AUD-TX-005, AUD-RAIL-001)** - `3ee5205` (test, first executor)
2. **Task 1 (close those three as fixed, RED proofs 23-14-1..3, ledger rows)** - `3772275` (test, first executor)
3. **Task 2 (markers for AUD-RAIL-002, AUD-TESTU-001, AUD-TESTI-011)** - `53548e8` (test, first executor)
4. **Task 2 (close those three as fixed, RED proofs 23-14-4, 4b, 5, 6, ledger rows)** - `c2e11c0` (test, first executor)
5. **Task 2, after the checkpoint (pauseFlow on the real pause statements, v7 fixture, AUD-TESTI-001 markers, rails-test-edits entries 22-27)** - `0ca1e01` (test, this continuation)
6. **Task 2, after the checkpoint (close AUD-TESTI-001: finding, ledger rows, render, RED proofs 23-14-7 and 23-14-8)** - `d45807a` (test, this continuation)

**Plan metadata:** the docs commit that adds this file. STATE and ROADMAP follow in a separate docs commit.

## Checkpoint and Operator Ruling

The first executor stopped at a blocking-human decision checkpoint on AUD-TESTI-001 (S2, OVERSPEND). The plan assumed this phase's CHAR-05 helper swap (23-03) fixed the whole entry. It fixed only sub-claims 1 and 2: `createTestDb` is now built by the real migrations, with the AC-07 test and RED proof `23-03-ac07-red.txt`. The orchestrator verified on HEAD `c2e11c0` that two sub-claims were still open:

- **Sub-claim 3:** `test/integration/pauseFlow.test.ts` built its own schema by hand. It ran `CREATE TABLE` for trades, exit_state, lp_baseline, chain_state and pause_state, then set `user_version = 6`. Its four pause tests asserted on that copy's SQL, not on the bot's real pause statements. This was unchanged since 5760359 (phase 21.2).
- **Sub-claim 4:** `createMockExitStateRow` in `test/fixtures/exitEngine.fixtures.ts` still had the pre-v7 exit_state row shape.

**Operator ruling (verbatim, 2026-11-12):** "Fix now (Recommended)". The "(Recommended)" label was the orchestrator's.

What the chosen option meant: fix both leftovers in this plan, in test files only, with no `src/` or `scripts/` change, then close the entry. How it was carried out:

- **pauseFlow Tests 1-4:**
  - This file mocks `src/utils/db` for Tests 5-9. So each of Tests 1-4 sets `DB_PATH` to its own temp file, calls `vi.resetModules()`, and loads the real module with `vi.importActual`.
  - The real module runs `openGuardedDb`, its pragmas and the real `migrateSchema` on that file, and the test runs the exported statements.
  - Titles are unchanged and every original assertion is kept. Added checks: each UPDATE changes exactly one row, `user_version` is `CURRENT_SCHEMA_VERSION`, and the restart is a new module instance on a new connection to the same file.
  - The 165-line hand-built schema copy and the `better-sqlite3` import are deleted.
  - Test 4 (the single-row CHECK) now runs on the table the real migrations created. The migrated `pause_state` shape itself (`CHECK(id = 1)`, the default unpaused row) is pinned against `fixtures/schema-v7.json` by `test/realpath/migrations/migrations.golden.test.ts` AC-04 (from version 0), AC-05 (from the frozen version 4 fixture) and AC-06 (a re-run with a paused row), all from 23-03.
- **Fixture:**
  - `exit_failure_count: 0` and `exit_status: null` were added in table order. The column list was taken from `schema-v7.json` (INTEGER NOT NULL DEFAULT 0, and TEXT nullable).
  - A new test, `helpers smoke test > createMockExitStateRow has exactly the columns of the exit_state table the real migrations build`, compares the fixture's keys with `PRAGMA table_info('exit_state')` on a `createTestDb` database, then inserts the row and reads it back.
  - `test/unit/exitEngine.test.ts` passes 33/33 with the old and the new shape. `deserializeExitState` reads only the 8 older columns, and no test reads the fixture's key set, so no test relied on a missing column. The flip side is that no exitEngine test could have noticed the drift; the new smoke test now does.
- **Real pause code:** the bot's real pause code passed every rewritten test on the first run. No bug was found, so no knownBug proof was needed.
- **Closure:**
  - `set-triage.ts --outcome fixed`, with rail_test `helpers smoke test > createTestDb returns a working in-memory DB` (the AC-07 test).
  - Markers sit beside the AC-07 test, the pauseFlow describe and the fixture test.
  - Reviewed `re_audit` rows were added for `pauseFlow.test.ts` (TESTI, 23a6461..0ca1e01), `exitEngine.fixtures.ts` (TESTI, 23a6461..0ca1e01) and `helpers.smoke.test.ts` (TESTU: 23a6461..b6c4de4 for the 23-03 AC-07 edit, then b6c4de4..0ca1e01). These are base-audited files, so only `--stage final` would have asked for the rows. The rows also take `helpers.smoke.test.ts` off 23-03's final-stage list.
  - The register was re-rendered.
- **Sibling entry:** AUD-TESTU-019 (the unit-test copies of the migrations in `test/unit/db/*Migration.test.ts`) stays its own open entry for Phase 28. It was not touched.

## RED Proofs

| Proof | Entry | What it shows |
|---|---|---|
| 23-14-1-singleton-guard.txt | AUD-TX-004 | With `registerSingleton` returning at once, the same 16 of 29 tests fail as in 22-12-1, the rail test among them. Re-run because the test file changed (f695363). |
| 23-14-2-lock-refusal.txt | AUD-TX-005 | With SQLITE_BUSY swallowed, the contender exits 0 instead of 1. Re-run because processLock.ts changed (5378478, a comment only). |
| 23-14-3-vitest-config-dotenv.txt | AUD-RAIL-001 | A dotenv call in vitest.config.ts (the event's own cause) fails only forkShellOnly (d). New, because no INDEX row existed. |
| 23-14-4-sentinel-env-unit.txt | AUD-TESTU-001, AUD-RAIL-002 | With the sentinel values not loaded, both sentinel tests fail. Re-run because the test file changed (069a30c). |
| 23-14-4b-sentinel-env-integration.txt | AUD-TESTI-011 | The row 1 neutralisation in the integration worker. New, because no INDEX row named railsIntegration. |
| 23-14-5-db-tripwire-src.txt | AUD-RAIL-002, AUD-TESTU-001 | With the src tripwire removed, the four live-data-folder tests fail and the setup layer still refuses each open. Re-run because the test changed. |
| 23-14-6-spawn-gate.txt | AUD-TESTI-011 | A spawnSync in pauseCli.test.ts is named by the gate. Re-run because the test changed (f695363). |
| 23-14-7-pauseflow-real-statements.txt | AUD-TESTI-001 (sub-claim 3) | 7a: the entry's escaped regression (deleting the version 6 pause-row INSERT OR IGNORE in src/utils/dbSchema.ts) fails rewritten Tests 1-4 with "expected +0 to be 1". 7b: setPauseState aimed at `id = 2` fails Tests 1-3. In both, the old hand-built file (`git show c2e11c0:test/integration/pauseFlow.test.ts`) stays 9/9 green. src was restored byte for byte, with blob hashes equal to HEAD. |
| 23-14-8-exit-state-fixture-shape.txt | AUD-TESTI-001 (sub-claim 4) | 8a: restoring the pre-v7 fixture shape fails only the new smoke test, missing exit_failure_count and exit_status. 8b: a migration that adds an exit_state column fails it too. exitEngine.test.ts passes 33/33 under both. Files restored byte for byte. |

Every mutation was made in the working tree only, and none was committed. `git status --porcelain -- src scripts test` was empty after each restore.

**A precise limit, as the operator asked:** if someone put a hand-built copy back into `pauseFlow.test.ts`, no test would catch it, because a test cannot guard its own text. What would catch it is review: the file's ledger row now ends at `0ca1e01`, so any later edit needs a reviewed `re_audit` row before `check.ts --stage final` passes. Putting back the old fixture shape is caught by a test (proof 8a).

## Files Created/Modified

- `test/integration/pauseFlow.test.ts`: Tests 1-4 run on the real module and the real migrations. The hand-built schema copy is deleted. The logger mock gains the top-level methods that the real db module and `migrateSchema` call. `DB_PATH` is restored after each test instead of deleted.
- `test/fixtures/exitEngine.fixtures.ts`: the version 7 exit_state shape.
- `test/unit/helpers.smoke.test.ts`: the AUD-TESTI-001 marker beside the AC-07 test, and the new fixture-shape test with its own marker.
- Ten rail test files (first executor): one or two comment lines each, the markers only.
- `.planning/audit/findings/*.json` (7): the triage blocks. Status moved: AUD-RAIL-001 and AUD-TESTI-001 confirmed -> fixed; AUD-RAIL-002, AUD-TESTU-001 and AUD-TESTI-011 candidate -> fixed; AUD-TX-004 and AUD-TX-005 were already fixed.
- `.planning/audit/ledger/TESTI.json`, `TESTU.json`: reviewed `re_audit` rows for the 13 edited test and fixture files.
- `.planning/audit/inputs/rails-test-edits.json`: entries 22-27, one per changed test plus the fixture (AC-49 record). Nothing was renamed, so test-identity sees no title change.
- `.planning/audit/AUDIT-FINDINGS.md`: re-rendered.

## Decisions Made

See `key-decisions` above. The two that most affect later plans:

- AUD-TESTI-001's single rail_test is the AC-07 unit test.
- AUD-RAIL-001 points at forkShellOnly (d).

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan premise, ruled by the operator] AUD-TESTI-001 needed real test changes, not a marker**
- **Found during:** Task 2, AUD-TESTI-001 (first executor; checkpoint returned)
- **Issue:** The plan treated AUD-TESTI-001 as fixed by 23-03. Sub-claims 3 and 4 were still open. The plan's acceptance criterion "git log -p -1 shows only added comment lines" therefore could not hold for this entry's files.
- **Fix:** Operator ruling "Fix now (Recommended)". `pauseFlow.test.ts`, `exitEngine.fixtures.ts` and `helpers.smoke.test.ts` carry real test changes, described above. All other marked files carry comment lines only.
- **Files modified:** `test/integration/pauseFlow.test.ts`, `test/fixtures/exitEngine.fixtures.ts`, `test/unit/helpers.smoke.test.ts`, `.planning/audit/inputs/rails-test-edits.json`
- **Verification:** pauseFlow 9/9, helpers.smoke 11/11, exitEngine 33/33; RED proofs 23-14-7 and 23-14-8
- **Committed in:** `0ca1e01`, `d45807a`

**2. [Rule 1 - Wrong rail test in the plan] AUD-RAIL-001 uses forkShellOnly (d), not vitestEnvFile.test.ts (first executor)**
- **Issue:** `vitestEnvFile.test.ts` does not catch the 2026-11-06 cause, which was a dotenv call in `vitest.config.ts`.
- **Fix:** The rail test is `fork project reads only the shell and itself (AC-17) > (d) the Vitest main-process closure of both configs loads no .env`, with new RED proof 23-14-3. `vitestEnvFile.test.ts` keeps a marker for the Vite env-file path of the same event (RED row 30).
- **Wording:** The plan asked the note to say the rail "makes recurrence impossible". The note says instead that a recurrence fails the test. A recurrence is not impossible, because the Vitest main process has no rails.
- **Committed in:** `3ee5205`, `3772275`

**3. [Protocol] Several Phase 22 RED proofs were re-run today (first executor)**
- **Issue:** The named test files or rail files changed after their Phase 22 proofs (INDEX rows 1, 10, 18, 22, 25), so citing the old runs alone would not show that today's test fails.
- **Fix:** Each was re-run on 2026-11-11 and saved as 23-14-1, -2, -4, -5 and -6, with the rail restored byte for byte (`git hash-object` identical to HEAD). Rows 5 and 14 were cited without a re-run: their files are unchanged, and a re-run would attempt a real denied connect or a real Telegram send.
- **Committed in:** `3772275`, `c2e11c0`

**4. [Rule 2 - Stronger check] Assertions added to the rewritten pauseFlow tests**
- **What:** `changes` is 1 on every UPDATE, `user_version` is `CURRENT_SCHEMA_VERSION`, the module bound the temp file, and the restart is a new instance and connection.
- **Why:** Without the `changes` check, a missing pause row reads as a silent no-op until the following SELECT. With it, mutation 7a fails at the write.
- **Committed in:** `0ca1e01`

**5. [Rule 3 - Blocking] The pauseFlow logger mock lacked top-level methods**
- **Issue:** The file's `src/utils/logger` factory had only `child`. The real db module and `migrateSchema` call `logger.info` directly, so loading the real module would throw.
- **Fix:** Added `info`, `warn`, `error`, `debug` and `fatal` as `vi.fn()`. Tests 5-9 are unaffected.
- **Committed in:** `0ca1e01`

**6. [Rule 1 - Latent test bug] pauseFlow deleted `process.env.DB_PATH` after each test**
- **Issue:** The afterEach ran `delete process.env.DB_PATH`, which drops the rails' value set by `test/.env.test` (DB_PATH empty) for the rest of the file.
- **Fix:** The value is saved in beforeEach and restored in afterEach.
- **Committed in:** `0ca1e01`

**7. [Protocol] Extra markers and rails-test-edits entries**
- **Markers:** Three markers for AUD-TESTI-001, where check.ts needs one: beside the rail test, the pauseFlow describe and the fixture test. This follows the first executor's one-marker-per-reach pattern.
- **rails-test-edits.json:** Entries 22-27 were appended, as 23-03 did for its AC-07 edits.
- **Committed in:** `0ca1e01`

---

**Total deviations:** 7 (1 plan premise ruled by the operator, 2 Rule 1, 1 Rule 2, 1 Rule 3, 2 protocol).
**Impact on plan:** All seven entries carry one outcome each, as the success criteria ask. `src/` and `scripts/` are unchanged.

## New Findings and Grade Changes (standing instruction)

None. No severity was changed and no finding was registered by either executor. The real pause statements passed every rewritten test, so there was no bug to register. The status moves listed under Files are the triage outcomes themselves, recorded through `set-triage.ts`.

## Issues Encountered

None open. Everything unexpected was diagnosed:
- **12 log lines in the full run matching `×` or `FAIL`:** all passing tests whose titles contain "FAIL" or a multiplication sign. No failure.
- **65 tests above half the default limit:** each carries an explicit per-test limit and passed. Examples: backupState 45.8 s; processLock 28.4 s and 27.4 s; AUD-EXIT-003 `zero-entry-infinite-ratio` 25.9 s under its explicit 90 s.
- **AUD-EXIT-003 measured times (for the orchestrator's wave 5 check):** the file took 38.7 s wall-clock. Its four tests took 5.3 s, 25.9 s, 5.7 s and 1.9 s. No limit was raised.
- **`check.ts --stage final`:** 98 FAILs. 95 are missing ledger rows for files added since the base, and 3 are `re_audit` rows for other files. None names a file this plan touched. 23-04 records that this bookkeeping is outside Phase 23.
- **Git warnings:** the "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the committed blobs are LF.
- **Two read-only JSON reads ran on the global Node 24:** a missing PATH prefix. They wrote nothing; every later command used Node 22.

## Verification (Node 22.16.0 on PATH)

- **Full railed `npm test`** (unit + integration + realpath, run `run-20261112T022849-16844-b9096e`, 02:28:47Z to 02:31:16Z): 198 files and 1395 tests, all passed; 0 failed, skipped or todo.
  - By project: unit 945 in 103 files, integration 263 in 34, realpath 187 in 61.
  - Rail ledger: nonLoopbackAllowed 0, telegramAllowed 0, 724 entries, 0 unparseable.
- **AC-10, three runs of every test file this plan touched plus exitEngine.test.ts:** unit 137/137 in each run, integration 23/23 in each run, identical outcomes.
- **Plan verify commands:** the Task 1 and Task 2 `<automated>` commands both exit 0 as written.
- **Type check:** `tsc --noEmit` on `tsconfig.json`, `tsconfig.bot.json` and `dashboard/tsconfig.json`: exit 0, 0, 0.
- **Mock gates:**
  - `npm run check:vi-mock`: 591 mock calls in 266 files, 0 violations.
  - `npm run check:realpath-mocks`: 35 vi uses in 92 files, 0 violations.
- **check.ts:**
  - `--stage partial`: PASS, fail 0, pending 50.
  - `--stage consolidation`: PASS, fail 0.
  - `--stage partial --slice` TX, RAIL, TESTI, TESTU: PASS, fail 0 each.
  - `--stage triage`: 50 FAILs, all 23-16 work, listed below.
- **Clean tree:** `git status --porcelain src scripts` is empty.

### `--stage triage` FAILs by kind (all belong to 23-16)

| Kind | Count | Entries |
|---|---|---|
| A confirmed S0/S1 must be in an operator review record's acknowledged list (AC-18) | 44 | the S0/S1 batch |
| needs_fork needs fork_ref to a Phase 25 UFV entry (AC-16) | 4 | AUD-ANTIRUG-003, AUD-BUY-015, AUD-BUY-033, AUD-EXIT-003 |
| Unreproduced needs ruling_ref to a keep-open review record (AC-08) | 1 | AUD-TX-006 |
| Triage run evidence missing | 1 | inputs/triage-evidence.json |

Population: 61 of 61 recorded (52 confirmed, 8 fixed, 1 unreproduced). None of this plan's seven entries appears among the FAILs.

## For 23-16

- **Rail test titles:**
  - `rail_test` joins title levels with ` > `. A Vitest JSON report's `fullName` joins the same parts with a single space.
  - So 23-16 must build the title from `ancestorTitles` plus `title` before matching. For example, `fullName` "SAFE-04 single-instance process lock (real holder processes) simultaneous acquires ..." has no ` > `.
- **Integration rail tests that must appear in the run evidence's `passed_tests`:**
  - AUD-TX-005: `SAFE-04 single-instance process lock (real holder processes) > a second acquire for the same wallet is refused while the holder lives (AC-23a)` in `test/integration/processLock.test.ts`.
  - AUD-DB-007, from 23-11: `test/integration/dbGuards.test.ts`.
  - Every other rail test of this plan is in the unit project. Include the integration project anyway: AUD-TESTI-001's proof relies on the four pauseFlow Tests 1-4 and AUD-TESTI-011's on railsIntegration.
- **AUD-TESTI-011:** keeps `needs_fork` true with `fork_ref` UFV-04 (Phase 25).
- **The four remaining fork_refs:** AUD-ANTIRUG-003, AUD-BUY-015, AUD-BUY-033 and AUD-EXIT-003 still need UFV entries (owner 25) and fork_ref.
- **Population count:** the population is 61, not 59.

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- AC-13 holds: the six Phase 22 rail entries and AUD-TESTI-001 carry one outcome each, found by marker, title and RED proof.
- 23-16 can start from a population with no unrecorded entry.
- AUD-TESTU-019 and pauseFlow's remaining mocked Tests 5-9 (AUD-TESTI-014, -015) stay open for Phase 28.

## Self-Check: PASSED

- **Files present:** all nine RED proofs, `23-14-7-pauseflow-real-statements.txt` and `23-14-8-exit-state-fixture-shape.txt` included, plus the three rewritten test and fixture files.
- **Commits:** `3ee5205`, `3772275`, `53548e8`, `c2e11c0`, `0ca1e01` and `d45807a` are ancestors of HEAD. `git rev-list --count 09479ec..HEAD` = 6 before this docs commit.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
