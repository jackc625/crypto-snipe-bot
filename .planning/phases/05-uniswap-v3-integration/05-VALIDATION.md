---
phase: 5
slug: uniswap-v3-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Hardhat + chai (existing devDependencies) |
| **Config file** | hardhat.config.ts (exists, Sepolia only) |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsc --noEmit` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit` + manual smoke test
- **Before `/gsd:verify-work`:** Full compilation green + manual UAT on all 4 requirements
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | V3-01 | compilation | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-01-02 | 01 | 1 | V3-01 | compilation | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-02-01 | 02 | 1 | V3-02 | compilation | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-02-02 | 02 | 1 | V3-03 | compilation | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-02-03 | 02 | 1 | V3-04 | compilation | `npx tsc --noEmit` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test framework setup needed — Phase 9 (Testing) is dedicated to building the test suite. Validation for this phase relies on TypeScript compilation and manual UAT, consistent with Phases 1-4 approach.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PoolCreated event detection across all chains and fee tiers | V3-01 | Requires live V3 factory or fork | Deploy test token on forked chain, verify event logs |
| Mint event wait before sniping | V3-02 | Requires event sequencing | Create pool without liquidity, verify bot waits; add liquidity, verify bot proceeds |
| V3 swap execution with correct params | V3-03 | Requires live/forked pool with liquidity | Execute buy on forked mainnet pool, verify tx succeeds with correct fee tier |
| QuoterV2 price monitoring accuracy | V3-04 | Requires live pool state | Compare QuoterV2 output to known pool price, verify within tolerance |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
