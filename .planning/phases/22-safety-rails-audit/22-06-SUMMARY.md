---
phase: 22-safety-rails-audit
plan: 06
subsystem: database
tags: [forensics, sqlite, better-sqlite3, wal, audit-register, escalation, rail]

requires:
  - phase: 22-01
    provides: "verified off-repo backup of data/ (dated folder 2026-11-06, MANIFEST sha256 9e28e30f...) and backup-state.ts --verify"
  - phase: 22-04
    provides: "audit register schema, PROTOCOL.md, check.ts / render.ts, AUD-RAIL-002"
provides:
  - "scripts/forensic-db.ts: two-image (17:33 checkpoint vs 20:25 WAL-merged) read-only forensic report with WAL commit-point replay, sqlite_sequence read, free-byte residue scan, literal provenance and attribution classes, --self-test (31 checks)"
  - "AUD-FORENSIC-001 (S2 / EXPOSURE, tag rail, candidate) linked to ESC-FORENSIC-01"
  - ".planning/audit/inputs/forensic-summary.json (metadata only; full trade report stays outside the repo)"
  - "ESC-FORENSIC-01: operator acknowledged, no ruling, no decimal phase, phase continues"
affects: [22-05, 22-07, 22-08, 22-09, 22-10, 22-28, 22-29, phase-23, phase-24]

actuals:
  tokens: 26200
  tasks: 2
  commits: 4
plan_head_before: 6e5c346569fc9f15be012436d94baa9ae817e2f9
plan_head_after: 2a4fc8cce13b6505bf3cd7f9ff48a7c5b18ee0fe

tech-stack:
  added: []
  patterns:
    - "Forensic DB inspection: byte-copy E (hashed, never opened) -> disposable W/R copies are the only files SQLite opens -> serialize() -> header bytes 18-19 patched 2->1 -> new Database(buffer, {readonly: true})"
    - "Literal match is not authorship: provenance (synthetic / public-historical / production-constant) plus corroboration required before attributed-test-write"
    - "Deterministic reports: sorted keys and rows, no timestamps in report.json; times and hashes in a separate run-meta.json"

key-files:
  created:
    - scripts/forensic-db.ts
    - .planning/audit/findings/AUD-FORENSIC-001.json
    - .planning/audit/inputs/forensic-summary.json
    - .planning/audit/escalations/ESC-FORENSIC-01.json
  modified: []

key-decisions:
  - "Forensic result: zero row changes 17:33->20:25 in all five tables (WAL replayed at all 40 commit points); 40 page-1 header writes with user_version 7 are the import-time fingerprint of src/utils/db.ts, recorded as actual-occurrence evidence for AUD-RAIL-002"
  - "The 3 literal-matched rows (LADYS trades 2 and 3 + LP baseline) are public-historical, not attributed to tests; tag test-origin-db-row not set; status stays candidate"
  - "Deleted trade id 1 (sqlite_sequence = 3, deleted before 17:33) remains unexplained: content unrecoverable, origin unknown; the operator gave no explanation"
  - "Operator (ESC-FORENSIC-01) acknowledged and declined a decimal phase: ruling none, phase_continued true; the live data/ folder stays untouched (P3)"

patterns-established:
  - "Escalation close-out: operator words verbatim with operator_response_recorded_at and operator_response_channel, per the ESC-SECRET-01 pattern"

requirements-completed: [SAFE-01, AUDIT-01]

coverage:
  - id: D1
    description: "forensic-db.ts proves the two-image method, WAL-only and transient rows, attribution classes S/P/U, integrity-failure exit 1, STL-3 control, byte-identical rerun, and E unchanged"
    requirement: "SAFE-01"
    verification:
      - kind: integration
        ref: "node node_modules/ts-node/dist/bin.js scripts/forensic-db.ts --self-test (Node 22.16.0): SELF-TEST OK, 31 checks"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two real runs on the backup copy produce byte-identical reports and the backup folder verifies unchanged; check partial FORENSIC passes with no PENDING"
    requirement: "AUDIT-01"
    verification:
      - kind: other
        ref: "Task 2 verify 1: cmp run1/run2 report.json && backup-state.ts --verify <dated_folder> && check.ts --stage partial --slice FORENSIC"
        status: pass
      - kind: other
        ref: "Task 2 verify 2: attribution/provenance/tag/escalation-link node check (literal matches 3, attributed 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Operator saw the forensic result at a blocking-human checkpoint and the verbatim response is recorded in ESC-FORENSIC-01"
    requirement: "AUDIT-01"
    verification:
      - kind: manual_procedural
        ref: ".planning/audit/escalations/ESC-FORENSIC-01.json (operator_response verbatim, recorded 2026-11-07T03:47:48Z)"
        status: pass
    human_judgment: true
    rationale: "Whether the operator's acknowledgement is adequate for the unexplained deleted trade id 1 is an operator judgment, not something a test can assert"

duration: 41min
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 06: Forensic Inspection of the Backed-up Live DB Summary

**Read-only two-image forensic report on a copy of the backed-up live DB: zero row changes between 17:33 and 20:25 across all five tables, 40 header-only opens fingerprinting src/utils/db.ts, three public-historical LADYS literal matches (not attributed to tests), and deleted trade id 1 still unexplained. Registered as AUD-FORENSIC-001 and acknowledged by the operator in ESC-FORENSIC-01.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-11-07T03:09:43Z
- **Completed:** 2026-11-07T03:50:00Z
- **Tasks:** 2 of 2 (one blocking-human checkpoint)
- **Files modified:** 4 created

## Accomplishments

- `scripts/forensic-db.ts`: copies the backup's `data/` files to E (hashed, never opened), opens only disposable copies (W for the merged image, a fresh R per WAL commit point for the replay), serializes them, patches header bytes 18-19 and reads both images in memory. It reports counts, the full `pause_state` and `chain_state` rows, the B -> A row diff, `sqlite_sequence`, leftover hex values in free bytes, literal matches with provenance and attribution, and extraction limits. Integrity failures are fatal (exit 1). Self-test: 31/31 checks pass.
- Real result, run twice on the backup copy with byte-identical reports (`report.json` sha256 `10b77e6d...8cec42`, outside the repo at `C:\Users\jackc\crypto-snipe-bot-backups\forensics-2026-11-06\run1\report.json`):
  - 0 rows added, changed or removed in `trades`, `exit_state`, `pause_state`, `chain_state` or `lp_baseline`. The WAL was replayed at all 40 commit points and no transient row appeared.
  - The 40 WAL frames are page-1 commits with `user_version` 7. That is the fingerprint of loading `src/utils/db.ts` (import-time open plus `migrateSchema`), a temp-DB probe reproduced it, and it is recorded as actual-occurrence evidence for AUD-RAIL-002.
  - The kill-switch reads not paused and there are no exit-state rows, at both instants.
  - 3 literal matches, all LADYS (trades 2 and 3 plus the LP baseline), classed `public-historical-literal`. 0 rows are attributed to tests, 0 are uncorroborated and 0 diff rows have unknown origin.
  - `sqlite_sequence` = 3 shows trade id 1 existed before 17:33 and was deleted. Its content cannot be recovered and its origin is unknown.
  - `integrity_check` ok on both images. The backup verifies unchanged before and after.
- AUD-FORENSIC-001 registered (S2 / EXPOSURE, tags [rail], candidate, related AUD-RAIL-002) and linked to ESC-FORENSIC-01. `check.ts --stage partial --slice FORENSIC`: PASS, 0 fail, 0 pending, 0 warn.
- The operator's acknowledgement is recorded verbatim in ESC-FORENSIC-01: "Ok I’ve seen this. No mini phase, proceed as normal". Ruling none, `phase_continued` true.

## Task Commits

1. **Task 1: Build scripts/forensic-db.ts and prove it on fixture WAL DBs** - `bee0237` (feat), `2561d5e` (fix: WAL commit replay, sqlite_sequence, residue scan)
2. **Task 2: Two real runs, register AUD-FORENSIC-001, escalate** - `8c01ff9` (feat: finding and summary, escalation pending), `2a4fc8c` (feat: ESC-FORENSIC-01 and escalation_ref)

**Plan metadata:** recorded in the docs(22-06) completion commit

## Files Created/Modified

- `scripts/forensic-db.ts` - the forensic tool (`--source/--out/--test-literals-sha`, `--self-test`); asserts ABI 127 (Node 22.16.0)
- `.planning/audit/findings/AUD-FORENSIC-001.json` - the registered forensic result, `escalation_ref` ESC-FORENSIC-01
- `.planning/audit/inputs/forensic-summary.json` - metadata-only summary (counts, state rows, classified literal matches, extraction limits, report path and sha256)
- `.planning/audit/escalations/ESC-FORENSIC-01.json` - the single escalation record (immediate tier, tags [rail]) with the operator's verbatim reply

## Static Review (Task 1 acceptance)

- `grep -c immutable scripts/forensic-db.ts` = 0.
- `grep -cE "readFileSync|copyFileSync"` = 14.
- `new Database(` call sites in the real-run path: line 477 opens a Buffer (readonly); line 1218 opens W's `bot.db` (a byte copy of E); line 1014 opens `R/bot.db`, a fresh temp copy of E's main-file bytes plus a truncated WAL, made per commit point for the replay. R is as disposable as W and was added by the Rule 2 deviation below. E, the backup folder and the live `data/` folder are never opened. Lines 1415, 1432, 1565, 1574, 1582 and 1599 are self-test fixtures under `os.tmpdir()`, including the STL-3 unpatched-buffer control.

## Decisions Made

- The literal-matched LADYS rows are public-historical and consistent with the Phase 21 live capture. They are not attributed to tests, so `test-origin-db-row` is not set and the status stays candidate. Severity is S2 / EXPOSURE: the boundary was crossed (40 opens wrote the header), but no row changed. The S1 mechanism is graded in AUD-RAIL-002.
- The summary file is named in an evidence note, not as an evidence ref, because the anti-anchoring check (`lib.ts:72`, `/SUMMARY/i`) would reject `forensic-summary.json` as a ref.
- Operator ruling: none. There is no decimal phase and Phase 22 continues. The deleted trade id 1 stays an open, unexplained item in AUD-FORENSIC-001, because the operator gave no explanation and none is invented here.
- The render was validated only, into a temp dir. Per PROTOCOL.md section 6, only 22-04, 22-28 and 22-29 commit the canonical `AUDIT-FINDINGS.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Closed the two-image blind spot**
- **Found during:** Task 1 / first real run
- **Issue:** A plain 17:33-vs-20:25 diff cannot see rows that were inserted and then deleted, or changed and then changed back, inside the WAL window. It also cannot see rows deleted before 17:33.
- **Fix:** Added a frame-by-frame WAL commit-point replay (a fresh disposable copy R per commit point), a `sqlite_sequence` read in both images, and a free-byte scan of the main file and WAL for leftover hex values. Added `pair_or_pool_address` to the columns matched against test literals.
- **Files modified:** scripts/forensic-db.ts
- **Verification:** self-test cases for transient rows (R/V/T) and residue (RES) pass, 31/31
- **Committed in:** 2561d5e

**2. [Rule 1 - Bug] STL-3 control assumed the wrong failure point**
- **Found during:** Task 1 self-test
- **Issue:** This better-sqlite3 build accepts an unpatched WAL-mode buffer in `new Database(buf)`. It refuses only at the first read, so a constructor-only control falsely failed.
- **Fix:** The control now issues a read on the unpatched image and expects the refusal there. The patched image reads all rows.
- **Files modified:** scripts/forensic-db.ts
- **Verification:** "unpatched buffer refused" PASS
- **Committed in:** bee0237 / 2561d5e

**3. [Rule 1 - Bug] Free-byte scanner missed values stored back to back**
- **Found during:** Task 1 self-test (residue case)
- **Issue:** SQLite stores column values back to back with no separator. A word-boundary regex therefore missed hex values next to other hex.
- **Fix:** The scanner now tests 40- and 64-hex prefixes at every `0x` occurrence.
- **Files modified:** scripts/forensic-db.ts
- **Verification:** residue self-test PASS
- **Committed in:** 2561d5e

**Process notes (not code deviations):**
- The finding was committed first with `escalation_ref: null` (8c01ff9; PENDING at check partial until the operator answered) and linked to ESC-FORENSIC-01 after the reply (2a4fc8c).
- The first real run, made with the older tool (bee0237), is kept outside the repo as `run0-superseded-tool-bee0237`. The authoritative runs are run1 and run2.
- ESC-FORENSIC-01 carries an extra `ruling_note` key explaining "none". The checker accepts it.

---

**Total deviations:** 3 auto-fixed (1 Rule 2 missing critical, 2 Rule 1 bugs)
**Impact on plan:** All three strengthen the forensic claim ("no row changed") against blind spots in the plan's original method. No scope creep: no `src/` change and nothing under the live `data/` folder was read.

## Issues Encountered

- Deleted trade id 1 cannot be explained from the data. It was deleted before 17:33, and neither image nor the free bytes hold its content. Which program made the 40 opens is also not determined (the timing fits the 2026-05-29 development window). Both stay open in AUD-FORENSIC-001.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AUD-FORENSIC-001 and ESC-FORENSIC-01 are complete and pass check partial. The SAFE-02 rails (22-05, 22-07..22-10) are what stop new test opens of the live DB.
- Any later decision about trade id 1 or a DB cleanup is an operator decision for a later phase. The live `data/` folder stays untouched (P3, NAC-13).

## Self-Check: PASSED

- FOUND: scripts/forensic-db.ts, .planning/audit/findings/AUD-FORENSIC-001.json, .planning/audit/inputs/forensic-summary.json, .planning/audit/escalations/ESC-FORENSIC-01.json
- FOUND commits on this branch: bee0237, 2561d5e, 8c01ff9, 2a4fc8c
- Task 2 verify 1 (cmp + backup verify + check partial) exit 0; verify 2 exit 0; check partial FORENSIC 0 pending; render validated

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
