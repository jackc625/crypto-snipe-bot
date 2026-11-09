---
phase: 22-safety-rails-audit
plan: 28
subsystem: audit
tags: [audit-register, decision-cards, consolidation, capital-safety]
status: complete

requires:
  - phase: 22-safety-rails-audit
    provides: "per-slice findings, sweeps, thresholds, proposed cards and escalations from plans 22-06, 22-07 and 22-17..22-27"
provides:
  - "One consolidated register: RC-01..RC-28 mapped, duplicates reconciled, references resolved, universe clean at the audit base"
  - "Decision cards OD-26..OD-70, numbered by a re-runnable tool that 22-29 can call again"
  - "Canonical AUDIT-FINDINGS.md and OPERATOR-DECISIONS.md, byte-identical on re-render"
affects: [22-29, phase-23, phase-24, phase-27, phase-29]

actuals:
  tokens: 469566
  tasks: 2
  commits: 3
plan_head_before: 308969b5c3354277a50b294589f49e76ff30e006
plan_head_after: bf6a1254b994368e3927fdd9aa105cc1aca24679

tech-stack:
  added: []
  patterns:
    - "Numbered cards record proposed_from, so an interrupted numbering run is repaired instead of numbering a card twice"
    - "Card capital flag follows the capital_impact of the findings the card lists"

key-files:
  created:
    - .planning/audit/tools/assign-cards.ts
    - .planning/audit/decisions/OD-26.json (through OD-70.json)
    - .planning/phases/22-safety-rails-audit/22-28-SUMMARY.md
  modified:
    - .planning/audit/CONSOLIDATION.json
    - .planning/audit/AUDIT-FINDINGS.md
    - .planning/audit/OPERATOR-DECISIONS.md
    - .planning/audit/decisions/OD-18.json
    - .planning/audit/decisions/OD-25.json
    - .planning/audit/decisions/OD-6.json
    - .planning/audit/escalations/ESC-BUY-04.json
    - .planning/audit/escalations/ESC-BUY-05.json
    - .planning/audit/findings/AUD-BUY-033.json
    - .planning/audit/findings/AUD-DB-021.json

key-decisions:
  - "DB-07 linked to OD-18 rather than numbered: OD-18 already holds the synchronous=FULL decision, and two cards would allow contradictory rulings on one setting"
  - "DB-01 numbered (OD-58) rather than left linked to OD-25: it decides what the risk limits measure, OD-25 decides their values, and linking would have dropped an S1 capital card's options from the operator document"
  - "Card capital flag set from the findings' capital_impact: BUY-05 (OD-30), DB-06 (OD-63) and TX-04 (OD-57) became capital"

patterns-established:
  - "Decision-card text follows numbering; operator words (operator_input, decided) and findings and escalation wording are never rewritten"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "assign-cards.ts numbers proposed cards deterministically and a second run changes nothing"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "assign-cards.ts --self-test, then a repeat run with hashes of decisions/ and findings/ compared"
        status: pass
    human_judgment: false
  - id: D2
    description: "Register passes the consolidation stage: universe, referential integrity, reconciliation, card numbering"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "check.ts --stage consolidation (fail=0 pending=0 warn=0); slice-files.ts --universe at the audit base (861 tracked, 0 unassigned)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Canonical documents render deterministically and hold the required card set, grouped as the plan requires"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "render.ts --out to a temp folder, cmp against the committed files; grep for OD-6, 9, 10, 11, 14-18, 21, 25"
        status: pass
    human_judgment: false
  - id: D4
    description: "The merge, link and keep-separate calls on overlapping cards are the right ones for the operator"
    verification: []
    human_judgment: true
    rationale: "Whether two cards ask the same question is a judgement; the reasoning is recorded in CONSOLIDATION.json reconciliations for review"

duration: 10min
completed: 2026-11-09
---

# Phase 22 Plan 28: Register Consolidation and Decision Card Numbering Summary

**The parallel audit output is now one register: 45 new decision cards numbered OD-26..OD-70 by a re-runnable tool, one linked to OD-18, and AUDIT-FINDINGS.md and OPERATOR-DECISIONS.md rendered deterministically with the consolidation check at zero failures.**

## Performance

- **Duration:** about 10 min for this continuation (Task 1 ran in an earlier executor)
- **Started:** 2026-11-09T02:53:53Z (continuation)
- **Completed:** 2026-11-09
- **Tasks:** 2
- **Files modified:** 224 across the plan's three commits

## Accomplishments

- All 46 proposed cards have one outcome: 45 numbered OD-26..OD-70, 1 linked (DB-07 to OD-18), none merged.
- The required set is present: OD-6, 9, 10, 11, 14, 15, 16, 17, 18 and 25 open, OD-21 decided 2026-11-06. NAC-12 holds on every card.
- Capital cards are grouped by area. The failed-held sell-selection card is OD-64 under API and the signer-exclusion card is OD-68 under SCRIPTS.
- `assign-cards.ts` is safe for 22-29 to re-run: a repeat run writes no file, and an interrupted run is repaired rather than renumbered.
- ESC-BUY-04 and ESC-BUY-05 carry the operator's reply verbatim ("Acknowledge continue"), with severities unchanged at S1.
- AUD-BUY-033 has no decision card by design (`od_ref: null`, no behaviour trade-off), and this passes `check.ts --stage consolidation`.

## Re-grade outcome (Task 1)

The 43 external findings that codex rated S1 and the register rated lower were re-graded against the code at the audit base.

- 43 graded, 41 kept at their existing grade.
- AUD-BUY-015 raised to S1 (V3 minimum-liquidity gate; ESC-BUY-04).
- New AUD-BUY-033 at S1 (V3 snipe never refunds unspent ETH; ESC-BUY-05).
- No S0 and no rail item.

## Task Commits

1. **Task 1: Map RCs, merge duplicates, resolve references, fold sweeps, reconcile thresholds, re-grade the 43** - `8eb9d1c` (docs)
2. **Operator acknowledgement of ESC-BUY-04/05 and AUD-BUY-033 evidence correction** - `21777ee` (docs)
3. **Task 2: Build assign-cards.ts, number cards from OD-26, render the canonical documents** - `bf6a125` (docs)

## Files Created/Modified

- `.planning/audit/tools/assign-cards.ts` - numbering tool with `--root` and `--self-test`
- `.planning/audit/decisions/OD-26.json` through `OD-70.json` - the numbered cards
- `.planning/audit/decisions/proposed/*.json` - `assigned_id` or `linked_od` on each
- `.planning/audit/findings/*.json`, `.planning/audit/thresholds/*.json` - `od_ref` moved to the numbered cards
- `.planning/audit/CONSOLIDATION.json` - `card_assignments` and the card reconciliations
- `.planning/audit/AUDIT-FINDINGS.md`, `.planning/audit/OPERATOR-DECISIONS.md` - canonical render

## Decisions Made

See `key-decisions`. Every merge, link and keep-separate call is recorded with its reason in `CONSOLIDATION.json` `reconciliations`. Partial overlaps stayed separate cards with a cross-reference: BUY-02 (OD-27) with OD-18, TX-01 (OD-54) with OD-17.

## Deviations from Plan

### Carried from Task 1 (recorded in CONSOLIDATION.json)

**(a) P9 slip.** The orchestrator listed phase SUMMARYs as required reading for the 22-17..22-22 auditors. Checked 2026-11-07: all slices pass `check.ts`; no finding cites a SUMMARY or VERIFICATION document. Residual risk is soft anchoring only.

**(b) D-14 only partly covered.** Codex only (Docker, no tools, code embedded in the prompt); agy excluded by operator ruling "codex a, agy c".

### Auto-fixed Issues

**1. [Rule 1 - Bug] DB-01 would have vanished from the operator document**
- **Found during:** Task 2
- **Issue:** DB-01 carried `linked_od: OD-25` from 22-21. A linked card is not numbered and renders only as a table row, which would have dropped an S1 capital decision and its options. OD-25 has no accounting option and already treats DB-01 as a separate, earlier decision.
- **Fix:** Replaced `linked_od` with `related_od`, so it was numbered (OD-58).
- **Files modified:** `.planning/audit/decisions/proposed/DB-01.json`
- **Verification:** OD-58 renders in full; `check.ts --stage consolidation` passes
- **Committed in:** `bf6a125`

**2. [Rule 1 - Bug] Capital flags did not match the findings**
- **Found during:** Task 2
- **Issue:** BUY-05 was non-capital while listing three S1 findings (AUD-BUY-015 was raised in Task 1). DB-06 and TX-04 also list findings with a capital impact.
- **Fix:** Set `capital: true` on all three. BUY-05's default and needed-by no longer allow Phase 29 or resting on the default.
- **Files modified:** `.planning/audit/decisions/proposed/BUY-05.json`, `DB-06.json`, `TX-04.json`
- **Verification:** every card's flag now matches its findings' `capital_impact`
- **Committed in:** `bf6a125`

**3. [Rule 2 - Missing Critical] Cards did not list every finding pointing at them**
- **Found during:** Task 2
- **Issue:** Eight non-duplicate findings named a card that did not list them, including AUD-TX-009 (S1) on OD-6.
- **Fix:** Added them to the card `findings` lists.
- **Files modified:** `OD-25.json`, `OD-6.json`, proposed `DB-01`, `TX-04`, `BUY-03`, `EXIT-11`
- **Verification:** reverse check over all findings
- **Committed in:** `bf6a125`

**4. [Rule 2 - Missing Critical] Numbering had to reach more than finding `od_ref`**
- **Found during:** Task 2
- **Issue:** The plan names only findings, but `check.ts` also fails threshold `od_ref` values that name a proposed id, and card text such as "decide with EXIT-07" would point at headings that no longer exist.
- **Fix:** `assign-cards.ts` also rewrites threshold `od_ref` (both file layouts), `external_od_refs` ids, and mentions in card text. It leaves `operator_input`, `decided` and `owner_phase` untouched.
- **Verification:** self-test cases for each; no proposed id remains in card text
- **Committed in:** `bf6a125`

### Plan rule applied over a handoff note

**DB-07 was linked, not numbered.** The Task 1 handoff note said BUY-09 and DB-07 "get numbered in Task 2". BUY-09 was numbered (OD-34). DB-07 asks whether to run synchronous=FULL, which OD-18 already holds, and the plan requires an overlapping card to be linked instead of numbered. AUD-DB-021 moved to OD-18, and DB-07's one extra option is carried there as `critical-flush-only`. To reverse it, remove `linked_od` from DB-07 and re-run `assign-cards.ts`.

---

**Total deviations:** 4 auto-fixed (2 bug, 2 missing critical), 1 plan rule applied over a handoff note, 2 carried from Task 1.
**Impact on plan:** The fixes keep S1 decisions visible and references valid. No finding severity changed in Task 2.

## Issues Encountered

- A shell command was blocked by the secret guard because `.env` appeared in a `git status` path filter. Nothing ran and nothing was read; the check was re-run without naming that file.
- Findings, thresholds and escalation records keep their original wording, so their free text can still say "card EXIT-07". The table in OPERATOR-DECISIONS.md maps every old id to its number.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 22-29, which can re-run `assign-cards.ts` after the re-audit. Phases 23 and 24 can work from the two rendered documents.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*

## Self-Check: PASSED
