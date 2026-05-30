---
phase: 17
plan: 3
slug: cleanup-and-ci-invariants
type: execute
wave: 1
depends_on:
  - "17-01"
files_modified:
  - src/utils/db.ts
  - .github/workflows/test.yml
  - .planning/milestones/v6.17-debt-baseline.md  # Task 2 updates the per-claim ledger row for `getTradesByToken` to `acted-on (deleted in Plan 17-03)`. Wave-1-safe: Plan 17-01 (wave 0) writes this file; this plan only modifies one ledger cell after 17-01 commits, no parallel-write conflict because 17-01 is in an earlier wave.
  - src/telegramListener.ts  # CONDITIONAL: only modified if Task 1 Check 5 finds console.log/warn/error matches at execution time (per DEBT-06 wording: replace console.* with log.debug). Pre-scout (CONTEXT.md `<domain>` lines 19-20) confirmed the file is already clean (env-parse expressions, NOT console calls), so the expected execution-time path is verified-resolved with NO edit. Listed here so frontmatter is honest about the act-path that EXISTS in Task 1's decision tree even if it does not fire.
autonomous: true
requirements:
  - DEBT-06
  # Note: this plan also locks in the v6.17 baseline (DEBT-01..04 invariants) via CI guards.
  # The CI guards turn the verified-empty baseline (Plan 17-01 Branch A) into an evergreen
  # invariant rather than a snapshot. Per D-08/D-09/D-10 these guards are scoped to DEBT-06's
  # lock-in responsibility — they don't add a new requirement, they harden DEBT-01..04.
must_haves:
  truths:
    - "After this plan lands, `src/utils/db.ts` no longer contains the `getTradesByToken` const declaration anywhere (ROADMAP.md SC-4)."
    - "After this plan lands, `.github/workflows/test.yml` runs the `.todo` ban guard AND `tsc --noEmit -p ...` × 3 tsconfig variants on every push and PR (D-08 evergreen invariant lock)."
    - "Any future PR that adds a `.todo`-named file under `test/` or invokes `it.todo(...)`/`test.todo(...)`/`describe.todo(...)` fails the CI build (D-09 strict ban; `it.skip('reason: ...', ...)` is the contributor escape hatch)."
    - "Any future PR that introduces a TypeScript error against any of `tsconfig.json`, `tsconfig.bot.json`, or `dashboard/tsconfig.json` fails the CI build (D-08 #2)."
    - "All un-scouted v6.16-MILESTONE-AUDIT.md `tech_debt:` items (working-tree regressions in logger.ts/notifier.ts/retry.ts; health test fixture latestBlock 12345 vs 12345678) are verified at execution time per D-11 verify-then-act BEFORE any act-step runs (Pitfall #22 — confirm dependency before delete)."
    - "The baseline doc from Plan 17-01 has its Phase 16 `getTradesByToken` row's Disposition updated from `still-valid → acted-on by Plan 17-03` to `acted-on (this plan, commit <sha>)` (audit ledger closure)."
    - "Diagnostic logs in `src/telegramListener.ts` are EITHER preserved as `log.debug` (per DEBT-06 wording) OR confirmed verified-resolved (pre-scout: lines 55, 61 are env-parse expressions, not console.log calls)."
  artifacts:
    - path: src/utils/db.ts
      provides: "DEBT-06 dead-code removal: getTradesByToken declaration deleted (lines 215-217)."
    - path: .github/workflows/test.yml
      provides: "Two new CI guard steps appended to existing `test` job: (1) `.todo` ban (D-08 #1), (2) tsc-clean × 3 tsconfigs (D-08 #2)."
      contains: "tsc --noEmit"
  key_links:
    - from: .github/workflows/test.yml
      to: src/utils/db.ts AND test/ AND every TS file in src/, dashboard/, test/
      via: "CI guards run on push/PR; any regression of the v6.17 0/0 baseline OR any new TS error fails the build"
    - from: src/utils/db.ts (post-deletion)
      to: dashboard/src/, test/, scripts/
      via: "verified-no-callers via grep before deletion (Pitfall #22 mitigation)"
---

<objective>
Cleanup + invariant-lock plan for Phase 17. Closes DEBT-06 — diagnostic-log / dead-code cleanup driven by the v6.16 audit ledger — AND turns the v6.17 baseline (Plan 17-01) into evergreen CI invariants per D-08/D-09/D-10.

**Verify-then-act protocol (per D-11 — Pitfall #22 mitigation):** This plan does NOT blindly act on every v6.16-MILESTONE-AUDIT.md `tech_debt:` claim. The pre-scout (CONTEXT.md `<domain>` line 14-29) verified 10 of 11 audit items as already resolved; the only confirmed-still-valid item is the `getTradesByToken` deletion at `src/utils/db.ts:215`. Two un-scouted items (working-tree regressions in logger.ts/notifier.ts/retry.ts; health fixture latestBlock 12345 vs 12345678) MUST be verified at execution time BEFORE any act-step runs. Per D-12 strict scope: items verified-resolved by Plan 17-01's baseline doc do NOT get acted on here (no scope creep).

**Conditional file modifications (frontmatter scope note):** `files_modified` lists `src/telegramListener.ts` because Task 1 Check 5's decision tree (per DEBT-06 wording) explicitly contemplates a `console.log → log.debug` replacement act-path IF execution-time grep returns matches. Pre-scout (2026-04-29) confirmed the file is already clean, so the expected outcome is verified-resolved (no edit). Listed in frontmatter for honesty about the act-path the plan structurally permits — NOT because the edit is expected to fire. `.planning/milestones/v6.17-debt-baseline.md` is also listed because Task 2 updates one ledger cell (the `getTradesByToken` row's Disposition) after deletion.

**CI invariant lock structure (per D-10 planner discretion → smallest-diff append):** Append two new `run` steps to the existing `test` job in `.github/workflows/test.yml`. NOT a new parallel job, NOT a new `lint.yml` workflow. Sequential append matches the existing 5-step shape (checkout, setup-node, npm ci, test:unit, test:integration → +todo-ban + tsc × 3).

**Strict `.todo` ban (per D-09):** No allowlist-with-reason. Future contributors who want a placeholder use `it.skip('reason: ...', () => {...})` — same effect with explicit reason.

Output:
- `src/utils/db.ts` modified (3-line deletion)
- `.github/workflows/test.yml` modified (5 new step-lines: 1 todo-ban + 3 tsc + the named YAML keys)
- `.planning/milestones/v6.17-debt-baseline.md` modified (one ledger row updated to mark `getTradesByToken` as `acted-on`)
- `src/telegramListener.ts` MAYBE modified (only if Task 1 Check 5 surfaces a regression; pre-scout says no)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md
@.planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md
@.planning/research/PITFALLS.md
@.planning/milestones/v6.17-debt-baseline.md
@.planning/milestones/v6.16-MILESTONE-AUDIT.md

<interfaces>
<!-- Concrete excerpts from the files this plan modifies. -->

From src/utils/db.ts (lines 210-221 — the `getTradesByToken` block to delete with surrounding context that must REMAIN intact):
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

The deletion target is the 3-line `getTradesByToken = db.prepare(...)` declaration plus its trailing blank line. After deletion, the `insertTrade` block immediately precedes the `updateTradeStatus` block with one blank line between them.

From .github/workflows/test.yml (FULL CURRENT FILE — 19 lines):
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

The append target is AFTER the `npm run test:integration` line (line 19), preserving the existing 5 steps verbatim.

Three tsconfig paths confirmed on disk (per PATTERNS.md lines 110-114):
- `tsconfig.json` (root)
- `tsconfig.bot.json` (bot-only)
- `dashboard/tsconfig.json` (dashboard frontend)

CI guard YAML to append (verbatim from 17-PATTERNS.md lines 79-101):

```yaml
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

Indentation: 6 spaces matches the existing `- run:` line indentation (per the existing `      - run: npm run test:unit` shape on line 18).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify-then-act precursor — confirm un-scouted v6.16 audit items at execution time</name>
  <files>(verification only — no file modifications IF all checks pass; src/telegramListener.ts MAY be modified if Check 5 surfaces console.log/warn/error matches per DEBT-06 wording)</files>
  <read_first>
    - .planning/milestones/v6.16-MILESTONE-AUDIT.md (lines 14-37 `tech_debt:` items — the verify-then-act target list)
    - .planning/milestones/v6.17-debt-baseline.md (Plan 17-01's per-claim ledger — most items already verified there; this task confirms the un-scouted ones)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (D-11 verify-then-act protocol; Pitfall #22 dead-code-removal-breaks-undocumented-dependency)
    - .planning/research/PITFALLS.md lines 681+ (Pitfall #22 — search the WHOLE repo before delete)
  </read_first>
  <action>
Run the following verification commands at execution time. Pre-scout already verified most items (CONTEXT.md `<domain>` lines 14-29). This task re-verifies the un-scouted ones plus the dependency-search guard for `getTradesByToken` per Pitfall #22.

**Verification commands:**

```bash
# Check 1 — un-scouted: working-tree regressions in logger.ts / notifier.ts / retry.ts
# Per v6.16-MILESTONE-AUDIT.md line 21: "logger.ts, notifier.ts, retry.ts reverted to pre-migration versions (committed HEAD correct)"
git status src/utils/logger.ts src/utils/notifier.ts src/utils/retry.ts
git diff src/utils/logger.ts src/utils/notifier.ts src/utils/retry.ts | head -20
# Expected: clean working tree (or no meaningful diff). If diff shows v5 patterns reappearing, STOP and surface to user — Plan 17-03's scope was scoped to a clean tree.

# Check 2 — un-scouted: health test fixture latestBlock 12345 vs 12345678
# Per v6.16-MILESTONE-AUDIT.md line 30: "1 test fixture mismatch (health test latestBlock 12345 vs 12345678)"
grep -n 'latestBlock' test/integration/api/health.test.ts test/fixtures/api.fixtures.ts
# Expected: returns at least one match with `latestBlock: 12345678` (the corrected value). If returns `latestBlock: 12345` (the bug value), the regression has happened — surface to user.

# Check 3 — Pitfall #22 dependency-search guard for getTradesByToken
# Per PITFALLS.md line 695: "Search the WHOLE repo (not just src/) for the symbol before deletion."
grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/ 2>/dev/null
# Expected: ONLY one match — the line 215 declaration itself in src/utils/db.ts. If matches appear in dashboard/, test/, or scripts/, STOP — there is an unexpected caller and Pitfall #22 says do not delete blindly.

# Check 4 — Confirm Plan 17-01's baseline ledger marked getTradesByToken as `still-valid → acted-on by Plan 17-03`
grep -A 1 'getTradesByToken' .planning/milestones/v6.17-debt-baseline.md | head -5
# Expected: a row containing `still-valid` or `acted-on by Plan 17-03`. If the row is missing or marked `verified-resolved`, Plan 17-01 has a different state than expected — surface to user.

# Check 5 — Confirm src/telegramListener.ts:55,61 do NOT contain console.log
# Per CONTEXT.md `<domain>` lines 19-20: "no `console.log` (lines are env-parse expressions invoking structured `log.warn/info/debug`)"
sed -n '54,62p' src/telegramListener.ts | cat -n
grep -n 'console\.log\|console\.warn\|console\.error' src/telegramListener.ts
# Expected: lines 53-58 contain `process.env.TELEGRAM_ALLOWED_*` Set construction (per PATTERNS.md lines 760-770), NOT console.log. grep returns no matches.
```

**Decision tree per check:**

| Check | Pass case | Fail case action |
|-------|-----------|------------------|
| 1 (logger/notifier/retry tree) | clean diff or no diff | STOP; surface to user; this plan's scope assumed clean tree per CONTEXT.md `<domain>` line 17. Working-tree regression is a separate concern not within DEBT-06 cleanup. |
| 2 (health latestBlock) | grep matches `12345678` | STOP if grep returns `latestBlock: 12345`; this is a regression after Plan 17-01 baseline; surface to user. |
| 3 (Pitfall #22 dependency guard) | only 1 match in `src/utils/db.ts:215` | STOP if any match in dashboard/, test/, or scripts/; investigate caller before deleting |
| 4 (baseline ledger row) | row contains `acted-on by Plan 17-03` or `still-valid` | STOP if row is missing or marked `verified-resolved` (Plan 17-01 took a different path; reconcile with user) |
| 5 (telegramListener console.log) | grep returns no matches | If grep returns matches: replace each `console.log`/`console.warn`/`console.error` call with `log.debug` per DEBT-06 wording (NOT a STOP — this is the act path for diagnostic-log replacement). This is the act-path that justifies `src/telegramListener.ts` appearing in `files_modified` frontmatter; record the replacement diff in Plan 17-03 SUMMARY.md. |

**Output:** record the verbatim stdout of all 5 checks in a comment block at the top of the SUMMARY draft. This task makes NO file modifications IF all checks pass per pre-scout expectations. Check 5 MAY trigger a `console.log → log.debug` edit in `src/telegramListener.ts` if (and only if) execution-time grep finds matches; this is the conditional act-path the frontmatter declares.

If all 5 checks pass: proceed to Task 2.
If any STOP fires: surface to user with exact command output and decision required.
  </action>
  <verify>
    <automated>grep -rn 'getTradesByToken' src/ test/ dashboard/ scripts/ 2&gt;/dev/null | grep -v 'src/utils/db.ts:215' ; echo "extra_caller_exit=$?"</automated>
  </verify>
  <acceptance_criteria>
    - The verbatim stdout of all 5 checks is captured (will be embedded in 17-03-SUMMARY.md).
    - Check 1: `git status src/utils/logger.ts src/utils/notifier.ts src/utils/retry.ts` reports clean OR has been escalated to user.
    - Check 2: `grep -n 'latestBlock' test/integration/api/health.test.ts test/fixtures/api.fixtures.ts` includes at least one `latestBlock: 12345678` match.
    - Check 3: `grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/` returns EXACTLY ONE match — the `src/utils/db.ts:215` declaration. Verifiable via `grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/ 2>/dev/null | grep -vc 'src/utils/db.ts:215' == 0`.
    - Check 4: `.planning/milestones/v6.17-debt-baseline.md` contains a ledger row referring to `getTradesByToken` with disposition `acted-on by Plan 17-03` or `still-valid`.
    - Check 5: `grep -n 'console\.log\|console\.warn\|console\.error' src/telegramListener.ts` returns no matches OR the file has been amended to convert console.log → log.debug (per DEBT-06 wording).
    - No STOP condition fired (or the user has approved continuation).
  </acceptance_criteria>
  <done>
All 5 verify-then-act checks have run. Tasks 2 and 3 are unblocked. Pre-scout's 10-of-11 finding is confirmed at execution time on a fresh checkout. Pitfall #22 dependency guard confirms `getTradesByToken` has zero callers in the whole repo.
  </done>
</task>

<task type="auto">
  <name>Task 2: Delete `getTradesByToken` const from src/utils/db.ts (DEBT-06 dead-code removal)</name>
  <files>src/utils/db.ts, .planning/milestones/v6.17-debt-baseline.md</files>
  <read_first>
    - src/utils/db.ts (CURRENT FILE — focus on lines 210-221 to confirm `getTradesByToken` is at line 215; line numbers may shift if file edits have happened since pre-scout — re-verify)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 27-52 — getTradesByToken deletion analog and the surrounding-context-must-remain blocks)
    - .planning/milestones/v6.16-MILESTONE-AUDIT.md (line 37 — the audit claim being closed: "getTradesByToken remains as unused local const in db.ts:215 after export removal (dead code)")
    - Result of Task 1 Check 3 (the Pitfall #22 dependency guard — must be one-match-only before this task fires)
  </read_first>
  <action>
Delete the 3-line `getTradesByToken` declaration from `src/utils/db.ts`. The exact current content at lines 215-217 (per pre-scout verification) is:

```typescript
const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? AND chain = ? ORDER BY timestamp ASC
`);
```

**The deletion is exactly 3 lines** — the `const ...` line, the SELECT line, and the closing `\`);` line. ALSO remove the trailing blank line if one exists between this block and the `updateTradeStatus` block (preserving the single-blank-line spacing convention seen elsewhere in this file).

**Surrounding context that MUST remain intact** (per PATTERNS.md lines 41-50):

Before (lines 210-213):
```typescript
const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status, pool_type, fee_tier, dex_name)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status, @poolType, @feeTier, @dexName)
`);
```

After (lines 219-221, will become lines 215-217 post-deletion):
```typescript
const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND chain = ? AND status = 'pending'
`);
```

**Concrete edit using the `Edit` tool:**

Replace this string (the 3-line declaration plus one trailing blank line):
```
const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? AND chain = ? ORDER BY timestamp ASC
`);

```

With the empty string `` (zero lines). The `insertTrade` block ends with `\`);\n` and the `updateTradeStatus` block begins with `const updateTradeStatus`; after the edit, exactly one blank line separates them (matching the convention with the other prepare blocks in this file).

**Verification before commit:**
1. `grep -n 'getTradesByToken' src/utils/db.ts` returns 0 matches.
2. `grep -n 'insertTrade\|updateTradeStatus\|isTokenSniped' src/utils/db.ts` returns the same lines as pre-edit (no collateral damage to neighbors).
3. `npx tsc --noEmit -p tsconfig.bot.json` exits 0 (no broken imports).
4. `npx vitest run --project unit` exits 0 (no test breakage).

After verification, update `.planning/milestones/v6.17-debt-baseline.md`: in the per-claim ledger, find the row corresponding to "Phase 16: getTradesByToken remains as unused local const in db.ts:215" and change its Disposition cell from `still-valid → acted-on by Plan 17-03` (or `still-valid`) to `acted-on (deleted in Plan 17-03)`.

If `getTradesByToken` is NOT at line 215 at execution time (file has shifted), find it via grep and use the same 3-line-block deletion approach. The line number is informative; the symbol is what's being deleted.
  </action>
  <verify>
    <automated>grep -c 'getTradesByToken' src/utils/db.ts ; npx tsc --noEmit -p tsconfig.bot.json &gt;/dev/null 2&gt;&amp;1 ; echo "tsc_exit=$?"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'getTradesByToken' src/utils/db.ts == 0` — the symbol no longer appears anywhere in this file.
    - `grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/ 2>/dev/null` returns 0 matches across the repo (Pitfall #22 dependency guard re-confirmation post-deletion).
    - `grep -c 'const insertTrade = db.prepare' src/utils/db.ts == 1` — the `insertTrade` neighbor block is intact.
    - `grep -c 'const updateTradeStatus = db.prepare' src/utils/db.ts == 1` — the `updateTradeStatus` neighbor block is intact.
    - `npx tsc --noEmit -p tsconfig.bot.json` exits 0.
    - `npx vitest run --project unit` exits 0 (no test breakage from the deletion).
    - `.planning/milestones/v6.17-debt-baseline.md` ledger row for "Phase 16: getTradesByToken" has Disposition cell containing `acted-on (deleted in Plan 17-03)` (or equivalent confirmed-acted phrasing).
  </acceptance_criteria>
  <done>
The `getTradesByToken` declaration is deleted from `src/utils/db.ts`; surrounding `insertTrade` and `updateTradeStatus` blocks are preserved verbatim; tsc and vitest pass; the v6.17 baseline ledger row is updated to reflect the closure.
  </done>
</task>

<task type="auto">
  <name>Task 3: Append CI invariant guards to .github/workflows/test.yml (D-08 .todo ban + tsc × 3)</name>
  <files>.github/workflows/test.yml</files>
  <read_first>
    - .github/workflows/test.yml (CURRENT FILE — full 19 lines; the existing `test` job has 5 steps ending at `- run: npm run test:integration` on line 19)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 56-114 — full CI guard YAML excerpt; D-10 smallest-diff append; indentation conventions; D-09 strict ban rationale)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (D-08 two new guards; D-09 strict ban; D-10 step structure planner discretion → smallest-diff append)
    - .planning/milestones/v6.17-debt-baseline.md (the source-of-truth doc this CI guard locks in as evergreen)
  </read_first>
  <action>
Append four new YAML steps to the existing `test` job in `.github/workflows/test.yml`, AFTER the existing `- run: npm run test:integration` line (line 19). Use the `Edit` tool with `old_string` set to the existing last line and `new_string` set to the existing last line plus the appended steps.

**Concrete edit:**

`old_string` (the LAST 1 line of the current file — must match verbatim including the leading indentation):
```
      - run: npm run test:integration
```

`new_string` (the same line plus 4 new steps, all at 6-space indent matching existing `- run:` style):
```
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

**Indentation:** 6 spaces for `- name:` and `- run:` lines (matches the existing `- run: npm run test:integration` indentation). 8 spaces for the `run: |` block-scalar body content (literal `if find ...`, `echo ...`, etc.).

**Why these 4 steps and not a single combined step:**
- The `.todo` ban step uses a multi-line bash block (two `if`s, conditional `exit 1`s) — it must be its own `run: |` block.
- The 3 tsconfig variants are split into 3 separate steps so a failure clearly reports WHICH config failed in the GitHub Actions UI ("TypeScript check (tsconfig.bot.json)" surfaces explicitly). A single `npx tsc -p ... && npx tsc -p ...` chain would obscure which config broke.
- D-10 leaves step structure to planner discretion; this is the smallest-diff path that preserves CI failure-messaging clarity.

**Verification before commit:**
1. `grep -c '^      - name: Ban .todo test stubs$' .github/workflows/test.yml == 1` — guard step present.
2. `grep -c '^      - name: TypeScript check' .github/workflows/test.yml == 3` — three tsc steps present.
3. `grep -c '^      - run: npm run test:unit$' .github/workflows/test.yml == 1` AND `grep -c '^      - run: npm run test:integration$' .github/workflows/test.yml == 1` — pre-existing steps preserved.
4. The file is valid YAML — verify with `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/test.yml', 'utf8')); console.log('valid')"` (if `js-yaml` is in node_modules; otherwise use any YAML parser available).
5. Optional: run the guards locally to confirm green at execution time:
   ```bash
   if find test/ -name '*.todo*' -print | grep -q .; then echo NONZERO; else echo zero; fi
   grep -rEn '\.todo\s*\(|it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/ ; echo "exit=$?"
   npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.bot.json && npx tsc --noEmit -p dashboard/tsconfig.json
   ```
   If any of these fail at local-run, this is informational — the CI will fail when pushed. STOP per D-07 (real broken state revealed by the new guards is a Phase 17 finding worth surfacing).
  </action>
  <verify>
    <automated>grep -c '^      - name: Ban .todo test stubs$' .github/workflows/test.yml ; grep -c '^      - name: TypeScript check' .github/workflows/test.yml</automated>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/test.yml` contains EXACTLY ONE line `      - name: Ban .todo test stubs` (verifiable: `grep -c '^      - name: Ban .todo test stubs$' .github/workflows/test.yml == 1`).
    - `.github/workflows/test.yml` contains EXACTLY THREE lines starting with `      - name: TypeScript check ` (verifiable: `grep -c '^      - name: TypeScript check' .github/workflows/test.yml == 3`).
    - The three tsc steps target the three tsconfig variants exactly: `-p tsconfig.json`, `-p tsconfig.bot.json`, `-p dashboard/tsconfig.json` (verifiable via `grep -c "npx tsc --noEmit -p tsconfig.json" .github/workflows/test.yml == 1`, similarly for the other two).
    - Pre-existing steps preserved: `grep -c '^      - run: npm run test:unit$' .github/workflows/test.yml == 1` AND `grep -c '^      - run: npm run test:integration$' .github/workflows/test.yml == 1` AND `grep -c '^      - uses: actions/checkout@v4$' .github/workflows/test.yml == 1`.
    - The `.todo` ban guard contains the literal substring `it\.skip` in its comment (D-09 escape-hatch documentation): `grep -c "it.skip" .github/workflows/test.yml == 1`.
    - The file is valid YAML — verifiable via any YAML parser (e.g., `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/test.yml', 'utf8'))"` exits 0).
    - Locally-run versions of the guard commands all succeed: `find test/ -name '*.todo*' -print` returns empty AND `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.bot.json && npx tsc --noEmit -p dashboard/tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>
The CI workflow has 4 new steps appended to the existing `test` job: `.todo` ban + 3 tsc-clean checks. YAML is valid. Local-run dry-pass confirms the guards are green at the v6.17 baseline. The `.todo` ban includes its `it.skip` escape-hatch documentation per D-09.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Repo contents → CI workflow execution | A maliciously-modified workflow file or a malicious test file could exfiltrate secrets in CI. This plan modifies the workflow but only to ADD guard steps that read filesystem (no secrets, no network egress). |
| `npx tsc` invocation → npm registry | `npx` resolves to a cached binary or downloads from npm. If the npm cache is poisoned, `npx tsc` could execute arbitrary code. Existing trust assumption from the existing `npx`-using workflow (`npm ci`, `npm run test:*`). |
| `find test/` and `grep -rEn test/` → repository contents | Read-only filesystem scan; no privilege escalation surface. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-17-03-01 | Tampering | `.github/workflows/test.yml` (CI workflow modification) | mitigate | All edits are visible in `git diff`; PR review enforces second-pair-of-eyes. The new steps run only filesystem reads (`find`, `grep`) and binary invocations (`npx tsc`) — no `curl`, no `chmod`, no `eval`. Smallest-diff append (D-10) keeps the change auditable. |
| T-17-03-02 | Elevation of Privilege | New CI step that runs an attacker-supplied bash payload via the `run: \|` block | mitigate | The bash payload is hard-coded in the YAML (verbatim from PATTERNS.md lines 79-93). It does NOT interpolate any env vars, secrets, branch names, or PR-author input. Cannot be hijacked by a malicious PR (pull_request runs from the base branch's workflow file by default for forks). |
| T-17-03-03 | Denial of Service | A future test author commits a `.todo` and CI fails to merge | accept | This is the intended behavior per D-09 strict ban. CI failure surfaces immediately; contributor switches to `it.skip('reason: ...')`. |
| T-17-03-04 | Information Disclosure | `find test/ -name '*.todo*'` exposes filenames in CI logs | accept | Test filenames are non-sensitive in this repo. Same trust model as `npm run test:integration` which surfaces all test names on failure. |
| T-17-03-05 | Repudiation | `getTradesByToken` deletion silently breaks an undocumented caller (Pitfall #22) | mitigate | Task 1 Check 3 runs `grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/` BEFORE Task 2's deletion. Any non-`src/utils/db.ts:215` match STOPS the deletion. Post-deletion, `npx tsc --noEmit` and `npx vitest run --project unit` are gating verifications. |
| T-17-03-06 | Tampering (supply chain) | A malicious npm dep gets pulled by `npx tsc` in the new CI steps | accept | `npx tsc` resolves to the version pinned in `package.json` (TypeScript already a dep; not new). `npm ci --legacy-peer-deps` (existing step) handles dep installation. No new external dep introduced by this plan. |

Phase 17 supply-chain risk mention (per planning_context note): the CI workflow modification IS the attack-adjacent change. Mitigation: the appended steps invoke only existing tools (`find`, `grep`, `npx tsc`) on existing repository contents; no new third-party action, no new external network call, no new secret consumption. The `actions/checkout@v4` and `actions/setup-node@v4` were already in the workflow pre-modification — this plan does not touch them.
</threat_model>

<verification>
- `src/utils/db.ts` no longer contains `getTradesByToken` (verifiable via `grep -c 'getTradesByToken' src/utils/db.ts == 0`).
- The whole repo no longer references `getTradesByToken` (verifiable via `grep -rc 'getTradesByToken' src/ dashboard/ test/ scripts/ 2>/dev/null` returning 0).
- `.github/workflows/test.yml` has 9 steps total (5 pre-existing + 4 new) (verifiable via `grep -cE '^      - (uses|name|run):' .github/workflows/test.yml >= 9`).
- The full test suite passes locally: `npx vitest run --project unit --project integration` exits 0.
- All 3 tsc variants exit clean: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.bot.json && npx tsc --noEmit -p dashboard/tsconfig.json` exits 0.
- `.planning/milestones/v6.17-debt-baseline.md` ledger row for `getTradesByToken` is updated to reflect deletion.
</verification>

<success_criteria>
ROADMAP.md Phase 17 Success Criterion 4 (`getTradesByToken` unused const at `src/utils/db.ts:215` no longer appears in the codebase) is satisfied by Task 2's deletion. The diagnostic console.log half of SC-4 (`src/telegramListener.ts:55,61`) is satisfied by Task 1 Check 5: pre-scout already verified those lines are env-parse expressions, not console.log calls — verified-resolved at execution time.

ROADMAP.md Phase 17 Success Criterion 2 (after Phase 17 completes, `tsc --noEmit` exits clean across all tsconfig projects with zero `as any` suppressions added in this phase, and `find test/ -name '*.todo*'` either returns empty OR each remaining hit has been converted to `.skip` with explicit reason) is locked in as an EVERGREEN INVARIANT by Task 3's CI guards. The baseline becomes a regression-blocking property of CI rather than a one-time snapshot.

Phase 17 itself is now closeable subject to Plan 17-02's stop-the-line outcome.
</success_criteria>

<output>
After completion, create `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-03-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. The summary MUST include:
- Verbatim stdout of all 5 verify-then-act checks from Task 1 (the audit trail showing un-scouted items were re-verified at execution time per D-11)
- Pre/post diff snippet for `src/utils/db.ts` showing the 3-line deletion
- Full diff snippet for `.github/workflows/test.yml` showing the 4 new steps appended
- Confirmation that `npx vitest run --project unit --project integration` exits 0 post-changes
- Confirmation that `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.bot.json && npx tsc --noEmit -p dashboard/tsconfig.json` exits 0 post-changes
- The updated row in `.planning/milestones/v6.17-debt-baseline.md` with disposition `acted-on (deleted in Plan 17-03)`
- If Check 5 fired (telegramListener console.log replaced with log.debug): pre/post diff for `src/telegramListener.ts`. If Check 5 found no matches (expected per pre-scout): explicit confirmation `src/telegramListener.ts NOT modified — verified-resolved at execution time`.
- Note: if Phase 17 close requires Plan 17-02's stop-the-line clearance, surface that here
</output>
