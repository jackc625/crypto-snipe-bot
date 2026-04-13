---
phase: 5
slug: uniswap-v3-integration
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-23
updated: 2026-04-13
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit project) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/v3Abis.test.ts` |
| **Full suite command** | `npx vitest run --project unit` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit`
- **After every plan wave:** Run `npx vitest run --project unit`
- **Before `/gsd-verify-work`:** Full unit suite green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | V3-01 | unit | `npx vitest run test/unit/v3Abis.test.ts` | ✅ | ✅ green |
| 05-01-02 | 01 | 1 | V3-01 | unit | `npx vitest run test/unit/chainRegistry.test.ts` | ✅ | ✅ green |
| 05-02-01 | 02 | 1 | V3-02 | unit | `npx vitest run test/unit/v3Abis.test.ts` | ✅ | ✅ green |
| 05-02-02 | 02 | 1 | V3-03 | unit | `npx vitest run test/unit/v3Abis.test.ts` | ✅ | ✅ green |
| 05-02-03 | 02 | 1 | V3-04 | unit | `npx vitest run test/unit/v3Abis.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Vitest unit project was already configured. No new test framework setup needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PoolCreated event detection on live V3 factory | V3-01 | Requires live/forked chain | Deploy test token on forked chain, verify event logs |
| Mint event wait before sniping | V3-02 | Requires event sequencing on live chain | Create pool without liquidity, verify bot waits; add liquidity, verify bot proceeds |
| V3 swap execution with correct params | V3-03 | Requires live/forked pool with liquidity | Execute buy on forked mainnet pool, verify tx succeeds with correct fee tier |
| QuoterV2 price monitoring accuracy | V3-04 | Requires live pool state | Compare QuoterV2 output to known pool price, verify within tolerance |

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
| Gaps found | 4 |
| Resolved | 4 |
| Escalated | 0 |

### Tests Created
| File | Tests | Requirement Coverage |
|------|-------|---------------------|
| `test/unit/v3Abis.test.ts` | 22 | V3-01 (5), V3-02 (5), V3-03 (7), V3-04 (5) |

### Pre-existing Coverage
| File | Requirement Coverage |
|------|---------------------|
| `test/unit/chainRegistry.test.ts` | V3-01 (DexConfigV3 type guards, V3 entries) |
| `test/unit/db.test.ts` | V3-03 (pool_type, fee_tier columns) |
