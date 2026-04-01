---
phase: 11
slug: dashboard-accuracy-bot-wiring
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 11 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | vitest.config.ts (workspace with unit/integration/fork projects) |
| **Quick run command** | `rtk vitest run --project unit` |
| **Full suite command** | `rtk vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `rtk vitest run --project unit`
- **After every plan wave:** Run `rtk vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-00-01 | 00 | 0 | DASH-01,DASH-03,FIX-09 | unit stubs | `rtk vitest run --project unit test/unit/positionsHelper.test.ts test/unit/chainRestart.test.ts test/unit/telegramListener.test.ts` | Plan 00 creates | ⬜ pending |
| 11-01-01 | 01 | 1 | DASH-01-a | unit | `rtk vitest run --project unit test/unit/positionsHelper.test.ts -t "live price"` | Wave 0 (stub) | ⬜ pending |
| 11-01-02 | 01 | 1 | DASH-01-b | unit | `rtk vitest run --project unit test/unit/positionsHelper.test.ts -t "fallback"` | Wave 0 (stub) | ⬜ pending |
| 11-01-03 | 01 | 1 | DASH-01-c | unit | `rtk vitest run --project unit test/unit/positionsHelper.test.ts -t "unrealized"` | Wave 0 (stub) | ⬜ pending |
| 11-01-04 | 01 | 1 | DASH-03-a | unit | `rtk vitest run --project unit test/unit/chainRestart.test.ts -t "restart"` | Wave 0 (stub) | ⬜ pending |
| 11-01-05 | 01 | 1 | DASH-03-b | unit | `rtk vitest run --project unit test/unit/chainRestart.test.ts -t "reconnect"` | Wave 0 (stub) | ⬜ pending |
| 11-01-06 | 01 | 1 | DASH-03-c | unit | `rtk vitest run --project unit test/unit/chainRestart.test.ts -t "mev"` | Wave 0 (stub) | ⬜ pending |
| 11-01-07 | 01 | 1 | FIX-09-a | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "connect"` | Wave 0 (stub) | ⬜ pending |
| 11-01-08 | 01 | 1 | FIX-09-b | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "optional"` | Wave 0 (stub) | ⬜ pending |
| 11-01-09 | 01 | 1 | FIX-09-c | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "routing"` | Wave 0 (stub) | ⬜ pending |
| 11-01-10 | 01 | 1 | FIX-09-d | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "whitelist"` | Wave 0 (stub) | ⬜ pending |
| 11-02-01 | 02 | 2 | DASH-01-a | unit | `rtk vitest run --project unit test/unit/positionsHelper.test.ts` | Wave 0 (stub) | ⬜ pending |
| 11-02-02 | 02 | 2 | DASH-01-d | integration | `rtk vitest run --project integration test/integration/api/positions.test.ts` | Exists -- needs update | ⬜ pending |
| 11-02-03 | 02 | 2 | DASH-01-e | integration | `rtk vitest run --project integration test/integration/api/wsPush.test.ts` | Plan 04 creates | ⬜ pending |
| 11-03-01 | 03 | 2 | DASH-03-a | unit | `rtk vitest run --project unit test/unit/chainRestart.test.ts` | Wave 0 (stub) | ⬜ pending |
| 11-03-02 | 03 | 2 | DASH-03-d | integration | `rtk vitest run --project integration test/integration/api/chains.test.ts -t "restart"` | Exists -- needs update | ⬜ pending |
| 11-04-01 | 04 | 3 | FIX-09-a | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts` | Wave 0 (stub) | ⬜ pending |
| 11-04-02 | 04 | 3 | FIX-09-e | integration | `rtk vitest run --project integration test/integration/api/health.test.ts -t "telegram"` | Exists -- needs update | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/unit/positionsHelper.test.ts` -- stubs for DASH-01-a,b,c (Plan 00 creates with it.todo)
- [x] `test/unit/chainRestart.test.ts` -- stubs for DASH-03-a,b,c (Plan 00 creates with it.todo)
- [x] `test/unit/telegramListener.test.ts` -- stubs for FIX-09-a,b,c,d (Plan 00 creates with it.todo)
- [ ] Update `test/integration/api/positions.test.ts` -- update for new response shape (Plan 04)
- [ ] Update `test/integration/api/chains.test.ts` -- add restart with callback test cases (Plan 04)
- [ ] Update `test/integration/api/health.test.ts` -- add telegram status assertion (Plan 04)
- [ ] Create `test/integration/api/wsPush.test.ts` -- WS push shared helper verification (Plan 04)

*Wave 0 stub creation handled by Plan 00 (wave 0). Full test implementations in Plan 04 (wave 3).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live price on dashboard matches DEXScreener | DASH-01-a | Requires live mainnet RPC | Compare GET /api/positions currentPrice against DEXScreener for same token |
| WebSocket push shows real-time updates | DASH-01-e | Requires running server + browser | Open dashboard, watch positions update in real-time |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Plan 00 creates stubs)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
