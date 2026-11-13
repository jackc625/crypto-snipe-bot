---
phase: 23-test-safety-net-harness-triage-characterization
plan: 18
subsystem: testing
tags: [red-proof, in-memory-mutant, vitest, invocationCallOrder, vi.importActual, better-sqlite3, anti-rug, CHAR-06]

requires:
  - phase: 23 (plan 23-29)
    provides: runMutant, literalTitlePaths, the WIRING_MUTANTS / CONVERTED_TESTS / CONVERTED_COUNTS tables, --check-manifest and --check-summaries
  - phase: 23 (plan 23-16)
    provides: a green register (check.ts --stage triage PASS) to keep green
provides:
  - test/integration/anti-rug/botWiring.test.ts reads no source file; Tests 22-26 and 31 check the wiring by calling real exports
  - scripts/red-proof-bot-wiring.ts (proveWiring, judgeMutantRun, judgeControlRun; --self-test)
  - scripts/red-proof-conversions.ts rows: 7 WIRING_MUTANTS, 6 CONVERTED_TESTS, CONVERTED_COUNTS entry 6; FORBIDDEN_IN_MESSAGE exported
affects: [23-31, 23-30, 23-19 (they extend the same tables after this plan), 23-26 (MANIFEST-OK rows 36 files 11 guards 1 counts these 6 rows; --check-summaries reads the RED-OK lines below), phase-28 (test-identity describe-rename limit, deferred-items.md)]

actuals:
  tokens: 11260
  tasks: 2
  commits: 2
plan_head_before: ddadd10013c2293774915af4e806a1a8640932b7
plan_head_after: 54e293bb9d16abbb709c1aeeaa1a55bb2bf63841

tech-stack:
  added: []
  patterns:
    - "Arming order read from the global mock counter: the calls to startExitMonitor, snapshotLpBaseline and registerAntiRugPosition are merged by mock.invocationCallOrder into one ordered list and compared with toEqual, so a missing call and a wrong order both fail as AssertionError"
    - "A private helper is tested through every real exported caller, each driven to its success branch with plain-function stubs (immune to mockReset: true), never by exporting it"
    - "A production SQL statement is tested on its real connection through vi.importActual while the rest of the file keeps the db mock; under Vitest an unset DB_PATH opens a fresh temp file, closed and deleted in finally"
    - "Two statements are swapped in memory by three edits through a marker (/*csb-swap*/), because each find must occur exactly once in the text the edits before it left"

key-files:
  created:
    - scripts/red-proof-bot-wiring.ts
  modified:
    - test/integration/anti-rug/botWiring.test.ts
    - scripts/red-proof-conversions.ts
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "The describe title 'Source-text wiring guards (Tests 22-26)' is kept: .planning/audit/tools/test-identity.ts honours a rails-test-edits.json rename of the test's own title only (compareFile keeps every describe level), so renaming the describe would report all five tests as missing and force false AC-38 removal lines in 23-26. A comment in the test file says why; deferred-items.md records the tool limit for Phase 28. No test title changed, so rails-test-edits.json is unchanged."
  - "Every converted test keeps its title and its it() block: 10 it() before and after, 6 converted, 0 removed."
  - "The proof script requires the vite reach marker for every mutant, and that every test of the file either passed or failed (no skip). The plan did not ask for either. Both make the proof stricter, and --self-test shows each refusal firing on a built run."
  - "FORBIDDEN_IN_MESSAGE is exported from red-proof-conversions.ts so the wiring script and runGroup share one list instead of two copies."

patterns-established:
  - "Wiring RED proof: one whole-file run per WIRING_MUTANTS row, matched on the Test NN prefix, plus a no-mutant control in which every test of the file passes"

requirements-completed: [CHAR-06]

coverage:
  - id: D1
    description: "botWiring.test.ts reads no source file. Tests 22-26 drive the real exported handleNewPairForChain, executeDeliberateBuy, handleNewV3PoolForChain and startMultiChainBot separately and check the order with mock.invocationCallOrder. Test 31 runs the real getResumeAntiRugTrades statement on its real connection."
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "node node_modules/vitest/vitest.mjs run --project integration test/integration/anti-rug/botWiring.test.ts (10/10, x3) && ! grep -q readFileSync test/integration/anti-rug/botWiring.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each of the seven in-memory wiring mutants (V2, deliberate, V3, boot and resume-query paths) fails exactly its expected tests with assertion failures. The no-mutant control passes 10/10. The src/bot.ts and src/utils/db.ts hashes are unchanged and git status for src is empty."
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "node node_modules/ts-node/dist/bin.js scripts/red-proof-bot-wiring.ts (RED-PROOF-BOT-WIRING-OK mutants 7 control 10 passed, x4, byte-identical)"
        status: pass
      - kind: unit
        ref: "node node_modules/ts-node/dist/bin.js scripts/red-proof-bot-wiring.ts --self-test (SELF-TEST-OK cases 16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The tables name a mutant for each of the 6 converted tests, and every find occurs exactly once."
    requirement: CHAR-06
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --check-manifest (MANIFEST-OK rows 6 files 1 guards 0)"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 18: Bot Wiring Conversion and Its RED Proof Summary

**botWiring.test.ts now checks the anti-rug arming order by calling the real exported V2 snipe, deliberate buy, V3 snipe and boot functions, and checks the resume query with the real statement on a real temp SQLite file. Seven in-memory mutants each fail exactly the tests they should, with nothing written under src/.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-11-12T05:22:20Z
- **Completed:** 2026-11-12T05:38:14Z
- **Tasks:** 2
- **Files modified:** 3 (plus deferred-items.md); src/ is unchanged

## Accomplishments

- **Tests 22-26:** no longer read src/bot.ts. Each drives a real export to a landed buy or a full boot, then reads the order of the arming calls from the mocks the file already had:
  - Test 22: `handleNewPairForChain`, then `executeDeliberateBuy`.
  - Tests 23 and 25: `handleNewPairForChain`.
  - Tests 24 and 25: `handleNewV3PoolForChain`.
  - Test 26: `startMultiChainBot`.
- **The private `armPositionMonitoring`:** reached through its two real callers. No export was added.
- **Test 31:** no longer reads src/utils/db.ts. It seeds three positions through the real db module's own statements: an open buy with a baseline, an open buy without one, and an exit_failed_held position with a baseline. The real `getResumeAntiRugTrades` must return the first and third only.
- **RED proof:** `scripts/red-proof-bot-wiring.ts` proves every converted test RED with the 23-29 in-memory mechanism. Each failure is the assertion the test exists to make (first lines below).

## Task Commits

1. **Task 1 (tracer): convert the bot wiring test to real calls:** `cbe1b7f` (test). The tracer verify was re-run on the committed tree and passed, then Task 2 started.
2. **Task 2: RED proof script and table rows:** `54e293b` (test).

## RED proofs

From `node node_modules/ts-node/dist/bin.js scripts/red-proof-bot-wiring.ts` (exit 0, 14 to 15 s; four runs, output byte-identical):

```
RED-OK v2-arm-order :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 22: the shared armPositionMonitoring helper calls snapshotLpBaseline BEFORE registerAntiRugPosition
RED-OK v2-arm-order :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 25: snapshot failure handled via try/catch + 'antirug.baseline-snapshot-failed' log
RED-OK v2-exit-monitor-last :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 22: the shared armPositionMonitoring helper calls snapshotLpBaseline BEFORE registerAntiRugPosition
RED-OK v2-exit-monitor-last :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 23: the shared armPositionMonitoring helper calls registerAntiRugPosition parallel to startExitMonitor
RED-OK deliberate-not-armed :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 22: the shared armPositionMonitoring helper calls snapshotLpBaseline BEFORE registerAntiRugPosition
RED-OK v3-arm-order :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 24: V3 buy-success branch calls snapshotLpBaseline + registerAntiRugPosition with feeTier
RED-OK v3-arm-order :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 25: snapshot failure handled via try/catch + 'antirug.baseline-snapshot-failed' log
RED-OK v3-fee-tier-dropped :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 24: V3 buy-success branch calls snapshotLpBaseline + registerAntiRugPosition with feeTier
RED-OK boot-resume-order :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > Source-text wiring guards (Tests 22-26) > Test 26: startMultiChainBot calls resumeAntiRugMonitoring AFTER resumeMultiChainMonitoring
RED-OK resume-query-includes-unbaselined :: test/integration/anti-rug/botWiring.test.ts :: Phase 19 — bot.ts wiring + resumeAntiRugMonitoring > resumeAntiRugMonitoring runtime behavior (Tests 27-31) > Test 31: pre-Phase-19 trades (no lp_baseline) are excluded by INNER JOIN
RED-PROOF-BOT-WIRING-OK mutants 7 control 10 passed
```

The first line of each failure message (from a separate diagnostic run of the same rows through `runMutant`):

| Mutant | Test | First line |
|---|---|---|
| v2-arm-order | 22 | `AssertionError: expected [ 'startExitMonitor', …(2) ] to deeply equal [ 'startExitMonitor', …(2) ]` |
| v2-arm-order | 25 | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| v2-exit-monitor-last | 22 | `AssertionError: expected [ 'snapshotLpBaseline', …(2) ] to deeply equal [ 'startExitMonitor', …(2) ]` |
| v2-exit-monitor-last | 23 | `AssertionError: expected 'snapshotLpBaseline' to be 'startExitMonitor'` |
| deliberate-not-armed | 22 | `AssertionError: expected [] to deeply equal [ 'startExitMonitor', …(2) ]`. The V2 half passed and the deliberate half failed, so the deliberate half is real. |
| v3-arm-order | 24 | `AssertionError: expected [ 'startExitMonitor', …(2) ] to deeply equal [ 'startExitMonitor', …(2) ]` |
| v3-arm-order | 25 | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| v3-fee-tier-dropped | 24 | `AssertionError: expected "vi.fn()" to be called with arguments: [ … ]` |
| boot-resume-order | 26 | `AssertionError: expected 77 to be less than 76` |
| resume-query-includes-unbaselined | 31 | `AssertionError: expected [ 1, 2, 3 ] to deeply equal [ 1, 3 ]` |

Every mutant failed exactly the set the plan predicted, so no expected set was changed. No test was removed; this plan has no `AC-38 removed:` line.

## Files Created/Modified

- **`test/integration/anti-rug/botWiring.test.ts`:**
  - Tests 22-26 and 31 converted. Tests 27-30 are unchanged apart from a type-only `as unknown as` cast, needed because the fixture gained fields.
  - New stubs:
    - An ethers `Contract` stub (the shape used in v2HoneypotIntegration.test.ts).
    - A `src/preflight` mock: the entry gate passes, preflight passes.
    - `escalatePrivateBuy`: the deliberate private leg lands.
    - `setExitWorkerWatchdog` and `computePublicMinOut` on the exitEngine mock.
    - The kill-switch statements on the db mock.
    - Plain-function happy-path safety checks.
  - Test 26 keeps the boot's two `setInterval`s on the fake clock and removes the SIGINT/SIGTERM handlers the boot adds.
  - The first `src/bot` import is in a file-level `beforeAll`.
- **`scripts/red-proof-bot-wiring.ts`:** the proof described in its header, plus `--self-test`. It has the ABI guard and the `require.main` guard.
- **`scripts/red-proof-conversions.ts`:** the plan's seven WIRING_MUTANTS rows (one shared `swapStatements` helper builds the three swaps), six CONVERTED_TESTS rows (`baseTitle` = `currentTitle` = the full title path), `CONVERTED_COUNTS` 6, and the `FORBIDDEN_IN_MESSAGE` export.
- **`deferred-items.md`:** botWiring is off the open cold-import list, and a new open entry records the test-identity describe-rename limit.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 avoided by keeping the title; recorded] The describe title that says "Source-text" is kept**
- **Found during:** Task 1, reading `.planning/audit/tools/test-identity.ts` before choosing titles.
- **Issue:** the plan says to keep each test's name "unless the name itself states 'source-text'", and to record each title change in rails-test-edits.json so test-identity honours it. The only level that states it is the describe `Source-text wiring guards (Tests 22-26)`. test-identity matches `title_before` against the last title level only (`compareFile`, lines 212-221), so a describe rename cannot be recorded, and 23-26 would read five tests as missing.
- **Fix:** kept every title. A comment in the test file explains it, and deferred-items.md holds the tool limit with a Phase 28 suggestion. Test identity (AC-49) is the stronger invariant; the describe name is cosmetic.
- **Files modified:** test/integration/anti-rug/botWiring.test.ts (comment), deferred-items.md.
- **Committed in:** cbe1b7f (comment). The deferred-items entry is in the SUMMARY commit.

**2. [Rule 2 - Missing check] The proof script checks reach and completeness, and has a self-test**
- **Found during:** Task 2.
- **Issue:** the plan's list does not ask for a reach marker. Without one, a mutant whose find matched but whose module never loaded could still look like a pass. Nothing required every test of the file to run either. The script's refusal logic was also new code with nothing proving it.
- **Fix:** the script requires the `vite` marker, and requires every test of the file to have passed or failed. `--self-test` drives the judge through 16 built runs, one per refusal.
- **Committed in:** 54e293b.

**3. [Rule 3 - Interface] `FORBIDDEN_IN_MESSAGE` exported**
- **Issue:** the plan asks this script to apply runGroup's assertion rule. The list was module-private, and a second copy could drift.
- **Fix:** a one-word export with a comment. The behaviour of red-proof-conversions.ts is unchanged: `--self-test` still prints 30 cases and `--self-proof` 8 rows.
- **Committed in:** 54e293b.

**4. [Rule 3 - Blocking] Stubs needed to reach the success branches**
- **Issue:** with `mockReset: true`, the existing `vi.fn()` factories (canSnipe, startApiServer, startTelegramListener and others) return undefined in every test. The handlers would stop at `riskResult.allowed`. The boot's `telegramHandle` would be undefined. The exitEngine mock lacked `setExitWorkerWatchdog`.
- **Fix:** plain functions for every happy-path stub that no test reads, and the missing exports added. No assertion depends on a stub's call record except the three arming mocks and the two statement mocks, which are re-armed in `beforeEach`.
- **Committed in:** cbe1b7f.

---

**Total deviations:** 4 (1 kept-title decision, 1 Rule 2, 2 Rule 3). **Impact:** every converted test protects what it protected before, and the proof is stricter than planned. No scope change; src/ untouched.

## Severity changes and new findings

None. Every wiring path the six tests protect is intact on HEAD: each control run passed, and each mutant flipped only its own tests. No register entry changed.

How the known nearby bugs relate (the plan notes), and why none decides an assertion here:
- **AUD-ANTIRUG-025:** this bug is in detector.ts, which this file mocks. The tests assert only the bot.ts call order.
- **AUD-API-002:** the onRestart path is not driven here, and the 23-10 mirror is not used.
- **AUD-ANTIRUG-001 / AUD-BUY-008:** every context has `wsProvider: null` and nothing reconnects.

## Issues Encountered (all diagnosed)

- **ts-node not found from the scratchpad:** a throwaway diagnostic script in the session scratchpad failed with `Cannot find module 'ts-node'`, because Node resolves modules from the script's folder. Re-run with `require.resolve('ts-node', { paths: [repo] })`, it printed the messages in the table above. This was only a diagnostic; the repo scripts were not involved.
- **Line endings:** git warns "LF will be replaced by CRLF" for the three files (`core.autocrlf=true`, AUD-OD21-001, as in 23-29). The overlay converts both text and finds to LF, and the working copy of src/bot.ts was LF when measured, so the finds apply either way.

## Verification (Node 22.16.0)

**Task verifies, as written:**
- **Task 1:** Vitest on the file, then `! grep -q readFileSync`: PASS. Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:** `red-proof-bot-wiring.ts && test -z "$(git status --porcelain src)"`: PASS. `--check-manifest | grep -q "MANIFEST-OK rows 6 files 1 guards 0"`: PASS.

**Acceptance criteria:**
- The four exports are driven separately, with order checked through `mock.invocationCallOrder`: yes (Tests 22-26).
- Test 31 uses `vi.importActual` and the real statement: yes.
- No file-reading call: `grep -c readFileSync` gives 0. The only fs import is `rmSync`, which deletes the temp DB.
- `it(` count: 10 before, 10 after.
- `git status --porcelain src` prints nothing: yes.
- A RED-OK line for each of the seven mutants: yes (above).

**Full railed suite:**
- Command: `npm test -- --reporter=json` on the 54e293b tree, rails run `run-20261112T053244-12772-cad446`.
- Result: 199 files, 1,396 tests; 1,396 passed, 0 failed, 0 skipped, 0 todo; wall 166 s.
- By project: unit 946, integration 263, realpath 187. These are the same counts as 23-29, because no test was added or removed.
- Rail ledger: `nonLoopbackAllowed` 0, `telegramAllowed` 0.
- The two "unhandled" strings in the output are test titles (AUD-BUY-005 and notifierRefusal).
- botWiring.test.ts wrote no console output.

**Timing (half-limit rule):**
- Slowest test in the full run: 131 ms (Test 31, which opens a real temp SQLite file), against a 15 s testTimeout. The others took 1 to 17 ms.
- Alone, Vitest's phases for the whole file were transform 228 ms, import 101 ms and tests 407 ms, hooks included.
- No test is near half its limit, so no explicit limit was added.

**Repeatability:**
- The test file, three runs: 10/10 each time.
- The proof: four runs, the same 11 lines each time (md5 ef39278c715c), 14 to 15 s per run.
- No `csb-red-proof-*` temp folder was left behind.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- A scratch strict tsconfig over the two scripts and the test file exits 0. The repo tsconfig covers only src/.
- `check-realpath-mocks`: 0 violations.
- `check-vi-mock-paths`: 593 calls in 267 files, 0 violations. That is 2 more calls than before, the new `ethers` and `src/preflight` mocks.
- `check-signing-census`: 23 sites, floor 23, 0 problems. 25 script files are counted, one more for the new script, which signs nothing.
- `check.ts` partial, consolidation and triage: RESULT PASS, fail 0, pending 0, re-run after both commits. No `re_audit` rows were needed.
- `red-proof-conversions.ts`:
  - `--self-test`: SELF-TEST-OK cases 30.
  - `--self-proof`: SELF-PROOF-OK rows 8.
  - `--check-manifest`: MANIFEST-OK rows 6 files 1 guards 0.
  - `--check-summaries` on this file: run before the SUMMARY commit (see Self-Check).

## Known Stubs

None. The test stubs are deliberate test doubles, and every path the tests assert runs real bot.ts code.

## Threat Flags

None. T-23-23 is mitigated as planned:
- The V2, V3, deliberate and boot paths are driven separately.
- No title changed and no test was removed.
- Each ordering conversion is shown RED in memory, with every hash unchanged.

The only file the proof writes is the reach marker in a temp folder under os.tmpdir(). Test 31's temp DB is under os.tmpdir() as well and is deleted after the test.

## User Setup Required

None.

## Next Phase Readiness

- Plans 23-31, 23-30 and 23-19 can add their rows. `--check-manifest` currently reads rows 6 files 1 guards 0; 23-26 requires 36 / 11 / 1.
- **Watch:** if a describe title of theirs says "source-text", see the deferred-items entry before renaming it.

## Self-Check: PASSED

- **Files found:** test/integration/anti-rug/botWiring.test.ts, scripts/red-proof-bot-wiring.ts, scripts/red-proof-conversions.ts.
- **Commits on this branch:** cbe1b7f and 54e293b. `git rev-list --count ddadd10..HEAD` = 2 before this SUMMARY.
- **`--check-summaries` on this SUMMARY:** SUMMARIES-OK red-ok 10 removed 0, checked before the commit.
- **Clean tree:** only the operator's own `.planning/config.json` and `.planning/state.json` changes remain, modified and unstaged.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
