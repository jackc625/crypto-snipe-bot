---
phase: 7
slug: smart-exit-strategies
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-25
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.1 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | EXIT-01 | unit | `npx vitest run test/unit/exitEngine.test.ts` | ✅ | ✅ green |
| 07-01-02 | 01 | 1 | EXIT-02 | unit | `npx vitest run test/unit/exitEngine.test.ts` | ✅ | ✅ green |
| 07-02-01 | 02 | 1 | EXIT-03 | unit | `npx vitest run test/unit/exitEngine.test.ts` | ✅ | ✅ green |
| 07-02-02 | 02 | 1 | EXIT-04 | unit | `npx vitest run test/unit/exitEngine.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Test Coverage Detail

### EXIT-01: Trailing stop-loss (13 tests)
- `test/unit/exitEngine.test.ts` — computeEffectiveTrailingPct (5 tests: base pct, volatility widening, urgency tightening, min clamp, max clamp)
- `test/unit/exitEngineSell.test.ts` — executeFullSell receipt decoding (2 tests: with/without receipt data)
- `test/unit/exitEngineZeroBalance.test.ts` — zero balance handling (6 tests)
- `test/integration/exitMonitor.test.ts` — trailing stop fires at correct threshold, stop-loss fires at correct threshold, no premature sell for stable prices

### EXIT-02: Partial sell targets (14 tests)
- `test/unit/exitEngine.test.ts` — parsePartialSellTargets (5 tests: parse, empty, undefined, total>=100%, sort)
- `test/unit/exitEngine.test.ts` — getUnfilledTiers (5 tests: reached tiers, all completed, gap sell, exclude completed, below all)
- `test/unit/exitEngine.test.ts` — calculatePartialSellAmount (3 tests: BigInt, multi-tier gap, empty)
- `test/unit/exitEngineSell.test.ts` — executePartialSell receipt decoding (1 test)
- `test/integration/exitMonitor.test.ts` — getUnfilledTiers gap price jumps, calculatePartialSellAmount BigInt

### EXIT-03: Volatility-adaptive thresholds (10 tests)
- `test/unit/exitEngine.test.ts` — VolatilityTracker (5 tests: insufficient samples, high vol, low vol, maxSamples, serialize/deserialize)
- `test/unit/exitEngine.test.ts` — computeEffectiveTrailingPct (5 tests shared with EXIT-01)
- `test/integration/exitMonitor.test.ts` — VolatilityTracker increases effective trailing pct under high volatility

### EXIT-04: Time-weighted exit urgency (7 tests)
- `test/unit/exitEngine.test.ts` — computeUrgencyMultiplier (5 tests: t=0, half window, window end, past window, before start)
- `test/integration/exitMonitor.test.ts` — urgency multiplier tightens trailing stop as position ages

### Cross-cutting: State persistence (4 tests)
- `test/unit/exitEngine.test.ts` — round-trip serialize/deserialize, empty completedTierIndices, BigInt preservation, corrupt JSON

### Cross-cutting: Connection resilience (3 tests)
- `test/integration/exitMonitor.test.ts` — queryPrice returns null on ECONNRESET, stale price recovery, connection failures don't corrupt state

### Cross-cutting: Sell lock mutex (9 tests)
- `test/integration/exitMonitor.test.ts` — acquire/reject/release/re-acquire, chain isolation, token isolation, timer registration/clear

---

## Wave 0 Requirements

- [x] `test/unit/exitEngine.test.ts` — tests for EXIT-01, EXIT-02, EXIT-03, EXIT-04
- [x] `test/fixtures/exitEngine.fixtures.ts` — shared fixtures for exit engine testing
- [x] `test/unit/exitEngineSell.test.ts` — executeFullSell/executePartialSell tests
- [x] `test/unit/exitEngineZeroBalance.test.ts` — zero balance edge case tests
- [x] `test/integration/exitMonitor.test.ts` — integration tests for sell lock, triggers, connection resilience

*Existing vitest infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live trailing stop triggers sell on-chain | EXIT-01 | Requires real DEX interaction | Deploy to testnet, buy token, observe trailing stop sell |
| Partial sell executes on-chain | EXIT-02 | Requires real DEX interaction | Deploy to testnet, wait for price target, verify partial sell TX |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 1s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-13

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Total tests (exit engine) | 63 |
| Test files | 4 |
| All green | Yes |
