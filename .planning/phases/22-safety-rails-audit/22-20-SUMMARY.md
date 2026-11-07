---
phase: 22-safety-rails-audit
plan: 20
subsystem: audit
tags: [audit, nonce, mev, flashbots, bloxroute, ethers, tx-slice, escalation]

requires:
  - phase: 22-03
    provides: "SAFE-01 off-machine copy and the operator's D-22 exact-value check (safe01-offmachine.json)"
  - phase: 22-04
    provides: "audit tooling (check.ts, render.ts, slice-files.ts), PROTOCOL.md, slices.json TX entry with literal includes"
provides:
  - "TX slice register: findings AUD-TX-001..017, ledger/TX.json (11 files), sweep/TX.json (20 cells), thresholds/TX.json (27 rows)"
  - "Decision card OD-17 (nonce-lock head-of-line policy and re-entrancy detection) and proposed cards TX-01..TX-04"
  - "RC-10 as two sub-findings (AUD-TX-001 re-entrancy, AUD-TX-002 never-settling) linked to ESC-PRE-02 via resolved_items"
  - "ESC-TX-01: TX area S1 batch (AUD-TX-003, -004, -005, -009), operator ruling acknowledge-continue"
affects: [22-12, 22-13, 22-28, 22-29, phase-23, phase-24, phase-29]

actuals:
  tokens: 37400
  tasks: 3
  commits: 3
plan_head_before: f0c11e47856ab90528312cfbc1b74489d24d7786
plan_head_after: 9da0e496c6947153875e7ed3fe01bd359d538a6a

tech-stack:
  added: []
  patterns:
    - "Distinct mechanisms under one RC are separate findings sharing the rc and escalation_ref (RC-10 a/b), so fixing one cannot close the other"
    - "Context supplied by the orchestrator is recorded with explicit attribution (ruling_note, evidence note), never as operator words"

key-files:
  created:
    - .planning/audit/findings/AUD-TX-001.json .. AUD-TX-017.json
    - .planning/audit/ledger/TX.json
    - .planning/audit/sweep/TX.json
    - .planning/audit/thresholds/TX.json
    - .planning/audit/decisions/OD-17.json
    - .planning/audit/decisions/proposed/TX-01.json .. TX-04.json
    - .planning/audit/escalations/ESC-TX-01.json
  modified:
    - .planning/audit/escalations/ESC-PRE-02.json (resolved_items gained AUD-TX-001, AUD-TX-002; items untouched)

key-decisions:
  - "ESC-TX-01: operator ruled acknowledge-continue for AUD-TX-003/-004/-005/-009; no severity change, no decimal phase, Phase 22 continues"
  - "RC-10 stays on ESC-PRE-02 (AUD-TX-001, AUD-TX-002); no second record created for it"
  - "AUD-TX-004 (RC-17) and AUD-TX-005 (RC-18) remain confirmed S1 until 22-29 re-audits rails 22-12 / 22-13"
  - "AUD-TX-014 stays S2: backup copies of persisted logs passed the D-22 exact-value check, but the code path still writes credentials on the next error"

patterns-established:
  - "Area-batch escalation record shape (ESC-ANTIRUG-01) reused for ESC-TX-01"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "TX slice findings, ledger and 20-class sweep from code at the audit base; six owned RCs mapped, RC-10 split and linked to ESC-PRE-02"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice TX (RESULT PASS fail=0 pending=0) + Task 1 <automated> verify (TX ok 11)"
        status: pass
    human_judgment: false
  - id: D2
    description: "TX thresholds inventory (27 AC-37 rows), card OD-17 and proposed cards TX-01..TX-04"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "Task 2 <automated> verify (rows 27) + check.ts --stage partial --slice TX (NAC-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ESC-TX-01 area-batch record with the operator's verbatim ruling; escalation_ref on the four S1 findings"
    requirement: AUDIT-04
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice TX: the four PENDING escalation_ref lines cleared (pending=0); node acceptance script: items == unescalated S0/S1 set, no other record lists RC-10"
        status: pass
    human_judgment: false
  - id: D4
    description: "Substance of the findings (that each mechanism and severity is right)"
    verification: []
    human_judgment: true
    rationale: "Audit judgment; the suite and check.ts verify shape and links, not whether a finding is true. Phase 23 real-path tests prove each S1."

duration: 44min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 20: TX Slice Audit Summary

**Nonce/MEV/transaction slice audited read-only at 23a6461: 17 findings (6 S1, 4 S2, 6 S3, 1 S4), RC-10 split into a re-entrancy deadlock and a never-settling wait() inside the lock (both on ESC-PRE-02), head-of-line blocking of anti-rug sells (RC-11), a Flashbots bundle-wait crash, 27 threshold rows, card OD-17 and four proposed cards; the operator acknowledged the S1 batch (ESC-TX-01).**

## Performance

- **Duration:** about 44 min of wall time for the plan (including the checkpoint wait)
- **Started:** about 2026-11-07T16:22Z
- **Completed:** 2026-11-07T17:06Z
- **Tasks:** 3 of 3
- **Files modified:** 27 (all under `.planning/audit/`)

## Accomplishments

- RC-10 registered as two independently verifiable sub-findings: AUD-TX-001 (withNonceLock is a non-reentrant promise chain, so a nested call for the same wallet deadlocks) and AUD-TX-002 (wait() with timeout 0 inside the lock, including the Base/Arbitrum passthrough strategy). Both link ESC-PRE-02 and appear in its `resolved_items`.
- RC-11 (AUD-TX-003): a snipe buy holds the wallet lock through every private attempt (about 4 min at defaults when the bundle does not land), so an anti-rug sell times out after 60 s and is left queued.
- RC-17 / RC-18 (AUD-TX-004 / -005) confirmed at the base SHA with git-grep evidence; mitigation by rails 22-12 / 22-13 noted, re-audit in 22-29.
- New S1 AUD-TX-009: an RPC error during `bundle.wait()` is thrown inside an async block listener, ethers does not catch it, and src has no `unhandledRejection` handler, so the process dies (reproduced offline).
- RC-22 (AUD-TX-007, S2): base fee taken as `maxFeePerGas - maxPriorityFeePerGas` = 2x the latest base fee. RC-26 (AUD-TX-006, S3): getBundleStatsV2 telemetry runs inside the lock.
- Section C items covered: E6 wait() error classification (AUD-TX-011), E5 no reorg handling (AUD-TX-012), gasManager unreachable (AUD-TX-013).
- Thresholds: 27 AC-37 rows covering every `MEV_*` key the slice reads, `RPC_TIMEOUT_MS` (documented, never read), and the hard-coded constants.
- ESC-TX-01 recorded with the operator's verbatim reply; AUD-TX-014 and card TX-04 now carry the orchestrator-supplied evidence that the backup copies of the persisted logs contain none of the bloXroute header or RPC/WS URL values.

## Task Commits

1. **Task 1: Audit the TX slice (findings, RC mapping, ledger, 20-class sweep)** - `be76b1f` (docs)
2. **Task 2: TX thresholds, card OD-17, proposed cards** - `74032f6` (docs)
3. **Task 3: TX area S1 batch, ESC-TX-01 (acknowledge-continue)** - `9da0e49` (docs)

**Plan metadata:** recorded in the docs commit that follows this SUMMARY.

## Files Created/Modified

- `.planning/audit/findings/AUD-TX-001..017.json` - the TX register entries
- `.planning/audit/ledger/TX.json` - one row per slice file (11), equal to `slice-files.ts --check TX`
- `.planning/audit/sweep/TX.json` - C01..C20 with ids or "checked, none" plus each search
- `.planning/audit/thresholds/TX.json` - 27 AC-37 rows (bare array)
- `.planning/audit/decisions/OD-17.json` - nonce-lock head-of-line and re-entrancy card
- `.planning/audit/decisions/proposed/TX-01..04.json` - wait/timeout policy, private-fee model, getBundleStatsV2, log redaction
- `.planning/audit/escalations/ESC-TX-01.json` - area-batch record for AUD-TX-003/-004/-005/-009
- `.planning/audit/escalations/ESC-PRE-02.json` - `resolved_items` gained AUD-TX-001, AUD-TX-002 (`items` untouched)

## Decisions Made

- Operator ruling on ESC-TX-01, verbatim: "Acknowledge continue". Recorded as option acknowledge-continue for all four S1 entries, `ruling: none`, `phase_continued: true`. The orchestrator's context (AUD-TX-004/-005 closed by 22-12/22-13; AUD-TX-009 shares a crash class with AUD-ANTIRUG-002 and belongs with it in Phase 24) is in `ruling_note`, attributed to the orchestrator, not the operator.
- AUD-TX-014 / TX-04 context goes in schema fields only: a `command` evidence entry plus an appended note in `severity_rationale` on the finding, and an appended sentence in the card's `recommendation`. No new keys. It is attributed to the orchestrator. It also records the limits: an exact-string match on the backup copies, ARB_WS_URL and BASE_WS_URL are empty in `.env`, and terminal-only output cannot be checked. No file under `data/` was opened.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Thresholds file written as a bare array**
- **Found during:** Task 2
- **Issue:** PROTOCOL allows a plain array or `{rows, discovery}`. The plan's own verify calls `t.filter(...)`, which only works on an array.
- **Fix:** `thresholds/TX.json` is a bare array of 27 rows. The discovery list is not kept as a separate object.
- **Files modified:** `.planning/audit/thresholds/TX.json`
- **Verification:** Task 2 verify prints `rows 27`; check.ts passes
- **Committed in:** `74032f6`

**2. [Process] Tracer step merged into one pass**
- **Found during:** Task 1
- **Issue:** The plan asked for RC-10 to be registered end to end first, with check and render run, and only then the rest of the slice.
- **Fix:** RC-10 and the rest of the slice were written in one pass before the first check/render run. The tracer gate (re-run of the automated verify) still ran and passed before Task 2 started.
- **Files modified:** none beyond Task 1's files
- **Verification:** Task 1 verify `TX ok 11`; check.ts PASS
- **Committed in:** `be76b1f`

---

**Total deviations:** 2 (1 blocking fix to match the plan's own verify, 1 process ordering)
**Impact on plan:** No change to scope or results. Nothing outside `.planning/audit/` changed and nothing was fixed (NAC-13): `git diff --name-only f0c11e4..HEAD` lists only `.planning/audit/` paths.

## Issues Encountered

None open. The orchestrator described the exact-value check as covering "every *_RPC_URL/*_WS_URL value". That is true for every key that holds a value. ARB_WS_URL and BASE_WS_URL are `unset` (present but empty), so there is nothing to leak, and the evidence note says so explicitly instead of reporting them as "no".

## Notes for 22-28 (consolidation)

- **TH-EXIT-23 is wrong.** It says MEV_SELL_MAX_PRIORITY_FEE_GWEI caps private sells. It does not: the MEV strategies always run the buy model and never apply that key (AUD-TX-010). Reconcile it in consolidation.
- **bloXroute trace for AUD-BUY-002.** It uses the same latest-attempt-only mechanism: after a not-landed attempt the next one re-signs the same nonce and only the latest hash is reconciled, so an earlier accepted attempt that mines reads as landed-not-ours. The trace is in the `sweep/TX.json` C07 cell (reconciliation.ts:476-497, :576-603).
- **AUD-TX-009 and AUD-ANTIRUG-002** share a crash class (an unhandled error or rejection ends the process). They are not linked through `related` in this plan. Consider linking them, and keep their Phase 24 fixes together (card OD-6).

## Offline Checks (provenance)

The reproduction scripts live in the orchestrator scratchpad `repro/` folder. None of them imports `src/` or `src/db`, opens SQLite, reads `.env` or touches live data, and none calls anything except loopback 127.0.0.1. The lock check loaded the start-of-phase snapshot copy of `nonceAuthority.ts`, held outside the repo, not the working tree (which 22-12 changes).

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- The TX register is ready for 22-28 consolidation and the 22-29 re-audit of `nonceAuthority.ts` after 22-12 / 22-13.
- Six S1 TX entries (AUD-TX-001..005, -009) block the live re-entry gate until Phase 23 proves them and Phase 24 fixes them. For AUD-TX-004 and AUD-TX-005, the 22-29 re-audit of the rails can move them forward instead.

## Self-Check: PASSED

- FOUND: ESC-TX-01.json, ledger/TX.json, sweep/TX.json, thresholds/TX.json, OD-17.json, proposed/TX-04.json
- FOUND commits: be76b1f, 74032f6, 9da0e49 (ancestors of HEAD; `check evaluation-scope --plan 22-20` resolves all three)
- `check.ts --stage partial --slice TX`: RESULT PASS fail=0 pending=0 warn=0
- Task 1 verify: `TX ok 11`; Task 2 verify: `rows 27`; render dry run to a temp folder OK, canonical AUDIT-FINDINGS.md / OPERATOR-DECISIONS.md untouched

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
