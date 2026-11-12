---
phase: 23-test-safety-net-harness-triage-characterization
plan: 30
subsystem: testing
tags: [red-proof, in-memory-mutant, typescript-compiler-api, ts.createProgram, type-checker, symbol-lookup, express, CHAR-06]

requires:
  - phase: 23 (plan 23-29)
    provides: runMutant, runGroup, the MUTANTS / CONVERTED_TESTS / CONVERTED_COUNTS tables, --check-manifest and --check-summaries
  - phase: 23 (plan 23-31)
    provides: test/helpers/sourceGraph.ts (loadRepoModules, REPO_ROOT), reused for the REQUIRED_ENV_VARS lookup and the repo root
  - phase: 23 (plan 23-18)
    provides: the describe-title rule (test-identity honours a test's own title only)
provides:
  - test/unit/api/antiRug.test.ts, test/unit/chainRegistry/antiRugConfig.test.ts and test/unit/exitEngine/antiRugReason.test.ts read no named src/ or scripts/ file as text
  - a real type-checker query for executeFullSell's reason union, proven able to fail on a temp-directory source and on the real file
  - scripts/red-proof-conversions.ts groups api-mount (3 mutants), antirug-config (3) and reason (5); 9 CONVERTED_TESTS rows in 3 files
affects: [23-19 (converts the last three CHAR-06 files; its AC-37 gate must accept ts.createProgram / loadRepoModules over a directory walk, and the walkTs + ts.createSourceFile walk used here), 23-26 (MANIFEST-OK rows 36 files 11 guards 1 counts these 9 rows; --check-summaries reads the RED-OK lines below; test-identity reads the Test 6 rename), phase-27 (file moves: these tests find REQUIRED_ENV_VARS and executeFullSell by symbol)]

actuals:
  tokens: 10176
  tasks: 3
  commits: 3
plan_head_before: 8b4d3f9effb525ea97287f13ce58e3d7564b411f
plan_head_after: 02772f4

tech-stack:
  added: []
  patterns:
    - "Route mount check through the real server: spy http.Server.prototype.listen for the one listen() startApiServer makes, read its port, and send a real request with and without a session cookie planted in the real auth sessions map"
    - "Type-level assertion as a runtime type-checker query: find the declaring file by symbol in a directory walk, ts.createProgram with tsconfig.json's options, read the parameter's literal union members; the same function run on a temp-directory source proves it can fail"
    - "Private list contents read by symbol: exactly one VariableDeclaration named REQUIRED_ENV_VARS in a loadRepoModules(['src']) walk, then its array literal's object entries"
    - "A required-flag check as import behavior: unset the variables, vi.resetModules(), import the real config with process.exit spied (no throw), read the mocked logger.fatal's missing list"

key-files:
  created: []
  modified:
    - test/unit/api/antiRug.test.ts
    - test/unit/chainRegistry/antiRugConfig.test.ts
    - test/unit/exitEngine/antiRugReason.test.ts
    - scripts/red-proof-conversions.ts
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "antirug-gas-dropped expects Tests 2 and 3b, not Test 2 alone (measured): executeFullSell's only consumer of gasMultiplier is submitPrivateSell(ctx, txBuilder, attempts, gasMultiplier), so 'computed as undefined' and 'not passed' are the same behavior at every observable point; Test 3 stays green under it. The plan's own multiplier-not-threaded set (2 and 3b) is unchanged."
  - "Test 6 runs the real startApiServer (port 0) with its other routers' data sources stubbed as in wsPush.test.ts; the anti-rug router, authMiddleware, cookie parsing and the mount stay real. Its port comes from a spy on http.Server.prototype.listen, restored right after. Title renamed (recorded in rails-test-edits.json); the describe title is kept."
  - "Failure messages are kept short enough that Vitest prints them: Test 20 lists missing variable names and Test 21 lists offender names only. Vitest shows a longer string inside an array as Array(1), and the first antirug-config run refused two rows BAD-FAILURE for that reason (diagnosed; no expected set changed)."
  - "Test 1's walk is a local walkTs + ts.createSourceFile so the same function runs on src/ and on the temp-directory source; Tests 19 and 21 reuse loadRepoModules. Both forms name no file."

patterns-established:
  - "Proving a type-checker test can fail: run the same query function on a temp-directory source with the type change, inside the test"

requirements-completed: [CHAR-06]

coverage:
  - id: D1
    description: "antiRug.test.ts Test 6: a request on the real startApiServer reaches antiRugRoutes at /api/anti-rug behind authMiddleware (401 without a session) and resets the same context the server was given; 3 mutants on src/api/server.ts each fail exactly Test 6"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --group api-mount (3 RED-OK, x3, identical)"
        status: pass
    human_judgment: false
  - id: D2
    description: "antiRugConfig.test.ts Tests 19-21: no anti-rug variable is required (real config import with all of them unset); the one REQUIRED_ENV_VARS array found by symbol holds >= 32 anti-rug entries, each with a non-empty description; 3 mutants on src/config.ts each fail exactly their test"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "scripts/red-proof-conversions.ts --group antirug-config (3 RED-OK, x3, identical)"
        status: pass
    human_judgment: false
  - id: D3
    description: "antiRugReason.test.ts Tests 1, 2, 3, 3b, 7: a real type-checker query for the reason union (fails on a temp-dir source and on the real file under its mutant); the anti-rug multiplier reaches the private escalation only for anti-rug; a successful partial sell leaves anti-rug registered; 5 mutants, 7 RED-OK lines"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "scripts/red-proof-conversions.ts --group reason (7 RED-OK, x3, identical)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Manifest: 32 rows in 8 files and 1 guard"
    requirement: CHAR-06
    verification:
      - kind: other
        ref: "scripts/red-proof-conversions.ts --check-manifest (MANIFEST-OK rows 32 files 8 guards 1)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 30: Anti-Rug and Config Conversions and Their RED Proofs Summary

**What the three test files check now:**
- **API mount (Test 6):** a request on the real running API server reaches the anti-rug router behind the login check and resets the same chain context the server was given.
- **Anti-rug settings (Tests 19-21):**
  - Test 20: the real config module loads with every anti-rug variable unset.
  - Tests 19 and 21: the private `REQUIRED_ENV_VARS` list is found by symbol and its entries are counted and checked.
- **Exit reasons (Tests 1, 2, 3, 3b, 7):**
  - Test 1: a real type-checker query reads the `reason` union.
  - Tests 2, 3 and 3b: the anti-rug gas multiplier reaches the private sell only for anti-rug exits.
  - Test 7: a successful partial sell leaves anti-rug registered.

11 in-memory mutants give 13 RED-OK lines. Nothing under src/ was written.

## Performance

- **Duration:** about 22 min
- **Started:** 2026-11-12T13:19:53Z
- **Completed:** 2026-11-12T13:41:00Z
- **Tasks:** 3
- **Files:** 6 changed (none created); src/ unchanged

## Accomplishments

- **antiRug.test.ts Test 6:**
  - A `beforeAll` starts the real `startApiServer` on 127.0.0.1 port 0 and plants a session in the real auth `sessions` map.
  - The test sends `POST /api/anti-rug/circuit-breaker/eth/reset` to it. Without a cookie the answer is 401 and the reset is not called. With the cookie the answer is `{ ok: true, chain: 'eth' }`, and the reset receives the same context object `startApiServer` was given.
  - The dashboard type and hook reads are unchanged (outside CHAR-06).
- **antiRugConfig.test.ts Tests 19-21:**
  - Test 20 deletes every `<CHAIN>_ANTIRUG_*` name found in `.env.example` (40) and the file's own list. It then resets modules and imports the real config with `process.exit` spied. Nothing is reported missing, `logger.fatal` is never called and `process.exit` is never called.
  - Tests 19 and 21 require exactly one `REQUIRED_ENV_VARS` declaration in a `loadRepoModules(['src'])` walk. They count its anti-rug entries (44 at HEAD, at least 32 required) and check each description literal. Both have explicit 60 s limits.
- **antiRugReason.test.ts:**
  - **Test 1:** a type-checker query over the one src/ file exporting `executeFullSell`, using `tsconfig.json`'s options. The same function reports exactly `anti-rug` missing on a temp-directory source. Explicit 60 s limit.
  - **Tests 2, 3 and 3b:** drive the real `executeFullSell` and read the private escalation's final argument:
    - anti-rug exits get 2.0, then 3.5;
    - the three other reasons get undefined;
    - the call has the shape (txBuilder, the same ctx, attempts, 3.5).
  - **Test 7:** drives a real successful `executePartialSell`. It records one `partial_sell` row, never unregisters anti-rug and never deletes the exit state.
  - A file-level `beforeAll` now does the first exit-engine import, against the 10 s hook limit (the deferred cold-import rule).
- **RED proofs:** 11 mutants, each failing exactly its expected tests with an AssertionError. Every target hash was unchanged, and `git status --porcelain src` was empty after every run.

## Task Commits

1. **Task 1 (tracer): API mount conversion, group api-mount, Test 6 rename entry:** `4d9d66e` (test). The tracer verify was re-run on the committed tree (TRACER-VERIFY-PASS) before Task 2 started.
2. **Task 2: anti-rug settings conversion, group antirug-config, three entries:** `f855a6a` (test).
3. **Task 3: exit reason conversion with the type-checker query, group reason, five entries:** `02772f4` (test).

## RED proofs

From `node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --group <name>`:
- Each group exited 0 in each of three rounds, with byte-identical RED-OK output.
- Per round: api-mount 7 to 10 s, antirug-config 10 to 14 s, reason 16 to 19 s.

```
RED-OK antirug-router-unmounted :: test/unit/api/antiRug.test.ts :: Phase 19 — src/api/server.ts mount > Test 6: startApiServer serves antiRugRoutes at /api/anti-rug with its contexts, behind authMiddleware
RED-OK antirug-router-wrong-path :: test/unit/api/antiRug.test.ts :: Phase 19 — src/api/server.ts mount > Test 6: startApiServer serves antiRugRoutes at /api/anti-rug with its contexts, behind authMiddleware
RED-OK antirug-router-no-contexts :: test/unit/api/antiRug.test.ts :: Phase 19 — src/api/server.ts mount > Test 6: startApiServer serves antiRugRoutes at /api/anti-rug with its contexts, behind authMiddleware
RED-OK antirug-entries-dropped :: test/unit/chainRegistry/antiRugConfig.test.ts :: Phase 19 plan 19-02 Task 2 — config.ts + .env.example > Test 19: REQUIRED_ENV_VARS has >= 32 entries matching /^[A-Z]+_ANTIRUG_/
RED-OK antirug-entry-required :: test/unit/chainRegistry/antiRugConfig.test.ts :: Phase 19 plan 19-02 Task 2 — config.ts + .env.example > Test 20: Every new ANTIRUG entry in REQUIRED_ENV_VARS has required: false
RED-OK antirug-entry-empty-description :: test/unit/chainRegistry/antiRugConfig.test.ts :: Phase 19 plan 19-02 Task 2 — config.ts + .env.example > Test 21: Every new ANTIRUG entry has a non-empty description
RED-OK reason-union-drops-antirug :: test/unit/exitEngine/antiRugReason.test.ts :: Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup > Reason union + gas-multiplier source assertions (Tests 1-3) > Test 1: the reason parameter type includes 'anti-rug'
RED-OK antirug-gas-dropped :: test/unit/exitEngine/antiRugReason.test.ts :: Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup > Reason union + gas-multiplier source assertions (Tests 1-3) > Test 2: when reason='anti-rug', gasMultiplier is derived from ctx.chain.antiRug.gasMultiplier
RED-OK antirug-gas-dropped :: test/unit/exitEngine/antiRugReason.test.ts :: Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup > Reason union + gas-multiplier source assertions (Tests 1-3) > Test 3b: gasMultiplier is threaded into the private escalation (Gap-1 closure + Finding A)
RED-OK gas-on-every-reason :: test/unit/exitEngine/antiRugReason.test.ts :: Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup > Reason union + gas-multiplier source assertions (Tests 1-3) > Test 3: when reason !== 'anti-rug', gasMultiplier is undefined (raw feeData; prior behavior preserved)
RED-OK multiplier-not-threaded :: test/unit/exitEngine/antiRugReason.test.ts :: Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup > Reason union + gas-multiplier source assertions (Tests 1-3) > Test 2: when reason='anti-rug', gasMultiplier is derived from ctx.chain.antiRug.gasMultiplier
RED-OK multiplier-not-threaded :: test/unit/exitEngine/antiRugReason.test.ts :: Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup > Reason union + gas-multiplier source assertions (Tests 1-3) > Test 3b: gasMultiplier is threaded into the private escalation (Gap-1 closure + Finding A)
RED-OK partial-unsubscribes :: test/unit/exitEngine/antiRugReason.test.ts :: Phase 19 — executeFullSell reason union + elevated-gas branch + unsubscribeAntiRug cleanup > unsubscribeAntiRug call sites (Tests 4-7) > Test 7: executePartialSell does NOT call unsubscribeAntiRug
```

**Reach markers:**
- The api-mount rows, antirug-entry-required and the four reason runtime rows are `vite`: Vite loaded the edited module into the worker.
- antirug-entries-dropped, antirug-entry-empty-description and reason-union-drops-antirug are `worker`: the directory walk and ts.createProgram read the edited file.

**Failure messages (each an AssertionError, matched by the row's messageIncludes):**
- api-mount: `to deeply equal { ok: true, chain: 'eth' }`.
- antirug-config:
  - `expected 22 to be greater than or equal to 32`;
  - `expected [ 'ETH_ANTIRUG_LP_REMOVAL_PCT' ] to deeply equal []`;
  - `expected [ 'ETH_ANTIRUG_CONFIRM_BLOCKS' ] to deeply equal []`.
- reason:
  - `expected [ 'anti-rug' ] to deeply equal []`;
  - `expected [ 3.5, 3.5, 3.5 ] to deeply equal [ undefined, undefined, undefined ]`;
  - `expected [ [ 'eth', 70 ] ] to deeply equal []`;
  - the two multiplier rows' messages contain `undefined`.

**Removals (AC-38):** no test was removed, so this plan has no `AC-38 removed:` line. One assertion was removed inside a converted test:
- **Test 6:** the old check that the `/anti-rug` mount comes after the `/controls` mount (`antiRugIdx > controlsIdx` in the server's text) is removed.
- **Reason:** the two prefixes do not overlap, so their order has no effect a request can show. The rest of what that test protected (the mount exists, is at `/api/anti-rug`, gets the server's contexts and sits behind authMiddleware) is now checked by a request.

| File | it() at the phase start | it() now |
|---|---|---|
| antiRug.test.ts | 15 | 15 |
| antiRugConfig.test.ts | 26 | 26 |
| antiRugReason.test.ts | 10 | 10 |

**Renamed tests (recorded in rails-test-edits.json with title_before / title_after, honoured by test-identity):**
- antiRug.test.ts: "Test 6: mounts antiRugRoutes at /api/anti-rug after the /controls mount" became "Test 6: startApiServer serves antiRugRoutes at /api/anti-rug with its contexts, behind authMiddleware". Reason: the after-/controls part is no longer asserted, and the test now runs the server.
- Every other title is unchanged, including the three describe titles that still name a file or say "source assertions" (each has a comment giving the test-identity reason).

## Files Created/Modified

- `test/unit/api/antiRug.test.ts`:
  - Test 6 as described, plus a `requestPort` helper.
  - Five stubs (helpers/positions, routes/controls, utils/db, riskManager, exitEngine) so the real server loads without a database. Tests 1-5 never touch them.
- `test/unit/chainRegistry/antiRugConfig.test.ts`: Tests 19-21 and the `requiredEnvVarEntries` lookup.
- `test/unit/exitEngine/antiRugReason.test.ts`: the type-checker helpers (`walkTs`, `exportedFunction`, `repoCompilerOptions`, `reasonLiteralMembers`), `escalationMultipliers`, Tests 1, 2, 3, 3b and 7, and the warm-import `beforeAll`.
- `scripts/red-proof-conversions.ts`:
  - MUTANTS gains groups api-mount (3), antirug-config (3) and reason (5).
  - CONVERTED_TESTS gains 9 rows.
  - CONVERTED_COUNTS gains antiRug 1, antiRugConfig 3 and antiRugReason 5.
- `.planning/audit/inputs/rails-test-edits.json`: 9 entries, one of them with title_before / title_after.
- `deferred-items.md`: one entry (see Issues).

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Measured expected set] antirug-gas-dropped also fails Test 3b**
- **Found during:** Task 3 design, confirmed by the group run.
- **Issue:** the plan names Test 2 alone. In executeFullSell, `gasMultiplier` has exactly one consumer, `submitPrivateSell(ctx, txBuilder, attempts, gasMultiplier)`, so a wrong value and a value that is not passed look the same to any behavior check. The old text tests told them apart only by the shape of the source.
- **Fix:** the row expects Tests 2 and 3b, with the reason in a comment beside it. The runner's exact-set rule confirms the result: Tests 2 and 3b failed, and Test 3 stayed green.
- **Committed in:** 02772f4.

**2. [Rule 1 - Clarity of a failure] Vitest shortened two failure messages to `Array(1)`**
- **Found during:** Task 2, the first `--group antirug-config` run, which refused antirug-entry-required and then antirug-entry-empty-description as BAD-FAILURE.
- **Issue:** both tests failed correctly with AssertionError on their mutants. But a long string inside an array prints as `[ Array(1) ]`, so the variable name was missing from the message.
- **Fix:** Test 20 lists the missing variable names, and Test 21 lists offender names (its reason moved into the assertion's label). The protection is unchanged, and no expected set changed.
- **Committed in:** f855a6a.

**3. [Plan wording] Test 6 stubs five modules the real server imports**
- **Issue:** the plan asks for the request "in the file's existing mock shape". Loading the real server would otherwise open the database module and the exit engine.
- **Fix:** the same stub shapes test/integration/api/wsPush.test.ts uses. The anti-rug router, auth and the mount stay real.

---

**Total deviations:** 3 (1 measured expected-set change, 1 Rule 1 message fix, 1 plan-wording choice). **Impact:** each converted test protects what it protected before, and the expected-set change follows from the code, not from a result. No scope change.

## Severity changes and new findings

None. Every behavior these tests protect is intact on HEAD: each control run passed, and each mutant flipped only its expected tests.
- The anti-rug router is mounted at /api/anti-rug behind auth with the server's contexts.
- No anti-rug variable is required.
- 44 anti-rug entries carry descriptions.
- The reason union includes anti-rug.
- The anti-rug multiplier reaches only anti-rug private sells.
- A successful partial sell keeps anti-rug.

The known bugs in this area (AUD-API-002, AUD-ANTIRUG-001/-003/-004/-005/-025, AUD-EXIT-014) are not touched by these assertions. No register entry changed.

## Issues Encountered (all diagnosed)

- **Strict scratch type check:** one error, TS2322, in `test/fixtures/api.fixtures.ts:12` (`honeypotChecker` is optional in the fixture but required by `ChainConfig`).
  - The fixture predates this plan, and my four files are clean.
  - No tsconfig compiles test/, so the error never surfaces anywhere (the AUD-TESTU-008 class).
  - Logged in deferred-items.md for Phase 28.
- **Shell quoting:** one splice command failed to parse in bash before it ran, so nothing was written. The pieces were re-written as files and spliced by a script.
- **Line endings:** git warns "LF will be replaced by CRLF" (`core.autocrlf=true`, AUD-OD21-001), as in 23-29 and 23-31.
- **Two "unhandled" strings in the full-run output:** they are test titles (AUD-BUY-005 and notifierRefusal), as in 23-31.

## Verification (Node 22.16.0)

**Task verifies, as written:**
- **Task 1:** Vitest on the file (15/15), `--group api-mount` (3 RED-OK) and `git status --porcelain src` empty: PASS. Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:** Vitest on the file (26/26), `--group antirug-config` (3 RED-OK) and src clean: PASS.
- **Task 3:** Vitest on the file (10/10), `--group reason` (7 RED-OK), `--check-manifest` printed `MANIFEST-OK rows 32 files 8 guards 1`, and src clean: PASS.

**Acceptance criteria:**
- None of the three files reads a named src/ or scripts/ file as text. They read `.env.example`, `tsconfig.json`, files found by a directory walk, and their own temp files.
- `git status --porcelain src scripts/vitest.in-memory-mutant.config.ts` printed nothing after each task.
- The type-checker test fails on a temp-directory source that omits anti-rug and names `{ timeout: 60_000 }`.
- Test 7 drives a real successful executePartialSell and asserts unregisterAntiRugPositionMock was not called.
- **test-identity** (`--base 8b4d3f9`, on the full-run report): 0 missing, 1 rename honoured (Test 6), dynamic mismatch 0.

**Full railed suite** (`npm test`, foreground, rails run `run-20261112T133240-15556-5d876a`, tree 02772f4):
- 199 files, 1,397 tests: 1,397 passed, 0 failed, 0 skipped, 0 todo; wall 165 s.
- By project: unit 946, integration 264, realpath 187. These match 23-31 exactly, because no test was added or removed.
- Rail ledger: `nonLoopbackAllowed` 0, `telegramAllowed` 0.

**Timing against each test's real limit** (full run; alone in brackets):

| Test | Full run (alone) | Limit |
|---|---|---|
| antiRugReason Test 1 (type-checker query) | 9.0 s (1.7 s) | 60 s |
| antiRugConfig Test 19 (directory walk) | 2.9 s (0.7 s) | 60 s |
| antiRugConfig Test 21 | 4 ms (cached walk) | 60 s |
| antiRugConfig Test 20 (real config import) | 22 ms | 5 s |
| antiRug Test 6 | 22 ms; its server import runs in beforeAll (whole file 0.9 s alone) | 5 s (hook 10 s) |
| antiRugReason Tests 2, 3, 3b, 7 | 3 to 8 ms; the exit-engine import runs in beforeAll | 5 s (hook 10 s) |

No test is at or near half its limit, so no limit changed beyond the plan's two 60 s limits.

**Repeatability:**
- Three rounds, each covering the three files together and the three groups.
- The files gave 51/51 each round, with one md5 over the sorted statuses and titles.
- Each group's RED-OK output had one md5 across the rounds.
- No `csb-red-proof-*` or `csb-23-30-reason-*` temp folder was left.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- `check-realpath-mocks`: 0 violations. `check-vi-mock-paths`: 598 calls in 269 files, 0 violations. `check-signing-census`: 23 sites, floor 23, 0 problems.
- `check.ts` partial, consolidation and triage: RESULT PASS, fail 0, pending 0. No re_audit rows were needed.
- `red-proof-conversions.ts`:
  - `--self-test`: SELF-TEST-OK cases 30.
  - `--check-manifest`: MANIFEST-OK rows 32 files 8 guards 1.
  - `--check-summaries`: see Self-Check.
- `git status --porcelain src` is empty.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-23-50 is mitigated as planned:
- Each conversion keeps its behavior.
- The one removed assertion is named with its reason.
- Each conversion is shown RED in memory, with every target hash unchanged.
- The never-compiled type assertion is replaced by a real type-checker query.

On the new surface:
- Test 6's server binds 127.0.0.1 port 0 and is closed in afterAll.
- Test 1's temp folder is under `os.tmpdir()` and removed in a `finally`.

## User Setup Required

None.

## Next Phase Readiness

- Plan 23-19 converts the last three CHAR-06 files and adds the standing AST check. That check must accept the forms used here:
  - `loadRepoModules` / `ts.createProgram` over a directory walk;
  - a local `walkTs` + `ts.createSourceFile`;
  - reads of `.env.example` and `tsconfig.json`.
- `--check-manifest` now reads rows 32 files 8 guards 1, and 23-26 requires 36 / 11 / 1.

## Self-Check: PASSED

- **Files found:** the three converted test files, scripts/red-proof-conversions.ts, rails-test-edits.json (48 entries).
- **Commits on this branch:** 4d9d66e, f855a6a, 02772f4. `git rev-list --count 8b4d3f9..HEAD` = 3 before this SUMMARY.
- **`--check-summaries` on this SUMMARY, 23-18's and 23-31's:** run immediately before the SUMMARY commit (the commit is chained on its success).
- **Clean tree:** only the operator's own `.planning/config.json` and `.planning/state.json` changes remain, modified and unstaged.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
