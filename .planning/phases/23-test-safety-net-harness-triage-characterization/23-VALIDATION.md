---
phase: "23"
slug: "test-safety-net-harness-triage-characterization"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-09"
validated: "2026-11-13"
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `vitest.config.ts` (projects `unit`, `integration`, `realpath`, plus `fork`) |
| **Quick run command** | `N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0; PATH="$N22:$PATH"; npx vitest run --project realpath <folder>` |
| **Full suite command** | `N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0; PATH="$N22:$PATH"; npm test` |
| **Measured runtime** | full railed suite 199 s at HEAD 9246cf7 after the code-review fixes (214 files, 1599 tests: unit 966, integration 264, realpath 369); earlier 195 to 220 s (211 files, 1560 tests: unit 952, integration 264, realpath 344) at the waves 14-15 gate and in 23-26 |

Every command runs on Node 22.16.0 by absolute path, because the global Node 24 cannot load better-sqlite3.

---

## Sampling Rate

- **After every task commit:** the quick run command, narrowed to the folder the task touched
- **After every plan wave:** the orchestrator's wave gate (`orchestrator/wave-gate.sh`): tsc x3, the full railed suite, the recordings-compared check, both mock gates, the signing census, the RED-proof manifest, `check.ts` partial/consolidation/triage, `src/` clean
- **Before `/gsd-verify-work`:** full suite and gates green, AC-24's three byte-identical recording runs, AC-10's three-run triage stability (all done in 23-26)
- **Max feedback latency:** the full suite now takes 195 to 220 s on this machine; a single realpath folder stays under 60 s

---

## Per-Task Verification Map

Evidence: the waves 14-15 gate at HEAD f69e754 (2026-11-12: 211 files, 1560/1560, recordings-compared 130/130, every gate PASS, no test at or over half its real limit) and plan 23-26's whole-phase proof (wrapped full suite at 597d6db: verdict untouched, 1560/1560; final gates at the sealed revision 912b915: `check.ts --stage triage`, `check:realpath-mocks`, `check:census`, `check:commits`, `npm run test:realpath` 344/344, recordings-compared 130/130).

Re-validated 2026-11-13 at HEAD 9246cf7, after the 46 code-review fixes (77 commits after the first validation; `src/` still unchanged). Command: `orchestrator/wave-gate.sh` on Node 22.16.0. Results:
- tsc x3 pass.
- Full railed suite: 214 files, 1599/1599 (unit 966, integration 264, realpath 369), 0 skipped, 0 todo, 103 knownBug records.
- Rail ledger: nonLoopbackAllowed 0, telegramAllowed 0. Every deny count is identical to the 2026-11-12 full runs.
- Recordings compared: 130/130.
- `check:realpath-mocks` and `check:vi-mock`: 0 violations.
- `check:census`: 24 sites, unknown 0, floor 24, 0 problems. Floor history: 0 problems.
- `--check-manifest`: MANIFEST-OK rows 36 files 11 guards 1. `--check-summaries`: SUMMARIES-OK red-ok 67.
- `check.ts` partial, consolidation and triage: RESULT PASS, fail 0, pending 0.
- `check:commits`: RESULT PASS, 122 commits judged, 0 violations.
- `src/` and `scripts/` clean.

The fixes added three test files, mapped below: `test/unit/updateRecordingsGate.test.ts` (WR-35/36), `test/unit/vitestProjectCoverage.test.ts` (WR-30) and `test/unit/ci/workflowLimits.test.ts` (WR-31).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 23-01 T1-T2, 23-28, 23-27 | 23-01, 23-28, 23-27 | 1, 2, 4 | CHAR-01 (AC-01, AC-03) | — | Unknown methods, reads and URLs fail loudly; no real network (rail ledger nonLoopbackAllowed 0) | integration | `npx vitest run --project realpath test/realpath/harness.test.ts test/realpath/harnessCapture.test.ts test/realpath/harnessRestart.test.ts` | ✅ | ✅ green |
| 23-02 | 23-02 | 3 | CHAR-01 (AC-02) | — | No mock of the mechanism under test in test/realpath | gate + self-test | `npm run check:realpath-mocks` and `test/unit/realpathMockGate.test.ts` (runs `--self-test`) | ✅ | ✅ green |
| Review fixes WR-30, WR-31 | 23-REVIEW-FIX | post-execution | CHAR-01 (suite infrastructure) | — | Every test file under test/ runs in exactly one Vitest project, so none is silently skipped; every CI job has a time limit and the contract jobs' Python tools are pinned | unit | `npx vitest run --project unit test/unit/vitestProjectCoverage.test.ts test/unit/ci/workflowLimits.test.ts` | ✅ | ✅ green |
| 23-03 | 23-03 | 2 | CHAR-05 (AC-04 to AC-06) | — | N/A | integration | `npx vitest run --project realpath test/realpath/migrations` | ✅ | ✅ green |
| 23-03 | 23-03 | 2 | CHAR-05 (AC-07) | — | N/A | unit | `npx vitest run --project unit test/unit/helpers.smoke.test.ts test/unit/db.test.ts` | ✅ | ✅ green |
| 23-04 to 23-16 | 23-04 to 23-16, 23-32 | 4 to 6, 14 | AUDIT-02 (AC-08 to AC-18) | — | Every population entry has one outcome; S0/S1 rulings recorded | register + tests | `node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage triage` and `npx vitest run --project realpath test/realpath/triage` (three identical runs, evidence byte-identical) | ✅ | ✅ green |
| 23-20 to 23-22 | 23-20, 23-21, 23-22, 23-25, 23-33 | 12 to 14 | CHAR-02 (AC-19 to AC-26) | T-23-25, T-23-26 | Recordings hold only inert test values (AC-51 field-aware scan); only the update command writes; every committed recording is compared | integration + unit | `npx vitest run --project realpath test/realpath/scenarios test/realpath/recordingsGuard.test.ts` (three runs for AC-24), then `npm run check:recordings-compared -- --run-log <log>`; `npx vitest run --project unit test/unit/updateRecordingsGate.test.ts` (the update command's `--self-test`: a re-record holding a planted key fails before commit, WR-35/36) | ✅ | ✅ green |
| 23-23 | 23-23 | 13 | CHAR-03 (AC-27 to AC-29) | — | Snapshots hold only inert test values (AC-51) | integration | `npx vitest run --project realpath test/realpath/env` | ✅ | ✅ green |
| 23-24 | 23-24 | 13 | CHAR-04 (AC-30, AC-31) | — | N/A | integration | `npx vitest run --project realpath test/realpath/ordering` | ✅ | ✅ green |
| 23-17 | 23-17 | 7 | CHAR-04 (AC-32 to AC-36) | — | Every signing path holds the nonce lock or is a listed exception with a decision | gate + self-test | `npm run check:census` (and `-- --check-floor-history`), `test/unit/signingCensusGate.test.ts` (runs `--self-test`) | ✅ | ✅ green |
| 23-18, 23-29, 23-31, 23-30, 23-19, 23-32 | those six | 7 to 11, 14 | CHAR-06 (AC-37, AC-38) | T-23-24 | No test reads a named src/ or scripts/ file as text, apart from the 3 SPEC dashboard tests | suite + gate | `npx vitest run --project unit test/unit/sourceTextGate.test.ts`; `scripts/red-proof-conversions.ts --check-manifest` (MANIFEST-OK rows 36 files 11 guards 1) and `--check-summaries` (SUMMARIES-OK red-ok 67) | ✅ | ✅ green |
| 23-25, 23-33 | 23-25, 23-33 | 14, 15 | AUDIT-06 (AC-39 to AC-44) | T-23-33a, T-23-33b | A re-record needs a behavior: commit citing a real ID; a test cannot quietly stop comparing a committed recording | gate + self-test | `npm run check:commits`, `test/unit/commitTaxonomyGate.test.ts` and `test/unit/recordingsComparedGate.test.ts` (each runs `--self-test`) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 23 built its own test infrastructure in its early waves. No framework install was needed.

- [x] `vitest.config.ts` — `realpath` project with the ethers CJS alias (23-01)
- [x] `test/realpath/harness/` — seams and self-check, node, socket, clock, DB capture, serializer, known-bug marker (23-01, 23-28, 23-02, 23-27, 23-20, 23-33)
- [x] Mock-list check under `scripts/` (23-02)
- [x] `package.json` — `test` updated, plus the `realpath` and check commands (`check:realpath-mocks`, `check:census`, `check:commits`, `check:recordings-compared`, `recordings:update`)
- [x] `.github/workflows/test.yml` — `fetch-depth: 0` and the new steps (mock-list, census, commit taxonomy, recordings compared)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Done |
|----------|-------------|------------|-------------------|------|
| AUD-TX-006 manual relay request (AC-15) | AUDIT-02 | One real outside network call, signed by a throwaway unfunded key, only after operator approval | The plan gives one single-line command, and the raw response is recorded | 23-15 (the one approved request; spent) |
| Known S0/S1 batch report (AC-17, AC-18) | AUDIT-02 | The operator acknowledges the batch and rules on S0/S1 NOT-A-BUG closures and unreproduced entries | Read the generated plain-language report and record the rulings | 23-16 (TRIAGE-REVIEW-01) |
| `src/` diff review (AC-45, AC-50, AC-52) | CHAR-01 to CHAR-06 | The SPEC assigns this to a reviewer reading the diff | Confirm the diff is empty, or holds only added `export` keywords and new `...ForTesting` helpers | 23-26 (diff from 7d0b7b3 empty) |
| Register and tag review (AC-46, AC-47, AC-48, AC-53) | AUDIT-02, CHAR-02 | Judgment-tier prohibitions in the SPEC | Review scenario tags, register changes, fake chain data and census exceptions | 23-26 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 60s — the full suite takes 195 to 220 s on this machine (single folders stay under 60 s); recorded, not a coverage gap
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-12 (validate-phase, during execute-phase 23 verification); re-validated 2026-11-13 at HEAD 9246cf7 after the code-review fixes (no gaps; full suite and every gate green)

## Validation Audit 2026-11-12

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
