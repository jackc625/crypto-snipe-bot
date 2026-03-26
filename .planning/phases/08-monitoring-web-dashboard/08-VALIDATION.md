---
phase: 8
slug: monitoring-web-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `vitest.config.ts` (exists, includes `tests/**/*.test.ts`) |
| **Quick run command** | `npx vitest run tests/api/ --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/api/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | MON-01 | unit | `npx vitest run tests/api/health.test.ts -t "health" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | MON-01 | unit | `npx vitest run tests/api/health.test.ts -t "degraded" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | AUTH | unit | `npx vitest run tests/api/auth.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | DASH-01 | unit | `npx vitest run tests/api/positions.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | DASH-02 | unit | `npx vitest run tests/api/trades.test.ts -t "filter" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-02-03 | 02 | 1 | DASH-02 | unit | `npx vitest run tests/api/trades.test.ts -t "pagination" --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-02-04 | 02 | 1 | DASH-04 | unit | `npx vitest run tests/api/risk.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | DASH-03 | unit | `npx vitest run tests/api/chains.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 2 | DASH-03 | unit | `npx vitest run tests/api/controls.test.ts -t "force" --reporter=verbose` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/api/health.test.ts` — stubs for MON-01
- [ ] `tests/api/positions.test.ts` — stubs for DASH-01
- [ ] `tests/api/trades.test.ts` — stubs for DASH-02
- [ ] `tests/api/chains.test.ts` — stubs for DASH-03
- [ ] `tests/api/controls.test.ts` — stubs for DASH-03 (force sell / emergency sell)
- [ ] `tests/api/risk.test.ts` — stubs for DASH-04
- [ ] `tests/api/auth.test.ts` — stubs for authentication
- [ ] `tests/fixtures/api.fixtures.ts` — shared mock ChainContext, mock DB data

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard renders live position updates | DASH-01 | WebSocket visual update in browser | Start bot, open dashboard, verify positions table updates every 5s |
| Collapsible sidebar navigation | DASH-01 | Visual/UX interaction | Click sidebar collapse button, verify icon-only rail mode |
| P&L line chart renders green/red zones | DASH-04 | Chart.js canvas rendering | Navigate to Risk & Exposure, verify cumulative line chart with color zones |
| Donut chart shows exposure by chain | DASH-04 | Chart.js canvas rendering | Navigate to Risk & Exposure, verify donut chart with per-chain segments |
| Double confirmation on emergency sell | DASH-03 | Multi-step UI interaction | Click emergency sell, verify confirm dialog, verify "CONFIRM" text input |
| CSV export downloads correct data | DASH-02 | File download in browser | Apply filters on Trade History, click export, verify CSV content matches |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
