---
phase: 18
slug: honeypot-detection-rebuild
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Skeleton derived from `18-RESEARCH.md` §"Validation Architecture".
> The planner fills the Per-Task Verification Map during `/gsd:plan-phase`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.1` (already configured) |
| **Config file** | `vitest.config.ts` (3 projects: `unit`, `integration`, `fork`) |
| **Solidity compile** | `npx hardhat compile` (runs in CI on `contracts/**` changes) |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npm run test:all` (unit + integration + fork) |
| **Estimated runtime** | ~5s unit · ~15s integration · ~120s fork |

---

## Sampling Rate

- **After every task commit:** `npx vitest run --project unit` (+ `npx hardhat compile` if `contracts/**` touched)
- **After every plan wave:** `npm run test:all` (+ Slither/Mythril if `contracts/**` touched)
- **Before `/gsd:verify-work`:** Full suite green + Slither/Mythril clean + Etherscan-verified ETH deploy (HONEY-03)
- **Max feedback latency:** 5s (unit) · 120s (fork-on-wave-merge)

---

## Per-Task Verification Map

> Planner fills this table during `/gsd:plan-phase`. Each task gets a row mapping its
> ID + requirement + threat ref to a runnable automated command (or Wave 0 dependency).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | HONEY-{XX} | T-18-XX / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Per `18-RESEARCH.md` §"Wave 0 Gaps" — 15 new test files + 3 tooling items.

**Test files (15 new):**
- [ ] `test/fixtures/contracts/Honeypot.sol` — contrived test honeypot (D-FIXTURE)
- [ ] `test/fork/fixtures/honeypots/README.md` + `eth-*.json` × 1-2 per chain (D-FIXTURE real)
- [ ] `test/fork/honeypotChecker.fork.test.ts` — roundtrip against contrived + real fixtures (HONEY-01)
- [ ] `test/fork/honeypotMultiAmount.fork.test.ts` — 1%/50%/100% probe semantics (HONEY-10)
- [ ] `test/integration/honeypotDispatch.test.ts` — dispatch routing (HONEY-05)
- [ ] `test/integration/honeypotUnknownFailsClosed.test.ts` — unknown semantics (HONEY-06)
- [ ] `test/integration/honeypotDeploy.eth.test.ts` — code-at-address verification (HONEY-03)
- [ ] `test/integration/v2HoneypotIntegration.test.ts` — V2 in-place replacement (HONEY-07)
- [ ] `test/integration/v3HoneypotIntegration.test.ts` — V3 in-place replacement (HONEY-08)
- [ ] `test/unit/honeypotTypes.test.ts` — discriminated union compile gate (HONEY-06)
- [ ] `test/unit/honeypotDispatch.test.ts` — dispatch unit tests (HONEY-05)
- [ ] `test/unit/honeypotTaxThreshold.test.ts` — threshold enforcement (HONEY-09)
- [ ] `test/unit/bytecodeScan.test.ts` — HONEY-12 selector matching
- [ ] `test/unit/safetyBank/*.test.ts` × 8 — HONEY-11 audit regressions (one per gate)

**Tooling (3 new):**
- [ ] `scripts/check-mythril-report.ts` — JSON severity gate for Mythril CI
- [ ] Slither + Mythril install steps in `.github/workflows/test.yml`
- [ ] `npx hardhat compile` gate in CI on `contracts/**` changes

**Regression-pattern boilerplate** (proves a gate didn't regress to vacuous-pass) — see
`18-RESEARCH.md` §"What Regression-Test Pattern Proves a Gate Didn't Regress to Vacuous-Pass?"
for the canonical vitest template the planner reuses 8 times under HONEY-11.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live mainnet snipe lands with `verdict: 'safe'` + Etherscan tx hash | HONEY-03, Success #1 | Requires real ETH + real new pair detection at runtime | Operator runs bot against `ENABLED_CHAINS=eth`; first V2 snipe attempt after deploy must succeed; tx hash captured in pino log |
| Etherscan source verification on deployed `HoneypotChecker.sol` | HONEY-03, HONEY-04 | Explorer UI verification is interactive | Operator runs `npx hardhat verify --network <chain> <address>`; confirms "Verified" badge in explorer |
| Real-mainnet honeypot fixture candidates pass live observation | HONEY-04 prereq | 2-3 day live observation window per D-CONTRACT-ROLLOUT | Operator monitors pino + Telegram for 2-3 days post-ETH-deploy; no false-unsafe verdicts on known-good launches |
| `DEPLOY_PRIVATE_KEY` rotated out of `.env` post-deploy | D-DEPLOY-KEY | Operational key hygiene | Operator removes line from `.env` after each chain's deploy commit; documented in operator runbook |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (15 test files + 3 tooling items above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s for per-task quick run
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
