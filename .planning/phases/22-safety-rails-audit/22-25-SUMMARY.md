---
phase: 22-safety-rails-audit
plan: 25
subsystem: audit
tags: [audit, scripts, contracts-tooling, root-configs, hardhat, process-lock, d-06, signer-exclusion, escalation]

requires:
  - phase: 22-safety-rails-audit (22-03, 22-04)
    provides: verified backup, audit register tooling (slice-files.ts, check.ts, render.ts), audit_base_sha 23a6461, PROTOCOL.md
provides:
  - AUD-SCRIPTS-001..010, AUD-CONTRACTS-001..004, AUD-ROOT-001..008 findings
  - ledgers SCRIPTS (10), CONTRACTS (8, .sol ledger-only), ROOT (19)
  - sweeps SCRIPTS and CONTRACTS (20 cells each), sweep contribution contrib-ROOT
  - thresholds SCRIPTS (13 rows + discovery)
  - proposed cards SCRIPTS-01 (signer exclusion, D-06 premise challenge), SCRIPTS-02, SCRIPTS-03
  - escalation record ESC-SCRIPTS-01 (operator ruling decide-in-phase-29)
affects: [22-26 signing-site census, 22-28 consolidation, 22-29 final check, Phase 24 BUY-01, Phase 29 HYG-03, Phase 30 OD-22 / Solidity review]

actuals:
  tokens: 37833
  tasks: 3
  commits: 3

plan_head_before: 97c7870e1ddc53aa6d8d55a7c66e4d4eb9a0464f
plan_head_after: d4a66f513b4492a5bb49e33f0a909ff9c9fb92be

tech-stack:
  added: []
  patterns:
    - "A premise challenge to a locked decision is put to the operator at a blocking checkpoint; if deferred, the card stays open with the operator's verbatim words in operator_input and the owning phase named in needed_by"

key-files:
  created:
    - .planning/audit/findings/AUD-SCRIPTS-001.json .. AUD-SCRIPTS-010.json
    - .planning/audit/findings/AUD-CONTRACTS-001.json .. AUD-CONTRACTS-004.json
    - .planning/audit/findings/AUD-ROOT-001.json .. AUD-ROOT-008.json
    - .planning/audit/ledger/SCRIPTS.json
    - .planning/audit/ledger/CONTRACTS.json
    - .planning/audit/ledger/ROOT.json
    - .planning/audit/sweep/SCRIPTS.json
    - .planning/audit/sweep/CONTRACTS.json
    - .planning/audit/sweep/contrib-ROOT.json
    - .planning/audit/thresholds/SCRIPTS.json
    - .planning/audit/decisions/proposed/SCRIPTS-01.json
    - .planning/audit/decisions/proposed/SCRIPTS-02.json
    - .planning/audit/decisions/proposed/SCRIPTS-03.json
    - .planning/audit/escalations/ESC-SCRIPTS-01.json
  modified: []

key-decisions:
  - "ESC-SCRIPTS-01: the operator acknowledged S1 AUD-SCRIPTS-002 (signing scripts outside the nonce lock and pause switch) with the verbatim reply 'Acknowledge. Decide in phase 29'; severity stays S1, no decimal phase, Phase 22 continues"
  - "The D-06 premise challenge (tryAcquireThenRelease releases the lock before the script signs, leaving a check-then-act race) is DEFERRED by the operator to the Phase 29 (HYG-03) discussion and is NOT resolved; card SCRIPTS-01 stays open; the D-06 wording in 22-CONTEXT.md is unchanged"
  - "The recommendation on record (card SCRIPTS-01 and the orchestrator, not the operator) is hold-lock: a signing script holds acquireProcessLock for its whole run and checks the pause state while holding it; query-then-sign is the option to avoid because it gives false assurance"
  - "Phase 29 must rule on SCRIPTS-01 together with card BUY-01 (Phase 24): if BUY-01 becomes handoff-to-running-bot no separate script signs for a deliberate buy; refuse-while-running-and-prompt matches hold-lock"
  - "No S0, rail, test-origin-db-row or non-public-secret item in SCRIPTS/CONTRACTS/ROOT: the Hardhat real .env load and the mainnet/sepolia DEPLOY_PRIVATE_KEY accounts are a recorded boundary (AUD-CONTRACTS-001, S2) that no test, fork or CI path reaches"

patterns-established:
  - "Deferred premise challenge: the escalation ruling names the option chosen (decide-in-phase-29) and says explicitly what is NOT decided; the card's needed_by names the owning phase and the cards it must be decided with"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05]

coverage:
  - id: D1
    description: "Scripts slice registered from code at the audit base: RC-27 mapped (AUD-SCRIPTS-001), every out-of-process signing site recorded by file:line including ContractFactory.deploy, side effects traced, ledger 10 rows, sweep 20 cells, thresholds 13 rows"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "check.ts --stage partial --slice SCRIPTS --slice CONTRACTS --slice ROOT + Task 1 <automated> node one-liner (SCRIPTS ok 10)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Contracts tooling and root configs registered: ledgers CONTRACTS (8) and ROOT (19) equal slice-files --check, .sol rows ledger-only, contracts sweep 20 cells, Hardhat .env and deploy-account boundaries recorded"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "Task 2 <automated> node one-liner (CONTRACTS+ROOT ok)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Signer-exclusion card SCRIPTS-01 (4 options, hold-lock recommended, check-then-act window of tryAcquireThenRelease stated) and operator ruling ESC-SCRIPTS-01 recorded; card stays open with operator_input verbatim"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "Task 3 acceptance node check (TASK3 ok) + check.ts --stage partial whole register: fail 0, pending 0, warn 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Quality of the audit judgement itself (severities, completeness of the side-effect traces, wording of the plain-language card)"
    verification: []
    human_judgment: true
    rationale: "Audit judgement is reviewed by the external reviewers in 22-27, consolidation in 22-28 and the final re-audit in 22-29; no automated check can grade it"

duration: 36min (this continuation; Tasks 1-2 ran in the previous executor session)
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 25: Scripts, Contracts Tooling and Root Configs Audit Summary

**Operator scripts, Hardhat/CI tooling and root configs audited from code at 23a6461 (22 findings, three ledgers, two sweeps, 13 thresholds, three cards); the one S1, signing scripts that bypass the bot's nonce lock and pause switch, is acknowledged, and the D-06 "check then let go" lock-query premise was challenged and left OPEN by the operator for Phase 29 to decide, with hold-the-lock recommended.**

## Performance

- **Duration:** 36 min for this continuation (2026-11-07T20:14:42Z to 2026-11-07T20:51:12Z); Tasks 1 and 2 ran in the previous executor session before the Task 3 checkpoint
- **Started:** 2026-11-07T20:14:42Z
- **Completed:** 2026-11-07T20:51:12Z
- **Tasks:** 3 of 3
- **Files created:** 33 (all under `.planning/audit/`; nothing outside `.planning/` changed, AC-33 / NAC-13)

## Accomplishments

- **Scripts slice (Task 1):** AUD-SCRIPTS-001..010. RC-27 maps to AUD-SCRIPTS-001 (S3: `addLiquidity.ts` and `deploySepoliaTest.ts` import artifacts of deleted Solidity sources, so they cannot load; behind the imports both would sign with the bot wallet on the ALCHEMY_URL network). AUD-SCRIPTS-002 (S1, LOSS) records every out-of-process signing site by file:line: `deliberate-buy.ts` through `src/bot.ts:558` and `:746-747`, `recover-sell-ladys.ts:70` and `:78-80`, `addLiquidity.ts:35-58`, and the `ContractFactory.deploy` calls in `deploySepoliaTest.ts:22/:32/:42/:52` plus `createPair` at `:61`. Side effects beyond transactions are traced, including the addresses-file write in `addLiquidity.ts`. Ledger 10 rows, sweep 20 cells, thresholds 13 rows with discovery.
- **Contracts tooling and root configs (Task 2):** AUD-CONTRACTS-001..004 and AUD-ROOT-001..008. The `hardhat.config.ts:9` real `.env` load and the mainnet/sepolia `DEPLOY_PRIVATE_KEY` accounts are recorded as a boundary (AUD-CONTRACTS-001, S2), with the 22-11 sanitized Hardhat child linked as the mitigation. No test, fork or CI path reaches a real-network signer, so nothing was a rail stop. `.sol` rows are ledger-only (Solidity logic review is Phase 30). The CONTRACTS ledger has 8 rows and the ROOT ledger 19. The contracts sweep has 20 cells, and root findings go through `sweep/contrib-ROOT.json`.
- **Operator ruling (Task 3):** ESC-SCRIPTS-01 records the verbatim reply "Acknowledge. Decide in phase 29". **What this settles:** AUD-SCRIPTS-002 is acknowledged and stays S1, no decimal phase is inserted, and Phase 22 continues. **What it does not settle:** the D-06 premise challenge is deferred to Phase 29 (HYG-03). It is NOT resolved. Card SCRIPTS-01 stays `open`, and D-06's wording in 22-CONTEXT.md is unchanged. The hold-lock recommendation stays on record. The card's `operator_input` holds the operator's words verbatim. Its `needed_by` / `decision_owner` names the Phase 29 HYG-03 discussion as the owner and cross-references card BUY-01.

## Task Commits

1. **Task 1: Audit scripts/: RC-27, out-of-process signers, side effects, ledger, sweep, thresholds, signer-exclusion card** - `a524ee0` (docs)
2. **Task 2: Audit contracts tooling and root configs** - `97c7ae5` (docs)
3. **Task 3: Record operator ruling ESC-SCRIPTS-01 (S1 acknowledged, D-06 question left to Phase 29)** - `d4a66f5` (docs)

**Plan metadata:** recorded in the final docs commit for this plan (SUMMARY + STATE + ROADMAP)

## Files Created/Modified

- `.planning/audit/findings/AUD-SCRIPTS-001..010.json`: scripts findings (RC-27, the S1 signers, recovery-sell slippage, deliberate-buy guards, crash-output RPC key, telegram session output, preflight DB writes, pause/resume CLI limits, fixture writer, empty-file hook)
- `.planning/audit/findings/AUD-CONTRACTS-001..004.json`: Hardhat boundaries, CI gate gaps, Mythril gate fail-open on an empty report, deploy wrapper key/fee handling
- `.planning/audit/findings/AUD-ROOT-001..008.json`: `--legacy-peer-deps` cause, all-project test scripts, scripts outside every tsconfig, `.env.example` drift, tracked junk, ungated ESLint, package metadata, README drift
- `.planning/audit/ledger/SCRIPTS.json`, `CONTRACTS.json`, `ROOT.json`: per-file rows (10 / 8 / 19)
- `.planning/audit/sweep/SCRIPTS.json`, `CONTRACTS.json`, `contrib-ROOT.json`: C01..C20 cells with searches
- `.planning/audit/thresholds/SCRIPTS.json`: 13 AC-37 rows (DELIBERATE_BUY_SLIPPAGE_PCT, DELIBERATE_BUY_PRIVATE_ATTEMPTS, DELIBERATE_BUY_GAS_BUFFER, script fee/gas/timeout constants) plus discovery
- `.planning/audit/decisions/proposed/SCRIPTS-01.json`: signer-exclusion card (open; operator_input, Phase 29 owner, BUY-01 cross-reference added in Task 3); `SCRIPTS-02.json`, `SCRIPTS-03.json`: other behaviour-changing recommendations
- `.planning/audit/escalations/ESC-SCRIPTS-01.json`: area-batch record, items [AUD-SCRIPTS-002], ruling decide-in-phase-29, phase_continued true
- `.planning/audit/findings/AUD-SCRIPTS-002.json`: `escalation_ref` set to ESC-SCRIPTS-01 (Task 3)

## Decisions Made

- **D-06 premise: challenged, then DEFERRED by the operator to Phase 29. Not resolved.** The challenge: `tryAcquireThenRelease` (D-06's "query API for Phase 29 scripts") lets go of the lock before the script signs, so the bot can start in that gap. Card SCRIPTS-01 and the orchestrator recommend hold-lock: the script holds `acquireProcessLock` for its whole run and checks the pause state while holding it. The operator gave no preference among the options. Phase 29 must rule on it before the HYG-03 script changes are planned.
- **Orchestrator context, recorded in ESC-SCRIPTS-01 `ruling_note` and attributed to the orchestrator, not the operator:**
  - The orchestrator called hold-lock the only option that closes the race. It added that the scripts are rare one-off tools, so "stop the bot first" costs little.
  - hold-lock matches BUY-01's refuse-while-running-and-prompt option. If BUY-01 becomes handoff-to-running-bot, no separate script signs at all for the deliberate buy.
  - query-then-sign is the option to avoid, because it gives false assurance.
- **Decision order:** BUY-01 is owned by the Phase 24 capital discussion, which comes before Phase 29. Phase 29 therefore decides SCRIPTS-01 with the BUY-01 outcome known.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Card `operator_input` stored as a string, Phase 29 owner placed in the rendered `needed_by`**
- **Found during:** Task 3
- **Issue:** I first wrote `operator_input` as an object. `render.ts:421` prints `operator_input` with `inline()`, which would show an object as raw JSON. `render.ts` also does not print new fields such as `decision_owner`, so the Phase 29 owner and the BUY-01 link would not have appeared in OPERATOR-DECISIONS.md.
- **Fix:** `operator_input` is now one string: the operator's words verbatim in quotes, then where they came from and what they mean. `needed_by`, which is rendered, now names the Phase 29 HYG-03 discussion as the decision owner and BUY-01 (still open, Phase 24) as the card to decide it with. `decision_owner`, `related_cards` and an appended `premise_challenge` sentence remain as extra, unrendered detail. I also reworded the first draft's "BUY-01 (decided earlier ...)" to "still open; owned by the Phase 24 capital discussion", so it does not suggest BUY-01 is already decided.
- **Files modified:** `.planning/audit/decisions/proposed/SCRIPTS-01.json`
- **Verification:** render dry run shows the Operator input and Needed-by lines; check.ts partial PASS
- **Committed in:** d4a66f5

**2. [Rule 1 - Bug] JSON indentation restored to the register's 2-space style**
- **Found during:** Task 3
- **Issue:** My first write used 4-space indentation, which turned a one-line change into a whole-file rewrite of AUD-SCRIPTS-002 and SCRIPTS-01.
- **Fix:** Rewrote the three files atomically with 2-space indentation before committing (`git diff -w` and the plain diff now match: 2 lines in the finding, the card fields only)
- **Files modified:** ESC-SCRIPTS-01.json, AUD-SCRIPTS-002.json, SCRIPTS-01.json (before commit)
- **Committed in:** d4a66f5

**3. [Plan file list] `sweep/contrib-ROOT.json` is not in the plan's `files_modified`**
- **Found during:** Task 2 (previous executor)
- **Issue:** The plan says root-config findings go in "the cell of the area they affect", but ROOT has no sweep file of its own, and PROTOCOL section 3 names `sweep/contrib-<NAME>.json` as the way to do that.
- **Fix:** Root findings were placed through `sweep/contrib-ROOT.json`, as PROTOCOL requires. It is still under `.planning/audit/`.
- **Committed in:** 97c7ae5

---

**Total deviations:** 3 (1 blocking, 1 bug, 1 plan file-list gap). **Impact on plan:** none on audit content. Each one makes the record render correctly or follows PROTOCOL. No scope creep, and nothing outside `.planning/` changed.

## Issues Encountered

None. Every verify passed on its first real run: check.ts partial on the three slices and on the whole register, the Task 1 and Task 2 automated one-liners, the Task 3 acceptance check, and the render dry run to a temp folder. The canonical AUDIT-FINDINGS.md / OPERATOR-DECISIONS.md were not staged, as the parallel-writer rule requires.

## Verification Results

- `check.ts --stage partial --slice SCRIPTS --slice CONTRACTS --slice ROOT`: `RESULT PASS fail=0 pending=0 warn=0` (the pending item from the checkpoint, AUD-SCRIPTS-002's missing escalation_ref, is now cleared)
- `check.ts --stage partial` (whole register): `RESULT PASS fail=0 pending=0 warn=0`
- Task 1 verify: `SCRIPTS ok 10`; Task 2 verify: `CONTRACTS+ROOT ok`
- Task 3 acceptance: ESC-SCRIPTS-01 is area-batch and dated 2026-11-07. It lists every S0/S1/rail finding of the three slices (only AUD-SCRIPTS-002), and that finding's escalation_ref points back to it. operator_response and ruling contain the verbatim words, and phase_continued is true. Card SCRIPTS-01 is `status: open` with `decided: null`, its operator_input is verbatim, and needed_by names Phase 29 and BUY-01.
- `render.ts --out <mktemp>`: rendered AUDIT-FINDINGS.md (1,124,142 bytes) and OPERATOR-DECISIONS.md (99,447 bytes) without error

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- **Pending operator decision for Phase 29 (HYG-03):** rule on card SCRIPTS-01, which asks how signing scripts keep out of the running bot's way. Decide it together with BUY-01 (Phase 24) before planning the script changes. hold-lock is the recommendation on record. As an S1 capital item, AUD-SCRIPTS-002 cannot rest on the keep-current default, and it blocks the live re-entry gate until it is decided and fixed.
- **For 22-26:** the signing-site census should include the script signing sites recorded in AUD-SCRIPTS-002, including the ContractFactory.deploy calls.
- **For 22-28:** fold in `sweep/contrib-ROOT.json` and number cards SCRIPTS-01..03.
- **For 22-29:** re-audit the diffs of `scripts/pause.ts`, `resume.ts`, `preflight.ts`, `vitest.config.ts`, `package.json`, `.gitignore` and the tsconfigs.

## Self-Check: PASSED

- All created files listed above exist on disk: 22 findings, 3 ledgers, 3 sweep files, 1 thresholds file, 3 proposed cards and 1 escalation record, 33 in total.
- Commits a524ee0, 97c7ae5 and d4a66f5 are ancestors of HEAD. The measured count from the ledger base 97c7870 is 3.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
