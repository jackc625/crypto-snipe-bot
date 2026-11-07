---
phase: 22-safety-rails-audit
plan: 01
subsystem: infra
tags: [backup, sha256, manifest, gnu-tar, ignition, sqlite-raw-bytes, safe-01]

requires: []
provides:
  - "Immutable phase_start_sha (.planning/baselines/phase-start.json), committed first; every later phase_start_sha..HEAD range includes all Phase 22 commits"
  - "scripts/backup-state.ts: raw-byte backup builder with --self-check (cases a-l), real build, archive build, --verify <folder|archive>"
  - "Verified local backup C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06 (17 PRESENT) + crypto-snipe-bot-state-2026-11-06.tar.gz and its .sha256"
  - ".planning/baselines/backup-record.json: phase-start SHA, backup-tool commit, archive/manifest hashes, DB-set hashes (NAC-03 reference values)"
affects: [22-02 secret scan of the backup, 22-03 off-machine Drive copy, OD-21 Ignition tracking commit, 22-29 verify-prod-untouched seal]

actuals:
  tokens: 16912
  tasks: 2
  commits: 3
plan_head_before: 23a64617dca167976adc4645fed0e2c69e384820
plan_head_after: 7f4c7a2b2af85e1eee6dd00c236f64a1ab8978ee

tech-stack:
  added: []
  patterns:
    - "Phase 22 script guard: first statement `if (process.versions.modules !== '127')` with the refusal text `requires Node 22.16.0 (ABI 127)`"
    - "lstat-only tree walk with realpath.native cross-check; links/junctions/reparse points refused, never followed"
    - "Expected inventory = walk + git ls-files + files derived from deployed_addresses.json; source inventory must equal staging inventory"
    - "Build in .staging-<date>-<pid>, verify, then rename to the next free <date>[-N]; never overwrite"
    - "Self-check hooks are an internal function parameter only (not argv/env); self-check predicates match the exact failure reason, mutation-tested"

key-files:
  created:
    - .planning/baselines/phase-start.json
    - scripts/backup-state.ts
    - .planning/baselines/backup-record.json
  modified:
    - package.json

key-decisions:
  - "Ignition artifact rule observed on disk: each future id X in deployed_addresses.json has artifacts/X.json AND artifacts/X.dbg.json; both are required (stricter than the plan's .json-only wording)"
  - "Dated folder uses the LOCAL date (EST/EDT): 2026-11-06, although UTC was already 2026-11-07"
  - "Torn-snapshot check covers every backed-up file (17), not only the DB set; the copy hash and an independent after-copy sha256sum of the live source also match"
  - ".bot-state.json.bak is required-present (only data/bot.db-wal and data/bot.db-shm may be ABSENT)"
  - "The destination must already exist (the script never creates it); refusal of repo/OneDrive destinations happens before any write"

patterns-established:
  - "Every new Phase 22 script: ABI-127 assert first, Node built-ins only, no env-file loading, no import from the bot source tree"
  - "Safety self-checks are mutation-tested: disable each protection and confirm the matching case turns FAIL"

requirements-completed: [SAFE-01]

coverage:
  - id: D1
    description: "phase_start_sha recorded and committed alone as the first Phase 22 commit; its parent equals phase_start_sha; backup-tool commit lies inside phase_start_sha..HEAD"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "22-01-PLAN Task 1 verify 1 (git log --diff-filter=A / rev-parse C^ / merge-base / log P..HEAD -- scripts/backup-state.ts)"
        status: pass
    human_judgment: false
  - id: D2
    description: "backup-state.ts --self-check proves AC-04..AC-06 plus inventory completeness (cases a-l) on temp fixtures; refuses Node 24"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "PATH=$N22:$PATH node node_modules/ts-node/dist/bin.js scripts/backup-state.ts --self-check (12/12 PASS)"
        status: pass
      - kind: other
        ref: "node (v24) node_modules/ts-node/dist/bin.js scripts/backup-state.ts --self-check -> exit 1 + 'ABI 127'"
        status: pass
      - kind: other
        ref: "mutation test: 8 mutants (torn, link, derived, tracked, staging, OneDrive, in-repo, sort) each turn their case FAIL; control 12/12"
        status: pass
    human_judgment: false
  - id: D3
    description: "Verified local backup of ignition/deployments/**, data/** and .bot-state.json.bak outside the repo and OneDrive, sorted MANIFEST.json + SHA256SUMS, archive + .sha256"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "22-01-PLAN Task 2 verify 1 (sha256sum -c SHA256SUMS; --verify folder; --verify archive)"
        status: pass
      - kind: other
        ref: "22-01-PLAN Task 2 verify 2 (required PRESENT, sorted, no .env, provenance, empty inventory gaps) -> ok 17"
        status: pass
    human_judgment: false
  - id: D4
    description: "Off-machine half of AC-01/AC-03 (Google Drive upload + download-back verify)"
    requirement: SAFE-01
    verification: []
    human_judgment: true
    rationale: "Not part of this plan; plan 22-03 performs the operator Drive upload/download and verifies the downloaded bytes"

duration: 16min
completed: 2026-11-06
status: complete
---

# Phase 22 Plan 01: SAFE-01 Local Backup Summary

**Phase start pinned at `23a6461` before any Phase 22 commit. A Node-22-only raw-byte backup tool (lstat walk, git-tracked and derived-artifact cross-check, torn-snapshot hashing, staging then verify then rename) is committed with a 12-case fixture self-check, and it produced a verified 17-file backup plus a `.tar.gz` (sha256 `4c8e9ab6...1d1a`) outside the repo at `C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06`.**

## Performance

- **Duration:** about 16 min
- **Started:** 2026-11-07T00:36:28Z
- **Completed:** 2026-11-07T00:52:20Z
- **Tasks:** 2 of 2
- **Files:** 4 (3 created, 1 modified)

## Accomplishments

- **Immutable phase start:** `.planning/baselines/phase-start.json` (`phase_start_sha = 23a64617dca167976adc4645fed0e2c69e384820`) is the first Phase 22 commit (`df33999`), and its parent equals `phase_start_sha`.
- **`scripts/backup-state.ts`** (backup-tool commit `3f380bf`). It runs only on Node 22.16.0 (ABI 127) and uses Node built-ins only. It never opens `data/` through SQLite. It has four modes: self-check, real build, folder verify, and archive verify.
- **Self-check:** 12 cases, all PASS. These are the plan's 10 cases (a)-(j), plus (k) a git-tracked file deleted from disk and (l) absent wal/shm listed as ABSENT. Each failure case must fail for the exact expected reason and leave the destination empty.
- **Real backup:** `C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06` holds 17 files, all PRESENT: 10 Ignition files, 6 `data/` files and `.bot-state.json.bak`.
  - `sha256sum -c` passes 17/17, and `--verify` passes on both the folder and the archive.
  - Archive: `crypto-snipe-bot-state-2026-11-06.tar.gz`, 633,197 B, sha256 `4c8e9ab6a70b93a4d408046bebe916d29c95f93cacb47d0b50abcddfb07a1d1a`. It equals its `.sha256` sidecar.
  - MANIFEST sha256: `9e28e30f41bd5a4a7cae20f4c20d8bf37b7dd008d93ea7b43cebba2e594b151a`.
- **`backup-record.json`** (`7f4c7a2`) pins the phase-start SHA, the backup-tool commit, the archive and manifest hashes, the inventory cross-check, and the DB-set hashes that NAC-03 will compare against at phase end.

## Task Commits

1. **Step 0: record phase-start SHA:** `df33999` (docs). Committed alone; parent = `23a6461`.
2. **Task 1: backup tool + self-check:** `3f380bf` (feat). Touches only `scripts/backup-state.ts` and `package.json`.
3. **Task 2: real backup + record:** `7f4c7a2` (docs).

**Plan metadata:** recorded in the final docs commit for this plan.

## Files Created/Modified

- `.planning/baselines/phase-start.json`: immutable `phase_start_sha`, `recorded_at`, `branch`, `status_porcelain_line_count` (3; all planning files, explained in the file).
- `scripts/backup-state.ts`: the backup builder. Header includes the exit-code table (0 ok / 1 check failed or bad input / 2 crash).
- `package.json`: one added line, `"backup:state": "ts-node scripts/backup-state.ts"`.
- `.planning/baselines/backup-record.json`: the backup provenance record. It holds hashes and paths only, no file contents.

## Measured facts (re-measured, all match the plan context)

| Item | Value |
|------|-------|
| `data/bot.db` | 57,344 B, mtime 2026-05-29 17:33:56 EDT, sha256 `961aa822...1c0c` |
| `data/bot.db-wal` | 164,832 B, mtime 2026-05-29 20:25:58 EDT, sha256 `70b57264...ea36` |
| `data/bot.db-shm` | 32,768 B, mtime 2026-05-29 20:25:58 EDT, sha256 `2200a440...ca70` |
| `data/` logs | 3 (35,995 / 10,236 / 109,395 B) |
| Ignition | 10 files across chain-1 and chain-11155111; 4 git-tracked; 8 mandatory-derived |
| `.bot-state.json.bak` | 89 B (2026-03-22) |
| Live DB after the backup | hashes and mtimes unchanged (re-hashed after commit `7f4c7a2`) |

The MANIFEST stores mtimes in UTC, so wal/shm read `2026-05-30T00:25:58Z`. That is 2026-05-29 20:25:58 local time and not newer than the 2026-05-29 fact, so the plan's operator-escalation condition did not trigger.

## Decisions Made

- **Artifact naming rule (re-measured on disk as the plan required):** for every future id `X` in `deployed_addresses.json`, Ignition wrote both `artifacts/X.json` and `artifacts/X.dbg.json`, and both are now mandatory. On this repo `X = HoneypotCheckerModule#HoneypotChecker` on both chains.
- **Local date for folder names:** the dated folder is `2026-11-06`, the operator's local date, even though UTC had already rolled over to 2026-11-07.
- **Torn check covers every file:** all 17 files are compared before and after the copy, not only the DB set. The bytes written to the copy are hashed in the same pass and must equal the before-hash.
- **Destination is never created by the script:** a typo in `--dest` therefore fails instead of making a stray folder. The repo and OneDrive refusals run before any write. Destinations are resolved through the nearest existing ancestor, so a junction pointing into OneDrive would also be refused.
- **Archive members are inspected before extraction:** only plain files and directories, relative names, one top-level folder. The `--verify` temp folder is removed with a link-safe remover.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Self-check case (g) OneDrive predicate was hollow**
- **Found during:** Task 1, while mutation-testing the self-check.
- **Issue:** With the OneDrive refusal disabled, case (g) still passed. Its predicate `r.includes('OneDrive')` also matched the fallback "destination ... does not exist" message, because the test path itself contains `OneDrive`.
- **Fix:** both (g) predicates now match the refusal text itself (`a OneDrive folder that is local-only` and `is inside the source repo`).
- **Verification:** the OneDrive mutant and a new in-repo mutant both turn (g) FAIL, and the unmutated control passes 12/12.
- **Committed in:** `3f380bf` (the fix landed before the Task 1 commit).

**2. [Rule 2 - Missing critical] Extra self-check cases (k) and (l), plus a P1 guard**
- **Found during:** Task 1.
- **Issue:** the plan's cases do not isolate the git-tracked cross-check (k) or prove the PRESENT-or-ABSENT listing for wal/shm (l). Nothing in the build refused a `.env*` file inside the backed-up trees.
- **Fix:**
  - Case (k): a tracked build-info file is deleted from disk while still in the index, and the build must FAIL.
  - Case (l): a fixture without wal/shm must build, with both listed as ABSENT.
  - Any entry whose basename starts with `.env` now FAILS (P1 / NAC-01 defence in depth).
- **Committed in:** `3f380bf`.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical). **Impact:** both make the plan's own guarantees stronger; no scope creep.

## Issues Encountered

Each oddity was diagnosed before moving on:
- **`LF will be replaced by CRLF` warnings on commit:** caused by `core.autocrlf=true` (documented in RESEARCH). The committed blobs are LF, and the script's blob hash equals the working-tree hash.
- **First platform probe hit a SyntaxError:** a bash heredoc halved the backslashes. The probe was rewritten with the Write tool. This was scratchpad only.
- **First mutation run printed nothing:** outside the repo there is no `"type": "commonjs"`, so Node treated the `.ts` copies as ESM. The mutants were transpiled to CJS and run with a control. This was scratchpad only.
- **A `node.exe` (PID 14828) was running during the backup:** it is the Playwright MCP server (`@playwright/mcp/cli.js`), not the bot.
- **The script is 1,399 lines:** longer than first estimated. The count is verified, and the file is pure LF.
- **Ordering held:** no `npm install`/`ci`/`rebuild`, Hardhat, Vitest, `npm test`, `git clean`, or SQLite open of `data/` happened. No commit in `phase_start_sha..HEAD` touches `package-lock.json` or `hardhat.config.ts` (AC-02).

## User Setup Required

None in this plan. The Google Drive upload and download-back is plan 22-03.

## Next Phase Readiness

- **22-02 (secret scan):** scan `C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06` and the archive.
- **22-03 (off-machine copy):** upload `crypto-snipe-bot-state-2026-11-06.tar.gz`, download it into a fresh temp folder, then run `backup-state.ts --verify <downloaded> --expected-sha 4c8e9ab6a70b93a4d408046bebe916d29c95f93cacb47d0b50abcddfb07a1d1a`.
- **OD-21 commit:** AC-07 compares git blobs against the manifest's 10 Ignition entries, which are recorded in MANIFEST.json.
- **22-29 seal:** NAC-03 compares the live DB-set hashes against `backup-record.json` `db_set`.
- The backup folder and archive are left in place, as the plan requires.

## Self-Check: PASSED

- FOUND: `.planning/baselines/phase-start.json`, `scripts/backup-state.ts`, `.planning/baselines/backup-record.json`, and the backup folder, archive and `.sha256`.
- FOUND commits on this branch: `df33999`, `3f380bf`, `7f4c7a2`. The measured count of 3 equals `git rev-list --count 23a6461..HEAD`.
- Acceptance criteria re-run: Task 1 (7/7) and Task 2 (5/5) all PASS. The plan-level `<verification>` items all PASS.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-06*
