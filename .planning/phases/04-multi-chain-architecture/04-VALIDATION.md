---
phase: 4
slug: multi-chain-architecture
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
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

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | CHAIN-01 | unit | `npx hardhat test --grep "ChainRegistry"` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | CHAIN-02 | unit | `npx hardhat test --grep "ChainConfig"` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | CHAIN-03 | integration | `npx hardhat test --grep "multichain listener"` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | CHAIN-04 | unit | `npx hardhat test --grep "MevStrategy"` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | CHAIN-05 | unit | `npx hardhat test --grep "capital"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/chainRegistry.test.ts` — covers CHAIN-01, CHAIN-02 (unit tests for registry builder, env var loading, validation)
- [ ] `test/mevStrategy.test.ts` — covers CHAIN-04 (unit tests for strategy dispatch, health check, error handling)
- [ ] `test/multiChainBot.test.ts` — covers CHAIN-03 (integration test with local hardhat forks)
- [ ] `test/safetyProviders.test.ts` — covers CHAIN-02/CHAIN-13 (unit tests for GoPlus adapter, honeypot.is adapter routing)
- [ ] `test/fixtures/chainConfig.ts` — shared test fixtures for chain configs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| bloXroute BSC auth works | CHAIN-04 | Requires paid API key | Set `BLOXROUTE_AUTH_HEADER` env var, run bot with BSC enabled, verify private tx submission |
| WebSocket reconnect under real conditions | CHAIN-03 | Requires network disruption | Kill WS connection mid-run, verify reconnect with backoff, check Telegram alert sent |
| Telegram chain prefix display | CHAIN-05 | Visual verification | Trigger test alert per chain, verify `[ETH]`/`[BSC]`/`[BASE]`/`[ARB]` prefix renders correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
