---
phase: 12
slug: integration-gap-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 12-01-01 | 01 | 1 | DASH-01 | — | N/A | unit | `npx vitest run --reporter=verbose` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | DASH-01 | — | N/A | integration | `npx vitest run --reporter=verbose` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | DASH-03 | — | N/A | unit | `npx vitest run --reporter=verbose` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | DASH-03 | — | N/A | integration | `npx vitest run --reporter=verbose` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for dex_name resolution (DASH-01)
- [ ] Test stubs for WebSocket chain status broadcast (DASH-03)
- [ ] Shared fixtures for BSC multi-dex chain contexts

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stale .js artifacts deleted | INT-01 | One-time file deletion | Verify no `.js` files in `dashboard/src/` after cleanup |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
