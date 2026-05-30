---
phase: 13
slug: config-env-var-correctness
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-06
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/configEnvVar.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~2 seconds (phase tests), ~15 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/configEnvVar.test.ts --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | EXIT-01 | T-13-01 | STOP_LOSS_PCT=15 → CONFIG.stopLossPercent is 15 | unit | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |
| 13-01-02 | 01 | 1 | EXIT-01 | T-13-01 | STOP_LOSS_PCT unset → defaults to 25 | unit | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |
| 13-01-03 | 01 | 1 | EXIT-01 | T-13-01 | STOP_LOSS_PCT=abc → NaN guard falls back to 25 | unit | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |
| 13-01-04 | 01 | 1 | CHAIN-05 | T-13-02 | FLASHBOTS_AUTH_KEY not globally required | unit | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |
| 13-01-05 | 01 | 1 | CHAIN-05 | T-13-02 | BSC-only without FLASHBOTS_AUTH_KEY does not exit | unit | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |
| 13-01-06 | 01 | 1 | EXIT-02 | — | buildExitConfig reads CONFIG.stopLossPercent from env | integration | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |
| 13-01-07 | 01 | 1 | EXIT-02 | — | Custom STOP_LOSS_PCT flows through to exitConfig.stopLossPct | integration | `npx vitest run test/unit/configEnvVar.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

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

**Approval:** approved 2026-04-06

---

## Validation Audit 2026-04-06

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
