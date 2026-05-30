---
phase: 12
slug: integration-gap-fixes
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-04
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | DASH-01 | — | N/A | unit | `npx vitest run test/unit/db.test.ts` | ✅ | ✅ green |
| 12-01-02 | 01 | 1 | DASH-01 | — | N/A | unit | `npx vitest run test/unit/positionsHelper.test.ts` | ✅ | ✅ green |
| 12-01-03 | 01 | 1 | DASH-01 | — | N/A | integration | `npx vitest run test/integration/api/positions.test.ts` | ✅ | ✅ green |
| 12-02-01 | 02 | 1 | DASH-03 | T-12-03 | Broadcast only to authenticated WS clients | unit | `npx vitest run test/integration/api/chains.test.ts` | ✅ | ✅ green |
| 12-02-02 | 02 | 1 | DASH-03 | T-12-03 | Event type consistency (chain_status_change) | integration | `npx vitest run test/integration/api/wsPush.test.ts` | ✅ | ✅ green |
| 12-02-03 | 02 | 1 | DASH-03 | T-12-04 | Broadcast failure logging | integration | `npx vitest run test/integration/api/chains.test.ts` | ✅ | ✅ green |
| 12-03-01 | 03 | 1 | INT-01 | — | N/A | manual | See Manual-Only section | N/A | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Test stubs for dex_name resolution (DASH-01) — `test/unit/positionsHelper.test.ts`
- [x] Test stubs for WebSocket chain status broadcast (DASH-03) — `test/integration/api/chains.test.ts`
- [x] Shared fixtures for BSC multi-dex chain contexts — `test/fixtures/api.fixtures.ts`

*Existing vitest infrastructure covers all framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stale .js artifacts deleted | INT-01 | One-time file deletion | Verify no `.js` files in `dashboard/src/` after cleanup |
| .gitignore prevents future .js artifacts | INT-01 | One-time config change | Verify `dashboard/src/**/*.js` pattern in `.gitignore` |

*All other phase behaviors have automated verification.*

---

## Test Coverage Summary

| Requirement | Tests | Coverage |
|-------------|-------|----------|
| **DASH-01** (Multi-dex price resolution) | 3 unit (dex_name column, schema v4) + 4 unit (multi-dex resolution) + 3 integration (BSC V3 positions) = **10 tests** | COVERED |
| **DASH-03** (WS chain status broadcast) | 4 integration (broadcast after stop/start/failure + type consistency) + 1 integration (WS push type) = **5 tests** | COVERED |
| **INT-01** (Stale artifact cleanup) | Manual verification only | Manual-Only |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-06

---

## Validation Audit 2026-04-06

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Full suite result:** 247 tests passing across 22 test files. All Phase 12 requirements have automated verification coverage. No Nyquist gaps detected.
