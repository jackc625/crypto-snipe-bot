---
phase: 22-safety-rails-audit
plan: 22
subsystem: audit
tags: [audit, dashboard, api, websocket, anti-rug, escalation, react]

requires:
  - phase: 22-03
    provides: verified off-machine backup and the bot-off baseline
  - phase: 22-04
    provides: audit register, slice-files enumerator, check.ts / render.ts, audit_base_sha 23a6461, ESC-PRE-04
provides:
  - AUD-API-001..017 (src/api, 14 files): the owned failed-held sell-selection item (ESC-PRE-04), RC-12, CORS / CSRF / auth / duplicate-execution as separate entries, two process-crash paths
  - AUD-DASH-001..010 (dashboard/, 45 files): anti-rug state wiped by the 5 s push, CB trip not re-loaded, session-only dry-run review panel, presentation and lifecycle defects
  - ledger/API.json (14 rows), ledger/DASH.json (45 rows), sweep/API.json and sweep/DASH.json (20 cells each), thresholds/API.json (TH-API-01..09)
  - card OD-11 (one WebSocket owner per chain), proposed cards API-01..03 and DASH-01
  - ESC-API-01 area-batch record (operator acknowledge-continue); AUD-API-001 added to ESC-PRE-04 resolved_items
affects: [22-28, 22-29, phase-23, phase-24, phase-29]

actuals:
  tokens: 49348
  tasks: 3
  commits: 3
plan_head_before: 9a75fb54abf77369b0be88d67ad05186de90e6df
plan_head_after: 89e833d55c0eeb122fae3e7942dc1dd8429a90dd

tech-stack:
  added: []
  patterns:
    - "Dashboard effects already registered on the API side are linked from the DASH ledger and sweep cells by their AUD-API id, not re-registered as DASH duplicates"
    - "Orchestrator context on an escalation is recorded in ruling_note and labelled as orchestrator-supplied, never as the operator's words"

key-files:
  created:
    - .planning/audit/findings/AUD-API-001.json .. AUD-API-017.json
    - .planning/audit/findings/AUD-DASH-001.json .. AUD-DASH-010.json
    - .planning/audit/ledger/API.json
    - .planning/audit/ledger/DASH.json
    - .planning/audit/sweep/API.json
    - .planning/audit/sweep/DASH.json
    - .planning/audit/thresholds/API.json
    - .planning/audit/decisions/OD-11.json
    - .planning/audit/decisions/proposed/API-01.json .. API-03.json
    - .planning/audit/decisions/proposed/DASH-01.json
    - .planning/audit/escalations/ESC-API-01.json
  modified:
    - .planning/audit/escalations/ESC-PRE-04.json (resolved_items only; items unchanged)

key-decisions:
  - "ESC-API-01 (area-batch, 2026-11-07): operator answered 'Acknowledge continue' for AUD-API-002 (RC-12) and AUD-API-008; no severity change, no decimal phase, phase continues. AUD-API-001 stays on ESC-PRE-04 and is not listed in ESC-API-01."
  - "Orchestrator interim guidance recorded on ESC-API-01 (not an operator ruling): do not use the dashboard per-chain Stop as a safety switch, use the global pause; fix AUD-API-002 together with AUD-ANTIRUG-001 / AUD-BUY-008 under OD-11; AUD-API-008 is a small behaviour-neutral early Phase 24 fix."
  - "No dashboard entry is S0/S1: the highest DASH severity is S2 (AUD-DASH-001, -002, -003), so no ESC-DASH record and no dashboard checkpoint."
  - "Card DASH-01 (capital, Phase 24 before any ANTIRUG_LIVE_EXECUTE switch): what evidence gates turning anti-rug live selling on, since the dashboard review panel shows only one browser session and has placeholder charts."

patterns-established:
  - "A dashboard view that mixes push and REST state is audited for both the hydrate-on-connect path and the replace-on-push path; a merged field that the next push does not carry is a finding (AUD-DASH-001)"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "API slice registered from base-SHA code: 17 findings incl. the owned failed-held sell-selection item with its four-step trace, RC-12, ledger, sweep, thresholds, OD-11 and API cards"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice API --slice DASH && Task 1 <automated> verify (API ok 14 failed-held item AUD-API-001)"
        status: pass
    human_judgment: false
  - id: D2
    description: "API area S1 batch presented and the operator's ruling recorded as ESC-API-01"
    requirement: AUDIT-04
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice API --slice DASH (pending 2 -> 0 after ESC-API-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Dashboard slice registered from base-SHA code: 10 findings, 45-row ledger, 20-cell sweep, card DASH-01"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice API --slice DASH && Task 3 <automated> verify (DASH ok 45)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Severity and wording of the dashboard findings (read-only code audit, no browser run)"
    verification: []
    human_judgment: true
    rationale: "Severity grading and the plain-language claims are auditor judgment; 22-28 consolidation and the Phase 23 real-path proofs confirm them."

duration: 58min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 22: Dashboard API and Front-End Audit Summary

**Dashboard API and front end audited from code at 23a6461: 17 API and 10 dashboard findings, the owned failed-held emergency-sell gap traced and linked to ESC-PRE-04, the API S1 batch ruled on (ESC-API-01), and three S2 dashboard defects that hide anti-rug state from the operator.**

## Performance

- **Duration:** 58 min, across two sessions with a decision checkpoint between them
- **Started:** 2026-11-07T17:48:06Z
- **Completed:** 2026-11-07T18:46:00Z
- **Tasks:** 3 of 3 (Task 2 is the operator checkpoint)
- **Files created/modified:** 39, all under `.planning/audit/`

## Accomplishments

- **API slice (Task 1, earlier session):** 17 findings for the 14 `src/api` files. AUD-API-001 is the owned failed-held item: emergency-sell and force-sell cannot reach a position whose exit failed while its tokens are still held. It carries the four-step trace, its sibling sites, the ESC-PRE-04 link and card API-01. AUD-API-002 is RC-12 (Stop chain removes the anti-rug subscription; card OD-11). AUD-API-008 shows one malformed Host header ends the bot process (reproduced on loopback). AUD-API-009 shows one invalid WebSocket frame does the same. CORS, CSRF, authentication and duplicate execution are separate entries (005, 006, 007, 004). Also delivered: TH-API-01..09, OD-11, and cards API-01..03.
- **ESC-API-01 (Task 2):** the operator answered "Acknowledge continue" for AUD-API-002 and AUD-API-008. Both findings now point to ESC-API-01, and the check went from 2 PENDING to 0. AUD-API-001 stays on ESC-PRE-04 as already escalated.
- **Dashboard slice (Task 3):** all 45 tracked dashboard files read in full from the snapshot. Ten new findings:
  - **AUD-DASH-001 (S2):** the positions push every 5 s replaces the whole list with rows that have no anti-rug fields. So every position shows "Unmonitored", and a failed live anti-rug exit badge disappears within 5 s. Only the would-have-sold and exit-fired states have any sender.
  - **AUD-DASH-002 (S2):** a circuit-breaker trip, anti-rug socket health and gap warnings are only ever pushed, never loaded on connect. After a reload the "ANTI-RUG HALTED" banner is gone, and that banner is the only way to reach the reset dialog. The monitor tile still says monitoring is active.
  - **AUD-DASH-003 (S2):** the 7-day dry-run review panel tells the operator when to turn on live selling. It shows only events received by this tab, two of its charts are fixed zeros, and its filter does nothing. Card DASH-01.
  - **AUD-DASH-004..010 (S3/S4):**
    - the detail dialog tells quiet positions that a rug was detected and an exit is pending
    - stale views carry no stale marker and show "0.0000" or "The bot is running" when data did not load
    - Total P&L counts only realized P&L, the high-water mark is printed as ETH, and amounts are cut to 4 decimals with no unit
    - Trade History shows 1970 dates (Unix seconds read as milliseconds)
    - the P&L chart never draws
    - Chain Controls leaves a reconnecting socket behind on every visit
    - fonts load from Google while CSP is off
- Dashboard effects already registered on the API side are linked in the DASH ledger and sweep rather than re-registered: failed-held display (AUD-API-001), double submit (AUD-API-004), wrong-unit position values (AUD-API-016), the daily-loss gauge (AUD-API-017), re-parsed limits (AUD-API-003) and alert text (AUD-API-013). No XSS sink was found: everything is React text, there is no `dangerouslySetInnerHTML`, and the API key is never stored.

## Task Commits

1. **Task 1: Audit src/api** - `81aa3dc` (docs)
2. **Task 2: Record ESC-API-01 operator ruling** - `9d0d0d8` (docs)
3. **Task 3: Audit dashboard/** - `89e833d` (docs)

**Plan metadata:** recorded in the SUMMARY and state commits that follow.

## Files Created/Modified

- `.planning/audit/findings/AUD-API-001..017.json`, `AUD-DASH-001..010.json`: the findings
- `.planning/audit/ledger/API.json` (14 rows), `ledger/DASH.json` (45 rows): one row per file printed by `slice-files.ts --check`
- `.planning/audit/sweep/API.json`, `sweep/DASH.json`: 20 class cells each, with the search for every cell; not-applicable dashboard cells state why
- `.planning/audit/thresholds/API.json`: TH-API-01..09 money-or-timing rows
- `.planning/audit/decisions/OD-11.json`, `proposed/API-01..03.json`, `proposed/DASH-01.json`: decision cards
- `.planning/audit/escalations/ESC-API-01.json`: area-batch record; `ESC-PRE-04.json` got `resolved_items: [AUD-API-001]` only

## Decisions Made

- The operator's ESC-API-01 ruling is recorded verbatim. The orchestrator's context and interim guidance (do not use per-chain Stop as a safety switch) are recorded in `ruling_note` and attributed to the orchestrator.
- Dashboard findings that the API slice had already registered with dashboard evidence are linked, not duplicated. This keeps one entry per defect (PROTOCOL section 5).
- DASH-001 and DASH-002 are graded S2, not S1. The display hides that protection is off or that an exit failed, but the bot's own monitoring and the Telegram alerts still work, and live anti-rug execute is off by default.
- Dashboard layout numbers (sizes, colours, chart heights) are cosmetic and excluded, stated once in AUD-DASH-006. Amount formatting, failed-held display and stale-state presentation were all audited as operationally relevant.

## Deviations from Plan

### Process deviations

**1. [Process] Task 1 tracer and expansion done in one pass**
- **Found during:** Task 1 (earlier session)
- **Issue:** the plan orders the failed-held item first, then a pipeline proof, then the expansion. The predecessor wrote the failed-held item and the rest of the API slice in one pass.
- **Fix:** the tracer verify (the full Task 1 `<automated>` check, including the four-step trace, the ESC-PRE-04 link and the card) passed before the Task 1 commit. It was re-run green in this session for the plan-level check.
- **Files modified:** none beyond the Task 1 set
- **Committed in:** `81aa3dc`

**2. [Rule 1 - Bug] Wrong line reference in AUD-DASH-007**
- **Found during:** Task 3 citation re-check
- **Issue:** the sibling-site text cited `src/anti-rug/detector.ts:1075` for the gap-event `timestamp: Date.now()`. The line at the base SHA is `:1074`.
- **Fix:** patched the finding file atomically and corrected the generator.
- **Files modified:** `.planning/audit/findings/AUD-DASH-007.json`
- **Verification:** `git show 23a6461:src/anti-rug/detector.ts | sed -n 1074p` prints `timestamp: Date.now(),`; check partial PASS
- **Committed in:** `89e833d`

---

**Total deviations:** 2 (1 process, 1 Rule 1 citation fix)
**Impact on plan:** none on scope or results. Nothing outside `.planning/audit/` changed (NAC-13).

## Issues Encountered

- AUD-DASH-009 notes one point that a code read cannot settle: whether React Router reuses the per-route `AuthGuard`/`WebSocketProvider` across navigation, which would add one leaked socket per page change. The Chain Controls leak does not depend on it. It is recorded as possible, not proven, because no browser or dev server may run in Phase 22.

## Known Stubs

None in the files this plan created (JSON register files only). The placeholder charts in `dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx` are audit findings (AUD-DASH-003), not stubs introduced here.

## User Setup Required

None.

## Next Phase Readiness

- The API and DASH slices are complete for consolidation (22-28): `check.ts --stage partial --slice API --slice DASH` passes with 0 fail and 0 pending, and rendering validates.
- Phase 24 capital discussion inputs from this plan: API-01 (failed-held sells), API-02 (emergency sell job and pause), OD-11 (WebSocket owner, with AUD-ANTIRUG-001 / AUD-BUY-008), DASH-01 (evidence before anti-rug goes live). AUD-API-008 is a small early fix.

## Self-Check: PASSED

- All created files exist in commits `81aa3dc`, `9d0d0d8` and `89e833d`. All three are ancestors of HEAD (`git log 9a75fb5..HEAD`).
- Both task verifies are green: `API ok 14 failed-held item AUD-API-001` and `DASH ok 45`. `check.ts --stage partial --slice API --slice DASH`: PASS, fail=0, pending=0. `render.ts --out <tmp>`: rendered.
- `git diff --name-only 9a75fb5..HEAD` lists only `.planning/audit/` paths. The post-commit deletion check found no deletions.
