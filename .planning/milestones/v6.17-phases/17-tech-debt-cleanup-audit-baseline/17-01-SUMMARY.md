---
phase: 17-tech-debt-cleanup-audit-baseline
plan: 01
subsystem: planning
tags: [audit, baseline, ci, tech-debt, verify-then-act]

requires:
  - phase: v6.16-MILESTONE-AUDIT
    provides: 11 tech_debt: items needing per-claim verify-then-act closure
provides:
  - .planning/milestones/v6.17-debt-baseline.md — wave-0 ground-truth baseline doc
  - 11-item per-claim ledger closing v6.16 audit tech_debt: lines 14-37
  - Branch A close-out for DEBT-03 (.todo verified-empty) and DEBT-04 (tsc clean 3/3)
  - Frontmatter values (todo_count: 0, tsc_clean: 3/3) consumed by Plan 17-03 CI invariant lock
affects:
  - 17-02 (retroactive Nyquist — depends on 17-01 baseline confirmation)
  - 17-03 (cleanup + CI invariants — uses ledger row for getTradesByToken hand-off)

tech-stack:
  added: []
  patterns:
    - Wave-0 baseline doc convention (mirrors v6.16-MILESTONE-AUDIT.md frontmatter shape)
    - Per-claim verify-then-act ledger (verbatim claim quote + verification command + literal stdout + disposition)

key-files:
  created:
    - .planning/milestones/v6.17-debt-baseline.md
  modified: []

key-decisions:
  - "Branch A path: wave-0 confirmed 0 .todo matches and tsc-clean 3/3 — DEBT-03 and DEBT-04 close as verified-empty rather than enumerated remaining work."
  - "v6.16-MILESTONE-AUDIT.md tech_debt: items 9 of 11 verified-resolved at execution; 2 still-valid (Phase 16 missing VERIFICATION.md as audit-grade documentation gap; getTradesByToken handed to Plan 17-03 for action)."
  - "Verbatim-claim rule honored: every ledger row's Claim cell is the unaltered string from v6.16-MILESTONE-AUDIT.md lines 14-37."

patterns-established:
  - "Pattern: Wave-0 baseline-first protocol (D-05) — pre-scout is informational; execution-time stdout is the committed artifact."
  - "Pattern: Per-claim verify-then-act ledger (D-11) — every audit claim gets a verification command + literal stdout + explicit disposition before any act-step runs."

requirements-completed:
  - DEBT-01
  - DEBT-02
  - DEBT-03  # closed as verified-empty (Branch A)
  - DEBT-04  # closed as verified-empty (Branch A)

duration: 8min
completed: 2026-04-30
---

# Phase 17 / Plan 01: Baseline & Close Evidence Summary

**Wave-0 CI baseline committed; DEBT-01..04 close as verified-empty; 11-item v6.16 audit ledger resolved with 9 verified-resolved + 2 still-valid (1 deferred audit-grade doc gap, 1 handed to Plan 17-03).**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-04-30
- **Tasks:** 3 (Task 1 + Task 2 + Task 3 human-verify checkpoint)
- **Files created:** 1

## Accomplishments

- Wave-0 CI commands executed fresh: `find test/ -name '*.todo*'` (0), `grep -rEn '\.todo\(' test/` (0), `npx tsc --noEmit` × 3 tsconfigs (all exit 0), `grep getTradesByToken src/utils/db.ts` (line 215 STILL present)
- `.planning/milestones/v6.17-debt-baseline.md` written and committed with literal stdout, frontmatter (`todo_count: 0`, `tsc_clean: 3/3`), per-claim ledger (11 verbatim rows from v6.16-MILESTONE-AUDIT.md lines 14-37), and Branch A close-out
- DEBT-03 ("37 .todo test stubs") and DEBT-04 ("6 TS errors in API route files") closed as verified-empty with audit-claim cross-references — disputed claims marked STALE with literal CI evidence
- One ledger item (Phase 16 `getTradesByToken` at db.ts:215) handed to Plan 17-03 for deletion; one ledger item (Phase 16 missing VERIFICATION.md) recorded as still-valid out-of-v6.17-scope
- Human-verify checkpoint approved by user before commit

## Task Commits

1. **Task 1: Run wave-0 CI commands and capture stdout** — combined into Task 3 commit (file was drafted in-memory then committed atomically with Task 2 close-out)
2. **Task 2: Append DEBT-03 / DEBT-04 close-out (Branch A)** — combined into Task 3 commit (Branch A close-out written as part of initial file creation)
3. **Task 3: Human-verify the baseline doc, then commit** — `83defc7` (docs)

_Note: Tasks 1-2 outputs were assembled into a single in-memory draft and committed atomically at Task 3 after human approval — there is one commit (`83defc7`) covering all three tasks. This deviates from the "commit each task atomically" preference but is acceptable because Task 1 and Task 2 both produce a single artifact (the same file) and Task 3 is the human-verify gate before any commit happens._

## Files Created/Modified

- `.planning/milestones/v6.17-debt-baseline.md` — wave-0 ground-truth baseline (121 lines)

## Wave-0 CI Result Summary

| Check | Result |
|-------|--------|
| `find test/ -name '*.todo*' -print` | 0 matches |
| `grep -rEn '\.todo\s*\(\|it\.todo\s*\(\|test\.todo\s*\(\|describe\.todo\s*\('` | 0 matches |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.bot.json` | exit 0 |
| `npx tsc --noEmit -p dashboard/tsconfig.json` | exit 0 |
| `grep -n 'getTradesByToken' src/utils/db.ts` | line 215 (still-valid → Plan 17-03) |

## v6.16 Audit Ledger Disposition Summary

- **9 verified-resolved:**
  - 01-bug-fixes-hardening: console.log in telegramListener.ts (verified-empty)
  - 01-bug-fixes-hardening: releaseSellLock callers (called at exitEngine.ts:517,628)
  - 03-sqlite-storage-code-quality: working-tree regressions (clean)
  - 03-sqlite-storage-code-quality: testAlert.ts (file does not exist)
  - 03-sqlite-storage-code-quality: pino + better-sqlite3 not installed (require OK)
  - 07-smart-exit-strategies: 37 .todo stubs (verified-empty)
  - 08-monitoring-web-dashboard: 6 TS errors (tsc clean)
  - 08-monitoring-web-dashboard: latestBlock fixture mismatch (line 95: 12345678)
  - 11-dashboard-accuracy-bot-wiring: getPnLChartData redeclare (tsc clean)

- **2 still-valid:**
  - 16-dashboard-type-alignment-dead-code-cleanup: VERIFICATION.md never generated → audit-grade documentation gap, not addressable in v6.17 (Phase 17 is forward-looking)
  - 16-dashboard-type-alignment-dead-code-cleanup: getTradesByToken at db.ts:215 → handed to Plan 17-03 for deletion

## Hand-off to Plan 17-03

Plan 17-03 will:
1. Delete the `getTradesByToken` declaration block (`src/utils/db.ts:215-217` plus trailing blank line)
2. Update this baseline doc's ledger row to flip Disposition from `still-valid → acted-on by Plan 17-03` to `acted-on (commit <sha>)`

The ledger row is structured to make this single-cell update straightforward.

## Deviations from Plan

**[Rule 1 — Bug] Single atomic commit instead of per-task commits**

- Found during: Task 3
- Issue: Plan implies "commit each task atomically", but Tasks 1 and 2 both modify the same file, and Task 3 is the gate that authorizes the commit. Splitting into 2 commits would have required either committing intermediate file states (Task 1 without close-out section) or a synthetic separation.
- Fix: Single commit `83defc7` after human approval covers all three tasks.
- Files modified: `.planning/milestones/v6.17-debt-baseline.md`
- Verification: `git log --oneline -- .planning/milestones/v6.17-debt-baseline.md` returns 1 commit
- Commit hash: `83defc7`

**Total deviations:** 1 auto-resolved (atomic commit grouping). **Impact:** None — file content and ledger structure are correct; only commit granularity differs.

## Self-Check: PASSED

- ✓ `.planning/milestones/v6.17-debt-baseline.md` exists and is committed (`git log --oneline -- .planning/milestones/v6.17-debt-baseline.md` → 83defc7)
- ✓ Frontmatter has `todo_count: 0` and `tsc_clean: 3/3` (Branch A trigger)
- ✓ Per-claim ledger has 11 data rows for the 11 v6.16 audit `tech_debt:` items
- ✓ Exactly one DEBT-03/04 close-out branch (A) is present and matches frontmatter values
- ✓ Verbatim claim quotes preserved (verified for "Diagnostic console.log..." and "getTradesByToken remains as unused...")
- ✓ Plan 17-02 and Plan 17-03 are unblocked (their `depends_on: ['17-01']` is now satisfied)
