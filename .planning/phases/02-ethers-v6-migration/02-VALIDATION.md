---
phase: 2
slug: ethers-v6-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Hardhat test (mocha + chai via hardhat-toolbox) |
| **Config file** | `hardhat.config.ts` |
| **Quick run command** | `npx hardhat compile` |
| **Full suite command** | `npx tsc --noEmit && npx hardhat compile && npx hardhat test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit && npx hardhat compile && npx hardhat test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-XX | 01 | 1 | ETH6-01 | compile | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 02-01-XX | 01 | 1 | ETH6-02 | compile + grep | `npx tsc --noEmit && grep -rn "BigNumber" src/` | ✅ | ⬜ pending |
| 02-02-XX | 02 | 2 | ETH6-03 | compile | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 02-02-XX | 02 | 2 | ETH6-04 | hardhat | `npx hardhat compile && npx hardhat test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* Hardhat compile + TypeScript compiler provide the primary verification. No additional test framework needed for a migration phase — compilation success IS the test.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Flashbots Sepolia bundle | ETH6-03 | Requires live Sepolia network + funded wallet | Run `npx ts-node scripts/deploySepoliaTest.ts` with funded Sepolia wallet, verify bundle acceptance |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
