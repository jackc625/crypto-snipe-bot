---
phase: 23-test-safety-net-harness-triage-characterization
plan: 17
subsystem: testing
tags: [signing-census, typescript-compiler-api, withNonceLock, ci-gate, git-history, vitest, spawnRailedChild]

requires:
  - phase: 22 (plan 22-26)
    provides: .planning/audit/tools/signing-census.ts (the type-aware census, 31 self-test cases), signing-sites-head.json (N = 23), manual-inventory-head.json (the two auditor exclusions), ESC-CENSUS-01
  - phase: 23 (plan 23-13)
    provides: AUD-BUY-007 and AUD-SCRIPTS-002 confirmed and named as the census exceptions (1 src site, 12 script sites)
  - phase: 23 (plan 23-16)
    provides: a green register (check.ts --stage triage PASS) to keep green
provides:
  - scripts/check-signing-census.ts (gate on the working tree; --self-test, --print, --check-floor-history)
  - scripts/signing-census-exceptions.json (floor 23, 9 unlocked rows totalling 13 sites, 2 excluded rows)
  - npm run check:census and the CI step "Signing census gate (CHAR-04)"; the test job checks out with fetch-depth 0
  - test/unit/signingCensusGate.test.ts (the self-test in a railed child)
affects: [phase-24 (AUD-BUY-007 fix must update the list and floor), phase-29 (card SCRIPTS-01 / HYG-03), 23-25 (commit check relies on fetch-depth 0), phase-26 (Node upgrade must update the ABI guard)]

actuals:
  tokens: 35900
  tasks: 3
  commits: 4
plan_head_before: 00d5ef1ea0e9f2a8876ebcbf4b5351db42abf407
plan_head_after: 515d8e2804e43903d6d760eca47c9d01f88e43d5

tech-stack:
  added: []
  patterns:
    - "Gate exception keyed on file|enclosing|call plus a count, never a line number; the listed set must equal the found set by key and count, so a surplus and a stale entry both fail"
    - "Every self-test case runs the whole gate on its own temp project and compares the set of problem codes exactly, so a case cannot pass for the wrong reason"
    - "A decision reference must resolve to a record whose own id matches and whose items, resolved_items or findings list the entry's finding"
    - "History check over git: argument-array calls only, --full-history, a lowering is measured against every parent, a shallow clone is refused (exit 2), never passed"

key-files:
  created:
    - scripts/check-signing-census.ts
    - scripts/signing-census-exceptions.json
    - test/unit/signingCensusGate.test.ts
  modified:
    - package.json
    - .github/workflows/test.yml

key-decisions:
  - "Exception rows: AUD-SCRIPTS-002's 12 script sites as 8 rows citing decision_ref [ESC-SCRIPTS-01, OD-68]; AUD-BUY-007's tokenSafety simulateSell approve as 1 row citing [ESC-CENSUS-01]. decision_ref is an array; every listed record must resolve and cover the finding"
  - "An excluded row may match only a contract call whose ABI mutability the census could not read (unresolved or not-in-abi), and must cite a manual-inventory site that excludes the same file and call; anything else fails as excluded-state-changing or excluded-evidence (T-23-22)"
  - "The gate also fails a .ts file under src/ or scripts/ that the census program does not include (a narrowed tsconfig include would otherwise hide signing sites), and refuses a program holding .env or a data/ file"
  - "Floor history: a commit lowers the floor when its floor is below that of every parent that has the file; it must name an AUD- ID registered under .planning/audit/findings/. Deleting the exceptions file fails, so the floor cannot be reset by delete and re-add"
  - "For Phase 24: when the AUD-BUY-007 fix removes simulateSell, the gate will fail with stale-unlocked and below-floor until that commit removes the src/utils/tokenSafety.ts row and lowers floor to 22 with AUD-BUY-007 in its message. The same applies to each AUD-SCRIPTS-002 row when Phase 29 settles card SCRIPTS-01"

patterns-established:
  - "Promoting an audit tool into scripts/: copy, keep the analysis byte-for-byte, make it self-contained, keep the original as the audit record"

requirements-completed: [CHAR-04]

coverage:
  - id: D1
    description: "The census runs as a standing gate on the working tree: 23 transaction-signing sites (10 locked, 13 unlocked and listed, 0 unknown), 2 auditor exclusions, floor 23, exit 0"
    requirement: CHAR-04
    verification:
      - kind: other
        ref: "npm run check:census (Node 22.16.0): 23 sites, 0 problems, exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every failure the census must catch is shown by a deliberate example: AC-32, AC-33 (23 passes, 22 fails), AC-34 (four history cases and the shallow refusal), AC-35, AC-36, unknown lock (F3), missing / non-covering / missing-record decision refs (AC-53), flag 7"
    requirement: CHAR-04
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js scripts/check-signing-census.ts --self-test: SELF-TEST PASS 54 of 54 cases (31 census analysis + 23 gate)"
        status: pass
      - kind: unit
        ref: "test/unit/signingCensusGate.test.ts#exits 0, the 31 Phase 22 analysis cases pass and every gate case passes"
        status: pass
    human_judgment: false
  - id: D3
    description: "CI runs the census and the floor history in the test job with full git history"
    requirement: CHAR-04
    verification:
      - kind: other
        ref: "workflow YAML parsed: test job checkout with fetch-depth 0; step 'Signing census gate (CHAR-04)' after the real-path mock-list gate runs npm run check:census and npm run check:census -- --check-floor-history"
        status: pass
    human_judgment: true
    rationale: "The step has not run on GitHub Actions yet (nothing is pushed in this plan); its first CI run on Linux is the proof that the commands, the full-depth checkout and the Linux path handling behave as they do locally"
  - id: D4
    description: "AC-53 judgment: no signing site is on the exception list without an operator decision ID"
    requirement: CHAR-04
    verification:
      - kind: other
        ref: "gate check: every unlocked row's decision_ref resolves (ESC-SCRIPTS-01 items, OD-68 findings, ESC-CENSUS-01 resolved_items) and covers its finding"
        status: pass
    human_judgment: true
    rationale: "SPEC lists AC-53 as a judgment-tier prohibition: a reviewer confirms the list changes; the gate enforces the reference mechanically"

duration: 29min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 17: Standing signing census Summary

**The Phase 22 type-aware signing census now runs as `npm run check:census` and as a CI step. It fails on a new unlocked signing site, on a listed exception that was fixed or removed, on an unknown lock status, below a floor of 23 signing sites, or on an empty scan. A separate history mode refuses any commit that lowered the floor without naming a registered finding.**

## Performance

- **Duration:** 29 min
- **Started:** 2026-11-12T04:00:23Z
- **Completed:** 2026-11-12T04:29:27Z
- **Tasks:** 3, plus one timing commit
- **Files:** 5 (3 created, 2 modified)

## Accomplishments

**Working-tree result (Node 22.16.0):**
- 23 transaction-signing sites: 10 locked, 13 unlocked and listed, 0 unknown.
- 2 sites excluded by the auditor rows, 24 excluded by the census itself, 1 message signature (`flashbots.ts:102`, never a violation).
- 71 src/ files and 22 scripts/ files in the program; 0 problems.

**Before exclusions, the raw census matches RESEARCH F3 exactly:** N = 25 (10 locked, 14 unlocked, 1 unknown). The two extra sites both have mutability `unresolved`, which is why they can be excluded:
- `scripts/addLiquidity.ts main contract.getPair`
- `src/bot.ts maybeApproveForChain contract.allowance`

**The exception file:**
- `floor: 23`.
- 9 `unlocked` rows, 13 sites in total:
  - AUD-SCRIPTS-002: 12 script sites in 8 rows, citing ESC-SCRIPTS-01 and OD-68.
  - AUD-BUY-007: 1 row, citing ESC-CENSUS-01.
- 2 `excluded` rows, citing `manual-inventory-head.json`.
- Sorted by key; the gate enforces the order.

**The self-test:** 54 of 54 cases.
- The 31 Phase 22 analysis cases are unchanged.
- 23 gate cases, each running the whole gate on its own temp project or throwaway git repo.

**CI:** the `test` job now checks out with `fetch-depth: 0` and runs both the census and the floor history.

## Task Commits

1. **Task 1: Promote the census and prove it on the working tree** - `f742380` (feat)
2. **Task 2: Prove every failure by deliberate example; floor history** - `c34846d` (feat)
3. **Task 3: Wire into npm and CI with full history** - `77b5932` (chore)
4. **Timing: wrapper limits from measured times** - `515d8e2` (test)

## Files Created/Modified

- `scripts/check-signing-census.ts` (2380 lines). Lines 1 to about 1060 hold the Phase 22 analysis, unchanged: the `Census` class, `assemble` and the 31 fixtures. Then the gate:
  - `parseExceptions`, `evaluateGate`, `resolveRecord`;
  - `floorHistory` and its CLI mode;
  - the gate self-test fixtures;
  - the CLI.
- `scripts/signing-census-exceptions.json`: the floor and the named list.
- `test/unit/signingCensusGate.test.ts`: runs `--self-test` through `spawnRailedChild('npx', ['ts-node', ...])`. It asserts exit 0, the analysis line, each of the 23 gate case lines and the total.
- `package.json`: `check:census`.
- `.github/workflows/test.yml`: `fetch-depth: 0` on the `test` job's checkout, and the census step after the real-path mock-list gate. The other jobs are unchanged.

**Original:** `.planning/audit/tools/signing-census.ts` is unchanged. `git status --porcelain` on it is empty, and its blob is still `8c58ee9`.

## The gate's cases (self-test output names)

| Case | Proves | Result |
|---|---|---|
| AC-33-exactly-23-sites-passes | 20 locked + 3 listed unlocked + 1 excluded read → 23, no problem | passes |
| AC-33-22-sites-fails | one locked site fewer | below-floor |
| AC-32-new-unlocked-site-in-src-and-scripts-fails | a new unlocked site in src/ and one in scripts/ | surplus-unlocked, one per file |
| AC-35-listed-exception-removed-fails | the listed site deleted from the code | stale-unlocked |
| AC-35-listed-exception-fixed-fails | the listed site wrapped in withNonceLock | stale-unlocked |
| AC-35-listed-count-above-the-code-fails | a row's count above the code's | stale-unlocked |
| AC-36-no-files-fails / AC-36-no-sites-fails | an empty src/ and scripts/; files with no signing site | no-files / no-sites |
| F3-unknown-lock-status-fails | a callback the census cannot follow | unknown-lock |
| F3-stale-exclusion-fails | an excluded row's count wrong | stale-excluded |
| AC-53-missing-decision-ref-fails | a row with no decision_ref | missing-decision-ref |
| AC-53-decision-record-not-covering-finding-fails | a real record (OD-91) that lists another finding | decision-does-not-cover |
| AC-53-decision-record-not-found-fails | ESC-NOPE-99 | decision-not-found |
| AC-53-finding-not-registered-fails | finding_id with no findings record | finding-not-found, decision-does-not-cover |
| T-23-22-excluding-a-signing-site-fails | a `sendTransaction` moved to excluded | excluded-state-changing, excluded-evidence, surplus-unlocked |
| exceptions-file-unsorted-fails | rows out of key order | bad-exceptions-file |
| file-outside-tsconfig-include-fails | a src/ file the tsconfig does not include | file-not-audited |
| flag7-never-opens-env-or-data | checkout-shaped fixture with .git, .env, data/bot.db, data/evil.ts: about 970 recorded reads and listings, none of .env or data/; the recorder must see the fixture sources | passes |
| AC-34-floor-drop-naming-its-finding-passes | 23 → 24 → 23 with AUD-FIX-001 named | passes |
| AC-34-floor-drop-without-a-finding-fails | then 23 → 22 with no ID | floor-lowered-unnamed |
| AC-34-floor-drop-naming-an-unregistered-finding-fails | 23 → 22 naming AUD-NOPE-999 | floor-lowered-unnamed |
| AC-34-deleting-the-exceptions-file-fails | `git rm` of the list | history-bad-version |
| AC-34-shallow-clone-refused | the `--check-floor-history` mode on a `--depth 1` clone | exit 2 |

**Proofs that the cases bite.** Each mutant was applied to the working copy only; the file was restored byte-identical each time (`git hash-object`):
- **Flag 7, census reads .env:** the flag7 case fails with "opened or listed .env".
- **Flag 7, recorder disabled:** the flag7 case fails with "the recorder ... proves nothing".
- **Decision coverage skipped:** the two AC-53 coverage cases fail.
- **Unknown lock ignored:** the F3 case fails.
- **Floor check off by one:** AC-33-22 fails.
- **History accepts any AUD- ID:** the unregistered-finding case fails.

**Real repo:**
- `--check-floor-history`: 1 commit (`f742380`, floor 23), 0 problems, exit 0.
- A real `git clone --depth 1` of this branch running the committed script's history mode exits 2 with "is a shallow clone".

## Decisions Made

See `key-decisions` in the frontmatter. The two for later phases:

- **Phase 24:** when the AUD-BUY-007 fix removes `simulateSell`, the gate fails with stale-unlocked and below-floor. That same commit must:
  - remove the `src/utils/tokenSafety.ts` row;
  - set `floor` to 22;
  - name AUD-BUY-007 in its message.
- **Phase 29:** the same applies to the AUD-SCRIPTS-002 rows (card SCRIPTS-01).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Extra checks for the T-23-22 threat ("exception list quietly growing") and for scans that miss files**
- **Found during:** Tasks 1 and 2.
- **Issue:** As planned, an `excluded` row could hide any signing site behind a free-text reason. A narrowed tsconfig include could also drop src/ files from the program without notice.
- **Fix:** Four extra checks:
  - an excluded row may match only a contract call with unreadable mutability, and must cite a matching manual-inventory exclusion;
  - every `finding_id` must be registered under `.planning/audit/findings/`;
  - every .ts file under src/ and scripts/ must be in the program;
  - in the history, deleting the list fails.
  - Each has its own self-test case.
- **Files:** scripts/check-signing-census.ts. **Commits:** f742380, c34846d.

**2. [Rule 1 - Bug] `evaluateGate` wrote to the census result's own site objects**
- **Found during:** Task 2 (before any case reused a run).
- **Issue:** The Task 1 code marked the census result's sites as auditor-excluded in place. A second evaluation of the same run would then see those exclusions as stale.
- **Fix:** The gate works on copies and returns them; `--print` renders the copies.
- **Commit:** c34846d.

**3. [Timing rule] Wrapper time limits differ from the plan's `timeoutMs: 110000`**
- **Found during:** the full railed run.
- **Measured:** the self-test child took 59.7 s, 54 percent of the planned 110 s child limit. Alone it takes 23 s through Vitest and 26 to 28 s on the three repeat runs.
- **Fix:** child limit 240 s, test limit 250 s, with the measured times in a comment (the operator note's half-limit rule).
- **Commit:** 515d8e2.

**4. [Gate contract] ABI 127 guard at the top of the script**
- **What:** the guard every gate in `scripts/` carries (PATTERNS "Gate script contract").
- **Phase 26:** the Node upgrade must change it, as for `check-vi-mock-paths.ts`.

**5. [Minor] CI calls the history mode through npm**
- **What:** the step runs `npm run check:census -- --check-floor-history`, rather than a second ts-node invocation, so both commands go through one entry.

**Total deviations:** 5 (1 Rule 1, 1 Rule 2, 1 timing, 2 contract or form). **Impact:** each makes the gate stricter or its test faster to fail loudly. No scope change; src/ is unchanged.

## Severity changes and new findings

None. No finding was registered or regraded. The register is unchanged, so AUDIT-FINDINGS.md was not re-rendered.

## Issues Encountered (all diagnosed)

**First decision-coverage mutant printed no result:** the mutant (`else if (false)`) broke TypeScript's narrowing of `rec`. ts-node then refused to compile (TS2339), and no case ran. Rewritten as a type-valid mutant, it failed the two coverage cases as expected. The cases had no gap; the first mutant was invalid.

**`check.ts --stage final`:** 109 FAILs. Five come from this plan's files, and they are the two bookkeeping kinds every Phase 23 plan adds:
- missing ledger rows for the 3 new files (ledger/SCRIPTS.json ×2, ledger/TESTU.json);
- re_audit entries that must end at 77b5932 (`package.json` in ledger/ROOT.json, `.github/workflows/test.yml` in ledger/CONTRACTS.json).

STATE.md and 23-04 record `--stage final` as outside Phase 23 scope; the phase gates are partial, consolidation and triage, and all three pass.

**`--stage partial` and re_audit rows:** partial did not flag `package.json` or `test.yml` after the Task 3 commit (PASS, fail 0). So no re_audit rows were added.

**Line endings:** git warns that LF files will become CRLF on the next checkout (`core.autocrlf=true`). This is the known AUD-OD21-001 hazard. The census reads both.

## Verification (Node 22.16.0)

**Task verifies:**
- **Task 1:** census exit 0 at 23; self-test pass. Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:** self-test 54 of 54; the Vitest wrapper 1 of 1.
- **Task 3:** `npm run --silent check:census` exit 0; both greps pass; the workflow YAML parses.

**Acceptance criteria:**
- `"floor": 23` present; 13 sites across `unlocked`; 2 `excluded` entries.
- The default run prints 23 and exits 0.
- The original census is unchanged.
- The self-test names AC-32 to AC-36, unknown lock, missing ref, non-covering ref and missing record.
- Shallow clone: non-zero (2), shown by the self-test and by a real `--depth 1` clone.

**Full railed suite** (`npm test -- --reporter=json`, on f742380..77b5932's tree plus this plan's unit test; rails run `run-20261112T042102-20840-792aeb`):
- 199 files, 1396 tests: 1396 passed, 0 failed, 0 skipped, 0 todo, wall 160.8 s.
- By project: unit 946, integration 263, realpath 187.
- Rails ledger: `nonLoopbackAllowed` 0, `telegramAllowed` 0.
- The two "unhandled" strings in the output are test titles, not errors.

**This plan's test under the full run:** 59.7 s, then given its own limits (deviation 3).

**Repeatability:**
- Three Vitest runs of the new file: 1/1 passed each, 28.4 / 26.8 / 26.0 s.
- Three direct `--self-test` runs: byte-identical output once the recorded-read count is normalised (that count is printed and can change with code size).

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- A scratch tsconfig extending the repo's, over the new script and test: exit 0.
- `check-realpath-mocks`: 0 violations. `check-vi-mock-paths`: 591 calls in 267 files, 0 violations.
- `check.ts` partial, consolidation and triage: RESULT PASS, fail 0, pending 0.
- `git status --porcelain src` is empty.

## Known Stubs

None.

## Threat Flags

None. The only new surface is a local read-only git walk in CI over the repo's own history. It uses argument-array calls; commit messages are only regex-matched.

## User Setup Required

None.

## Next Phase Readiness

- **CI:** the gate is wired; its first GitHub Actions run (Linux, full-depth checkout) is the remaining proof (coverage D3).
- **Plan 23-25:** its commit check can rely on `fetch-depth: 0` in the `test` job.
- **Phase 24:** see Decisions Made for the AUD-BUY-007 floor change.

## Self-Check: PASSED

- **Files found:** scripts/check-signing-census.ts, scripts/signing-census-exceptions.json, test/unit/signingCensusGate.test.ts. package.json and .github/workflows/test.yml carry the changes.
- **Commits found on this branch:** f742380, c34846d, 77b5932, 515d8e2 (`git rev-list --count 00d5ef1..HEAD` = 4 before this SUMMARY).
- **Clean tree:** only the operator's own `.planning/config.json` and `.planning/state.json` changes remain modified and unstaged.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
