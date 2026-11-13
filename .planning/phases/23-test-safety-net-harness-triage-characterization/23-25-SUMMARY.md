---
phase: 23-test-safety-net-harness-triage-characterization
plan: 25
subsystem: testing
tags: [commit-taxonomy, git, golden-master, ci-gate, audit-06, vitest, spawnRailedChild]

requires:
  - phase: 23 (plan 23-17)
    provides: the gate shape (ABI guard, exit 0/1/2, --self-test on throwaway repos), the test job's fetch-depth 0
  - phase: 23 (plans 23-20 to 23-23)
    provides: the recordings under test/realpath/recordings/ (first recording commit babd7e4; 22 scenario files, the folder's .gitattributes, 108 env-snapshot files)
provides:
  - scripts/check-commit-taxonomy.ts (judges every non-merge commit after the first recording commit; --self-test with 27 cases)
  - npm run check:commits and the CI step "Commit taxonomy gate (AUDIT-06)" after the signing census step
  - test/unit/commitTaxonomyGate.test.ts (the self-test in a railed child)
affects: [phase-24 (every re-record is a behavior: commit citing a register ID that exists in that commit's tree), phase-28 (test hygiene: the redirect limit in deferred-items.md), phase-26 (Node upgrade must update the ABI 127 guard)]

actuals:
  tokens: 16071
  tasks: 2
  commits: 3
plan_head_before: b6255b92ed467fc655631c6a9ed6534410f25c35
plan_head_after: 8b4fbc49114cc823d7cde1b82b86b6ddd30b86ef

tech-stack:
  added: []
  patterns:
    - "History gate over git plumbing only (rev-list, diff-tree, cat-file), argument arrays, GIT_* dropped, replace objects and lazy fetch off; every batched answer is checked against the request, and two git views of the same range must agree or the check exits 2"
    - "Path identity across history: lower-case path, an add of a path any ancestor touched is a re-add, an add of a path another line adds with different content is a change"
    - "Commit messages read size-delimited through cat-file --batch; IDs matched by a regex bounded on both sides, then looked up in the judged commit's own tree"

key-files:
  created:
    - scripts/check-commit-taxonomy.ts
    - test/unit/commitTaxonomyGate.test.ts
  modified:
    - package.json
    - .github/workflows/test.yml
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "Protected folder test/realpath/recordings/ (scenarios, the env snapshot, its .gitattributes), matched with the :(icase) pathspec. Any status other than A (M, D, T) is a change. An A is a change too when any ancestor touched the same lower-case path (delete and re-add, a case variant), or when another line of history (side branch forked before the recording, unrelated root merged in) adds it with different content; the same content on two lines (a cherry-pick) stays new"
  - "Subject must begin exactly behavior: or behavior(<scope>): (lower case; Behavior:, behaviour: and fix(behavior): are not behavior commits). Every OD-<n> / AUD-<AREA>-<NNN> the message cites must exist in that commit's own tree; one missing ID fails the commit even if another exists. An ID inside a longer token (XAUD-BUY-016, AUD-BUY-0160, AUD-BUY-016-era) or with a leading zero (OD-05) is not an ID"
  - "The first recording commit is the topologically earliest non-merge commit whose diff adds a path under the folder, found with rev-list --full-history plus diff-tree (plumbing, so user config such as log.follow cannot change it); on this branch it is babd7e4"
  - "Exit 2 (never a pass) for a shallow clone, no recording commit, no non-merge commit after the first, any git failure and any disagreement between git's own answers"
  - "Self-test limits from measurement: 35.1 s alone through Vitest, 75.1 s in the full parallel run, so child 240 s / test 250 s (31 percent), as for the census self-test"
  - "Limit raised for an operator ruling: the check protects recording files, not which file a test compares against; redirecting a scenario test to a new recording name passes (deferred-items.md)"

patterns-established:
  - "A history gate's self-test runs each rule on one shared throwaway repo (one branch per case from the first recording commit) plus its own repos for the shallow-clone, autocrlf and no-recording cases; mutation runs prove the re-add and parallel-line cases fail when their rule is removed"

requirements-completed: [AUDIT-06]

coverage:
  - id: D1
    description: "Any commit type that changes, removes, renames or re-adds a recorded scenario or env-snapshot file fails unless it is a behavior: commit citing a real ID; a brand-new scenario or env variable passes (AC-39, AC-40, A-2, D-17, D-18, T-23-41)"
    requirement: AUDIT-06
    verification:
      - kind: unit
        ref: "test/unit/commitTaxonomyGate.test.ts#check-commit-taxonomy.ts --self-test (AUDIT-06) exits 0 and every rule case passes on throwaway repos"
        status: pass
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js scripts/check-commit-taxonomy.ts --self-test (SELF-TEST PASS 27 of 27 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A behavior: commit with no ID, an ID absent from the register, or an ID that only a later commit registers fails (AC-41)"
    requirement: AUDIT-06
    verification:
      - kind: unit
        ref: "test/unit/commitTaxonomyGate.test.ts (cases AC-41-*)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Merge commits are not judged, their inner commits are, and a merge whose conflict resolution alone changes a recording prints a WARN line with exit 0 (AC-42)"
    requirement: AUDIT-06
    verification:
      - kind: unit
        ref: "test/unit/commitTaxonomyGate.test.ts (cases AC-42-*)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The check runs by npm run check:commits and in CI after the census step, judges only commits after the first recording commit, refuses a shallow clone, and passes on the real history (AC-43, AC-44, T-23-31)"
    requirement: AUDIT-06
    verification:
      - kind: other
        ref: "npm run --silent check:commits (first recording commit babd7e40f002, 28 commits judged, 0 changed or removed, RESULT PASS)"
        status: pass
      - kind: other
        ref: "grep -q 'npm run check:commits' .github/workflows/test.yml (step after Signing census gate)"
        status: pass
    human_judgment: false

duration: 27min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 25: Commit Taxonomy Check Summary

**A git history gate: after babd7e4, a commit that changes, removes, renames or re-adds anything under test/realpath/recordings/ must be a `behavior:` commit, and every OD-/AUD- ID it cites must exist in that commit's own tree. It runs in CI and by `npm run check:commits`, with 27 self-test cases on throwaway repos.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-11-12T19:25:48Z
- **Completed:** 2026-11-12T19:53:16Z
- **Tasks:** 2
- **Files modified:** 5 (4 plan files and deferred-items.md)

## Accomplishments

- `scripts/check-commit-taxonomy.ts` (gate shape of 23-17: ABI 127 guard, exit 0/1/2, `require.main` guard). It finds the first recording commit from history and reports it: **babd7e4** on this branch. It then judges every commit in `git rev-list --no-merges --reverse --topo-order <first>..HEAD`.
- **Clean pass on real history:** 28 commits judged after babd7e4, no merges. 7 of them touch the folder (23-20, 23-21, 23-22 and 23-23), adding 129 new paths, and **0 existing paths were changed, removed or re-added**. 0 violations, RESULT PASS, exit 0. Before this plan's own commits the count was 25 judged (the orchestrator's list).
- Rename and copy detection are off everywhere (`diff-tree -r --no-renames --name-status -z`, one `--stdin` call). A rename therefore reads as D plus A and fails. A new file almost identical to an existing one reads as an A and passes. The self-test proves both, and shows that `-M` and `-C --find-copies-harder` would have read them as R and C.
- Env-snapshot files (env/<VAR>.json, env/_baseline.json) are protected paths (A-2). A changed case fails unless it is a `behavior:` commit, and a new variable passes.
- `npm run check:commits` added, and the CI step "Commit taxonomy gate (AUDIT-06)" placed after "Signing census gate (CHAR-04)". The test job already uses fetch-depth 0, and nothing else in the workflow changed.
- `test/unit/commitTaxonomyGate.test.ts` runs `--self-test` through `spawnRailedChild('npx', ['ts-node', ...])`. git runs fine in a railed child (PATH is inherited, and the rails do not hook child_process). The test asserts all 27 case names, the WARN line and `SELF-TEST PASS 27 of 27 cases`.

### Self-test cases (27, each on a throwaway repo under the OS temp folder, AC-43)

AC-44 clean history passes and names the first recording commit; AC-44 commits before the first recording commit are not judged (an ID-less `behavior:` commit there would otherwise fail); AC-39 an edit by any non-behavior type fails (feat, fix, test, chore, docs, refactor, `Behavior:`, `behaviour:`, `fix(behavior):`, nine violations); AC-39 the same edit as `behavior:` / `behavior(exit):` citing a real ID passes; AC-41 behavior without an ID fails; AC-41 an ID absent from the register fails (AUD-BUY-999, OD-77); AC-41 an ID inside a longer token is not an ID; AC-41 an ID that exists only in a later commit fails (the ID exists at HEAD, asserted); AC-40 a brand-new scenario passes; AC-40 a near-identical new file passes as an add, not a copy; A-2 a new env variable passes; A-2 changing an env case or the baseline needs a behavior commit; AC-39 deleting fails unless behavior, and the behavior delete passes; T-23-41 a delete then a later re-add of the same path fails; a rename fails as a delete plus an add; AC-42 a merge is not judged and its inner commits are; AC-42 a clean merge of valid commits passes; AC-42 a merge whose conflict resolution alone changes a recording exits 0 and prints `WARN merge <sha> "Merge branch side": its result differs from every parent in "test/realpath/recordings/a.jsonl"; ...`; T-23-41 a path added on a side line forked before the recording fails; AC-40 the same new scenario added on two lines (a cherry-pick) passes; T-23-41 an unrelated root commit adding an existing path fails; nothing after the first recording commit exits 2; T-23-31 a shallow clone exits 2; a case-variant path (test/realpath/RECORDINGS/a.jsonl) is the same protected file; no recording commit exits 2; LF under core.autocrlf=true (a fresh checkout and a CRLF editor save cause no spurious change, and a real edit is seen).

Mutation proofs (scratch copies outside the repo, removed afterwards): with re-add detection switched off, exactly the delete-then-re-add and case-variant cases FAIL (2 of 27). With parallel-line detection switched off, exactly the side-line and unrelated-root cases FAIL (2 of 27).

## Task Commits

1. **Task 1: Build the check and prove each rule on throwaway repos, ending with a clean pass on real history** - `8d7df80` (feat), refined in `ec33b1a` (perf: fewer git calls, two more consistency checks)
2. **Task 2: Wire the check into npm and CI and prove it there** - `8b4fbc4` (feat)

**Plan metadata:** this SUMMARY commit (docs)

## Files Created/Modified

- `scripts/check-commit-taxonomy.ts` - the check and its `--self-test`
- `test/unit/commitTaxonomyGate.test.ts` - the self-test in a railed child (child 240 s, test 250 s)
- `package.json` - one script, `check:commits`; no dependency or other script changed
- `.github/workflows/test.yml` - the step "Commit taxonomy gate (AUDIT-06)" with a comment saying what it protects
- `.planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md` - the redirect limit, raised for an operator ruling

## Decisions Made

See key-decisions above. Phase 24 needs these in practice:
- A re-record (for example public-v2-buy.jsonl citing AUD-BUY-016, or the fee-gas recordings citing AUD-TX-007 or AUD-TX-030) must be its own `behavior:` or `behavior(<scope>):` commit. The register record it cites must be in that commit's tree, so register a new finding in the same commit or an earlier one.
- Every ID-shaped token in a `behavior:` commit's message is checked. Do not mention an unregistered AUD- or OD- ID anywhere in such a message.
- A merge never needs `behavior:`. If its resolution alone changes a recording, the gate prints a WARN line to review by hand.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] A second line of history could replace a recording without any M or D**
- **Found during:** Task 1 (design of the identity rule)
- **Issue:** the plan's re-add rule looks only at earlier commits (ancestors). Take a side branch forked before babd7e4, or an unrelated root commit, that adds a recording path with different content. Once merged with an add/add resolution that keeps that side's version, the mainline recording is replaced and the merge's `--cc` shows nothing, because the result equals one parent.
- **Fix:** an A also counts as a change when another line of history adds the same path with different content. The same content stays new, so a cherry-picked new scenario is not a false positive.
- **Verification:** cases T-23-41 side line, unrelated root and same scenario on two lines, plus a mutation proof.
- **Committed in:** 8d7df80

**2. [Rule 2 - Missing critical] Letter case on the operator's Windows checkout**
- **Found during:** Task 1
- **Issue:** git paths are case-sensitive, but on Windows test/realpath/RECORDINGS/x.jsonl is the same file as the protected one, so a case-variant add would overwrite it in a local checkout.
- **Fix:** the folder pathspec is `:(icase)`, and path identity is the lower-case path, so a case variant of an existing recording is a re-add.
- **Verification:** case a-case-variant-path-is-the-same-protected-file, plus the re-add mutation proof.
- **Committed in:** 8d7df80

**3. [Rule 1 - Correctness] First recording commit found with plumbing instead of `git log`**
- **Found during:** Task 1
- **Issue:** `git log` is porcelain, so user configuration (log.follow, diff settings) could change its answer.
- **Fix:** the check lists every non-merge commit that touches the folder (`rev-list --full-history --topo-order --reverse`). The first recording commit is the earliest whose `diff-tree --root --no-renames` shows an A. The result is the same commit (babd7e4) as the plan's `git log --diff-filter=A` form, which I ran against it.
- **Committed in:** 8d7df80

**4. [Rule 3 - Blocking] Self-test limits from measurement, not the planned 110 s**
- **Found during:** Task 2
- **Issue:** 75.1 s in the full parallel run would be 68 percent of a 110 s child limit, over the half-limit rule.
- **Fix:** child 240 s and test 250 s (31 percent), stated in a comment with the measurements, as 23-17 did for the census. To get there I also cut git calls: one batched `diff-tree --stdin` and one `cat-file --batch-check`, with merges taken from the commit graph. The self-test fell from about 45 s to 31.7 s run directly. Every batched answer is checked against its request, and the in-memory range must equal git's `--no-merges` list, or the check exits 2.
- **Committed in:** ec33b1a, 8b4fbc4

**5. [Rule 2 - Missing critical] Nothing to judge is exit 2**
- **Found during:** Task 1
- **Issue:** with HEAD at the first recording commit, the check would judge nothing and pass. The plan's fails_when names "judged nothing (exit 2)" but its action names only the missing first commit.
- **Fix:** exit 2 when no non-merge commit follows the first recording commit.
- **Verification:** case nothing-after-the-first-recording-commit-exits-2.
- **Committed in:** 8d7df80

---

**Total deviations:** 5 auto-fixed (3 missing critical, 1 correctness, 1 blocking)
**Impact on plan:** every rule the plan names is implemented as written. The additions close laundering routes the plan's wording left open, or keep the gate from passing on a broken scan. No scope beyond the plan's four files, apart from one deferred-items.md entry.

## Findings Registered or Regraded

None. No finding was registered and no severity was changed.

## Known Limit Raised for an Operator Ruling

The check protects recording **files**, not which file a scenario test compares against. A commit can edit a scenario test so it compares against a new recording name and add that new file. That commit passes as an add of a brand-new path, and the old recording stays in place, unchanged and no longer read. Only review of the test's diff would catch it, and `recordingsGuard.test.ts` does not fail on a recording that no test reads. Closing it needs a rule about tests rather than files, a design choice outside the D-12 rule and this plan's files, so it is recorded in deferred-items.md (status open, raised for an operator ruling) instead of being invented here.

## Issues Encountered

- The full railed run was moved to the background by the harness after 180 s, as before. I waited for it to finish without starting other work, and it completed with exit 0.
- My first mutation run failed with TS5109 because ts-node found no tsconfig next to the scratch copy. Re-running with `--project tsconfig.json` fixed it. This was a tool setup error, not a result.

## Gates (Node 22.16.0)

- Full railed npm test (unit, integration and realpath, in parallel, 8b4fbc4 code tree; the commit after the run changed only the limit comment): **210 files, 1559/1559 passed, wall 195 s**, exit 0. Ledger run-20261112T194619-12584-543afc: nonLoopbackAllowed 0, telegramAllowed 0, unparseableLines 0, and commitTaxonomyGate.test.ts is not a triggering file. This plan's wrapper took 75.1 s of 240 s. In the same run backupState took 67.4 s of 230 s and the census self-test 64.9 s of 240 s, both in their known ranges.
- The wrapper alone through Vitest: 35.1 s, passed. Earlier, with spawnSites.test.ts and sourceTextGate.test.ts: 3 files, 10 tests passed (the new test spawns only through spawnRailedChild with literal specifiers and reads no file under src/ or scripts/).
- tsc --noEmit clean on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json. A strict scratch tsc over the two new files is clean.
- check:realpath-mocks 0 violations (104 files); check:vi-mock 660 calls, 0 violations; check:census 23 sites, 0 problems (scripts 27 files including the new one); --check-floor-history 0 problems; red-proof-conversions --check-manifest MANIFEST-OK rows 36 files 11 guards 1.
- check.ts --stage partial, consolidation and triage: PASS (fail 0, pending 0, warn 0), and no re_audit row was needed. `--stage final`: 273 FAILs, 4 of them naming this plan's files. Two are ledger rows for the two new files. The other two are the package.json and test.yml re_audit rows, which already failed at final after 23-17 and now name 8b4fbc4. This is the out-of-scope Phase 22 bookkeeping kind.
- `git status --porcelain src` empty. No temp folder left behind (`csb-commit-taxonomy-*` count 0). `.planning/config.json` and `.planning/state.json` left modified and unstaged.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AUDIT-06 is in force from this commit on: every later commit on this branch and on main is judged. Plan 23-32 (wave 14) touches no recording.
- Phase 24 re-records go through `behavior:` commits citing registered IDs, as set out above.
- An operator ruling is wanted on the redirect limit (deferred-items.md).

## Self-Check: PASSED

- FOUND: scripts/check-commit-taxonomy.ts, test/unit/commitTaxonomyGate.test.ts, package.json (check:commits), .github/workflows/test.yml (Commit taxonomy gate (AUDIT-06))
- FOUND commits: 8d7df80, ec33b1a, 8b4fbc4 (all ancestors of HEAD; 3 commits since plan_head_before b6255b9)
- Acceptance re-run: `--self-test` SELF-TEST PASS 27 of 27 with the delete-then-re-add, later-ID and merge WARN cases; real run exit 0, 28 commits judged (> 0); `git status --porcelain` shows only config.json and state.json (the operator's) plus this plan's docs

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
