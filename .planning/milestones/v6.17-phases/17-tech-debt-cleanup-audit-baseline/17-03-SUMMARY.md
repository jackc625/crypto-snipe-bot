---
phase: 17-tech-debt-cleanup-audit-baseline
plan: 03
subsystem: infra
tags: [ci, github-actions, typescript, tsc, vitest, todo-ban, dead-code, audit-ledger, sqlite, db.ts]

# Dependency graph
requires:
  - phase: 17-tech-debt-cleanup-audit-baseline (Plan 17-01)
    provides: |
      v6.17-debt-baseline.md wave-0 ground-truth artifact (0 .todo, 3/3 tsc-clean)
      with the per-claim ledger row for `getTradesByToken` marked
      `still-valid → acted-on by Plan 17-03`. This plan flips that row to
      `acted-on (this plan, commit 5280679)` and locks the 0/0 baseline as
      evergreen CI invariants.
provides:
  - Dead `getTradesByToken` const removed from `src/utils/db.ts` (DEBT-06 closure)
  - `.github/workflows/test.yml` extended with `.todo` ban + tsc × 3 guards (D-08/D-09/D-10)
  - v6.17 baseline ledger row for `getTradesByToken` flipped to `acted-on (commit 5280679)`
  - Evergreen CI invariant: any future PR adding a `.todo` file/invocation OR a TS error fails the build
affects: [phase-18-honeypot-rebuild, phase-19-antirug, phase-21-exit-live, future-v6.18-tech-debt]

# Tech tracking
tech-stack:
  added: []  # No new tools/libraries; reuses existing find/grep/npx tsc
  patterns:
    - "Strict `.todo` ban as CI invariant (D-09): no allowlist-with-reason; `it.skip('reason: ...')` is the contributor escape hatch"
    - "Smallest-diff CI append (D-10): new guards appended as steps to the existing `test` job rather than a parallel job or new workflow file"
    - "Per-tsconfig sequential tsc steps: 3 separate steps (root, bot, dashboard) so GitHub Actions UI surfaces which config failed"
    - "Verify-then-act discipline (D-11 / Pitfall #22): each audit-ledger claim re-verified at execution time before any act-step; STOP on unexpected non-resolved state"

key-files:
  created: []
  modified:
    - src/utils/db.ts (3-line `getTradesByToken` const declaration deleted plus trailing blank line; surrounding `insertTrade` and `updateTradeStatus` blocks preserved verbatim)
    - .github/workflows/test.yml (4 new steps appended: 1 `.todo` ban + 3 tsc-noEmit checks; 5 pre-existing steps untouched)
    - .planning/milestones/v6.17-debt-baseline.md (one ledger cell updated: `getTradesByToken` row Disposition flipped from `still-valid → acted-on by Plan 17-03` to `acted-on (this plan, commit 5280679)`)

key-decisions:
  - "Conditional `src/telegramListener.ts` edit did NOT fire — Task 1 Check 5 grep returned empty; pre-scout confirmed at execution time. File NOT modified."
  - "CI guards appended as 4 separate steps (1 `.todo` ban + 3 tsc) rather than 2 combined steps — preserves GitHub Actions UI clarity on which tsconfig variant fails."
  - "Strict `.todo` ban (no allowlist-with-reason) per D-09; `it.skip('reason: ...')` is the contributor escape hatch."

patterns-established:
  - "CI evergreen-invariant lock pattern: a wave-0 baseline becomes a regression-blocking property of CI rather than a one-time snapshot. Future tech-debt phases can reuse the same shape (verify-via-CI baseline → CI guard for the verified-empty property)."
  - "Audit-ledger closure pattern: per-claim Disposition cells flip from `still-valid → acted-on by Plan N` to `acted-on (commit <sha>)` after the act-step commits, embedding traceability from audit claim to remediation commit."

requirements-completed:
  - DEBT-06

# Metrics
duration: ~10min
completed: 2026-04-29
---

# Phase 17 Plan 03: Cleanup + CI Invariants Summary

**Closes DEBT-06 (`getTradesByToken` dead-code removal at `src/utils/db.ts:215`) AND turns the v6.17 wave-0 baseline (0 `.todo` / 3/3 tsc-clean) into evergreen CI invariants via `.todo` ban + tsc × 3 guards appended to the existing `test` job in `.github/workflows/test.yml`.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-30T00:36:00Z (approximate; first verification commands)
- **Completed:** 2026-04-30T00:42:00Z (post-completion verification + SUMMARY)
- **Tasks:** 3 (Task 1 verify-only; Tasks 2-3 atomic commits)
- **Files modified:** 3 (`src/utils/db.ts`, `.github/workflows/test.yml`, `.planning/milestones/v6.17-debt-baseline.md`)

## Accomplishments

- DEBT-06 closed: `getTradesByToken` unused local const removed from `src/utils/db.ts:215` (3-line + 1 trailing blank line deletion)
- v6.17 baseline locked as evergreen CI invariant: `.todo` ban + tsc × 3 (root, bot, dashboard) appended as 4 new steps to existing `test` job (D-10 smallest-diff)
- Audit-ledger closure: `v6.17-debt-baseline.md` row for `getTradesByToken` flipped from `still-valid → acted-on by Plan 17-03` to `acted-on (this plan, commit 5280679)`
- Verify-then-act protocol honored (D-11 / Pitfall #22): all 5 pre-act checks ran at execution time; pre-scout's 10-of-11-resolved finding confirmed
- 351/351 tests passing post-changes; tsc --noEmit clean across all 3 tsconfig variants

## Task Commits

1. **Task 1: Verify-then-act precursor checks** — no commit (verification-only; no file modifications)
2. **Task 2: Delete `getTradesByToken` const from `src/utils/db.ts`** — `5280679` (refactor)
3. **Task 2 (continued): Update v6.17 baseline ledger row** — `b31a7b2` (docs)
4. **Task 3: Append `.todo` ban + tsc × 3 to `test.yml`** — `baec25a` (ci)

_Note: Task 2 produced two commits because the baseline ledger update needed the Task 2 commit's short-SHA (5280679) interpolated into the Disposition cell — the ledger update was committed atomically AFTER the deletion._

## Files Created/Modified

- `src/utils/db.ts` — deleted 4 lines (the `getTradesByToken` const declaration block plus its trailing blank line). Pre-edit lines 215-217 contained the dead 3-line `db.prepare(...)` declaration plus blank-line spacer; post-edit line 215 begins with `const updateTradeStatus = db.prepare(\``. `insertTrade` (lines 210-213) and `updateTradeStatus` (lines 215-217 post-edit) blocks preserved verbatim.
- `.github/workflows/test.yml` — 4 new steps appended after `- run: npm run test:integration` (line 19). Step shape: `Ban .todo test stubs` (multi-line bash with two `if` clauses), `TypeScript check (root tsconfig.json)`, `TypeScript check (tsconfig.bot.json)`, `TypeScript check (dashboard/tsconfig.json)`. Total job steps: 9 (5 pre-existing + 4 new).
- `.planning/milestones/v6.17-debt-baseline.md` — one ledger row updated. Phase 16 `getTradesByToken` row Disposition cell flipped from `still-valid → acted-on by Plan 17-03` to `acted-on (this plan, commit 5280679)`. No other file changes.

## Verify-Then-Act Audit Trail (Task 1 — D-11 / Pitfall #22)

All 5 pre-act checks ran at execution time on a fresh working tree (2026-04-30). Verbatim outputs preserved here per the plan's `<output>` requirement.

### Check 1 — un-scouted: working-tree regressions in logger.ts/notifier.ts/retry.ts

```
$ git status src/utils/logger.ts src/utils/notifier.ts src/utils/retry.ts
On branch master
Your branch is ahead of 'origin/master' by 27 commits.
nothing to commit, working tree clean

$ git diff src/utils/logger.ts src/utils/notifier.ts src/utils/retry.ts | head -20
(empty output)
```

**Verdict:** PASS — clean working tree, no diff. Pre-scout's finding confirmed.

### Check 2 — un-scouted: health test fixture latestBlock 12345 vs 12345678

```
$ grep -n 'latestBlock' test/integration/api/health.test.ts test/fixtures/api.fixtures.ts
test/integration/api/health.test.ts:95:        expect(chains[0].latestBlock).toBe(12345678);
```

**Verdict:** PASS — fixture asserts `12345678` (the corrected value). No regression.

### Check 3 — Pitfall #22 dependency-search guard for `getTradesByToken`

```
$ grep -rEn 'getTradesByToken' src/ dashboard/ test/ scripts/ 2>/dev/null
src/utils/db.ts:215:const getTradesByToken = db.prepare(`
```

**Verdict:** PASS — EXACTLY ONE match at the declaration site itself. Zero callers in dashboard/, test/, or scripts/. Deletion is safe per Pitfall #22.

### Check 4 — Plan 17-01 baseline ledger row for `getTradesByToken`

```
$ grep -n 'getTradesByToken' .planning/milestones/v6.17-debt-baseline.md | head -5
60:### Command 4 — DEBT-06 verify-then-act precursor: `getTradesByToken` location
63:$ grep -n 'getTradesByToken' src/utils/db.ts
64:215:const getTradesByToken = db.prepare(`
69:(`getTradesByToken` STILL declared at `src/utils/db.ts:215` → still-valid → acted-on by Plan 17-03)
106:| 16-dashboard-type-alignment-dead-code-cleanup | getTradesByToken remains as unused local const in db.ts:215 after export removal (dead code) | `grep -n 'getTradesByToken' src/utils/db.ts` | `215:const getTradesByToken = db.prepare(\`` | still-valid → acted-on by Plan 17-03 |
```

**Verdict:** PASS — row 106 contains `still-valid → acted-on by Plan 17-03`. Plan 17-01's wave-0 baseline doc is in the expected state.

### Check 5 — `src/telegramListener.ts` console.log/warn/error grep

```
$ sed -n '54,62p' src/telegramListener.ts
        (process.env.TELEGRAM_ALLOWED_SENDERS || '').split(',').map(s => s.trim()).filter(Boolean)
    );
    const allowedChannels = new Set(
        (process.env.TELEGRAM_ALLOWED_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean)
    );

    try {
        const client = new TelegramClient(
            new StringSession(session),

$ grep -n 'console\.log\|console\.warn\|console\.error' src/telegramListener.ts
(empty output, exit=1)
```

**Verdict:** PASS — lines 54-58 are env-parse Set construction expressions, NOT console.log calls. Zero matches across the whole file. **Conditional act-path did NOT fire — `src/telegramListener.ts` NOT modified — verified-resolved at execution time.**

## Pre/Post Diffs

### `src/utils/db.ts` (Task 2)

**Pre-edit (lines 210-221):**
```typescript
const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status, pool_type, fee_tier, dex_name)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status, @poolType, @feeTier, @dexName)
`);

const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? AND chain = ? ORDER BY timestamp ASC
`);

const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND chain = ? AND status = 'pending'
`);
```

**Post-edit (lines 210-217):**
```typescript
const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status, pool_type, fee_tier, dex_name)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status, @poolType, @feeTier, @dexName)
`);

const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND chain = ? AND status = 'pending'
`);
```

**Diff:** 4 lines removed (the `const getTradesByToken = db.prepare(...)` declaration plus trailing blank line). Single blank-line spacing between `insertTrade` and `updateTradeStatus` preserved (matches the convention with other prepare blocks in the file).

### `.github/workflows/test.yml` (Task 3)

**Pre-edit (full file, 19 lines):**
```yaml
name: Tests
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci --legacy-peer-deps
      - run: npm run test:unit
      - run: npm run test:integration
```

**Post-edit (full file, 37 lines):**
```yaml
name: Tests
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci --legacy-peer-deps
      - run: npm run test:unit
      - run: npm run test:integration
      - name: Ban .todo test stubs
        run: |
          # D-09: Strict ban (NOT allowlist-with-reason). Use it.skip('reason: ...') instead.
          if find test/ -name '*.todo*' -print | grep -q .; then
            echo "ERROR: .todo file(s) found in test/"
            find test/ -name '*.todo*' -print
            exit 1
          fi
          if grep -rEn '\.todo\s*\(|it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/; then
            echo "ERROR: .todo() invocation(s) found in test/"
            exit 1
          fi
      - name: TypeScript check (root tsconfig.json)
        run: npx tsc --noEmit -p tsconfig.json
      - name: TypeScript check (tsconfig.bot.json)
        run: npx tsc --noEmit -p tsconfig.bot.json
      - name: TypeScript check (dashboard/tsconfig.json)
        run: npx tsc --noEmit -p dashboard/tsconfig.json
```

**Diff:** 18 lines added after the original `- run: npm run test:integration` line. 5 pre-existing steps preserved verbatim. 4 new steps appended. Total job steps: 9.

### `.planning/milestones/v6.17-debt-baseline.md` (Task 2 ledger update)

**Pre-edit (line 106):**
```
| 16-dashboard-type-alignment-dead-code-cleanup | getTradesByToken remains as unused local const in db.ts:215 after export removal (dead code) | `grep -n 'getTradesByToken' src/utils/db.ts` | `215:const getTradesByToken = db.prepare(\`` | still-valid → acted-on by Plan 17-03 |
```

**Post-edit (line 106):**
```
| 16-dashboard-type-alignment-dead-code-cleanup | getTradesByToken remains as unused local const in db.ts:215 after export removal (dead code) | `grep -n 'getTradesByToken' src/utils/db.ts` | `215:const getTradesByToken = db.prepare(\`` | acted-on (this plan, commit 5280679) |
```

**Diff:** Disposition cell only — `still-valid → acted-on by Plan 17-03` flipped to `acted-on (this plan, commit 5280679)`. The wave-0 historical record (lines 60-69) preserved verbatim — that section is the immutable wave-0 stdout from Plan 17-01.

## Post-Completion Verification

```
$ npx vitest run test/unit test/integration
Test Files  32 passed (32)
     Tests  351 passed (351)
   Duration 3.99s
exit=0

$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.bot.json && npx tsc --noEmit -p dashboard/tsconfig.json
root_OK
bot_OK
dashboard_OK

$ find test/ -name '*.todo*' -print
(empty, exit=0)

$ grep -rEn '\.todo\s*\(|it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/
(empty, exit=1)

$ grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/ 2>/dev/null
(empty, exit=1)

$ grep -n 'tsc --noEmit' .github/workflows/test.yml
33:        run: npx tsc --noEmit -p tsconfig.json
35:        run: npx tsc --noEmit -p tsconfig.bot.json
37:        run: npx tsc --noEmit -p dashboard/tsconfig.json

$ grep -n "find test/" .github/workflows/test.yml
23:          if find test/ -name '*.todo*' -print | grep -q .; then
25:            find test/ -name '*.todo*' -print

$ grep -n 'getTradesByToken' .planning/milestones/v6.17-debt-baseline.md | tail -1
106:| ... | acted-on (this plan, commit 5280679) |
```

All post-completion verifications pass. Test suite green (351/351). All 3 tsc variants exit 0. Both `.todo` invariants empty (the property the new CI guards lock). Zero `getTradesByToken` references anywhere in code dirs.

## Decisions Made

- **Conditional `src/telegramListener.ts` edit did NOT fire.** Task 1 Check 5 grep for `console.log/warn/error` returned empty (lines 54-58 are env-parse `Set` construction expressions, not console calls). The act-path declared in `files_modified` frontmatter was structurally permitted but execution-time grep confirmed no edit needed — file remains verified-resolved.
- **CI guards split into 4 separate steps** (1 `.todo` ban + 3 tsc) rather than 2 combined steps. Per D-10 planner discretion, this preserves GitHub Actions UI clarity on which tsconfig variant fails (the step name surfaces it explicitly).
- **Task 2 produced TWO atomic commits** (deletion + ledger update) because the ledger row update needed the deletion's commit short-SHA (`5280679`) interpolated into the Disposition cell. Splitting was unavoidable; both commits are scoped under `(17-03)`.

## Deviations from Plan

None — plan executed exactly as written.

The conditional `src/telegramListener.ts` edit (`files_modified` frontmatter) was structurally permitted by Task 1 Check 5's decision tree; pre-scout predicted it would not fire, and execution-time grep confirmed empty. NOT a deviation — this is the verified-resolved branch of the plan's pre-declared decision tree.

## Issues Encountered

- One unrelated working-tree change (`.planning/phases/17-tech-debt-cleanup-audit-baseline/17-02-SUMMARY.md` had an uncommitted Self-Check append from the prior plan). Left untouched per scope discipline — not part of Plan 17-03's scope. The orchestrator owns post-wave reconciliation.

## User Setup Required

None — no external service configuration required. All work is internal (code deletion, CI workflow, planning docs).

## Next Phase Readiness

- **DEBT-06 closed.** ROADMAP.md Phase 17 Success Criterion 4 (`getTradesByToken` no longer in codebase) satisfied. The diagnostic console.log half of SC-4 (`src/telegramListener.ts:55,61`) was already verified-resolved by pre-scout and re-verified at execution time.
- **D-08/D-09/D-10 invariants locked.** Phase 17 Success Criterion 2 (CI evergreen invariant) shipped. Any future PR with a `.todo` file/invocation OR a TS error fails CI.
- **Phase 17 closeable** subject to orchestrator's ROADMAP/STATE update. Plans 17-01, 17-02, 17-03 all complete.
- **Phase 18 (HONEY-01..11) ready to start** — no blockers.

---
*Phase: 17-tech-debt-cleanup-audit-baseline*
*Completed: 2026-04-29*

## Self-Check: PASSED

- SUMMARY file exists at `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-03-SUMMARY.md`.
- All 3 task commits found in `git log --oneline`: `5280679` (refactor), `b31a7b2` (docs), `baec25a` (ci).
- All 3 modified files exist: `src/utils/db.ts`, `.github/workflows/test.yml`, `.planning/milestones/v6.17-debt-baseline.md`.
- Test suite: 351/351 passing (32 test files; unit + integration projects).
- tsc --noEmit: 3/3 tsconfig variants exit 0 (root, bot, dashboard).
- `.todo` invariant: 0 filename matches AND 0 invocation matches across `test/`.
- `getTradesByToken` reference count: 0 across `src/`, `dashboard/`, `test/`, `scripts/`.
- CI workflow `.github/workflows/test.yml`: 9 total steps (5 pre-existing + 4 appended); YAML valid; `it.skip` escape-hatch documented in `.todo` ban comment per D-09.
- Baseline ledger row 106 in `v6.17-debt-baseline.md`: Disposition cell reads `acted-on (this plan, commit 5280679)`.
- No `--no-verify` flags used on any commit.
- No modifications to STATE.md or ROADMAP.md (orchestrator owns those writes per chain-flag context).
- Conditional `src/telegramListener.ts` edit verified-not-needed at execution time; file NOT modified.
