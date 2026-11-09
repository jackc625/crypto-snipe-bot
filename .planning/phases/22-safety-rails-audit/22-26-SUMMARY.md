---
phase: 22-safety-rails-audit
plan: 26
subsystem: audit
tags: [audit, secrets, betterleaks, git-history, signing-census, typescript-compiler-api, nonce-lock, d-nonce-authority-all]

requires:
  - phase: 22-02
    provides: verified betterleaks 1.10.0 binary, fixture-proven configs (FIXTURES.json), network boundary, ESC-SECRET-01 public-address ruling
  - phase: 22-03
    provides: off-machine backup copy scan and operator exact-value result (safe01-offmachine.json)
  - phase: 22-04
    provides: audit register schema, check.ts / render.ts, secret_class predicate, escalation shape
provides:
  - full-history secret scan record (history-scan.json, metadata only) and AUD-SECRET-001..005
  - type-checker signing-site census tool (signing-census.ts, --self-test 31/31)
  - census N = 23 transaction-signing sites (total_tx_signing) for the Phase 23 assertion, 1 message-signing site listed separately
  - two-way reconciled manual inventory (manual-inventory.json, 0 unexplained differences)
  - AUD-CENSUS-001 (census record) and AUD-CENSUS-002 (S1 unlocked src site, duplicate of AUD-BUY-007)
  - ESC-SECRET-02 (closed, not-secrets) and ESC-CENSUS-01 (ruled, keep-s1)
  - sweep contributions contrib-SECRET.json (C17) and contrib-CENSUS.json (C07)
affects: [22-28 consolidation, 22-29 close-out, phase 23 signing-site assertion, phase 24 capital fixes, phase 29 HYG-03 scripts]

actuals:
  tokens: 72000
  tasks: 2
  commits: 4
plan_head_before: c63967615533b2bc5f3ee0103236d7083db1972e
plan_head_after: d554a18f10acfbc02b18d603c6e03543b0a8a2bd

tech-stack:
  added: []
  patterns:
    - "Type-checker census: ts.createProgram over a git-archive snapshot at audit_base_sha, receivers classified by type (aliases found), lock status locked/unlocked/unknown with recorded evidence chains"
    - "Git-mode scanner proof: the fixture repo is scanned with the exact log-opts of the real scan, immediately before it"

key-files:
  created:
    - .planning/audit/inputs/history-scan.json
    - .planning/audit/tools/signing-census.ts
    - .planning/audit/census/signing-sites.json
    - .planning/audit/census/manual-inventory.json
    - .planning/audit/findings/AUD-SECRET-001.json
    - .planning/audit/findings/AUD-SECRET-002.json
    - .planning/audit/findings/AUD-SECRET-003.json
    - .planning/audit/findings/AUD-SECRET-004.json
    - .planning/audit/findings/AUD-SECRET-005.json
    - .planning/audit/findings/AUD-CENSUS-001.json
    - .planning/audit/findings/AUD-CENSUS-002.json
    - .planning/audit/escalations/ESC-SECRET-02.json
    - .planning/audit/escalations/ESC-CENSUS-01.json
    - .planning/audit/sweep/contrib-SECRET.json
    - .planning/audit/sweep/contrib-CENSUS.json
  modified:
    - .planning/audit/tools/betterleaks/fixture-check.ts

key-decisions:
  - "ESC-SECRET-02: operator ruled \"not secrets\"; the 4 non-public history hits (AUD-SECRET-004 content hash, AUD-SECRET-005 URL-userinfo test strings) close NOT-A-BUG; nothing rotated, history not rewritten"
  - "ESC-CENSUS-01: operator ruled \"keep s1\"; AUD-CENSUS-002 (src/utils/tokenSafety.ts:277 real approve inside dead simulateSell, outside withNonceLock) stays S1; at 22-28 the canonical AUD-BUY-007 must be raised to S1 and carry ESC-CENSUS-01"
  - "Orchestrator context (not operator): keep-s1 recommended because the fix is deleting a dead function and S1 makes sure Phase 24 removes it; a function named simulateSell that really signs is a re-wiring trap"
  - "Census N = 23 tx-signing sites (src 11: 10 locked, 1 unlocked; scripts 12 unlocked, out-of-process, covered by ESC-SCRIPTS-01 / Phase 29); 4 ContractFactory.deploy included; 1 message signature (flashbots.ts:102 signMessage) excluded from N"
  - "Lock rule stricter than the plan wording: every call on a path to the lock must be awaited or returned; an in-repo callback is followed only when its receiver calls it directly and awaits it, otherwise unknown"

patterns-established:
  - "Census lock evidence: lexical (inside a withNonceLock argument) or transitive (every reference chain ends inside one, cycle-safe); unknown is never counted as locked or excluded"
  - "Escalation ruling close-out without closing the finding: resolution.status ruled plus a consolidation_note naming the merge actions for 22-28"

requirements-completed: [AUDIT-03]

coverage:
  - id: D1
    description: "Full-history secret scan: git-mode fixture proof (deleted-history and reflog-only keys found), three-pass betterleaks scan of 1053 commits (all refs + reflog, 5 stashes), 50 hits recorded as metadata only and classified (10 known-public Hardhat #0, 36 public-address, 4 non-public)"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "22-26 Task 1 <automated> node one-liner over history-scan.json + FIXTURES.json (hits 50, non-public 4)"
        status: pass
      - kind: other
        ref: "git ls-files -- \"*scans/*\" (prints nothing: raw reports stay outside the repo)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Signing-site census tool with seeded self-test and census at audit_base_sha: N = 23 tx-signing (4 deployments), 1 message-signing, every unlocked/unknown site review-noted, manual inventory reconciled both ways with 0 differences"
    requirement: AUDIT-03
    verification:
      - kind: unit
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/signing-census.ts --self-test (SELF-TEST PASS 31 of 31: 9 plan cases + 22 extra)"
        status: pass
      - kind: other
        ref: "22-26 Task 2 <automated> node one-liner over signing-sites.json + manual-inventory.json (N = 23, message-signing 1, deploy 4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Register entries, escalations with verbatim operator rulings (ESC-SECRET-02 \"not secrets\", ESC-CENSUS-01 \"keep s1\") and sweep contributions pass the partial check and render"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice SECRET --slice CENSUS (RESULT PASS fail=0 pending=0 warn=0)"
        status: pass
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/render.ts --out \"$(mktemp -d)\" (exit 0; ESC-CENSUS-01 renders with operator response and resolution)"
        status: pass
    human_judgment: false

duration: 51min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 26: Full-History Secret Scan and Signing-Site Census Summary

**A betterleaks 1.10.0 scan of all 1053 commits (proven on a git fixture first) found no real secret. A TypeScript type-checker census counted N = 23 transaction-signing sites. One src site signs outside the nonce lock: the dead `simulateSell` approve. The operator ruled it stays S1.**

## Performance

- **Duration:** 51 min wall-clock, including two operator waits (ESC-SECRET-02 and ESC-CENSUS-01)
- **Started:** 2026-11-07T20:53:11Z (bounded by the 22-25 close-out commit c639676; see Issues Encountered)
- **Completed:** 2026-11-07T21:44:06Z
- **Tasks:** 2 of 2 (each followed by a blocking operator checkpoint)
- **Files modified:** 16 (15 created, 1 modified), all under `.planning/audit/`

## Accomplishments

- **Git-mode coverage proven before the real scan.** On a throwaway fixture repo, a key that was committed and later deleted was found, and so was a key reachable only from the reflog. The fixture run used the exact log-opts of the real scan (`--full-history --all --reflog --diff-filter=tuxdb --diff-merges=first-parent`).
- **Full-history scan, metadata only.** The scan covered 1044 commits (`--all`) and 1053 with `--reflog`, plus 5 stashes. It found 50 hits:
  - 10 known-public Hardhat #0 (AUD-SECRET-002, S4, not escalated)
  - 36 public-address (recorded under AUD-SECRET-001, the scan record)
  - 4 non-public, all in `.planning/` documents (AUD-SECRET-004/-005)

  Each hit holds only the seven metadata fields. Raw reports stay outside the repo. The 4 non-public hits were escalated at once (ESC-SECRET-02) and the operator ruled "not secrets": both findings are closed NOT-A-BUG. The NAC-01 backup-copy scans are registered as AUD-SECRET-003 (`secret_class` scan-record).
- **Signing-site census (D-NONCE-AUTHORITY-ALL).** `signing-census.ts` builds a type-checked program from a `git archive` snapshot at audit_base_sha 23a6461. It classifies receivers by type, so aliases are found, and records a lock status with an evidence chain for every site. Results:
  - N = 23 transaction-signing sites, including the 4 `ContractFactory.deploy` calls in `scripts/deploySepoliaTest.ts`
  - src: 11 sites; 10 locked, 1 unlocked
  - scripts: 12 sites, all unlocked, out-of-process, already covered by ESC-SCRIPTS-01 for Phase 29
  - 0 unknown
  - 1 message-signing site (`src/utils/mevStrategies/flashbots.ts:102` signMessage), listed separately and not counted in N
- **Manual inventory reconciled both ways.** `missing_from_census` and `missing_from_manual` are both empty.
- **AUD-CENSUS-002 (S1, STRAND).** `src/utils/tokenSafety.ts:277` sends a real `approve(CONFIG.routerAddress, balance)` inside `simulateSell` with no `withNonceLock`. Nothing calls `simulateSell`: `src/bot.ts:17` imports it and the tests mock it. It is a duplicate of AUD-BUY-007. It was escalated as ESC-CENSUS-01, and the operator ruled "keep s1".

## Task Commits

1. **Task 1: Full-history secret scan** - `e7ee54a` (docs)
   - **Task 1 operator ruling (ESC-SECRET-02, "not secrets"; AUD-SECRET-004/-005 NOT-A-BUG)** - `1213da5` (docs)
2. **Task 2: Signing-site census** - `82b8dcf` (docs)
   - **Task 2 operator ruling (ESC-CENSUS-01, "keep s1")** - `d554a18` (docs)

**Plan metadata:** recorded in the plan close-out commit (docs: complete plan)

## Files Created/Modified

- `.planning/audit/inputs/history-scan.json`: the scan record. Tool, version, binary and config SHA-256s, network boundary, git fixture result, log-opts, commit universe, hit counts, and metadata-only hits.
- `.planning/audit/tools/betterleaks/fixture-check.ts`: gained `--git-fixture` / `--git-scan`. Dir mode is unchanged.
- `.planning/audit/tools/signing-census.ts`: the type-checker census. Flags: `--root`, `--sha`, `--out`, `--manual`, `--self-test`.
- `.planning/audit/census/signing-sites.json`: 50 sites (23 tx-signing in N, 1 message-signing, 26 excluded with reasons), plus `by_file`, `by_lock_status` and `method`.
- `.planning/audit/census/manual-inventory.json`: grep floor, files read, sites confirmed by hand, auditor exclusions, `out_of_program_signers`, and the two-way reconciliation.
- `.planning/audit/findings/AUD-SECRET-001..005.json`:
  - 001: scan record
  - 002: known-public Hardhat #0
  - 003: NAC-01 backup scan record
  - 004/005: non-public hits, NOT-A-BUG
- `.planning/audit/findings/AUD-CENSUS-001.json` (census record, S4) and `AUD-CENSUS-002.json` (unlocked src site, S1).
- `.planning/audit/escalations/ESC-SECRET-02.json` (closed, not-secrets) and `ESC-CENSUS-01.json` (ruled, keep-s1, with a consolidation note for 22-28).
- `.planning/audit/sweep/contrib-SECRET.json` (C17) and `contrib-CENSUS.json` (C07).

## Decisions Made

- **ESC-SECRET-02, operator verbatim "not secrets".** The 4 non-public hits are scanner false positives:
  - AUD-SECRET-004: the SHA-256 content hash of `.planning/intel/api-map.json`
  - AUD-SECRET-005: the `http://127.0.0.1:8080@<host>` URL-userinfo host-spoofing test strings

  No key was rotated and history was not rewritten.
- **ESC-CENSUS-01, operator verbatim "keep s1".** AUD-CENSUS-002 stays S1 and was not edited. AUD-BUY-007 was not edited here either. The orchestrator recommended keep-s1 (this is the orchestrator's context, not the operator's words): the fix is deleting a dead function at near-zero cost, S1 makes sure Phase 24 actually removes it, and a function named `simulateSell` that really signs is a re-wiring trap.
- **Census lock rule (stricter than the plan wording).** A site counts as locked only if every call on its path to the lock is awaited or returned. A callback passed to an in-repo function is followed only when that function calls it directly and awaits it; otherwise the plan's "callback -> unknown" rule applies.
- **Escalation close-out shape for a ruling that leaves the finding open.** `resolution.status` is `ruled` with outcome `keep-s1`. `closed` was not used because the defect is still open; `deferred` is forbidden by AC-39.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] fixture-check.ts could not prove or run git-mode scans**
- **Found during:** Task 1
- **Issue:** The 22-02 fixture tool only supported dir mode. AC-35 needs git-mode coverage (deleted-history and reflog-only keys) proven with the same arguments as the real scan.
- **Fix:** Added `--git-fixture` and `--git-scan`. The git fixture proof always runs with identical arguments right before the real scan. Dir mode is unchanged.
- **Files modified:** `.planning/audit/tools/betterleaks/fixture-check.ts`
- **Verification:** The dir-mode regression passes 18/18. The git fixture reports `history_hit: true, reflog_hit: true`.
- **Committed in:** e7ee54a

**2. [Rule 2 - Missing critical] Lock rule and self-test stronger than the plan text**
- **Found during:** Task 2
- **Issue:** A literal reading of "every reference chain ends inside withNonceLock" would count an un-awaited call inside the lock as locked, even though it can sign after the lock is released. The 9 plan cases do not catch that or several other mutants.
- **Fix:** Every call on a path to the lock must be awaited or returned. An in-repo callback is followed only when its receiver calls it directly and awaits it. The self-test keeps the 9 plan cases and adds 22 extra cases (31/31). Every behaviour mutant fails the self-test.
- **Files modified:** `.planning/audit/tools/signing-census.ts`
- **Verification:** `--self-test` passes 31 of 31 (re-run at close-out).
- **Committed in:** 82b8dcf

**3. [Rule 1 - Bug] Two census tool bugs found and fixed before commit**
- **Found during:** Task 2 (self-test development)
- **Issue:** Two bugs:
  - Computed-property calls skipped the runner (Signer) check.
  - The trace's cycle-guard set was shared between branches, so a second branch through an already-visited function was cut short.
- **Fix:** Both fixed. Each has its own self-test case (for example `cycle-only`, `memo-a`, `memo-b`).
- **Files modified:** `.planning/audit/tools/signing-census.ts`
- **Verification:** The self-test cases pass; each fails against the pre-fix behaviour.
- **Committed in:** 82b8dcf

**4. [Rule 2 - Missing critical] Out-of-program signer and auditor exclusions recorded in the manual inventory**
- **Found during:** Task 2
- **Issue:**
  - `scripts/deploy-honeypot-checker.ts` signs through a spawned Hardhat process, which a type-checker census cannot see.
  - Two census candidates are reads, not transactions: the `scripts/addLiquidity.ts:73` getPair and the `src/bot.ts:223` allowance.
- **Fix:**
  - Added the extra key `out_of_program_signers`, which covers deploy-honeypot-checker.ts and is cross-linked to AUD-CONTRACTS-004/-001.
  - Excluded the two reads through `auditor_exclusions`, with evidence.
- **Files modified:** `.planning/audit/census/manual-inventory.json`, `.planning/audit/census/signing-sites.json`
- **Verification:** The Task 2 verify passes and the reconciliation lists are empty.
- **Committed in:** 82b8dcf

---

**Total deviations:** 4 auto-fixed (1 blocking, 2 missing critical, 1 bug)
**Impact on plan:** Every change makes the census or the scan proof stricter, never weaker. All changes stay under `.planning/audit/` (AC-33). No scope creep.

## Issues Encountered

- **Start-time record.** The predecessor recorded the plan start as 2026-11-07T21:10:35Z, but the Task 1 commit e7ee54a is dated 21:07:24Z, so that value is a continuation start. The Started time above is instead bounded by the 22-25 close-out commit c639676 (20:53:11Z). The duration is wall-clock and includes the two operator waits.
- **Render check.** At close-out, a grep for ESC-CENSUS-01 in the rendered OPERATOR-DECISIONS.md found nothing. On checking, escalation records render in AUDIT-FINDINGS.md (5 occurrences, with operator response and resolution) and OPERATOR-DECISIONS.md carries decision cards only, so nothing was wrong.
- **Consolidation stage.** It had 201 failures before this plan. That is expected, because consolidation (22-28) has not run.

## Notes for 22-28 Consolidation

- **AUD-CENSUS-002 duplicates AUD-BUY-007.** Per ESC-CENSUS-01 and the PROTOCOL section 5 merge rules, it adds 5 expected merge items to the canonical AUD-BUY-007:
  1. evidence union (census site SIG-049 command)
  2. reported_by union ("claude (22-26 executor)")
  3. severity raised to S1 per the keep-s1 ruling
  4. a severity_rationale naming AUD-CENSUS-002 and ESC-CENSUS-01
  5. escalation_ref ESC-CENSUS-01

  capital_impact differs (EXPOSURE vs STRAND) and is reconciled there.
- **Signing scripts.** The 12 script sites are out-of-process and already covered by ESC-SCRIPTS-01 (Phase 29, HYG-03). They are not re-escalated.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- Phase 23 can assert the census count N = 23 (`total_tx_signing` in `.planning/audit/census/signing-sites.json`). It cannot assert "every src signing site is locked" until `simulateSell` (`src/utils/tokenSafety.ts:269-299`) and its import at `src/bot.ts:17` are deleted (Phase 24 if it touches tokenSafety.ts first, else Phase 29).
- 22-28 consolidation should apply the AUD-BUY-007 merge items listed above.
- No blockers.

## Self-Check: PASSED

- All 16 key files exist on disk (15 created and 1 modified, all listed by `git diff --name-status c639676..HEAD`).
- Commits e7ee54a, 1213da5, 82b8dcf and d554a18 are ancestors of HEAD: `git rev-list --count c639676..HEAD` = 4.
- Gates re-run at close-out:
  - Task 1 verify: pass (hits 50, non-public 4)
  - Task 2 verify: pass (N = 23, message-signing 1, deploy 4)
  - `check.ts --stage partial --slice SECRET --slice CENSUS`: RESULT PASS fail=0 pending=0 warn=0
  - `render.ts --out "$(mktemp -d)"`: exit 0
  - `signing-census.ts --self-test`: 31 of 31
  - `git ls-files -- "*scans/*"`: empty
  - no file outside `.planning/` changed

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
