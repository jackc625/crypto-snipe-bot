---
phase: 23-test-safety-net-harness-triage-characterization
plan: 26
subsystem: testing
tags: [audit-seal, successor-seal, d-19, betterleaks, secret-scan, seal-verify, reviewed-inert, phase-gate]

requires:
  - phase: 22-safety-rails-audit
    provides: SEAL.json (sealed at 1d1dd17), the verified betterleaks 1.10.0 scanner, its configs and FIXTURES.json, the audit register and check.ts / render.ts
  - phase: 23-test-safety-net-harness-triage-characterization
    provides: 23-25 check:commits, 23-32 real-boot restart tests and triage evidence, 23-33 check:recordings-compared, every other Phase 23 register edit
provides:
  - seal-verify.ts merge handling by git's combined listing, successor seals (--seal), --start on --phase-scan, and the exact-location reviewed-inert rule
  - .planning/audit/SEAL-23.json, the successor seal over .planning/audit/ at 912b915 (SEAL VALID, with --scan too)
  - .planning/audit/inputs/phase-scan-23.json (7d0b7b3..912b915, 211 commits, 0 non-public)
  - ESC-SECRET-03 (operator ruling) and AUD-SECRET-006, -007 (NOT-A-BUG), AUD-SECRET-008 (S3, confirmed)
  - the measured Phase 23 proof (full suite, every gate, recordings, test identity, triage evidence, RED proofs, src/ diff)
affects: [phase-24, phase-25, phase-29, gsd-verify-phase-23]

actuals:
  tokens: 121319
  tasks: 3
  commits: 4

plan_head_before: f69e7544668670d0a51093e1c550b3913d6027b1
plan_head_after: f51a6cc66091b918c3698bfc5563a975b45f3ffb
commits: 4

tech-stack:
  added: []
  patterns:
    - "Successor seal: a record with previous_seal judges only paths under covers, names its own scan record and start, and links to its predecessor (D-19)"
    - "Reviewed-inert: an operator-ruled scan hit is pinned by rule id, file, commit, line and column, cites its ruling, and the ruling record must list the same location at the scanned revision"
    - "Pre-flight scan: replay planned commits in a throwaway local clone and run the real phase scan before anything enters a scanned range"

key-files:
  created:
    - .planning/audit/SEAL-23.json
    - .planning/audit/inputs/phase-scan-23.json
    - .planning/audit/escalations/ESC-SECRET-03.json
    - .planning/audit/findings/AUD-SECRET-006.json
    - .planning/audit/findings/AUD-SECRET-007.json
    - .planning/audit/findings/AUD-SECRET-008.json
  modified:
    - .planning/audit/tools/seal-verify.ts
    - .planning/audit/AUDIT-FINDINGS.md
    - .planning/audit/sweep/contrib-PHASE23.json

key-decisions:
  - "23-26 operator ruling (2026-11-12, the operator chose \"Rule them not secrets (Recommended)\"; the label was the executor's and the orchestrator's): the 2 non-public hits of the Phase 23 scan are inert test values, recorded as ESC-SECRET-03 with AUD-SECRET-006 (RFC 6455 sample nonce, hostHeaderCrash.ts:99:28@3a449f5) and AUD-SECRET-007 (planted user:pass placeholder URL, recordingsGuard.test.ts:421:80@babd7e4) closed NOT-A-BUG; seal-verify.ts labels exactly those two locations reviewed-inert and every other non-public hit still blocks a seal"
  - "23-26 reviewed-inert contract for later seals: REVIEWED_HITS in seal-verify.ts is the only list; an entry is a full location citing an ESC record, --phase-scan refuses the list unless that record (read at --sealed, never the working tree) has the operator's answer and lists the location in resolution.reviewed_hits, and the successor verifier re-checks the scan record (listed locations only, counts equal to hits, no non-public hit, ruling present at sealed_sha); --scan of later commits keeps the plain three-pass classification"
  - "23-26 SEAL-23.json seals .planning/audit/ at 912b915 (the ruling and render commit): previous_seal SEAL.json (byte-unchanged, no Phase 23 commit touches it), 104 paths changed under the folder since 1d1dd17, scan 7d0b7b3..912b915 0 non-public / 2 reviewed-inert / 959 public-address, final_check pass; any later change under .planning/audit/ other than SEAL-23.json and inputs/phase-scan-23.json invalidates it"
  - "23-26 AUD-SECRET-008 (S3, capital none, registered under the operator's standing instruction, no stop): the default generic-api-key rule skips any value holding a stop word (feed, dead, added, faded, ceded measured), so a clean scan cannot see a generic credential with a common word in it; EVM private keys are unaffected (evm-private-key 1000 of 1000); seal-verify.ts fixture draws fixed here, fixture-check.ts (frozen) owed to Phase 29"

patterns-established:
  - "Successor seal: never edit a sealed record; write a successor that points back and covers only its folder"
  - "Exact-location review: an operator ruling on a scan hit is pinned to the five-field location, never to the text"

requirements-completed: [CHAR-01, CHAR-02, CHAR-03, CHAR-04, CHAR-05, CHAR-06, AUDIT-02, AUDIT-06]

coverage:
  - id: D1
    description: "D-19: seal-verify.ts counts a merge commit by git's combined listing (a clean merge adds nothing, its inner commits count, a change made in a merge is caught)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/seal-verify.ts --self-test#merge: (four cases, plus the D-19 flood reproduction)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Successor seals: --seal, covers, scan_record and scan_start_sha checks, predecessor linkage, changed_since_previous, --start, the SEAL*.json write refusal"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/seal-verify.ts --self-test#successor: (predecessor linkage, scan substitution, audit-folder tampering, permitted outside change)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Exact-location reviewed-inert rule for the two ESC-SECRET-03 hits, with refusals and verifier re-checks"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/seal-verify.ts --self-test#reviewed: (both directions, refusals, verifier, real scanner output, the real --phase-scan path); three runs pass"
        status: pass
      - kind: other
        ref: "<scratch>/mutants26.js batches 1-4: 19 mutants, each caught by its own cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "Whole-phase proof on Node 22: wrapped full suite, test identity, every gate, three realpath runs, triage evidence byte-identical, RED proofs, src/ diff empty"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "scripts/verify-prod-untouched.ts ... vitest run --project unit --project integration --project realpath (run vpu-20261112T220443-10108-5bd13e): verdict untouched, 1560/1560"
        status: pass
      - kind: other
        ref: "Task 2 verify blocks 2-6 (gates, three test:realpath runs, triage-report cmp, red-proof-conversions --check-manifest/--check-summaries, src/ diff)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SEAL-23.json written and SEAL VALID; SEAL.json byte-unchanged; the phase scan reports zero non-public hits"
    requirement: AUDIT-06
    verification:
      - kind: other
        ref: "seal-verify.ts --seal .planning/audit/SEAL-23.json (SEAL VALID) and --seal ... --scan (SEAL VALID, 0 hits after the seal); the plan's Task 3 verify command"
        status: pass
    human_judgment: false
  - id: D6
    description: "Final gates at the sealed revision 912b915 as HEAD: check.ts --stage triage, check:realpath-mocks, check:census, check:commits, npm run test:realpath, check:recordings-compared --run-log"
    requirement: AUDIT-06
    verification:
      - kind: integration
        ref: "npm run test:realpath (run-20261112T231944-12024-6b792f, 344/344) and npm run check:recordings-compared -- --run-log <that log> (tracked 130, compared 130)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Review outcomes AC-46, AC-47, AC-48, AC-50, AC-52, AC-53 (judgment items of the SPEC)"
    verification: []
    human_judgment: true
    rationale: "The SPEC assigns these to a reviewer's reading of tags, rulings, fake transport data and list changes; the executors recorded their reading, the verifier should confirm it"

duration: 1h46m (wall-clock incl. operator wait; continuation 49min)
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 26: Successor Seal, Seal-Tool Fix and Whole-Phase Proof Summary

**The Phase 23 audit register is sealed by SEAL-23.json at 912b915, a successor that points back to the untouched Phase 22 SEAL.json. The seal tool counts merges by git's combined listing, and its phase scan labels exactly the two operator-ruled test values (ESC-SECRET-03) reviewed-inert. The whole phase is proven on Node 22: 1560/1560 tests, every gate green, recordings identical across runs, an empty src/ diff, and the final gates re-run green at the sealed revision.**

## Performance

- **Duration:** 1h46m wall-clock including the operator wait (the first executor ran from about 2026-11-12T21:39Z and stopped at the Task 3 decision; this continuation ran 2026-11-12T22:36:49Z to 23:26Z, 49 min)
- **Tasks:** 3 of 3
- **Files modified:** 9 (2 created by the seal, 4 register records created, 3 modified)

## Accomplishments

- D-19 seal tool: merges counted by git's combined listing; successor seals with `--seal`; the scan record's digest, range and predecessor linkage are all checked; `--start` on `--phase-scan`; the tool refuses to write onto any `SEAL*.json`.
- The operator's ruling recorded as ESC-SECRET-03, and the one rule it allows added to seal-verify.ts: a non-public hit becomes reviewed-inert only at an exact listed location (rule id, file, commit, line, column) whose ruling record is committed at the scanned revision. The same text anywhere else still blocks a seal. Self-tests prove both directions, and 19 mutants are each caught by their own cases.
- The residual intermittent `range-public-address` self-test failure diagnosed to its cause (the scanner skips values holding a stop word) and fixed in the fixture's drawing rule (20,000 of 20,000 reported). The scanner coverage limit behind it is registered as AUD-SECRET-008. EVM private keys were measured unaffected.
- SEAL-23.json written and SEAL VALID (also with `--scan`). The phase scan is clean: 0 non-public, 2 reviewed-inert, 959 public-address. SEAL.json is byte-unchanged.
- The whole phase measured, and the final gates re-run at the sealed revision. All pass.

## Task Commits

1. **Task 1: Fix the seal tool's merge counting, add successor seals and `--start`, with self-tests** - `597d6db` (fix), first executor
2. **Task 2: Prove the whole phase** - no commit (results only, below)
3. **Task 3: Seal the audit folder with a successor seal** (after the operator's ruling):
   - `c311002` (feat) the exact-location reviewed-inert rule, its self-tests, and the stop-word fix in the fixture's drawing rule
   - `912b915` (docs) ESC-SECRET-03, AUD-SECRET-006 to -008, the sweep entry and the re-render: **the sealed revision**
   - `f51a6cc` (docs) SEAL-23.json and inputs/phase-scan-23.json

**Plan metadata:** recorded in the SUMMARY commit and the STATE/ROADMAP commit that follow this file.

## Task 1 (first executor, 597d6db)

- Merges are listed with git's combined listing (`--diff-merges=combined`) instead of first-parent. A clean merge adds nothing of its own, the commits it brings in still count, and a change made inside a merge (even one undone by a later merge) is still caught.
- `--seal <rel>` reads a successor record. Only paths under `covers` are judged (compared without letter case). The tool checks the scan record's digest and range, the link to the predecessor seal (read at the successor's sealed revision, which must be a descendant of the predecessor's), and `changed_since_previous`. `--start` was added to `--phase-scan`, and the tool refuses to write onto any SEAL*.json file. SEAL.json was byte-unchanged.
- Self-test grew from 31 to 68 cases. Three runs passed, including a proof that the fixture reproduces the D-19 flood. 12 mutants were each caught by their own cases (M11 first failed to compile, so it was rerun as a compiling mutant).
- Rule 1 (first executor): the range fixture planted plain random hex, and about 1% of runs planted an address the scanner rule did not report. It was switched to `randomHexStrong`, the entropy-checked drawing that fixture-check.ts already uses. This continuation found the remaining cause (see Deviations, item 1).

## Task 2 results (first executor, Node 22, HEAD 597d6db, all pass)

- **Wrapped full suite** (run vpu-20261112T220443-10108-5bd13e): verdict untouched, manifest equal. 211 files, 1560/1560 (unit 952 against the floor of 932, integration 264 against 262, realpath 344), wall 220 s. nonLoopbackAllowed 0, telegramAllowed 0, 0 unhandled errors. The recordings-compared check on that run passes (130 tracked, 130 compared). No test reached half of its real time limit.
- **test-identity:** 0 missing, 0 missing files, 0 unexecuted, 0 count mismatches. 12 renames, all recorded (23-31: 6, 23-19: 4, 23-30: 1, 23-03: 1). No title is missing, so this summary needs no AC-38 removal line.
- **Gates:** check:vi-mock (660 calls, 0 violations), check:realpath-mocks (0), check:census (23 sites, 0 problems), floor history (0), check:commits (PASS, 44 commits judged), sourceTextGate (4/4). check.ts partial, consolidation and triage PASS. tsc clean on all three configs. `--stage final` has 275 FAILs, the same as after 23-33, none naming this plan's files (that stage is Phase 22's bookkeeping class; the seal's final_check comes from `--stage triage`).
- **Three realpath runs:** 344/344 each, each with the recordings check PASS (130/130). `git diff --exit-code test/realpath/recordings` is 0.
- **Triage:** three runs of 113/113 with 93 identical tuples, rail run 147/147, population 61 of 61. The regenerated evidence is byte-identical to the committed triage-evidence.json (sha256 8f6578bf...945e).
- **RED proofs:** `MANIFEST-OK rows 36 files 11 guards 1`, and SUMMARIES-OK with red-ok 67 and removed 0.
- **src/ (AC-45, AC-49 to AC-52):** the diff from 7d0b7b3 is empty, with no untracked file and no src/ commit (re-checked at f51a6cc: 0 diff lines, 0 untracked, 0 commits). The 23 ForTesting occurrences under src/ are older definitions and comments, with no production call.
- **AC-45 result:** no file under src/ differs from 7d0b7b38ce229b019953d6f9f355dc8dbf655ba5, so there is no file to review and no per-file review line.
- **AC-46:** only risk-gate-refused is KEEP, and all 20 IDs cited in SUSPECT tags are confirmed findings.
- **AC-47:** no S0/S1 was downgraded, and none was closed as NOT-A-BUG. The S1 entries closed as fixed are the AC-13 rail closures plus AUD-DB-007, all presented in the batch the operator answered in TRIAGE-REVIEW-01.
- **AC-48 (read by this continuation; the first executor's report did not cover it):** plans 23-01, 23-05 to 23-13, 23-27 and 23-28 each recorded their own AC-48 review of the fake chain data they added. For the plans without one, I read every chain answer a test writes by hand (`setRead`, `setCode`, `setBalance`, `failNext`, `setRelay`, `hold`) under test/realpath/scenarios, ordering and env and in the 23-32 restart tests. There are six sites, all real-node-shaped:
  - the V3 `liquidity()` read follows the mined `decreaseLiquidity` (flashbots-v3.test.ts:136);
  - the V2 router sell simulation reproduces the router's own reverts from mined approves and sells (otherRoutes.test.ts:425);
  - the wallet balance is set as genesis state (riskAndFees.test.ts:269, AUD-API-002.test.ts:93);
  - `getPair` is answered for a pair that already exists (boot.test.ts:600);
  - contract code is placed at the checker and allowlist addresses, as on mainnet (boot.test.ts:89-90, AUD-API-002-restart.ts:72-73).

  23-15's only fake answer replays the real recorded HTTP 403 from the one approved live request. 23-14 added rail tests, with no fake chain answers. The harness fails an unknown JSON-RPC method by name (harness.test.ts AC-03, passing in the final realpath run). This plan added no fake chain data.
- **AC-50:** only test and gate tooling was added.
- **AC-52:** no ForTesting helper is called from production code (src/ is unchanged).
- **AC-53:** every census exception carries a decision reference.
- **Process notes (first executor):** the harness moved three long runs to the background after 180 s (the mutation run, the triple self-test and the full suite); the executor waited for each, started no other heavy work, and all three exited 0. One throwaway log went to /tmp instead of the scratchpad and was deleted.

## Task 3 (this continuation)

**The checkpoint.** The first phase scan of 7d0b7b3..597d6db found 2 non-public hits (and 959 public addresses), and the seal rule requires 0:

1. hostHeaderCrash.ts:99:28 at 3a449f5, rule generic-api-key: the RFC 6455 sample handshake nonce, which decodes to "the sample nonce".
2. recordingsGuard.test.ts:421:80 at babd7e4, rule generic-credential-uri: the planted `user:pass` placeholder URL the guard test uses to prove such a recording is refused.

The operator chose "Rule them not secrets (Recommended)" (Option 1).

**Steps:**

1. **The rule (c311002).** `REVIEWED_HITS` holds the two locations, each citing ESC-SECRET-03. `sameLocation` compares all five fields exactly. `applyReviewed` relabels only a non-public hit. `checkReviewedList` refuses each of these:
   - an entry with no ruling reference, or one that is not an escalation id;
   - a ruling record missing at `--sealed`;
   - a record with no operator response;
   - a record that does not list the exact location;
   - a partial location;
   - a duplicate entry.

   `--phase-scan` runs the check before scanning, writes `hit_counts.reviewed-inert`, and lists `reviewed_hits` (locations and the ruling only, never a value). The successor verifier re-checks the scan record: only listed locations may be reviewed-inert, the counts must equal the hits, the hits list may hold no non-public hit, and the ruling must be present at the sealed revision. `--scan` (commits after a seal) keeps the plain classification.
2. **Self-tests.** 68 grew to 103 cases. For each listed hit, the hit is reviewed-inert, and the same hit is still non-public at another rule, another file, a letter-case variant of the file, another commit, another line or another column. A public-address hit keeps its label. The 9 refusals are covered, plus 6 verifier cases on a successor fixture (VALID with the ruling at sealed_sha; INVALID without it, for an unlisted line, another file, a count mismatch, or a hidden non-public hit). On real scanner output, one planted key in two files with one location listed relabels exactly that location. The same holds through the real `--phase-scan` path. Three runs pass (st26-3, -4, -5: 109 PASS lines each, 6 of which are the range-fixture lines `phaseScan` prints itself).
3. **Mutants (19, each a temporary copy beside the real file, removed afterwards; the self-test always ran on Node 22).**
   - R1-R5: each of the five location comparisons removed.
   - R6: any classification relabelled.
   - R7-R12: each refusal disabled. R7, R8 and R11 have a second line of defence: the next check still refuses, or the code crashes, rather than accepting. The self-test asserts the exact refusal, so each is still caught.
   - R13-R16: each verifier re-check disabled.
   - R17: a third list entry added.
   - R18: the phase scan not applying the list. Caught after the wiring self-test was added; before that it was not caught, see Deviations.
   - R19: the stop-word run check removed.

   All 19 are caught by their own cases.
4. **Register (912b915).** ESC-SECRET-03 holds the operator's answer verbatim, both hits (rule, file, commit, line, column, finding, why) under `resolution.reviewed_hits`, and the diagnosis. AUD-SECRET-006 and -007 (S4, NOT-A-BUG, area test, C17) are shaped like AUD-SECRET-004 and -005. AUD-SECRET-008 (see Deviations, item 1). The C17 x test sweep entries are in contrib-PHASE23.json. check.ts partial, consolidation and triage all report RESULT PASS with fail 0, pending 0, warn 0. AUDIT-FINDINGS.md was re-rendered (a second render to a temp folder is byte-identical); OPERATOR-DECISIONS.md is unchanged.
5. **Pre-flight.** Before anything entered the real history, both planned commits were replayed in a throwaway local clone and the real phase scan ran over them: 211 commits, 0 non-public, 2 reviewed-inert, 959 public-address. So no text added in this plan creates a hit.
6. **Final gates at 912b915 as HEAD** (working tree clean apart from the operator's unstaged .planning/config.json and .planning/state.json):
   - check.ts --stage triage: RESULT PASS, fail 0, pending 0, warn 0 (`--stage final`: 275, unchanged, none naming this plan's files);
   - check:realpath-mocks: 44 vi uses, 0 violations;
   - check:census: 23 sites, floor 23, 0 problems;
   - check:commits: 46 judged, 0 violations, PASS;
   - `npm run test:realpath` (run-20261112T231944-12024-6b792f): 70 files, 344/344, 99 s, nonLoopbackAllowed 0, telegramAllowed 0. The nine log lines with "error" or "unhandled" are passing test titles.
   - `npm run check:recordings-compared -- --run-log <that run's log>`: RESULT PASS (tracked 130, compared 130). The recordings are unchanged.
7. **Phase scan** (`--phase-scan --sealed 912b915 --start 7d0b7b3`): range fixture 6 of 6. 211 commits, 961 hits: non-public 0, reviewed-inert 2 (both entries matched), public-address 959, known-public 0. The same 961 hit locations as the first scan. RESULT CLEAN.
8. **SEAL-23.json** carries SEAL.json's field set plus:
   - covers `.planning/audit/`;
   - previous_seal SEAL.json, with previous_sealed_sha 1d1dd17;
   - changed_since_previous: 104 paths;
   - scan_record inputs/phase-scan-23.json, scan_start_sha 7d0b7b3;
   - scan.reviewed_inert 2, with the ruling reference;
   - final_check pass, with its source line;
   - the render hashes;
   - exempt_paths: the seal and its scan record.

   `seal-verify.ts --seal .planning/audit/SEAL-23.json`: **SEAL VALID**. With `--scan`: SEAL VALID, 0 hits in the commit after the seal. SEAL.json is byte-unchanged (blob e11d3fd8), and no Phase 23 commit touches it.

## Files Created/Modified

- `.planning/audit/tools/seal-verify.ts` - merge handling, successor seals, `--start` (597d6db); reviewed-inert rule, stop-word-safe fixture draws, 103-case self-test (c311002)
- `.planning/audit/escalations/ESC-SECRET-03.json` - the operator's ruling on the two hits, with their exact locations
- `.planning/audit/findings/AUD-SECRET-006.json`, `AUD-SECRET-007.json` - the two hits, NOT-A-BUG on the ruling
- `.planning/audit/findings/AUD-SECRET-008.json` - the scanner stop-word coverage limit and fixture flaw
- `.planning/audit/sweep/contrib-PHASE23.json` - C17 x test sweep entries for the three findings
- `.planning/audit/AUDIT-FINDINGS.md` - re-rendered (305 findings, 25 escalation records)
- `.planning/audit/inputs/phase-scan-23.json` - the sealed range's scan record (metadata only)
- `.planning/audit/SEAL-23.json` - the successor seal

## Decisions Made

- **Operator ruling, ESC-SECRET-03** (2026-11-12, verbatim "Rule them not secrets (Recommended)"; the label was the executor's and the orchestrator's): both hits are inert test values and close NOT-A-BUG. Exactly their two locations are labelled reviewed-inert; nothing is rotated and history is not rewritten.
- **The list lives in the tool and is cross-checked against the ruling record.** Neither the code nor the register can widen it alone: an entry must cite a record that has the operator's answer and lists the same location at the scanned revision. The verifier re-checks the scan record, so a hand-edited scan file cannot relabel another hit.
- **`--scan` (commits after a seal) does not use the list.** That is the stricter choice: a listed hit names a commit that is already sealed.
- **The sealed revision is 912b915**, the commit holding the ruling and the render. The final gates ran with it as HEAD, before the scan record and the seal existed, so the gates and the sealed tree are the same code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The range fixture still failed now and then: the scanner skips a value holding a stop word**
- **Found during:** Task 3, mutant R17. That mutant only adds a list entry, but the same run printed `FAIL range-public-address: m.log` with no hit at all.
- **Issue:** the default generic-api-key rule skips any flagged value that contains a stop word. 3,000 entropy-qualified addresses in the fixture's exact line shape gave 8 misses (0.27%), each holding a hex-letter word (feed four times, faded, added, dead, ceded). The same 8 alone were missed again 8 of 8, so the miss follows the value, not chance. Their mean entropy was 3.797, above the floor, so the first executor's entropy fix did not cover this cause.
- **Fix:** `randomHexStrong` also rejects a run of four or more letters a-f. A self-test case and mutant R19 cover it.
- **Verification:** 20,000 of 20,000 addresses drawn under the new rule were reported. Separately, 1,000 keys with a word inside were all reported by `evm-private-key`, so private keys are not affected.
- **Registered:** AUD-SECRET-008 (S3, capital none, confirmed), under the operator's standing instruction, with no stop. It covers the scanner coverage limit (a clean scan cannot see a generic credential with a common word in it) and the same flaw in fixture-check.ts. fixture-check.ts is frozen (it is part of the Phase 22 scanner), so it is not changed here; it fails closed, and the fix is recommended for Phase 29.
- **Files modified:** `.planning/audit/tools/seal-verify.ts`; `findings/AUD-SECRET-008.json`
- **Committed in:** c311002 (fix), 912b915 (finding)

**2. [Rule 2 - Missing critical] The phase scan's use of the list had no self-test (mutant R18 not caught at first)**
- **Found during:** Task 3, the first mutant run.
- **Issue:** removing `applyReviewed` from `phaseScan` passed the self-test. Only the one real scan would have shown the gap.
- **Fix:** `phaseScan` takes the list as a parameter (the command line always passes `REVIEWED_HITS`). A new self-test drives the real `--phase-scan` on a fixture repo with its own ruling record and checks the written record. R18 is now caught.
- **Files modified:** `.planning/audit/tools/seal-verify.ts`
- **Committed in:** c311002

**3. [Rule 2 - Missing critical] Verifier re-checks of the reviewed label**
- **Issue:** the scan record's digest is pinned in the seal, but a hand-edited and re-digested record could otherwise relabel an unlisted hit or hide a non-public hit behind its counts (T-23-42, scan substitution).
- **Fix:** the successor verifier checks that every reviewed-inert hit is a listed location with its ruling at sealed_sha, that the reviewed-inert count equals the hits, and that the hits list holds no non-public hit. Four verifier cases and mutants R13 to R16 cover it.
- **Committed in:** c311002

---

**Total deviations:** 3 auto-fixed (1 bug, 2 missing critical), plus 1 finding registered (AUD-SECRET-008).
**Impact on plan:** all three were needed for the seal to mean what it says. The scanner, its configs, FIXTURES.json and SEAL.json are unchanged.

## Issues Encountered

- **A wrong intermediate result from my own diagnosis script, caught before it was used.** My first key run reported that `evm-private-key` never fired. That contradicted FIXTURES.json case a and this tool's own range fixture, so I checked the script: a text replacement for the `PRIVATE_KEY=` line had not matched (escaping), and the "keys" were really 64-hex values under `token`. Re-run with the line set explicitly, `evm-private-key` reported 1,000 of 1,000. AUD-SECRET-008 records only the corrected measurement.
- **Node 22 rule slips (process note).** Three commands ran on the global Node 24 instead of the Node 22 prefix:
  - the mutant runner itself, which only copies files and spawns the self-test with the Node 22 binary by absolute path, so every self-test result is Node 22;
  - the first try of the register writer, which failed on a syntax error before writing anything;
  - a one-line JSON read.

  Every command after those carried the prefix. No test, gate or scan ran outside Node 22.
- **Background moves.** The harness moved the first three mutant batches to the background after 180 s. I waited for each and ran only file writes and reads meanwhile; each exited 0, and its log was read in full. The fourth batch, every self-test, the full realpath run and the phase scan ran in the foreground.

## Known Stubs

None.

## Threat Flags

None. The plan's threat register covers what this plan touched (T-23-33: SEAL.json read only and byte-unchanged; T-23-34: the phase scan ran before the seal and records zero non-public hits; T-23-42: the scan record's digest, range, predecessor linkage and reviewed labels are all verified, each with self-tests and mutants).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 33 Phase 23 plans have a SUMMARY. The phase is ready for the orchestrator's phase verification and `phase.complete`; this plan does not mark the phase complete.
- **For Phase 24 and later:** SEAL-23.json is invalid as soon as any file under `.planning/audit/` other than SEAL-23.json and inputs/phase-scan-23.json changes. A later register edit needs its own successor seal (SEAL-24.json, with `previous_seal` .planning/audit/SEAL-23.json). Verify with `seal-verify.ts --seal .planning/audit/SEAL-23.json --scan`.
- **For Phase 29:** AUD-SECRET-008 asks for the same drawing fix in fixture-check.ts (then re-prove FIXTURES.json), and a recorded choice on generic credentials that contain a common word.

## Self-Check: PASSED

- FOUND: .planning/audit/SEAL-23.json, .planning/audit/inputs/phase-scan-23.json, .planning/audit/escalations/ESC-SECRET-03.json, .planning/audit/findings/AUD-SECRET-006.json, AUD-SECRET-007.json, AUD-SECRET-008.json
- FOUND commits (ancestors of HEAD): 597d6db, c311002, 912b915, f51a6cc
- Measured commits from the plan ledger f69e754: 4
- seal-verify.ts --seal .planning/audit/SEAL-23.json: SEAL VALID; `git status --porcelain .planning/audit/SEAL.json` empty
- check.ts --stage triage at 912b915: RESULT PASS; src/ diff from 7d0b7b3 empty

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
