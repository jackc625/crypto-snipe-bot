---
phase: 16
slug: dashboard-type-alignment-dead-code-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
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
| 16-01-01 | 01 | 1 | DASH-02 | — | N/A | integration | `npx vitest run test/integration/api/trades.test.ts -x` | Exists (update needed) | ⬜ pending |
| 16-01-02 | 01 | 1 | MON-01 | — | N/A | integration | `npx vitest run test/integration/api/health.test.ts -x` | Exists (add test) | ⬜ pending |
| 16-01-03 | 01 | 1 | FIX-05 | — | N/A | unit | `npx vitest run test/unit/exitManager.shutdown.test.ts -x` | Exists (update: remove dead code tests) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Tests need updating (field name changes, new version assertion, dead test removal) but no new test files or framework setup required.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
