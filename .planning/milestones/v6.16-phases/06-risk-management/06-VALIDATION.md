---
phase: 6
slug: risk-management
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-23
validated: 2026-04-13
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/riskManager.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~1 second |

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
| 06-01-01 | 01 | 1 | RISK-01 | unit | `npx vitest run test/unit/riskManager.test.ts` | ✅ | ✅ green |
| 06-01-02 | 01 | 1 | RISK-02 | unit | `npx vitest run test/unit/riskManager.test.ts` | ✅ | ✅ green |
| 06-01-03 | 01 | 1 | RISK-03 | unit | `npx vitest run test/unit/riskManager.test.ts` | ✅ | ✅ green |
| 06-01-04 | 01 | 1 | RISK-04 | unit | `npx vitest run test/unit/riskManager.test.ts` | ✅ | ✅ green |
| 06-01-05 | 01 | 1 | RISK-05 | unit | `npx vitest run test/unit/riskManager.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Test Coverage Detail

| Requirement | Test Description | File:Line |
|-------------|-----------------|-----------|
| RISK-01 | returns {allowed:false, reason:"position_size"} when amount exceeds max | test/unit/riskManager.test.ts:73 |
| RISK-02 | returns {allowed:false, reason:"daily_loss_limit"} when daily loss exceeded | test/unit/riskManager.test.ts:79 |
| RISK-03 | returns {allowed:false, reason:"max_positions"} when max positions reached | test/unit/riskManager.test.ts:88 |
| RISK-04 | returns {allowed:false, reason:"cooldown"} when cooldown active | test/unit/riskManager.test.ts:95 |
| RISK-05 | returns {allowed:false, reason:"exposure_cap"} when total exposure exceeded | test/unit/riskManager.test.ts:103 |
| RISK-05 | getPortfolioExposure returns exposure reduced by partial sell proceeds | test/unit/riskManager.test.ts:113 |
| ALL | returns {allowed:true} when all limits OK (happy path) | test/unit/riskManager.test.ts:67 |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telegram alert on risk rejection | RISK-01..05 | Requires live Telegram bot token | Trigger risk rejection, verify Telegram message received |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 5 RISK requirements covered by existing tests in `test/unit/riskManager.test.ts` (7 tests, all green).
Additional integration coverage in `test/integration/api/risk.test.ts` for API endpoint exposure.

---

## Harm-Prevention Assertion (Phase 17 / DEBT-05)

**Harm scenario:** A failure mode in the daily-loss circuit breaker (RISK-02) blocks the snipe but silently returns without emitting a structured warn — operator-side observability is lost. Without the structured pino warn line, dashboards / log queries that key on `reason: 'daily_loss_limit'` see nothing, even though the gate is firing.

**Pointer to test:** `test/unit/riskManager.test.ts` describe block `Phase 6 harm-prevention: RISK daily-loss gate blocks the snipe with structured pino warn` (single `it` block at end of file).

**D-04 observable effects asserted (combined rigor):**
- Function-return: `expect(result.allowed).toBe(false)` and `expect(result.reason).toBe('daily_loss_limit')`.
- Structured-log-emission: `expect(warnMock).toHaveBeenCalledWith(expect.objectContaining({ chain: 'eth', reason: 'daily_loss_limit' }), expect.any(String))` — matches the canonical `expect.objectContaining` payload + `expect.any(String)` message pattern from configEnvVar.test.ts:170-176.

**Cross-reference:** `.planning/milestones/v6.17-debt-baseline.md` for the v6.17 baseline anchor.
