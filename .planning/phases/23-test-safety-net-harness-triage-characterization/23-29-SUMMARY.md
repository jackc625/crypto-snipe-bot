---
phase: 23-test-safety-net-harness-triage-characterization
plan: 29
subsystem: testing
tags: [red-proof, in-memory-mutant, vite-plugin, vitest, fs-overlay, spawnRailedChild, ts-node, typescript-compiler-api, CHAR-06]

requires:
  - phase: 22 (plans 22-05, 22-08, 22-11)
    provides: the rails (test/rails/core.cjs, preload.cjs, setup.cjs) and the railed spawner test/rails/spawnRailedChild.ts, whose NODE_OPTIONS line the child reach extends in memory
  - phase: 22 (plan 22-13)
    provides: src/guards/directEntry.ts and test/integration/directEntryGuard.test.ts, the mechanism's proof target
  - phase: 23 (plan 23-16)
    provides: a green register (check.ts --stage triage PASS) to keep green
provides:
  - scripts/vitest.in-memory-mutant.config.ts (vitest.config.ts plus one pre plugin; switch CSB_MUTANT_SPEC with file, edits, root, ackDir, childHook, workerHook)
  - scripts/in-memory-mutant-overlay.cjs (applyEdits, ack, installOverlay)
  - scripts/red-proof-conversions.ts (runMutant, runGroup, evaluateGroup, checkManifest, checkSummaries, literalTitlePaths; the empty WIRING_MUTANTS, MUTANTS, CONVERTED_TESTS, CONVERTED_COUNTS and GUARD_MUTANTS tables; modes --self-proof, --self-test, --group, --check-manifest, --check-summaries)
affects: [23-18, 23-31, 23-30, 23-19 (fill the tables and prove each conversion RED), 23-26 (pins MANIFEST-OK rows 36 files 11 guards 1 and runs --check-summaries), phase-26 (Node upgrade must update the ABI 127 guard)]

actuals:
  tokens: 17225
  tasks: 3
  commits: 4
plan_head_before: 1d6e43f111eb6e25024b6d3f5e949bb948926319
plan_head_after: ed157f46183a4c2ea12af2c36915b70bf54b3995

tech-stack:
  added: []
  patterns:
    - "A mutant is applied in memory at three reach points (Vite transform, fs.readFileSync overlay in the worker, the same overlay preloaded into a railed child through an in-memory edit of the spawner); the file on disk is never written"
    - "Every proof run leaves a reach marker in a temp folder; a row claiming a reach with no marker is refused, so a mutant that never reached its target cannot pass as a RED"
    - "Refusals are named (NOT-APPLIED, NOT-REACHED, STAYED-GREEN, WRONG-SET, BAD-FAILURE, CONTROL-FAILED, HASH-CHANGED), and --self-proof shows each one firing on a real test"
    - "Manifest and summary rules are pure functions over tables and file contents; each self-test case compares the exact set of problem codes, so a case cannot pass for the wrong reason"

key-files:
  created:
    - scripts/vitest.in-memory-mutant.config.ts
    - scripts/in-memory-mutant-overlay.cjs
    - scripts/red-proof-conversions.ts
  modified: []

key-decisions:
  - "mech-vite edit changed from the plan: the plan's `if (mainFile === undefined) return true;` makes the guard's own import-time call refuse inside a Vitest worker (require.main is undefined there), so the whole file dies with process.exit and no test fails on an assertion. The row uses `return canonical(entryFile) !== canonical(mainFile);`, which fails only the named test."
  - "mech-compile-error uses a type error (TS2352, `REFUSAL as number`) instead of broken syntax. A syntax error would also break Vite's load of the same module in the worker, so the test file would fail to load and the child would never run. The type error is stripped by Vite and rejected only by the type-checking npx ts-node child, which is the case to refuse. Confirmed outside Vitest: the child prints TSError TS2352 at src/guards/directEntry.ts(43,30)."
  - "Contract for the conversion plans: each failure message must start with AssertionError, contain messageIncludes, and mention none of Test timed out, SyntaxError, TSError, Unable to compile. A file that fails outside any test appears in failed as `<file error> <test file>`, so it can never match an expected set. `only` is passed as -t, which Vitest reads as new RegExp, so ( ) [ ] . * + ? in titles must be escaped; an `only` that selects nothing is refused STAYED-GREEN with 'no test was selected'."
  - "Measured: root test.setupFiles run before each project's own, so in a worker the overlay installs first and the rails setup wraps it; the rails still check every path, the target included, before the overlay edits the text. In a child the overlay loads after the rails preload, as the plan required."
  - "Summary line form for --check-summaries: after trimming, removing a leading list marker and wrapping backticks, a line must equal `RED-OK <mutant> :: <testFile> :: <title>`; a removal must read `AC-38 removed: <baseTitle>` alone or followed by ' — reason', ' - reason' or ' (reason)', so a longer title cannot satisfy a shorter one. WIRING_MUTANTS expected entries may be '22', 'Test 22' or 'Test 22:', matched against the `Test NN:` prefix of the row's last title level."

patterns-established:
  - "In-memory RED proof: never edit src/ or scripts/ for a proof; hash every target before and after, and require git status --porcelain -- src to be empty after every run"

requirements-completed: [CHAR-06]

coverage:
  - id: D1
    description: "A named mutant applied in memory as Vite loads src/guards/directEntry.ts fails exactly the named test with an assertion, the same test passes with no mutant, and the file's SHA-256 is unchanged (mech-vite)"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --self-proof (RED-OK mech-vite)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The same mechanism reaches a worker's own file read (mech-worker on test/unit/codeQuality.test.ts, worker marker) and a real npx ts-node railed child (mech-child on test/integration/directEntryGuard.test.ts, child marker), with test/rails and vitest.config.ts unchanged on disk"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "scripts/red-proof-conversions.ts --self-proof (RED-OK mech-worker, RED-OK mech-child); git diff --exit-code -- test/rails vitest.config.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The runner refuses the five ways a proof could be empty, each with its named reason: NOT-APPLIED, NOT-REACHED, STAYED-GREEN, WRONG-SET, BAD-FAILURE (a child that failed to compile while the same test still failed)"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "scripts/red-proof-conversions.ts --self-proof (5 REFUSED-AS-EXPECTED lines, SELF-PROOF-OK rows 8)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Manifest, guard and summary rules reject each listed bad table and summary and accept complete tables with no guard and with one (guards 1, rows unchanged)"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "scripts/red-proof-conversions.ts --self-test (SELF-TEST-OK cases 30)"
        status: pass
    human_judgment: false
  - id: D5
    description: "With the conversion tables empty, --check-manifest prints MANIFEST-OK rows 0 files 0 guards 0"
    requirement: CHAR-06
    verification:
      - kind: other
        ref: "scripts/red-proof-conversions.ts --check-manifest"
        status: pass
    human_judgment: false

duration: 28min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 29: In-Memory Mutant Mechanism and RED-Proof Runner Summary

**A named mutant applied only in memory, reaching Vite-loaded modules, a worker's file read and a real railed `npx ts-node` child, with a runner that names seven refusals and is shown refusing each of the five ways a proof could be empty**

## Performance

- **Duration:** 28 min
- **Started:** 2026-11-12T04:37:10Z
- **Completed:** 2026-11-12T05:05:10Z
- **Tasks:** 3 (plus one follow-up fix commit)
- **Files created:** 3 (src/ and every other file unchanged)

## Accomplishments

- `scripts/vitest.in-memory-mutant.config.ts` extends `vitest.config.ts` with one `pre` plugin. It does nothing unless `CSB_MUTANT_SPEC` is set, and it writes no file; its on-disk module cache is pinned off.
- `scripts/in-memory-mutant-overlay.cjs` overlays `fs.readFileSync` for exactly one path. The read still goes through the function it wrapped, so a rail still decides it. The overlay's only write is a reach marker inside the runner's temp folder.
- `scripts/red-proof-conversions.ts` adds `runMutant`, `runGroup` and the empty conversion tables, plus the `--group`, `--check-manifest`, `--check-summaries`, `--self-test` and `--self-proof` modes.
- Proven on real tests this phase does not convert:
  - 3 RED-OK lines, one per reach.
  - 5 negative rows, each refused with its named reason.
  - 30 rule cases.
  - Every target hash is unchanged, and `git status --porcelain src` is empty after every run.

## Task Commits

1. **Task 1: apply one named mutant in memory as Vitest loads a module** - `0d57fb0` (feat)
2. **Task 2: reach a worker's file read and a railed child** - `d2b5805` (feat)
3. **Task 3: group, manifest and summary modes; the runner refuses an empty proof** - `acc6ccb` (feat)
4. **Follow-up: name the cause when a row's `only` selects no test** - `ed157f4` (fix)

## RED proofs (this plan's own mechanism rows)

```
RED-OK mech-vite :: test/integration/directEntryGuard.test.ts :: direct-entry guard > isDirectEntry compares canonical files
RED-OK mech-worker :: test/unit/codeQuality.test.ts :: INFRA-01: no console.log/warn/error in src/ production code > finds zero console.error calls in src/ (excluding scripts/)
RED-OK mech-child :: test/integration/directEntryGuard.test.ts :: direct-entry guard > a direct start refuses before any later import runs
REFUSED-AS-EXPECTED mech-not-applied NOT-APPLIED: src/guards/directEntry.ts: [in-memory mutant] find does not occur: "this statement does not occur in src/guards/directEntry.ts;"
REFUSED-AS-EXPECTED mech-not-reached NOT-REACHED: no child marker (markers: ["vite"]); exit 1, failed ["direct-entry guard > isDirectEntry compares canonical files"]
REFUSED-AS-EXPECTED mech-stayed-green STAYED-GREEN: exit 0, 1 passed
REFUSED-AS-EXPECTED mech-wrong-set WRONG-SET: failed ["direct-entry guard > isDirectEntry compares canonical files"], expected ["direct-entry guard > a direct start refuses before any later import runs"]
REFUSED-AS-EXPECTED mech-compile-error BAD-FAILURE: direct-entry guard > a direct start refuses before any later import runs: message lacks "expected '' to contain 'Refusing to start'": AssertionError: expected 'C:\Users\jackc\WebstormProjects\crypt…' to contain 'Refusing to start'
SELF-PROOF-OK rows 8
```

These are the mechanism's own rows. They name no conversion, and `--check-summaries` does not read them.

## Files Created/Modified

- `scripts/vitest.in-memory-mutant.config.ts` - the mutant config. It reaches modules three ways:
  - **vite:** edits the target module as it loads and records a `vite` marker.
  - **worker:** puts `workerHook` in root `test.setupFiles`.
  - **child:** when loading `test/rails/spawnRailedChild.ts`, adds one more `parts.push('--require <childHook>')` after `parts.push(...nodeOptions);`.
- `scripts/in-memory-mutant-overlay.cjs` - `applyEdits` (LF the text; each find must occur exactly once), `ack` (marker folder must be under `os.tmpdir()`), and `installOverlay` (string or Buffer to match the caller's encoding, then `syncBuiltinESMExports`; installing the same spec twice is a no-op).
- `scripts/red-proof-conversions.ts` - the runner, the rules, the tables and the CLI. Exit 0 means pass, 1 a refusal or a broken rule, 2 bad arguments or an internal error.

## Notes for plans 23-18, 23-31, 23-30 and 23-19

- **Table rows:** use the row shapes in the plan's `<interfaces>`. The TypeScript types are `MutantRow`, `WiringMutantRow`, `ConvertedTestRow` and `GuardMutantRow`.
- **`only` is a regular expression.** It is passed as `-t`, and Vitest reads it with `new RegExp`. Escape `( ) [ ] . * + ?`; for example, test (1) needs `\(1\) starts the bot`. A row whose `only` selects nothing is refused STAYED-GREEN with "no test was selected".
- **Failure messages:** each must start with `AssertionError`, contain `messageIncludes`, and mention none of `Test timed out`, `SyntaxError`, `TSError` or `Unable to compile`. Otherwise the row is refused BAD-FAILURE.
- **File errors:** a file that fails outside any test (a load error, `process.exit`, a crash) appears in `failed` as `<file error> <test file>`, so it can never match an expected set.
- **Edits:** they apply in order, and each find is checked against the text after the edits before it. This is how a block comment opened by one edit and closed by a second works (23-30 `antirug-entries-dropped`).
- **Markers:** every run installs all three reach points. A row only has to show a marker for the reach it claims; markers for other reaches may also appear.
- **WIRING_MUTANTS:** `expected` may be written `'22'`, `'Test 22'` or `'Test 22:'`, and is matched against the `Test NN:` prefix of the row's last title level.
- **Summary lines** (for `--check-summaries`):
  - After trimming, and after removing a leading list marker and wrapping backticks, a line must equal `RED-OK <mutant> :: <testFile> :: <title>`.
  - A removal reads `AC-38 removed: <baseTitle>`, alone or followed by ` — reason`, ` - reason` or ` (reason)`.

## Decisions Made

See `key-decisions` in the frontmatter. The two row changes are also recorded under Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's proof row] The mech-vite edit kills the whole test file instead of failing one test**
- **Found during:** Task 1 (first manual run of the config).
- **Issue:** with the planned edit, the guard's top-level `refuseIfDirectEntry(...)` call refuses at import. In a Vitest worker `require.main` is undefined, so `isDirectEntry(entry, undefined)` returned true. The run printed the refusal text (so the mutant reached the module), and the file failed with "process.exit unexpectedly called with 1" before any test ran.
- **Fix:** the row edits `return canonical(entryFile) === canonical(mainFile);` to `!==`. That changes only calls with both paths defined, so the named test fails with `AssertionError: expected false to be true`, and the no-mutant control passes.
- **Files modified:** scripts/red-proof-conversions.ts (row and an inline comment with the reason).
- **Committed in:** 0d57fb0.

**2. [Rule 1 - Bug in the plan's proof row] mech-compile-error uses a type error, not broken syntax**
- **Found during:** Task 2 design, confirmed in Task 3.
- **Issue:** the plugin edits the same module in the worker (the test imports `isDirectEntry`). A syntax error there would fail the test file at load, and the child would never run, so the row would show a file error rather than "a child that failed to compile while the same test still fails".
- **Fix:** `process.stderr.write(REFUSAL as number);`. Vite strips the cast; the type-checking `npx ts-node` child rejects it with TS2352. Vitest truncated the failure message before the error name (`'C:\Users\jackc\WebstormProjects\crypt…'`), and `messageIncludes` still caught it, which is the case the plan describes. Confirmed by running the fixture once outside Vitest with the rails preload and the same hook: `TSError: ⨯ Unable to compile TypeScript`, `src/guards/directEntry.ts(43,30): error TS2352`, and a `child` marker.
- **Files modified:** scripts/red-proof-conversions.ts.
- **Committed in:** acc6ccb.

**3. [Rule 2 - Missing critical check] Failures must also be assertion failures**
- **Found during:** Task 2.
- **Issue:** the plan's Task 2 list checks `messageIncludes` and four forbidden substrings. The plan's own truth, though, is "the failures must be assertion failures on exactly the expected tests". A thrown TypeError, for example, could contain both substrings without being an assertion.
- **Fix:** each failure message must also start with `AssertionError`. Two more rules close related gaps: a non-zero exit with no failed test is BAD-FAILURE, and a missing JSON report is BAD-FAILURE.
- **Files modified:** scripts/red-proof-conversions.ts.
- **Committed in:** d2b5805.

**4. [Rule 2 - Clarity of a refusal] A row whose `only` selects no test**
- **Found during:** closing checks.
- **Issue:** Vitest reads `-t` with `new RegExp`, so a title with `(1)` given unescaped selects nothing. The run exits 0 with 0 passed. It was already refused STAYED-GREEN, but the reason read like a mutant with no effect.
- **Fix:** the detail now says no test was selected and that `only` is a regular expression; the field's doc comment says so too. The refusal set is unchanged, and the self-proof and self-test output are byte-identical to the earlier runs.
- **Files modified:** scripts/red-proof-conversions.ts.
- **Committed in:** ed157f4.

**5. [Rule 3 - Blocking] `Plugin` type imported from `vitest/config`, not `vite`**
- **Found during:** Task 1 type-check.
- **Issue:** vite 8's types resolve only under bundler module resolution, and the repo uses `node`.
- **Fix:** import the type from `vitest/config`, which re-exports it from vite.
- **Committed in:** 0d57fb0.

---

**Total deviations:** 5 (2 Rule 1 on the plan's own proof rows, 2 Rule 2, 1 Rule 3). **Impact:** every row still proves what the plan says it proves, and each change makes the runner stricter or its refusals clearer. No scope change. src/ and test/ are unchanged.

## Severity changes and new findings

None. No bug was found in src/ or scripts/, and the register is unchanged.

## Issues Encountered (all diagnosed)

- **Probe script bug during Task 2:** my first manual probe wrote a hook file with a literal newline inside a string. Vite then reported a `.cjs` file it could not parse. The cause was the probe, not the mechanism; once fixed, both reaches worked.
- **Diagnostic `NODE_OPTIONS` lost its backslashes:** Node unescapes inside quotes, which is why the spawner uses `JSON.stringify`. The diagnostic was re-run with forward-slash paths.
- **Strict `checkJs` on the overlay** reports only implicit-`any` errors, which any untyped plain JS gets; the repo's other `.cjs` rails files are not type-checked at all. With `noImplicitAny` and `noImplicitThis` relaxed for that pass, the overlay type-checks clean. The two `.ts` scripts were also checked fully strict, and are clean.
- **`check.ts --stage final`:** 112 FAILs (109 at 23-17). The 3 new ones are missing ledger rows in ledger/SCRIPTS.json for this plan's three files. That is the same out-of-scope bookkeeping kind as every earlier Phase 23 plan; the phase gates are partial, consolidation and triage.
- **Line endings:** git warns that the LF files will be CRLF on the next checkout (`core.autocrlf=true`, AUD-OD21-001). `applyEdits` converts both the text and each find to LF, so a CRLF working copy applies the same way. The plan's own measurement was on the CRLF tree.

## Verification (Node 22.16.0)

**Task verifies, each run as written:**
- **Task 1:** `--self-proof` and `git status --porcelain src` empty: PASS. Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:** `--self-proof`, `git diff --exit-code -- test/rails vitest.config.ts` and `git status --porcelain src` empty: PASS.
- **Task 3:** `--self-test` printed `SELF-TEST-OK`, `--self-proof` printed `SELF-PROOF-OK rows 8`, `--check-manifest` printed `MANIFEST-OK rows 0 files 0 guards 0`, and `git status --porcelain src` was empty: PASS.

**Acceptance criteria:**
- `grep -vE '^\s*//' scripts/vitest.in-memory-mutant.config.ts | grep -cE 'writeFile|renameSync|unlinkSync|rmSync'` prints 0.
- `mech-child` left a `child` marker.
- `git status --porcelain src scripts/vitest.in-memory-mutant.config.ts scripts/in-memory-mutant-overlay.cjs` prints nothing after the commits.
- No `csb-red-proof-*` temp folder is left after any run.

**Self-test cases (30):**
- Complete tables pass, with no guard and with one guard (rows 3, files 1, guards 0 then 1).
- Manifest rules: missing mutant; neither outcome; both outcomes; empty removed reason; duplicate name; duplicate name across the two tables; find 0 times; find twice; unnamed mutant; count differs; count for a file with no rows; mutant not expecting the row; mutant in another file; wiring Test NN differs.
- Summary rules: missing RED-OK line; missing AC-38 line; AC-38 line only for a longer title.
- Guard rules: missing mutant; two guard rows; mutant also named by a row; expected not `[guardedTitle]`; misspelled in both guard and expected (caught only by the AST); a skipped test; under a `describe.each` level; a converted row's title; `convertedTitle` not a row of the file; empty reason; summary missing the guard's RED-OK line.

**Full railed suite** (`npm test -- --reporter=json` on the acc6ccb tree; rails run `run-20261112T045515-1880-e9e88e`):
- 199 files, 1,396 tests: 1,396 passed, 0 failed, 0 skipped, 0 todo, wall 160 s.
- By project: unit 946, integration 263, realpath 187.
- Rails ledger: `nonLoopbackAllowed` 0, `telegramAllowed` 0.
- The two "unhandled" strings in the output are test titles. The `RAIL_NOTIFIER_REFUSED` warnings come from the rail tests' own deliberate refusals.
- The final commit, ed157f4, changes only a refusal message in a script no test loads.
- This plan adds no test, so the half-limit timing rule has nothing to apply to. The proof runs take 3 to 4 s each.

**Repeatability:** three runs each of `--self-proof` (22, 19 and 20 s), `--self-test` and `--check-manifest`, all exit 0. The output of each mode was byte-identical across its runs (md5), and identical again after ed157f4.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- Scratch tsconfigs extending the repo's: the two `.ts` scripts strict, and all three files with `checkJs`: exit 0.
- `check-realpath-mocks`: 0 violations. `check-vi-mock-paths`: 591 calls in 267 files, 0 violations.
- `check.ts` partial, consolidation and triage: RESULT PASS, fail 0, pending 0, re-run after the last commit. No `re_audit` rows were needed.
- `git status --porcelain src` is empty.

## Known Stubs

None. The five conversion tables are empty by design: plans 23-18, 23-31, 23-30 and 23-19 fill them, and plan 23-26 requires `MANIFEST-OK rows 36 files 11 guards 1`, so empty tables can never pass there.

## Threat Flags

None beyond the plan's threat model:
- T-23-46: the spawner is edited only in memory, under the separate config, only with `CSB_MUTANT_SPEC` set. The rails preload stays first, and `test/rails` is unchanged on disk.
- T-23-49: covered by the reach markers, the named refusals and the self-proof negatives.
- T-23-53: covered by the guard rules and their self-test cases.

The runner starts Vitest itself the way `npm test` does (the Vitest main process is deliberately not railed; 22-08). Its only writes are temp folders under `os.tmpdir()`.

## User Setup Required

None.

## Next Phase Readiness

- Plans 23-18, 23-31, 23-30 and 23-19 can add their rows and run `--group <name>` (for 23-18, its own script calls `runMutant`). Read "Notes for plans 23-18, 23-31, 23-30 and 23-19" first, especially the `only` regex rule.
- Plan 23-26 can run `--check-manifest` and `--check-summaries`.

## Self-Check: PASSED

- **Files found:** scripts/vitest.in-memory-mutant.config.ts, scripts/in-memory-mutant-overlay.cjs, scripts/red-proof-conversions.ts.
- **Commits found on this branch:** 0d57fb0, d2b5805, acc6ccb, ed157f4 (`git rev-list --count 1d6e43f..HEAD` = 4 before this SUMMARY).
- **Clean tree:** only the operator's own `.planning/config.json` and `.planning/state.json` changes remain, modified and unstaged.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
