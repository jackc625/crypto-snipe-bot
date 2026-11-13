---
phase: 23-test-safety-net-harness-triage-characterization
plan: 04
subsystem: testing
tags: [audit-register, check.ts, triage, d-21, typescript-ast, knownBug]

requires:
  - phase: 23-02
    provides: knownBug marker contract (claim literal, HARNESS-SELFTEST reserved for harness self-tests outside test/realpath/triage/)
  - phase: 23-01
    provides: register changes AUD-ANTIRUG-024 (new, S3) and AUD-ANTIRUG-018 (S2 -> S1)
  - phase: 22
    provides: audit register, check.ts stages partial/consolidation/final, lib.ts toJson/writeAtomic
provides:
  - "check.ts --stage triage: the Phase 23 gate (never runs consolidation or the HEAD universe check)"
  - "checkTriage: frozen population, per-outcome D-21 rules, claim-level proof, knownBug evidence zone and location guard"
  - "inputs/triage-population.json: 61 IDs frozen at 7d1c699"
  - "set-triage.ts: the one writer of a finding's triage block"
  - "reviews/<ID>.json operator review record type and inputs/triage-evidence.json shape (validated)"
  - "PROTOCOL.md section 7 Phase 23 triage record"
affects: [23-05, 23-06, 23-07, 23-08, 23-09, 23-10, 23-11, 23-12, 23-13, 23-14, 23-15, 23-16, 23-26]

actuals:
  tokens: 26989
  tasks: 2
  commits: 2
plan_head_before: 7d1c699bccff41422b0a43b1be4c31632c4f986a
plan_head_after: f20a8104303e20519c7cda645446152597114a76

tech-stack:
  added: []
  patterns:
    - "Triage rule levels: tri(R) = FAIL at stage triage, PENDING at every other stage, for work that is legitimately unfinished; contradictions FAIL at every stage"
    - "Evidence zone: only a direct knownBug call in test/realpath/triage/**/<finding ID>.test.ts feeds a finding rule; tests are located by finding ID"
    - "Self-test RED proof by mutants: a scratch copy of the tools with one rule broken must turn its named case FAIL"

key-files:
  created:
    - .planning/audit/tools/set-triage.ts
    - .planning/audit/inputs/triage-population.json
  modified:
    - .planning/audit/tools/check.ts
    - .planning/audit/tools/lib.ts
    - .planning/audit/PROTOCOL.md
    - .planning/audit/ledger/ROOT.json
    - .planning/audit/ledger/SCRIPTS.json

key-decisions:
  - "Triage population is 61, not 59: the HEAD register computes 60 (AUD-ANTIRUG-018 now S1, ESC-ANTIRUG-03) and AUD-ANTIRUG-024 is added on the operator ruling (ESC-ANTIRUG-02); frozen at 7d1c699 with severity_at_freeze"
  - "S0/S1 rules (NOT-A-BUG ruling, acknowledgement) apply to an entry that is S0/S1 now OR was at the freeze, so a downgrade (which the standing instruction allows without asking) can never drop the operator ruling a NOT-A-BUG closure needs"
  - "NOT-A-BUG needs triage.evidence at every severity (Requirement 3: NOT-A-BUG with evidence); S0/S1 additionally need the per-finding ruling"
  - "confirmed requires test_id (AC-11: every entry names its own test); the shared-cause rule checks that the test_id file asserts the entry"
  - "A knownBug citing a finding with no triage record yet is PENDING at partial and FAIL at triage (the batch plans commit the test before set-triage); a citation contradicting a recorded outcome fails at every stage"
  - "Triage constants live in lib.ts so check.ts and set-triage.ts share one definition without a circular import"

patterns-established:
  - "set-triage.ts --id <ID> --outcome <outcome> ... is the only way to write a triage block; same outcome merges, a different outcome replaces"
  - "A Phase 23 edit to a file added after audit_base_sha needs a reviewed re_audit row ending at its last-change SHA, or partial and triage fail"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "--stage triage gates the D-21 rules and never runs consolidation or the HEAD universe check"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/check.ts --self-test#18 stage triage passes a tree with a tracked file outside the universe manifest"
        status: pass
      - kind: other
        ref: "check.ts --stage triage on the real register exits 1 (62 FAIL: 61 population entries without a record, plus the missing run-evidence file)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Frozen 61-ID population joined with the live computation; a downgraded or deleted frozen ID is still required"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/check.ts --self-test#19 a frozen ID changed to S3 is still required"
        status: pass
    human_judgment: false
  - id: D3
    description: "knownBug evidence zone and location guard (eleven location cases plus evidence-from-outside-the-zone)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/check.ts --self-test#20-30 knownBug location cases and #45"
        status: pass
      - kind: other
        ref: "check.ts --stage partial on the real register: no FAIL naming test/realpath/harnessCapture.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Per-outcome D-21 rules (AC-08, AC-11, AC-13, AC-16, AC-17, AC-18) and claim-level proof, each with a self-test case"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/check.ts --self-test#17 and #31-47"
        status: pass
      - kind: other
        ref: "17 mutants of the rules in a scratch copy of the tools, each caught by its named case"
        status: pass
    human_judgment: false
  - id: D5
    description: "set-triage.ts writer (status mapping, verified kept, merge, byte-stable, refusals)"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: ".planning/audit/tools/check.ts --self-test#48 set-triage.ts writes the triage block"
        status: pass
      - kind: other
        ref: "set-triage.ts --help exit 0; set-triage on a scratch copy of the real register, then check.ts --root <copy> --stage partial reports the expected FAILs"
        status: pass
    human_judgment: false
  - id: D6
    description: "PROTOCOL.md section 7 Phase 23 triage record, readable by later executors"
    verification: []
    human_judgment: true
    rationale: "Clarity and completeness of the written contract is a reading judgment; the grep only proves the section exists"

duration: 28min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 04: Register Triage Enforcement (D-21) Summary

**check.ts now has a `--stage triage` gate that mechanically requires each of the 61 frozen triage entries to carry exactly one outcome with its evidence. It locates tests by finding ID through a TypeScript AST scan of `test/`. A location guard keeps harness self-tests from counting as proof, and `set-triage.ts` is the one writer.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-11-11T14:29:24Z
- **Completed:** 2026-11-11T14:58:02Z
- **Tasks:** 2
- **Files modified:** 7

## Population count (built from the HEAD register)

`inputs/triage-population.json` holds **61 IDs**, frozen at `7d1c699bccff41422b0a43b1be4c31632c4f986a`. The plan text says 59, and the register at HEAD wins:

- The plan's rule (non-duplicate findings with a non-empty `rc` or severity S0/S1) gives **59 at 5502fc9**, the commit where the plan was written, and **60 at HEAD**. The only difference is AUD-ANTIRUG-018, raised from S2 to S1 by the operator (ESC-ANTIRUG-03). This was measured by recomputing at both SHAs.
- **AUD-ANTIRUG-024** (new, S3, no `rc`) is added on the operator's ruling (ESC-ANTIRUG-02). The live computation would not select it, so it is held only by the frozen list.
- AUD-BUY-016 (moved candidate to confirmed by 23-28, still S3, no `rc`) is not in the population, by rule. Its status change does not affect the set.
- Breakdown: 50 canonical S0/S1 plus 10 RC entries graded S2/S3, plus AUD-ANTIRUG-024. The file also records `severity_at_freeze` for each ID.

## Accomplishments

- `Stage` gains `triage`. `strict` and the consolidation/HEAD-universe branch now run only for `consolidation` and `final`. `--help` and the `--stage must be` message name the new stage, and `--slice` stays partial-only.
- NAC-10: a research candidate may close as NOT-A-BUG only with a Phase 23 triage record. The severity-rationale half is unchanged. `checkFinding` validates the `triage` block: outcome, `phase` "23", note, consistency between status and outcome, each optional key's format, and unknown keys are refused.
- `checkTriage` runs at every stage:
  - the frozen population joined with the live set;
  - the AST scan and the location guard;
  - the per-outcome rules for confirmed, NOT-A-BUG, fixed, unreproduced and needs_fork;
  - claim-level proof and orphans;
  - operator review records and the run-evidence file.
- `set-triage.ts` writes the triage block. It maps the status, keeps `verified` on fixed, merges a same-outcome update, writes through `toJson` and `writeAtomic`, says when a file had to be re-laid out, and refuses an unknown ID or outcome.
- PROTOCOL.md section 7 "Phase 23 triage record". The lifecycle line and the check-stages list name the new stage.
- The self-test went from 18/18 to 50/50, with 32 new cases. Seventeen mutants (one rule broken at a time in a scratch copy) were all caught.

## Task Commits

1. **Task 1: triage field, --stage triage and the knownBug evidence zone (tracer)** - `80fc242` (feat). Tracer gate: the verify was re-run on the committed tree and passed, then expansion continued.
2. **Task 2: remaining D-21 rules, set-triage writer, protocol section, ROOT ledger rows** - `f20a810` (feat)

## Files Created/Modified

- `.planning/audit/tools/check.ts`: the stage, NAC-10, `checkTriageField`, `scanKnownBug`, `triagePopulation`, `loadReviews`, `loadEvidence`, `checkTriage`, and self-test cases 17-48 plus a fully triaged corrected fixture.
- `.planning/audit/tools/set-triage.ts`: the writer (new).
- `.planning/audit/tools/lib.ts`: shared triage constants (`TRIAGE_OUTCOMES`, `TRIAGE_KEYS`, `CLAIM_RE`, `REVIEW_ID_RE`, `UFV_ID_RE`).
- `.planning/audit/inputs/triage-population.json`: 61 frozen IDs (new).
- `.planning/audit/PROTOCOL.md`: section 7.
- `.planning/audit/ledger/ROOT.json`: reviewed `re_audit` rows for `.gitignore`, `package.json` and `vitest.config.ts`.
- `.planning/audit/ledger/SCRIPTS.json`: reviewed `re_audit` row for `scripts/check-vi-mock-paths.ts`.

## Verification (exact commands, Node 22.16.0)

All commands were run with `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"` and `T=node_modules/ts-node/dist/bin.js`.

- `node $T .planning/audit/tools/check.ts --self-test`: `SELF-TEST: PASS 50/50 (48 failure cases, corrected fixture, render determinism)`. The eleven `knownBug location:` cases, `unreproduced without ruling_ref` and `knownBug location: evidence from outside the zone does not count` are all PASS (both plan verify loops, exit 0).
- `node $T .planning/audit/tools/check.ts --stage partial`: `RESULT PASS stage=partial fail=0 pending=62`. The PENDING lines are the 61 population entries plus the not-yet-written run evidence. No line names `test/realpath/harnessCapture.test.ts`, and the output is byte-identical across two runs.
- `node $T .planning/audit/tools/check.ts --stage triage`: exit 1, `fail=62` (61 entries without a record, plus the missing run-evidence file). This is expected until the triage plans and 23-16 finish.
- `node $T .planning/audit/tools/check.ts --stage consolidation`: PASS, with the same 62 PENDING.
- `node $T .planning/audit/tools/check.ts --stage final`: no line starting `FAIL ledger/ROOT.json`. 16 FAILs remain, all from other Phase 23 plans' files (TESTI, TESTU, SCRIPTS and CONTRACTS rows). See Issues.
- `node $T .planning/audit/tools/set-triage.ts --help`: exit 0.
- `grep -n "may not be closed as NOT-A-BUG in Phase 22" .planning/audit/tools/check.ts`: prints nothing.
- Mutation proof (scratch copy, `TS_NODE_PROJECT` set to the repo tsconfig): 17 mutants were all caught. They covered: the stage branch, the zone name check, the reserved literal, the PENDING/FAIL switch, the frozen IDs, the freeze-severity tier, spread voiding a claim, the per-finding ruling match, the marker boundary, acknowledgement, aliased imports, set-triage keeping `verified`, the confirmed rule, the zone filter for evidence, the shared-cause rule, `open_claims`, and NAC-10.
- Real-path writer check on a scratch copy of the real register: `set-triage.ts --root <copy>` on AUD-BUY-002 and AUD-RAIL-001, then `check.ts --root <copy> --stage partial`, reported exactly the expected FAILs (no test file, no knownBug call, no closes-finding marker). The real `findings/` folder was untouched.

## Decisions Made

See `key-decisions` in the frontmatter. In short:
- The population is 61, for the reasons above.
- The S0/S1 rules hold on the severity at the freeze too, so a downgrade cannot drop the ruling a NOT-A-BUG closure needs.
- NOT-A-BUG needs triage evidence at every severity.
- `confirmed` needs a `test_id`.
- A citation of an entry that has no record yet is unfinished work (PENDING until stage triage), not a contradiction.

## New findings and grade/status changes

None. No bug outside the register was found, and no severity or status was changed. The two diffs reviewed for ledger rows held no defect: 23-02's change to `scripts/check-vi-mock-paths.ts`, and the Phase 23 changes to `.gitignore`, `package.json` and `vitest.config.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `--stage partial` already failed at HEAD**
- **Found during:** Task 1 baseline.
- **Issue:** `FAIL ledger/SCRIPTS.json [12] scripts/check-vi-mock-paths.ts.audited_sha`. Plan 23-02 (commit 1669fa5) edited a file added after the audit base, and its ledger row did not reach the new last-change SHA. The plan's verify needs partial to exit 0. The 23-02 SUMMARY did not record running partial.
- **Fix:** I reviewed the diff (`git diff 27f21a8 1669fa5 -- scripts/check-vi-mock-paths.ts`: exports added, and `resolves()` became a wrapper over `resolveSpecifier()` with the same truthiness on every branch). I appended a `re_audit` row with findings none.
- **Files modified:** `.planning/audit/ledger/SCRIPTS.json`. **Commit:** 80fc242.

**2. [Rule 3 - Blocking] Two more ROOT rows than the plan measured**
- **Found during:** Task 2.
- **Issue:** The plan measured one `--stage final` FAIL (`.gitignore`). At HEAD, `package.json` and `vitest.config.ts` also had `FAIL ledger/ROOT.json` lines, from 23-01 and 23-02. The acceptance criterion is "no line beginning `FAIL ledger/ROOT.json`".
- **Fix:** I reviewed all three diffs and added `re_audit` rows with findings none. The notes say what changed.
- **Files modified:** `.planning/audit/ledger/ROOT.json`. **Commit:** f20a810.

**3. [Rule 2 - Correctness] Output must stay byte-deterministic**
- **Found during:** Task 2 verify.
- **Issue:** The message for a missing evidence or population file embedded the ENOENT absolute path.
- **Fix:** `fileProblem()` prints "missing", or the parse error with the path replaced by the register-relative name.
- **Commit:** f20a810.

**4. [Rule 3 - Structure] Shared constants moved to `lib.ts`, which is not in the plan's files_modified**
- **Issue:** `set-triage.ts` and `check.ts` need one definition of the outcomes and ID formats. `check.ts` imports `set-triage.ts` for its self-test, so importing in the other direction would make the two files import each other.
- **Fix:** The constants live in `lib.ts`, the existing home for shared register constants. `LIFECYCLE_TEXT` was left unchanged so the sealed render bytes do not move.
- **Commit:** f20a810.

**5. [Rule 2 - Correctness] Rules added beyond the plan's list, each with a self-test**
- NOT-A-BUG evidence is required at all severities, not only S2 and lower, as Requirement 3 states.
- `confirmed` requires `test_id`.
- The S0/S1 rules also hold on the freeze severity.
- The register must follow each ruling (not-a-bug or keep-open).
- A record with no operator response holds no acknowledgement or ruling.
- A spread after `claim` voids the literal.
- `manual_evidence` must name an existing file.
- `fork_question` is required with `needs_fork`.
- `default`, `require()`, `import()` and `import =` forms of the marker module are refused.
- The scan covers `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`.
- Population file shape is validated (sorted, count, `severity_at_freeze`).
- Commit: 80fc242 and f20a810.

**6. [Population count] 61 instead of 59.** The register at HEAD wins, as the orchestrator instructed; see "Population count". There was no stop.

---

**Total deviations:** 6 (2 blocking ledger rows, 1 determinism fix, 1 structural, 1 rule set wider than listed, 1 count correction). **Impact:** all are needed for correctness or to meet the plan's own acceptance criteria. There is no scope creep outside `.planning/audit/`.

## Issues Encountered

- **The mutant harness first reported every mutant as missed.** Every run crashed with TS5109: outside the repo, ts-node had no tsconfig. I diagnosed this rather than trusting the result. With `TS_NODE_PROJECT` pointing at the repo tsconfig, the unmutated control copy passed 50/50 and all 17 mutants were caught.
- **`--stage final` still has 16 FAILs.** They are ledger rows and `re_audit` entries for files that 23-01, 23-02 and 23-03 added or edited (the realpath harness, migration goldens, testDb, CI workflow, `check-realpath-mocks.ts`). The plan expected final to fail again after later commits. It is Phase 22 machinery, and `--stage triage` is this phase's gate.
- **For later plans:** `set-triage.ts` will re-lay out `findings/AUD-RAIL-001.json` (and AUD-OD21-001 if it is ever written) once, because those files use inline arrays. The values do not change, and the tool says so.
- **For later plans:** a Phase 23 commit that edits a file added after the audit base (for example a Phase 22 rail or script file) makes `partial` and `triage` fail until a reviewed `re_audit` row reaches its last-change SHA. This is written in PROTOCOL.md section 7.
- **For later plans:** the scan reads the working tree, so run `--stage triage` on a committed tree.

## Known Stubs

None.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- Wave 5 triage plans (23-05 to 23-15) can record outcomes with `set-triage.ts`. `--stage partial` shows their progress as PENDING.
- 23-16 must write `inputs/triage-evidence.json` and `reviews/TRIAGE-REVIEW-01.json` in the validated shapes. The `acknowledged` list must include every confirmed entry that is S0/S1 now or was at the freeze. Rulings may be keyed only by population IDs. AC-08, AC-11 and AC-17 are then proven by `check.ts --stage triage`.

## Self-Check: PASSED

- FOUND: `.planning/audit/tools/check.ts`, `.planning/audit/tools/set-triage.ts`, `.planning/audit/tools/lib.ts`, `.planning/audit/PROTOCOL.md`, `.planning/audit/ledger/ROOT.json`, `.planning/audit/ledger/SCRIPTS.json`, `.planning/audit/inputs/triage-population.json`
- FOUND commits: `80fc242`, `f20a810` (both ancestors of HEAD)
- `checkTriage` is present in check.ts. "Phase 23 triage record" is present in PROTOCOL.md.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
