---
phase: 22-safety-rails-audit
plan: 23
subsystem: testing
tags: [audit, test-quality, vitest, d-20, register]

requires:
  - phase: 22-03
    provides: verified backup (audit wave may start)
  - phase: 22-04
    provides: audit register tooling (slice-files.ts, check.ts, render.ts, PROTOCOL.md)
provides:
  - D-20 quality label on all 84 test/unit files at audit_base_sha 23a6461 (ledger/TESTU.json)
  - 23 AUD-TESTU findings (1 S1 rediscovery, 15 S2, 6 S3, 1 S4)
  - complete 20-class sweep for area test from the TESTU slice (sweep/TESTU.json)
  - RC-19 rediscovery link (ESC-PRE-03 resolved_items += AUD-TESTU-001)
affects: [22-24, 22-28, 22-29, phase-23, phase-24, phase-28]

actuals:
  tokens: 48520
  tasks: 2
  commits: 2
plan_head_before: 80ea93c865a44e155b65ac78fd557ae33aaaf806
plan_head_after: 73ea438c4443ea7edb2f42854e4422c6efd3b599

tech-stack:
  added: []
  patterns:
    - "Static reach analysis: import graph over a git archive of src plus every vi.mock / vi.doMock target, text-only, never executing code"
    - "Escaped-regression grading: each S0-S2 test-quality finding names a concrete src edit that leaves the test green"

key-files:
  created:
    - .planning/audit/ledger/TESTU.json
    - .planning/audit/sweep/TESTU.json
    - .planning/audit/findings/AUD-TESTU-001.json .. AUD-TESTU-023.json
  modified:
    - .planning/audit/escalations/ESC-PRE-03.json

key-decisions:
  - "22-23: AUD-TESTU-001 (24 unit files reached the live DB, the real .env values or the notifier before the rails) is S1 RC-19 sibling evidence, related AUD-RAIL-002, escalation_ref ESC-PRE-03 (added to its resolved_items); not escalated again and not tagged rail. No new rail-class reach exists in test/unit (no spawn, worker_threads, dgram or non-loopback host)"
  - "22-23: no ESC-TESTU record and no area-batch checkpoint: the only TESTU S1 is that rediscovery, and PROTOCOL section 4 says a rediscovery is never escalated twice"
  - "22-23: the green unit suite would NOT catch these registered S0/S1s on the real path: AUD-BUY-001 (TESTU-006), AUD-BUY-002 (TESTU-009, -014), AUD-EXIT-002 (TESTU-006, -007), AUD-EXIT-013/-015 (TESTU-005), AUD-ANTIRUG-004 and AUD-TX-002/AUD-EXIT-009 (TESTU-002), AUD-DB-002/-003 (TESTU-017), AUD-BUY-006 (TESTU-021); no unit test claims AUD-ANTIRUG-002 or AUD-TX-009 at all"
  - "22-23: the exact INT-NONCE-SELL regression (exitEngine.ts:909 calling escalatePrivateSell unlocked) stays green across sellNonceLock, antiRugReason Test 9 and exitInclusionLadder Test 6 (TESTU-003/-004); Phase 23/28 should RED-prove it first"
  - "22-23: @ts-expect-error compile gates (anti-rug/types, honeypotTypes) never run: no tsconfig includes test/ and Vitest does not type-check (TESTU-008)"
  - "22-23: RC-28 is owned by TESTI (22-24); TESTU links it as rc:RC-28 on TESTU-017/-018/-019"

patterns-established:
  - "Per-case quality labels for mixed files (11 files labelled partial with cases)"

requirements-completed: [AUDIT-01, AUDIT-03]

coverage:
  - id: D1
    description: "Every test/unit file at the base SHA has a ledger row with a D-20 quality label; ledger equals the slice-files.ts enumerator (84)"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice TESTU (PASS, fail=0, pending=0) + plan Task 2 verify one-liner (TESTU ok 84)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Money-path unit tests (bot, exitEngine, anti-rug, mevStrategies; 35 files) labelled with findings that name affected cases and an escaped regression"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "plan Task 1 verify one-liner (labelled 35)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TESTU 20-class sweep for area test, every cell with ids or checked-none and a search"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "plan Task 2 verify one-liner (20 cells, area test, all searches set)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Correctness of the per-file judgements (whether each test would catch the named defect) and the severity grades"
    verification: []
    human_judgment: true
    rationale: "Static reading only (the plan forbids running Vitest); each escaped regression is reasoned from code, to be RED-proven in Phase 23/28"

duration: ~30min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 23: Unit Test Audit (TESTU) Summary

**All 84 unit test files labelled for D-20: 23 findings show the green unit suite would let 11 registered S0/S1 money-path defects through, mostly because the tests mock or copy the very mechanism (nonce lock, resume SQL, risk SQL, migrations) or assert from inside a process the production caller exits.**

## Performance

- **Started:** 2026-11-07T18:50Z
- **Completed:** 2026-11-07T19:20Z
- **Tasks:** 2 of 2
- **Files:** 26 (all under .planning/audit/)

## Accomplishments

- Ledger `ledger/TESTU.json`: 84 rows (same list as `slice-files.ts --check TESTU`). 70 files `mocks_mechanism: no`, 11 `partial` (with per-case labels), 3 `yes`; 5 hollow; 24 could reach real state before the rails; 37 rows have no finding.
- Findings, by what they would let through on the real path:
  - **Nonce lock:** AUD-TESTU-003 (the lock is mocked as a pass-through and only calls are counted) and -004 (only the seams are tested, not the call sites). The INT-NONCE-SELL regression passes all three related tests.
  - **Liveness:** AUD-TESTU-002. A hung sell keeps the wallet lock while the watchdog and anti-rug-bound tests pass (AUD-EXIT-009, AUD-TX-002, AUD-ANTIRUG-004).
  - **Restart and arming:** AUD-TESTU-005 (resume SQL mocked; dex and amount never asserted), -006 (deliberate-buy arming is tested in-process, but the script exits right after the buy: AUD-BUY-001 S0), -007 (a misnamed case that pins AUD-EXIT-002), -016 (only the thrown-error failure path is tested: AUD-EXIT-007).
  - **Buy rows:** AUD-TESTU-009 (an in-test copy of the persistence code) and -014 ("zero ETH spent" asserted from a mocked throw). Both hide AUD-BUY-002.
  - **Risk and DB:** AUD-TESTU-017 (the risk SQL runs as copies on decimal fixtures, hiding AUD-DB-002/-003), -019 (migrations run as replicas), -018 (the helper schema is pinned at v4), -010 (a copied COALESCE SQL), -023 (a mock on a path that does not exist).
  - **Other:** AUD-TESTU-008 (type gates that never compile), -012 (the anti-rug gas wiring is only checked with regexes), -020 (chainRestart is fully hollow), -021 (allowlist tests pin AUD-BUY-006), -011 (the sell-ceiling config is checked on a code path production never takes), -022 (dashboard tests are text greps), -015 (environment variables leak between test files), -013 (hygiene).
- Sweep `sweep/TESTU.json`: 20 cells, area `test`, each with a recorded search.

## Task Commits

1. **Task 1: money-path unit tests (35 files)**: `5f29bbe` (docs)
2. **Task 2: remaining 49 files, sweep and ledger completed**: `73ea438` (docs)

## Decisions Made

See key-decisions. The main one: AUD-TESTU-001 is S1 and links to ESC-PRE-03 as a rediscovery, so there is no new escalation and no area checkpoint (PROTOCOL section 4).

## Deviations from Plan

**1. [Rule 3 - Blocking] ESC-PRE-03.json edited (not in files_modified)**
- **Found during:** Task 1
- **Issue:** The plan requires the real-state-reach finding to carry `escalation_ref` ESC-PRE-03. check.ts (:652) fails unless that record lists the finding.
- **Fix:** Added `AUD-TESTU-001` to the empty `resolved_items` with a format-preserving one-line edit. `items` is unchanged, which follows the ESC-PRE-02 rediscovery pattern.
- **Files modified:** .planning/audit/escalations/ESC-PRE-03.json
- **Commit:** 5f29bbe

**2. [Rule 3 - Blocking] No area-batch S1 checkpoint**
- **Issue:** The plan says to present any TESTU S1 at a blocking checkpoint and record ESC-TESTU-NN. The only S1 is a rediscovery, and PROTOCOL section 4 forbids escalating it twice.
- **Fix:** No ESC-TESTU record and no checkpoint. It is listed here as "already escalated (ESC-PRE-03)".

**3. [Process] Required-reading SUMMARYs not read**
- The orchestrator listed the 22-04, 22-08 and 22-17..22-22 SUMMARYs. The plan's P9 rule says never to read phase SUMMARYs. The registered S0/S1 findings were read straight from `.planning/audit/findings/*.json` instead. The rail tests under test/unit/rails/ were added after the base SHA, are outside the TESTU slice at the base (22-29 covers them), and were not labelled.

**Total deviations:** 2 blocking-rule adjustments and 1 process note. **Impact:** none on scope; all register rules hold.

## Known Stubs

None.

## Threat Flags

None. The audit changes only `.planning/audit/` (AC-33: 0 files outside `.planning/` in 80ea93c..HEAD).

## Next Phase Readiness

- 22-24 (TESTI) owns RC-28. TESTU-017/-018/-019 reference it as `rc:RC-28` until 22-28 consolidates.
- 22-28 should fold TESTU into the `test` column. Every finding id is already in the cell of each of its classes.
- Phase 23/28: RED-prove TESTU-003/-004 (INT-NONCE-SELL), -017 (AUD-DB-002) and -006 (AUD-BUY-001) first.

## Self-Check: PASSED

- FOUND: .planning/audit/ledger/TESTU.json, .planning/audit/sweep/TESTU.json, AUD-TESTU-001..023 (23 files)
- FOUND: commits 5f29bbe and 73ea438 are ancestors of HEAD
- check.ts --stage partial --slice TESTU: PASS (fail=0, pending=0). Task 1 and Task 2 verify one-liners pass. render.ts to a temp dir succeeded, and the canonical renders were not touched.
