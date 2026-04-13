---
phase: 16
slug: dashboard-type-alignment-dead-code-cleanup
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-13
audited: 2026-04-13
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (projects: unit, integration, fork) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --project unit --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | DASH-02 | — | N/A | integration | `npx vitest run test/integration/api/trades.test.ts -x` | Yes — asserts pnl, buyCost, buyGas, sellRevenue, sellGas, buy_id | ✅ green |
| 16-01-02 | 02 | 1 | MON-01 | — | N/A | integration | `npx vitest run test/integration/api/health.test.ts -x` | Yes — asserts version string + semver format | ✅ green |
| 16-01-03 | 02 | 1 | FIX-05 | — | N/A | compilation | `npx tsc --noEmit` | Deleted dead test file; clean compilation verifies no broken refs | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Tests need updating (field name changes, new version assertion, dead test removal) but no new test files or framework setup required.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Details:**
- DASH-02: `test/integration/api/trades.test.ts` — 9 tests verify corrected field names (pnl, buyCost, buyGas, sellRevenue, sellGas, buy_id)
- MON-01: `test/integration/api/health.test.ts` — version field assertions (string type + semver format)
- FIX-05: Dead `exitManager.shutdown.test.ts` deleted; dead exports absent from `exitManager.ts`/`db.ts`; `tsc --noEmit` clean; `riskManager.test.ts` mock cleaned
- Full suite: 343/343 tests passing across 31 test files
