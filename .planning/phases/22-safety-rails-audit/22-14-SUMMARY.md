---
phase: 22-safety-rails-audit
plan: 14
subsystem: testing
tags: [ci, vitest, vi-mock, typescript-compiler-api, safe-06]

requires:
  - phase: 22-safety-rails-audit
    provides: verify-prod-untouched wrapper, SAFE-02 rails, spawn and fork gates
provides:
  - scripts/check-vi-mock-paths.ts (checkViMockPaths, collectSourceFiles, CLI with --root)
  - npm run check:vi-mock and the CI step "vi.mock specifier gate (SAFE-06)"
  - test/fixtures/viMockGate seeded fixtures and test/unit/viMockGate.test.ts
affects: [22-15, 22-16, 22-29, phase-26-node-upgrade]

actuals:
  tokens: 15056
  tasks: 2
  commits: 2
plan_head_before: 6ba177df5a2c5392fbc7a4745aa2df547021c4e7
plan_head_after: a1ae6932ba35dae93a470d6a0644a9e8ea9fde75

tech-stack:
  added: []
  patterns:
    - "AST gate through the installed TypeScript compiler API, finding calls by import binding"
    - "Resolver filter: a declaration file counts only with a runtime sibling"

key-files:
  created:
    - scripts/check-vi-mock-paths.ts
    - test/unit/viMockGate.test.ts
    - test/fixtures/viMockGate/
    - .planning/phases/22-safety-rails-audit/red-proofs/22-14-1-vi-mock-gate-fixtures.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-14-2-vi-mock-gate-mutation.txt
  modified:
    - package.json
    - .github/workflows/test.yml
    - test/unit/configEnvVar.test.ts
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/audit/inputs/rails-discoveries.json

key-decisions:
  - "22-14: the vi.mock gate also accepts Node built-ins and rejects declaration-only targets, because createRequire returns a bare name for built-ins and a .d.ts-only mock intercepts nothing at run time"
  - "22-14: the gate exits 2, not 0, when a scan finds no source files or no mock call, so a broken scan cannot pass as clean"

patterns-established:
  - "Deliberately broken gate fixtures live under test/fixtures/<gate>/ as *.fixture.ts and are excluded from the real scan unless --root points inside them"

requirements-completed: [SAFE-06]

coverage:
  - id: D1
    description: "AST gate fails on broken and non-literal mock specifiers and passes the real suite"
    requirement: SAFE-06
    verification:
      - kind: unit
        ref: "test/unit/viMockGate.test.ts#reports exactly the four seeded violations and nothing from the valid fixtures"
        status: pass
      - kind: unit
        ref: "test/unit/viMockGate.test.ts#passes the real suite"
        status: pass
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js scripts/check-vi-mock-paths.ts --root test/fixtures/viMockGate (exit 1, 4 violations)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CI step and npm script run the gate after the integration suite"
    requirement: SAFE-06
    verification:
      - kind: other
        ref: "npm run check:vi-mock (584 calls, 0 violations, exit 0); grep of .github/workflows/test.yml"
        status: pass
    human_judgment: false
  - id: D3
    description: "The one dead mock the gate found is corrected and registered; no test deleted or skipped"
    requirement: SAFE-06
    verification:
      - kind: unit
        ref: "test/unit/configEnvVar.test.ts (10 passed before and after the one-word fix, wrapped, verdict untouched)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mutation RED: the gate's own test fails with the checker disabled"
    requirement: SAFE-06
    verification:
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-14-2-vi-mock-gate-mutation.txt (5 failed RED, 9 passed GREEN, restored byte-exact)"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 14: vi.mock Specifier Gate Summary

**CI now fails on any vi.mock, doMock, unmock or doUnmock whose specifier does not resolve to a real module; the AST gate checked all 584 real mock calls and found one dead mock, now corrected and registered.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-11-09T04:06:30Z
- **Completed:** 2026-11-09T04:14:25Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments

- `scripts/check-vi-mock-paths.ts` reads the AST, finds mock calls by their binding to vitest's `vi`, and resolves each literal specifier through `ts.resolveModuleName` (project and Bundler options) and `createRequire`.
- The fixture run exits 1 with exactly four violations (one bare, one non-literal, two relative including the aliased `v.mock`). The real suite exits 0.
- CI runs `npm run check:vi-mock` straight after the integration suite.
- Two REDs recorded: the broken fixtures, and a mutation that disables the checker and fails five of the gate's nine tests.
- The spawn gate and fork shell-only gate still pass with the new fixtures in place.

## The dead mock the gate found

`test/unit/configEnvVar.test.ts:146` mocked `../../src/db`. That file has never existed in this repository; the database module is `src/utils/db.ts`. The mock was a silent no-op from the day the test was written (13-01, e0a0f0b).

**What the test actually exercised.** `exitEngine` loaded the real database module and opened a real SQLite file. Its single assertion, `buildExitConfig().stopLossPct === 18`, reads only `CONFIG`, so the claim it makes (env var to `CONFIG` to exit config) was genuinely proven all along.

**Measured under the rails.** With the broken specifier one run added 3 files to the temp test-DB folder (one database plus `-wal` and `-shm`). With the corrected specifier it added 0. The same 10 tests pass both ways, so no test depended on the no-op.

**Severity and routing.** Estimated S3, a test-quality defect. It does not hide a money-path bug, so nothing was escalated. Before the 22-05 and 22-08 rails this test had no tripwire between it and whatever `DB_PATH` resolved to; today those rails keep it away from `data/`. Recorded in `rails-test-edits.json` and `rails-discoveries.json` for 22-29 to register.

## Task Commits

1. **Task 1: Build the checker with fixtures and prove it** - `27f21a8` (feat)
2. **Task 2: Wire into npm and CI, add the unit test, record the REDs** - `a1ae693` (feat)

**Plan metadata:** recorded in the docs commit that carries this file.

## Files Created/Modified

- `scripts/check-vi-mock-paths.ts` - the gate and its CLI
- `test/fixtures/viMockGate/` - four broken fixtures, one aliased-valid, one valid, two plain target modules
- `test/unit/viMockGate.test.ts` - nine tests over fixtures, the real suite and temp-folder cases
- `test/unit/configEnvVar.test.ts` - one specifier corrected
- `package.json` - `check:vi-mock` script
- `.github/workflows/test.yml` - CI step after `npm run test:integration`
- `.planning/audit/inputs/rails-test-edits.json`, `rails-discoveries.json` - the dead mock, registered
- `red-proofs/22-14-1-vi-mock-gate-fixtures.txt`, `22-14-2-vi-mock-gate-mutation.txt`

## Decisions Made

- `Violation.call` keeps the source spelling (`v.mock`), so a report points at what is on the line.
- A wrong Node version exits 2, like any other run that could not check anything. Exit 1 means real violations only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Node built-ins would have failed resolution**
- **Found during:** Task 1
- **Issue:** the plan requires the resolved target to be a regular file, but `createRequire` returns a bare name such as `fs` for a built-in, and the TypeScript resolver finds none. `vi.mock('fs')`-style calls exist in the suite.
- **Fix:** `module.isBuiltin` accepts built-ins before the resolvers run.
- **Files modified:** `scripts/check-vi-mock-paths.ts`
- **Verification:** real suite exit 0; unit test "accepts Node built-ins"
- **Committed in:** `27f21a8`

**2. [Rule 2 - Missing Critical] Declaration-only targets would have passed**
- **Found during:** Task 1
- **Issue:** the TypeScript resolver can return a `.d.ts`, which is a regular file, for a path with no runtime module. A mock of it intercepts nothing, which is the failure this gate exists to catch.
- **Fix:** a declaration file counts only when its `.js`, `.mjs` or `.cjs` sibling exists.
- **Files modified:** `scripts/check-vi-mock-paths.ts`, `test/unit/viMockGate.test.ts`
- **Verification:** unit test "rejects a mock of a declaration file with no runtime module beside it"
- **Committed in:** `27f21a8`, `a1ae693`

**3. [Rule 2 - Missing Critical] Binding detection widened; empty scans refused**
- **Found during:** Task 1
- **Issue:** vitest exports the same object as `vitest`, and `vi['mock']` is the same call. Separately, a scan that sees no call would have passed silently.
- **Fix:** both forms are detected, and a scan with no source files or no mock call exits 2.
- **Files modified:** `scripts/check-vi-mock-paths.ts`, `test/unit/viMockGate.test.ts`
- **Verification:** unit test "finds the call through the vitest export name and through bracket access"; CLI runs on a no-call folder and a missing folder, both exit 2
- **Committed in:** `27f21a8`, `a1ae693`

---

**Total deviations:** 3 auto-fixed (1 bug, 2 missing critical).
**Impact on plan:** each one closes a false pass or false failure in the gate. No scope creep.

## Issues Encountered

- RESEARCH Pattern 7 counted 588 mock calls by text search. The AST finds 584 in the real suite. A separate receiver-agnostic AST sweep also found 584 outside the new fixtures, all on `vi`, so the binding check misses none; the 4 extra were text matches, not calls.
- A mistaken `source` of a GSD reference markdown file hung one shell for about 3 minutes while gathering metrics. The shell was stopped; the working tree and commits were unaffected.

## Verification Runs

Every Vitest run was wrapped by `verify-prod-untouched.ts` with `--require-ledger --expect-projects unit`. All verdicts were untouched, manifest equal, ledger ok, including the deliberate RED (child exit 1). Final wrapped run: `spawnSites`, `forkShellOnly`, `configEnvVar`, `viMockGate` and `rootFileGuard`, 5 files, 37 tests passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 22-15, the first full-suite run. The Phase 26 Node upgrade must update the ABI 127 assert in the script, as noted in its header.

## Self-Check: PASSED

All 12 created files present on disk; commits 27f21a8 and a1ae693 are ancestors of HEAD; the mutation left no edit in the working tree.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*
