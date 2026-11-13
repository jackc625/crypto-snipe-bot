# Phase 23: Test Safety Net (Harness, Triage, Characterization) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-09
**Phase:** 23-test-safety-net-harness-triage-characterization
**Mode:** `--analyze` (trade-off table before each question), with `research_before_questions` on
**Areas discussed:** Fake chain and clock, Known-bug test marking, Recording format, Register and seal

---

## Fake chain and clock

### How the fake blockchain connects to real ethers

| Option | Description | Selected |
|--------|-------------|----------|
| In-process + real failures (Recommended) | Requests stay in the test process; a few connection-failure tests use the real WebSocket library on a local port | ✓ |
| In-process only | Simplest and repeatable; WebSocket failures are imitated | |
| Real local sockets only | Real HTTP and WebSocket on 127.0.0.1; real time puts AC-12 and AC-24 at risk | |

**User's choice:** In-process + real failures

### How much of a real node the fake imitates

| Option | Description | Selected |
|--------|-------------|----------|
| Simulated node (Recommended) | Real signed transaction, nonce and chain ID enforced, real hash, mining on command; contract reads from a table | ✓ |
| Scripted answers per test | Quick and controlled; easy to return impossible responses | |

**User's choice:** Simulated node

### What the fixed clock controls

| Option | Description | Selected |
|--------|-------------|----------|
| All time, stepped by test (Recommended) | Date and every timer are fake; the test moves time forward | ✓ |
| Only the date | Less setup; poll loops wait real time | |
| All time, auto-advancing | No stepping; order can vary between runs | |

**User's choice:** All time, stepped by test

### Where a recorded scenario enters the bot

| Option | Description | Selected |
|--------|-------------|----------|
| Fake chain event (Recommended) | A real log enters the real listener; only the outer edge is named | ✓ |
| Exported handler | Less setup; skips listener wiring and dedup; tied to a function Phase 27 splits | |
| Full startup every time | Most complete; every recording captures startup | |

**User's choice:** Fake chain event

---

## Known-bug test marking

### What counts as "this known bug is proven"

| Option | Description | Selected |
|--------|-------------|----------|
| Named assertion + recorded (Recommended) | Only the marked assertion failing with stored values counts | ✓ |
| Any assertion failure | Rejects setup errors and timeouts; a different assertion could read as proof | |

**User's choice:** Named assertion + recorded
**Notes:** Vitest `it.fails` was presented as ruled out by AC-09.

### Where the real-path tests live

| Option | Description | Selected |
|--------|-------------|----------|
| New project, in npm test (Recommended) | Own folder, part of `npm test` and CI, rails on | ✓ |
| Subfolder of integration | No config change; the mock-list check needs a carve-out | |
| New project, on request only | Keeps `npm test` fast; breakage shows late | |

**User's choice:** New project, in npm test

### How the known-bug tests are split

| Option | Description | Selected |
|--------|-------------|----------|
| One file per root cause (Recommended) | Named after the lead finding; parallel agents never collide | ✓ |
| One file per code area | Fewer files; parallel work collides | |

**User's choice:** One file per root cause

### Form of the end-of-triage batch

| Option | Description | Selected |
|--------|-------------|----------|
| One report, few rulings (Recommended) | Generated from recorded failures; individual rulings only where required | ✓ |
| Walk through each finding | Individual attention; about 49 separate stops | |

**User's choice:** One report, few rulings

---

## Recording format

### Storage

| Option | Description | Selected |
|--------|-------------|----------|
| One file per scenario (Recommended) | LF-only, tag inside; the commit check reads git directly | ✓ |
| One combined file | One thing to open; the check must parse before and after | |

**User's choice:** One file per scenario

### Shape

| Option | Description | Selected |
|--------|-------------|----------|
| One ordered timeline (Recommended) | Everything in the order it happened | ✓ |
| Separate list per kind | Smaller diffs; order between kinds is lost | |

**User's choice:** One ordered timeline

### DB write capture

| Option | Description | Selected |
|--------|-------------|----------|
| Triggers + recording function (Recommended) | Test-only triggers from the migrated schema; researcher proves first | ✓ |
| Record SQL and parameters | Simple; rewording a query changes the recording | |
| Compare tables before/after | Simplest; loses order and intermediate state | |

**User's choice:** Triggers + recording function

### Env snapshot contents

| Option | Description | Selected |
|--------|-------------|----------|
| Baseline + differences (Recommended) | One full result, then only what each case changes | ✓ |
| Full config every case | Each case stands alone; 450+ copies | |

**User's choice:** Baseline + differences

### Commit check coverage of the env snapshot

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, cover it (Recommended) | A `refactor:` or `deps:` commit can't quietly regenerate it; a small addition to the spec | ✓ |
| No, recordings only | Matches the spec's wording exactly | |

**User's choice:** Yes, cover it

---

## Register and seal

### Reconciling the Phase 22 seal

| Option | Description | Selected |
|--------|-------------|----------|
| Successor seal (Recommended) | `SEAL.json` untouched; a new seal points back and covers the audit folder only; merge flaw fixed | ✓ |
| Widen the exempt list | Quickest; the register could change with no record | |
| Separate outcomes layer | Finding files untouched; status lives in two places | |

**User's choice:** Successor seal
**Notes:** The operator was told that the seal tool already reports INVALID at HEAD, from a merge-counting flaw plus 9 unrelated files, with no register content changed.

### Standing signing census home

| Option | Description | Selected |
|--------|-------------|----------|
| Promote into scripts/ (Recommended) | npm command and CI step, keeps the type-aware analysis and self-tests | ✓ |
| Wrapper importing sealed tool | No duplication; CI depends on a planning folder | |
| Rewrite as simple text scan | Fast; loses type information | |

**User's choice:** Promote into scripts/

### Citing a non-behavior recording change

| Option | Description | Selected |
|--------|-------------|----------|
| Its own ID each time (Recommended) | A small register entry states why | ✓ |
| One standing card | Little paperwork; a real behavior change could cite it | |

**User's choice:** Its own ID each time

### Register enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Mechanical enforcement (Recommended) | `check.ts` requires one outcome and its evidence for each of the 59 | ✓ |
| Lift the ban only | Smallest change; relies on reading 59 entries by hand | |

**User's choice:** Mechanical enforcement

---

## Claude's Discretion

Not discussed. The operator was told these go to the planner's judgment.

- How each of the 11 source-text tests is converted
- Census exception format
- Env-matrix mechanics
- Folder, file, field and command names
- How the mock-list check is built
- Plan and wave breakdown

## Deferred Ideas

None.
