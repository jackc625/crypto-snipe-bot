---
phase: 18-honeypot-detection-rebuild
plan: 03
subsystem: honeypot
tags: [honeypot, honey-12, honey-02, bytecode-scan, mythril, wave-1, parallel-safety]
requires:
  - "18-00 (REQUIREMENTS.md HONEY-12 row)"
provides:
  - "src/utils/honeypot/bytecodeScan.ts — isMutableTokenForChain function + MUTABLE_SELECTORS table (HONEY-12 implementation)"
  - "test/unit/bytecodeScan.test.ts — 7 unit tests covering 6 behavior cases + 1 selector-table invariant"
  - "scripts/check-mythril-report.ts — HONEY-02 severity-gate CLI for Mythril JSON reports"
  - "test/fixtures/mythril/sample-{clean,high}.json — fixtures exercising both exit paths"
affects:
  - "Plan 18-09 — will wire isMutableTokenForChain into the parallel safety bank Promise.all at src/bot.ts:229-238"
  - "Plan 18-05 — will invoke check-mythril-report.ts on the Mythril JSON report produced by the audit job"
tech-stack:
  added: []
  patterns:
    - "Fail-closed catch in bytecode scan — returns { isMutable: true, hits: ['scan-failed'] } on getCode throw; deliberate inverse of isBlacklistedTokenForChain's propagating behavior"
    - ".toLowerCase() of bytecode before substring match — case-safe matching of mixed-case RPC responses"
    - "Severity-gate CLI pattern — zero new deps (fs + process only); structured stderr emission of blocking issues"
key-files:
  created:
    - src/utils/honeypot/bytecodeScan.ts
    - test/unit/bytecodeScan.test.ts
    - scripts/check-mythril-report.ts
    - test/fixtures/mythril/sample-clean.json
    - test/fixtures/mythril/sample-high.json
  modified: []
decisions:
  - "Marked HONEY-12 row Pending (NOT Complete) in REQUIREMENTS.md — the row's acceptance criterion explicitly references the parallel-safety-bank wire-up at src/bot.ts:229-238 which is plan 18-09's responsibility, not this plan's. Function-level implementation + tests are shipped here; the requirement closes when 18-09 lands the Promise.all 9th element."
  - "MUTABLE_SELECTORS declared as `readonly string[]` exported from the module rather than file-local — this lets the unit test pin `.length === 19` and assert each selector by name without re-listing them in the test fixture file. Refactor-resistant invariant."
  - "Selector list ordered to mirror 18-RESEARCH.md §'HONEY-12 Verified Selector Table' (setTax family first, then setBuyTax/setSellTax, then setFees, then setMaxWallet family, then blacklist/excludeFromFees, then trading-pause family). Easier to diff against the research source-of-truth."
  - "Mythril CLI emits per-issue details to stderr BEFORE the summary line (vs after, as the PATTERNS.md sketch had). Lets CI logs surface the actual blocking issues first, then the count line; more useful when grep-tailing CI output."
metrics:
  duration: "~5 minutes"
  completed_date: "2026-05-16"
  tasks_total: 2
  tasks_completed: 2
  files_created: 5
  files_modified: 0
  lines_added: 340
---

# Phase 18 Plan 03: HONEY-12 Bytecode Scan + Mythril Severity Gate Summary

Ships two parallel-runnable safety primitives the rest of Phase 18 consumes: (a) the HONEY-12 bytecode selector scan (`src/utils/honeypot/bytecodeScan.ts` + unit tests), and (b) the Mythril severity-gate CLI (`scripts/check-mythril-report.ts`) used by plan 18-05's audit job. Both are self-contained, zero new npm deps, and have no dependency on the deployed `HoneypotChecker` contract.

## What Was Built

**HONEY-12 bytecode scan** — `isMutableTokenForChain(ctx, tokenAddress)` performs a `getCode` + substring grep against 19 verified 4-byte selectors for mutable-tax / blacklist / pause / max-wallet / fee-exclusion setters. Returns `{ isMutable: boolean; hits: string[] }`. Fail-closed: returns `{ isMutable: true, hits: ['scan-failed'] }` on RPC throw. Case-safe: lowercases bytecode before substring match. Pattern lifted from `src/utils/tokenSafety.ts:isBlacklistedTokenForChain` (lines 357-361) with the fail-closed catch added.

**HONEY-02 Mythril severity gate** — `scripts/check-mythril-report.ts` reads a Mythril `-o json` report and exits non-zero if any issue has severity `Medium` or `High`. Per-issue details emitted to stderr; usage error on missing arg; structured stderr on JSON parse failure. Zero new npm deps (uses Node's `fs` + `process`).

Both deliverables are small, parallel-runnable, and unblock downstream Phase 18 plans:
- Plan 18-09 wires `isMutableTokenForChain` into the parallel safety bank `Promise.all` at `src/bot.ts:229-238` (closes HONEY-12).
- Plan 18-05 invokes the Mythril severity gate against `reports/mythril-honeypot.json` (one of the two HONEY-02 audit tools).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 RED | Add failing tests for isMutableTokenForChain | `b503572` | test/unit/bytecodeScan.test.ts |
| 1 GREEN | Implement isMutableTokenForChain bytecode selector scan | `aa77a00` | src/utils/honeypot/bytecodeScan.ts |
| 2 | Add Mythril JSON severity-gate CLI + fixtures | `7178b61` | scripts/check-mythril-report.ts, test/fixtures/mythril/sample-{clean,high}.json |

Task 1 followed TDD per the plan's `tdd="true"` directive: RED commit landed the failing test (module-not-found error), GREEN commit added the implementation and all 7 tests passed. No REFACTOR commit needed — implementation matched the PATTERNS.md sketch directly with no cleanup opportunity.

## Verification Results

### Task 1 verify

Plan's automated verify (Task 1 `<verify><automated>`):

```text
$ npx vitest run --project unit test/unit/bytecodeScan.test.ts
Test Files  1 passed (1)
     Tests  7 passed (7)
```

```text
$ node -e "const f=require('fs').readFileSync('src/utils/honeypot/bytecodeScan.ts','utf8'); const sel=[...19 selectors...]; for(const s of sel) if(!f.includes(s)){console.error('MISSING SELECTOR',s); process.exit(1)} if(!/scan-failed/.test(f)){console.error('MISSING fail-closed sentinel'); process.exit(2)} console.log('OK')"
OK
```

All 19 selectors present in the source file. Fail-closed `'scan-failed'` sentinel present.

### Task 2 verify

Plan's automated verify (Task 2 `<verify><automated>`):

```text
$ npx ts-node scripts/check-mythril-report.ts test/fixtures/mythril/sample-clean.json
Mythril clean (no Medium+ issues; total issues=0)
$ echo $?
0

$ npx ts-node scripts/check-mythril-report.ts test/fixtures/mythril/sample-high.json
  [High] Test high (swc=100, x.sol:1)
Mythril found 1 Medium+ issues
$ echo $?
1

$ npx ts-node scripts/check-mythril-report.ts
Usage: ts-node check-mythril-report.ts <report.json>
$ echo $?
1
```

All three exit-code paths behave as specified.

### Full unit suite regression check

```text
$ npx vitest run --project unit
Test Files  29 passed (29)
     Tests  261 passed (261)
```

No regression — the 7 new tests are additive; all 254 pre-existing unit tests still pass.

### Typecheck

```text
$ npx tsc --noEmit
(exit 0, no output)
```

Both new TypeScript files are clean.

## Acceptance Criteria Status

### Task 1
- ✓ `src/utils/honeypot/bytecodeScan.ts` exists exporting `isMutableTokenForChain` and `MutableScanResult`.
- ✓ All 19 selectors from the table are present in the file (verified by grep).
- ✓ The catch block returns `{ isMutable: true, hits: ['scan-failed'] }` (fail-closed).
- ✓ The function uses `.toLowerCase()` on bytecode for case-insensitive matching.
- ✓ `test/unit/bytecodeScan.test.ts` exists with 6 behavior tests + 1 invariant test (7 total — the 7th asserts MUTABLE_SELECTORS.length === 19 and pins every selector by name, providing a refactor-resistant guard).
- ✓ Every behavior test case asserts `ctx.httpProvider.getCode` was called with `tokenAddress` (Phase 17 D-04 observable-effect rigor).
- ✓ `npx vitest run --project unit test/unit/bytecodeScan.test.ts` exits 0.

### Task 2
- ✓ `scripts/check-mythril-report.ts` exists.
- ✓ Running it against `test/fixtures/mythril/sample-clean.json` exits 0 and prints `Mythril clean`.
- ✓ Running it against `test/fixtures/mythril/sample-high.json` exits with code 1 and prints `[High]` issue details to stderr.
- ✓ Running it with no args exits with code 1 and prints usage to stderr.
- ✓ The file contains the literal strings `'Medium'` and `'High'` for severity matching.
- ✓ The file uses Node's built-in `fs` (no new npm deps).

## Must-Haves Check (from plan frontmatter)

**Truths:**
- ✓ "isMutableTokenForChain returns isMutable=true when bytecode contains any of the 19 selectors" — Test 1 (single selector) + Test 6 (two selectors) exercise this; the implementation's `.filter(sel => codeLower.includes(sel))` over the full 19-element table guarantees per-selector coverage. Test invariant pins `MUTABLE_SELECTORS.length === 19`.
- ✓ "isMutableTokenForChain fails closed (returns isMutable=true with hits=['scan-failed']) on getCode RPC error" — Test 4 asserts both fields exactly.
- ✓ "Case-insensitive substring match: bytecode '0X2E5BB6FF' is correctly identified as matching 'setTax(uint256)'" — Test 5 asserts isMutable=true with the lowercase selector in hits.
- ✓ "scripts/check-mythril-report.ts exits non-zero when JSON report contains issues with severity Medium or High" — Verify run against sample-high.json exits 1.

**Artifacts:**
- ✓ `src/utils/honeypot/bytecodeScan.ts` — contains `MUTABLE_SELECTORS` and `isMutableTokenForChain`.
- ✓ `test/unit/bytecodeScan.test.ts` — contains `isMutable` assertions (multiple).
- ✓ `scripts/check-mythril-report.ts` — contains the literal `'Medium'`.

**Key links:**
- `src/utils/honeypot/bytecodeScan.ts` → `src/bot.ts:229-238` (parallel safety bank) via `isMutableTokenForChain` — wire-up deferred to plan 18-09 per CONTEXT.md D-BYTECODE. The function is import-ready for that plan.
- `scripts/check-mythril-report.ts` → Mythril audit job in plan 18-05 via `node scripts/check-mythril-report.ts <report.json>` — invocation surface confirmed by the `process.exit` calls in both exit paths.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes triggered, no Rule 4 architectural decisions surfaced, no authentication gates, no checkpoints. The plan's `<verify>` commands exited cleanly on first run.

One minor authorial choice within Claude's discretion: a 7th unit test was added beyond the 6 cases in the plan's `<behavior>` block — it asserts the `MUTABLE_SELECTORS` export has length 19 and contains every required selector by name. This is a refactor-resistant guard for the table itself (catches accidental deletion via future refactor) and is logged here for traceability. It does not change the plan's behavior contract; the 6 plan-specified test cases are all present.

## Authentication Gates

None.

## Threat Model Compliance

Plan's `<threat_model>` lists 5 threats with these dispositions:

- **T-18-09 (Tampering — `isMutableTokenForChain` getCode error path), mitigate.** Satisfied — the catch block returns `{ isMutable: true, hits: ['scan-failed'] }` exactly as required; Task 1 verify grep-asserts the `'scan-failed'` sentinel is present; Test 4 asserts both fields on a thrown `getCode`.
- **T-18-10 (Spoofing — false-negative on bytecode case variation), mitigate.** Satisfied — `code.toLowerCase()` is applied before the substring filter; Test 5 exercises mixed-case `0X2E5BB6FF` and asserts isMutable=true.
- **T-18-11 (Tampering — Mythril JSON missing `issues` key), mitigate.** Satisfied — `(report.issues ?? [])` defaults to an empty array; the JSON.parse is wrapped in a try/catch that exits 1 with a structured stderr message on parse failure.
- **T-18-12 (Information Disclosure — selector false-positives blocking DAO-controlled tokens), accept.** Honored — no mitigation code added per CONTEXT D-BYTECODE ("false positives expected and acceptable"); v6.18 HONEY-V2-02 layers timelock-state inspection.
- **T-18-SC (Tampering — npm installs), accept.** Honored — zero new npm packages added. Both deliverables use Node built-ins only (`fs`, `process` for the CLI; ethers v6 `JsonRpcProvider.getCode` via `ChainContext.httpProvider` for the scan).

## Known Stubs

None. Both deliverables are fully implemented and tested:

- `isMutableTokenForChain` returns real `MutableScanResult` values driven by actual `getCode` data and a real selector filter.
- The Mythril CLI does real `fs.readFileSync` + `JSON.parse` + filter + `process.exit` — no placeholder branches.

The function is NOT yet wired into `src/bot.ts:229-238` — that wire-up lands in plan 18-09 and is explicitly out of scope for 18-03 per the plan's `<objective>` ("Plan 18-09 will wire it into the parallel safety bank"). This is a planned forward dependency, not a stub.

## HONEY-12 Closure Disposition

Plan's success criteria reads: "If HONEY-12 is now fully satisfied by the bytecode scan, mark it complete in REQUIREMENTS.md".

HONEY-12 is **NOT** yet fully satisfied. The row text in `.planning/REQUIREMENTS.md` requires that "positive hit blocks the buy in the parallel safety bank at `src/bot.ts:229-238` per D-BYTECODE" — that wire-up is plan 18-09's responsibility. This plan ships the function + tests but not the `bot.ts` Promise.all 9th element.

**Disposition: leave HONEY-12 as `Pending` in REQUIREMENTS.md**. Close it in the SUMMARY.md of plan 18-09 once the Promise.all entry and the `|| isMutable` extension to the line-271 condition land.

## Self-Check: PASSED

- File existence checks (all five files):
  ```text
  $ ls src/utils/honeypot/bytecodeScan.ts test/unit/bytecodeScan.test.ts scripts/check-mythril-report.ts test/fixtures/mythril/sample-clean.json test/fixtures/mythril/sample-high.json
  src/utils/honeypot/bytecodeScan.ts
  test/unit/bytecodeScan.test.ts
  scripts/check-mythril-report.ts
  test/fixtures/mythril/sample-clean.json
  test/fixtures/mythril/sample-high.json
  ```
  All five files exist.
- Commit existence checks:
  - `b503572`: test(18-03): add failing tests for isMutableTokenForChain (HONEY-12)
  - `aa77a00`: feat(18-03): implement isMutableTokenForChain bytecode selector scan (HONEY-12)
  - `7178b61`: feat(18-03): add Mythril JSON severity-gate CLI (HONEY-02)
  All three commits present on master.

## TDD Gate Compliance

Task 1 declared `tdd="true"`. Gate sequence present in git log:
1. RED: `b503572` — `test(18-03):` failing test ✓
2. GREEN: `aa77a00` — `feat(18-03):` implementation that flips RED → 7/7 passing ✓
3. REFACTOR: not committed (no cleanup opportunity surfaced; implementation matched the PATTERNS.md sketch directly).

Fail-fast rule honored: RED commit was made before the implementation was authored; verified the test failed for the expected reason (`Cannot find module '../../src/utils/honeypot/bytecodeScan'`).

## Success Criteria Status

Plan's `<success_criteria>` block:

> HONEY-12 is implemented + unit-tested. The Mythril severity-gate CLI is in place for plan 18-05's audit job. Both deliverables are independent — neither blocks the contract authoring plan (18-02) nor the safety-bank audit plan (18-04).

**Status: MET.** HONEY-12 function shipped + 7 unit tests passing. Mythril severity gate CLI shipped with both exit paths verified against fixtures. Neither deliverable touches `contracts/honeypot/HoneypotChecker.sol` (plan 18-02) nor `src/utils/tokenSafety.ts` (plan 18-04) — parallel-runnable as designed.

---

*Phase: 18-honeypot-detection-rebuild — Plan 03*
*Executed: 2026-05-16 — Duration ~5 minutes*
