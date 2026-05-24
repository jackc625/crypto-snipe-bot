---
phase: 20-going-live-ops-hardening
plan: 07
subsystem: operator-handoff-runbook + CI-guard
tags: [docs, ops-live, runbook, ci-guard, root-doc-ban, d-runbook-move, d-briefing-delete, d-operator-handoff, d-audit-trail, atomic-commit, phase-20-close]

# Dependency graph
requires:
  - 20-02 (preflight.ts — content for Preflight failure modes section)
  - 20-04 (D-PAUSED-RESTART operator runbook content for Pause/resume CLI section)
  - 20-05 (CLI bin names — npm bin documentation for npm run preflight | pause | resume)
provides:
  - docs/operations/going-live.md consolidated operator runbook (~547 LOC: ~250 moved + ~297 D-OPERATOR-HANDOFF additions)
  - .github/workflows/test.yml "Ban root-level operator-facing docs" CI guard step (evergreen)
  - test/unit/ci/rootFileGuard.test.ts vitest self-test (Blocker 2 / Wave 5 sampling-gap fix)
  - README.md updated to link docs/operations/going-live.md + Phase 20 status flipped from partial → shipped
affects:
  - Phase 20 close — all 13 OPS-LIVE requirements satisfied
  - Future contributors — root-level GOING-LIVE.md and HONEYPOT-SIM-BRIEFING.md cannot reappear (CI-enforced)
  - Phase 21 EXIT-LIVE — operator can follow docs/operations/going-live.md end-to-end for live mainnet handoff

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — composition of installed primitives (fs, path, vitest, GitHub Actions shell)
  patterns:
    - "Atomic single-commit per D-RUNBOOK-MOVE: doc move + briefing delete + README updates + CI guard YAML all in one commit (44de14f)"
    - "test ! -e (file-or-directory existence check) per Plan 20-07 Task 3 spec — strictly broader than `test ! -f` and catches the directory-collision edge case"
    - "CI guard step placement between .todo ban (line 20) and TypeScript-check (line 46) so the guard fires within seconds of build start, not after 30s of tsc x 3"
    - "vitest self-test of CI workflow content: synchronous fs.readFileSync against the real workflow file on disk (mirrors test/unit/db/lpBaselineMigration.test.ts shape)"

key-files:
  created:
    - "docs/operations/going-live.md (547 LOC — 250 moved content + 297 D-OPERATOR-HANDOFF additions in 5 sections)"
    - "test/unit/ci/rootFileGuard.test.ts (97 LOC, 4 active it() blocks)"
    - ".planning/phases/20-going-live-ops-hardening/20-07-SUMMARY.md (this file)"
  modified:
    - "README.md (+24 LOC net: 5 link updates from ./GOING-LIVE.md → ./docs/operations/going-live.md, Phase 20 status flipped partial → shipped, Project Structure entry updated)"
    - ".github/workflows/test.yml (+13 LOC: new 'Ban root-level operator-facing docs' step between .todo ban and tsc check)"
  deleted:
    - "GOING-LIVE.md (root — content moved verbatim to docs/operations/going-live.md)"
    - "HONEYPOT-SIM-BRIEFING.md (root — content preserved in .planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md per Phase 18 D-BRIEFING-DISPOSITION; deleted per Phase 20 D-BRIEFING-DELETE)"
  relocated:
    - "readme-prompt.md → .claude/scratch/readme-prompt.md (gitignored per .gitignore:59 — operator scratch retained off the dirty tree)"

key-decisions:
  - "Plan 20-07 (2026-05-24) — `git mv` / `git rm` adaptation: GOING-LIVE.md and HONEYPOT-SIM-BRIEFING.md were UNTRACKED (never in git history), so `git mv GOING-LIVE.md docs/operations/going-live.md` and `git rm HONEYPOT-SIM-BRIEFING.md` would fail with 'not under version control.' Adapted to Write+rm: created docs/operations/going-live.md with the original content + Phase 20 additions in a single Write, then deleted the working-tree copies via `rm`. The D-AUDIT-TRAIL invariant (preserve git history via `git mv --follow`) is moot because no git history existed to preserve. Outcome is identical: atomic single-commit per D-RUNBOOK-MOVE, content preserved, root-doc absence enforced by CI."
  - "Plan 20-07 (2026-05-24) — Task 1 + Task 2 collapsed into a single atomic commit (44de14f). Plan describes Task 2 as appending 5 D-OPERATOR-HANDOFF sections AFTER Task 1 moves the file. Since the file was untracked, the most semantically correct path was a single Write of all content (250 moved + ~297 Phase 20 additions) plus deletions, satisfying D-RUNBOOK-MOVE's 'atomic single-commit' invariant (frontmatter must_haves.truths line 28) more cleanly than a 2-step move-then-append. All Task 2 acceptance criteria pass against the resulting file."
  - "Plan 20-07 (2026-05-24) — `test ! -e` over `test ! -f`: Plan 20-07 Task 3 <action> last paragraph explicitly directs Task 1's YAML to use `-e` (existence; file-or-directory) so the Task 3 self-test passes on first run. Adopted in Task 1's commit. -e is strictly broader: catches the edge case where someone accidentally creates `GOING-LIVE.md/` as a directory (which `-f` would silently pass)."
  - "Plan 20-07 (2026-05-24) — readme-prompt.md relocated to .claude/scratch/ (gitignored) rather than deleted per spawn-prompt 'do NOT delete it' guidance. The .claude/ directory is gitignored per .gitignore:59 ('# Agent / tooling local state'), so the file is now off the dirty working tree without losing the operator scratch content. CI guard does not need to grandfather it because it's never in git."

patterns-established:
  - "Operator-facing docs canonical location: docs/operations/. Anything operator-facing (runbooks, troubleshooting guides, env-tuning protocols) goes here. The 'Ban root-level operator-facing docs' CI guard makes this evergreen — re-introduction at the repo root fails the build with a clear remediation message."
  - "Self-testing CI guards: any future CI invariant (like the .todo ban, the root-doc ban, the tsc x 3) should have a vitest self-test reading the workflow YAML and asserting structural properties. Catches the worst-case 'guard accidentally removed during workflow refactor' regression before it reaches CI."

requirements-completed: [OPS-LIVE-12, OPS-LIVE-13]

# Metrics
duration: ~5min (Plan 20-07 ran fast — Task 1 + Task 2 collapsed into one Write; Task 3 was GREEN on first run because Task 1's YAML already shipped with `-e`)
completed: 2026-05-24
files_created: 2 production + 1 SUMMARY
files_modified: 2
files_deleted: 2 root + 1 relocated to gitignored
loc_added: ~661 net (547 going-live.md + 97 rootFileGuard.test.ts + 24 README + 13 workflow - 7 README old wording)
tests_added: 4 (rootFileGuard.test.ts)
commits: 2 task commits + 1 final tracking commit
---

# Phase 20 Plan 20-07: Consolidate Going-Live Runbook to docs/operations/ + CI Guard — Summary

## One-liner

Atomic relocation of `GOING-LIVE.md` → `docs/operations/going-live.md` (547 LOC consolidated: 250 moved content + 297 Phase 20 D-OPERATOR-HANDOFF additions across 5 sections — preflight failure modes, pause/resume CLI, mid-run wallet undercut recovery, anti-rug live-gate flip procedure, RPC/MEV/checker troubleshooting); delete `HONEYPOT-SIM-BRIEFING.md` (content preserved in Phase 18 CONTEXT.md); add evergreen CI guard `.github/workflows/test.yml` "Ban root-level operator-facing docs" step using `test ! -e` (file-or-dir existence); vitest self-test `test/unit/ci/rootFileGuard.test.ts` (4/4 pass) closes Blocker 2 sampling gap for OPS-LIVE-12. **Phase 20 COMPLETE — 8 of 8 plans shipped.**

## Performance

- **Duration:** ~5 min (Task 1 + Task 2 collapsed into one Write per D-RUNBOOK-MOVE atomic invariant; Task 3 GREEN on first run)
- **Started:** 2026-05-24T23:08Z
- **Completed:** 2026-05-24T23:13Z
- **Tasks:** 3/3
- **Files modified:** 2 (README.md + .github/workflows/test.yml)
- **Files created:** 2 production (docs/operations/going-live.md + test/unit/ci/rootFileGuard.test.ts) + 1 SUMMARY
- **Files deleted:** 2 (GOING-LIVE.md + HONEYPOT-SIM-BRIEFING.md — both untracked, so no `git rm` required)
- **Files relocated:** 1 (readme-prompt.md → .claude/scratch/ per gitignore:59)
- **Net LOC added:** ~661

## Pre/Post File Presence

| File | Pre-Plan | Post-Plan | How |
|------|----------|-----------|-----|
| `GOING-LIVE.md` (root) | Present (untracked, 251 lines) | **Gone** | Filesystem delete (was untracked, so no `git rm` required) |
| `HONEYPOT-SIM-BRIEFING.md` (root) | Present (untracked, 139 lines) | **Gone** | Filesystem delete per D-BRIEFING-DELETE (was untracked; content preserved in `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md` per Phase 18 D-BRIEFING-DISPOSITION) |
| `docs/operations/going-live.md` | Absent | **Present (547 LOC)** | Written with 250 moved content + 297 Phase 20 additions |
| `test/unit/ci/rootFileGuard.test.ts` | Absent | **Present (97 LOC, 4 it() blocks)** | Self-test of CI guard YAML |
| `readme-prompt.md` (root) | Present (untracked, 173 lines) | Relocated to `.claude/scratch/` (gitignored) | `mv` per spawn-prompt "do NOT delete it" guidance |

## Git History Status

**`git log --follow docs/operations/going-live.md`** does NOT show pre-move commits because GOING-LIVE.md was **never tracked in git history** prior to Plan 20-07. This is a deliberate adaptation of D-AUDIT-TRAIL:

- The plan's D-AUDIT-TRAIL invariant ("git mv preserves rename history; `git log --follow` traces across the move") presumed the file was already tracked.
- Pre-plan check: `git log --all --oneline --follow -- GOING-LIVE.md` returned empty — the file lived as an untracked working-tree artifact.
- Outcome: D-AUDIT-TRAIL is moot here (no history to preserve); the audit trail starts fresh with commit 44de14f and the file is now tracked at its canonical location.

The same applies to HONEYPOT-SIM-BRIEFING.md — never tracked, so the "delete recorded in git" semantic is implicit (the file simply was never in any git tree). The CI guard prevents either file from being re-introduced.

## LOC Count Breakdown

- **Pre-plan GOING-LIVE.md:** 251 lines (untracked)
- **Phase 20 D-OPERATOR-HANDOFF additions:** ~297 lines across 5 new sections:
  - Preflight failure modes (7 subsections — 1 per check function): ~140 lines
  - Pause/resume CLI usage: ~55 lines
  - Mid-run wallet undercut recovery: ~45 lines
  - Anti-rug live-gate flip procedure (cross-link to anti-rug-rollout.md): ~25 lines
  - RPC/MEV/checker validation troubleshooting: ~75 lines
- **Plus footer + intra-section formatting:** ~- 1 line (slight compression from collapsing 251 + 297 to 547 due to consolidated separator/spacing)
- **Combined:** 547 LOC (`wc -l` verified; plan acceptance criteria required ≥ 380)

## 5 D-OPERATOR-HANDOFF Section Header Confirmation

`grep -cE "^## (Preflight failure modes|Pause/resume CLI usage|Mid-run wallet undercut recovery|Anti-rug live-gate flip procedure|RPC/MEV/checker validation troubleshooting)" docs/operations/going-live.md` → **5** ✓

All 5 sections present in canonical order with `## ` h2 prefix matching the regex. Each section:

| Section | Content highlights |
|---------|---------------------|
| **Preflight failure modes** | 7 subsections (one per preflight check function: checkRpcChainId, checkRpcBlockAge, checkWalletBalance with explicit D-BALANCE-FLOOR formula + worked example for 0.0124 ETH funding, checkMevHealth, checkHoneypotCheckerCode, validateCrossEnvRules, checkAntiRugLiveGate). Each subsection: WHAT triggers FATAL + WHY + REMEDIATION + example pino log line |
| **Pause/resume CLI usage** | When to pause + when NOT to pause (emergency-sell anti-pattern), CLI usage (`npm run pause -- --reason "..."` / `npm run resume`), dashboard banner walkthrough, restart survival per D-PAUSED-RESTART, audit trail via `sqlite3` |
| **Mid-run wallet undercut recovery** | Triggers (D-BALANCE-FLOOR floor with formula), automatic actions (pause flag flip + WS broadcast + Telegram + pino fatal + exit monitors keep running), 4-step recovery procedure, anti-patterns (NEVER manually edit pause_state) |
| **Anti-rug live-gate flip procedure** | Pre-requisites (7-day floor + 0 confirmed FPs), action (3 steps with `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` exact-lowercase + restart), cross-link to docs/operations/anti-rug-rollout.md for full procedure + docs/operations/anti-rug-tuning.md for tuning |
| **RPC/MEV/checker validation troubleshooting** | Per-symptom remediation: RPC chainId mismatch + stale block + per-chain block-age tolerance table; MEV Flashbots + bloXroute + passthrough chain notes; HoneypotChecker getCode='0x' (run scripts/deploy-honeypot-checker.ts); stale-data warnings (not FATAL) with STALE_WARN_SEC + STALE_ERROR_SEC defaults |

## README.md Old-vs-New Link Diff

| Line | Pre-Plan | Post-Plan |
|------|----------|-----------|
| 23 | "GOING-LIVE.md exists at the repo root with wallet pre-flight... move to docs/operations/ ... pending" | "Shipped in v6.17 Phase 20: going-live ops hardening. Fail-closed preflight... consolidated operator runbook at [docs/operations/going-live.md](./docs/operations/going-live.md)..." |
| 277 | "The runbook (GOING-LIVE.md) is explicit that the polling fallback misses most launches" | "The runbook (docs/operations/going-live.md) is explicit that the polling fallback misses most launches" |
| 310 | "Both bugs are documented in HONEYPOT-SIM-BRIEFING.md at the repo root and motivated the v6.17 milestone." | "Both bugs motivated the v6.17 milestone; the original briefing was preserved in .planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md (per Phase 18 D-BRIEFING-DISPOSITION) and superseded by the Phase 18 rebuild that ships today." |
| 449 | "Going-live ops hardening (Phase 20 OPS-LIVE, partial). GOING-LIVE.md at the repo root..." | "Going-live ops hardening (Phase 20 OPS-LIVE, shipped). Fail-closed preflight... CI guard..." |
| 464-465 | "- GOING-LIVE.md — first-time live-mainnet setup runbook... pending Phase 20.\n- HONEYPOT-SIM-BRIEFING.md — write-up..." | "- docs/operations/ — operator-facing runbooks. Contains going-live.md... Root-level operator docs are banned by .github/workflows/test.yml..." |
| 508 | "The GOING-LIVE.md runbook at the repo root walks through..." | "The [docs/operations/going-live.md](./docs/operations/going-live.md) runbook walks through... preflight failure modes + remediation, pause/resume CLI usage, mid-run wallet undercut recovery, the anti-rug live-gate flip procedure..." |

- `grep -c "\./GOING-LIVE.md" README.md` → **0** ✓ (old link form gone)
- `grep -c "docs/operations/going-live.md" README.md` → **4** ✓ (new link form present)

## CI Workflow Before/After Step Location

`awk '/Ban .todo test stubs/{p=NR}/Ban root-level operator-facing docs/{q=NR}/TypeScript check/{r=NR;exit}END{print p, q, r}' .github/workflows/test.yml` → **p=20 q=34 r=46** (p < q < r ✓ guard inserted in correct position)

```yaml
   20 |     - name: Ban .todo test stubs           # existing Phase 17 guard
   ...
   34 |     - name: Ban root-level operator-facing docs   # NEW Plan 20-07
   35 |       run: |
   36 |         test ! -e GOING-LIVE.md || ...
   37 |         test ! -e HONEYPOT-SIM-BRIEFING.md || ...
   ...
   46 |     - name: TypeScript check (root tsconfig.json)
```

Guard runs in milliseconds (filesystem existence checks) and fails the build BEFORE the ~30-second `tsc --noEmit ×3` block — operator gets a clear error message ~10 seconds into the build instead of ~45 seconds.

## Acceptance Criteria Verification

### Task 1

| Criterion | Result |
|-----------|--------|
| `test ! -f GOING-LIVE.md` exits 0 | ✓ PASS |
| `test ! -f HONEYPOT-SIM-BRIEFING.md` exits 0 | ✓ PASS |
| `test -f docs/operations/going-live.md` exits 0 | ✓ PASS |
| `git log --follow docs/operations/going-live.md \| head -5` shows commits from BEFORE the move | **N/A** — file was untracked pre-plan; D-AUDIT-TRAIL adapted per Decisions log above |
| `grep -c "./GOING-LIVE.md" README.md` returns 0 | ✓ PASS (0) |
| `grep -c "docs/operations/going-live.md" README.md` >= 1 | ✓ PASS (4) |
| `grep -c "Ban root-level operator-facing docs" .github/workflows/test.yml` returns 1 | ✓ PASS (1) |
| `grep -c "GOING-LIVE.md reappeared" .github/workflows/test.yml` returns 1 | ✓ PASS (1) |
| `grep -c "HONEYPOT-SIM-BRIEFING.md reappeared" .github/workflows/test.yml` returns 1 | ✓ PASS (1) |
| Guard step between .todo ban and tsc checks (p<q<r) | ✓ PASS (p=20, q=34, r=46) |
| Outside-of-.planning references to HONEYPOT-SIM-BRIEFING.md = 0 (excluding guard self-reference + README's description of what the guard prevents) | ✓ PASS — only matches are the guard itself + README's prose about the guard, no actual links to the deleted file |

### Task 2

| Criterion | Result |
|-----------|--------|
| 5 new section headers `grep -cE "^## (Preflight ... troubleshooting)" docs/operations/going-live.md` returns 5 | ✓ PASS (5) |
| Each preflight check failure mode named (grep returns ≥ 7) | ✓ PASS (17) |
| CLI commands present (`npm run pause|resume|preflight`, ≥ 3) | ✓ PASS (7) |
| D-BALANCE-FLOOR formula explicit (≥ 1) | ✓ PASS (2) |
| Anti-rug cross-link (`anti-rug-rollout.md`, ≥ 1) | ✓ PASS (6) |
| Stale-data threshold reference (≥ 1) | ✓ PASS (2) |
| 7-day floor referenced (≥ 1) | ✓ PASS (7) |
| `Last updated:` footer (≥ 1) | ✓ PASS (1) |
| Total LOC ≥ 380 | ✓ PASS (547) |
| Pre-move 251-line content preserved (`grep "First-time setup for live trading on Ethereum mainnet"` ≥ 1) | ✓ PASS (1) |

### Task 3

| Criterion | Result |
|-----------|--------|
| `test/unit/ci/rootFileGuard.test.ts` exists with 4+ active it() blocks, 0 skip/todo | ✓ PASS (4 active, 0 skip) |
| Test reads `.github/workflows/test.yml` (path constant present, ≥ 1) | ✓ PASS (2) |
| Test asserts step name + both file-absence checks (≥ 3) | ✓ PASS (6) |
| `.github/workflows/test.yml` uses `test ! -e` for GOING-LIVE.md (≥ 1) | ✓ PASS (1) |
| `.github/workflows/test.yml` uses `test ! -e` for HONEYPOT-SIM-BRIEFING.md (≥ 1) | ✓ PASS (1) |
| `npx vitest run --project unit test/unit/ci/rootFileGuard.test.ts` exits 0 with 4/4 passing | ✓ PASS (4/4 in 506ms) |
| `npx tsc --noEmit -p tsconfig.json` exits 0 | ✓ PASS |
| Full unit suite no regressions: `npx vitest run --project unit` exits 0 | ✓ PASS (57 files, 567 passed, 0 fail) |

### Plan-level verification

| Criterion | Result |
|-----------|--------|
| Both root files gone, new doc present | ✓ |
| README links updated | ✓ |
| CI guard step in correct location and matches exact filenames | ✓ |
| docs/operations/going-live.md has all 5 D-OPERATOR-HANDOFF sections + cross-links | ✓ |
| Atomic commit: move + delete + README + CI workflow + content additions all in commit 44de14f | ✓ |
| `npx tsc --noEmit -p tsconfig.bot.json` exits 0 | ✓ |
| `npx tsc --noEmit -p dashboard/tsconfig.json` exits 0 | ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking infra] `git mv` / `git rm` adaptation: untracked source files**
- **Found during:** Task 1 first git status check
- **Issue:** Plan PLAN.md Task 1 `<action>` step 1 directs `git mv GOING-LIVE.md docs/operations/going-live.md` and step 2 directs `git rm HONEYPOT-SIM-BRIEFING.md`. Both files were **untracked** in the working tree — `git ls-files | grep -i "GOING-LIVE\|HONEYPOT-SIM"` returned empty, `git log --all --oneline -- GOING-LIVE.md` returned empty. The two git commands would fail with "fatal: not under version control."
- **Fix:** Adapted to Write+rm:
  1. `Write` the new `docs/operations/going-live.md` with the original 250 lines of content PLUS the Phase 20 D-OPERATOR-HANDOFF additions (atomic with Task 2 — see deviation #2 below).
  2. `rm GOING-LIVE.md HONEYPOT-SIM-BRIEFING.md` — filesystem-level deletion of the untracked files. No `git rm` needed because the files were never staged.
  3. `mv readme-prompt.md .claude/scratch/readme-prompt.md` — relocated the third untracked root file per spawn-prompt's "do NOT delete it" guidance to a gitignored location (`.claude/` is in `.gitignore:59`).
- **Outcome:** Same end-state as plan — root files gone, docs/operations/going-live.md present, atomic single-commit per D-RUNBOOK-MOVE. D-AUDIT-TRAIL invariant is moot here (no git history existed pre-plan to preserve).
- **Files modified:** GOING-LIVE.md (deleted), HONEYPOT-SIM-BRIEFING.md (deleted), docs/operations/going-live.md (created), readme-prompt.md (moved to .claude/scratch/)
- **Commit:** 44de14f

**2. [Rule 3 - Blocking infra] Task 1 + Task 2 collapsed into a single atomic commit**
- **Found during:** Task 1 execution decision-point — D-RUNBOOK-MOVE invariant (frontmatter must_haves.truths line 28) requires "Atomic single-commit per D-RUNBOOK-MOVE: git mv + git rm + content update + README update happen together"
- **Issue:** PLAN.md describes Task 2 as appending the 5 D-OPERATOR-HANDOFF sections AFTER Task 1 moves the file (move-first-then-update per D-AUDIT-TRAIL). But since the file was untracked (deviation #1 above), there is no "move" step to separate from the content authoring — both happen in one Write.
- **Fix:** Authored all 547 LOC of `docs/operations/going-live.md` (250 moved content + ~297 Phase 20 additions in 5 sections) in a single Write at the start of Task 1. Committed atomically with the deletions + README updates + CI guard insertion as commit 44de14f.
- **Outcome:** More cleanly satisfies the D-RUNBOOK-MOVE atomic invariant than the plan's described 2-commit move-then-append flow would have. All Task 2 acceptance criteria pass against the resulting file (see Acceptance Criteria table above).
- **Files modified:** docs/operations/going-live.md (single Write)
- **Commit:** 44de14f (same as Task 1)

**3. [Rule 3 - Blocking infra] Initial Task 1 CI guard YAML uses `-e` not `-f` per Plan 20-07 Task 3 spec**
- **Found during:** Task 1 CI guard authoring — Plan PLAN.md Task 1 `<action>` step 4 shows the YAML using `test ! -e` (file-or-directory existence), but the plan's `automated` verify gate (line 171) uses `test ! -f` (regular-file-only).
- **Issue:** The two semantics diverge: `-e` is strictly broader (catches the directory-collision edge case where someone accidentally creates `GOING-LIVE.md/` as a directory). Task 3 `<action>` last paragraph explicitly directs "update Task 1's CI guard YAML in .github/workflows/test.yml to use -e instead of -f."
- **Fix:** Used `test ! -e` in the initial Task 1 commit so Task 3's self-test passes on first run. The `-f`-based grep in the `automated` verify gate also passes for the existing test environment (no directory shadowing GOING-LIVE.md exists). Both flavors satisfy the existence check; `-e` is correct per the Task 3 spec.
- **Files modified:** .github/workflows/test.yml (used `test ! -e` from the start)
- **Commit:** 44de14f

### No Other Deviations

All other Plan 20-07 acceptance criteria passed on first run. No fix-in-flights for the test file (Task 3 was GREEN on first vitest run because Task 1 used `-e` per Task 3's spec).

## Authentication Gates

None. Plan 20-07 is pure docs + CI workflow + vitest self-test with no live-network, external-auth, or secret-rotation dependencies.

## Issues Encountered

- **Three untracked root files** in the working tree (GOING-LIVE.md + HONEYPOT-SIM-BRIEFING.md + readme-prompt.md) discovered at start of plan. Spawn-prompt explicitly addressed the readme-prompt.md handling. Other two handled via deviation #1.
- **No regressions** in the unit suite (57 files, 567 passed, 0 fail) or tsc x 3 (all clean). The new test/unit/ci/ directory falls under the existing `test/unit/**/*.test.ts` glob in vitest.config.ts — no config change needed.

## Self-Check: PASSED

- [x] `docs/operations/going-live.md` exists with 547 LOC — VERIFIED (`test -f` + `wc -l`)
- [x] `test/unit/ci/rootFileGuard.test.ts` exists with 4 active it() blocks — VERIFIED (grep `it(` returns 4, grep `it.skip|it.todo` returns 0)
- [x] `.github/workflows/test.yml` contains "Ban root-level operator-facing docs" step — VERIFIED (grep returns 1)
- [x] `GOING-LIVE.md` and `HONEYPOT-SIM-BRIEFING.md` no longer exist at root — VERIFIED (`test ! -f` returns 0 for both)
- [x] `README.md` updated: 0 `./GOING-LIVE.md` references, 4 `docs/operations/going-live.md` references — VERIFIED
- [x] Commit `44de14f` exists (Task 1 + Task 2 atomic) — VERIFIED via `git log --oneline -3`
- [x] Commit `4998d93` exists (Task 3 vitest self-test) — VERIFIED via `git log --oneline -3`
- [x] Zero deletions in either commit's diff (untracked files = no git delete record) — VERIFIED (`git diff --diff-filter=D` returns empty for both)
- [x] Full unit suite no regressions: 57 files / 567 passed / 0 fail — VERIFIED
- [x] tsc clean x 3 (root + bot + dashboard tsconfig) — VERIFIED
- [x] Task 3 self-test 4/4 passing in 506ms — VERIFIED

## Hand-off Notes

### Phase 20 — COMPLETE

This is the final plan of Phase 20 (8 of 8 plans shipped: 20-00, 20-01, 20-02, 20-03, 20-04, 20-05, 20-06, 20-07). Every OPS-LIVE-NN requirement is satisfied:

| Requirement | Plan(s) | Status |
|---|---|---|
| OPS-LIVE-01 (preflight call wiring) | 20-02 + 20-04 | ✓ Shipped |
| OPS-LIVE-02 (wallet undercut FATAL + mid-run pause) | 20-01 + 20-02 + 20-04 | ✓ Shipped |
| OPS-LIVE-03 (RPC block-age check) | 20-02 | ✓ Shipped |
| OPS-LIVE-04 (MEV health) | 20-02 | ✓ Shipped |
| OPS-LIVE-05 (HoneypotChecker code-at-address) | 20-02 | ✓ Shipped |
| OPS-LIVE-06 (stale-data thresholds) | 20-01 + 20-02 | ✓ Shipped |
| OPS-LIVE-07 (anti-rug 7-day live-gate) | 20-02 + 20-03 | ✓ Shipped |
| OPS-LIVE-08 (kill-switch CP1/2/3 V2 + V3) | 20-01 + 20-04 | ✓ Shipped |
| OPS-LIVE-09 (dashboard pause endpoints + banner) | 20-01 + 20-05 + 20-06 | ✓ Shipped |
| OPS-LIVE-10 (npm run preflight CLI) | 20-02 + 20-05 | ✓ Shipped |
| OPS-LIVE-11 (npm run pause / resume CLIs) | 20-05 | ✓ Shipped |
| **OPS-LIVE-12 (going-live.md move + CI guard)** | **20-07** | **✓ Shipped (this plan)** |
| **OPS-LIVE-13 (HONEYPOT-SIM-BRIEFING.md disposition)** | **20-07** | **✓ Shipped (deleted per D-BRIEFING-DELETE)** |

### Phase 21 (EXIT-LIVE) is unblocked

Phase 21 verification artifacts (Etherscan tx hashes, dashboard screenshots, log excerpts for all 6 deferred v6.16 items) can be captured against a bot that now has:

- Fail-closed preflight catching every configuration regression before chain-context creation.
- SQLite-persisted pause flag the operator can flip from CLI / dashboard / mid-run undercut detector.
- Operator-handoff doc (`docs/operations/going-live.md`) covering preflight failures + remediation + pause/resume + mid-run undercut recovery + RPC/MEV/checker troubleshooting.
- CI guards (Phase 17 `.todo` ban + Phase 17 `tsc x 3` + Phase 18 `contracts/**` audit gate + **Phase 20 root-doc ban**) locking the v6.17 invariants evergreen.

The bot is **production-ready per the runbook + preflight + pause/resume + dashboard banner + CI guard stack**. Phase 21 captures the real-mainnet artifacts that prove every claim.

### Smoke note

Phase 20 operator handoff complete. Operator can now:
1. Run `npm run preflight` to verify every chain's readiness without starting the bot.
2. Start the bot via `npx ts-node src/bot.ts` knowing preflight catches every configuration regression before chain-context creation.
3. Manage pause state via `npm run pause | resume` or the dashboard banner — no manual SQLite edits required.
4. Follow `docs/operations/going-live.md` for any preflight failure mode, mid-run undercut event, or troubleshooting scenario.
5. Hand off to Phase 21 EXIT-LIVE for real-mainnet artifact verification.

## Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | `44de14f` | docs | Task 1 + Task 2 atomic — consolidate going-live runbook to docs/operations/ + delete root briefing + README updates + CI guard YAML insertion + 5 D-OPERATOR-HANDOFF section authoring |
| 2 | `4998d93` | test | Task 3 — vitest self-test of root-doc CI guard YAML (4/4 GREEN on first run) |

(Final tracking commit with SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md updates follows.)

---

*Phase: 20-going-live-ops-hardening*
*Plan: 20-07*
*Completed: 2026-05-24*
*Phase 20 STATUS: **COMPLETE** — 8 of 8 plans shipped*
