---
phase: "23"
slug: "test-safety-net-harness-triage-characterization"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-09"
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `vitest.config.ts` (Wave 1 adds the `realpath` project) |
| **Quick run command** | `N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0; PATH="$N22:$PATH"; npx vitest run --project realpath` |
| **Full suite command** | `N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0; PATH="$N22:$PATH"; npm test` |
| **Estimated runtime** | ~60 seconds for the `realpath` project (extrapolated in 23-RESEARCH.md, not yet measured) |

Every command runs on Node 22.16.0 by absolute path, because the global Node 24 cannot load better-sqlite3.

---

## Sampling Rate

- **After every task commit:** Run the quick run command, narrowed to the folder the task touched
- **After every plan wave:** Run the full suite command, plus `npm run check:vi-mock` and each new gate
- **Before `/gsd-verify-work`:** Full suite and gates green, AC-24's three byte-identical runs, and AC-10's three-run stability
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Task IDs are filled in by the plans. Commands below come from the requirement map in 23-RESEARCH.md.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 1 | CHAR-01 (AC-01, AC-03) | — | N/A | integration | `npx vitest run --project realpath harness` | ❌ W1 | ⬜ pending |
| TBD | TBD | 1 | CHAR-01 (AC-02) | — | N/A | gate + self-test | mock-list check `--self-test` | ❌ W1 | ⬜ pending |
| TBD | TBD | 1 | CHAR-05 (AC-04 to AC-06) | — | N/A | integration | `npx vitest run --project realpath migrations` | ❌ W1 | ⬜ pending |
| TBD | TBD | 1 | CHAR-05 (AC-07) | — | N/A | unit | `npx vitest run --project unit helpers.smoke db.test` | ✅ needs edit | ⬜ pending |
| TBD | TBD | 2 | AUDIT-02 (AC-08 to AC-18) | — | N/A | register + tests | `.planning/audit/tools/check.ts --stage final` and `npx vitest run --project realpath triage` | ❌ W2 | ⬜ pending |
| TBD | TBD | 3 | CHAR-02 (AC-19 to AC-26) | — | Recordings hold only inert test values (AC-51) | integration | `npx vitest run --project realpath scenarios`, three runs for AC-24 | ❌ W3 | ⬜ pending |
| TBD | TBD | 3 | CHAR-03 (AC-27 to AC-29) | — | Snapshots hold only inert test values (AC-51) | integration | `npx vitest run --project realpath env` | ❌ W3 | ⬜ pending |
| TBD | TBD | 3 | CHAR-04 (AC-30, AC-31) | — | N/A | integration | `npx vitest run --project realpath ordering` | ❌ W3 | ⬜ pending |
| TBD | TBD | 3 | CHAR-04 (AC-32 to AC-36) | — | Every signing path holds the nonce lock | gate + self-test | signing census `--self-test` | ❌ W3 | ⬜ pending |
| TBD | TBD | 3 | CHAR-06 (AC-37, AC-38) | — | N/A | suite | `npx vitest run --project unit --project integration` | ✅ 11 files to convert | ⬜ pending |
| TBD | TBD | 3 | AUDIT-06 (AC-39 to AC-44) | — | N/A | gate + self-test | commit check `--self-test` | ❌ W3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 23 builds its own test infrastructure, so these land in Wave 1. No framework install is needed.

- [ ] `vitest.config.ts` — `realpath` project with the ethers CJS alias
- [ ] `test/realpath/harness/` — seams and self-check, node, socket, clock, DB capture, serializer, known-bug marker
- [ ] Mock-list check under `scripts/`
- [ ] `package.json` — `test` updated, plus the new `realpath` and check commands
- [ ] `.github/workflows/test.yml` — `fetch-depth: 0` and the new steps

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| AUD-TX-006 manual relay request (AC-15) | AUDIT-02 | One real outside network call, signed by a throwaway unfunded key, only after operator approval | The plan gives one single-line command, and the raw response is recorded |
| Known S0/S1 batch report (AC-17, AC-18) | AUDIT-02 | The operator acknowledges the batch and rules on S0/S1 NOT-A-BUG closures and unreproduced entries | Read the generated plain-language report and record the rulings |
| `src/` diff review (AC-45, AC-50, AC-52) | CHAR-01 to CHAR-06 | The SPEC assigns this to a reviewer reading the diff | Confirm the diff is empty, or holds only added `export` keywords and new `...ForTesting` helpers |
| Register and tag review (AC-46, AC-47, AC-48, AC-53) | AUDIT-02, CHAR-02 | Judgment-tier prohibitions in the SPEC | Review scenario tags, register changes, fake chain data and census exceptions |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
