---
phase: 17
plan: 1
slug: baseline-and-close-evidence
type: execute
wave: 0
depends_on: []
files_modified:
  - .planning/milestones/v6.17-debt-baseline.md
autonomous: true
requirements:
  - DEBT-01
  - DEBT-02
  - DEBT-03  # CONDITIONAL — see Branch B; closes as verified-empty if wave-0 confirms 0 .todo
  - DEBT-04  # CONDITIONAL — see Branch B; closes as verified-empty if wave-0 confirms 0 tsc errors
must_haves:
  truths:
    - "Operator can read .planning/milestones/v6.17-debt-baseline.md and see the literal stdout of `find test/ -name '*.todo*' -print` and `npx tsc --noEmit` for all three tsconfig variants — committed as the v6.17 ground truth (ROADMAP.md SC-1)."
    - "After this plan lands, every `tech_debt:` claim in v6.16-MILESTONE-AUDIT.md (lines 14-37) has an explicit per-claim disposition (verified-resolved | acted-on | still-valid) recorded in the baseline doc (ROADMAP.md SC-1, satisfies D-11 verify-then-act)."
    - "DEBT-03 and DEBT-04 close-out is documented in the baseline doc — either as 'verified-empty' (Branch A: 0/0 confirmed) or with an enumerated remaining-work list (Branch B: non-zero) (ROADMAP.md SC-2)."
    - "The baseline doc is committed to git in `.planning/milestones/` alongside `v6.16-MILESTONE-AUDIT.md` (canonical home per CONTEXT.md `<code_context>` line 278-281)."
  artifacts:
    - path: .planning/milestones/v6.17-debt-baseline.md
      provides: "v6.17 wave-0 ground-truth baseline: actual `.todo` count, actual tsc-clean per tsconfig, per-claim verify-then-act ledger for all v6.16-MILESTONE-AUDIT.md `tech_debt:` items, DEBT-03/04 conditional disposition."
      contains: "tsc_clean"
  key_links:
    - from: .planning/milestones/v6.17-debt-baseline.md
      to: .planning/milestones/v6.16-MILESTONE-AUDIT.md
      via: "per-claim ledger maps each entry from `tech_debt:` (lines 14-37) to a v6.17 disposition"
---

<objective>
Wave 0 of Phase 17. Run the CI commands fresh against the working tree at execution time, commit the literal stdout as the source-of-truth baseline, and close out DEBT-03/04 conditionally based on the actual numbers.

Per D-05: pre-scout (2026-04-29) verified 0 `.todo` matches and tsc-clean × 3 tsconfigs, BUT this plan re-runs the commands at execution time on a fresh working tree. Pre-scout is informational; execution-time output is the artifact.

Per D-06: this plan covers DEBT-01 (`.todo` count baseline), DEBT-02 (tsc count baseline), and DEBT-03/04 close-out CONDITIONAL on the wave-0 numbers. The plan documents BOTH branches:
- **Branch A (verified-empty short-path):** wave 0 confirms 0/0 → DEBT-03 + DEBT-04 close immediately as "verified-empty" with the baseline as evidence.
- **Branch B (real-fill-or-skip path):** wave 0 returns non-zero → DEBT-03 fills/`.skip`s remaining stubs (per D-09 strict ban: prefer `.skip('reason: ...')` over hollow fills), DEBT-04 fixes TS errors via real type definitions (per Pitfall #21 — no `as any` suppression).

Output: `.planning/milestones/v6.17-debt-baseline.md` committed to git.
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
@.planning/milestones/v6.16-MILESTONE-AUDIT.md

<interfaces>
<!-- The analog file that establishes the baseline-doc convention. -->
<!-- v6.16-MILESTONE-AUDIT.md is the sibling doc in the same directory; this plan's output mirrors its frontmatter shape and tabular body conventions. -->

From .planning/milestones/v6.16-MILESTONE-AUDIT.md (frontmatter shape — analog for v6.17-debt-baseline.md):
```yaml
---
milestone: v6.16
audited: 2026-04-14T00:00:00Z
status: tech_debt
scores:
  requirements: 48/48
  phases: 16/16
  integration: 47/47
  flows: 5/5
gaps:
  requirements: []
  integration: []
  flows: []
tech_debt:
  - phase: 01-bug-fixes-hardening
    items:
      - "Diagnostic console.log in telegramListener.ts (lines 55, 61) marked for removal"
nyquist:
  compliant_phases: [...]
  partial_phases: [...]
  overall: "PARTIAL - 7/16 compliant, 9/16 partial"
---
```

From .planning/milestones/v6.16-MILESTONE-AUDIT.md (`tech_debt:` items, lines 14-37 — the verify-then-act target list per D-11):
- 01: "Diagnostic console.log in telegramListener.ts (lines 55, 61) marked for removal"
- 01: "releaseSellLock exported but never called (safe due to clearAllTimersForToken)"
- 03: "Working tree regressions: logger.ts, notifier.ts, retry.ts reverted to pre-migration versions (committed HEAD correct)"
- 03: "testAlert.ts has 3 pre-existing console calls (not in plan scope)"
- 03: "pino and better-sqlite3 not installed in node_modules (npm install needed)"
- 07: "Exit engine test import block commented out; 37 .todo test stubs remain unfilled"
- 08: "6 TypeScript errors in API route files (type narrowing: req.params, Function type)"
- 08: "1 test fixture mismatch (health test latestBlock 12345 vs 12345678)"
- 11: "Pre-existing getPnLChartData redeclare TS error in db.ts"
- 16: "VERIFICATION.md never generated"
- 16: "getTradesByToken remains as unused local const in db.ts:215 after export removal (dead code)"

11 total items across 6 phases.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run wave-0 CI commands and capture stdout</name>
  <files>.planning/milestones/v6.17-debt-baseline.md (new file - draft)</files>
  <read_first>
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (`<domain>` lines 14-29 for pre-scout result; D-05 wave-0 protocol)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 117-167 — `v6.17-debt-baseline.md` analog and frontmatter shape)
    - .planning/milestones/v6.16-MILESTONE-AUDIT.md (lines 1-43 frontmatter — analog; lines 14-37 `tech_debt:` items — verify targets)
  </read_first>
  <action>
Run the four CI commands below from the repo root, capture stdout/stderr/exit-code from each, and assemble the draft of `.planning/milestones/v6.17-debt-baseline.md`. Do NOT short-circuit based on pre-scout — pre-scout (2026-04-29) is informational; execution-time output is the committed artifact (per D-05).

**Commands to run, in order, capturing literal stdout:**

```bash
# Command 1 — DEBT-01: filename-suffix `.todo` ban check
find test/ -name '*.todo*' -print

# Command 2 — DEBT-01: in-file `.todo()` invocation grep (D-08 #1, paired with command 1)
grep -rEn '\.todo\s*\(|it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/ ; echo "exit=$?"

# Command 3 — DEBT-02: tsc --noEmit × 3 tsconfig variants (D-08 #2, all three must exit clean)
npx tsc --noEmit -p tsconfig.json ; echo "tsc_root_exit=$?"
npx tsc --noEmit -p tsconfig.bot.json ; echo "tsc_bot_exit=$?"
npx tsc --noEmit -p dashboard/tsconfig.json ; echo "tsc_dashboard_exit=$?"

# Command 4 — DEBT-06 verify-then-act precursor: confirm `getTradesByToken` is still in src/utils/db.ts
grep -n 'getTradesByToken' src/utils/db.ts
```

**Important:** `grep -E -rn` exits 0 on match, 1 on no match — DEBT-01 considers exit=1 (no match) as the success case (0 .todo invocations). Record both the exit code and the matched lines (if any).

After running all four, assemble the draft of the baseline doc with:

1. **Frontmatter** mirroring `v6.16-MILESTONE-AUDIT.md` shape (per PATTERNS.md lines 121-149) but with v6.17 fields:
   ```yaml
   ---
   milestone: v6.17
   scoped: 2026-04-29   # use the actual execution date if different
   status: baseline     # or "tech_debt" if any non-zero result
   tsc_clean: 3/3       # set to actual e.g. "2/3" if any tsc command exits non-zero
   todo_count: 0        # set to actual count of `.todo` matches
   per_phase_disposition: {...}  # see body
   ---
   ```

2. **Body sections** in this order:
   - `# v6.17 Tech Debt Baseline` H1
   - `## Wave 0 CI Output (executed YYYY-MM-DD)` — literal stdout of all 4 commands above, in fenced ```bash blocks with shell-prompt prefix
   - `## DEBT-01 .todo Disposition` — the count from commands 1+2 plus an explicit "verified-empty" or "non-zero" verdict
   - `## DEBT-02 tsc --noEmit Disposition` — per-tsconfig pass/fail table (3 rows: tsconfig.json, tsconfig.bot.json, dashboard/tsconfig.json)
   - `## Per-Claim Verify-Then-Act Ledger (v6.16-MILESTONE-AUDIT.md tech_debt: closure)` — tabular row-per-claim from v6.16-MILESTONE-AUDIT.md lines 14-37 (11 items total). Columns: `| Phase | Claim | Verification command | Output | Disposition (verified-resolved / acted-on / still-valid / deferred-to-Plan-17-03) |`. For Phase 16's `getTradesByToken` claim, mark disposition `still-valid → acted-on by Plan 17-03`.
   - `## DEBT-03 / DEBT-04 Close-Out` — Branch A (verified-empty) or Branch B (enumerated remaining work). See Task 2.
   - Footer: `_Scoped: YYYY-MM-DD by Claude (gsd-plan-phase wave 0)_` `_Re-runnable command: see "Wave 0 CI Output" section_`

**Tabular preferred** for the per-claim ledger per CONTEXT.md `<decisions>` Claude's-Discretion line 136. Narrative ONLY for context the table can't carry.

**Verify-then-act handling for the 11 v6.16-MILESTONE-AUDIT.md `tech_debt:` items** (per D-11):

| Item (verbatim from v6.16 audit) | Verification command | Expected disposition |
|---|---|---|
| 01: console.log in telegramListener.ts (55, 61) | `grep -n 'console\.log\|console\.warn\|console\.error' src/telegramListener.ts` | verified-resolved (pre-scout shows env-parse expressions, not console.log) — confirm at execution |
| 01: releaseSellLock never called | `grep -n 'releaseSellLock' src/exitEngine.ts src/utils/exitManager.ts` | verified-resolved (pre-scout: called at exitEngine.ts:517,628) — confirm at execution |
| 03: logger.ts/notifier.ts/retry.ts reverted in working tree | `git status src/utils/logger.ts src/utils/notifier.ts src/utils/retry.ts` | verify at execution: if `nothing to commit` or no diff → verified-resolved; else flag |
| 03: testAlert.ts pre-existing console calls | `ls src/testAlert.ts 2>&1` | verified-resolved (pre-scout: file does not exist) — confirm at execution |
| 03: pino/better-sqlite3 not installed | `node -e "require('pino'); require('better-sqlite3'); console.log('OK')"` | verified-resolved — confirm |
| 07: 37 .todo test stubs | covered by command 1+2 above | verified-resolved if 0 matches |
| 08: 6 TS errors in API routes | covered by command 3 (tsc) above | verified-resolved if exit 0 |
| 08: health test fixture latestBlock 12345 vs 12345678 | `grep -n 'latestBlock' test/integration/api/health.test.ts test/fixtures/api.fixtures.ts` | verify: if `latestBlock: 12345678` (pre-scout suggests yes via test/integration/api/health.test.ts:95) → verified-resolved |
| 11: getPnLChartData redeclare TS error | covered by command 3 (tsc) above | verified-resolved if exit 0 |
| 16: VERIFICATION.md never generated | `ls .planning/phases/16-dashboard-type-alignment-dead-code-cleanup/16-VERIFICATION.md 2>&1` | record as `still-valid → audit-grade documentation gap; not addressable in v6.17 (Phase 17 is forward-looking)` OR mark deferred to Phase 21 EXIT-LIVE if the user prefers |
| 16: getTradesByToken unused local const | `grep -n 'getTradesByToken' src/utils/db.ts` | still-valid (pre-scout confirmed: line 215 STILL PRESENT) → mark `acted-on by Plan 17-03` (deferred to that plan per D-06 split) |

Record the EXACT verification stdout (including exit codes where applicable) in the ledger row's "Output" column. Do not paraphrase.
  </action>
  <verify>
    <automated>test -f .planning/milestones/v6.17-debt-baseline.md &amp;&amp; grep -c '^| Phase ' .planning/milestones/v6.17-debt-baseline.md | grep -v '^0$'</automated>
  </verify>
  <acceptance_criteria>
    - File `.planning/milestones/v6.17-debt-baseline.md` exists.
    - File contains a YAML frontmatter block (between two `---` lines starting at line 1) with at minimum the keys `milestone: v6.17`, `scoped: <date>`, `status: <baseline|tech_debt>`, `tsc_clean: N/3`, `todo_count: <integer>`.
    - File contains the literal H2 heading `## Wave 0 CI Output` followed by 4 fenced ```bash blocks with the verbatim stdout of the 4 commands listed in `<action>` (verifiable via `grep -c '^## Wave 0 CI Output' .planning/milestones/v6.17-debt-baseline.md == 1`).
    - File contains a tabular per-claim ledger with at minimum 11 rows corresponding to the 11 items from v6.16-MILESTONE-AUDIT.md `tech_debt:` (lines 14-37). Verifiable via: `grep -c '^| .* | .* | .* | .* |' .planning/milestones/v6.17-debt-baseline.md >= 12` (1 header row + 11 data rows + header divider line).
    - File contains the literal H2 heading `## Per-Claim Verify-Then-Act Ledger`.
    - For the Phase 16 `getTradesByToken` row, the Disposition cell contains either `still-valid` or `acted-on by Plan 17-03`.
    - File contains a Disposition column where each of the 11 rows is one of: `verified-resolved`, `acted-on`, `still-valid`, `deferred-to-Plan-17-03`, or `acted-on by Plan 17-03`. No row has empty Disposition.
  </acceptance_criteria>
  <done>
The baseline doc exists with literal CI output captured, the 11-claim ledger is filled per-row with verbatim verification stdout and explicit dispositions, and the doc is ready for the Task 2 close-out section to be appended. The doc is NOT yet committed (Task 3 commits).
  </done>
</task>

<task type="auto">
  <name>Task 2: Append DEBT-03 / DEBT-04 close-out (Branch A or Branch B based on Task 1 results)</name>
  <files>.planning/milestones/v6.17-debt-baseline.md (modify - append close-out section)</files>
  <read_first>
    - .planning/milestones/v6.17-debt-baseline.md (the draft from Task 1, especially the Wave 0 CI Output and DEBT-01/02 disposition sections)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (D-05 baseline-first conditional close-out; D-09 strict `.todo` ban — `.skip` is the contributor escape hatch)
    - .planning/research/PITFALLS.md lines 624-680 (Pitfall #20 hollow `.todo` test fills, Pitfall #21 `as any` suppressions — these constrain Branch B)
  </read_first>
  <action>
Read the Task 1 output values for `todo_count` and `tsc_clean` in the frontmatter. Determine which branch to write.

**Branch A — verified-empty short-path (expected case per pre-scout):**

If `todo_count == 0` AND `tsc_clean == 3/3`, append this exact section (with date stamp filled in):

```markdown
## DEBT-03 / DEBT-04 Close-Out — Branch A: verified-empty

**Wave 0 result:** `.todo count = 0` and `tsc --noEmit` exits clean across all 3 tsconfig variants.

**DEBT-03 disposition:** **verified-empty.** No `.todo` test stubs remain. The disputed v6.16-MILESTONE-AUDIT.md claim of "37 .todo test stubs" (Phase 07 audit, line 25) is closed as STALE. Evidence: this baseline doc's `## Wave 0 CI Output` section (commands 1 + 2 above) returned 0 matches.

**DEBT-04 disposition:** **verified-empty.** Zero TS errors across `tsconfig.json`, `tsconfig.bot.json`, `dashboard/tsconfig.json`. The disputed v6.16-MILESTONE-AUDIT.md claim of "6 TypeScript errors in API route files" (Phase 08 audit, line 29) is closed as STALE. Evidence: this baseline doc's `## Wave 0 CI Output` section (command 3) returned exit 0 for all three.

**Forward action:** Plan 17-03 establishes the CI invariant lock (per D-08) so the baseline becomes evergreen rather than a snapshot.
```

**Branch B — enumerated remaining work (fallback case if pre-scout regression occurred):**

If `todo_count > 0` OR `tsc_clean != 3/3`, append this section (filled in with actual data):

```markdown
## DEBT-03 / DEBT-04 Close-Out — Branch B: enumerated remaining work

**Wave 0 result:** `.todo count = N` (M filename-match + L grep-match), `tsc --noEmit` exits non-zero on K of 3 tsconfig variants.

### DEBT-03 — Remaining `.todo` stubs

| File | Line | Existing form | Required action (per D-09 strict ban + Pitfall #20) |
|------|------|---------------|------|
| {file:line} | {N} | {it.todo('...') / .todo file} | Convert to `it.skip('reason: <verbatim_developer_supplied_reason>', () => {})` OR fill with a real behavioral assertion (D-04 rigor: at least one observable effect). NO `expect(true).toBe(true)` or trivial fills. |
{... one row per remaining .todo}

### DEBT-04 — Remaining TS errors

| tsconfig | Error message (verbatim from `npx tsc --noEmit -p ...` stderr) | Required action (per Pitfall #21 — no `as any` suppression) |
|----------|----------------------------------------------------------------|------|
| {tsconfig.json | tsconfig.bot.json | dashboard/tsconfig.json} | {error message} | Add real type definition. If type is unknown at boundary, add Zod validator + inferred type. NO `as any`. |
{... one row per remaining TS error}

**Forward action:** Each row above gets implemented as a follow-up task in Plan 17-01 (extension if Branch B fires) or escalated to a NEW Plan 17-04 (if scope exceeds 3 tasks). User decides at execution time.

**Stop-the-line guard (per D-07):** If acting on any of the above reveals a real production bug (test that exposes an actual broken behavior; type error masking a real bug), surface to user immediately and BLOCK Phase 17 close. NOT fix-in-flight, NOT file-and-defer.
```

**Choose exactly one branch** based on the Task 1 frontmatter values; do NOT include both. Write the chosen branch as a NEW H2 section appended at end-of-file (after the per-claim ledger from Task 1).
  </action>
  <verify>
    <automated>grep -c '^## DEBT-03 / DEBT-04 Close-Out — Branch [AB]:' .planning/milestones/v6.17-debt-baseline.md | grep -E '^1$'</automated>
  </verify>
  <acceptance_criteria>
    - File `.planning/milestones/v6.17-debt-baseline.md` contains EXACTLY ONE H2 section starting with `## DEBT-03 / DEBT-04 Close-Out — Branch ` (verifiable via `grep -c '^## DEBT-03 / DEBT-04 Close-Out — Branch [AB]:' .planning/milestones/v6.17-debt-baseline.md == 1`).
    - The chosen branch (A or B) matches the frontmatter values: if `todo_count == 0` and `tsc_clean == 3/3` → Branch A; otherwise Branch B.
    - If Branch A: section contains the literal strings `verified-empty` (twice — once for DEBT-03, once for DEBT-04) and `disputed v6.16-MILESTONE-AUDIT.md claim of "37 .todo test stubs"` and `disputed v6.16-MILESTONE-AUDIT.md claim of "6 TypeScript errors in API route files"`.
    - If Branch B: section contains a tabular DEBT-03 row-per-`.todo` AND a tabular DEBT-04 row-per-TS-error AND the literal string `Stop-the-line guard (per D-07)`.
    - The close-out section appears AFTER the per-claim ledger H2 (verifiable via `awk '/^## DEBT-03 \/ DEBT-04/{found=1} /^## Per-Claim/{if(found)exit 1}END{print "ok"}' .planning/milestones/v6.17-debt-baseline.md == "ok"`).
  </acceptance_criteria>
  <done>
The baseline doc has its DEBT-03/04 close-out section appended in the correct branch. The doc is now feature-complete and ready to commit.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human-verify the baseline doc, then commit</name>
  <what-built>
Wave-0 baseline doc at `.planning/milestones/v6.17-debt-baseline.md` containing:
- Literal stdout of 4 wave-0 CI commands
- Per-tsconfig disposition table (3 rows)
- Per-claim verify-then-act ledger for all 11 v6.16-MILESTONE-AUDIT.md `tech_debt:` items
- DEBT-03/04 close-out (Branch A verified-empty OR Branch B enumerated work)

This artifact is the ground-truth source that Plans 17-02 and 17-03 reference. Their `requirements: [DEBT-03, DEBT-04]` close-outs depend on this doc's branch decision.
  </what-built>
  <how-to-verify>
1. Read `.planning/milestones/v6.17-debt-baseline.md` end-to-end.
2. Spot-check 2 of the 11 ledger rows against the original v6.16-MILESTONE-AUDIT.md `tech_debt:` text — confirm the claim is preserved verbatim, the verification command is sane, and the output is the literal stdout (not paraphrased).
3. Confirm the branch decision (A or B) matches `todo_count` and `tsc_clean` in the frontmatter.
4. If Branch A: confirm DEBT-03 and DEBT-04 are explicitly closed as `verified-empty` with the audit-claim cross-references.
5. If Branch B: confirm the remaining-work tables list every `.todo` and every TS error with file:line and a non-suppression action. Reject if any action is `as any` or `expect(true).toBe(true)`.
6. Approve to commit, OR identify specific fixes needed.

If approved, commit:
```bash
git add .planning/milestones/v6.17-debt-baseline.md
git commit -m "docs(17-01): commit v6.17 wave-0 debt baseline (DEBT-01..04)

Wave-0 CI output captured fresh against working tree. Per-claim
verify-then-act ledger closes 11 v6.16-MILESTONE-AUDIT.md tech_debt items.
DEBT-03/04 close as Branch <A|B> per actual counts.

Closes: DEBT-01, DEBT-02
Conditional close: DEBT-03, DEBT-04 (Branch <A|B>)
Refs: D-05 baseline-first, D-06 plan split, D-11 verify-then-act"
```

Then notify Plan 17-02 and Plan 17-03 they can proceed (they're wave 1, both depend on 17-01).
  </how-to-verify>
  <resume-signal>Type "approved" to commit, OR list specific fixes (e.g., "row 3 ledger output paraphrased — re-paste literal stdout").</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Developer → committed planning docs | Doc-only artifact; no runtime/network surface introduced |
| Wave-0 CI command output → committed file | Literal stdout captured into a versioned file; no parsing/transformation surface |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-17-01-01 | Tampering | `.planning/milestones/v6.17-debt-baseline.md` body | accept | Doc is in version control under `master`; tampering visible in `git diff` and review. Same trust model as every other planning doc in the repo. No additional mitigation. |
| T-17-01-02 | Information Disclosure | Wave-0 CI command stdout | accept | `tsc` and `find` outputs contain no secrets — only filesystem paths and TS error text. Repo is private; treating filenames as non-sensitive is consistent with rest of `.planning/`. |
| T-17-01-03 | Repudiation | Doc claims "verified-empty" without truthful CI run | mitigate | Acceptance criteria require LITERAL stdout of the 4 wave-0 commands committed verbatim in the doc — operator can re-run any command from the doc and compare. The doc is re-runnable proof, not unverifiable narrative. |

No high-severity threats; doc-only plan with no runtime/network surface. Phase 17 is intentionally a pre-substantive-work cleanup phase.
</threat_model>

<verification>
- `.planning/milestones/v6.17-debt-baseline.md` exists and is committed to git (visible in `git log --oneline -- .planning/milestones/v6.17-debt-baseline.md`).
- Frontmatter has `todo_count` and `tsc_clean` set to actual integer/fraction values.
- Per-claim ledger has 11 data rows (one per v6.16-MILESTONE-AUDIT.md `tech_debt:` item).
- Exactly one DEBT-03/04 close-out branch (A or B) is present and matches the frontmatter values.
- Plan 17-02 and Plan 17-03 are unblocked (their `depends_on: ['17-01']` is satisfied).
</verification>

<success_criteria>
ROADMAP.md Phase 17 Success Criterion 1 (commit `find test/ -name '*.todo*' -print` and `npx tsc --noEmit` artifacts in `.planning/milestones/v6.17-debt-baseline.md`) is satisfied for the artifact-existence half. The "operator can see the actual counts as ground truth" half is satisfied by the literal `## Wave 0 CI Output` section content.

ROADMAP.md Phase 17 Success Criterion 2 (after Phase 17 completes, `tsc --noEmit` exits clean and `find test/ -name '*.todo*'` returns empty or each remaining hit is `.skip` with reason) is contributed-to by this plan via:
- Branch A: 0/0 already proven; SC-2 satisfied for DEBT-03/04 portion.
- Branch B: enumerated remaining-work table establishes the worklist that Plan 17-01 (or follow-up) implements.

CI invariant lock that turns these baselines into evergreen guards is Plan 17-03's job.
</success_criteria>

<output>
After completion, create `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-01-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. The summary must record:
- The branch decision (A or B) with the actual `todo_count` and `tsc_clean` values
- The disposition of each of the 11 v6.16 audit `tech_debt:` claims
- Any items handed off to Plan 17-03 (specifically, Phase 16's `getTradesByToken` deletion)
</output>