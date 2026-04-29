# Phase 17: Tech Debt Cleanup & Audit Baseline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-29
**Phase:** 17-tech-debt-cleanup-audit-baseline
**Areas discussed:** Retroactive assertion shape (DEBT-05), Phase 17 internal sequencing, CI regression guard, Dead-code sweep scope (DEBT-06)

---

## Retroactive assertion shape (DEBT-05)

### Q1: How should the production-relevant assertion live for each retroactively-validated phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid | New tests for concrete-code-path phases (01, 03, 06, 07, 08, 10) + inline VALIDATION.md augmentation for architectural phases (02, 09). Avoids forcing synthetic test on architectural phases. | ✓ |
| Always new test file | `test/validation/phaseN-harm-prevention.test.ts` for every phase. Maximally executable; risks contortion on migration/infra phases. | |
| Always doc augmentation | Augment each existing N-VALIDATION.md by pointing to existing tests. Closest to the rubber-stamp pattern Pitfall #19 warns against. | |

**User's choice:** Hybrid (Recommended)
**Notes:** Reason: 7 new tests where harm scenario is concrete delivers on Pitfall #19 anti-rubber-stamp; 2 inline-doc for architectural phases avoids contortion that loses signal.

### Q2: Does the proposed 7-new-tests / 2-inline-doc split match intent?

| Option | Description | Selected |
|--------|-------------|----------|
| Accept as proposed | 7 new tests (01, 03, 05, 06, 07, 08, 10), 2 inline-doc (02, 09). | ✓ |
| Move Phase 02 to NEW TEST | Phase 02 ethers v6 migration also gets a new test (e.g., BigInt arithmetic preservation). | |
| Move Phase 09 to NEW TEST | Phase 09 testing infrastructure gets a new test (self-referential — test runner exits non-zero on failing assertion). | |
| Both 02 and 09 to NEW TEST | All 9 phases get new tests; zero inline-doc. Maximum rigor + highest contortion cost. | |

**User's choice:** Accept as proposed (Recommended)
**Notes:** Phase 02 is pure migration with no single harm-prevention assertion that isn't trivially "tsc passes"; Phase 09 is meta (testing infrastructure itself).

### Q3: Where should the 7 new harm-prevention tests live?

| Option | Description | Selected |
|--------|-------------|----------|
| Co-locate by what's tested | File into existing `test/{unit,integration,fork}/` tree based on what's exercised. `Phase N harm-prevention:` describe-block prefix for discoverability. No new vitest project. | ✓ |
| Dedicated `test/validation/` tree | All 7 tests in one directory + new vitest project. Cross-cuts existing taxonomy. | |
| Co-locate but tag with `.harm-prevention.test.ts` filename suffix | Aggressive filename; longer paths; same directory as today. | |

**User's choice:** Co-locate by what's tested (Recommended)
**Notes:** Phase linkage stays in VALIDATION.md mapping; tests are filed by what they exercise.

### Q4: What's the rigor bar each new harm-prevention test must clear?

| Option | Description | Selected |
|--------|-------------|----------|
| Observable effect | Must exercise harm scenario AND assert ≥1 concrete effect (DB row, mock args, log line, transaction). Aligned with Pitfall #20 anti-hollow-fill. | ✓ |
| Falsification | Test must be designed such that reverting the phase's commits would cause it to fail. Stronger; requires fault-injection harness. | |
| Both — falsification where practical, observable-effect otherwise | Default to falsification, fall back to observable-effect for migrations and infra. | |

**User's choice:** Observable effect (Recommended)
**Notes:** Pragmatic and aligned with Pitfall #20. Falsification rigor deferred to v6.18+ if needed.

---

## Phase 17 internal sequencing

### Q1: How should the plan handle DEBT-01/02 baseline + DEBT-03/04 fix work given scout shows 0/0?

| Option | Description | Selected |
|--------|-------------|----------|
| Baseline-first wave | Wave 0 runs CI commands fresh, commits baseline as ground truth. DEBT-03/04 are conditional on wave 0 results. Plan documents both branches. | ✓ |
| Lean-from-scout (assume 0/0) | Plan assumes scout's verdict and skips DEBT-03/04 up front. Smaller plan; risk if scout drifts vs execution-time state. | |
| Full-defensive plan | Plan all 6 DEBT items as real fix work regardless of scout. Heaviest plan; pure plumbing if 0/0 holds. | |

**User's choice:** Baseline-first wave (Recommended)
**Notes:** STATE.md decision was "verify-via-CI as the first task of Phase 17"; planner-time scout doesn't supersede execution-time verification on a fresh checkout.

### Q2: How should Phase 17's six DEBT requirements split into plans?

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans | 17-01 baseline+evidence; 17-02 retroactive validation; 17-03 cleanup+CI guards. | ✓ |
| 2 plans | 17-01 baseline+cleanup; 17-02 retroactive validation. | |
| 1 plan | All 6 items in single plan. Atomic; one giant PR. | |
| Per-requirement plans (6 plans) | Each DEBT requirement = own plan. Maximum reviewability; high overhead. | |

**User's choice:** 3 plans (Recommended)
**Notes:** Three reviewable PRs of distinct character (baseline+evidence; substantive validation; cleanup+invariant-lock).

### Q3: Bug-found protocol if retroactive harm-prevention test reveals a real production bug

| Option | Description | Selected |
|--------|-------------|----------|
| Stop-the-line | Abort Phase 17; surface bug to user; first-class v6.17 requirement upgrade (DEBT-07 or inserted phase 17.1). Aligned with Pitfall #19. | ✓ |
| Fix-in-flight | Fix the bug as part of Phase 17. Risks scope creep. | |
| File-and-defer | File new BUG requirement; mark test `.skip` with reason; close Phase 17. Risks v6.16-style "tests pass" cover. | |

**User's choice:** Stop-the-line (Recommended)
**Notes:** A real bug found via retroactive validation should NOT be quietly skipped or silently grown into the phase's scope; surface it and handle as first-class requirement upgrade.

---

## CI regression guard

### Q1: Should Phase 17 add CI guards locking in the 0/0 baseline?

| Option | Description | Selected |
|--------|-------------|----------|
| Add both (.todo + tsc) | test.yml gains `.todo` ban + tsc --noEmit guard. Mirrors OPS-LIVE-12 CI guard pattern. | ✓ |
| Just tsc guard | Skip the .todo guard; less paranoid. | |
| Just .todo guard | Skip the tsc guard; risk: build script not in test.yml today. | |
| No CI guards — rely on PR review | Defer hardening to a future ops phase. v6.17 baseline becomes a snapshot rather than invariant. | |

**User's choice:** Add both (.todo + tsc) (Recommended)
**Notes:** Both cheap, both lock in the property the v6.17 baseline establishes. Removing them later is a one-line change.

### Q2: Which tsconfig variants should the new CI tsc guard cover?

| Option | Description | Selected |
|--------|-------------|----------|
| All three | tsconfig.json (root) + tsconfig.bot.json + dashboard/tsconfig.json. | ✓ |
| Root + bot only | Skip dashboard. Cost: dashboard regressions slip through (same v6.16 failure mode). | |
| Root only | Just `npx tsc --noEmit` with default project. Smallest change. | |

**User's choice:** All three (Recommended)
**Notes:** Catches regressions anywhere in the typed surface; my scout already verified all three exit 0 today.

### Q3: How strict should the .todo CI guard be?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict ban | Any `.todo(` / `it.todo` / `test.todo` fails CI. Future placeholders use `.skip(...)` with reason. | ✓ |
| Allowlist with reason comment | `.todo` allowed when adjacent to `// TODO(...)`. Harder to enforce; comment-rot risk. | |
| Soft warning | Report `.todo` count without failing. Same drift risk as today. | |

**User's choice:** Strict ban (Recommended)
**Notes:** Makes the v6.17 baseline 0/0 status an evergreen CI invariant.

---

## Dead-code sweep scope (DEBT-06)

### Q1: What's the scope of the dead-code sweep in DEBT-06?

| Option | Description | Selected |
|--------|-------------|----------|
| Verify-then-act on all v6.16 audit claims | Phase 17 = v6.16-audit close-out pass. Stale claims documented in baseline; valid claims acted on. | ✓ |
| Strict scope (REQUIREMENTS.md only) | Only items explicitly named in DEBT-06. Smallest scope; leaves residual debt. | |
| Adjacent sweep without audit-driven scope | `ts-prune`-style fresh dead-code analysis. Risks scope creep and missed nuance. | |

**User's choice:** Verify-then-act on all v6.16 audit claims (Recommended)
**Notes:** All driven by existing audit; no new sweep introduced.

### Q2: Where's the boundary between Phase 17 sweep and Phase 21 (EXIT-LIVE) live-mainnet verifications?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict: tech_debt: items only | Phase 17 covers `tech_debt:` section only; `human_needed:` items stay deferred to Phase 21 EXIT-LIVE-01..11. | ✓ |
| Include audit's human_needed items if not requiring real mainnet | Some human_needed items might be testable on a fork; pick those up in Phase 17. Risks duplicating EXIT-LIVE work. | |
| Cover everything in v6.16-MILESTONE-AUDIT.md | Phase 17 = universal close-out. Dissolves the Phase 17/21 split. | |

**User's choice:** Strict: tech_debt: items only (Recommended)
**Notes:** Clean boundary; no overlap with the explicit Phase 21 design.

---

## Wrap-up question

### Continue or wrap?

| Option | Description | Selected |
|--------|-------------|----------|
| Wrap up — ready for context | All 4 areas captured. Move to write_context. | ✓ |
| More questions on sweep scope | Stay on dead-code sweep. | |
| Explore more gray areas | Open additional gray areas (Phase 17's own validation, commit cadence, baseline-doc format). | |

**User's choice:** Wrap up — ready for context

---

## Claude's Discretion

- Exact format of `v6.17-debt-baseline.md` (tabular per-claim entry vs narrative checklist vs hybrid)
- Step structure inside `.github/workflows/test.yml` (sequential append vs new parallel job vs new lint.yml workflow); smallest-diff path recommended
- Per-test design specifics inside Plan 17-02 (which fixture token, mock pattern, exact assertion shape) — given the observable-effect rigor bar in D-04
- Whether to delete additional dead exports surfaced during DEBT-06 follow-up grep, beyond audit-driven items
- Phase 17's own validation/Nyquist disposition (DEBT category is self-referential; planner decides whether Phase 17 needs N-VALIDATION.md and whether the CI guards count as the harm-prevention assertion for this phase)

## Deferred Ideas

- Falsification rigor harness / fault-injection infrastructure — could land alongside synthetic-monitor (OPS-V2-01) in v6.18+
- Allowlist-with-reason for .todo CI guard — rejected per D-09; revisit if .skip-with-reason proves operationally heavy
- Adjacent dead-code sweep beyond v6.16 audit-driven items — out of D-12 scope; future ts-prune sweep phase candidate
- Dedicated test/validation/ vitest project — rejected per D-03; revisit if executor-grep ergonomics suffer
- `as any` PR-diff CI guard — out of scope; phase-property not evergreen invariant
- *-VALIDATION.md "Harm-Prevention Assertion" section convention adoption across all 16 v6.16 phases — let the convention emerge from Plan 17-02 first
- Fail-fast vs trail-tests structure for new CI guards — left as planner discretion; structural change is future ops-hardening task
