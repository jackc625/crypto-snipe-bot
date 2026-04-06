---
phase: 14
slug: sell-revenue-receipt-decoding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.1 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | DB-03 | T-14-01 | Only WETH contract logs trusted | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "extractAmountOut"` | ❌ W0 | ⬜ pending |
| 14-01-02 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "gas cost"` | ❌ W0 | ⬜ pending |
| 14-01-03 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "block number"` | ❌ W0 | ⬜ pending |
| 14-01-04 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "retry"` | ❌ W0 | ⬜ pending |
| 14-01-05 | 01 | 1 | DB-03 | T-14-01 | Missing event returns null, not fake data | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "missing event"` | ❌ W0 | ⬜ pending |
| 14-01-06 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "Transfer fallback"` | ❌ W0 | ⬜ pending |
| 14-02-01 | 02 | 2 | DB-03 | — | N/A | unit | `npx vitest run test/unit/exitEngine.test.ts` | ✅ | ⬜ pending |
| 14-02-02 | 02 | 2 | DB-04 | — | N/A | unit | `npx vitest run test/unit/db.test.ts -t "P&L"` | ✅ (partial) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/receiptDecoder.test.ts` — stubs for DB-03 receipt decoding behaviors
- [ ] `test/fixtures/receipt.fixtures.ts` — mock TransactionReceipt and Log objects

*Existing `test/unit/exitEngine.test.ts` tests pure functions. Receipt decoder as an extracted utility enables focused unit testing without heavy mocking.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end sell records amountOut on live chain | DB-03 | Requires actual DEX swap with real tokens | Deploy to testnet, execute sell, verify trades table row |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
