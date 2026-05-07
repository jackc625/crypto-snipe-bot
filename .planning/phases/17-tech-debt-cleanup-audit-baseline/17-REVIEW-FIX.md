---
phase: 17-tech-debt-cleanup-audit-baseline
fixed_at: 2026-05-07T02:06:30Z
review_path: .planning/phases/17-tech-debt-cleanup-audit-baseline/17-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-05-07T02:06:30Z
**Source review:** `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (Critical: 0, Warning: 5)
- Fixed: 5
- Skipped: 0

Info findings (IN-01 through IN-04) are out of scope for this fix iteration per
`fix_scope: critical_warning`.

## Fixed Issues

### WR-01: Phase 7 EXIT-01 harm-prevention test does not verify the claim it advertises

**Files modified:** `test/unit/exitEngineSell.test.ts`
**Commit:** `61879f6`
**Applied fix:** Selected reviewer Option 2 (downgrade describe-block claim) over
Option 1 (drive `pollExitStrategy` end-to-end). Renamed the `describe` from
"Phase 7 harm-prevention: EXIT-01 stop-loss triggers executeFullSell with
reason='stop-loss'" to "Phase 7 EXIT-01: executeFullSell accepts reason='stop-loss'
discriminant and inserts action='sell' row" so it matches what the test actually
verifies. Renamed the inner `it` to "submits sell tx and inserts a sell row when
invoked with reason='stop-loss'". Added a SCOPE NOTE comment block explaining
that this describe verifies the call-shape contract (executeFullSell accepts
reason='stop-loss' and writes a 'sell' row) but does NOT cover the wired-through
path at `src/exitEngine.ts:747-760` — that wiring is the responsibility of
integration tests in `test/integration/exitMonitor.test.ts`. Why Option 2: drives
zero behavioural change in the existing test suite while removing the false
"wired-through" claim that the reviewer correctly flagged as material
overstatement; Option 1 would have introduced a parallel polling-path test at
unit-level scope that would duplicate integration coverage instead of
rationalising it.

### WR-02: Phase 10 partial-sell harm-prevention test has the same wiring gap as WR-01

**Files modified:** `test/unit/exitEngineSell.test.ts`
**Commit:** `27af44e`
**Applied fix:** Same Option 2 approach as WR-01. Renamed the `describe` from
"Phase 10 harm-prevention: partial-sell amount_out is non-null on
receipt-decoded sell" to "Phase 10 partial-sell: row insertion records non-null
amountOut from decodeReceipt" (drops the misleading "harm-prevention" framing).
Added a SCOPE NOTE explaining the test verifies executePartialSell's row-insertion
contract when decodeReceipt returns data, not the poll-loop trigger contract at
`src/exitEngine.ts:697-717` (getUnfilledTiers → executePartialSell wiring).

### WR-03: Phase 5 V3-02 integration test imports `src/bot.ts`, opening the production SQLite DB

**Files modified:** `test/integration/v3LiquidityWait.test.ts`
**Commit:** `0f39300`
**Applied fix:** Selected reviewer Option 1 (`vi.doMock('../../src/utils/db', ...)`)
over Option 2 (extract `waitForLiquidity` to a new module). Option 2 would also
resolve IN-01, but it is a structural source change with broader implications;
Option 1 is the minimum-impact fix that addresses the test-isolation problem
without touching production code. Added a `vi.doMock('../../src/utils/db', ...)`
block alongside the existing ethers and logger doMocks. The mock returns a
Statement-shaped stub for `db.prepare(...)` calls — needed because
`src/riskManager.ts:48` invokes `db.prepare(...)` at module-load time and is
transitively imported by bot.ts. Verified end-to-end:

1. Ran the test and confirmed it still passes (1/1).
2. Captured `data/bot.db-wal` and `data/bot.db-shm` mtimes before and after the
   run and confirmed both were unchanged — proving no DB I/O occurs during the
   test, which was the reviewer's primary complaint.

This reverification was performed temporarily against the main repo because the
isolated worktree does not have `node_modules`; the main repo file was restored
to its baseline state immediately after verification, and the actual fix is
committed only inside the worktree (commit `0f39300`).

### WR-04: CI `.todo` ban regex is over-broad and may flag unrelated `.todo(` calls

**Files modified:** `.github/workflows/test.yml`
**Commit:** `a6d4ab6`
**Applied fix:** Dropped the bare `\.todo\s*\(` alternative from the grep regex.
The remaining three Vitest-specific patterns (`it\.todo`, `test\.todo`,
`describe\.todo`) cover the documented intent precisely. Added a comment citing
WR-04 explaining why the bare pattern was removed (would match any `myObject.todo()`
call across the repo).

### WR-05: `find test/ -name '*.todo*'` matches documentation-style files, not just .todo test stubs

**Files modified:** `.github/workflows/test.yml`
**Commit:** `858aff3`
**Applied fix:** Selected reviewer Option A — removed the find-based filename
check entirely. Vitest's `.todo` test-stub form is invoked via `it.todo`/
`test.todo`/`describe.todo` method calls, not via filenames; there is no
canonical "*.todo* file" naming convention in the codebase to ban. The remaining
grep-based check is sufficient and the error message was clarified to point
maintainers at `it.skip('reason: ...')`. Added comments citing WR-05 explaining
the rationale.

## Skipped Issues

None.

## Notes for verifier / next steps

- All Info findings (IN-01 through IN-04) remain open per the `critical_warning`
  fix scope and should be addressed in a future cleanup pass or explicitly
  deferred in the v6.17 baseline ledger:
  - **IN-01** (waitForLiquidity export) becomes lower priority now that WR-03 is
    fixed via mocking — the reason given for the export (test access) is now
    documented and contained.
  - **IN-02** (dead imports `sendTelegramAlert`, `getProvider`, `getWallet` in
    `src/bot.ts:30,34`) is a clean low-risk cleanup candidate.
  - **IN-03** (unused locals in `test/integration/exitMonitor.test.ts:204,210`)
    is cosmetic; either underscore-prefix or delete.
  - **IN-04** (vi.doUnmock comment) is informational only — no fix needed.

- The WR-01 / WR-02 fixes are documentation/labeling changes only. The
  observable test behaviour (mocks, assertions, and the production paths that
  trigger them) is unchanged. A reviewer who wants the harm-prevention coverage
  the original describe blocks claimed should add a polling-path integration
  test in a follow-up iteration; that is outside the scope of a labeling fix.

- WR-03 was verified end-to-end against the live test runner. The other 4 fixes
  passed Tier 1 (re-read confirms fix present, surrounding code intact) and
  Tier 2 syntax checks (TypeScript `tsc --noEmit` for the .ts file edits, basic
  YAML structural validation for `.github/workflows/test.yml`). No Tier-2
  failures were introduced by any fix.

---

_Fixed: 2026-05-07T02:06:30Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
