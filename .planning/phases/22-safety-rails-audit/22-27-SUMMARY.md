---
phase: 22-safety-rails-audit
plan: 27
subsystem: audit
tags: [audit, second-opinion, codex, docker, containment, d-14]

requires:
  - phase: 22-safety-rails-audit
    provides: "Audit register, slice files and base SHA from the area audits 22-17 to 22-21"
provides:
  - "Independent second opinion from codex on the five money-handling slices, union-merged into the register"
  - "28 new register entries (3 S1, 6 S2, 11 S3, 8 S4), and codex added to reported_by on the existing entries it matched"
  - "Proven containment records for codex and agy, including an in-container run"
  - "List of 43 severity disagreements for plan 22-28 to re-grade against the code"
affects: [22-28, 22-29, phase-23, phase-24, phase-29]

actuals:
  tokens: 132540
  tasks: 3
  commits: 6
plan_head_before: 81a4f9e9e2cd4bfa3f4ead9485cdb3659d58285a
plan_head_after: b8ac1904b01da1065f59d55e763548d7a2659679

tech-stack:
  added: []
  patterns:
    - "Outside assistant run in a pinned, non-root, read-only container with no file or shell tools; approved files passed in the prompt with line numbers"
    - "Containment proven by decoys and a positive control, never inferred from flags or working folder"

key-files:
  created:
    - .planning/audit/external/CONFINEMENT.json
    - .planning/audit/external/MERGE.json
    - .planning/audit/external/codex/
    - .planning/audit/escalations/ESC-BUY-03.json
    - .planning/audit/decisions/proposed/BUY-09.json
    - .planning/audit/decisions/proposed/DB-07.json
    - .planning/audit/findings/AUD-BUY-027.json
    - .planning/audit/findings/AUD-BUY-028.json
    - .planning/audit/findings/AUD-BUY-030.json
  modified:
    - .planning/audit/findings/
    - .planning/audit/ledger/
    - .planning/audit/sweep/
    - .planning/audit/decisions/proposed/

key-decisions:
  - "Operator ruled codex a, agy c: codex runs only inside Docker, and agy is left out and sent nothing"
  - "Codex ran with no file or shell tools and the approved files in the prompt, because its inner sandbox cannot start in the locked-down container and loosening either was not approved"
  - "Operator acknowledged the three new BUY S1 entries (Acknowledge continue): no severity change, no decimal phase"
  - "D-14 is only partly covered: one outside assistant, not two; recorded as a deviation and not claimed as full coverage"
  - "Plan 22-28 must re-grade all 43 entries where codex said S1 and the register says lower, against the code at the audit base"

patterns-established:
  - "A probe that fails to run any command is void, not a pass: pair every decoy run with a positive control"

requirements-completed: [AUDIT-01, AUDIT-03]

coverage:
  - id: D1
    description: "Operator decisions recorded verbatim: both; codex a, agy c; Acknowledge continue"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "plan Task 3 automated verify (MERGE.json operator_decision present)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every assistant that received source passed a confinement check, and each run has its raw output and SHA-256"
    requirement: AUDIT-01
    verification:
      - kind: other
        ref: "plan Task 3 automated verify (unconfined 0, noRaw 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Union merge of 101 external findings with none dropped, and a reason recorded for every match"
    requirement: AUDIT-03
    verification:
      - kind: other
        ref: "plan Task 3 automated verify (dropped 0, nodedup 0) and check.ts --stage partial (fail 0, pending 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Grades on the 43 entries where codex said S1 and the register says lower"
    requirement: AUDIT-03
    verification: []
    human_judgment: true
    rationale: "Set or kept by the merge executor with no second reader yet; plan 22-28 re-grades them against the code."

duration: 27h 44m elapsed including a rate-limit stop and two operator decisions
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 27: Independent second opinion (D-14) Summary

**Codex reviewed the five money-handling slices from inside a locked-down container with no file or shell tools; its 101 findings merged into the register as 72 matches and 28 new entries, three of them S1, with agy excluded by operator ruling.**

## Performance

- **Duration:** 27h 44m elapsed for the continuation, including a rate-limit stop and two operator decisions. The five sends took about 66 minutes.
- **Started:** 2026-11-07T21:56:41Z (continuation after Task 2)
- **Completed:** 2026-11-09T01:41:01Z
- **Tasks:** 3
- **Files modified:** 120

## Accomplishments

- Sent 49 files (761,671 bytes at base 23a6461) to OpenAI, one slice per run. Each slice was re-verified against `SEND-LIST.txt` immediately before sending. Nothing was sent to Google.
- Saved all five raw answers with their SHA-256s before any normalising. All five match the schema, and codex reported reading every file in each slice.
- Merged 101 external findings with none dropped: 72 matched existing entries and 29 mapped to 28 new ones (S1: 3, S2: 6, S3: 11, S4: 8).
- Added ledger rows and sweep cells for the new entries, new cards BUY-09 and DB-07, and links from new findings to 12 existing cards.
- Escalated the three new S1 entries in `ESC-BUY-03`, and the operator acknowledged them.

## Containment results

| Assistant | Where | Result | Detail |
|---|---|---|---|
| codex | Host, `--sandbox read-only` | Failed | Read and printed both the canary and `package.json` |
| agy | Host, first run | Not a pass | Stopped at its first refused read with an empty answer, so most of the test never ran |
| agy | Host, one run per route, shell denied | Failed | File tool read the canary; `package.json` and the shell route were refused; logs give no reason |
| codex | Docker, first run | Void | Inner sandbox could not start, so every command failed and nothing was tested |
| codex | Docker, no tools | Passed | No commands ran, no decoy seen, no host path visible, and the control run came back correctly |

Every run of the final setup recorded the same conditions (`CONFINEMENT.json`):
- non-root user, all capabilities dropped, no-new-privileges, read-only root filesystem
- mounts limited to one read-only slice folder, an empty answer folder and the login file
- no Docker socket and no host network

After the sends:
- no container remains and no volume was kept
- the login file was unchanged in every run
- the decoy in the home folder was removed
- live `data/` still equals the backup manifest by raw hash, checked with `scripts/verify-prod-untouched.ts` (never through SQLite)

## Disclosure during the host probe

Because codex could read `package.json` in the host containment test, its full contents went to OpenAI: dependency names and scripts. The only key or secret word match in it is the npm field `"private": true`. The orchestrator confirmed by search that the raw probe outputs do not mention the real env file. OpenAI also received the probe question and a random canary token. Google received its probe questions and two random test tokens. Neither received any bot source during the probes.

## Tool and model versions

- codex-cli 0.163.0, confirmed inside the container, model `gpt-6.1-sol`, effort `xhigh`. Installed with `--ignore-scripts` into container memory only, integrity recorded in `CONFINEMENT.json`.
- agy 1.5.2, model `gemini-4-argon-high`, probes only.
- Base image `node@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`.
- No quota or rate-limit event from either assistant during the plan.

## P9 context

The orchestrator recommended sending to outside assistants because a review that saw none of our findings is the cleanest check on the P9 anchoring slip in plans 22-17 to 22-22. Codex received only `PROMPT.md`, the schema and the slice files. The merge step read the register only after the raw answers were saved. Evidence added here cites code at the audit base or commands run, never a VERIFICATION or SUMMARY document.

## Task Commits

1. **Task 1: isolated export, prompt, schema and send list** - `dbcb067` (docs)
2. **Task 2: operator decision and host containment results** - `07a9c21` (docs)
3. **Task 3: containment ruling and in-container pass** - `292c071` (docs)
4. **Task 3: codex raw outputs saved with SHA-256** - `3012b76` (docs)
5. **Task 3: union merge into the register** - `a4b42c1` (docs)
6. **Task 3: operator acknowledgement and 22-28 re-grade list** - `b8ac190` (docs)

## Files Created/Modified

- `.planning/audit/external/MERGE.json` - decisions, runs with raw SHA-256s, per-finding mapping, disagreements
- `.planning/audit/external/CONFINEMENT.json` - every containment run and the Docker conditions
- `.planning/audit/external/codex/` - raw and normalised answers per slice
- `.planning/audit/escalations/ESC-BUY-03.json` - the S1 batch and the operator's reply
- `.planning/audit/findings/` - 28 new entries and codex evidence added to matched entries
- `.planning/audit/ledger/`, `.planning/audit/sweep/` - new ids added
- `.planning/audit/decisions/proposed/` - new cards BUY-09 and DB-07, and links on 12 existing cards

## Decisions Made

- The operator's words are recorded verbatim, each attributed to the operator: "both", "codex a, agy c", "Acknowledge continue".
- Orchestrator recommendations are recorded separately and attributed to the orchestrator.
- The three new S1 entries wait for Phase 23 proof and Phase 24 fixes. Nothing is fixed in Phase 22.

## Deviations from Plan

### Recorded deviations

**1. [Operator ruling] D-14 only partly covered**
- The plan called for two outside assistants. One ran (codex). agy failed containment and was excluded by operator ruling ("codex a, agy c"). D-14 is satisfied only as far as the operator ruled and is not claimed as full coverage.

**2. [Rule 3 - Blocking] No-tools run with files in the prompt**
- **Found during:** Task 3, in-container test
- **Issue:** Codex's inner Linux sandbox needs user namespaces, which the container blocks, so no command could run. Turning that sandbox off or loosening the container was not approved.
- **Fix:** Shell and exec tools disabled and the approved files passed in the prompt with line numbers. `--sandbox read-only` stayed set. The same bytes went to the same place by a narrower route, with no extra access.
- **Verification:** Decoy run with zero commands; control run proving the content reaches the model.
- **Committed in:** 292c071

**3. [Rule 3 - Blocking] Two add-on overrides dropped in the container**
- `mcp_servers.base44.enabled` and `mcp_servers.node_repl.enabled` make codex fail in a fresh setup where those servers do not exist. `codex mcp list` proved no add-on server exists there.

**4. [Rule 2 - Missing critical] Extra isolation and stronger probes**
- Added `notify=[]`, web search off, restricted shell environment, more features off. `include_apply_patch_tool` and `tools.view_image` were ignored by this codex version, and no tool ran in any run.
- Split agy's probe into one run per route after the first result proved nothing, and added positive controls.

**5. [Rule 1 - Bug] Failed clean-up step caught and corrected before commit**
- **Found during:** Task 3 merge
- **Issue:** A step meant to clear misleading bug classes on seven new findings failed on a shell quoting error. Because the commands were chained, the merge applied anyway with those classes.
- **Fix:** A targeted script set the classes to empty and reverted the affected sweep cells before anything was committed.
- **Verification:** `check.ts --stage partial` passes with no failures.
- **Committed in:** a4b42c1

**6. [Plan detail] Finding schema root**
- `finding.schema.json` has an object root, because structured-output modes require one. The plan said a bare array.

**Total deviations:** 6 (2 from operator or plan constraints, 4 auto-fixed).
**Impact on plan:** The second opinion is narrower than planned, one assistant and not two. Containment is stronger than planned.

## Issues Encountered

- **43 grading disagreements:** codex rated 43 findings S1 that the register rates lower. They cover 39 register entries, 19 of them new here. Those grades were set or kept by the merge executor with no second reader yet, so they should not be taken as settled. `MERGE.json` `consolidation_required` tells plan 22-28 to re-grade all of them against the code at the audit base and to bring the operator anything that moves up to S1. Named examples: AUD-TX-020, AUD-EXIT-020, AUD-TX-012, AUD-TX-019. A further 18 findings carry smaller gaps and are in `severity_disagreements`.
- One API rate-limit interruption on the executor side, which did not affect the data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for plan 22-28. It must carry out the 43-entry re-grade. Proposed cards BUY-09 and DB-07 need numbering. AUD-BUY-030 needs a reproduction attempt in Phase 23.

## Self-Check: PASSED

Created files and all task commits verified to exist. `check.ts --stage partial` reported fail 0, pending 0. Render dry run succeeded. Both plan verify commands passed. Live `data/` equals the backup manifest.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*
