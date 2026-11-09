---
phase: 22-safety-rails-audit
plan: 16
subsystem: testing
tags: [safe-07, baselines, ac-28, ac-29, ac-30, nac-04, nac-08, d-13, eslint, npm-audit, vitest-list]

requires:
  - phase: 22-15
    provides: the full railed suite, the test-identity report, ESC-RAILS-01 (one test moved to the fork project)
  - phase: 22-01
    provides: phase_start_sha and the backup MANIFEST used for the live-data comparison
  - phase: 22-08
    provides: spawnRailedChild and the verify-prod-untouched wrapper
provides:
  - scripts/capture-baselines.ts with --phase before|after and --out
  - npm run baselines:capture
  - .planning/baselines/before/ (nine outputs, labelled by measured tree)
affects: [22-29, phase-26, milestone-close]

actuals:
  tokens: 126325
  tasks: 2
  commits: 2
plan_head_before: ae8232aa938c8a66bff9836a675899a83dade167
plan_head_after: 4093437a0aa588040d010190ddb4f93902bcd48e

tech-stack:
  added: []
  patterns:
    - "Pre-rail code runs only in a git archive export with one junction per node_modules entry, removed junction-first (never a recursive delete through a junction)"
    - "A plain vitest list counts a project; a file-level collection error writes no JSON, so a missing JSON is recorded as an error, never a zero count"
    - "Every baseline output names the tree it measured (phase_start, post_rails, dependency_tree)"

key-files:
  created:
    - scripts/capture-baselines.ts
    - .planning/baselines/before/meta.json
    - .planning/baselines/before/npm-ls.json
    - .planning/baselines/before/npm-audit.json
    - .planning/baselines/before/eslint-by-rule.json
    - .planning/baselines/before/eslint-by-file.json
    - .planning/baselines/before/test-counts.json
    - .planning/baselines/before/coverage-files.txt
    - .planning/baselines/before/db-hashes.json
    - .planning/baselines/before/tree-hashes.json
  modified:
    - package.json

key-decisions:
  - "22-16: pre-rail tests collected 759 unit and 216 integration from the isolated export of phase_start_sha, with no collection errors; post-rail official counts are 932 unit and 262 integration"
  - "22-16: the plan's temp-path regex matches the npm registry URL of the package named tmp; the data was left intact, the check was run with URLs removed, and the script now asserts directly that no output contains os.tmpdir()"
  - "22-16: the wrapper's --net-watch was left off because npm audit is a sanctioned outbound call inside the wrapped command, and net-watch would fail on it; the choke-point ledger and manifest gates stayed on"
  - "22-16 for Phase 26: npm ls exits 1 from three problems: ethers 6.16.0 against the 6.7.1 peer of @flashbots/ethers-provider-bundle, vitest 4.1.1 against the 4.1.2 peer of @vitest/coverage-v8, and a @emnapi/core folder holding only a nested node_modules"

patterns-established:
  - "A vitest list against a project must always pass --project; a bare list starts fork's globalSetup and Hardhat"
  - "The temp export is deleted by unlinking each junction first and asserting none remain before the recursive delete"

requirements-completed: [SAFE-07]

coverage:
  - id: D1
    description: "scripts/capture-baselines.ts writes all nine outputs from a wrapped run, labelled by measured tree"
    requirement: SAFE-07
    verification:
      - kind: other
        ref: "verify-prod-untouched wrapped run vpu-20261109T051647-384-0c661a -> capture --phase before (verdict untouched, manifest equal, ledger ok)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The export check accepts the tracked example and sentinel env files and refuses any other env file; collection refuses outside a marked export"
    requirement: SAFE-07
    verification:
      - kind: other
        ref: "fixture check through ts-node: 13 cases, FIXTURE CHECK PASS (extra env file refused at root, nested and in test/, data/ refused, repo root and inside repo refused, no marker refused, .git refused)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Determinism: two consecutive runs are byte-identical on the seven non-time-varying files"
    requirement: SAFE-07
    verification:
      - kind: other
        ref: "cmp of npm-ls, eslint-by-rule, eslint-by-file, test-counts, coverage-files, db-hashes, tree-hashes across runs vpu-20261109T051455-1884-03b671 and vpu-20261109T051545-2956-4480e2: identical; diff -r shows only meta.json captured_at and npm-audit.json advisory content"
        status: pass
    human_judgment: false
  - id: D4
    description: "--phase after loads the committed pre_rail, records its blob SHA and runs NAC-04 without re-collecting"
    requirement: SAFE-07
    verification:
      - kind: other
        ref: "wrapped run vpu-20261109T051839-20432-888b0b --phase after: pre_rail_source 2f771fb equals git rev-parse HEAD:.planning/baselines/before/test-counts.json; NAC-04 ok"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 16: Baseline Capture Summary

**SAFE-07 capture script and committed before-baselines: pre-rail counts from an isolated export (759 unit / 216 integration), post-rail official counts 932 / 262, ESLint 350/22 at phase start and 351/22 now, all deterministic and checked against the live-data manifest**

## Performance

- **Duration:** 18 min
- **Started:** 2026-11-09T05:01:02Z
- **Completed:** 2026-11-09T05:19:44Z
- **Tasks:** 2
- **Files modified:** 11 (script, package.json, nine baselines)

## Accomplishments

- Built `scripts/capture-baselines.ts` with `--phase before|after` and `--out`, added `npm run baselines:capture`, and committed the before-baselines.
- Pre-rail tests collected from an isolated `git archive` export of phase_start_sha (23a6461), with junctioned `node_modules`, no real env file, no `data/`, a scrubbed env and the rails preload.
- Every Vitest invocation ran inside `scripts/verify-prod-untouched.ts` with the backup manifest, with `--require-ledger --expect-projects unit,integration`, and every run reported verdict untouched.
- Every output is labelled by the tree it measured. The nine files include ESLint and coverage lists for both phase_start and post_rails.

## Measured baselines

| Item | phase_start | post_rails |
|------|-------------|------------|
| ESLint errors / warnings (`src`) | 350 / 22 (equals STATE.md) | 351 / 22 |
| Unit tests (`vitest list`) | 759 | 932 |
| Integration tests (`vitest list`) | 216 | 262 |
| Fork tests (static AST) | 33 | 40 |

NAC-04 holds: 932 >= 759 and 262 >= 216. There were no collection errors on either tree. Run ledger: nonLoopbackAllowed 0, telegramAllowed 0.

## Task Commits

1. **Task 1: Build the capture script and the npm script** - `e095ab5` (feat)
2. **Task 2: Prove determinism, commit the before-baselines** - `4093437` (docs)

**Plan metadata:** see the final docs commit.

## Files Created/Modified

- `scripts/capture-baselines.ts` - the capture tool (ABI-127 assert, isolated export, ESLint on both trees, NAC-08/NAC-03 self-assert, NAC-04 check).
- `package.json` - `baselines:capture` script only; dependency sections unchanged.
- `.planning/baselines/before/` - meta.json, npm-ls.json, npm-audit.json, eslint-by-rule.json, eslint-by-file.json, test-counts.json, coverage-files.txt, db-hashes.json, tree-hashes.json.

## Decisions Made

See frontmatter `key-decisions`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's check] The temp-path leak regex matched a package named `tmp`**
- **Found during:** Task 1 (first full capture)
- **Issue:** The plan's `<automated>` check tested the regex `[\\/]tmp[\\/]`. `npm ls --all --json` prints the npm registry URL of the package named `tmp` (`https://registry.npmjs.org/tmp/-/tmp-0.0.33.tgz`), which is not a path on this computer, so the check failed on correct output.
- **Fix:** The npm output was left unchanged. The verify was run with URLs removed before the regex (raw match true, URL-stripped match false, recorded in the run). The script gained a stricter direct check (`E22`): no output may contain `os.tmpdir()` in any slash style. A real leak still exits 1.
- **Files modified:** scripts/capture-baselines.ts
- **Verification:** verify run passes with URLs removed; script self-check passes on all runs.
- **Committed in:** e095ab5

**2. [Rule 2 - Missing diagnostic] Lint deltas and test-identity differences added to outputs**
- **Found during:** Task 1
- **Issue:** Raw totals alone hide which files or tests moved, and the integration count accounting (22-15 ESC-RAILS-01) must be visible rather than folded into a net figure.
- **Fix:** Added `post_rails_delta_by_rule` / `post_rails_delta_by_file` to the lint outputs, `pre_rail_not_in_post_rail` to test-counts.json (with a note pointing to the identity report), and a fork count for both trees. All additive and deterministic.
- **Files modified:** scripts/capture-baselines.ts
- **Verification:** seven-file byte comparison still identical.
- **Committed in:** e095ab5

---

**Total deviations:** 2 auto-fixed (1 plan-check false positive, 1 added diagnostics)
**Impact on plan:** No scope change. Measured data was not altered.

## Issues Encountered

Each anomaly below was diagnosed before the task was marked done:

- **`npm ls` exit 1 (3 problems):** `invalid: ethers@6.16.0` against the `6.7.1` peer of `@flashbots/ethers-provider-bundle`; `invalid: vitest@4.1.1` against the `4.1.2` peer of `@vitest/coverage-v8`; `extraneous: @emnapi/core` (the folder holds only a nested `node_modules`). All three match the known legacy-peer-deps tree, and the lockfile is byte-identical to phase_start_sha. Handed to Phase 26 dependency work.
- **ESLint delta +1 error (350 to 351):** `src/bot.ts` -1 (one fewer no-floating-promises), `src/main.ts` +1 (no-require-imports, the deliberate lock-first `require('./bot')` from 22-13), `src/utils/repoRoot.ts` +1 (no-unsafe-member-access). Entirely the rails' own `src/` changes.
- **Integration project pre/post accounting (ESC-RAILS-01):** the counts above are net figures and do not by themselves show what moved. `test-counts.json` `pre_rail_not_in_post_rail.integration` names exactly two titles absent from the integration list: `HONEY-03 ... has bytecode at deployedAddress (not 0x)`, moved to `test/fork/honeypotDeploy.eth.fork.test.ts` by the operator's ESC-RAILS-01 ruling (obligation UFV-05, Phase 25, and it has not yet run in its new file), and `Test 1 ... when run against current .env`, renamed to `... against the sentinel test env` (recorded rename in 22-15 `test-identity.json`). Fork's static count (33 to 40) includes the moved test.
- **`vitest list` semantics recorded:** it omits tests whose collected state is skipped, and any file-level collection error makes it write no JSON. Both are recorded in `test-counts.json` `list_caveat`; a missing JSON is an error, never a zero. No collection errors occurred.
- **No live-data or network stop condition fired:** the wrapper reported verdict untouched on all five runs, ledger summaries showed 0 non-loopback allows and 0 Telegram allows.

## Export refusal check (fixture, one line)

Fixture check through ts-node: example + sentinel only accepted; nested extra env file, root env file, `test/` env other than the sentinel, a `data/` folder, the repo root, inside the repo, no marker and a `.git` all refused; `collectInExport` on the repo root and on an unmarked folder refused without spawning. `FIXTURE CHECK PASS`.

## Determinism result (AC-29)

Two consecutive wrapped runs (`vpu-20261109T051455-1884-03b671`, `vpu-20261109T051545-2956-4480e2`) on the unchanged tree: `cmp` of `npm-ls.json`, `eslint-by-rule.json`, `eslint-by-file.json`, `test-counts.json`, `coverage-files.txt`, `db-hashes.json`, `tree-hashes.json` all identical. `diff -r` differed only in `meta.json` `captured_at` and `npm-audit.json` advisory ordering, both listed in `time_varying_fields`.

## Acceptance results

- Nine files produced; `pre_rail`, `post_rail`, `fork` present; `phase_start` and `post_rails` sections present; `measured_trees` present. PASS
- Export check accepts the tracked example and sentinel, refuses others. PASS
- No pre-rail collection error occurred. PASS
- `grep -c "from '../src\|require('../src" scripts/capture-baselines.ts` = 0. PASS
- `node_modules/.vite` mtime unchanged (2026-03-25 23:28:12), and the script's deep stat of the repo `.vite` tree was unchanged across the export run. PASS
- `git diff --stat 23a6461..HEAD -- package-lock.json` is empty. PASS
- `--phase after`: loads the committed `pre_rail`, records its blob SHA (`2f771fb`) as `pre_rail_source`, does not re-collect, and NAC-04 passes. PASS

## Next Phase Readiness

- Ready for 22-29: the before-baselines exist and the same script produces the after-baselines at milestone close.
- Phase 26 note: `ts-node` replacement must keep this script's ABI assert in step, and `npm ls` problems will change there.
- Plan 22-16 has no open defects.

## Self-Check: PASSED

- `scripts/capture-baselines.ts`, `package.json` and all nine files under `.planning/baselines/before/` exist.
- Commits `e095ab5` and `4093437` exist on the branch `phase-22-safety-rails-audit`.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*
