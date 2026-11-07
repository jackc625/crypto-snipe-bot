---
phase: 22-safety-rails-audit
plan: 19
subsystem: audit
tags: [audit, anti-rug, websocket, circuit-breaker, backfill, escalation, decision-cards, thresholds]

# Dependency graph
requires:
  - phase: 22-safety-rails-audit (22-03)
    provides: SAFE-01 backup gate that allows the audit waves to start
  - phase: 22-safety-rails-audit (22-04)
    provides: the audit register (PROTOCOL.md, slice-files.ts, check.ts, render.ts, BASE.json audit_base_sha 23a6461)
provides:
  - ANTIRUG slice register: 17 findings AUD-ANTIRUG-001..017 (6 S1, 6 S2, 4 S3, 1 S4; no S0), RC-13 mapped to AUD-ANTIRUG-001 (od_ref OD-11)
  - ledger/ANTIRUG.json (8 rows, equal to slice-files.ts --check ANTIRUG at the base SHA) and sweep/ANTIRUG.json (C01..C20, each with a search)
  - three written lifecycle traces (reconnect during dashboard stop/start on AUD-ANTIRUG-001, backfill during a pending exit on AUD-ANTIRUG-005, restart after a breaker trip on AUD-ANTIRUG-010)
  - thresholds/ANTIRUG.json (20 AC-37 rows TH-ANTIRUG-01..20)
  - decision card OD-9 (raceTelemetry keep or delete) and proposed cards ANTIRUG-01..07
  - escalation record ESC-ANTIRUG-01 (area batch, the 6 S1 entries, operator reply verbatim, phase continued)
affects: [22-22 (owns card OD-11, referenced by AUD-ANTIRUG-001/-002 and TH-ANTIRUG-15), 22-28 (consolidation, AUD-EXIT-014 status, card numbering), 22-29 (re-audit of detector.ts after 22-12), Phase 23 (real-path proofs), Phase 24 (capital fixes), Phase 32 (OD-19)]

# Actuals (#2632) - chars/4 over the files this plan changed, same scale as the estimate
actuals:
  tokens: 37058
  tasks: 3
  commits: 3
plan_head_before: 4f4baad67d864f4917035bd9b64342934aa40052
plan_head_after: 911fbc5993eabbcc8e12220eb64d4dc194ba23ff

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Escalation records written once via a temp-file-then-rename script that refuses an existing record and refuses to rewrite any finding that does not round-trip byte-identically through toJson, so linking changes exactly one line per finding"
    - "Cross-slice answers are recorded on the answering entry (AUD-ANTIRUG-004 sub_claim 1) and left for 22-28 to apply to the owning slice's entry (AUD-EXIT-014), never edited across slices"

key-files:
  created:
    - .planning/audit/findings/AUD-ANTIRUG-001.json .. AUD-ANTIRUG-017.json
    - .planning/audit/ledger/ANTIRUG.json
    - .planning/audit/sweep/ANTIRUG.json
    - .planning/audit/thresholds/ANTIRUG.json
    - .planning/audit/decisions/OD-9.json
    - .planning/audit/decisions/proposed/ANTIRUG-01.json .. ANTIRUG-07.json
    - .planning/audit/escalations/ESC-ANTIRUG-01.json
  modified:
    - .planning/audit/findings/AUD-ANTIRUG-001/-002/-003/-004/-005/-011.json (escalation_ref set to ESC-ANTIRUG-01 in Task 3)

key-decisions:
  - "ESC-ANTIRUG-01: the operator acknowledged all 6 ANTIRUG S1 entries (AUD-ANTIRUG-001/002/003/004/005/011) with 'ackownledge continue' (typo kept verbatim); no severity changes, no decimal phase, Phase 22 continues"
  - "Executor and orchestrator context (not the operator's words): AUD-ANTIRUG-002 (a refused reconnect crashes the process, reproduced on localhost) was the strongest decimal-phase candidate; the orchestrator recommended acknowledge-continue because the bot stays off through v7.0, and AUD-ANTIRUG-002 should be among the first Phase 24 fixes"
  - "Cross-slice answer for 22-28: a refused or timed-out anti-rug escape does not fire again by design, so the AUD-EXIT-014 mechanism is confirmed by code reading (AUD-ANTIRUG-004 sub_claim 1); 22-28 should update AUD-EXIT-014's status"
  - "external_od_refs owner_phase is stored as the string \"32\" because check.ts (authoritative) requires a non-empty string; the plan's Task 1 verify compares the number 32 and therefore fails as written"
  - "Circuit-breaker restart reset (AUD-ANTIRUG-010, S2 LOSS): judged a loss of protection, not an intended reset; module-only state at circuitBreaker.ts ~73 clears a trip and its acknowledgement trail on every restart"

patterns-established:
  - "Operator replies are stored exactly as typed, typos included; interpretation and any recommendation go in ruling_note with explicit attribution"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "ANTIRUG findings (RC-13 mapped, 17 entries), per-file ledger (8 rows) and 20-class sweep, with three lifecycle traces and the OD-19 external reference"
    requirement: "AUDIT-01"
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice ANTIRUG"
        status: pass
      - kind: other
        ref: "22-19-PLAN Task 1 <automated> verify, as written"
        status: fail
      - kind: other
        ref: "22-19-PLAN Task 1 <automated> verify with owner_phase compared as String"
        status: pass
    human_judgment: true
    rationale: "The as-written Task 1 verify fails on the owner_phase string-vs-number mismatch (check.ts requires a string), and whether the findings are correct and complete is an audit-quality judgment no script asserts"
  - id: D2
    description: "ANTIRUG thresholds inventory (20 AC-37 rows), card OD-9 and proposed cards ANTIRUG-01..07"
    requirement: "AUDIT-04"
    verification:
      - kind: other
        ref: "22-19-PLAN Task 2 <automated> verify (rows 20)"
        status: pass
      - kind: other
        ref: "check.ts --stage partial --slice ANTIRUG (NAC-12 on OD-9 and the proposed cards)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ESC-ANTIRUG-01 area-batch record for the 6 S1 entries, operator reply verbatim, escalation_ref linked on each finding"
    requirement: "AUDIT-05"
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice ANTIRUG (fail 0; the 6 escalation PENDING lines are gone)"
        status: pass
      - kind: other
        ref: "render.ts --out $(mktemp -d) (AUDIT-FINDINGS.md shows 'Operator response: ackownledge continue')"
        status: pass
    human_judgment: false

# Metrics
duration: ~36min (wall-clock incl. operator wait; start approximated)
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 19: ANTIRUG Slice Audit Summary

**I audited the anti-rug slice at 23a6461. It has 17 findings, 6 of them S1. RC-13 is a real defect: three reconnect loops each rewrite `ctx.wsProvider`. A refused WebSocket reconnect crashes the process, and I reproduced that on localhost. The circuit breaker counts each matching log as a separate dispatch rather than counting rugs. Refused rug escapes are never retried. Backfill replays the wrong time windows. After a restart, exits go through the wrong dex. The operator acknowledged all six S1 entries in ESC-ANTIRUG-01 and the phase continues.**

## Performance

- **Duration:** about 36 min wall-clock, including the operator wait at the Task 3 checkpoint. The first executor did not record a start time, so I estimated it from when 22-18 closed (4f4baad at 15:43:50Z).
- **Started:** about 2026-11-07T15:44Z
- **Completed:** 2026-11-07T16:20Z
- **Tasks:** 3 of 3
- **Files:** 29 created (17 findings, ledger, sweep, thresholds, OD-9, 7 proposed cards, 1 escalation record). 6 findings were then modified in Task 3. Every path is under `.planning/audit/`.

## Accomplishments

- **RC-13 is AUD-ANTIRUG-001 (S1 STRAND, confirmed, card OD-11).** Three paths each rewrite `ctx.wsProvider`: the detector's `handleWsClose` (detector.ts:916-944), the per-DEX loops in bot.ts (bot.ts:1552-1576 and :1593-1618), and the dashboard `onRestart`. As a result the rug-log subscription can vanish after a dashboard stop, be duplicated after a reconnect, or end up on a provider that nothing destroys. The trace covering a reconnect during a dashboard stop/start is on this entry. I read bot.ts and `src/api/routes/chains.ts` with `git show 23a6461:<path>`.
- **The other five S1 entries:**
  - **AUD-ANTIRUG-002:** a reconnect that cannot connect crashes the bot.
  - **AUD-ANTIRUG-003:** the breaker counts dispatches rather than rugs, so one rug can suppress every later anti-rug exit on that chain.
  - **AUD-ANTIRUG-004:** an escape that is refused, times out or fails is never retried.
  - **AUD-ANTIRUG-005:** backfill fires live exits, replays windows that were already handled, and skips the real outage after a long session.
  - **AUD-ANTIRUG-011:** after a restart, positions re-register with the first dex of their pool type, so exits can go through the wrong router.
- **Lifecycle traces:** all three written traces exist. The restart-after-trip trace (AUD-ANTIRUG-010, S2 LOSS) concludes, with evidence, that clearing the module-only breaker state on restart loses a protection; it is not an intended reset.
- **Deferred card OD-19:** the 7-day dry-run finding (AUD-ANTIRUG-009) carries `external_od_refs` `[{id: OD-19, owner_phase: "32"}]`. No local card was created. `raceTelemetry.ts` is production-dead (AUD-ANTIRUG-014, linked to card OD-9).
- **Thresholds, cards and escalation:** 20 AC-37 threshold rows; card OD-9; proposed cards ANTIRUG-01..07; record ESC-ANTIRUG-01.

## Task Commits

1. **Task 1: audit the ANTIRUG slice (findings, RC mapping, ledger, 20-class sweep).** `bcfe82f` (docs)
2. **Task 2: thresholds inventory, card OD-9, proposed cards.** `d5a0638` (docs)
3. **Task 3: record the ANTIRUG S1 area batch as ESC-ANTIRUG-01.** `911fbc5` (docs)

**Plan metadata:** in the SUMMARY commit and the STATE/ROADMAP commit that follow this file.

## Files Created/Modified

- `.planning/audit/findings/AUD-ANTIRUG-001..017.json`: the slice findings.
- `.planning/audit/ledger/ANTIRUG.json`: one row for each of the 8 slice files.
- `.planning/audit/sweep/ANTIRUG.json`: cells C01..C20, each with its search.
- `.planning/audit/thresholds/ANTIRUG.json`: rows TH-ANTIRUG-01..20.
- `.planning/audit/decisions/OD-9.json` and `decisions/proposed/ANTIRUG-01..07.json`: the decision cards.
- `.planning/audit/escalations/ESC-ANTIRUG-01.json`:
  - tier area-batch, date 2026-11-07;
  - items are the 6 S1 ids;
  - `operator_response` is "ackownledge continue", verbatim, with `operator_response_recorded_at` and `operator_response_channel` in the ESC-EXIT-01 shape;
  - `ruling` is "none" and `phase_continued` is true;
  - `ruling_note` holds the executor and orchestrator context, clearly attributed to them and not to the operator.

## Task 3 Record (ESC-ANTIRUG-01)

- **Operator reply (verbatim):** "ackownledge continue". I kept the typo exactly as typed.
- **How it was read:** as the `acknowledge-continue` option for all six S1 entries. No severity was changed, no decimal phase is inserted, and Phase 22 continues.
- **Context recorded as orchestrator context, not the operator's words:**
  - The executor had named AUD-ANTIRUG-002 as the strongest candidate for a decimal phase.
  - The orchestrator recommended acknowledge-continue because the bot stays off until the end of v7.0.
  - The orchestrator also noted that AUD-ANTIRUG-002 is already proven and should be among the first Phase 24 fixes.
- **Linking:** `escalation_ref` was set to ESC-ANTIRUG-01 on AUD-ANTIRUG-001, -002, -003, -004, -005 and -011. I edited the files directly with a temp-then-rename script and re-ran no generator. `git diff` showed exactly one changed line per finding.
- **Rediscoveries:** none of the ANTIRUG entries had been escalated before. AUD-ANTIRUG-011 is the anti-rug side of the dex-resolution defect that AUD-EXIT-013 records for the exit monitor (AUD-EXIT-013 went through ESC-EXIT-01). I presented AUD-ANTIRUG-011 as its own entry; whether to merge the two is for the 22-28 consolidation.

## Cross-Slice Answer for 22-28 (AUD-EXIT-014)

22-18 left AUD-EXIT-014 as a candidate because one question was open: does a refused rug escape fire again? The answer from code reading is **no, by design**. It recurs only in two cases:

- a new Burn, Transfer or Collect log arrives on the same pair or pool and evaluates as unsafe;
- a backfill replay happens to cover the original rug logs again. That needs a WS reconnect, or a new registration on the chain, with a gap within `maxBackfillBlocks`.

After a completed rug there are usually no further LP logs, so in practice the escape is lost. The evidence is AUD-ANTIRUG-004 sub_claim 1: detector.ts:1832-1842, :1900-1907, :1341-1396 and :1146-1159 at 23a6461. **22-28 should update AUD-EXIT-014's status.** AUD-EXIT-014 belongs to the EXIT slice, so I did not edit it here.

## AUD-ANTIRUG-002 Localhost Reproduction

The Task 1 executor ran a standalone `node -e` script on Node 22.16.0 from the repo root:

- It loaded only `ethers` from `node_modules` (ethers@6.16.0 with ws@8.17.1).
- It built `new WebSocketProvider('ws://127.0.0.1:1', 1)`. Port 1 on loopback refuses connections, so no network call left the machine.
- It attached a `close` handler to `p.websocket`.

**Result without an error listener:**

- It printed "constructed without throw".
- Then it printed "Unhandled 'error' event ... connect ECONNREFUSED 127.0.0.1:1 ... at emitErrorAndClose (ws/lib/websocket.js:1035)".
- The process exited with code 1.

**Result with an error listener added:** the same script printed "error handled: ECONNREFUSED", "close handler ran" and "still alive after 3s", and exited with code 0.

**What it did not touch:** it imported no `src/` code, so neither `src/utils/db.ts` nor any `src/db` module was loaded. It opened no SQLite database, did not read `data/` or `.env`, and did not touch any live data. It did not start the bot.

**Code-side evidence:** `git grep` at 23a6461 finds no error listener on any socket and no `uncaughtException` handler anywhere in `src`. ethers' `provider-websocket.js:25-51` sets only `onopen` and `onmessage`.

## Decisions Made

- I kept the operator reply byte-exact, typo included. Interpretation and recommendations sit only in `ruling_note`, with attribution, as ESC-EXIT-01 does.
- I did not create card OD-11. It belongs to 22-22. AUD-ANTIRUG-001, AUD-ANTIRUG-002 and TH-ANTIRUG-15 refer to it, and it shows as PENDING at stage partial.

## Deviations from Plan

### Verify-script mismatch (recorded, not auto-fixed)

**1. [Rule 3 - Blocking, resolved in favour of the authoritative tool] Task 1 verify expects `owner_phase` to be the number 32**
- **Found during:** Task 1, confirmed again in Task 3.
- **Issue:** the plan's Task 1 `<automated>` check tests `x.owner_phase===32`, a number. `check.ts:304` requires a non-empty string (`isStr(x?.owner_phase)`), so storing a number would fail the authoritative check. PROTOCOL.md says that if the protocol and a tool disagree, the tool decides and the disagreement is reported.
- **What I did:** `owner_phase` is stored as `"32"`. Run as written, the Task 1 verify fails with `{ n: 8, cells: 20, traces: 3, od19: false }`. It is the only condition that fails. The same script with `String(x.owner_phase)==='32'` prints `ANTIRUG ok 8 traces 3` and exits 0. The register itself is correct.
- **Files modified:** `.planning/audit/findings/AUD-ANTIRUG-009.json` (Task 1).
- **Follow-up:** the plan's verify text is defective, not the register. Later plans that check `external_od_refs` should compare the value as a string.

### PENDING count clarification (not a defect)

**2. The PENDING count after Task 3 is 3 lines, not 1; all three are card OD-11**
- **Issue:** the resume instruction expected exactly 1 PENDING (OD-11). check.ts prints one line per reference to the card: AUD-ANTIRUG-001.od_ref, AUD-ANTIRUG-002.od_ref and TH-ANTIRUG-15.od_ref. All three name the same card, OD-11, which 22-22 owns.
- **Before Task 3:** there were 9 PENDING lines (6 escalation lines plus 3 OD-11 lines). The earlier "7" counted the 6 escalations plus OD-11 as a single item.
- **After Task 3:** `RESULT PASS stage=partial slices=ANTIRUG fail=0 pending=3 warn=0`. No other PENDING item exists.

---

**Total deviations:** one verify-script mismatch recorded (no register change needed; the authoritative check.ts passes) and one count clarification.
**Impact on plan:** none on the register's correctness. No source code was changed, nothing was fixed, and every commit touches only `.planning/` (AC-33 / NAC-13).

## Verification

- `check.ts --stage partial --slice ANTIRUG`: PASS with fail=0, pending=3 (all OD-11) and warn=0.
- `render.ts --out "$(mktemp -d)"`: rendered AUDIT-FINDINGS.md (390,833 bytes) and OPERATOR-DECISIONS.md (53,002 bytes) with exit 0. ESC-ANTIRUG-01 appears 8 times and "Operator response: ackownledge continue" is rendered. The canonical renders were not staged.
- Task 1 verify as written: FAIL, only on the `od19` condition (deviation 1). With a string comparison: PASS (`ANTIRUG ok 8 traces 3`).
- Task 2 verify: PASS (`rows 20`).
- NAC-13 / AC-33: all paths in bcfe82f, d5a0638 and 911fbc5 are under `.planning/audit/`.

## Issues Encountered

None beyond the two items under Deviations.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- ANTIRUG slice data for AC-31/32/34/37/38/39 is complete at stage partial.
- 22-22 must create card OD-11, which clears the 3 PENDING lines.
- 22-28 should update AUD-EXIT-014 using the cross-slice answer above, consider merging AUD-ANTIRUG-011 with AUD-EXIT-013, and number the ANTIRUG proposed cards.
- 22-29 re-audits the `detector.ts` diff after 22-12 adds `registerSingleton`.
- Phase 23 and Phase 24: AUD-ANTIRUG-002 is proven and should be among the first Phase 24 fixes, proven in Phase 23 with a refused-connect test against a real socket.

## Self-Check: PASSED

- FOUND: `.planning/audit/escalations/ESC-ANTIRUG-01.json`, `ledger/ANTIRUG.json`, `sweep/ANTIRUG.json`, `thresholds/ANTIRUG.json`, `decisions/OD-9.json`, and all 17 `findings/AUD-ANTIRUG-*.json`.
- FOUND: commits bcfe82f, d5a0638 and 911fbc5 are ancestors of HEAD. `check evaluation-scope --plan 22-19 --commits-only` resolves all three.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
