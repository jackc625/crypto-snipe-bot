---
phase: 22-safety-rails-audit
plan: 07
subsystem: infra
tags: [git, ignition, hardhat-ignition, gitignore, autocrlf, backup, od-21, safe-01]

requires:
  - phase: 22-01
    provides: "backup dated folder + MANIFEST.json (sha256 9e28e30f...151a) with the 10-entry Ignition subset"
  - phase: 22-03
    provides: "SAFE-01 VALID (safe01-offmachine.json), the precondition for OD-21"
  - phase: 22-04
    provides: "audit register tooling (check.ts, render.ts), PROTOCOL.md finding schema, OD21 findings-only slice, scope.json out-of-scope prefix ignition/deployments/"
  - phase: 22-05
    provides: ".gitignore !test/.env.test negation (kept intact; artifacts/ moved to line 38)"
provides:
  - "OD-21 commit 93f81898e21927679117f2401491a0e9ddb8f634: all of ignition/deployments/ tracked (6 newly tracked, 10 in total)"
  - "AC-07 blob-level proof: tracked set == manifest Ignition subset; every HEAD blob sha256 == manifest"
  - ".planning/baselines/od21-record.json (commit SHA/time, per-file blob hashes, set_equal, NAC-02 output, AC-08 statement)"
  - "scoped ignore rules: root !ignition/deployments/*/artifacts/, ignition/.gitignore journal rule removed"
  - "AUD-OD21-001 (S3, capital none) and the STATE.md branch-switch/autocrlf operating note"
affects: [22-29 IGN_AC07, phase-25 line-endings, any Hardhat/Ignition invocation in v7.0, branch merges into main]

actuals:
  tokens: 35400
  tasks: 2
  commits: 5
plan_head_before: 0927abf785de7bb0ee779b02344bc6b250a1b299
plan_head_after: a61a61492b65a872e7543bfd749b5929c5200478

tech-stack:
  added: []
  patterns:
    - "Prove committed bytes at the blob level (git cat-file -p :<path> before commit, HEAD:<path> after) instead of hashing the working tree"
    - "Pathspec-limited commits (git commit -- <paths>) so nothing staged elsewhere rides along"

key-files:
  created:
    - .planning/baselines/od21-record.json
    - .planning/audit/findings/AUD-OD21-001.json
    - "ignition/deployments/chain-{1,11155111}/journal.jsonl (now tracked)"
    - "ignition/deployments/chain-{1,11155111}/artifacts/HoneypotCheckerModule#HoneypotChecker{,.dbg}.json (now tracked)"
  modified:
    - .gitignore
    - ignition/.gitignore
    - .planning/STATE.md

key-decisions:
  - "22-07: OD-21 carried out. Commit 93f8189 adds exactly the 6 previously ignored Ignition files; 10 are tracked under ignition/deployments/; every blob is byte-identical to the backup manifest; no Hardhat command ran in v7.0 before it (AC-08)"
  - "22-07: no .gitattributes rule added. Staged and committed blobs proved LF and manifest-equal without one, so the SPEC boundary (line endings belong to Phase 25) held; the remaining checkout hazard is AUD-OD21-001"
  - "22-07: the plan's AC-07 node one-liner needs maxBuffer raised (build-info blobs are 3.87 MB, above the 1 MiB execFileSync default, giving ENOBUFS); 22-29 IGN_AC07 must raise maxBuffer or stream blobs"

patterns-established:
  - "Blob-level manifest equality: hash git cat-file output, never the working tree, when proving committed state"

requirements-completed: [SAFE-01]

coverage:
  - id: D1
    description: "OD-21 commit tracks all of ignition/deployments/ (6 new, 10 total) and nothing else; AC-07 set + blob SHA-256 equality with the backup manifest"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "22-07 Task 1 <automated> verify, rerun with execFileSync maxBuffer 64 MiB -> 'AC-07 ok 10'"
        status: pass
      - kind: other
        ref: "git ls-files ignition/deployments | while read p; do git cat-file -p HEAD:\"$p\" | sha256sum; done vs MANIFEST.json -> 10/10 EQ"
        status: pass
    human_judgment: false
  - id: D2
    description: "NAC-02: after the OD-21 commit git ls-files data .env '.env.*' lists only .env.example; the OD-21 commit lists only ignition/deployments/ paths"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "git ls-files data .env '.env.*' -> .env.example; git show --name-only --format= 93f8189 -> 6 ignition/deployments paths"
        status: pass
    human_judgment: false
  - id: D3
    description: "Scoped ignore rules: no ignition/deployments file (current or future) is ignored; root artifacts/, cache/, data/, .env* still are"
    verification:
      - kind: other
        ref: "22-07 Task 2 <automated> verify 1 (check-ignore loop + artifacts/x.json + STATE.md grep) -> rc 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-OD21-001 registered and STATE.md operating note added"
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice OD21 -> RESULT PASS fail=0 pending=0 warn=0"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 07: OD-21 Ignition Deployments Tracked Summary

**All 10 `ignition/deployments/` files are now in git (OD-21 commit `93f8189`). The committed blobs are byte-identical to the SAFE-01 backup manifest, the ignore rules now leave future journals and artifacts visible, and the autocrlf and branch-switch hazard is registered as AUD-OD21-001.**

## Performance

- **Duration:** about 4 min (measured from the recorded start)
- **Started:** 2026-11-07T03:52:22Z
- **Completed:** 2026-11-07T03:56:55Z
- **Tasks:** 2
- **Files modified:** 11 (6 newly tracked Ignition files, .gitignore, ignition/.gitignore, STATE.md, od21-record.json, AUD-OD21-001.json)

## Accomplishments

- **Precondition:** SAFE-01 is VALID (`safe01-offmachine.json`). Before staging, all 10 working-tree Ignition files were re-hashed against `MANIFEST.json`: 10/10 equal, the sets match, and all are pure LF. The MANIFEST hash `9e28e30f...151a` equals the value in `backup-record.json`.
- **OD-21 commit `93f8189`** (2026-11-06T22:53:14-05:00) was made with `git add -f ignition/deployments` and `git commit -- ignition/deployments`. It adds exactly 6 files: 2 `journal.jsonl` and 4 `artifacts/*.json`. The 4 files that were already tracked are unchanged and do not appear in its diff. After it, 10 files are tracked.
- **AC-07, proved on the blobs three ways:**
  - Before the commit, the index blobs (`git cat-file -p :<path>`) matched the manifest.
  - After the commit, the HEAD blobs matched in-process in Node.
  - After the commit, the HEAD blobs matched per path with `git cat-file -p HEAD:"<path>" | sha256sum`.
  - All three gave 10/10, and the tracked set equals the manifest's Ignition subset in both directions.
- **NAC-02:** `git ls-files data .env '.env.*'` prints `.env.example` only.
- **AC-08:** no Hardhat command has run in v7.0. The Hardhat `cache/` and `artifacts/` folders have no file newer than 2026-05-29 (newest is 19:29). Commit SHA and time are recorded for later phases.
- **Ignore rules (follow-up commit `ce3851e`):**
  - Root `.gitignore`: one comment and `!ignition/deployments/*/artifacts/`, directly after `artifacts/`.
  - `ignition/.gitignore`: the `deployments/*/journal.jsonl` rule is replaced by a comment giving the reason.
  - Checked with `git check-ignore -v --no-index` on all 10 files and on future-path probes (a new artifact, a new chain's journal): none are ignored.
  - Root `artifacts/`, `contracts/artifacts/`, `cache/`, `data/`, `.env` and `.env.local` are still ignored, and 22-05's `!test/.env.test` still applies.
- **STATE.md operating note** (`eff3635`) covers the branch-switch deletion hazard, the restore commands, the autocrlf re-checkout effect, the Phase 25 owner and the 22-29 IGN_AC07 backstop.
- **AUD-OD21-001** (`a61a614`): area contracts, slice OD21, S3, capital none, no classes, status confirmed. `check.ts --stage partial --slice OD21` passes, and `render.ts` was validated in a temp folder only. The canonical AUDIT-FINDINGS.md and OPERATOR-DECISIONS.md were not touched.

## Task Commits

1. **Task 1: OD-21 commit + AC-07 blob proof**
   - `93f8189` (chore): track ignition/deployments in git (OD-21)
   - `39367bb` (docs): record od21-record.json
2. **Task 2: ignore rules, STATE note, AUD-OD21-001**
   - `ce3851e` (chore): scope ignore rules so ignition/deployments stays visible
   - `eff3635` (docs): STATE.md operating note
   - `a61a614` (docs): register AUD-OD21-001

**Plan metadata:** recorded in the final docs commit for this SUMMARY.

## Files Created/Modified

- `ignition/deployments/chain-1/journal.jsonl`, `ignition/deployments/chain-11155111/journal.jsonl`: Ignition journals, now tracked.
- `ignition/deployments/chain-{1,11155111}/artifacts/HoneypotCheckerModule#HoneypotChecker{,.dbg}.json`: per-future artifacts, now tracked.
- `.planning/baselines/od21-record.json`: the OD-21 SHA and time, a per-file manifest/blob/working-tree hash comparison, `set_equal`, the NAC-02 output, the AC-08 statement, and a note on the plan-verify buffer defect.
- `.gitignore`: the scoped artifacts negation.
- `ignition/.gitignore`: journal rule removed and replaced by a comment.
- `.planning/STATE.md`: one Operating Notes bullet.
- `.planning/audit/findings/AUD-OD21-001.json`: the line-ending and branch-switch hazard finding.

## Decisions Made

- **No `.gitattributes` change.** The orchestrator allowed a scoped rule "if needed", but the staged blobs were proven LF and manifest-equal before the commit, so none was needed. The plan context and the SPEC Boundaries put `.gitattributes` in Phase 25. The leftover hazard is a future CRLF re-checkout, which is registered (AUD-OD21-001) rather than fixed.
- **AUD-OD21-001 `audited_sha`** is the HEAD at the time the evidence was collected (`eff3635`), not `audit_base_sha`. The finding describes state that the OD-21 commit created. The plan named only one evidence command per item; the finding lists the root `.gitattributes` and `git ls-tree main` as extra evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's Task 1 automated verify fails with ENOBUFS on the build-info blobs**
- **Found during:** Task 1 verification.
- **Issue:** the node one-liner calls `execFileSync('git', ['cat-file','-p','HEAD:'+p])` with Node's default 1 MiB `maxBuffer`. The two `build-info/*.json` blobs are 3,866,938 bytes, so the spawn aborted with `spawnSync git ENOBUFS` before any comparison ran. This was a defect in the command, not a data mismatch. The shell checks earlier in the same `&&` chain (6 commit paths, 10 tracked, NAC-02) had already passed.
- **Fix:** reran the identical command with only `{maxBuffer: 64*1024*1024}` added; it prints `AC-07 ok 10`. Cross-checked independently with the plan's own shell method (`git cat-file -p HEAD:"<path>" | sha256sum`): 10/10 EQ. No plan file was edited. The defect and the fix are recorded in `od21-record.json` (`ac07_verification.plan_verify_defect`).
- **Files modified:** `.planning/baselines/od21-record.json` (note only).
- **Verification:** three independent blob-hash methods, 10/10.
- **Committed in:** `39367bb`.
- **Forward impact:** any later re-hash of these blobs in Node, including 22-29 IGN_AC07, must raise `maxBuffer` or stream the blob.

---

**Total deviations:** 1 auto-fixed (Rule 1, verify-command bug).
**Impact on plan:** none on the outcome. The tracer foundation was proven before Task 2 started.

## Issues Encountered

- **`grep -c $'\r'` gave false CR counts.** It reported "CR lines" on files that `git ls-files --eol` showed as LF. Counting the actual bytes (`tr -cd '\r' | wc -c`) settled it: `.gitignore` has CRLF in the working copy (LF in the blob, the usual autocrlf effect), and `ignition/.gitignore` and `STATE.md` have 0 CR bytes. The edits kept each file's existing line endings: `.gitignore` is still 82 CRs over 82 lines.
- **Expected autocrlf notices.** `git add` and `git commit` printed `LF will be replaced by CRLF the next time Git touches it`. For the OD-21 commit it appeared for exactly the 6 new files. The index shows `i/lf` and the blob hashes prove the LF bytes are intact, so the notice concerns only future checkouts, which is what AUD-OD21-001 records.

## Known Stubs

None.

## Threat Flags

None. T-22-18 is mitigated by the force-add scope, the staged-name check and NAC-02. T-22-19 is mitigated by the pre-commit working-tree re-hash and the blob equality checks. No new surface was added.

## User Setup Required

None. An optional operator action is described in AUD-OD21-001: adding `ignition/deployments/** -text` to the machine-local `.git/info/attributes`. It is not needed in Phase 22.

## Next Phase Readiness

- AC-07, AC-08 and NAC-02 hold. Later Hardhat or Ignition runs in v7.0 now start from tracked deployment state.
- **Stay on `phase-22-safety-rails-audit` until it merges into `main`.** Checking out `main` deletes the 6 new files from the working tree; see the STATE.md note for how to restore them.
- **For 22-29:**
  - IGN_AC07 should require `93f8189` to be an ancestor of HEAD.
  - It must re-hash the working tree and the HEAD blobs with a raised `maxBuffer` or a stream.
  - Re-audit the `.gitignore` and `ignition/.gitignore` diffs (ROOT slice) under AC-32.

## Self-Check: PASSED

- Files: od21-record.json, AUD-OD21-001.json, 22-07-SUMMARY.md and both journal.jsonl files exist.
- Commits: 93f8189, 39367bb, ce3851e, eff3635, a61a614 and c37a72e are all ancestors of HEAD; `check evaluation-scope --plan 22-07` resolves them.
- Acceptance criteria rerun at final HEAD:
  - 10 tracked files; NAC-02 prints `.env.example` only.
  - od21-record shows `set_equal` true and every `equal` true.
  - The check-ignore loop finds nothing ignored, and root `artifacts/` is still ignored.
  - `check.ts --stage partial --slice OD21` passes.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
