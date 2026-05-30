---
phase: 4
slug: multi-chain-architecture
status: active
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-22
updated: 2026-03-22
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Hardhat + Chai (already configured in devDependencies) |
| **Config file** | `hardhat.config.ts` |
| **Quick run command** | `npx hardhat test --grep "chain"` |
| **Full suite command** | `npx hardhat test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx hardhat test --grep "chain" --bail`
- **After every plan wave:** Run `npx hardhat test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Wave 0 Plan

Wave 0 test infrastructure is created by **04-00-PLAN.md** (wave: 0, depends_on: []).

| File | Covers | Status |
|------|--------|--------|
| `test/fixtures/chainConfig.ts` | Shared mock configs for all 4 chains | Created by 04-00 |
| `test/chainRegistry.test.ts` | CHAIN-01, CHAIN-02 | Created by 04-00 |
| `test/mevStrategy.test.ts` | CHAIN-04 | Created by 04-00 |
| `test/multiChainBot.test.ts` | CHAIN-03 | Created by 04-00 |
| `test/safetyProviders.test.ts` | CHAIN-02, CHAIN-13 routing | Created by 04-00 |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-00-01 | 00 | 0 | ALL | fixtures | `npx tsc --noEmit --strict test/fixtures/chainConfig.ts` | W0 creates | pending |
| 04-00-02 | 00 | 0 | ALL | scaffolds | `npx hardhat test --bail` | W0 creates | pending |
| 04-01-01 | 01 | 1 | CHAIN-01 | unit | `npx hardhat test --grep "ChainRegistry" --bail` | yes (W0) | pending |
| 04-01-02 | 01 | 1 | CHAIN-02 | unit | `npx hardhat test --grep "ChainConfig" --bail` | yes (W0) | pending |
| 04-02-01 | 02 | 2 | CHAIN-04 | unit | `npx hardhat test --grep "MevStrategy" --bail` | yes (W0) | pending |
| 04-02-02 | 02 | 2 | CHAIN-04 | unit | `npx hardhat test --grep "MevStrategy" --bail` | yes (W0) | pending |
| 04-03-01 | 03 | 2 | CHAIN-02 | unit | `npx hardhat test --grep "SafetyProvider" --bail` | yes (W0) | pending |
| 04-03-02 | 03 | 2 | CHAIN-03 | unit | `npx hardhat test --grep "SafetyProvider" --bail` | yes (W0) | pending |
| 04-04-01 | 04 | 3 | CHAIN-03 | integration | `npx hardhat test --grep "multichain listener" --bail` | yes (W0) | pending |
| 04-04-02 | 04 | 3 | CHAIN-03 | integration | `npx hardhat test --grep "multichain listener" --bail` | yes (W0) | pending |
| 04-04-03 | 04 | 3 | CHAIN-05 | unit | `npx hardhat test --grep "capital" --bail` | yes (W0) | pending |
| 04-04-04 | 04 | 3 | CHAIN-03 | checkpoint | `npx tsc --noEmit && npx hardhat test --bail` | yes | pending |

*Status: pending · green · red · flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| bloXroute BSC auth works | CHAIN-04 | Requires paid API key | Set `BLOXROUTE_AUTH_HEADER` env var, run bot with BSC enabled, verify private tx submission |
| WebSocket reconnect under real conditions | CHAIN-03 | Requires network disruption | Kill WS connection mid-run, verify reconnect with backoff, check Telegram alert sent |
| Telegram chain prefix display | CHAIN-05 | Visual verification | Trigger test alert per chain, verify `[ETH]`/`[BSC]`/`[BASE]`/`[ARB]` prefix renders correctly |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify with behavioral test commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 plan (04-00-PLAN.md) creates all test files before Wave 1
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (revision pass)
