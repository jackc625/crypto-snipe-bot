---
phase: 9
slug: testing-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.1 |
| **Config file** | `vitest.config.ts` (refactored to use `test.projects`) |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (unit <5s, integration <15s, fork ~120s) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + coverage >= 70%
- **Max feedback latency:** 15 seconds (unit+integration)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | TEST-01 | unit | `npx vitest run --project unit test/unit/tokenSafety.test.ts -x` | No -- Wave 0 | ⬜ pending |
| 09-01-02 | 01 | 1 | TEST-02 | unit | `npx vitest run --project unit test/unit/db.test.ts -x` | No -- Wave 0 | ⬜ pending |
| 09-02-01 | 02 | 2 | TEST-03 | integration | `npx vitest run --project integration test/integration/txManager.test.ts -x` | No -- Wave 0 | ⬜ pending |
| 09-02-02 | 02 | 2 | TEST-04 | unit+integration | `npx vitest run --project unit test/unit/exitEngine.test.ts -x` | Partial | ⬜ pending |
| 09-03-01 | 03 | 3 | TEST-05 | fork | `npx vitest run --project fork test/fork/snipeLifecycle.test.ts -x` | No -- Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/helpers/mockProvider.ts` — shared MockProvider class for blockchain interactions
- [ ] `test/helpers/testDb.ts` — shared in-memory SQLite factory
- [ ] `test/fixtures/` — factory functions (createMockToken, mockHoneypotResponse, etc.)
- [ ] `vitest.config.ts` — refactored to use `test.projects` array (unit, integration, fork)
- [ ] `@vitest/coverage-v8` — install: `npm install --save-dev @vitest/coverage-v8 --legacy-peer-deps`
- [ ] Migrate `tests/` content into `test/` structure, delete `tests/`
- [ ] `contracts/FakeToken.sol` — write minimal ERC20 implementation for fork tests
- [ ] `.github/workflows/test.yml` — CI pipeline for unit + integration

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fork test with real RPC | TEST-05 | Requires Ethereum RPC endpoint, skipped in CI | Run `npx vitest run --project fork` locally with `MAINNET_RPC_URL` set |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
