---
phase: 10
slug: partial-sell-revenue-fix
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-30
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~13 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 13 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 01 | 1 | DB-04, DASH-02 | unit | `npx vitest run test/unit/db.test.ts` | ✅ | ✅ green |
| 10-01-T2 | 01 | 1 | DB-04 | unit | `npx vitest run test/unit/riskManager.test.ts` | ✅ | ✅ green |
| 10-02-T1 | 02 | 2 | DB-04, DASH-02 | integration | `npx vitest run test/integration/api/trades.test.ts test/integration/api/risk.test.ts` | ✅ | ✅ green |
| 10-02-T2 | 02 | 2 | DASH-02 | integration | `npx vitest run test/integration/api/trades.test.ts test/integration/api/positions.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement Coverage Detail

| Requirement | Behavior | Test File | Test Name | Status |
|-------------|----------|-----------|-----------|--------|
| DB-04 | P&L aggregates partial_sell+sell per buy | test/unit/db.test.ts:301 | getPnL aggregates partial_sell + sell into one row per buy | ✅ COVERED |
| DB-04 | sell_count=0 for buy with no sells | test/unit/db.test.ts:322 | getPnL returns sell_count = 0 for buy with no sells | ✅ COVERED |
| DB-04 | Partial realized P&L for open position | test/unit/db.test.ts:339 | getPnL shows partial realized P&L for open position with partial sells (D-03) | ✅ COVERED |
| DB-04 | getTotalExposure subtracts partial sells | test/unit/db.test.ts:358 | getTotalExposure subtracts partial sell proceeds (D-04) | ✅ COVERED |
| DB-04 | getDeployedCapitalByChain subtracts partial sells | test/unit/db.test.ts:373 | getDeployedCapitalByChain subtracts partial sell proceeds (D-04) | ✅ COVERED |
| DB-04 | getDailyRealizedLoss includes partial_sell | test/unit/db.test.ts:388 | getDailyRealizedLoss includes partial_sell events (D-05) | ✅ COVERED |
| DB-04 | Daily loss: partial sell profit offsets later loss | test/unit/db.test.ts:407 | getDailyRealizedLoss: partial sell profit offsets later loss (D-05) | ✅ COVERED |
| DB-04 | No cross-matching across different buys | test/unit/db.test.ts:456 | getPnL does not cross-match sells across different buys of same token | ✅ COVERED |
| DB-04 | riskManager exposure reduction | test/unit/riskManager.test.ts:112 | returns exposure reduced by partial sell proceeds | ✅ COVERED |
| DASH-02 | Per-event chart data sorted by timestamp | test/unit/db.test.ts:429 | getPnLChartData returns per-event rows sorted by timestamp (D-07) | ✅ COVERED |
| DASH-02 | sellCount in API response | test/integration/api/trades.test.ts:184 | includes sellCount in response per D-02 | ✅ COVERED |
| DASH-02 | Open status for pending buy with partial sells | test/integration/api/trades.test.ts:210 | shows open status for pending buy with partial sells | ✅ COVERED |
| DASH-02 | Per-event P&L chart with partial_sell | test/integration/api/risk.test.ts:108 | returns cumulative data points from per-event sell data (D-07) | ✅ COVERED |

---

## Wave 0 Requirements

- [x] Test stubs for P&L query aggregation (DB-04) — 9 tests in test/unit/db.test.ts
- [x] Test stubs for exposure reduction queries (DB-04) — 3 tests across db.test.ts and riskManager.test.ts
- [x] Test stubs for daily loss accounting (DB-04) — 2 tests in test/unit/db.test.ts
- [x] Test stubs for trade history display (DASH-02) — 3 integration tests across trades.test.ts and risk.test.ts

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| P&L chart data points at partial sell timestamps | DASH-02 | Visual chart rendering | Query chart endpoint, verify each partial_sell has a data point at its timestamp |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-13

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Total requirements | 13 |
| Automated coverage | 13 |
| Manual-only | 1 |
| Test suite status | 358 passed / 0 failed |

---

## Harm-Prevention Assertion (Phase 17 / DEBT-05)

**Harm scenario:** A regression in the receipt-decoder integration leaves `partial_sell` rows with `amount_out: null` (the legacy P&L-blind state Phase 10 explicitly fixed). Without an explicit harm-prevention guard, future refactors to `executePartialSell` could silently drop the `decodeReceipt` call and return to null-amount-out rows.

**Pointer to test:** `test/unit/exitEngineSell.test.ts` describe block `Phase 10 harm-prevention: partial-sell amount_out is non-null on receipt-decoded sell` (single `it` block at end of file).

**D-04 observable effects asserted:**
- `expect(insertTradeRun).toHaveBeenCalledWith(expect.objectContaining({action: 'partial_sell', amountOut: '500000000000000000', gasCost: expect.any(String), block: expect.any(Number)}))` — DB row written with `action='partial_sell'`, non-null `amountOut`, non-null `gasCost`, and non-null `block`.
- `expect(decodeReceiptMock).toHaveBeenCalledTimes(1)` — receipt-decoder path was actually exercised (not the legacy null path that fires only on void txHash).
- `expect(result).toBe(true)` — function-return success.

**Test scope:** Invokes `executePartialSell` with the exact 8-parameter signature `(ctx, dex, tokenAddress, feeTier, sellAmount, tiers, state, currentMultiple)` per src/exitEngine.ts:531-540 verbatim.

**Why this test exists despite Phase 10's strong existing coverage:** Phase 10 has 13 existing tests in `test/unit/db.test.ts` and `test/unit/exitEngineSell.test.ts`, but none are wrapped under the `Phase N harm-prevention:` discoverability prefix. Per D-03 the prefix IS the audit query that closes DEBT-05.

**Cross-reference:** `.planning/milestones/v6.17-debt-baseline.md` for the v6.17 baseline anchor.
