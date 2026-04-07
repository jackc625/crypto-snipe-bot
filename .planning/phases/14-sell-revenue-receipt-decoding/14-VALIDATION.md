---
phase: 14
slug: sell-revenue-receipt-decoding
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-06
audited: 2026-04-06
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
| 14-01-01 | 01 | 1 | DB-03 | T-14-01 | Only WETH contract logs trusted | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "T-14-01"` | ✅ | ✅ green |
| 14-01-02 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "gas cost"` | ✅ | ✅ green |
| 14-01-03 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "block number"` | ✅ | ✅ green |
| 14-01-04 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "retry"` | ✅ | ✅ green |
| 14-01-05 | 01 | 1 | DB-03 | T-14-01 | Missing event returns null, not fake data | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "D-02"` | ✅ | ✅ green |
| 14-01-06 | 01 | 1 | DB-03 | — | N/A | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "V3 WETH Transfer"` | ✅ | ✅ green |
| 14-02-01 | 02 | 2 | DB-03 | — | N/A | unit | `npx vitest run test/unit/exitEngineSell.test.ts -t "amountOut"` | ✅ | ✅ green |
| 14-02-02 | 02 | 2 | DB-04 | — | N/A | unit | `npx vitest run test/unit/db.test.ts -t "P&L"` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/unit/receiptDecoder.test.ts` — stubs for DB-03 receipt decoding behaviors
- [x] `test/fixtures/receipt.fixtures.ts` — mock TransactionReceipt and Log objects

*Existing `test/unit/exitEngine.test.ts` tests pure functions. Receipt decoder as an extracted utility enables focused unit testing without heavy mocking.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end sell records amountOut on live chain | DB-03 | Requires actual DEX swap with real tokens | Deploy to testnet, execute sell, verify trades table row |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ approved 2026-04-06

---

## Validation Audit 2026-04-06

| Metric | Count |
|--------|-------|
| Tasks audited | 8 |
| COVERED (green) | 8 |
| MISSING tests | 0 |
| Stale filter labels repaired | 4 |
| Resolved | 8 |
| Escalated to manual-only | 0 |

**Audit findings:**

- All 8 tasks have COVERED behavior — every requirement (DB-03, DB-04, T-14-01) is verified by passing automated tests.
- No test files needed to be generated; auditor agent not spawned.
- Four `-t` filter strings in the per-task map were typos that matched zero tests:
  - `extractAmountOut` → `T-14-01` (catches the spoofing test, which is the secure-behavior verification for 14-01-01)
  - `missing event` → `D-02` (catches `returns null amountOut but non-null gasCost/block when no WETH event present (D-02)`)
  - `Transfer fallback` → `V3 WETH Transfer` (catches `extracts amountOut from V3 WETH Transfer-to-wallet fallback`)
  - 14-02-01 redirected from `test/unit/exitEngine.test.ts` (pure-function tests, no decodeReceipt assertions) to `test/unit/exitEngineSell.test.ts -t "amountOut"` (the new execution-path tests that mock `decodeReceipt` and assert `insertTrade.run` receives the decoded values).
- All file-existence markers (`❌ W0`) refreshed to `✅` and statuses updated to `✅ green`.
- Wave 0 checkboxes ticked; sign-off checklist completed.

**Verification commands run during audit:**

- `npx vitest run test/unit/receiptDecoder.test.ts test/unit/exitEngineSell.test.ts` → 14/14 passed
- `npx vitest run test/integration/mevStrategies.test.ts` → 12/12 passed
- `npx vitest run --project unit` → 142/142 passed (no regressions)
- Each replacement filter individually exercised against vitest `-t` to confirm it matches at least one test.
