---
phase: 1
slug: bug-fixes-hardening
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-19
audited: 2026-04-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (projects: unit, integration, fork) |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | FIX-01 | integration | `npx vitest run test/integration/exitMonitor.test.ts` | ✅ | ✅ green |
| 01-02-01 | 02 | 1 | FIX-02 | integration | `npx vitest run test/integration/txManager.test.ts` | ✅ | ✅ green |
| 01-02-02 | 02 | 1 | FIX-03 | integration | `npx vitest run test/integration/txManager.test.ts` | ✅ | ✅ green |
| 01-03-01 | 03 | 1 | FIX-04 | unit | `npx vitest run test/unit/tokenSafety.test.ts` | ✅ | ✅ green |
| 01-01-02 | 01 | 1 | FIX-05 | unit | `npx vitest run test/unit/exitManager.shutdown.test.ts` | ✅ | ✅ green |
| 01-03-02 | 03 | 1 | FIX-06 | unit | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |
| 01-01-03 | 01 | 1 | FIX-07 | integration | `npx vitest run test/integration/exitMonitor.test.ts` | ✅ | ✅ green |
| 01-03-03 | 03 | 1 | FIX-08 | unit | `npx vitest run test/unit/exitEngineZeroBalance.test.ts` | ✅ | ✅ green |
| 01-03-04 | 03 | 2 | FIX-09 | unit | `npx vitest run test/unit/telegramListener.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SIGTERM exits within 5s | FIX-05 | Requires real process signal timing | Start bot, send `kill -SIGTERM <pid>`, verify exit within 5s |
| Resume monitoring on restart | FIX-05 | Requires process restart cycle | Write state with pending positions, restart bot, verify monitoring resumes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-13

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

### Audit Details

**Test infrastructure updated:** Hardhat/Mocha → Vitest (project evolved since original VALIDATION.md)

**Gaps resolved:**
- **FIX-05 (PARTIAL → COVERED):** Created `test/unit/exitManager.shutdown.test.ts` — 8 tests covering SIGTERM/SIGINT shutdown handler, isShutdownInProgress flag, re-entrant guard, timer registry cleanup
- **FIX-08 (MISSING → COVERED):** Created `test/unit/exitEngineZeroBalance.test.ts` — 7 tests covering zero-balance detection, status update to 'sold', timer cleanup, exit state deletion, no spurious TX

**Coverage summary:** 9/9 requirements have automated verification. 2 behaviors remain manual-only (real process signal timing, full restart cycle).

---

## Harm-Prevention Assertion (Phase 17 / DEBT-05)

**Harm scenario:** Two concurrent timers each detect a sell-trigger condition for the same `(chain, token)` and both submit sell transactions, double-spending the position.

**Pointer to test:** `test/integration/exitMonitor.test.ts` describe block `Phase 1 harm-prevention: FIX-01 exit-monitor sell-lock prevents double-sell race` (the 2 `it` blocks at end of file).

**Excluded:** FIX-04 (V2 sell-sim) — addressed via fresh implementation in HONEY-07 and validated at fresh-implementation time per PITFALLS.md #19.

**Cross-reference:** `.planning/milestones/v6.17-debt-baseline.md` for the v6.17 baseline anchor.
