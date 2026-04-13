---
phase: 2
slug: ethers-v6-migration
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-20
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit/integration/fork projects) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/unit/ethersV5PatternsAbsent.test.ts test/unit/ethersV6BigIntArithmetic.test.ts test/unit/ethersV6ToolboxConfig.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-XX | 01 | 1 | ETH6-01 | unit (static analysis) | `npx vitest run test/unit/ethersV5PatternsAbsent.test.ts` | ✅ | ✅ green |
| 02-02-XX | 02 | 2 | ETH6-02 | unit (static + runtime) | `npx vitest run test/unit/ethersV6BigIntArithmetic.test.ts` | ✅ | ✅ green |
| 02-02-XX | 02 | 2 | ETH6-03 | manual | N/A (Sepolia network required) | N/A | ⬜ manual |
| 02-01-XX | 01 | 1 | ETH6-04 | unit (static analysis) | `npx vitest run test/unit/ethersV6ToolboxConfig.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* Vitest is already configured with unit test project. Three new test files created during validation audit.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Flashbots Sepolia bundle | ETH6-03 | Requires live Sepolia network + funded wallet | Run `npx ts-node scripts/deploySepoliaTest.ts` with funded Sepolia wallet, verify bundle acceptance |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-13

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 3 |
| Resolved | 3 |
| Escalated | 0 |

### Tests Created

| # | File | Tests | Type | Command |
|---|------|-------|------|---------|
| 1 | `test/unit/ethersV5PatternsAbsent.test.ts` | 12 | unit (static analysis) | `npx vitest run test/unit/ethersV5PatternsAbsent.test.ts` |
| 2 | `test/unit/ethersV6BigIntArithmetic.test.ts` | 9 | unit (static + runtime) | `npx vitest run test/unit/ethersV6BigIntArithmetic.test.ts` |
| 3 | `test/unit/ethersV6ToolboxConfig.test.ts` | 7 | unit (static analysis) | `npx vitest run test/unit/ethersV6ToolboxConfig.test.ts` |

**Total:** 28 tests, all passing.
