---
phase: 8
slug: monitoring-web-dashboard
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-26
audited: 2026-04-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `vitest.config.ts` (projects: unit `test/unit/`, integration `test/integration/`, fork `test/fork/`) |
| **Quick run command** | `npx vitest run test/integration/api/ --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~2 seconds (API tests only) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/integration/api/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | MON-01 | integration | `npx vitest run test/integration/api/health.test.ts --reporter=verbose` | ✅ | ✅ green (6 tests) |
| 08-01-02 | 01 | 1 | AUTH | integration | `npx vitest run test/integration/api/auth.test.ts --reporter=verbose` | ✅ | ✅ green (4 tests) |
| 08-02-01 | 02 | 1 | DASH-01 | integration | `npx vitest run test/integration/api/positions.test.ts --reporter=verbose` | ✅ | ✅ green (8 tests) |
| 08-02-02 | 02 | 1 | DASH-02 | integration | `npx vitest run test/integration/api/trades.test.ts --reporter=verbose` | ✅ | ✅ green (10 tests) |
| 08-02-03 | 02 | 1 | DASH-04 | integration | `npx vitest run test/integration/api/risk.test.ts --reporter=verbose` | ✅ | ✅ green (8 tests) |
| 08-03-01 | 03 | 2 | DASH-03 | integration | `npx vitest run test/integration/api/chains.test.ts --reporter=verbose` | ✅ | ✅ green (18 tests) |
| 08-03-02 | 03 | 2 | DASH-03 | integration | `npx vitest run test/integration/api/controls.test.ts --reporter=verbose` | ✅ | ✅ green (9 tests) |
| 08-01-03 | 01 | 1 | DASH-01 | integration | `npx vitest run test/integration/api/wsPush.test.ts --reporter=verbose` | ✅ | ✅ green (4 tests) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Total: 8 test files, 66 tests, 66 passing, 0 failing**

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- [x] `test/integration/api/health.test.ts` — 6 tests for MON-01 (200 ok, 503 degraded, chain details, telegram status)
- [x] `test/integration/api/auth.test.ts` — 4 tests for AUTH (valid login, invalid key, no session 401, session flow)
- [x] `test/integration/api/positions.test.ts` — 8 tests for DASH-01 (live prices, stale prices, unrealizedPnl, empty, multi-dex)
- [x] `test/integration/api/trades.test.ts` — 10 tests for DASH-02 (filter, paginate, columns, CSV export, sellCount, outcome)
- [x] `test/integration/api/risk.test.ts` — 8 tests for DASH-04 (exposure, cumulative P&L, limits, env config)
- [x] `test/integration/api/chains.test.ts` — 18 tests for DASH-03 (status, maskUrl, stop, start, restart, broadcast)
- [x] `test/integration/api/controls.test.ts` — 9 tests for DASH-03 (force-sell, emergency-sell, lock, errors)
- [x] `test/integration/api/wsPush.test.ts` — 4 tests for DASH-01 (broadcast interval, positions data, skip empty, chain_status)

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-13

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Test files | 8 |
| Total tests | 66 |
| Passing | 66 |
| Failing | 0 |

**Notes:** Original VALIDATION.md referenced `tests/api/` paths (from initial planning). Actual test files are at `test/integration/api/` matching the vitest.config.ts project structure. All test stubs from Wave 0 were replaced with full test implementations during execution. Test paths and counts updated to reflect current codebase state.
