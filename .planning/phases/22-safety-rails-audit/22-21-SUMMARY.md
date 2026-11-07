---
phase: 22-safety-rails-audit
plan: 21
subsystem: audit
tags: [audit, sqlite, risk-limits, env-parsing, escalation, thresholds]

requires:
  - phase: 22-03
    provides: verified off-machine backup (SAFE-01) and the bot-off baseline
  - phase: 22-04
    provides: audit register, slice-files enumerator, check.ts / render.ts, audit_base_sha 23a6461
provides:
  - AUD-DB-001..019 findings for the DB/risk/config slice (5 S1, 6 S2, 8 S3) with RC-06, RC-14, RC-23 and RC-25 mapped
  - ledger/DB.json (7 slice files at the base SHA) and sweep/DB.json (20 class cells)
  - thresholds/DB.json in {rows, discovery} form (24 rows TH-DB-01..24, 114 env reads mapped)
  - cards OD-10, OD-18, OD-25 and proposed cards DB-01..06
  - ESC-DB-01 area-batch record (operator acknowledge-continue)
affects: [22-28, 22-29, phase-23, phase-24]

actuals:
  tokens: 52700
  tasks: 3
  commits: 3
plan_head_before: 79b66eb2e8c7af1162a7ed52e27ef5b530e418ec
plan_head_after: 598dc45e48c288cf2dd61eea305cae0376774951

tech-stack:
  added: []
  patterns:
    - "Orchestrator context recorded on an escalation or card is labelled as orchestrator-supplied, never as the operator's words (ESC-DB-01 ruling_note, OD-25 recommendation)"
    - "Offline repros run from a scratch folder outside the repo with fake values, loopback-only network and no src/ import, so the live DB path is never resolved"

key-files:
  created:
    - .planning/audit/findings/AUD-DB-001.json .. AUD-DB-019.json
    - .planning/audit/ledger/DB.json
    - .planning/audit/sweep/DB.json
    - .planning/audit/thresholds/DB.json
    - .planning/audit/decisions/OD-10.json
    - .planning/audit/decisions/OD-18.json
    - .planning/audit/decisions/OD-25.json
    - .planning/audit/decisions/proposed/DB-01.json .. DB-06.json
    - .planning/audit/escalations/ESC-DB-01.json
  modified: []

key-decisions:
  - "ESC-DB-01: operator replied 'Acknowledge continue' to the DB S1 batch (AUD-DB-002, -003, -004, -001, -007). No severity change, no decimal phase, Phase 22 continues"
  - "Orchestrator context (not the operator's): AUD-DB-002 (risk SQL mixes decimal ETH buy amounts with wei sell and gas amounts) should be first in line in Phase 23/24. Card OD-25 has to be decided assuming today's daily-loss and exposure limits do not work"
  - "AUD-DB-007 (cwd-relative DB_PATH creates a fresh DB) and AUD-DB-006 (RC-25, no newer-schema guard) are being closed by rail 22-09; 22-29 re-audits the db.ts diff"
  - "AUD-DB-009 (Telegram token in logs) and AUD-DB-010 (RPC URL with API key in Telegram alert) are S2 secret-handling items for Phase 24 (card TX-04), shown to the operator"

patterns-established:
  - "Area-batch escalation shape follows ESC-TX-01: verbatim operator_response, operator_response_recorded_at/channel, ruling none, ruling_option_text, attributed ruling_note"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "DB slice findings AUD-DB-001..019 with RC-06/14/23/25 mapped, none NOT-A-BUG, RC-06 per-site sub-claims (16 sites)"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice DB (fail 0, pending 0) + plan Task 1 verify (DB ok 7, RC-06 sites 16)"
        status: pass
    human_judgment: true
    rationale: "The schema and coverage checks pass, but whether each finding's severity and mechanism are right is audit judgment that 22-28 consolidation and Phase 23 real-path proofs confirm"
  - id: D2
    description: "Ledger (7 files == slice-files --check DB) and 20-cell sweep with searches"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "plan Task 1 verify node one-liner"
        status: pass
    human_judgment: false
  - id: D3
    description: "Thresholds inventory (24 AC-37 rows incl. the five OD-25 risk defaults, discovery of 114 env reads each mapped to a row or exclusion)"
    requirement: AUDIT-04
    verification:
      - kind: other
        ref: "plan Task 2 verify node one-liner (exit 0) + direct count rows=24, env_reads=114"
        status: pass
    human_judgment: false
  - id: D4
    description: "Cards OD-10, OD-18, OD-25 (>= 2 options incl. keep-current with risk) and proposed DB-01..06"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice DB (NAC-12) + plan Task 2 verify"
        status: pass
    human_judgment: false
  - id: D5
    description: "ESC-DB-01 area-batch record listing every DB S1 id with verbatim reply, every S1 finding linked by escalation_ref"
    verification:
      - kind: other
        ref: "Task 3 acceptance node check (items == S1 set, escalation_ref set on S1 only, ok true) + check.ts pending 0"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 21: DB/Risk/Config Slice Audit Summary

**Read-only audit of the DB/risk/config slice at 23a6461 found 19 entries. 5 are S1. The worst, AUD-DB-002: the daily-loss breaker and exposure cap subtract wei sell amounts from decimal-ETH buy amounts, so normal losses never trip the breaker (reproduced offline on an in-memory SQLite). The S1 batch was escalated as ESC-DB-01, and the operator replied "Acknowledge continue".**

## Performance

- **Duration:** 35 min (2026-11-07T17:09:02Z to 2026-11-07T17:44:05Z, including the operator wait at Task 3)
- **Started:** 2026-11-07T17:09:02Z
- **Completed:** 2026-11-07T17:44:05Z
- **Tasks:** 3
- **Files:** 33 created, 0 changed outside `.planning/audit/` (the Task 3 edits went to files this plan had created)

## Accomplishments

- **Findings (AUD-DB-001..019).** 5 S1, 6 S2 and 8 S3, no S0, every one at `audit_base_sha` 23a6461.
  - **RC mapping:** RC-06 is AUD-DB-001, with 16 per-site sub-claims that keep fail-open and fail-closed separate. RC-14 is AUD-DB-004, RC-23 is AUD-DB-005 and RC-25 is AUD-DB-006. None is NOT-A-BUG.
  - **Shared database across wallets:** two bots with different wallets sharing one `data/bot.db` is its own entry (AUD-DB-015). It is kept separate from the same-wallet process lock that 22-13 adds.
- **Ledger and sweep.** The ledger has 7 rows, matching `slice-files.ts --check DB`. The sweep has 20 cells. Twelve read "checked, none" with their searches: C04-C12, C16 and C19 (eleven) plus C10. Findings sit under C01-C03, C13-C15, C17, C18 and C20.
- **Thresholds.** 24 AC-37 rows (TH-DB-01..24), covering:
  - the five OD-25 risk defaults with every definition site, flagged where the sites disagree;
  - the per-chain capital, size, gas, tax and block-age defaults;
  - preflight and staleness thresholds, SIGINT grace, `busy_timeout` and `synchronous`.
  - The discovery section maps all 114 env reads (static reads and template expansions) to a row or an exclusion.
- **Cards.** OD-10 (honor LOG_LEVEL), OD-18 (write-ahead buy intent row plus `synchronous=FULL`, schema 7 to 8) and OD-25 (risk defaults and parsing). Proposed cards DB-01..06.
- **ESC-DB-01.** The area-batch record, with the operator's verbatim reply. Its ruling note carries the orchestrator's context, labelled as such. OD-25 gained the orchestrator caution that changing the limit values does nothing until AUD-DB-002 and AUD-DB-003 are fixed.

## Task Commits

1. **Task 1: Audit the DB slice (findings, RC mapping, ledger, 20-class sweep)** - `8dd576b` (docs)
2. **Task 2: Thresholds inventory, cards OD-10, OD-18, OD-25, proposed DB-01..06** - `1bac594` (docs)
3. **Task 3: DB area S1 batch, ESC-DB-01 record and escalation links** - `598dc45` (docs)

**Plan metadata:** recorded in the final docs commit for this plan.

## Files Created/Modified

- `.planning/audit/findings/AUD-DB-001..019.json`: DB slice findings. Task 3 set `escalation_ref: ESC-DB-01` on 001, 002, 003, 004 and 007.
- `.planning/audit/ledger/DB.json`: one coverage row per slice file.
- `.planning/audit/sweep/DB.json`: C01..C20 cells, each with a search.
- `.planning/audit/thresholds/DB.json`: `{rows, discovery}` with 24 rows and 114 env reads.
- `.planning/audit/decisions/OD-10.json`, `OD-18.json`, `OD-25.json`: the owned cards. Task 3 appended the attributed caution to OD-25's recommendation.
- `.planning/audit/decisions/proposed/DB-01..06.json`: proposed cards.
- `.planning/audit/escalations/ESC-DB-01.json`: the area-batch escalation record.

## Decisions Made

- **The operator's reply.** "Acknowledge continue" (verbatim), interpreted as option `acknowledge-continue` for all five S1 entries. No severity change, no decimal phase, and the phase continues.
- **Orchestrator context, recorded in ESC-DB-01 `ruling_note` and attributed to the orchestrator, not the operator:**
  - AUD-DB-002 goes first in Phase 23/24.
  - The orchestrator independently confirmed that the risk SQL at `src/utils/db.ts:425-459` subtracts `amount_in` from `amount_out` and the gas costs with no unit conversion.
  - OD-25 must be decided treating today's daily-loss and exposure limits as not working.
  - AUD-DB-009 and AUD-DB-010 were highlighted as Phase 24 secret-handling items.
- **Where the OD-25 caution went.** It was added to the recommendation text, following the TX-04 precedent from 22-20. PROTOCOL's card schema has no orchestrator-note key, and `operator_input` is reserved for the operator. The text says it is not an operator ruling and selects no option (NAC-12).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Thresholds file written in `{rows, discovery}` form**
- **Found during:** Task 2
- **Issue:** The Task 2 verify reads `t.discovery`, which only exists in the object form. Its last line prints `console.log('rows', t.length)`, and `t.length` is undefined on an object, so it prints `rows undefined` but exits 0.
- **Diagnosis:** This is a print bug in the plan's verify, not missing data. The same verify counts rows from `t.rows`, and a direct count gives 24 rows and 114 env reads. The orchestrator confirmed this independently. PROTOCOL section 3 accepts both forms.
- **Files modified:** `.planning/audit/thresholds/DB.json`
- **Committed in:** `1bac594`

**2. [Process] Tracer step done as one pass**
- **Found during:** Task 1 (`type="tracer"`)
- **Issue:** The plan asked to register RC-06 end to end first, then expand. RC-06 was registered with its finding, ledger row and sweep cells, then the other entries in the same pass.
- **Mitigation:** The tracer verify (check.ts plus the Task 1 one-liner) was re-run and passed before Task 2 started. A failing tracer would have halted expansion. Committed as one Task 1 commit (`8dd576b`).

### Offline repros (evidence for AUD-DB-002, -009, -010)

All three ran with Node 22.16.0 from the orchestrator scratchpad `dbrepro/`, outside the repo. None reads `.env`, none imports `src/`, so `src/utils/db.ts` never resolves the live `DB_PATH`, and none opens or touches `data/`. Every value is fake.

- **`risk-sql-repro.js`:** no network at all.
  - It reads the audit-base snapshot `src/utils/db.ts` as text and extracts the SQL of `getDailyRealizedLoss`, `getTotalExposure` and `getPnLQuery` verbatim.
  - It runs that SQL on a throwaway `':memory:'` SQLite through the repo's better-sqlite3, with fake trade rows in the formats the insert sites write.
  - Result: 25 trades sold at a 50% loss give an SQL daily loss of 0. One 0.006 ETH partial sell makes exposure -6e15.
- **`tg-log-repro.js`:**
  - It uses the repo's axios 1.10.0 and pino 10.3.1 with the `logger.ts` options, and a fake sentinel token.
  - It POSTs to `127.0.0.1:1` (loopback, refused).
  - Result: the fake token appears in the logged `err.config.url`.
- **`rpc-reason-repro.js`:**
  - It uses the repo's ethers 6.16.0 against a loopback JSON-RPC server that answers `eth_chainId` and then HTTP 500, with a fake API key in the URL path.
  - Result: the preflight-style failure reason contains the key.

---

**Total deviations:** 2 (1 blocking output-format choice with a diagnosed verify print bug, 1 tracer execution-order note)
**Impact on plan:** None on scope. All files are under `.planning/audit/` (AC-33 / NAC-13), and nothing in the source was changed or fixed.

## Issues Encountered

- **Task 2 verify prints `rows undefined`.** This is the plan's print bug, diagnosed under Deviation 1. It is not a data problem, and the real count is 24 rows.
- **`ESC-DB-01` timestamps.** `presented_at` is anchored to commit `1bac594` (2026-11-07T17:32:30Z). `operator_response_recorded_at` is the moment this continuation wrote the record.

## Verification

- **check.ts:** `check.ts --stage partial --slice DB` gives `RESULT PASS stage=partial slices=DB fail=0 pending=0 warn=0`. Before Task 3 it showed 5 PENDING, one escalation_ref per S1.
- **render.ts:** `render.ts --out "$(mktemp -d)"` rendered both files, and ESC-DB-01 appears in them. The canonical `AUDIT-FINDINGS.md` and `OPERATOR-DECISIONS.md` were neither changed nor staged.
- **Plan verifies:**
  - Task 1 printed `DB ok 7 RC-06 sites 16` and exited 0.
  - Task 2 exited 0 (it prints `rows undefined`, see Deviation 1).
  - The Task 3 acceptance check printed `ok: true`: `items` equals the S1 set, `escalation_ref` points to ESC-DB-01 on every S1 finding, and non-S1 findings stay null.
- **Paths:** `git diff --name-only 79b66eb..HEAD` lists only `.planning/audit/` paths.

## User Setup Required

None. No external service configuration is needed.

## Next Phase Readiness

- **22-28 (consolidation):**
  - Number proposed cards DB-01..06.
  - Resolve the threshold rows owned by other slices that the discovery section names.
  - Fold in the cross-slice links: AUD-DB-002 with AUD-TX-015, and AUD-DB-003 with AUD-BUY-002.
- **22-29:** re-audit the 22-09 rail diff in `db.ts`, which closes AUD-DB-007 and AUD-DB-006.
- **Phase 23:** AUD-DB-002 is first in line for a real-path proof (orchestrator context).
- **Phase 24:**
  - Card DB-01, the risk accounting, comes before OD-25, the values.
  - OD-18 covers the buy intent row.
  - TX-04 covers the secret redaction in AUD-DB-009 and AUD-DB-010.
- **Blockers:** none for the remaining Phase 22 plans. The bot stays OFF.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*

## Self-Check: PASSED
