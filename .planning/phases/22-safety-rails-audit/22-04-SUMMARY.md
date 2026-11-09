---
phase: 22-safety-rails-audit
plan: 04
subsystem: audit
tags: [audit-register, enumerator, git-ls-tree, checker, renderer, escalation, d-15, d-16, d-23]
status: complete

requires:
  - phase: 22-safety-rails-audit (22-01)
    provides: phase_start_sha 23a64617dca167976adc4645fed0e2c69e384820 (backup-record.json), used as audit_base_sha
  - phase: 22-safety-rails-audit (22-02)
    provides: ESC-SECRET-01 record shape and inputs/nac01-backup-scan.json (852 hits), adopted unchanged as the canonical escalation shape
provides:
  - .planning/audit/tools/lib.ts (enumerateSlice, checkUniverse, snapshot, loaders, writeAtomic)
  - .planning/audit/tools/slice-files.ts (--slice, --check, --universe, --snapshot, --materialize)
  - .planning/audit/tools/check.ts (--stage partial|consolidation|final, --slice, --root, --repo, --self-test)
  - .planning/audit/tools/render.ts (--root, --repo, --out)
  - PROTOCOL.md, BASE.json, slices.json (19 slices, materialized files_at_base), scope.json, classes.json
  - D-23 records ESC-PRE-01..03, operator-ruled ESC-PRE-04, AUD-RAIL-001/002, PN-001, OD-21 (decided)
  - first deterministic AUDIT-FINDINGS.md and OPERATOR-DECISIONS.md
affects: [22-06, 22-07, 22-17, 22-18, 22-19, 22-20, 22-21, 22-22, 22-23, 22-24, 22-25, 22-26, 22-27, 22-28, 22-29]

actuals:
  tokens: 62510
  tasks: 2
  commits: 5
plan_head_before: 0e14a4a500a654668a4af0ce033097969315d0c5
plan_head_after: 299ccb2eb6b08da04e9d5905dff8e7bc16f23013

tech-stack:
  added: []
  patterns:
    - "One enumerator: full-tree git ls-tree -r -z (no pathspec) filtered in JS by literal entries; glob/brace characters rejected; every consumer goes through slice-files.ts"
    - "Snapshot verification: git archive read by an in-process tar reader; extracted list must equal the enumerator and every blob id must equal the tree's"
    - "Staged strictness: unfinished-work conditions print PENDING at partial and fail at consolidation/final"
    - "Mutation-proven self-test: every checker rule the self-test claims is broken one at a time and must be caught"

key-files:
  created:
    - .planning/audit/PROTOCOL.md
    - .planning/audit/BASE.json
    - .planning/audit/slices.json
    - .planning/audit/scope.json
    - .planning/audit/classes.json
    - .planning/audit/.gitattributes
    - .planning/audit/tools/lib.ts
    - .planning/audit/tools/slice-files.ts
    - .planning/audit/tools/check.ts
    - .planning/audit/tools/render.ts
    - .planning/audit/findings/AUD-RAIL-001.json
    - .planning/audit/findings/AUD-RAIL-002.json
    - .planning/audit/escalations/ESC-PRE-01.json
    - .planning/audit/escalations/ESC-PRE-02.json
    - .planning/audit/escalations/ESC-PRE-03.json
    - .planning/audit/escalations/ESC-PRE-04.json
    - .planning/audit/process-notes/PN-001.json
    - .planning/audit/decisions/OD-21.json
    - .planning/audit/AUDIT-FINDINGS.md
    - .planning/audit/OPERATOR-DECISIONS.md
  modified: []

key-decisions:
  - "audit_base_sha = phase_start_sha 23a64617dca167976adc4645fed0e2c69e384820; all 12 ledger-slice counts at the base equal the plan's expected numbers exactly (BUY 19, EXIT 4, ANTIRUG 8, TX 11, DB 7, API 14, DASH 45, TESTU 84, TESTI 62, SCRIPTS 10, CONTRACTS 8, ROOT 19); universe clean at base (861) and at HEAD (875)"
  - "ESC-SECRET-01 (22-02) fits the canonical escalation shape unchanged; its 852 input: aliases resolve through its closed resolution block (status closed + outcome), the rule PROTOCOL section 4 now states"
  - "Rediscovery rule: a second record may list an item only as a rediscovery link (its resolved_items names the canonical finding and the duplicate's escalation_ref equals the canonical one); any other double listing fails AC-39"
  - "Section-C candidates are ids SC-01..SC-22 in slices.json owned_section_c; unnamed ones go by FEATURES.md file refs (E5/J4/K2 -> BUY, E6 -> EXIT, J1/J2 -> API, L1 -> ANTIRUG, I1/I2 -> DB) plus the plan's three rulings (signers -> SCRIPTS, relative DB_PATH -> DB, --legacy-peer-deps -> ROOT)"
  - "Consolidation also requires a quality_label on every *.test.ts(x) ledger row of a test-area slice (D-20), a canonical severity_rationale naming a duplicate id, and every OD-26+ card to trace to exactly one proposed card's assigned_id"
  - "The audit register is pinned to LF (.planning/audit/.gitattributes) so committed renders and SHA-pinned scanner configs survive an autocrlf checkout"

patterns-established:
  - "Register tools expose run(argv, io) and are called in-process by the self-test; CLI entry is a thin require.main wrapper"
  - "Every tool asserts ABI 127 before any import with the refusal text 'requires Node 22.16.0 (ABI 127)'"

requirements-completed: [AUDIT-01, AUDIT-03, AUDIT-05]

coverage:
  - id: D1
    description: "Single enumerator, materialized slice map and independent universe partition; base counts match, universe clean at base and HEAD"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "slice-files.ts --universe && --check for all 12 ledger slices && --slice API | wc -l == 14 && honeypot/TX anchors (plan Task 1 verify 2)"
        status: pass
      - kind: other
        ref: "node -e slices.json/classes.json shape check (plan Task 1 verify 3): 28 RCs once, no glob chars, 12 ledger slices"
        status: pass
    human_judgment: false
  - id: D2
    description: "check.ts stages and render.ts proven on a temp fixture register + git repo; 16 failure cases, corrected fixture passes all stages, render byte-identical"
    requirement: AUDIT-01
    verification:
      - kind: integration
        ref: "check.ts --self-test (SELF-TEST: PASS 18/18)"
        status: pass
      - kind: other
        ref: "18 checker mutants in a scratch copy, each caught by its target case"
        status: pass
    human_judgment: false
  - id: D3
    description: "PROTOCOL.md: inputs, rubric, schemas, escalation tiers, merge rules, commit rule, with the required phrases"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "grep -F for 'never the working tree', 'VERIFICATION or SUMMARY', 'never pass glob or brace pathspecs to git', 'secret_class' and the four immediate-tier triggers"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-23 records and ESC-PRE-04 seeded with re-measured line refs and honest acknowledgement evidence; OD-21 decided; check partial passes with exactly two PENDING aliases"
    requirement: AUDIT-05
    verification:
      - kind: other
        ref: "check.ts --stage partial (RESULT PASS fail=0 pending=2) and plan Task 2 verify 2 (pre-phase records ok)"
        status: pass
    human_judgment: true
    rationale: "Whether the acknowledgement_evidence and the ESC-PRE-04 ruling text faithfully reflect what the operator said in the plan-phase sessions rests on sessions the executor did not attend; a human should confirm the recorded wording"
  - id: D5
    description: "First render committed; a fresh render equals it byte-for-byte, including after an autocrlf checkout"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "render.ts twice + cmp (plan Task 2 verify 3); render.ts --out <tmp> && cmp against committed files; fresh clone with core.autocrlf=true checks out LF"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-11-07
---

# Phase 22 Plan 04: Audit Register Infrastructure Summary

**The audit register infrastructure is built. One literal-entry enumerator lists the full git tree (no pathspec globs) and is checked against an independent universe partition; the base counts match the plan exactly and the universe is clean at base and HEAD. A three-stage checker and a deterministic renderer are proven on a temp fixture repo: 16 failure cases, 18 mutants caught. The D-23 pre-phase records and the operator-ruled ESC-PRE-04 failed-held escalation are seeded with line references re-measured at the base SHA.**

## Performance

- **Duration:** 24 min (start 2026-11-07T01:46:21Z, end 2026-11-07T02:10:46Z)
- **Tasks:** 2 of 2. Task 1 was a tracer; its gate re-ran the automated-only verify (interactive, end-of-phase) and continued.
- **Files:** 20 created, 0 modified, all under `.planning/audit/`.

## Accomplishments

- **Enumerator and universe.**
  - `enumerateSlice` filters `git ls-tree -r -z --full-tree <sha>` in JavaScript. An entry ending in `/` matches as a directory prefix; any other entry must match exactly. `*`, `?`, `[` and `{` are refused.
  - `checkUniverse` requires every tracked file to belong to exactly one slice or one `scope.json` prefix (`.planning/`, `docs/`, `ignition/deployments/`).
  - Base SHA 23a6461: 861 tracked files, 0 unassigned, 0 multiply assigned. HEAD: 875 files, also clean; the 22-01/22-02 scripts fall into SCRIPTS.
- **Slice map.**
  - 19 slices: 12 ledger slices plus 7 findings-only slices.
  - RC 1..28 are each owned exactly once.
  - The 22 section-C candidates are owned as SC-01..SC-22.
  - `files_at_base` was filled by `--materialize`. The counts equal the plan's expected numbers exactly, so there is no difference to explain.
- **Snapshot.** `--snapshot` extracts `git archive` output with an in-process tar reader. It requires the file list to equal the enumerator's and every blob id to match the tree. It refuses a non-empty folder or a folder inside the repo. Real-repo check: TESTU,TESTI gave 146 files, all verified.
- **check.ts.**
  - Stages are `partial`, `consolidation` and `final`. At partial, unfinished work prints as PENDING. At consolidation it fails, and the stage adds: RC map, required cards, card numbering, the 20x5 sweep with cross-class cells, thresholds, universe and ledger equality at the base, referential integrity, and duplicate reconciliation. Final repeats the universe and ledger checks at HEAD and adds the `re_audit`-to-last-change rule, `input:` resolution, and the census and history-scan presence checks.
  - `--self-test` covers the 14 required cases plus 2 more (final `re_audit`, NAC-12 keep-current risk and disallowed decided card). It also proves the corrected fixture passes every stage with no PENDING and that render.ts is byte-identical across runs and output folders.
- **Mutation proof.** 18 mutants in a scratch copy were each caught by their target case: NAC-09, brace allowed, universe ignores scope, multiply threshold, S1 / non-public escalation, `rc:` alias, sweep cell, duplicate id, acknowledgement rule, `re_audit`, `od_ref`, snapshot filter, option count, anchors, NOT-A-BUG, render nondeterminism, decided card.
- **PROTOCOL.md.** Covers audit inputs (snapshot at the base, never the working tree, P9), the rubric and capital classes, every file schema, the D-16 tiers with the four immediate triggers, alias and rediscovery rules, merge rules, and the pathspec commit rule.
- **Seed records.** Every line reference was re-measured with `git show 23a6461:<path>`.
  - **AUD-RAIL-001** (S1 rail, confirmed) -> ESC-PRE-01. The Vitest cache was re-observed: 3 duration-0 failures, and the live DB is unchanged by mtime.
  - **AUD-RAIL-002** (RC-19, S1 rail, candidate) -> ESC-PRE-03.
  - **ESC-PRE-02** (`rc:RC-10`): ethers 6.16.0 `wait()` defaults to timeout 0 (`provider.js:1045`). It runs inside `withNonceLock` at `bot.ts:750`, `exitEngine.ts:545` and `exitEngine.ts:556`.
  - **ESC-PRE-04** (capital, d-stop-the-line, STRAND, `key:API:failed-held-sell-selection`): `controls.ts:51-56`, `:70`, `:72`, `:126` and `:129` select only `'pending'` buys, so they skip positions marked `failed` / `exit_failed_held` (`exitEngine.ts:1163`, `:700`; `db.ts:540-545`). The resume path is already fixed (`db.ts:597-604`, `bot.ts:1904`).
  - **PN-001**, and **OD-21** decided on 2026-11-06.
  - `check.ts --stage partial`: PASS, with exactly the two expected PENDING aliases.

## Task Commits

1. **Task 1, step A: slice map, universe partition and single enumerator** - `dfc6adc` (feat)
2. **Task 1, step B: protocol, checker and renderer with fixture self-test** - `239d812` (feat)
3. **Task 2, step C: D-23 pre-phase records, ESC-PRE-04, RC-19 entry, OD-21 card** - `fdfbfcf` (docs)
4. **Task 2, step D: first deterministic register render** - `e19f545` (docs)
5. **Deviation: LF pin for the audit register** - `299ccb2` (fix)

**Plan metadata:** see the final docs commit for this plan.

## Files Created/Modified

- `.planning/audit/tools/lib.ts`: the enumerator, universe check, snapshot (tar reader plus blob verification), config validation, loaders and atomic writes.
- `.planning/audit/tools/slice-files.ts`: the only slice CLI (`--slice`, `--check`, `--universe`, `--snapshot`, `--materialize`).
- `.planning/audit/tools/check.ts`: the staged checker and `--self-test`.
- `.planning/audit/tools/render.ts`: the deterministic renderer (`--out`).
- `.planning/audit/PROTOCOL.md`: the contract every audit executor reads first.
- `.planning/audit/{BASE,slices,scope,classes}.json`: the base SHA, slice map, out-of-scope partition and 20 classes.
- `.planning/audit/.gitattributes`: `* text=auto eol=lf` for the register.
- `.planning/audit/findings/AUD-RAIL-00{1,2}.json`, `escalations/ESC-PRE-0{1..4}.json`, `process-notes/PN-001.json`, `decisions/OD-21.json`: the seed records.
- `.planning/audit/AUDIT-FINDINGS.md`, `.planning/audit/OPERATOR-DECISIONS.md`: the first render.

## Decisions Made

- **ESC-SECRET-01 adopted unchanged.** Its close-out keys (`resolution`, `items_ref`, `ruling_option_text`, `operator_response_channel` and so on) are documented as optional record keys. Its 852 `input:` items resolve through the closed `resolution`, so the 22-02 record needed no edit.
- **Rediscovery semantics written down.** When a defect has two records, the later record lists the canonical finding in `resolved_items`, and the duplicate keeps the canonical `escalation_ref`. Any other double listing fails AC-39. This matches 22-28's reconciliation text.
- **Three stricter consolidation rules,** stated in PROTOCOL.md so audit executors know them before they write:
  - every `*.test.ts(x)` ledger row of a test-area slice needs a `quality_label` (D-20);
  - a canonical entry's `severity_rationale` must name one of its duplicates;
  - OD-26 and later cards must come from exactly one proposed card's `assigned_id` (assign-cards.ts).
- **`--slice` is partial-only,** and consolidation/final always run unfiltered. Under `--slice`, a slice's decision cards are its `owned_od_cards` plus `decisions/proposed/<SLICE>-NN.json`.
- **A finding's `area`** must equal its slice's area. For ROOT and findings-only slices it must be one of the five sweep areas (the area affected). AUD-RAIL-001/002 use `test`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Snapshot verifies content and uses an in-process tar reader**
- **Found during:** Task 1, step A.
- **Issue:** The plan pipes `git archive` to `tar -x -C <dir>` and compares file lists only. On this machine `tar` resolves to either GNU tar (MSYS) or bsdtar, which handle Windows paths differently. And with `core.autocrlf=true`, `git archive` can rewrite line endings, so an equal file list could still hide altered content.
- **Fix:**
  - `lib.ts` parses the `git archive --format=tar` stream itself (ustar plus pax).
  - It runs with `-c core.autocrlf=false -c core.eol=lf` and `--literal-pathspecs`, passing only include entries that match at least one file.
  - It keeps a path only when a chosen slice's include/exclude selects it, so a multi-slice snapshot such as TESTU,TESTI is correct.
  - It requires the list to equal `enumerateSlice` and every extracted file's git blob id to equal the tree's, both before and after the files are written.
- **Files modified:** `.planning/audit/tools/lib.ts`
- **Verification:** self-test case 14; mutant M13 (keeping excluded paths) was caught; a real-repo TESTU,TESTI snapshot gave 146 verified files.
- **Committed in:** `dfc6adc`

**2. [Rule 2 - Missing Critical] `--materialize` mode in slice-files.ts**
- **Found during:** Task 1, step A.
- **Issue:** The plan says to fill `files_at_base`/`count_at_base` "by running enumerateSlice" but names no command. Typing the lists by hand would bypass the single enumerator.
- **Fix:** `slice-files.ts --materialize` rewrites `slices.json` from the enumerator at `audit_base_sha` with an atomic write.
- **Files modified:** `.planning/audit/tools/slice-files.ts`
- **Committed in:** `dfc6adc`

**3. [Rule 2 - Missing Critical] Two extra self-test cases (15, 16)**
- **Found during:** Task 1, step B.
- **Issue:** The 14 required cases do not exercise the final-stage `re_audit` rule (AC-32), the NAC-12 keep-current-risk rule or the disallowed decided card.
- **Fix:** Case 15 shows a changed file without `re_audit` passes consolidation and fails final. Case 16 covers the empty keep-current risk and an OD-11 marked decided.
- **Verification:** mutants M11 and M18 were caught.
- **Committed in:** `239d812`

**4. [Rule 2 - Missing Critical] LF line-ending pin for the audit register**
- **Found during:** Task 2, step D (git warned "LF will be replaced by CRLF the next time Git touches it").
- **Issue:** With `core.autocrlf=true`, any later checkout or merge would turn the committed renders into CRLF. 22-28's `cmp` of a fresh LF render against them would then fail spuriously, and the SHA-256-pinned betterleaks TOMLs (the 22-02 caveat) would fail closed.
- **Fix:** `.planning/audit/.gitattributes` with `* text=auto eol=lf`. It is directory-scoped, so it stays inside `.planning/` (AC-33). All 27 existing files were already i/lf w/lf, so no content changed.
- **Verification:** in a fresh clone with `core.autocrlf=true`, `AUDIT-FINDINGS.md` checked out LF and byte-identical to the committed file, while the control `vitest.config.ts` (outside the pin) checked out CRLF.
- **Files modified:** `.planning/audit/.gitattributes` (not in the plan's `files_modified`).
- **Committed in:** `299ccb2`

**5. [Rule 3 - Blocking] A TESTU anchor was added**
- **Found during:** Task 1, step A.
- **Issue:** The plan gives no anchor for TESTU, but an anchor is what makes `--slice`/`--check` fail on a selection that silently misses files.
- **Fix:** Anchor `test/unit/db.test.ts`, a file named by RC-19 that exists at the base.
- **Committed in:** `dfc6adc`

---

**Total deviations:** 5 auto-fixed (4 Rule 2, 1 Rule 3).
**Impact on plan:** Each change tightens a check or keeps it valid across checkouts. None widens what passes, and every change stays inside `.planning/audit/`.

## Issues Encountered

- **The Write tool turned a `U+FEFF` escape in `lib.ts` into a literal BOM character.** The BOM-strip regex was replaced with a char-code check (`text.charCodeAt(0) === 0xfeff`), and every tool and record was then ASCII-scanned (0 non-ASCII characters).
- **My first parse of the Vitest `results.json` reported 0 failed entries,** which contradicted STL-2. Diagnosis: `results` is an array of `[key, {duration, failed}]` pairs, not an object. Parsed correctly it holds 131 entries, 9 failed and exactly the 3 duration-0 failures STL-2 names. AUD-RAIL-001 cites the correct reading.
- **The first mutation run reported M01 (NAC-09) as missed.** That was a harness search-string escaping error, not a checker gap. Re-run with a plain anchor, the mutant was caught by case 03.

## Known Stubs

None that block the plan goal. The rendered register shows `pending` matrix cells, "Ledger not yet written", "Inventory not yet written" and "Not yet recorded (plan 22-26)" sections, and RC rows as UNMAPPED. These are intentional: each is filled by the owning audit plan (22-17..22-26), and stage consolidation (22-28) fails until every one is filled.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- **Audit plans can start in parallel.** 22-06, 22-07 and 22-17..22-27 now have the protocol, the slice lists (`slice-files.ts --slice/--check/--snapshot`) and `check.ts --stage partial --slice <S>`.
- **22-20 (TX)** must resolve `rc:RC-10` (ESC-PRE-02) through `resolved_items` with RC-10 findings whose `escalation_ref` is ESC-PRE-02.
- **22-22 (API)** must create the failed-held sell-selection finding with `pre_phase_key: failed-held-sell-selection` and `escalation_ref: ESC-PRE-04`, add it to ESC-PRE-04's `resolved_items`, and never escalate it again.
- **Audit plans must not commit** `AUDIT-FINDINGS.md` or `OPERATOR-DECISIONS.md` (they render with `--out "$(mktemp -d)"`). Only 22-28 and 22-29 commit the canonical renders.

## Self-Check: PASSED

- FOUND: all 20 key files on disk.
- FOUND: commits dfc6adc, 239d812, fdfbfcf, e19f545 and 299ccb2 on HEAD. The ledger measures 5 commits from 0e14a4a, and every changed path is under `.planning/audit/`.
- Task 1 acceptance:
  - self-test 18/18 (16 case lines);
  - `--universe` exits 0, all 12 `--check` pass, API lists 14 files, the anchors are present;
  - 28 RCs owned once, no glob characters, C01..C20, the three scope prefixes;
  - all PROTOCOL phrases present.
- Task 2 acceptance:
  - escalations are exactly ESC-PRE-01..04 plus ESC-SECRET-01, all dated 2026-11-06;
  - every null `operator_response` has `acknowledgement_evidence`;
  - the render shows AUD-RAIL-001/002 with their escalation refs, ESC-PRE-04 in the index, PN-001 under Process notes, and OD-21 decided 2026-11-06;
  - `check.ts --stage partial` exits 0.
- Plan verification: the committed render equals a fresh `render.ts --out <tmp>` byte-for-byte.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
