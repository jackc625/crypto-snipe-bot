# Phase 17: Tech Debt Cleanup & Audit Baseline - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

CI-verified ground-truth baseline of v6.16 close debt + retroactive Nyquist
harm-prevention assertion on 9 phases (excluding FIX-04 Phase 1, V3-03 Phase 5
which are addressed via fresh implementation in Phase 18 HONEY-07/08) +
diagnostic-log/dead-code cleanup. Foundation phase: clears the audit deck
before any v6.17 substantive feature work begins (Phase 18 HONEY follows).

**Pre-scout ground truth** (verified 2026-04-29 against working tree):
- `find test/ -name '*.todo*'` → 0 matches
- `grep '\.todo\(\|it\.todo\|test\.todo'` against `test/` → 0 matches
- `npx tsc --noEmit` (root, tsconfig.bot.json, dashboard/tsconfig.json) → all exit 0
- `src/telegramListener.ts:55,61` → no `console.log` (lines are env-parse
  expressions invoking structured `log.warn/info/debug`)
- `src/utils/db.ts:215` `getTradesByToken` → STILL PRESENT as unused local const
- `testAlert.ts` → file does not exist (already deleted)
- `releaseSellLock` → called at `src/exitEngine.ts:517,628` (NOT unused)

10 of 11 v6.16-MILESTONE-AUDIT.md `tech_debt:` claims are already silently
resolved between v6.16 ship (2026-04-14) and now (2026-04-29). Phase 17
documents the ground truth in a single baseline artifact and acts on the only
remaining item plus the structural improvements (retroactive Nyquist, CI
regression guards).

</domain>

<decisions>
## Implementation Decisions

### Retroactive Nyquist assertion shape (DEBT-05)

- **D-01:** Hybrid form for the 9 phases: 7 NEW tests + 2 INLINE
  VALIDATION.md augmentations. Each retroactively-validated phase produces ONE
  production-relevant assertion answering "does this prevent the harm we said
  it would?" — explicitly NOT just "tests pass". Aligned with Pitfall #19
  (anti-rubber-stamp).
- **D-02:** Per-phase split (locked):
  - **NEW TEST** (7): Phase 01 (FIX-01 exit-monitor race), Phase 03 (DB
    atomicity / WAL property), Phase 05 (V3-02 liquidity wait —
    V3-03 EXCLUDED, addressed in HONEY-08), Phase 06 (RISK daily-loss gate
    blocks the snipe), Phase 07 (EXIT-01 stop-loss triggers `executeFullSell`),
    Phase 08 (DASH/MON health endpoint emits version), Phase 10 (partial-sell
    `amount_out` non-null on receipt-decoded sell).
  - **INLINE DOC** (2): Phase 02 (ethers v6 migration — pure type-system
    property; document inline pointing to existing tests + tsc-clean baseline),
    Phase 09 (testing infrastructure — meta; document inline pointing to CI
    `npm run test:unit` exit-non-zero behavior + pre-existing 343/343 green).
  - Phase 1's harm-prevention test EXCLUDES FIX-04 (V2 sell-sim) — addressed
    via fresh implementation in HONEY-07; validated at fresh-implementation
    time per Pitfall #19.
- **D-03:** Test location: co-locate by what's tested in existing
  `test/{unit,integration,fork}/` tree. Discoverable via `Phase N
  harm-prevention:` describe-block prefix in the test body. NO new
  `test/validation/` directory; NO new vitest project. Phase linkage stays in
  each phase's `N-VALIDATION.md` mapping.
- **D-04:** Rigor bar: each new test must exercise the harm scenario AND
  assert at least one concrete observable effect (DB row inserted/absent, mock
  function called with specific args, structured pino log line emitted,
  transaction submitted/blocked). Aligned with Pitfall #20 (anti-hollow-fill).
  Falsification rigor (test would fail pre-phase) is deferred — observable
  effect is the practical bar; revisit if v6.18+ wants stronger guarantees.

### Phase 17 internal sequencing

- **D-05:** Baseline-first wave 0. Wave 0 runs the CI commands fresh
  against the working tree at execution time and commits the artifact to
  `.planning/milestones/v6.17-debt-baseline.md` as the ground-truth source
  (NOT the disputed v6.16 close audit numbers). DEBT-03 and DEBT-04 are
  CONDITIONAL on wave 0's results — if 0/0 is confirmed, both close as
  "verified-empty" with the baseline as evidence; if non-zero, they become
  real tasks. The plan documents both branches.
- **D-06:** Three-plan split inside Phase 17:
  - **Plan 17-01** = DEBT-01 + DEBT-02 baseline-doc + DEBT-03/04 conditional
    close-out (the wave 0 + close-evidence plan).
  - **Plan 17-02** = DEBT-05 retroactive Nyquist across the 9 phases
    (substantive plan; 7 new tests + 2 inline `N-VALIDATION.md` augmentations).
  - **Plan 17-03** = DEBT-06 dead-code/diagnostic cleanup + CI regression
    guards (the cleanup + invariant-locking plan).
- **D-07:** Stop-the-line if any retroactive harm-prevention test for any
  phase reveals a real production bug during execution. Bug is surfaced to
  the user immediately, treated as a first-class v6.17 requirement upgrade
  (likely a new DEBT-07 or an inserted decimal phase 17.1), and Phase 17
  close is BLOCKED until the bug's disposition is decided. Aligned with the
  FIX-04/V3-03 precedent in Pitfall #19. Fix-in-flight (scope creep) and
  file-and-defer (rubber-stamp) are explicitly rejected.

### CI regression guard

- **D-08:** Phase 17 hardens `.github/workflows/test.yml` with TWO new
  guards locking in the 0/0 baseline as an evergreen invariant:
  1. `.todo` ban — `find test/ -name '*.todo*' -print` and equivalent grep
     for `it.todo(` / `test.todo(` / `describe.todo(`. Any match fails the
     build.
  2. `tsc --noEmit` clean — runs against all THREE tsconfig variants:
     `tsconfig.json` (root), `tsconfig.bot.json` (bot-only build),
     `dashboard/tsconfig.json` (dashboard frontend). Any error fails the
     build.
- **D-09:** Strict ban for `.todo` (NOT allowlist-with-reason). Future
  contributors who want a placeholder use `it.skip('reason: ...', () => {
  ... })` — same effect with explicit reason. The v6.17 baseline's 0/0
  status becomes a hard CI invariant, not a "good intention".
- **D-10:** Step structure inside test.yml is planner discretion (sequential
  append vs new parallel job vs new lint.yml workflow). Smallest-diff path
  recommended — append to the existing `test` job.

### Dead-code sweep scope (DEBT-06)

- **D-11:** Verify-then-act on every entry in
  `v6.16-MILESTONE-AUDIT.md` `tech_debt:` section. Phase 17's wave-0 baseline
  doc records the verification outcome for each — claims that are stale get
  documented as "verified-resolved" with the verifying command output;
  claims that are still valid get acted on (delete dead code, replace
  diagnostic console.log with `log.debug` where retention is appropriate per
  REQUIREMENTS.md DEBT-06, fix the test fixture). My pre-scout has already
  verified 10 of 11 audit `tech_debt:` items as resolved; the only valid
  item is the `getTradesByToken` deletion. Two items not yet
  scouted (working-tree regressions in logger.ts/notifier.ts/retry.ts; health
  test fixture latestBlock 12345 vs 12345678) are verified at execution time.
- **D-12:** Strict scope boundary with Phase 21 (EXIT-LIVE). Phase 17 sweep
  covers ONLY v6.16-MILESTONE-AUDIT.md `tech_debt:` items. The audit's
  `human_needed:` items (Phase 7 needs live runtime validation, Phase 14
  receipt decoder needs live chain verification, Phase 11 needs browser
  validation, etc.) stay deferred to Phase 21 EXIT-LIVE-01..11 where they
  are already mapped with real-mainnet artifact requirements. No overlap.

### Claude's Discretion

- Exact format of `v6.17-debt-baseline.md` (tabular per-claim entry vs
  narrative checklist vs hybrid table+details). Tabular preferred for
  audit-friendliness; narrative for context where needed.
- Step structure inside `.github/workflows/test.yml` (append to `test` job vs
  new parallel `lint` job vs new `lint.yml` workflow). Smallest-diff path
  recommended.
- Per-test design specifics inside Plan 17-02 (which fixture token, which
  mock pattern, which exact assertion shape). Planner + executor choice
  given the observable-effect rigor bar in D-04.
- Whether to delete additional dead exports if a follow-up grep during DEBT-06
  surfaces them (e.g., other unused helpers in `src/utils/`). Default: no
  expansion beyond audit-driven items per D-12 scope discipline.
- Phase 17's own validation/Nyquist disposition — DEBT category is
  self-referential (Phase 17 IS the retroactive validation phase). Planner
  decides whether Phase 17 needs an N-VALIDATION.md and whether the CI
  guards themselves count as the harm-prevention assertion for this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v6.17 milestone source-of-truth
- `.planning/PROJECT.md` — v6.17 milestone scope; "Known Tech Debt (v6.16
  close)" enumeration; constraints
- `.planning/REQUIREMENTS.md` — DEBT-01 through DEBT-06 success criteria
  (lines 12-21); FIX-04/V3-03 exclusion rationale (line 20)
- `.planning/ROADMAP.md` §"Phase 17: Tech Debt Cleanup & Audit Baseline"
  (lines 50-59) — goal, depends-on, requirements, success criteria
- `.planning/STATE.md` — v6.17 status, "Tech debt status disputed (Phase 17
  will resolve via CI)" (lines 83-84), Nyquist Validation Debt (lines 86-88)

### Audit ledger (the doc Phase 17 closes out)
- `.planning/milestones/v6.16-MILESTONE-AUDIT.md` — `tech_debt:` section
  (lines 14-37) is the verify-then-act target list; `nyquist:` section
  (lines 38-42) confirms the 9 partial phases (01, 02, 03, 05, 06, 07, 08,
  09, 10)

### Research convergence (v6.17 entry-level decisions)
- `.planning/research/SUMMARY.md` — Phase 17 sub-section (lines 191-195) —
  scope, "Research flag: SKIP", avoids pitfalls #17/#19/#20/#21/#22; Gaps
  section item 1 (line 265) — disputed `.todo`/TS status
- `.planning/research/PITFALLS.md` #19 (retroactive-validation
  rubber-stamps original bugs), #20 (hollow `.todo` test fills), #21 (`as
  any` suppressions), #22 (dead-code-removal breaks dependency)
- `.planning/research/ARCHITECTURE.md` — confirms `tsc --noEmit` and
  `.todo`-grep ground truth at research time
- `.planning/research/STACK.md` — Vitest 4.x stack confirmation; per-phase
  research flag

### Per-phase validation docs to augment (DEBT-05 inline-doc targets)
- `.planning/phases/02-ethers-v6-migration/02-VALIDATION.md` — inline
  augmentation pointing to existing tests + tsc-clean evidence
- `.planning/phases/09-testing-infrastructure/09-VALIDATION.md` — inline
  augmentation pointing to CI exit-non-zero behavior + 343/343 green

### Per-phase validation docs to reference (DEBT-05 new-test phases)
- `.planning/phases/01-bug-fixes-hardening/01-VALIDATION.md` — task-test
  mapping for FIX-01 harm scenario; FIX-04 EXCLUDED
- `.planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md`
- `.planning/phases/05-uniswap-v3-integration/05-VALIDATION.md` — V3-03
  EXCLUDED
- `.planning/phases/06-risk-management/06-VALIDATION.md`
- `.planning/phases/07-smart-exit-strategies/07-VALIDATION.md`
- `.planning/phases/08-monitoring-web-dashboard/08-VALIDATION.md`
- `.planning/phases/10-partial-sell-revenue-fix/10-VALIDATION.md`

### Code modification targets
- `src/utils/db.ts:215` — `getTradesByToken` unused local const (DEBT-06
  delete)
- `.github/workflows/test.yml` — current CI runs `test:unit` + `test:integration`
  only; gets `.todo` grep guard + tsc-clean × 3 tsconfig variants (DEBT
  invariant-lock)
- `.planning/milestones/v6.17-debt-baseline.md` — NEW file; the wave-0
  baseline artifact committed by Plan 17-01

### Per-phase harm-prevention test homes (Plan 17-02)
- `test/integration/exitMonitor.test.ts` — natural home for Phase 1 FIX-01
  exit-monitor race harm-prevention test
- `test/integration/` or `test/unit/` — Phase 3 SQLite atomicity test;
  exact home decided at planning time
- `test/fork/` — Phase 5 V3-02 liquidity wait may need fork test infrastructure
- `test/integration/` — Phase 6 risk gate; Phase 7 stop-loss → executeFullSell;
  Phase 8 health endpoint
- `test/integration/` or `test/unit/` — Phase 10 partial-sell amount_out
  non-null

### Test infrastructure context
- `vitest.config.ts` — projects: unit, integration, fork (NO new project
  needed per D-03)
- `package.json` scripts — `test:unit`, `test:integration`, `test:fork`,
  `test:all` already wired

### Open decisions for plan-phase (from STATE.md, NOT for Phase 17)
- ANTIRUG threshold tuning — Phase 19 plan-phase
- Bytecode static analysis selector-presence flag — Phase 18 plan-phase
- HONEYPOT-SIM-BRIEFING.md disposition — Phase 18 plan, executed Phase 20

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Existing per-phase `N-VALIDATION.md` docs** — already document
  task→test→requirement mapping for every phase. The "harm-prevention
  assertion" lives ALONGSIDE this mapping (new test or new section), not as
  a replacement. Phase 09's VALIDATION.md is the template if needed.
- **Vitest projects (unit / integration / fork)** — already configured in
  `vitest.config.ts`; new tests file into the appropriate project naturally.
  No project-config change needed.
- **pino structured logging** — bot-side standard; `log.debug` / `log.info` /
  `log.warn` / `log.error` already used throughout. Diagnostic
  console.log replacements default to `log.debug` per REQUIREMENTS.md
  DEBT-06 wording.
- **CI workflow `test.yml`** — already runs npm ci + test:unit +
  test:integration; smallest-diff hardening path is appending the new
  guards to the existing `test` job.

### Established Patterns
- **`require: true` env-var convention** (FIX-06 from Phase 1) — bot exits
  non-zero on missing required env. CI guards follow the same fail-closed
  pattern: any guard violation exits non-zero.
- **Pre-existing 343/343 tests passing** across 31 test files. New
  harm-prevention tests should follow the established style of the
  appropriate project (unit/integration/fork) rather than introducing new
  testing patterns.
- **Hybrid VALIDATION.md format** is novel for this project — Phase 17 is
  the first time `N-VALIDATION.md` will receive a "Harm-Prevention
  Assertion" section as a retroactive augmentation. Section name and shape
  are planner discretion within the rigor bar of D-04.
- **Verify-via-CI source-of-truth** — Phase 17's wave-0 baseline IS the new
  pattern; STATE.md `tech debt status disputed` becomes Phase 17's
  job-zero. Future v6.18+ audits can reference `v6.17-debt-baseline.md` as
  a re-runnable source of truth.

### Integration Points
- `src/utils/db.ts:215` `getTradesByToken` deletion is isolated — already
  has zero callers in `src/`, dashboard, and tests (verified at scout
  time); deletion is a single-line edit with no callsite plumbing.
- `.github/workflows/test.yml` modifications are CI-only; they affect what
  blocks merge but never affect the bot's runtime.
- `.planning/milestones/v6.17-debt-baseline.md` is a NEW artifact in
  `.planning/milestones/`; convention follows `v6.17-honeypot-checker-audit.md`
  and `v6.17-safety-bank-audit.md` planned for Phase 18 — same directory,
  same naming pattern.
- The 9 retroactive harm-prevention tests are independent of each other and
  parallel to existing test infrastructure — no shared fixture, no shared
  helper. Plan 17-02 can land them in any internal order.

</code_context>

<specifics>
## Specific Ideas

- User explicitly chose **hybrid** for retroactive assertion shape (vs always-new-test
  or always-doc-augment). Reason: 7 new tests where harm scenario is concrete
  delivers on Pitfall #19 anti-rubber-stamp; 2 inline-doc for architectural
  phases (Phase 02 ethers v6 migration, Phase 09 testing infrastructure)
  avoids contortion that loses signal. Doc augmentation does NOT count as
  rubber-stamp because the harm scenario for those two phases is
  irreducibly architectural, not a single-test surface.
- User explicitly chose **co-locate by what's tested** (vs new
  `test/validation/` tree or `.harm-prevention.test.ts` filename suffix).
  Reason: phase linkage is an artifact of GSD workflow; tests should be
  filed by what they exercise. `Phase N harm-prevention:` describe-block
  prefix preserves auditability.
- User explicitly chose **observable-effect** rigor bar (vs falsification
  or hybrid). Reason: practical and aligned with Pitfall #20; falsification
  harness is a v6.18+ rigor upgrade if needed.
- User explicitly chose **baseline-first wave 0** (vs lean-from-scout or
  full-defensive). Reason: STATE.md decision was "verify-via-CI as the
  first task of Phase 17"; planner-time scout doesn't supersede
  execution-time verification on a fresh checkout. Documents both branches
  in the plan.
- User explicitly chose **3-plan split** (vs 1, 2, or 6). Reason:
  three reviewable PRs of distinct character (baseline+evidence; substantive
  validation; cleanup+invariant-lock). Fits Phase 17's mixed-character
  scope.
- User explicitly chose **stop-the-line** on bug-found-during-retroactive
  (vs fix-in-flight or file-and-defer). Reason: aligned with Pitfall #19
  FIX-04/V3-03 precedent — a real bug found via retroactive validation
  should NOT be quietly skipped or silently grown into the phase's scope;
  it should be surfaced and handled as a first-class requirement upgrade.
- User explicitly chose **both .todo and tsc CI guards** + **strict .todo
  ban** + **all 3 tsconfig variants**. Reason: the v6.17 baseline becomes
  an evergreen invariant rather than a snapshot. Removing the guards
  later is a one-line change; the asymmetry between "easy to remove" and
  "valuable while present" justifies adding both.
- User explicitly chose **strict tech_debt-only sweep** (vs
  human_needed-inclusion or universal). Reason: Phase 21 EXIT-LIVE-01..11
  is the explicit home for live-mainnet verifications; muddying the
  Phase 17/21 split would dissolve the milestone's design.

</specifics>

<deferred>
## Deferred Ideas

- **Falsification rigor harness / fault-injection infrastructure** — would
  let harm-prevention tests prove they would have failed pre-phase. Could
  land alongside synthetic-monitor (OPS-V2-01) in v6.18+. Out of v6.17 scope
  per observable-effect rigor bar (D-04).
- **Allowlist-with-reason for `.todo` CI guard** — `.todo(...)` allowed
  when adjacent to a `// TODO(...): ...` comment. Rejected for v6.17 per
  D-09 strict ban; revisit if `.skip` proves operationally heavy.
- **Adjacent dead-code sweep beyond v6.16 audit-driven items** — `ts-prune`
  or similar across the codebase to find dead exports the audit missed.
  Out of D-12 scope; could be a future ts-prune sweep phase.
- **Dedicated `test/validation/` vitest project** — single-grep-directory
  audit of all harm-prevention tests at the cost of cross-cutting the
  existing taxonomy. Rejected per D-03; revisit if executor-grep
  ergonomics turn out to be poor.
- **`as any` PR-diff CI guard** — fails CI if a PR adds `as any` patterns.
  REQUIREMENTS.md DEBT-04 success criterion is a phase property ("no `as
  any` suppressions added in this phase"), not an evergreen invariant.
  Out of scope; revisit if anti-suppression discipline degrades over time.
- **`*-VALIDATION.md` standardization across all 16 v6.16 phases** — the
  Phase 17 hybrid form (7 new tests + 2 inline-doc augmentations)
  introduces a "Harm-Prevention Assertion" section convention. Future
  phases could adopt the convention as part of their first-pass validation.
  Out of v6.17 scope; let the convention emerge from Plan 17-02 first.
- **Fail-fast vs trail-tests for new CI guards** — D-10 leaves the step
  structure as planner discretion. If experience shows guard failures
  consistently mask test failures (or vice versa), a structural change to
  test.yml is a future ops-hardening task.

</deferred>

---

*Phase: 17-tech-debt-cleanup-audit-baseline*
*Context gathered: 2026-04-29*
