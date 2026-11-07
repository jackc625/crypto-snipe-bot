---
phase: 22-safety-rails-audit
plan: 17
subsystem: audit
tags: [audit, buy-path, detection, telegram, websocket, minout, escalation, thresholds, decision-cards]

requires:
  - phase: 22-03
    provides: audit register layout, BASE.json audit_base_sha 23a6461, check.ts / render.ts tooling
  - phase: 22-04
    provides: slice-files.ts enumerator (--snapshot / --check BUY, honeypot anchor)
provides:
  - "AUD-BUY-001..026: 26 BUY/detection findings (1 S0, 9 S1, 7 S2, 6 S3, 3 S4; 16 research-candidate, 10 independent; 22 confirmed, 4 candidate)"
  - "ledger/BUY.json: 19 files at 23a6461, equal to slice-files.ts --check BUY"
  - "sweep/BUY.json: C01..C20, each with its search and finding ids or 'checked, none'"
  - "thresholds/BUY.json: 28 TH-BUY rows with every AC-37 field"
  - "cards OD-6, OD-15, OD-16 and proposed cards BUY-01..08"
  - "ESC-BUY-01 (immediate, S0 AUD-BUY-001) and ESC-BUY-02 (area-batch, 8 S1) with the operator's verbatim responses"
affects: [22-19, 22-20, 22-22, 22-28, 22-29, phase-23-proof, phase-24-capital-fixes]

actuals:
  tokens: 44994
  tasks: 3
  commits: 4
plan_head_before: 1f48e3fc70bc3a1bb8d122f0e77e4cf71798c571
plan_head_after: ebf8e89e730e02fec3b80ffdaa17f7019f396657

tech-stack:
  added: []
  patterns:
    - "Area-batch escalation record (ESC-<AREA>-NN, tier area-batch) listing every presented S1 id; already-escalated items keep their existing record"
    - "Orchestrator recommendation recorded inside ruling_note, attributed to the orchestrator and kept apart from the operator's verbatim words"

key-files:
  created:
    - .planning/audit/findings/AUD-BUY-001.json .. AUD-BUY-026.json
    - .planning/audit/ledger/BUY.json
    - .planning/audit/sweep/BUY.json
    - .planning/audit/thresholds/BUY.json
    - .planning/audit/decisions/OD-6.json
    - .planning/audit/decisions/OD-15.json
    - .planning/audit/decisions/OD-16.json
    - .planning/audit/decisions/proposed/BUY-01.json .. BUY-08.json
    - .planning/audit/escalations/ESC-BUY-01.json
    - .planning/audit/escalations/ESC-BUY-02.json
  modified:
    - .planning/audit/escalations/ESC-PRE-02.json (resolved_items gains AUD-BUY-025)

key-decisions:
  - "ESC-BUY-01: the operator acknowledged S0 AUD-BUY-001 (a landed deliberate buy has no exit or anti-rug protection after the script exits) with 'Acknowledge continue'; it stays S0, no decimal phase, and the interim rule 'start the main bot right after any manual buy' is carried on card BUY-01"
  - "ESC-BUY-02: the operator acknowledged all 8 BUY S1 entries with 'Acknowledge continue'; no severity changes (AUD-BUY-002 stays S1), no decimal phase, Phase 22 continues; ruling recorded as 'none' (ESC-FORENSIC-01 precedent)"
  - "AUD-BUY-002 (RC-01, landed buy marked failed) is rated S1, below the research suggestion S0, with a written severity_rationale; the orchestrator (not the operator) recommended it go first in Phase 23 whatever its rating"

patterns-established:
  - "Rediscovery of a pre-phase RC from another slice: link it through the existing ESC-PRE record's resolved_items instead of a new record"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "BUY slice findings register: 8 owned RCs mapped (RC-01 with 5 separate failure-point traces), section-C items, independent findings, every entry with an origin"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice BUY + plan Task 1 verify node script (BUY ok 19)"
        status: pass
    human_judgment: true
    rationale: "The tools prove the register's shape and the RC mapping. Whether each finding is correct and complete against the code needs an independent reviewer, and Phase 23 real-path tests are the proof."
  - id: D2
    description: "Per-file ledger equal to slice-files.ts --check BUY (19 files, honeypot anchor present) and 20-class sweep with searches"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "plan Task 1 verify node script (ledger == enumerator, 20 cells, each with search)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Money-and-timing thresholds inventory (28 rows, all AC-37 fields, every flagged row with a recommendation)"
    requirement: AUDIT-04
    verification:
      - kind: other
        ref: "plan Task 2 verify node script (rows 28)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Decision cards OD-6, OD-15, OD-16 (each with keep-current and its risk) and proposed cards BUY-01..08"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice BUY (NAC-12) + plan Task 2 verify card loop"
        status: pass
    human_judgment: true
    rationale: "NAC-12 neutrality (cards do not steer) is checked only in part by the tool. A human reads the cards at the 22-28 consolidation."
  - id: D5
    description: "Escalations: ESC-BUY-01 (S0, immediate) and ESC-BUY-02 (8 S1, area-batch) with verbatim operator responses; every S0/S1 BUY finding carries an escalation_ref"
    verification:
      - kind: other
        ref: "Task 3 acceptance node check (unescalated [], badlink [], extra [], tier area-batch) + check.ts partial fail=0"
        status: pass
    human_judgment: false

duration: 66min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 17: BUY/Detection Slice Audit Summary

**Read-only audit of the 19-file buy/detection slice at 23a6461: 26 findings (1 S0, 9 S1), 28 money-and-timing threshold rows, cards OD-6/OD-15/OD-16 plus 8 proposed cards, and two operator escalations (ESC-BUY-01 S0, ESC-BUY-02 S1 batch), both answered "Acknowledge continue".**

## Performance

- **Duration:** about 66 min wall-clock across three executor sessions, including two operator waits
- **Started:** 2026-11-07T04:31Z (after plan base 1f48e3f)
- **Completed:** 2026-11-07T05:37Z
- **Tasks:** 3 of 3
- **Files modified:** 43, all under `.planning/audit/` (NAC-13: `git diff --name-only 1f48e3f..ebf8e89` shows no path outside it)

## Accomplishments

- All 8 owned research candidates are registered. RC-01 → AUD-BUY-002 (S1, STRAND, 5 separate failure-point traces). RC-02 → AUD-BUY-003 (S1, LOSS: minOut 0 when the quote fails). RC-04 → AUD-BUY-004 (S1, double buy). RC-05 → AUD-BUY-005 (S1, no unhandledRejection handler). RC-09 → AUD-BUY-006 (S1, the Telegram allowlist is effectively open). RC-16 → AUD-BUY-007 (S2, dead simulateSell sends a real approve). RC-20 → AUD-BUY-008 (S1 candidate, WS reconnect). RC-24 → AUD-BUY-009 (S3, hard-coded isHoneypot false). None is marked NOT-A-BUG.
- The independent findings include a new S0, AUD-BUY-001: a deliberate buy that lands has no exit or anti-rug protection once the script exits. Two more are S1: AUD-BUY-010 (the risk caps can be overspent by concurrent handlers) and AUD-BUY-011 (dashboard "stop chain" does not stop buying). AUD-BUY-025 rediscovers RC-10 (the deliberate public buy waits with no timeout inside the nonce lock) and is linked to ESC-PRE-02.
- The ledger (19 files) equals the enumerator, with the honeypot anchor present. The sweep covers C01..C20, and each cell records its search.
- The thresholds inventory has 28 TH-BUY rows, covering effective values for unset, empty and non-numeric env. Flagged rows carry recommendations.
- Cards OD-6, OD-15 and OD-16 each include a keep-current option with its risk. Proposed cards BUY-01..08 cover the other behaviour-changing recommendations. BUY-01 carries the ESC-BUY-01 interim rule.
- Escalations: ESC-BUY-01 (immediate, AUD-BUY-001) and ESC-BUY-02 (area-batch, AUD-BUY-002, -003, -004, -005, -006, -008, -010, -011) record the operator's words verbatim. Every S0/S1 BUY finding now has an `escalation_ref`.

## Task Commits

1. **Task 1 (part): S0 registered before the immediate-tier stop** - `93c001e` (docs)
2. **Task 1: BUY audit, findings, ledger, 20-class sweep, ESC-BUY-01 ruling** - `c03c7a1` (docs)
3. **Task 2: thresholds inventory and decision cards** - `5f2fe23` (docs)
4. **Task 3: ESC-BUY-02 area S1 batch ruling and finding links** - `ebf8e89` (docs)

**Plan metadata:** recorded in the docs(22-17) SUMMARY and completion commits that follow this file.

## Files Created/Modified

- `.planning/audit/findings/AUD-BUY-001..026.json`: the BUY findings register
- `.planning/audit/ledger/BUY.json`: per-file coverage rows at 23a6461
- `.planning/audit/sweep/BUY.json`: the 20 class cells with searches
- `.planning/audit/thresholds/BUY.json`: 28 AC-37 rows
- `.planning/audit/decisions/OD-6.json`, `OD-15.json`, `OD-16.json`: the owned decision cards
- `.planning/audit/decisions/proposed/BUY-01..08.json`: proposed cards for 22-28 numbering
- `.planning/audit/escalations/ESC-BUY-01.json`, `ESC-BUY-02.json`: the operator escalation records
- `.planning/audit/escalations/ESC-PRE-02.json`: one line changed, `resolved_items` gains AUD-BUY-025

## Decisions Made

- **ESC-BUY-01 (operator, verbatim "Acknowledge continue"):** AUD-BUY-001 stays S0. No decimal phase. Interim rule on card BUY-01: if you ever do a manual buy, start the main bot right afterwards. As an S0 capital finding it blocks the re-entry gate until it is fixed.
- **ESC-BUY-02 (operator, verbatim "Acknowledge continue"):** this is the acknowledge-continue option for all 8 S1 entries. No severity changes; AUD-BUY-002 stays S1 because the operator did not ask for S0. No decimal phase, and the phase continues. Separately, the orchestrator (not the operator) recommended that AUD-BUY-002 be first in line in Phase 23 whatever its rating. That recommendation is recorded in `ruling_note`, attributed to the orchestrator.
- AUD-BUY-002 is rated S1 against a research suggestion of S0, with a written `severity_rationale` (NAC-10 passes). The operator saw this rating at the S1 checkpoint and kept it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Edited ESC-PRE-02.json, outside this plan's files_modified**
- **Found during:** Task 1 (earlier session)
- **Issue:** AUD-BUY-025 rediscovers RC-10 at src/bot.ts:750. That RC is already escalated as ESC-PRE-02 with the alias `rc:RC-10`. PROTOCOL's rediscovery rule says to link the existing record, never escalate twice.
- **Fix:** Added `"AUD-BUY-025"` to ESC-PRE-02 `resolved_items`; its `items` was left untouched (items are write-once). AUD-BUY-025 `escalation_ref` = ESC-PRE-02.
- **Files modified:** .planning/audit/escalations/ESC-PRE-02.json
- **Committed in:** c03c7a1

**2. [Rule 2 - Missing critical] Task 2 amended AUD-BUY-005 and sweep/BUY.json, outside Task 2's file list**
- **Found during:** Task 2 (earlier session), threshold inventory
- **Issue:** A concrete crash trigger for RC-05 was found. `parseEther(<prefix>_MIN_LIQUIDITY)` runs before the try in checkMinLiquidity (src/bot.ts:185), and a non-numeric env value is not validated at load. The resulting rejection escapes and exits the process.
- **Fix:** Added the C18 evidence and class to AUD-BUY-005, and listed AUD-BUY-005 in sweep cell C18.
- **Files modified:** .planning/audit/findings/AUD-BUY-005.json, .planning/audit/sweep/BUY.json
- **Committed in:** 5f2fe23

**3. [Rule 1 - Bug] Corrected line references in the ESC-BUY-02 summary before commit**
- **Found during:** Task 3 (this session)
- **Issue:** The first draft cited `src/telegramListener.ts:74-80` and used vague "V3 twin" wording. The findings' own evidence gives `:77-83` and exact V3 line ranges.
- **Fix:** Rewrote the summary to cite the exact evidence lines of each finding (re-measured from the finding files, which carry the @23a6461 refs).
- **Files modified:** .planning/audit/escalations/ESC-BUY-02.json (before its first commit)
- **Committed in:** ebf8e89

### Recording choices (not rule deviations, documented for the verifier)

- **ESC-BUY-02 `ruling: "none"`:** set per the orchestrator's resume instruction, following the ESC-FORENSIC-01 precedent (acknowledged, no ruling that changes anything). ESC-BUY-01 instead wrote a descriptive `ruling` string. Both pass check.ts. The chosen option text is in `ruling_option_text` and the interpretation is in `ruling_note`.
- **ESC-BUY-02 `date: 2026-11-06`:** the session the items were found, matching ESC-BUY-01. AUD-BUY-011's `found_date` reads 2026-11-07 because it was written after midnight in the same audit session. A `date_note` field records this.
- **Task 1 stopped early (planned, not a deviation):** S0 AUD-BUY-001 triggered the D-16 immediate tier. The finding was committed alone (93c001e), the operator ruled, and the continuation finished Task 1.
- **Evidence outside the slice:** some findings cite files outside the 19-file slice: `src/utils/db.ts`, `src/exitEngine.ts`, `src/utils/mevStrategies/*`, `src/api/routes/chains.ts`, `src/riskManager.ts`, `src/config.ts`, `src/utils/provider.ts`, `scripts/deliberate-buy.ts`. The plan's cross-read instruction allows this. All are read at 23a6461 and none was edited.

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing critical, 1 bug)
**Impact on plan:** All are inside `.planning/audit/` and none fixes code (NAC-13 holds). No scope creep.

## Issues Encountered

- **check.ts reports 2 PENDING after Task 3, not 0.** Diagnosed. Both are `od_ref OD-11 names no decision card yet` (AUD-BUY-008 and TH-BUY-11). The plan mandates `RC-20 -> OD-11`, and the OD-11 card is owned by plan 22-22, whose files_modified lists `decisions/OD-11.json`. At stage partial, check.ts deliberately reports a not-yet-written card as PENDING (`checkOdRef`). The two PENDINGs were already present after Tasks 1-2. They clear when 22-22 writes OD-11 and would FAIL at consolidation if it never does. Every escalation PENDING is gone: fail=0, and no S0/S1 BUY finding lacks an `escalation_ref`.

## Verification Results

- `check.ts --stage partial --slice BUY`: `RESULT PASS stage=partial slices=BUY fail=0 pending=2 warn=0`. The 2 PENDING are OD-11, explained above.
- Task 1 verify: `BUY ok 19`. Ledger equals the enumerator, 20 cells with searches, 8 RCs mapped, RC-01 has 5 traces, every entry has an origin.
- Task 2 verify: `rows 28`. All AC-37 fields are present, and OD-6/15/16 each have 2 or more options including keep-current.
- Task 3 acceptance: tier area-batch, 8 items, verbatim response, phase_continued true. Unescalated S0/S1 [], mislinked [], extra [].
- `render.ts --out <mktemp -d>`: exit 0, rendered AUDIT-FINDINGS.md (168430 bytes) and OPERATOR-DECISIONS.md. The canonical rendered files were neither staged nor committed.
- NAC-13: `git diff --name-only 1f48e3f..ebf8e89` lists only `.planning/audit/` paths.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- The BUY slice data is complete for the 22-28 consolidation (proposed cards BUY-01..08 get OD numbers there) and the 22-29 final render.
- The OD-11 card must be written by 22-22 for the 2 PENDING od_refs to resolve.
- For Phase 23: AUD-BUY-001 (S0) and the 8 S1 entries in ESC-BUY-02 each need a real-path proof. Per the orchestrator's recommendation, AUD-BUY-002 goes first in line. All of them block the live re-entry gate until they are fixed in Phase 24.

## Self-Check: PASSED

- FOUND: ESC-BUY-02.json, ESC-BUY-01.json, ledger/BUY.json, sweep/BUY.json, thresholds/BUY.json, OD-6/15/16.json, 26 AUD-BUY files
- FOUND commits: 93c001e, c03c7a1, 5f2fe23, ebf8e89 (`check evaluation-scope --plan 22-17 --commits-only`: status resolved, 4 commits on this branch)

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
