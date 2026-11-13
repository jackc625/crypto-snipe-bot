---
phase: 23-test-safety-net-harness-triage-characterization
plan: 03
subsystem: testing
tags: [vitest, better-sqlite3, migrations, golden-test, test-helpers]

requires:
  - phase: 23-test-safety-net-harness-triage-characterization
    provides: "23-01: the realpath Vitest project (rails, logger mock, afterEach checks) the golden tests run in"
  - phase: 22-safety-rails-audit
    provides: "src/utils/dbSchema.ts (migrateSchema, CURRENT_SCHEMA_VERSION, moved out of db.ts by 22-09), rails-test-edits.json and test-identity.ts"
provides:
  - "test/realpath/migrations/migrations.golden.test.ts: AC-04 (v0 -> v7), AC-05 (frozen v4 -> v7, rows kept, v7 defaults), AC-06 (re-run changes nothing) over the real migrateSchema"
  - "test/realpath/migrations/fixtures/schema-v7.json: the recorded version 7 schema (table_xinfo, index_list + index_xinfo + index SQL, foreign keys, normalized table SQL, views/triggers)"
  - "test/realpath/migrations/fixtures/v4Schema.ts: applyV4Schema, the old helper body frozen as a historic fixture"
  - "test/helpers/testDb.ts: createTestDb built by migrateSchema; returns CURRENT_SCHEMA_VERSION with every production column"
  - "red-proofs/23-03-ac07-red.txt: RED proof for AUD-TESTI-001 (expected 7, received 4), cited by 23-14"
affects: [23-04, 23-14, 23-16, 23-26, 23-28, phase-24]

actuals:
  tokens: 14224
  tasks: 2
  commits: 2
plan_head_before: 5b2168f724c85fe457560a105ddf7bece9927391
plan_head_after: b6c4de44594fb519f881e8c9dafb0262f651c2b3

tech-stack:
  added: []
  patterns:
    - "Schema golden test: describeSchema(db) over table-valued pragmas, compared with a committed recording generated once from the real migration"
    - "Stored SQL compared after removing whitespace, comments outside string literals and quotes around a plain identifier; string literals compared as is"
    - "One-off generator = an exact copy of the test file plus one writer test, deleted after use, so the recording comes from the same code that checks it"

key-files:
  created:
    - test/realpath/migrations/migrations.golden.test.ts
    - test/realpath/migrations/fixtures/schema-v7.json
    - test/realpath/migrations/fixtures/v4Schema.ts
    - .planning/phases/23-test-safety-net-harness-triage-characterization/red-proofs/23-03-ac07-red.txt
  modified:
    - test/helpers/testDb.ts
    - test/unit/db.test.ts
    - test/unit/helpers.smoke.test.ts
    - .planning/audit/inputs/rails-test-edits.json

key-decisions:
  - "Stored SQL is normalized beyond whitespace: RESEARCH E9 said whitespace was the only difference, but the old helper body carries a -- comment and SQLite's RENAME stores CREATE TABLE \"trades\" in quotes; columns, indexes, defaults, constraints and foreign keys agree exactly"
  - "A fresh v0 migration leaves sqlite_sequence = [{trades, 0}] (the v3 rebuild's INSERT ... SELECT into an AUTOINCREMENT table writes it even with no rows); AC-04 pins it as SQLite behaviour"
  - "rails-test-edits.json: two entries appended at the end (findings cite entries by index): the db.test.ts rename with title_before, and the helpers.smoke expected-value change although its title did not change"
  - "check.ts --stage final grows from 6 to 12 FAILs of the same two kinds (ledger rows for new files, re_audit rows for changed files); 23-04 records that this bookkeeping is outside Phase 23 and --stage triage is the phase gate"

patterns-established:
  - "Golden-test RED proof by restored mutation: change the recording, the fixture or the migration, see the named tests fail, restore byte-for-byte (sha256), never commit"

requirements-completed: [CHAR-05]

coverage:
  - id: D1
    description: "AC-04: the real migrations take an empty version 0 database to version 7 and match the recorded schema"
    requirement: CHAR-05
    verification:
      - kind: integration
        ref: "test/realpath/migrations/migrations.golden.test.ts#AC-04: the real migrations take an empty version 0 database to version 7 and match the recorded schema"
        status: pass
    human_judgment: false
  - id: D2
    description: "AC-05: the frozen version 4 fixture upgrades to version 7, matches the recording, keeps its seeded trades and exit_state rows, and the version 7 columns hold their defaults"
    requirement: CHAR-05
    verification:
      - kind: integration
        ref: "test/realpath/migrations/migrations.golden.test.ts#AC-05: a frozen version 4 database upgrades to version 7, matches the recorded schema, and keeps the rows seeded at version 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "AC-06: a second migration run on a version 7 database (both starting points) leaves schema and rows unchanged, including a paused kill switch and a failed-held exit"
    requirement: CHAR-05
    verification:
      - kind: integration
        ref: "test/realpath/migrations/migrations.golden.test.ts#AC-06 (three tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AC-07: createTestDb is built by migrateSchema, returns CURRENT_SCHEMA_VERSION, and test/helpers/testDb.ts holds no hand-written schema; RED proven first"
    requirement: CHAR-05
    verification:
      - kind: unit
        ref: "test/unit/db.test.ts#Current schema version: user_version pragma returns CURRENT_SCHEMA_VERSION"
        status: pass
      - kind: unit
        ref: "test/unit/helpers.smoke.test.ts#createTestDb returns a working in-memory DB"
        status: pass
      - kind: other
        ref: "! grep -q 'CREATE TABLE' test/helpers/testDb.ts && grep -q migrateSchema test/helpers/testDb.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "AC-49: no test deleted, skipped or weakened; unit 937 -> 937 passing; only the two named assertions changed; test-identity missing 0, renamed 1"
    requirement: CHAR-05
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/test-identity.ts --base 7a91783 --report <unit+integration json> (exit 0)"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 03: Real Migrations in Tests Summary

**Golden tests run the real `migrateSchema` from an empty database and from a frozen version 4 database and match one recorded version 7 schema, rows survive and a re-run changes nothing; `createTestDb` is now built by the same migrations, so helper-based tests can finally express the failed-held and pause columns.**

## Performance

- **Duration:** about 13 min
- **Started:** 2026-11-11T05:26:54Z
- **Completed:** 2026-11-11T05:40Z
- **Tasks:** 2 of 2
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- AC-04: an empty in-memory database goes through the real migrations to `user_version` 7 and matches `fixtures/schema-v7.json`. The only rows are the unpaused kill-switch row and SQLite's own `sqlite_sequence` row.
- AC-05: the frozen version 4 fixture (the old helper body, byte-identical) is checked to be a real version 4 database first: it has no version 5 to 7 tables and no `exit_failure_count`. It is seeded with two `trades` rows and one `exit_state` row, upgraded, and matches the same recording. Every seeded value survives, `exit_failure_count` is 0 and `exit_status` is NULL, the new tables are empty, and `pause_state` has its default row.
- AC-06: a second run on both version 7 databases leaves the schema description and every row of every table unchanged. The version 0 database is first given rows in every table, including a paused kill switch (`paused 1, cli`) and an `exit_failed_held` exit with failure count 2. Neither is reset.
- AC-07: `test/helpers/testDb.ts` keeps its name, signature and three pragmas, in production order, and calls `migrateSchema(db)`. It has no `CREATE` statement and no `user_version` assignment.
- RED first: both test edits failed against the unchanged helper with `expected 4 to be 7`, in exactly the two edited tests (40 others passed). The run is saved for plan 23-14.

## Task Commits

1. **Task 1: golden-test the real migrations from version 0 and version 4 (AC-04 to AC-06)** - `7a91783` (test)
2. **Task 2: build createTestDb with the real migrations (AC-07)** - `b6c4de4` (test)

**Plan metadata:** recorded in the docs commit that adds this file.

## Files Created/Modified

- `test/realpath/migrations/migrations.golden.test.ts` - 9 tests: recording sanity, AC-04, AC-05, three AC-06, three `normalizeSql` self-tests; `describeSchema`, `allRows`, `normalizeSql`
- `test/realpath/migrations/fixtures/schema-v7.json` - recorded version 7 schema, 6 tables (`chain_state`, `exit_state`, `lp_baseline`, `pause_state`, `sqlite_sequence`, `trades`), LF only
- `test/realpath/migrations/fixtures/v4Schema.ts` - `applyV4Schema(db)`, the frozen historic version 4 schema with its do-not-update comment
- `test/helpers/testDb.ts` - built by `migrateSchema`; header comments rewritten
- `test/unit/db.test.ts`, `test/unit/helpers.smoke.test.ts` - the two F5 assertion edits
- `.planning/audit/inputs/rails-test-edits.json` - entries 19 and 20 appended
- `red-proofs/23-03-ac07-red.txt` - the RED run, with the test diff, command and full output

## AC-49: The Two Changed Tests

These are the only assertions this plan changed. No test was deleted, skipped or weakened. Each now asserts the real current version and failed against the old helper first.

| File | Test (after) | Change |
|------|--------------|--------|
| `test/unit/db.test.ts` | `SQLite storage (TEST-02) > pragmas > Current schema version: user_version pragma returns CURRENT_SCHEMA_VERSION` (was `Schema v4: user_version pragma returns 4`) | `toBe(4)` -> `toBe(CURRENT_SCHEMA_VERSION)`; title renamed; rails-test-edits.json entry 19 with `title_before` |
| `test/unit/helpers.smoke.test.ts` | `helpers smoke test > createTestDb returns a working in-memory DB` (title unchanged) | `toBe(4)` -> `toBe(CURRENT_SCHEMA_VERSION)`; comment updated; rails-test-edits.json entry 20 |

Counts: the unit project collected 937 tests before and 937 after, all passing, in 102 files. The only identity difference is that one renamed title. `test-identity.ts --base 7a91783` over a unit plus integration report (1200 tests) gives `missing 0, missing_file 0, renamed 1, not_executed 0, frozen_reset_not_passed 0`, exit 0.

## New Findings and Grade Changes

None. No finding was registered and no severity was changed. AUD-TESTI-001 (RC-28) is the finding this plan's work answers, and 23-14 records its outcome using the RED proof here. Two observations were looked at and are not bugs: SQLite's `sqlite_sequence` row from the version 3 rebuild, and the non-semantic differences in the stored `trades` SQL text.

## Decisions Made

See `key-decisions` above. The main one: stored SQL is compared after removing whitespace, comments outside string literals and quotes around a plain identifier. Everything inside string literals (CHECK lists, defaults) is compared exactly. A quoted identifier that is not a plain name is kept verbatim. Columns, index columns, collations, sort order and foreign keys are compared structurally with no normalization.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in a plan premise, not a stop] Stored SQL differs by more than whitespace**
- **Found during:** Task 1, a scratch probe before the test was written
- **Issue:** RESEARCH E9 and Pitfall 9 say the only difference between the two paths is whitespace. Measured at 5b2168f, the version 4 path's `trades` SQL also has the old helper's `-- Phase 15 / CHAIN-02 ...` comment, and the version 0 path's is `CREATE TABLE "trades"` (SQLite quotes the name when the version 3 rebuild renames `trades_new`). A whitespace-only comparison would have failed AC-05 on text that is not part of the schema.
- **Fix:** `normalizeSql` also removes `--` and `/* */` comments outside string literals and the quotes around a plain identifier. It has three self-tests showing that literals, and quoted names that are not plain, still differ. Every column, index, default, constraint and foreign key agreed exactly. The plan's intent (AC-05 compares against the same recording) is unchanged, so this was not treated as a falsified locked decision.
- **Files modified:** `test/realpath/migrations/migrations.golden.test.ts`
- **Committed in:** `7a91783`

**2. [Rule 1 - Bug in my own expectation] `sqlite_sequence` after a fresh migration**
- **Found during:** Task 1, first run (AC-04 failed)
- **Issue:** I expected no `sqlite_sequence` rows. The real migration leaves `{trades, 0}`, because the version 3 `INSERT INTO trades_new SELECT * FROM trades` into an AUTOINCREMENT table writes the row even when it copies nothing, and the RENAME carries it over.
- **Fix:** AC-04 now pins `[{ name: 'trades', seq: 0 }]` with that explanation. This is real SQLite behaviour, not a bot bug.
- **Committed in:** `7a91783`

**3. [Rule 2 - Stronger capture] More than the plan listed**
- `table_xinfo` instead of `table_info`, a superset that also shows hidden and generated columns. A check that every index belongs to a described table. Views and triggers are captured (none exist).
- An extra test that the recording is at `CURRENT_SCHEMA_VERSION` and holds the five named tables plus the failed-held, pause and dry-run columns.
- AC-06 runs from both starting points, plus a test that a paused kill switch and a failed-held exit survive a re-run.
- **Committed in:** `7a91783`

**4. [Protocol] rails-test-edits.json fields**
- A second entry for the helpers smoke edit, whose title did not change, so both AC-07 assertion edits are on record.
- Extra fields `found_in_plan`, `red_proof` and `related_finding`. No tool reads these (`register_as` and the extras are read by nothing under `.planning/audit/tools` or `scripts/`). `test-identity.ts` reads only `title_before`/`title_after`.
- Entries were appended at the end, because findings cite entries by index (`rails-test-edits.json#N`). Existing bytes are unchanged (the diff is 26 insertions).
- **Committed in:** `b6c4de4`

**5. [Protocol] Root-pin guard order**
- The supplied root-pin guard ran right after my first Write (the scratch probe file in `test/realpath/migrations/`), not before it.
- That Write was inside the pinned root. The guard passed (`PIN OK`, expected branch). The probe was deleted and never committed. The guard then ran before every later Write or Edit batch and before both commits.

---

**Total deviations:** 5 (2 Rule 1, 1 Rule 2, 2 protocol notes).
**Impact on plan:** none on scope. `src/` is unchanged (`git status --porcelain src` empty at both commits).

## RED Proofs (scratch, never committed)

- **AC-07:** see `red-proofs/23-03-ac07-red.txt`. Vitest exited 1, with `expected 4 to be 7` in exactly the two edited tests, taken with the helper at its HEAD blob `e1acaf0`.
- **Golden-test mutations,** each restored byte-for-byte and checked by sha256:
  - (a) Recording: `exit_failure_count` default changed from 0 to 1. 4 tests failed.
  - (b) Fixture: `idx_trades_status` dropped. Exactly AC-05 and the version 4 AC-06 failed.
  - (c) Migration, temporary edit to `src/utils/dbSchema.ts`: `DEFAULT 0` changed to `DEFAULT 1`. AC-04, AC-05 and both AC-06 schema tests failed.
- **Fixture body:** byte-identical to `git show HEAD:test/helpers/testDb.ts` lines 27-66 once the indentation is removed.

## Verification (exact commands, Node 22.16.0 on PATH via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

- `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/migrations`: 9/9, three runs in a row, plus the tracer re-run before Task 2.
- `! grep -q "CREATE TABLE" test/helpers/testDb.ts && grep -q "migrateSchema" test/helpers/testDb.ts && node node_modules/vitest/vitest.mjs run --project unit test/unit/db.test.ts test/unit/helpers.smoke.test.ts`: exit 0, 42/42.
- The four `createTestDb` consumer files (`db`, `helpers.smoke`, `rails/dbTripwireSetup`, `riskManager`): 61/61.
- `node node_modules/vitest/vitest.mjs run --project unit`: 937/937 in 102 files, the same as the baseline before the plan. The rail ledger counts are identical to the baseline run.
- `node node_modules/vitest/vitest.mjs run --project unit --project integration`: 1200/1200 in 136 files.
- `node node_modules/vitest/vitest.mjs run --project realpath`: 20/20 (11 harness, 9 golden).
- `test-identity.ts --base HEAD(7a91783) --report <unit+integration json>`: exit 0, `missing 0`, `renamed 1`.
  - A first run with a unit-only report exited 1. All 255 `not_executed` titles and all 15 `frozen_reset_not_passed` files were integration files absent from that report. That came from how I ran it; the full report is clean.
- `test/unit/rails/spawnSites.test.ts` + `test/unit/viMockGate.test.ts`: 14/14. `scripts/check-vi-mock-paths.ts`: 591 calls in 179 files, 0 violations.
- `git status --porcelain src`: empty.
- `.planning/audit/tools/check.ts`:
  - `--stage partial`: PASS. `--stage consolidation`: PASS.
  - `--stage final`: FAIL with 12 lines, the 6 from 23-01 plus 6 of the same two kinds for this plan's files:
    - TESTI ledger rows missing for the 3 new files
    - `re_audit` entries missing for `test/helpers/testDb.ts`, `test/unit/db.test.ts` and `test/unit/helpers.smoke.test.ts`
  - 23-04-PLAN line 81 records that this per-file bookkeeping is Phase 22 machinery outside this phase, and `--stage triage` is the phase gate.

## Issues Encountered

None open. Every odd output was diagnosed:
- The AC-04 `sqlite_sequence` failure (deviation 2).
- The unit-only test-identity exit 1 (explained above).
- The `--stage final` growth (explained above).
- The pino lines in the RED output. They come from `test/unit/db.test.ts` importing `src/utils/db.ts`, which migrates the rails' throwaway database at import. That was already the case before this plan.
- Git's "LF will be replaced by CRLF" notices. They come from `core.autocrlf=true`; the blobs are LF, and `schema-v7.json` has 0 CR bytes.

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- Any helper-based test can now write `exit_failure_count`, `exit_status`, `pause_state` and `chain_state.antirug_dry_run_started`, which plan 23-14 and the Wave 5 triage tests need.
- Plan 23-14 cites `red-proofs/23-03-ac07-red.txt` for AUD-TESTI-001.
- A future migration (version 8) must regenerate `fixtures/schema-v7.json` (the file name will need to follow) and must not touch `fixtures/v4Schema.ts`.

## Self-Check: PASSED

- Files present: `test/realpath/migrations/migrations.golden.test.ts`, `fixtures/schema-v7.json`, `fixtures/v4Schema.ts`, `red-proofs/23-03-ac07-red.txt`, `test/helpers/testDb.ts`.
- Commits `7a91783` and `b6c4de4` are ancestors of HEAD. `git rev-list --count 5b2168f..HEAD` = 2 before this docs commit.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
