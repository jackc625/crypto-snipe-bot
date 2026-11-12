---
phase: 23-test-safety-net-harness-triage-characterization
plan: 13
subsystem: testing
tags: [vitest, typescript-compiler-api, better-sqlite3, wal, ethers, spawnRailedChild, realpath-harness, triage, knownBug, audit-register, signing-census, process-lock, dotenv, pino]

requires:
  - phase: 23-02
    provides: knownBug marker, the AC-02 mock-list gate
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules, the frozen triage population
  - phase: 23-27
    provides: the Harness Gap Procedure (no gap was raised)
provides:
  - "AC-14: AUD-DB-006's open half proven on the real file: importing src/utils/db.ts on an up-to-date WAL database commits one write (data_version moves, main-plus-WAL hash changes, 1 WAL frame), with a pragmas-only control that commits nothing"
  - "AUD-SCRIPTS-001 and AUD-SCRIPTS-002 proven statically through ts.createProgram over a directory walk of scripts/: the two legacy scripts cannot load, and every signing script runs with no held process lock and no pause read (lock-lifetime classifier with 14 temp-directory cases)"
  - "AUD-BUY-007 proven on the real path: the dead simulateSell signs one public approve of the whole held balance while the wallet's withNonceLock is held"
  - "AUD-DB-005 proven as production behavior: with VITEST unset and LOG_LEVEL=debug loaded from .env, the logger runs at info"
  - "New finding AUD-TESTI-029 (S3): a timed-out realpath test keeps running into the next test"
  - "fixtures/scriptsStatic.ts (the walk, the program, module resolution, census-mirroring signing analysis and lock/pause classifier), fixtures/dbImportWrites.ts, fixtures/logLevelOrder.ts"
affects: [23-16, 23-17, 23-19, phase-24, phase-28, phase-29]

actuals:
  tokens: 28855    # chars/4 over the added lines of 08ffdb4..51502b6 (17 files, 115421 chars)
  tasks: 3
  commits: 6       # MEASURED: git rev-list --count 08ffdb4..HEAD before this SUMMARY commit
plan_head_before: 08ffdb4a5c9799b9b8512053557fea5dd9554e1c
plan_head_after: 51502b679251edaf778314d2abd4561d8fe137ee
commits: 6

tech-stack:
  added: []
  patterns:
    - "A database write is observed where it lands: PRAGMA data_version on a connection the test holds open through the child, plus one SHA-256 over the main file followed by its -wal, plus the wal_checkpoint(PASSIVE) log field read last"
    - "A static proof builds ts.createProgram from a directory walk (no file named as a path the test reads) and asserts properties of imports and calls through the type checker, never source text"
    - "A static classifier is proven both ways on temp-directory programs with stub modules at the real modules' paths and the real ethers types path-mapped in"
    - "A knownBug whose finding's fix deletes the code under test records 'the function is gone' as the correct value, so the recommended deletion reads looks fixed instead of a TypeError"
    - "Rows that belong to another finding's fix (the legacy scripts) are expected only while their files exist, so that fix flips only its own test"

key-files:
  created:
    - test/realpath/triage/AUD-DB-006.test.ts
    - test/realpath/triage/AUD-SCRIPTS-001.test.ts
    - test/realpath/triage/AUD-SCRIPTS-002.test.ts
    - test/realpath/triage/AUD-BUY-007.test.ts
    - test/realpath/triage/AUD-DB-005.test.ts
    - test/realpath/triage/fixtures/dbImportWrites.ts
    - test/realpath/triage/fixtures/logLevelOrder.ts
    - test/realpath/triage/fixtures/scriptsStatic.ts
    - .planning/audit/findings/AUD-TESTI-029.json
  modified:
    - .planning/audit/findings/AUD-DB-006.json
    - .planning/audit/findings/AUD-SCRIPTS-001.json
    - .planning/audit/findings/AUD-SCRIPTS-002.json
    - .planning/audit/findings/AUD-BUY-007.json
    - .planning/audit/findings/AUD-DB-005.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md
    - test/realpath/triage/AUD-EXIT-003.test.ts

key-decisions:
  - "All five entries confirmed: AUD-DB-006 (open half, AC-14), AUD-SCRIPTS-001, AUD-SCRIPTS-002 (S1), AUD-BUY-007 (S1) and AUD-DB-005; every claim reads looks fixed under its own fix-shaped mutation and a cross-file batch shows each mutation flips only its own claim"
  - "AUD-DB-006: the write is the unconditional PRAGMA user_version = 7 at the end of migrateSchema; the normalizeLegacyMainnetRows UPDATE commits nothing on an up-to-date database, and the main file alone does not change until a checkpoint"
  - "AUD-SCRIPTS-002: a tryAcquireThenRelease query alone reads 'the failure changed' (status-query-only), never fixed; only the hold-lock fix with a pause read reads fixed. Card SCRIPTS-01 stays open"
  - "New AUD-TESTI-029 (S3, capital none), graded by the executor under the operator's standing instruction of 2026-11-11, no stop"
  - "No HARNESS GAP: nothing under test/realpath/harness/ was written"

patterns-established:
  - "Scratch runners in the session scratchpad: mutate.cjs with mrun.sh (EOL-aware fix-shaped mutation of src/ or scripts/, test run, byte-exact restore proven by git hash-object, trap on exit), repcmp.cjs (three JSON-reporter runs compared), sumrun.cjs and slow.cjs (full-run totals, failures and every test above half its default limit)"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AC-14: importing src/utils/db.ts (railed child, VITEST unset, temp DB_PATH, throwaway cwd) on an up-to-date WAL database commits one write; the pragmas-only control commits nothing"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-DB-006.test.ts (2 tests; a conditional user_version write reads looks fixed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-SCRIPTS-001: addLiquidity and deploySepoliaTest have relative imports the compiler cannot resolve (compiled artifacts with no source), so neither can load"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/realpath/triage/AUD-SCRIPTS-001.test.ts (1 test; deleting both scripts reads looks fixed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-SCRIPTS-002: every signing script (deliberate-buy, recover-sell-ladys, and the two legacy ones) is lock none with no pause read; the classifier is proven on 14 temp-directory cases"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: "test/realpath/triage/AUD-SCRIPTS-002.test.ts (2 tests; the hold-lock fix reads looks fixed, a query-only fix reads the failure changed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-BUY-007: the real simulateSell signs one public approve of the whole held balance while the wallet's withNonceLock is held"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-007.test.ts (1 test; deleting simulateSell reads looks fixed, a lock-wrapped approve reads the failure changed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-DB-005: with VITEST unset and LOG_LEVEL=debug loaded from .env, the logger runs at info"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-DB-005.test.ts (1 test; loading dotenv at the top of logger.ts reads looks fixed)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AC-48: no test passes on answers a real node could never give (the router's swap eth_call reverts while the approve is still pending; the held token comes from a mined real transfer)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport data"

duration: 39min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 13: Static and Import-Time Findings Summary

**Five findings proven, none of which needs a running trade:**
- **AUD-DB-006 (AC-14):** just loading the database module writes to the database, even for the read-only preflight. The write is one rewrite of the schema version, and it sits in the WAL file, not the main file.
- **AUD-SCRIPTS-001:** the two legacy scripts cannot even load: they import compiled contract files that no longer exist.
- **AUD-SCRIPTS-002 (S1):** the two live operator scripts that sign with the bot wallet (deliberate-buy, recover-sell-ladys), and the two broken ones, sign without holding the wallet process lock and without checking the pause switch.
- **AUD-BUY-007 (S1):** the unused `simulateSell` really signs: it sends a signed approval of the whole token balance, without waiting for the nonce lock.
- **AUD-DB-005:** `LOG_LEVEL` in `.env` does nothing; the bot always logs at info.

One new test-harness bug was found and registered (AUD-TESTI-029, S3).

## Performance

- **Duration:** about 39 min (2026-11-12T00:45:46Z to 2026-11-12T01:24:44Z)
- **Tasks:** 3 of 3.
  - **Task 1 tracer gate:** interactive, end-of-phase mode, automated-only verify. The verify was re-run on the committed tree, passed, and Task 2 started.
- **Files:** 17 changed: 9 created (5 test files, 3 fixtures, 1 finding), 8 modified (5 findings, the sweep contribution, AUDIT-FINDINGS.md, AUD-EXIT-003.test.ts).

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claim | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-DB-006 | S2 | confirmed | AUD-DB-006.test.ts: `import-writes-database` | **Setup:** a real temp database from the real migrations in WAL mode, checkpointed, companions removed; the test holds its own connection. **Child:** railed, VITEST unset (production branch), temp `DB_PATH`, throwaway cwd; it only imports `src/utils/db` and exits without `closeDb`. **Result:** `{ committedWrite: true, databaseBytesChanged: true, walFrames: 1 }`; correct `{ false, false, 0 }`. **Control:** the three pragmas only, no migration: `{ false, false, 0 }`. | The newer-schema half is closed by the 22-09 rail (named in the note) |
| AUD-SCRIPTS-001 | S3 | confirmed | AUD-SCRIPTS-001.test.ts: `legacy-scripts-unresolved-artifact-imports` | **Method:** the directory walk of scripts/ goes to ts.createProgram, and each relative import is resolved with the compiler's module resolution. **Result:** exactly `['addLiquidity', 'deploySepoliaTest']`. Every unresolved import is a compiled artifact, and each script misses the three with no Solidity source (IWETH, UniswapV2Factory, UniswapV2Router02). | Sub-claims 2 to 5 (mainnet URL with the bot key, constructor mismatch, zero minimums, partial addresses.json) stay code-read |
| AUD-SCRIPTS-002 | S1 | confirmed | AUD-SCRIPTS-002.test.ts: `signing-scripts-outside-process-lock` | **Method:** signing points identified as the census does (the 12 script sites match signing-sites-head.json). deliberate-buy signs through `executeDeliberateBuy` in src/bot.ts. The type checker classifies each script's lock lifetime and pause read. **Result:** all four rows `{ lock: 'none', pauseRead: false }`. | Card SCRIPTS-01 decision (Phase 29) |
| AUD-BUY-007 | S1 | confirmed | AUD-BUY-007.test.ts: `simulate-sell-signs-approve-outside-nonce-lock` | **Setup:** the real `simulateSell` on the fake ETH chain. The wallet holds the token from a real, mined transfer. The test holds the wallet's own `withNonceLock`. **Result:** one public `approve(router, 12345e18)` signed while the lock was held, bounded 60 s window. The router's swap eth_call then reverts (`TRANSFER_FROM_FAILED`, the approve still pending), so it logs "Sell simulation failed" and returns false. | Nothing |
| AUD-DB-005 | S3 | confirmed | AUD-DB-005.test.ts: `log-level-from-env-file-not-applied` | **Setup:** a railed child with VITEST unset, run from a throwaway folder whose inert `.env` sets `LOG_LEVEL=debug`. It deletes the sentinel value first, then imports config, then the logger. **Result:** `vitest: false`, `levelFromConfigFile: 'debug'`, but `loggerLevel: 'info'`. `src/main.ts` keeps this order on purpose (lines 39-42), so a real start behaves the same. | Nothing |

None of these entries is unreproduced or NOT-A-BUG, and none needs a fork run.

## Task Commits

1. **Task 1 (tracer): AC-14, AUD-DB-006 open half** - `330e6fc` (test)
2. **Task 2: AUD-SCRIPTS-001 and AUD-SCRIPTS-002 (static)** - `0149bb9` (test)
3. **Task 3: AUD-BUY-007 and AUD-DB-005** - `a593efe` (test)
4. **Mock-gate violation in my fixture (found by the full run)** - `0f750ef` (fix)
5. **AUD-EXIT-003 probe test explicit limit, and AUD-TESTI-029 registered** - `650aa24` (test)
6. **AUD-SCRIPTS-001 parses only the walked scripts (lower full-run load)** - `51502b6` (perf)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

Under the operator's standing instruction (2026-11-11, verbatim): "All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading".

- **New: AUD-TESTI-029 (S3, capital none, confirmed, C12), graded by me.**
  - **The bug:** when a real-path test times out, Vitest runs the harness teardown, but the test's own async body keeps stepping the shared fake clock. It goes on driving its torn-down scenario into the next test of the same file.
  - **Seen in the full run:** AUD-EXIT-003 `probe-is-eth-buy-wei-as-token-amount` timed out at 15032 ms under load (1.3 to 1.8 s alone). The run then reported an unhandled rejection, `provider destroyed; cancelled request (eth_subscribe)` from teardown, which Vitest attributed to the next test.
  - **Reproduced on purpose:** with a scratch 700 ms limit (restored byte for byte), the next test, which passes on its own, failed with `expected [ Infinity, Infinity ] to deeply equal [ Infinity ]`.
  - **Why S3:** the run is already red from the timeout, so the leak cannot hide a failure (not S2). The harm is failures reported against tests that are not at fault.
  - **Fix:** Phase 28, or the Harness Gap Procedure. Related to AUD-TESTI-028.
- **No severity change and no status change** on the five plan entries; all stay `confirmed`.

## Files Created/Modified

**Test files** (`test/realpath/triage/`):
- **AUD-DB-006.test.ts:** 2 tests, 1 claim. Each test starts one railed child: `process.execPath <ts-node bin> --transpile-only fixtures/dbImportWrites.ts <mode>`, `withVitestEnv: false`, `envOverrides { DB_PATH }`, a throwaway cwd and a 120 s limit. It checks the child's own case ledger: rails started, no network, nothing denied.
- **AUD-SCRIPTS-001.test.ts:** 1 test, 1 claim, 60 s limit.
- **AUD-SCRIPTS-002.test.ts:** 2 tests (the proof and the 14 classifier cases), 1 claim, 60 s limit each.
- **AUD-BUY-007.test.ts:** 1 test, 1 claim, 60 s limit. Reuses `incomingHolder`/`stepUntilOrFor` (AUD-API-001 fixture) and `graphWithNonceLock` (AUD-TX-002 fixture).
- **AUD-DB-005.test.ts:** 1 test, 1 claim, 120 s limit.

**Fixtures:**
- **scriptsStatic.ts:**
  - The walk and `buildScriptsProgram`, with options mirroring tsconfig.json.
  - `relativeImportSpecifiers` and `unresolvedRelativeImports`.
  - `SigningAnalysis`: the census's type predicates copied, ABI and runner traces, delegation into another program file, and the lock-lifetime and pause-read classifier. The header states its boundary: contracts passed as parameters are not traced, the getFunction form is not mirrored, and the manual-inventory exclusions are not applied. None of these changes a script's row.
- **dbImportWrites.ts:** the child for AUD-DB-006, modes `import` and `pragmas-only`.
- **logLevelOrder.ts:** the child for AUD-DB-005.

**Register:**
- **Findings:** triage blocks on the five entries, written with set-triage.ts; AUD-TESTI-029 added, with a C12/test entry in sweep/contrib-PHASE23.json.
- **AUDIT-FINDINGS.md:** re-rendered (the new finding).
- **OPERATOR-DECISIONS.md and SEAL.json:** untouched.
- **Ledger:** no row added. None of the edited files has one: AUD-EXIT-003.test.ts has no row, and this plan's own files are new.

**Other edits:**
- **AUD-EXIT-003.test.ts:** an explicit 60 s limit on `probe-is-eth-buy-wei-as-token-amount`, with the measured times in a comment. No assertion changed.

## Decisions Made

See `key-decisions`. Also:
- **AUD-SCRIPTS-002 rows:** the knownBug compares `{ script, lock, pauseRead }` only, as the plan states. The signing points of the two live scripts are asserted after the marker, by enclosing function and call (no line numbers).
- **Why not per-site data in the marker:** the legacy scripts' per-site data depends on whether their broken ABIs resolve, so carrying it would make AUD-SCRIPTS-001's fix flip AUD-SCRIPTS-002's test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Shared helper] `fixtures/scriptsStatic.ts` added (not in files_modified)**
- **Why:** both SCRIPTS tests need the same walk, program and analysis.
- **AC-37 form kept:** each test still builds its program from the directory walk.
- **Committed in:** 0149bb9.

**2. [Rule 2 - Clear D-08 signal] AUD-BUY-007 records a module without simulateSell as signing nothing**
- **Why:** the recommended fix deletes the function, which would otherwise fail as a TypeError, not as "looks fixed".
- **Shown:** by the deletion mutation.
- **Committed in:** a593efe.

**3. [Rule 2 - Cross-finding isolation] AUD-SCRIPTS-002 expects the legacy rows only while those files exist**
- **Why:** deleting them is AUD-SCRIPTS-001's fix, and it must flip only that test.
- **Shown:** by the cross-file batch.
- **Committed in:** 0149bb9.

**4. [Rule 2 - Determinism] The AUD-DB-006 and AUD-DB-005 children run from a throwaway working folder**
- **AUD-DB-006:** db.ts's `migrateJsonState` reads `.bot-state.json` from the cwd, so a repo-root cwd could import rows.
- **AUD-DB-005:** the folder holds the inert `.env`.
- **How the child starts:** through the ts-node bin with `--transpile-only`, because `-r ts-node/register` does not resolve from a temp cwd.
- **Committed in:** 330e6fc, a593efe.

**5. [Rule 1 - Bug in my own fixture] logLevelOrder.ts named a local `vitest`**
- **Found by:** the first full run. check-realpath-mocks treats a free `vitest` identifier as the Vitest global (fail closed): 2 vi-escape violations, so `realpathMockGate` failed.
- **Fix:** renamed to `vitestSet`; the printed JSON key stays `vitest`.
- **Re-check:** the gate reports 0 violations.
- **Committed in:** 0f750ef.

**6. [Rule 3 - Blocking, caused by this plan's load] AUD-EXIT-003 `probe-is-eth-buy-wei-as-token-amount` given an explicit 60 s limit**
- **Failure:** it timed out at the 15 s default under the first full run (1.3 to 1.8 s alone, 2.0 s in the second full run).
- **Diagnosed:** the leak it caused is AUD-TESTI-029 (above).
- **Unchanged:** no assertion changed.
- **Committed in:** 650aa24.

**7. [Rule 2 - Lower added load] AUD-SCRIPTS-001's program uses `noResolve`**
- **Why:** its proof needs module resolution only, so it no longer type-loads src/.
- **Measured:** 9.2 s became 4.4 s under the full run.
- **Fix signal:** re-checked after the change.
- **Committed in:** 51502b6.

---

**Total deviations:** 7 (Rule 1: 1, Rule 2: 4, Rule 3: 2). **Impact:** each makes a proof more faithful or its D-08 signal correct, or keeps the full run green. `src/` and `scripts/` are unchanged, nothing under `test/realpath/harness/` was written, and no HARNESS GAP was raised.

## Issues Encountered (all diagnosed)

**First full run (before 0f750ef):** 1392 of 1394 passed, plus 1 unhandled error.
- **realpathMockGate:** my fixture's `vitest` identifier (deviation 5).
- **AUD-EXIT-003 probe test:** a load timeout (deviation 6).
- **The unhandled `eth_subscribe` cancellation:** the timed-out test's leaked body (AUD-TESTI-029). Both of its pieces were reproduced: two clean runs alone, then the forced-timeout run.

**AUD-SCRIPTS-002 analysis versus the census (measured):**
- **Scripts:** the 12 sites match `signing-sites-head.json` exactly. Here addLiquidity's `factory.getPair` (unresolvable ABI) also counts; it is the census's one auditor exclusion.
- **src:** 14 sites against the census's 11. The extra three are `allowance` view calls on a contract passed as a parameter, which the census traces through the language service and this analysis does not.
- **Effect:** none of this changes any script's row. The src count is only the scan's sanity floor.

**Warning lines this plan's tests produce:**
- **AUD-BUY-007:** exactly one `warn tokenSafety sellSimulation Sell simulation failed` (the router revert), asserted.
- **Everything else:** no warning lines. The DB-006 and DB-005 children print only their marker or result line.

**Mutation tooling:**
- **Line endings:** the working copies mix LF and CRLF, so the runner adapts each `from`/`to` to the file's EOL.
- **Restores:** every mutation was restored with `git -c core.autocrlf=false checkout`, and `git hash-object` was IDENTICAL to the HEAD blob each time.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

**Task verifies:**
- **Task 1:** 2/2; `--slice DB` PASS; triage block present. Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:** 3/3; `--slice SCRIPTS` PASS; both triage blocks present; `git status --porcelain src scripts` empty.
- **Task 3:** 2/2; `--slice BUY` and `--slice DB` PASS; both triage blocks present; `git status --porcelain src` empty.

**Full railed suite (`npm test -- --reporter=json`, on the committed tree 51502b6, run run-20261112T011814-16776-91a231):**
- **Result:** 198 files, 1394 tests: 1394 passed, 0 failed, 0 skipped, 0 todo, 0 unhandled errors.
- **By project:** unit 944, integration 263, realpath 187. That is 1387 at 23-12 plus this plan's 7.
- **Rails ledger:** `nonLoopbackAllowed` 0, `telegramAllowed` 0.

**This plan's tests under the full run, against the limit that applies (all test bodies, no hooks of their own):**

| Test | Full run | Alone | Limit |
|---|---|---|---|
| AUD-DB-006 import | 2.0 s | 0.5 to 0.7 s | 120 s |
| AUD-DB-006 control | 1.4 s | 0.5 to 0.7 s | 120 s |
| AUD-SCRIPTS-001 | 4.4 s | about 2 s | 60 s |
| AUD-SCRIPTS-002 proof | 12.8 s | 4.5 to 5.9 s | 60 s |
| AUD-SCRIPTS-002 classifier | 2.7 s | 1.1 s | 60 s |
| AUD-BUY-007 | 1.2 s | 1.6 to 2.0 s | 60 s |
| AUD-DB-005 | 1.3 s | 0.6 to 0.8 s | 120 s |

All are under half their limit.

**Other near-limit tests checked:** every other test above half its default limit was checked. Each either has an explicit limit or stayed under its default; only the AUD-EXIT-003 probe test crossed (deviation 6). `test/unit/bot/snipeFailClean.test.ts` "a snipe ceiling-hit throws" ran at 2.7 s of its 5 s default (54 percent) in the first run. It is existing and did not time out; noted here for later plans.

**Repeatability (AC-10):** the five files ran three times with the JSON reporter. Each run had 7 tests (all passed) and 5 knownBug records, identical in titles, statuses and every record.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- The scratch tsconfig extending the repo's (the 8 new triage files, module esnext): exit 0.
- `check-realpath-mocks`: 35 vi uses in 92 files, 0 violations.
- `check-vi-mock-paths`: 591 mock calls in 266 files, 0 violations.

**Register:**
- `check.ts --stage partial`: PASS, fail 0, pending 57. `--stage consolidation`: PASS.
- `--stage triage`: 57 FAILs, all expected:
  - 7 population entries other plans own (12 before minus this plan's 5);
  - 44 S0/S1 acknowledgements owed to 23-16 (42 plus AUD-SCRIPTS-002 and AUD-BUY-007);
  - 4 `fork_ref`s (AUD-BUY-015, AUD-BUY-033, AUD-EXIT-003, AUD-ANTIRUG-003);
  - AUD-TX-006's keep-open ruling;
  - the run-evidence file.

**Fix signals (cross-file batch: every mutation against all five files, 7 tests):**

| Mutation | Result |
|---|---|
| none | all 7 pass |
| dbSchema.ts writes user_version only when it differs | `import-writes-database` looks fixed; 6 pass |
| scripts/: delete addLiquidity.ts and deploySepoliaTest.ts | `legacy-scripts-unresolved-artifact-imports` looks fixed; 6 pass (re-checked after 51502b6) |
| scripts/: acquireProcessLock + pause read before signing in all four scripts | `signing-scripts-outside-process-lock` looks fixed; 6 pass |
| scripts/: tryAcquireThenRelease query only (run on the SCRIPTS files) | AUD-SCRIPTS-002 "the failure changed", not fixed |
| tokenSafety.ts simulateSell no longer exported and bot.ts import removed | `simulate-sell-signs-approve-outside-nonce-lock` looks fixed; 6 pass |
| tokenSafety.ts approve wrapped in withNonceLock (run on BUY-007) | "the failure changed", not fixed |
| logger.ts loads dotenv before pino | `log-level-from-env-file-not-applied` looks fixed; 6 pass |

`git status --porcelain src scripts` was empty at every commit and after every mutation.

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## For 23-16

- **Acknowledge** the two S1 entries confirmed here in the S0/S1 batch report: AUD-SCRIPTS-002 and AUD-BUY-007.
- **Plain-language consequences for the operator:**
  - **AUD-SCRIPTS-002:** deliberate-buy and recover-sell-ladys can run beside the bot on the same wallet. A query-only lock check would not fix this.
  - **AUD-BUY-007:** a function named "simulate" really sends an approval.
- **Run evidence:** collect the 5 knownBug records from the five files. No `fixed` outcome here, so this plan adds no integration-run requirement.
- **No `needs_fork`.**

## For 23-17 (census exceptions)

- **AUD-BUY-007:** the one src exception, tokenSafety `simulateSell` `contract.approve`.
- **AUD-SCRIPTS-002:** the 12 script sites. The legacy scripts hold 10 of them (AUD-SCRIPTS-001).
- **Card SCRIPTS-01** stays open.
- **Reuse:** `fixtures/scriptsStatic.ts` mirrors the census's type predicates and could serve as a cross-check of the promoted tool.

## Next Phase Readiness

- **Phase 24/29:** each file runs alone as a before-and-after proof; the fix shapes each claim sees are in each test header, each triage note and the batch table above.
- **Phase 28 (or a harness change through the Harness Gap Procedure):** AUD-TESTI-029. Until it is fixed, any realpath test above half its limit under the full run needs an explicit limit.

## Self-Check: PASSED

- **Files found:** the five triage test files and three fixtures under test/realpath/triage/, and AUD-TESTI-029.json. The five findings carry `confirmed` triage blocks with their own test_id.
- **Commits found on this branch:** 330e6fc, 0149bb9, a593efe, 0f750ef, 650aa24 and 51502b6 (`git rev-list --count 08ffdb4..HEAD` = 6 before this SUMMARY).
- **Re-run after the last commit:** every task's acceptance criteria and the plan-level verification pass: all five files on Node 22; `check.ts --stage partial` PASS for SCRIPTS, BUY and DB.
- **Clean tree:** no scratch file under test/, src/ or scripts/; `git status --porcelain src scripts data` is empty. The operator's own `.planning/config.json` and `.planning/state.json` changes are left modified and unstaged.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
