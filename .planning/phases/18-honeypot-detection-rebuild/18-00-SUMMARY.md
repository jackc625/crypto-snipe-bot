---
phase: 18-honeypot-detection-rebuild
plan: 00
subsystem: requirements
tags: [requirements, honey-12, wave-0, traceability]
requires: []
provides:
  - "HONEY-12 row in .planning/REQUIREMENTS.md (bytecode selector-presence scan; isMutableTokenForChain)"
  - "Traceability row: HONEY-12 → Phase 18 → Pending"
  - "Coverage footer updated: v1 54 / HONEY 12 / mapped 54"
affects:
  - "Wave-1 Phase 18 plans (18-01, 18-03, 18-09, 18-10) — can now reference HONEY-12 by ID without forward-reference race"
tech-stack:
  added: []
  patterns:
    - "Wave-0 pre-wave plan: pure-documentation REQ-ID locking before any wave-1 plan that references the ID executes"
key-files:
  created: []
  modified:
    - .planning/REQUIREMENTS.md
decisions:
  - "Acceptance-criterion text pins the function signature `isMutableTokenForChain(ctx, token)` exactly, the result type `{ isMutable: boolean; hits: string[] }`, the wire-up point (parallel safety bank at `src/bot.ts:229-238`), the data source (`provider.getCode` + 19-selector table in 18-RESEARCH.md), and the fail-closed policy on getCode throw — all driven by D-BYTECODE in 18-CONTEXT.md so downstream plans have a single source of truth they can grep against."
  - "Coverage line restated as `HONEY 12` (was `HONEY 11`) plus v1 total 53 → 54 and mapped 53 → 54; comma-after-`12` preserves the existing comma-separated category list shape (`DEBT 6, HONEY 12, ANTIRUG 12, OPS-LIVE 13, EXIT-LIVE 11`)."
  - "Traceability row inserted between HONEY-11 and ANTIRUG-01 to keep HONEY contiguous; matches table-ordering convention used for all other category groupings."
metrics:
  duration: "<5 minutes"
  completed_date: "2026-05-16"
  tasks_total: 1
  tasks_completed: 1
  files_modified: 1
  lines_added: 4
  lines_removed: 2
---

# Phase 18 Plan 00: Honeypot Detection Rebuild Wave-0 (REQUIREMENTS.md HONEY-12 row) Summary

Add the HONEY-12 row to `.planning/REQUIREMENTS.md` BEFORE any Phase 18 wave-1 plan references it — closes the iter-1 plan-checker chicken-and-egg Blocker #2 (plans 18-03 / 18-09 / 18-10 list `HONEY-12` in their `requirements:` frontmatter; the row must exist in REQUIREMENTS.md first).

## What Was Built

One bullet row (HONEY-12), one traceability table row, and a coverage-footer update in `.planning/REQUIREMENTS.md`. No code, no contracts, no tests.

The HONEY-12 acceptance-criterion text pins (a) the exact function signature `isMutableTokenForChain(ctx, token)`, (b) the data-source `provider.getCode` + the 19-selector table at `.planning/phases/18-honeypot-detection-rebuild/18-RESEARCH.md` §"Bytecode Selector Scan (HONEY-12) — Verified Selector Table", (c) the result type `{ isMutable: boolean; hits: string[] }`, (d) the wire-up point `parallel safety bank at src/bot.ts:229-238` per D-BYTECODE in `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md`, (e) the fail-closed policy on `getCode` throw per `.planning/phases/18-honeypot-detection-rebuild/18-RESEARCH.md` §7 lines 1026-1030, and (f) the scope-cap suffix `~50 LOC; no contract deploy.` per CONTEXT.md line 115.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add HONEY-12 requirement to REQUIREMENTS.md | 85fcd2b | .planning/REQUIREMENTS.md |

## Verification Results

The plan's automated verification command (Task 1 `<verify><automated>`) passed cleanly:

```text
$ node -e "const f=require('fs').readFileSync('.planning/REQUIREMENTS.md','utf8');
  if(!/\*\*HONEY-12\*\*/.test(f)) process.exit(1);
  if(!/isMutableTokenForChain/.test(f)) process.exit(2);
  if(!/\| HONEY-12 \| Phase 18 \| Pending \|/.test(f)) process.exit(3);
  if(!/HONEY 12/.test(f)) process.exit(4);
  if(!/~50 LOC/.test(f)) process.exit(5);
  console.log('OK')"
OK
```

Exit code 0. All five required substrings present.

Additional acceptance-criteria assertions (run separately against the same file):

- `provider.getCode` substring present ✓
- `parallel safety bank` substring present ✓
- Bullet ends with `~50 LOC; no contract deploy.` (whole-line match) ✓
- Coverage line reports `v1 requirements: 54 total` ✓
- Coverage line reports `HONEY 12,` (not `HONEY 11`) ✓

## Deviations from Plan

None — plan executed exactly as written. The single task ran end-to-end with no Rule 1/2/3 auto-fixes triggered, no Rule 4 architectural decisions surfaced, no authentication gates, and no checkpoints. The plan's `<verify>` command exited 0 on first run.

## Authentication Gates

None.

## Threat Model Compliance

Plan's `<threat_model>` lists two threats:

- **T-18-00-01 (Tampering — REQUIREMENTS.md HONEY-12 row text), disposition: mitigate.** Mitigation per plan: "Verify command grep-asserts the exact substrings; downstream plans pin to the same text via `<read_first>` references." Satisfied — the executed `<verify><automated>` grep-asserts 5 substrings (`**HONEY-12**`, `isMutableTokenForChain`, the exact traceability row, `HONEY 12`, `~50 LOC`); downstream plans 18-01 / 18-03 / 18-09 / 18-10 are pinned to this text via their `<read_first>` references to REQUIREMENTS.md HONEY-12 and the same 18-CONTEXT.md / 18-RESEARCH.md source paragraphs.
- **T-18-SC (Tampering — npm/pip installs), disposition: accept.** No package installs in this plan; pure documentation edit. Disposition honored.

## Known Stubs

None. This is a documentation-only plan; HONEY-12 is the acceptance-criterion specification only — the implementation (`src/utils/honeypot/bytecodeScan.ts` per RESEARCH.md and 18-03-PLAN.md) ships in Phase 18 Wave 1. That is the intended design of this Wave-0 plan, not a stub.

## Self-Check: PASSED

- `.planning/REQUIREMENTS.md` exists and contains the new HONEY-12 row, traceability entry, and updated coverage footer (all verified via the plan's `<verify>` command above).
- Commit `85fcd2b` exists on master:
  ```text
  $ git rev-parse --short HEAD
  85fcd2b
  ```

## Success Criteria Status

Plan's `<success_criteria>` block:

> HONEY-12 is a first-class requirement in REQUIREMENTS.md before any wave-1 plan reads or references it. The chicken-and-egg from iter-1 plan-checker Blocker #2 is closed.

**Status: MET.** HONEY-12 is the 12th HONEY requirement, listed in the Honeypot Detection Rebuild section, mapped to Phase 18 in the Traceability table, and counted in the coverage footer (v1 54, HONEY 12, mapped 54). Wave-1 plans 18-01 / 18-03 / 18-09 / 18-10 can now reference `HONEY-12` by ID without forward-reference race.

## Must-Haves Check (from plan frontmatter)

- ✓ "REQUIREMENTS.md HONEY-12 row exists with the bytecode-scan acceptance criteria committed BEFORE any wave-1 plan references it" — committed in `85fcd2b`; wave-1 plans not yet started.
- ✓ "Traceability table contains HONEY-12 row" — `| HONEY-12 | Phase 18 | Pending |` inserted after HONEY-11, before ANTIRUG-01.
- ✓ "Coverage footer reflects updated counts (HONEY 12, v1 total 54)" — `v1 requirements: 54 total (DEBT 6, HONEY 12, ANTIRUG 12, OPS-LIVE 13, EXIT-LIVE 11)`; `Mapped to phases: 54`.

---

*Phase: 18-honeypot-detection-rebuild — Plan 00*
*Executed: 2026-05-16*
