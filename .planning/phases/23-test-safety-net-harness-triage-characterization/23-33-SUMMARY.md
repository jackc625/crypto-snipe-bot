---
phase: 23-test-safety-net-harness-triage-characterization
plan: 33
subsystem: testing
tags: [golden-master, recordings, audit-06, ci-gate, vitest, rails-run-id, spawnRailedChild]

requires:
  - phase: 23 (plan 23-25)
    provides: the commit taxonomy check and the redirect gap it recorded (deferred-items.md); its gate and self-test shape
  - phase: 23 (plans 23-20, 23-23)
    provides: compareRecording and the recordings (22 scenario .jsonl, 108 env/*.json, the folder's .gitattributes)
  - phase: 22 (plan 22-05)
    provides: the rails' CSB_RAIL_RUN_ID (one id per vitest invocation, set by test/rails/ledgerRun.ts before any worker starts)
provides:
  - compareRecording records every comparison against the real recordings folder for the current run
  - scripts/check-recordings-compared.ts (npm run check:recordings-compared) and its 16-case --self-test
  - the CI step "Recordings compared gate (AUDIT-06)" right after npm run test:realpath
  - test/unit/recordingsComparedGate.test.ts and the wave-gate step after the full railed suite
affects: [phase-24 (a re-record can no longer hide behind a renamed file), phase-28 (test hygiene), phase-26 (Node upgrade must update the ABI 127 guard)]

actuals:
  tokens: 19415
  tasks: 2
  commits: 3
plan_head_before: 32eeb05a2b4afac546ae2e4c8d399ac589839520
plan_head_after: 23cba7aebf3a19aaee2044f0bc4fa5f939c8e436

tech-stack:
  added: []
  patterns:
    - "A post-run gate bound to one vitest invocation through the rails' CSB_RAIL_RUN_ID: the run is named explicitly (--run-id), by the invocation's own captured output (--run-log, realpath must start and finish in it), or as the only run on a fresh CI machine (--sole-run, CI only); records of other runs are never read"
    - "A scripts/ self-test that proves harness code by compiling the real test/ source in memory (typescript transpileModule, import.meta.url shimmed) under a temp mirror of the repo layout, so the code under test is the real file and no call can reach the real folder"

key-files:
  created:
    - scripts/check-recordings-compared.ts
    - test/unit/recordingsComparedGate.test.ts
  modified:
    - test/realpath/harness/serializer.ts
    - package.json
    - .github/workflows/test.yml
    - .planning/phases/23-test-safety-net-harness-triage-characterization/orchestrator/wave-gate.sh
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "Operator ruling 2026-11-12 (verbatim choice; the \"(Recommended)\" label was the orchestrator's): \"Fix now, small plan (Recommended)\", over a cheaper name-literal check, deferring to Phase 28, or review-only. This plan closes the 23-25 redirect gap"
  - "The record: compareRecording appends JSON.stringify(<path relative to the folder, forward slashes>) to <os.tmpdir()>/crypto-snipe-bot-recordings-compared/<CSB_RAIL_RUN_ID>/<pid>-<8 hex>.txt with appendFileSync, right after resolveRecordingPath and before the compare, in compare and update runs. Only calls whose folder is the real recordings folder are recorded; a dir override naming another folder is not. No valid run id records nothing and warns once per loaded module on stderr; a failed write warns once and never changes the compare"
  - "Run binding: CI runs --sole-run right after npm run test:realpath (allowed only when CI is set; the record folder must hold exactly one run, which on a GitHub-hosted runner's new machine is the run that step made, because no other step runs the realpath project); the wave gate runs --run-log \"$OUT/vitest.log\" on its own single full-suite invocation (one run id in the log, realpath started and finished in it); locally --run-id or --run-log. There is no default and no newest-folder pick; no record for the judged run is exit 2 even when an earlier run's record is complete"
  - "What counts as a recording: a file git tracks (ls-files, the index) under test/realpath/recordings/ whose name ends in .jsonl or .json, the only extensions compareRecording accepts; anything else there (today only .gitattributes) is listed as not a recording. A tracked path under a letter-case variant of the folder is a violation"
  - "Record file names use 8 random hex digits taken when the serializer loads instead of the worker thread id, because the spawn-site gate counts node:worker_threads as a spawner module (and the gate may not change)"
  - "Wrapper limits from measurement: 19.4 s alone, 67.1 s in the full run (3.5x), child 240 s / test 250 s as for the sibling self-tests (28 percent)"

patterns-established:
  - "A gate that must judge one run takes the run as an argument or from that run's own output, refuses ambiguity with exit 2, and its self-test proves a stale run's complete record never satisfies it"

requirements-completed: [AUDIT-06]

coverage:
  - id: D1
    description: "Every compareRecording call against the real recordings folder is recorded against its run, from every worker, with the relative path it compared; dir-override calls are not recorded; no valid run id records nothing and says so once; compare and write results unchanged"
    requirement: AUDIT-06
    verification:
      - kind: unit
        ref: "test/unit/recordingsComparedGate.test.ts (cases serializer-*), the real serializer source under a temp mirror"
        status: pass
      - kind: other
        ref: "three normal realpath runs (one as a CI rehearsal) left all 131 files under test/realpath/recordings/ byte-identical"
        status: pass
    human_judgment: false
  - id: D2
    description: "After a full realpath run the check fails naming each tracked recording never compared and each compared path not tracked; the 23-25 redirect fails naming the old file while the commit check passes it; a stale run never counts; an empty or broken record exits 2"
    requirement: AUDIT-06
    verification:
      - kind: unit
        ref: "test/unit/recordingsComparedGate.test.ts#check-recordings-compared.ts --self-test (AUDIT-06) exits 0 and every rule case passes on throwaway repos and record folders"
        status: pass
      - kind: other
        ref: "real-repo demonstration: flashbots-v2-trailing pointed at flashbots-v2-trailing-b with the new file staged; full realpath run 344/344 green; check exit 1 naming only flashbots-v2-trailing.jsonl (undone, byte-identical)"
        status: pass
      - kind: other
        ref: "11 mutants (each rule switched off), each caught by its own case on the final code"
        status: pass
    human_judgment: false
  - id: D3
    description: "The check runs as npm run check:recordings-compared, in CI directly after npm run test:realpath, and in the wave gate after the full suite; a real full run passes with equal counts"
    requirement: AUDIT-06
    verification:
      - kind: other
        ref: "wave-gate.sh on a2cc682 plus Task 2 files: full suite 211 files 1560/1560, check:recordings-compared --run-log RESULT PASS (tracked 130, compared 130)"
        status: pass
      - kind: other
        ref: "CI rehearsal (CI=true, fresh temp folder): wrapper, npm run test:realpath, npm run check:recordings-compared -- --sole-run RESULT PASS (tracked 130, compared 130)"
        status: pass
    human_judgment: false

duration: 37min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 33: Recordings Compared Check Summary

**compareRecording now records, per rails run id, which recording each call compared, and a post-run check fails when a committed recording was never compared in a full run. A scenario test quietly pointed at a new recording name now fails CI, naming the old file, although the commit check passes that commit and the suite stays green.**

## Performance

- **Duration:** 37 min
- **Started:** 2026-11-12T20:49:47Z
- **Completed:** 2026-11-12T21:26:27Z
- **Tasks:** 2
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- **The record (serializer.ts, the one harness change this plan owns):** after the path checks and before the compare, each call against the real recordings folder appends one JSON-quoted relative path to `<os.tmpdir()>/crypto-snipe-bot-recordings-compared/<CSB_RAIL_RUN_ID>/<pid>-<8 hex>.txt`. It writes synchronously and records in compare and update runs. The folder is outside the rail ledger. A real full realpath run wrote 130 calls in 5 files, one per test file that compares.
- **The check (`npm run check:recordings-compared`):** it reads the tracked recordings from `git ls-files` and that one run's record. It fails with `NEVER COMPARED "<path>"` for a tracked recording no test compared, `NOT TRACKED "<path>"` for a compared path git does not track, and `CASE VARIANT` for a tracked path under a letter-case variant of the folder. It prints the counts. It has the gate shape of 23-17 and 23-25: ABI 127 guard, exit 0 / 1 / 2, `require.main` guard, `--help`.
- **Real tracked set, measured:** 131 tracked files = 130 recordings (22 scenario .jsonl, 108 env/*.json including env/_baseline.json) + 1 not a recording (.gitattributes). Every real full run judged so far: `RESULT PASS (tracked 130, compared 130)`.
- **CI:** the step "Recordings compared gate (AUDIT-06)" sits directly after `- run: npm run test:realpath` and runs `npm run check:recordings-compared -- --sole-run`, with a comment saying what it protects. Nothing else in the workflow changed.
- **Wave gate:** right after the full railed suite, `--run-log "$OUT/vitest.log"`. Its output goes to `$OUT/recordings-compared.log`, the summary lines and the exit code are printed, and a failure sets `fail=1`. Every other step is unchanged.
- **Unit suite:** `test/unit/recordingsComparedGate.test.ts` runs the 16-case self-test through `spawnRailedChild`. It asserts every case name, the 23-25 gap line, and `SELF-TEST PASS 16 of 16 cases`.

### How CI and the wave gate pass the run to the check

- One vitest invocation is one run. `test/rails/ledgerRun.ts` (globalSetup of every project) either takes `CSB_RAIL_RUN_ID` from the environment or generates `run-<UTC>-<pid>-<6 hex>`. It sets the id in the Vitest main process before any worker starts, so every worker of that invocation shares it. `core.cjs` keeps it through the env scrub. The serializer records under that id.
- **CI (`--sole-run`):** this mode is refused unless `CI` is set. The record folder must then hold exactly one run, or the check exits 2. A GitHub-hosted job starts on a new machine. The unit and integration steps compare no real recording, and the wrapper's self-test writes only into temp folders it makes; the rehearsal confirmed no record folder existed after the unit step. So the one run is the one `npm run test:realpath` just made. Zero runs or several runs is exit 2, never a pick.
- **Wave gate (`--run-log`):** the gate captures its single full-suite invocation in `$OUT/vitest.log`. The rails print `[SAFE-02 rails] run <id> — project <name> — ledger ...` at each project start and `... project <name> finished — summary ...` at the end. The check requires exactly one run id in the log, with the realpath project both started and finished in it, and judges only that run.
- **Locally:** `--run-id <id>` or `--run-log <file>`. With no flag the check exits 2 ("the check never guesses").
- **Stale records:** the check never reads another run's folder. The self-test shows this with a complete older record next to a missing or partial new one: exit 2, or exit 1 naming the gap, never a pass. Mutant M6 (judge the first run folder instead of the named one) is caught by two cases.

### Self-test cases (16)

The three serializer cases compile the real `test/realpath/harness/serializer.ts` source in memory. The file name is set inside a temp mirror of the repo layout, so its RECORDINGS_DIR is a temp folder, and TEMP / TMP / TMPDIR point at a temp folder.
- (1) Eight real-folder calls are recorded in order: match, `env/../a.jsonl` normalized to `a.jsonl`, the env baseline, a differing text, an absent file, an explicit `dir` equal to the real folder, an update-mode write, and a refused write under CI. The check's reader reads the serializer's own file back as the same 4 paths.
- (2) Dir-override calls against another folder are not recorded (compare, differ, absent, update write).
- (3) Run id unset, empty or `../escape`: nothing is recorded, there is one stderr line each, and the compares still match.

The check cases use throwaway git repos with local user.name and user.email, removed in a finally, and temp record folders:
- all compared passes with equal counts;
- a scenario never compared fails naming it;
- an env-snapshot file never compared fails naming it;
- a compared path git does not track fails naming it (on disk but not added, and absent everywhere);
- **the 23-25 gap:** `flashbots-v2.test.ts` repointed at `flashbots-v2-trailing-b` with the new file added. The real commit check (`judgeHistory`) judges that one commit and passes it, and this check fails naming `flashbots-v2-trailing.jsonl`;
- an older run's records never count;
- `--run-log` judges the run its log names and nothing else;
- `--run-log` refuses two runs, no realpath project, realpath not finished, no rails line, or an unreadable log;
- `--sole-run` is CI only and needs exactly one run;
- an empty or broken record exits 2 (10 variants);
- no tracked recording exits 2;
- no selection, a bad run id, or two selections exits 2;
- a tracked path under a letter-case variant of the folder fails.

**Mutation runs:** each rule was switched off in place on the final code, and the file was restored byte for byte (sha256 checked, then `git diff --quiet HEAD`). All 11 mutants were caught, each by its own cases:
- M1 dir-override calls recorded (1 case);
- M2 any run id accepted (1);
- M3 nothing recorded (2);
- M4 never-compared rule off (5);
- M5 not-tracked rule off (2);
- M6 run binding off (2);
- M7 empty record accepted (1);
- M8 non-recording files judged (8);
- M9 `--sole-run` outside CI (1);
- M10 finished line not required (1);
- M11 `--sole-run` picks one of several (1).

## Task Commits

1. **Task 1: Record each comparison per run, and build the post-run check with its self-test** - `65b719a` (feat), then `a2cc682` (fix: record file token instead of the thread id, found in Task 2)
2. **Task 2: Wire the check into npm, CI, the unit suite and the wave gate** - `23cba7a` (feat)

**Plan metadata:** this SUMMARY commit (docs)

## Files Created/Modified

- `test/realpath/harness/serializer.ts` - recordCompared() and its one call in compareRecording, plus the header paragraph; nothing else changed
- `scripts/check-recordings-compared.ts` - the post-run check and its `--self-test`
- `test/unit/recordingsComparedGate.test.ts` - the self-test in a railed child (child 240 s, test 250 s, measurements in a comment)
- `package.json` - one script, `check:recordings-compared`
- `.github/workflows/test.yml` - the step "Recordings compared gate (AUDIT-06)" after `npm run test:realpath`
- `.planning/phases/23-test-safety-net-harness-triage-characterization/orchestrator/wave-gate.sh` - the check after the full suite
- `.planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md` - the 23-25 redirect entry marked resolved (kept)

## Decisions Made

See key-decisions above. For Phase 24 in practice:
- After a re-record, the full realpath run must still compare every tracked recording. A scenario renamed on purpose must remove its old file in the same `behavior:` commit; the commit check then requires that commit to cite a registered ID.
- A filtered run (a file or `-t` filter) fails this check by design, because it compares only some recordings. The check is a separate step after a full run, so filtered developer runs are unaffected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The spawn-site gate refuses `node:worker_threads` in the serializer**
- **Found during:** Task 2 (first run of the wrapper with spawnSites.test.ts)
- **Issue:** the plan's example file name is `<pid>.txt`. I used `<pid>-<threadId>.txt` so that two worker threads of one process could not share a file. `test/unit/rails/spawnSites.test.ts` reported `test/realpath/harness/serializer.ts:57 import of node:worker_threads`, and that gate may not change.
- **Fix:** each loaded copy of the serializer takes 8 random hex digits when it loads (`node:crypto`). Different threads and different loaded copies (Vitest loads it once per test file) therefore still get different files. The check accepts only `<pid>-<8 hex>.txt`, and the self-test gained a case for any other file name.
- **Verification:** spawnSites, sourceTextGate and the wrapper pass (3 files, 10 tests). Realpath run 2 and the full run pass the check. All 11 mutants were re-run on the final code.
- **Committed in:** a2cc682

**2. [Rule 2 - Missing critical] `--sole-run` is refused outside CI**
- **Found during:** Task 1 (run binding design)
- **Issue:** "the only run in the folder" binds to the realpath step's run only on a fresh CI machine. Locally the record folder keeps earlier runs, so a sole older run could be judged stale.
- **Fix:** `--sole-run` requires `CI` to be set; outside CI the check asks for `--run-id` or `--run-log`. `--run-log` also requires the realpath project to start and finish in the log.
- **Verification:** sole-run and run-log cases; mutants M9, M10 and M11.
- **Committed in:** 65b719a

**3. [Rule 2 - Missing critical] Letter-case variants of the folder**
- **Found during:** Task 1
- **Issue:** on the operator's Windows checkout, a tracked `test/realpath/RECORDINGS/x.jsonl` is in the same folder as the recordings, but the exact-case listing would never see it.
- **Fix:** a second `:(icase)` listing; any path that appears only there is a `CASE VARIANT` violation.
- **Verification:** the case-variant case (an index entry only, so the case-insensitive disk is not involved).
- **Committed in:** 65b719a

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 missing critical)
**Impact on plan:** every rule the plan names is implemented as written. The additions keep the run binding and the tracked set from being satisfied the wrong way. No scope beyond the plan's files.

## Findings Registered or Regraded

None. No finding was registered and no severity changed.

## Issues Encountered

- The full-suite wave gate and the final mutation run were each moved to the background by the harness after 180 s. Each time I waited for the output file to show completion, without starting other work, and both finished with exit 0.
- In the first mutation round, mutant M10 printed no summary line. Diagnosis: after `if (!started) throw`, TypeScript narrows `started` to `true`, so my mutant's `started === false` did not compile; it was a mutant error, not a result. A compiling mutant (`Date.now() < 0`) was caught by the "realpath never finished" variant. The final round used it from the start.
- My first edit script for the token change stopped partway. A backslash in a search string did not survive the heredoc, and that shell ran the global Node 24 (no project code was run with it). The serializer edits had landed and the check edits had not. I confirmed this with `git diff` and finished the check edits with the Edit tool.
- `buyNonceLock.test.ts` "exposes submitBuyTx" ran at 63 percent of 5 s in the full run. It is the only test at or over half its limit, and deferred-items.md already diagnosed and closed it: the time is its `beforeEach` cold import, timed against the 10 s hook limit, and neither of its re-open triggers occurred. This plan does not touch it.
- I wrote three check.ts logs to `/tmp` instead of the scratchpad, then removed them.

## Gates (Node 22.16.0)

- **Full railed suite** through `wave-gate.sh` (a2cc682 code tree plus the Task 2 files; the Task 2 commit changed only the wrapper's limit comment afterwards): **211 files, 1560/1560 passed**, wall 185 s, exit 0, 0 unhandled errors. Ledger run-20261112T211447-4368-f8d5c6: nonLoopbackAllowed 0, telegramAllowed 0, unparseableLines 0; the wrapper is not a triggering file. **check:recordings-compared --run-log on that run: RESULT PASS (tracked 130, compared 130).** Wrapper 67.1 s of 240 s; commitTaxonomyGate 90.4 s of 240 s; signingCensusGate 77.4 s; backupState 48.5 s of 230 s.
- **Three normal realpath runs**, every one 70 files 344/344 with all 131 files under the folder byte-identical (sha256 of each file, and the index entries):
  1. run-20261112T205652-22728-bce883, 106 s, check PASS 130/130;
  2. run-20261112T210704-15564-e62015, 99 s, token version, check PASS;
  3. the CI rehearsal with `CI=true` and a fresh TEMP: wrapper, then `npm run test:realpath` (100 s), then `npm run check:recordings-compared -- --sole-run` PASS 130/130.
- **Real-repo gap demonstration** (working tree and index only, undone): the trailing scenario was repointed at `flashbots-v2-trailing-b` and the new file was written by `npm run recordings:update` and staged. A full realpath run went 344/344 green, and the check exited 1 with one violation, `NEVER COMPARED "flashbots-v2-trailing.jsonl"` (tracked 131, compared 130). The test file was restored by sha256, the new file was unstaged and removed, and the recordings and index were byte-identical afterwards.
- Wrapper alone through Vitest: 19.4 s, with spawnSites.test.ts and sourceTextGate.test.ts: 3 files, 10 tests passed.
- tsc --noEmit clean on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json. Strict scratch tsc (noUnusedLocals) clean over serializer.ts as ESM and over the new script as CommonJS.
- check:realpath-mocks 0 violations (104 files); check:vi-mock 660 calls, 0 violations; check:census 23 sites, 0 problems (scripts 28 files including the new one); red-proof-conversions --check-manifest MANIFEST-OK rows 36 files 11 guards 1.
- **npm run check:commits: RESULT PASS**, 40 commits judged after babd7e4, 0 existing recording paths changed, removed or re-added.
- check.ts --stage partial, consolidation and triage: PASS (fail 0, pending 0, warn 0) after this plan's commits; no re_audit row was needed. `--stage final`: 275 FAILs, 5 naming this plan's files: ledger rows for the 2 new files, the existing missing TESTI row for serializer.ts (new in 23-20), and the package.json and test.yml re_audit rows, which already failed at final after 23-17/23-25 and now name 23cba7a. This is the out-of-scope Phase 22 bookkeeping kind.
- `git status --porcelain src` is empty. No `csb-recordings-compared-*` temp folder is left. `.planning/config.json` and `.planning/state.json` are left modified and unstaged. The real record folder holds the five runs of this session (OS temp, like the rail ledger).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- From Phase 24's first commit, a scenario test cannot quietly stop comparing a committed recording: CI fails right after the realpath step, naming the file.
- The STATE.md Blockers/Concerns line for the 23-25 gap is marked resolved, and the deferred-items.md entry is closed.
- Phase 23 has 33 plans; this was the last planned one.

## Self-Check: PASSED

- FOUND: scripts/check-recordings-compared.ts, test/unit/recordingsComparedGate.test.ts, package.json (check:recordings-compared), .github/workflows/test.yml (Recordings compared gate (AUDIT-06), directly after `- run: npm run test:realpath`), wave-gate.sh (the check after the full suite), deferred-items.md (status: resolved)
- FOUND commits: 65b719a, a2cc682, 23cba7a (all ancestors of HEAD; 3 commits since plan_head_before 32eeb05)
- Acceptance re-run: Task 1 verify (self-test, then no change under src/ or test/realpath/recordings/) PASS; Task 2 verify (wrapper, npm script, CI step, check:commits, src clean) PASS; a real full run passes with tracked 130 = compared 130; three normal runs byte-identical

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
