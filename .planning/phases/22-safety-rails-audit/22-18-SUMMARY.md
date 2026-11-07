---
phase: 22-safety-rails-audit
plan: 18
subsystem: audit
tags: [audit, exit-engine, minout, price-probe, exit-monitor, nonce-lock, escalation, thresholds, decision-cards]

requires:
  - phase: 22-03
    provides: audit register layout, BASE.json audit_base_sha 23a6461, check.ts / render.ts tooling
  - phase: 22-04
    provides: slice-files.ts enumerator (--snapshot / --check EXIT, 4 anchor files)
provides:
  - "AUD-EXIT-001..021: 21 EXIT findings (9 S1, 8 S2, 3 S3, 1 S4; 9 research-candidate, 12 independent; 15 confirmed, 6 candidate; capital LOSS 8, STRAND 8, EXPOSURE 1)"
  - "RC-03 -> AUD-EXIT-001, RC-07 -> AUD-EXIT-002, RC-08 -> AUD-EXIT-003 (four sub_claims), RC-15 -> AUD-EXIT-004, RC-21 -> AUD-EXIT-005; RC-10 EXIT sibling sites -> AUD-EXIT-009 under ESC-PRE-02"
  - "Lifecycle traces: full-exit (AUD-EXIT-001), partial-exit (AUD-EXIT-006), resumed-exit (AUD-EXIT-013), failed-held-exit (AUD-EXIT-007, naming the 22-22 / ESC-PRE-04 dashboard sell-selection sibling by reference)"
  - "ledger/EXIT.json: 4 files at 23a6461, equal to slice-files.ts --check EXIT"
  - "sweep/EXIT.json: C01..C20, each with its search and finding ids or 'checked, none'"
  - "thresholds/EXIT.json: 27 TH-EXIT rows ({rows, discovery} form), 21 flagged, each flagged row with a recommendation"
  - "card OD-14 (private-sell minOut, 3 options incl. keep-current) and proposed cards EXIT-01..12"
  - "ESC-EXIT-01 (area-batch, 8 S1) with the operator's verbatim response 'Acknowledge continue'"
affects: [22-20, 22-22, 22-28, 22-29, phase-23-proof, phase-24-capital-fixes]

actuals:
  tokens: 40413
  tasks: 3
  commits: 3
plan_head_before: bfeaa370f580c0f5522dad72c24b5e71a0b9e87d
plan_head_after: 9614de7e46617331f2373ef3047294e730bd2834

tech-stack:
  added: []
  patterns:
    - "Area-batch escalation record (ESC-EXIT-01) lists only newly presented S1 ids; the RC-10 rediscovery (AUD-EXIT-009) keeps its ESC-PRE-02 link and is not re-counted"
    - "Orchestrator recommendation recorded in ruling_note, attributed to the orchestrator and kept apart from the operator's verbatim words (ESC-BUY-02 precedent)"

key-files:
  created:
    - .planning/audit/findings/AUD-EXIT-001.json .. AUD-EXIT-021.json
    - .planning/audit/ledger/EXIT.json
    - .planning/audit/sweep/EXIT.json
    - .planning/audit/thresholds/EXIT.json
    - .planning/audit/decisions/OD-14.json
    - .planning/audit/decisions/proposed/EXIT-01.json .. EXIT-12.json
    - .planning/audit/escalations/ESC-EXIT-01.json
  modified:
    - .planning/audit/escalations/ESC-PRE-02.json (resolved_items gains AUD-EXIT-009; items untouched)

key-decisions:
  - "ESC-EXIT-01: the operator acknowledged all 8 EXIT S1 entries (AUD-EXIT-001, -002, -003, -007, -008, -013, -014, -015) with 'Acknowledge continue'; no severity changes, no decimal phase, Phase 22 continues; ruling recorded as 'none'"
  - "Orchestrator context (not the operator's words): AUD-EXIT-001 is an operator choice through card OD-14 rather than only a fix; AUD-EXIT-002, -013 and -015 are the worst stranded-position cases and should be at the front of Phase 23"
  - "The EXIT RC-10 sibling sites (AUD-EXIT-009) link the TX never-settling-wait mechanism via related rc:RC-10 (22-28 replaces it with the TX sub-finding id) and ESC-PRE-02; no new escalation (D-23 b)"

patterns-established:
  - "Rediscovery of a pre-phase RC from a second slice: add the finding to the existing ESC-PRE record's resolved_items (22-17 precedent repeated for EXIT)"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "EXIT findings register: RC-03, RC-07, RC-08 (four sub_claims), RC-15, RC-21 mapped, none NOT-A-BUG; section-C items; RC-10 siblings linked to ESC-PRE-02; four lifecycle traces"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice EXIT (PASS fail=0 pending=0) + plan Task 1 verify node script (EXIT ok 4)"
        status: pass
    human_judgment: true
    rationale: "The tools prove the register's shape, RC mapping, sub-claim count and trace presence. Whether each finding is correct and complete against the code needs an independent reviewer, and Phase 23 real-path tests are the proof."
  - id: D2
    description: "Per-file ledger equal to slice-files.ts --check EXIT (4 files) and 20-class sweep with searches"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "plan Task 1 verify node script (ledger == enumerator, 20 cells, each with search)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Money-and-timing thresholds inventory (27 rows, every AC-37 field, every flagged row with a recommendation)"
    requirement: AUDIT-04
    verification:
      - kind: other
        ref: "plan Task 2 verify node script, run against the protocol-accepted {rows, discovery} form (rows 27)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Card OD-14 (keep-current with its risk, bounded-all, bounded-routine-zero-antirug) and proposed cards EXIT-01..12"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice EXIT (NAC-12) + plan Task 2 verify (OD-14 options 3, keep-current present)"
        status: pass
    human_judgment: true
    rationale: "NAC-12 neutrality (cards do not steer) is checked only in part by the tool. A human reads the cards at the 22-28 consolidation."
  - id: D5
    description: "Escalation ESC-EXIT-01 (8 S1, area-batch) with the verbatim operator response; every S1 EXIT finding carries exactly one escalation_ref"
    verification:
      - kind: other
        ref: "Task 3 acceptance node check (noRef 0, multi [], back [], ok true) + check.ts partial pending=0"
        status: pass
    human_judgment: false

duration: about 10h 4m wall-clock (most of it the operator wait at Task 3)
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 18: EXIT Slice Audit Summary

**Read-only audit of the 4-file exit engine at 23a6461: 21 findings (9 S1, none S0), including zero-floor private sells (RC-03), a silently unstarted exit monitor (RC-07) and a price signal that is not a price (RC-08, four sub-claims), plus 27 threshold rows, card OD-14 and 12 proposed cards. The 8 newly presented S1 entries were escalated as ESC-EXIT-01 and the operator answered "Acknowledge continue".**

## Performance

- **Duration:** about 10h 4m wall-clock across two executor sessions. Tasks 1-2 ran from about 05:38Z to 05:59Z, then the plan waited on the operator at the Task 3 checkpoint, and Task 3 closed out from 15:40Z to 15:45Z.
- **Started:** 2026-11-07T05:38Z (after plan base bfeaa37)
- **Completed:** 2026-11-07T15:45Z
- **Tasks:** 3 of 3
- **Files modified:** 39, all under `.planning/audit/` (NAC-13: `git diff --name-only bfeaa37..9614de7` shows no path outside it)

## Accomplishments

- All 5 owned research candidates are registered, and none is NOT-A-BUG. RC-03 maps to AUD-EXIT-001 (S1, LOSS): every private sell, full and partial, V2 and V3, has amountOutMin = 0. RC-07 maps to AUD-EXIT-002 (S1, STRAND): the monitor never starts when the first quote fails. RC-08 maps to AUD-EXIT-003 (S1, STRAND), with four sub-claims: unit mismatch (confirmed), non-linear quote (candidate), zero or coarse output (candidate) and non-finite ratio (confirmed). RC-15 maps to AUD-EXIT-004 (S2: approvals bypass the fee ceiling and go to the public mempool). RC-21 maps to AUD-EXIT-005 (S2: setInterval(async) overlap).
- The independent S1 findings are AUD-EXIT-007 (exits with no route left neither mark the position failed-held nor re-arm its timer), AUD-EXIT-008 (dashboard force-sell and emergency-sell are blocked by the routine pause), AUD-EXIT-013 (resumed positions are quoted and sold on the chain's first dex, not the one they were bought on), AUD-EXIT-014 (candidate: anti-rug exits are refused or delayed behind sell and nonce locks) and AUD-EXIT-015 (the entry probe size is not stored, which causes false stop-loss and trailing exits after a setting change).
- The RC-10 sibling sites (await stx.wait() with no timeout inside withNonceLock, about :545 and :556) are recorded on AUD-EXIT-009, with `related` set to `rc:RC-10` (the never-settling mechanism, not re-entrancy) and `escalation_ref` set to ESC-PRE-02. No new record was created.
- Lifecycle traces cover full-exit, partial-exit, resumed-exit and failed-held-exit. The failed-held trace names the 22-22 / ESC-PRE-04 dashboard sell-selection sibling by reference only.
- The ledger (4 files) equals the enumerator. The sweep covers C01..C20, and each cell records its search.
- The thresholds inventory has 27 TH-EXIT rows with the effective values for unset, empty and non-numeric env. All 21 flagged rows carry recommendations. OD-14 offers keep-current with its risk stated, a bounded floor for all sells, and a bounded floor for routine sells with zero kept for anti-rug. EXIT-01..12 cover every other behaviour-changing recommendation.
- ESC-EXIT-01 (area-batch, dated 2026-11-07) lists AUD-EXIT-001, -002, -003, -007, -008, -013, -014 and -015 with the operator's verbatim reply, `ruling: none` and `phase_continued: true`. Each of those findings now has `escalation_ref: ESC-EXIT-01`, so every S1 EXIT finding has exactly one escalation record.

## Task Commits

1. **Task 1: EXIT audit, findings, RC mapping, ledger, 20-class sweep** - `6a323a0` (docs)
2. **Task 2: thresholds inventory, card OD-14, proposed cards EXIT-01..12** - `0d4a6dd` (docs)
3. **Task 3: ESC-EXIT-01 area S1 batch ruling and finding links** - `9614de7` (docs)

**Plan metadata:** recorded in the docs(22-18) SUMMARY and completion commits that follow this file.

## Files Created/Modified

- `.planning/audit/findings/AUD-EXIT-001..021.json`: the EXIT findings register
- `.planning/audit/ledger/EXIT.json`: per-file coverage rows at 23a6461
- `.planning/audit/sweep/EXIT.json`: the 20-class sweep cells with searches
- `.planning/audit/thresholds/EXIT.json`: 27 AC-37 rows plus env/constant discovery
- `.planning/audit/decisions/OD-14.json`: the private-sell minOut card
- `.planning/audit/decisions/proposed/EXIT-01..12.json`: proposed cards
- `.planning/audit/escalations/ESC-EXIT-01.json`: the area-batch S1 record
- `.planning/audit/escalations/ESC-PRE-02.json`: `resolved_items` gains AUD-EXIT-009

## Decisions Made

- The operator's ruling at the Task 3 checkpoint, verbatim: "Acknowledge continue". It is recorded as the acknowledge-continue option for all 8 S1 entries. No severity changed, no decimal phase was inserted, and Phase 22 continues.
- The following is the orchestrator's context, not the operator's words, and is recorded that way in `ruling_note`. AUD-EXIT-001 is an operator choice through OD-14, not only a fix. AUD-EXIT-002, -013 and -015 are the worst stranded-position cases and should be at the front of Phase 23.
- No S1 capital finding can rest on a keep-current default. Each one blocks the live re-entry gate until it is fixed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESC-PRE-02 edited outside the plan's file list**
- **Found during:** Task 1
- **Issue:** The plan's `files_modified` covers only `escalations/ESC-EXIT-*.json`. The PROTOCOL.md rediscovery and alias rules, though, require the `rc:RC-10` alias in ESC-PRE-02 to resolve through `resolved_items` to the finding that carries it (AUD-EXIT-009).
- **Fix:** Added AUD-EXIT-009 to ESC-PRE-02 `resolved_items`. `items` and every other field are unchanged. This follows the 22-17 precedent (AUD-BUY-025).
- **Files modified:** `.planning/audit/escalations/ESC-PRE-02.json`
- **Verification:** `git diff bfeaa37..HEAD -- .planning/audit/escalations/ESC-PRE-02.json` shows only the `resolved_items` line. check.ts partial passes.
- **Committed in:** 6a323a0

---

**Total deviations:** 1 auto-fixed (1 blocking, protocol-required)
**Impact on plan:** None on scope. The edit is required for referential integrity at consolidation.

## Issues Encountered

- **The Task 2 verify one-liner assumes a plain array.** In the Task 3 close-out, the plan's literal Task 2 command failed with `TypeError: t.filter is not a function`. Diagnosis: `thresholds/EXIT.json` uses the `{rows, discovery}` form, which PROTOCOL.md line 119 explicitly accepts ("either a plain array of rows or `{rows, discovery}`. Both forms are accepted"). The file is byte-identical to its Task 2 commit (0d4a6dd). I re-ran the same assertions against `.rows`, and they pass: 27 rows, every AC-37 field, 21 flagged rows each with a recommendation, OD-14 with 3 options including keep-current. The data is correct; the one-liner is stricter than the protocol. check.ts, the authoritative validator, passes on the file. 22-28 may want to make the consolidation-stage scripts accept both forms.
- The `check.ts --stage partial --slice EXIT` run after linking reports `fail=0 pending=0 warn=0`. No cross-slice card reference is pending.
- The render dry run wrote only to a temp directory. `AUDIT-FINDINGS.md` and `OPERATOR-DECISIONS.md` were neither staged nor modified, per the parallel-writer rule.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- The EXIT data is complete for 22-28 consolidation. One item is open there: replace `rc:RC-10` in AUD-EXIT-009 `related` with the TX never-settling sub-finding id from 22-20.
- Phase 23 proof ordering is guided by the orchestrator's note: AUD-EXIT-002, -013 and -015 first. AUD-EXIT-001 needs the operator's OD-14 choice before Phase 24.
- 22-29 re-audits the concurrent `registerSingleton` diffs in `exitEngine.ts` and `exitManager.ts`. This audit read only the 23a6461 snapshot.

## Self-Check: PASSED

- Commits 6a323a0, 0d4a6dd and 9614de7 are all ancestors of HEAD. `evaluation-scope --plan 22-18 --commits-only` resolves all three.
- ESC-EXIT-01.json, ledger/EXIT.json, sweep/EXIT.json, thresholds/EXIT.json and OD-14.json exist. There are 21 AUD-EXIT findings and 12 EXIT proposed cards.
- check.ts partial EXIT: PASS. Task 1 verify: EXIT ok 4. Task 2 verify (rows form): rows 27. Task 3 acceptance: every S1 has exactly one record.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
