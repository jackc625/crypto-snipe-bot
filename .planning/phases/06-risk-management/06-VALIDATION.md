---
phase: 6
slug: risk-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | RISK-01 | unit | `npx vitest run src/__tests__/riskManager.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | RISK-02 | unit | `npx vitest run src/__tests__/riskManager.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | RISK-03 | unit | `npx vitest run src/__tests__/riskManager.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | RISK-04 | unit | `npx vitest run src/__tests__/riskManager.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-05 | 01 | 1 | RISK-05 | unit | `npx vitest run src/__tests__/riskManager.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/riskManager.test.ts` — test stubs for RISK-01 through RISK-05
- [ ] Test fixtures for mock DB state (trades table with various statuses)

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telegram alert on risk rejection | RISK-01..05 | Requires live Telegram bot token | Trigger risk rejection, verify Telegram message received |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
