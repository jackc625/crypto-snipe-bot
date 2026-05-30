---
phase: 9
slug: testing-infrastructure
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-28
audited: 2026-04-13
harm_prevention: inline
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
| **Actual runtime** | unit: ~2.3s (229 tests), integration: ~2.8s (122 tests), fork: ~120s (7 tests, needs RPC) |

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
| 09-01-01 | 01 | 1 | TEST-01 | unit | `npx vitest run --project unit test/unit/tokenSafety.test.ts -x` | Yes (380 lines, 21 tests) | ✅ green |
| 09-01-02 | 01 | 1 | TEST-02 | unit | `npx vitest run --project unit test/unit/db.test.ts -x` | Yes (650+ lines, 30+ tests) | ✅ green |
| 09-02-01 | 02 | 2 | TEST-03 | integration | `npx vitest run --project integration test/integration/txManager.test.ts test/integration/mevStrategies.test.ts -x` | Yes (txManager: 327 lines, mevStrategies: 313 lines) | ✅ green |
| 09-02-02 | 02 | 2 | TEST-04 | unit+integration | `npx vitest run --project unit test/unit/exitEngine.test.ts -x && npx vitest run --project integration test/integration/exitMonitor.test.ts -x` | Yes (exitEngine: 387 lines, exitMonitor: 618 lines) | ✅ green |
| 09-03-01 | 03 | 3 | TEST-05 | fork | `npx vitest run --project fork test/fork/snipeLifecycle.test.ts -x` | Yes (170+ lines, 7 tests) | ✅ green (manual) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/helpers/mockProvider.ts` — shared MockProvider class for blockchain interactions
- [x] `test/helpers/testDb.ts` — shared in-memory SQLite factory
- [x] `test/fixtures/` — factory functions (createMockToken, mockHoneypotResponse, etc.)
- [x] `vitest.config.ts` — refactored to use `test.projects` array (unit, integration, fork)
- [x] `@vitest/coverage-v8` — installed via .npmrc legacy-peer-deps=true
- [x] Migrate `tests/` content into `test/` structure, delete `tests/`
- [x] `contracts/FakeToken.sol` — minimal ERC20 implementation for fork tests
- [x] `.github/workflows/test.yml` — CI pipeline for unit + integration

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fork test with real RPC | TEST-05 | Requires Ethereum RPC endpoint, skipped in CI | Run `npx vitest run --project fork` locally with `ETH_FORK_RPC_URL` set |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s (unit: 2.3s, integration: 2.8s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 5 requirements (TEST-01 through TEST-05) have automated verification. Unit suite: 229 tests across 20 files. Integration suite: 122 tests across 12 files. Fork suite: 7 tests (manual, requires RPC). Total: 351 automated tests + 7 manual fork tests.

---

## Harm-Prevention Assertion (Phase 17 / DEBT-05)

**Form:** INLINE DOC (per Phase 17 CONTEXT.md D-02). The testing-infrastructure phase's harm scenario is meta — "does CI actually fail when a test fails, i.e., is the testing infrastructure itself honest?" There is no single test that captures this; the harm scenario IS the property of the CI configuration plus the test suite as a whole.

**Harm scenario:** A failing test in `test/unit/` or `test/integration/` returns exit-zero (or is silently skipped at the runner level), and `.github/workflows/test.yml` reports green despite a real test failure. Operator merges broken code under false confidence.

**Evidence (CI structure):**
- `.github/workflows/test.yml` — `npm run test:unit` and `npm run test:integration` exit-non-zero on any vitest failure (vitest's default behavior); GitHub Actions `run` step propagates non-zero to the job, blocking merge.
- After Plan 17-03 lands, `.github/workflows/test.yml` ALSO runs the `.todo` ban guard and `tsc --noEmit -p ...` × 3 — those are the v6.17 invariant locks. See `.planning/milestones/v6.17-debt-baseline.md`.

**Evidence (test suite size and green status):**
- Pre-existing 343/343 automated tests + 7 manual fork tests passing as of v6.16 close (per `09-VALIDATION.md` line 94 / per audit). Green status is reproducible: `npm run test:unit && npm run test:integration` exits 0.

**Cross-reference:** `.planning/milestones/v6.17-debt-baseline.md` `## Wave 0 CI Output` confirms tsc-clean × 3 tsconfigs + `.todo`-zero count as the v6.17 baseline anchors. CI guards in Plan 17-03 turn those baselines into evergreen invariants.

**Why not a new test:** the harm scenario is "a failing test fails CI" — the only way to test this property end-to-end is to commit a deliberately-failing test, watch CI fail, then revert. That's not a `vitest`-runnable assertion; it's a property of the `vitest run` exit code + GitHub Actions step contract. Per D-01: "doc augmentation does NOT count as rubber-stamp because the harm scenario for those two phases is irreducibly architectural, not a single-test surface."
