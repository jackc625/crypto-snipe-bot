---
phase: 1
slug: bug-fixes-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Mocha + Chai (via Hardhat test runner, already in devDependencies) |
| **Config file** | `hardhat.config.ts` (exists) |
| **Quick run command** | `npx hardhat test` |
| **Full suite command** | `npx hardhat test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx hardhat test`
- **After every plan wave:** Run `npx hardhat test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | FIX-01 | unit | `npx hardhat test test/exitManager.test.ts --grep "mutex"` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | FIX-02 | unit | `npx hardhat test test/flashbots.test.ts --grep "relay"` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | FIX-03 | unit | `npx hardhat test test/txManager.test.ts --grep "nonce"` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 1 | FIX-04 | unit | `npx hardhat test test/bot.test.ts --grep "simulation"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | FIX-05 | unit | `npx hardhat test test/exitManager.test.ts --grep "shutdown"` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 1 | FIX-06 | unit | `npx hardhat test test/config.test.ts --grep "validation"` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | FIX-07 | unit | `npx hardhat test test/exitManager.test.ts --grep "timed"` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 1 | FIX-08 | unit | `npx hardhat test test/bot.test.ts --grep "balance"` | ❌ W0 | ⬜ pending |
| 01-03-04 | 03 | 2 | FIX-09 | unit | `npx hardhat test test/telegramListener.test.ts --grep "whitelist"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/` directory — create it
- [ ] `test/exitManager.test.ts` — stubs for FIX-01, FIX-05, FIX-07
- [ ] `test/flashbots.test.ts` — stubs for FIX-02
- [ ] `test/txManager.test.ts` — stubs for FIX-03
- [ ] `test/bot.test.ts` — stubs for FIX-04, FIX-08
- [ ] `test/config.test.ts` — stubs for FIX-06
- [ ] `test/telegramListener.test.ts` — stubs for FIX-09

*Mocha + Chai already in devDependencies via Hardhat. No additional framework installation needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SIGTERM exits within 5s | FIX-05 | Requires process signal delivery | Start bot, send `kill -SIGTERM <pid>`, verify exit within 5s |
| Resume monitoring on restart | FIX-05 | Requires process restart cycle | Write state with pending positions, restart bot, verify monitoring resumes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
