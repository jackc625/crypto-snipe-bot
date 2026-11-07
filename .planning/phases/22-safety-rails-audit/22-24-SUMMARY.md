---
phase: 22-safety-rails-audit
plan: 24
subsystem: testing
tags: [audit, test-quality, vitest, hardhat-fork, ethers-6.16, rc-28, rc-19]

requires:
  - phase: 22-safety-rails-audit (22-03, 22-04)
    provides: audit protocol, slice enumerator, check/render tools, pre-phase escalation records (ESC-PRE-03)
provides:
  - TESTI ledger (62 rows, D-20 quality labels, fixture provenance, fork execution status)
  - TESTI sweep (area test, 20 cells, results derived from finding classes)
  - 27 AUD-TESTI findings including RC-28 (AUD-TESTI-001), the mockProvider fidelity finding (AUD-TESTI-002) and the money-path coverage map (AUD-TESTI-020)
affects: [phase-23-real-path-triage, phase-24-capital-fixes, phase-25-fork-harness, phase-28-test-rewrites, 22-28-consolidation, 22-29-close]

actuals:
  tokens: 56807
  tasks: 2
  commits: 2
plan_head_before: 7775c48b4298d4fe19bc7990b76cd05e237d0f6a
plan_head_after: 605988524da3d49021f0fe3b0ec358a4718e665e

tech-stack:
  added: []
  patterns:
    - "Sweep cell results derived from each finding's classes so cross-class ids always appear in every cell (AC-34)"
    - "Rail judgment recorded as a finding trace (could a fork run sign with the real key on real mainnet)"

key-files:
  created:
    - .planning/audit/findings/AUD-TESTI-001.json .. AUD-TESTI-027.json
    - .planning/audit/ledger/TESTI.json
    - .planning/audit/sweep/TESTI.json
  modified:
    - .planning/audit/escalations/ESC-PRE-03.json (resolved_items gains AUD-TESTI-011, rediscovery link)

key-decisions:
  - "No integration or fork path signs with the real key or sends to real mainnet: fork contexts use Hardhat keys on 127.0.0.1:8545 and the only real-key wallet sites (startMultiChainBot, createChainContext, getWallet) are not called; so no rail-class stop (D-16)"
  - "The RC-19 integration and fork side is one S1 rediscovery (AUD-TESTI-011) linked to ESC-PRE-03, not a new escalation; no new S1, so no area checkpoint"
  - "Hardhat #0 and #1 keys recorded as known-public (AUD-TESTI-018), not escalated"
  - "The hollow fork config key is STOP_LOSS_PERCENT (what the code sets), not STOP_LOSS_PCT (what the plan text says); registered under the real name"

patterns-established:
  - "Coverage map finding: one sub-claim per registered money-path S0/S1 with caught / not caught / encoded status"

requirements-completed: [AUDIT-01, AUDIT-03]

coverage:
  - id: D1
    description: "RC-28 registered (test DB helper v4 vs prod v7, replica migrations, pre-v7 exit_state fixture) with base-SHA evidence from testDb.ts and db.ts"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice TESTI && RC-28 mapping node check (plan Task 1 verify)"
        status: pass
    human_judgment: false
  - id: D2
    description: "TESTI ledger: 62 rows equal to slice-files.ts --check TESTI, every test file labelled (D-20), every fixture with provenance, every fork label with its execution status; 20-cell sweep with searches"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "plan Task 2 verify command (check.ts partial + 62-row / provenance / label / 20-cell node check): prints 'TESTI ok 62'"
        status: pass
    human_judgment: false
  - id: D3
    description: "Judgment content of the findings (severities, the 0-of-39 coverage map, the no-real-key-signing trace) is correct"
    verification: []
    human_judgment: true
    rationale: "Static audit reasoning; check.ts validates schema and links, not whether a test-quality judgment or a severity is right. 22-28/22-29 and the operator review it."

duration: 33min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 24: Integration, Fork, Helper and Fixture Test Audit Summary

**Integration and fork suites audited read-only: RC-28 registered, mockProvider measured against ethers 6.16.0, no fork path signs with the real key, and none of the 39 registered money-path S0/S1 findings would be caught on the real path by any integration or fork test.**

## Performance

- **Duration:** 33 min
- **Started:** 2026-11-07T19:25:31Z
- **Completed:** 2026-11-07T19:58:14Z
- **Tasks:** 2
- **Files modified:** 30 (29 created, 1 modified), all under `.planning/audit/`

## Accomplishments

- **The operator's core question, answered from code (AUD-TESTI-020):** for each of the 39 registered money-path S0/S1 findings, no integration or fork test would catch it on the real path. Five are encoded as expected behaviour by a test (AUD-BUY-001, AUD-EXIT-008, AUD-EXIT-013, AUD-EXIT-015 / AUD-ANTIRUG-011, AUD-API-002). Three sit on fork paths that run but do not assert them (AUD-DB-002, AUD-DB-003, AUD-EXIT-003). The fork tests that do prove the real path cover the buy landing, the sell recording its decoded amount_out, and the failed-held resume SQL.
- **RC-28 (AUD-TESTI-001, S2):** `test/helpers/testDb.ts` builds two tables at user_version 4 and claims it "matches src/utils/db.ts exactly". Production migrates to version 7 with three more tables and the failed-held columns. The pauseFlow integration suite runs a hand-written v6 replica.
- **Mock fidelity (AUD-TESTI-002, S2):** sub-claims compare the mock against ethers 6.16.0 for each case: a status-0 receipt (CALL_EXCEPTION), replacement and reprice (TRANSACTION_REPLACED), a tx that is never mined (wait with timeout 0 never settles), and reorg or dropped txs. The passthrough "wait-timeout" test fakes a rejection ethers cannot produce (AUD-TESTI-003), so the registered S1 AUD-TX-002 stays green.
- **Rail judgment:** no fork path signs with the real key or sends to real mainnet (trace on AUD-TESTI-017), so there was no immediate-tier stop. Before the rails, the integration and fork suites did reach real state: preflightCli's child opened the live DB and called mainnet RPCs, and the fork replays loaded the real config and notifier. That reach is the RC-19 rediscovery AUD-TESTI-011 (S1), linked to ESC-PRE-03 and not escalated again.
- **Fork suite:** every fork row is labelled "not executed in Phase 22; first execution owner Phase 25". Several fork tests pass without having run (AUD-TESTI-021). The anti-rug "fork" test mocks the chain reads (AUD-TESTI-022). Some honeypot cases pass for the wrong reason (AUD-TESTI-023). The chainId tripwire cannot fire for the threat it names (AUD-TESTI-024). The STOP_LOSS_PERCENT key the replay sets is read nowhere in src, and the exit path is never asserted (AUD-TESTI-019). Hardhat #0 and #1 keys are recorded as known-public (AUD-TESTI-018).

## Task Commits

1. **Task 1: Label and sweep test/integration, test/helpers and test/fixtures, including RC-28**: `6cab907` (docs)
2. **Task 2: Label and sweep test/fork, complete the TESTI ledger and sweep**: `6059885` (docs)

**Plan metadata:** recorded by the final docs commit for this SUMMARY.

## Files Created/Modified

- `.planning/audit/findings/AUD-TESTI-001.json` .. `AUD-TESTI-027.json`: 27 findings (1 S1 rediscovery, 18 S2, 6 S3, 2 S4).
- `.planning/audit/ledger/TESTI.json`: 62 rows with D-20 labels, per-case labels for mixed files, fixture provenance (10 synthetic, 12 public-historical) and the fork execution status.
- `.planning/audit/sweep/TESTI.json`: 20 cells (area test), each with its search.
- `.planning/audit/escalations/ESC-PRE-03.json`: AUD-TESTI-011 added to resolved_items (one-line edit, items unchanged).

## Decisions Made

- No fork test or integration test has a path that signs with PRIVATE_KEY or DEPLOY_PRIVATE_KEY, or that sends a transaction anywhere but the local node, so no rail-class stop. The evidence is in the AUD-TESTI-017 trace.
- AUD-TESTI-011 is a rediscovery of ESC-PRE-03 (RC-19). The precedent is 22-23 (AUD-TESTU-001). No new escalation record and no checkpoint.
- The coverage map is one S2 entry with 39 sub-claims instead of 39 entries. The S0/S1 defects are already registered and escalated in their own slices; this entry is the map Phase 23 consumes.
- Fixture provenance: the captures under `test/fork/fixtures/` (and their READMEs) are public-historical. Everything under `test/fixtures/` is synthetic. No fixture is operator-state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 1 sweep cells missed some cross-class ids**
- **Found during:** Task 2, while building the final sweep.
- **Issue:** the Task 1 commit hand-listed cell results. AUD-TESTI-003 was missing from C09, AUD-TESTI-004 from C14 and AUD-TESTI-005 from C15, which AC-34 requires.
- **Fix:** cell results are now derived from each finding's `classes`. The search text stays per cell.
- **Files modified:** `.planning/audit/sweep/TESTI.json`
- **Verification:** check.ts partial PASS (0 pending). The generator also checks that every finding id is in each of its class cells.
- **Committed in:** `6059885`

**2. [Rule 3 - Blocking] ESC-PRE-03 needed the rediscovery link**
- **Found during:** Task 1
- **Issue:** check.ts requires a finding's escalation record to list it (AC-39), but `escalations/` is not in the plan's files_modified.
- **Fix:** a targeted one-line edit added AUD-TESTI-011 to `resolved_items`, following the 22-23 precedent for AUD-TESTU-001. `items` and all other fields are byte-identical.
- **Files modified:** `.planning/audit/escalations/ESC-PRE-03.json`
- **Committed in:** `6cab907`

**3. [Plan text vs code] The hollow config key is STOP_LOSS_PERCENT**
- **Found during:** Task 2
- **Issue:** the plan says realLaunchReplay sets "STOP_LOSS_PCT (read nowhere in src)". At the base SHA it sets STOP_LOSS_PERCENT (`realLaunchReplay.fork.test.ts:75`). src reads STOP_LOSS_PCT (`src/config.ts:291`), which the replay does not set.
- **Fix:** registered under the real name (AUD-TESTI-019). The research hint (22-RESEARCH.md line 359) already had the right name.

---

**Total deviations:** 3 (1 auto-fixed bug in my own Task 1 output, 1 blocking schema link, 1 plan-text correction).
**Impact on plan:** none on scope. Nothing outside `.planning/audit/` changed (AC-33 / NAC-13).

## Issues Encountered

- A prior session's `snap` folder in the scratchpad was not empty, so the snapshot went to a new folder (`testi-snap`). I did not reuse the old one.
- Nothing was executed: no Vitest, Hardhat or fork run, and no src import. All analysis used the base-SHA snapshot and a text-only import-graph script.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- 22-28 consolidation: TESTI raises no consolidation-stage failures. The `rc:RC-28` placeholders in AUD-TESTU-017/-018/-019 can now resolve to AUD-TESTI-001.
- 22-29 owns the fork files changed in Phase 22 as dated obligations. Phase 25 is the first fork execution: AUD-TESTI-017/-019/-021/-023/-024 describe what that run must fix to be meaningful.
- Phase 23 work list: the 39 sub-claims of AUD-TESTI-020.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
