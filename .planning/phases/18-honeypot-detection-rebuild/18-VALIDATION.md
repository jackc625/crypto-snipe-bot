---
phase: 18
slug: honeypot-detection-rebuild
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-15
revised: 2026-05-15 (iter-2 plan-checker revisions applied)
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Skeleton derived from `18-RESEARCH.md` §"Validation Architecture".
> Per-Task Verification Map filled in iter-2 revision (closes Warning #7).

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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-00-01 | 00 | 0 | HONEY-12 | T-18-00-01 | REQUIREMENTS.md HONEY-12 row exists with exact substrings before any wave-1 plan reads it | doc-grep | `node -e \"const f=require('fs').readFileSync('.planning/REQUIREMENTS.md','utf8'); if(!/\\*\\*HONEY-12\\*\\*/.test(f)) process.exit(1)\"` | ✅ | ⬜ pending |
| 18-01-01 | 01 | 1 | HONEY-12 | T-18-02 | Honeypot.sol 5-mode contrived fixture compiles under solc 0.8.28 with 4-arg constructor including amountTierThreshold (Warning #6) | compile | `npx hardhat compile` exits 0 + grep mode markers 0-4 | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | HONEY-12 | T-18-01 | 3 real-mainnet fixtures (2 V2 + 1 V3 per Blocker #1) parse + contain canonical fields | json-parse | `node -e \"...parse fixture JSONs...\"` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 1 | HONEY-01 | T-18-03,T-18-04,T-18-03b,T-18-04b,T-18-06 | HoneypotChecker.sol compiles with BOTH checkV2 + checkV3 (Blocker #1); no admin surface; receive() present; post-trade asserts encoded | compile + grep | `npx hardhat compile` + grep V2 + V3 entry points | ❌ W0 | ⬜ pending |
| 18-02-02 | 02 | 1 | HONEY-06 | T-18-05 | HoneypotResult discriminated union makes literal `{verdict:'safe', evidence:{}}` fail tsc; HONEYPOT_CHECKER_ABI covers V2 + V3 fragments | tsc + unit | `npx tsc --noEmit && npx vitest run --project unit test/unit/honeypotTypes.test.ts` | ❌ W0 | ⬜ pending |
| 18-02-03 | 02 | 1 | HONEY-05 | T-18-08,T-18-08b,T-18-08c | Dispatch routes V2/V3 on dex.dexType; NEVER throws on unknown method; checkerContract.ts placeholder ships with Warning #9 sentinel | tsc + grep | `npx tsc --noEmit && grep -c \"throw new Error\" src/utils/honeypot/index.ts` returns 0; grep for sentinel = 1 | ❌ W0 | ⬜ pending |
| 18-03-01 | 03 | 1 | HONEY-12 | T-18-09,T-18-10 | bytecodeScan.ts contains 19 selectors + scan-failed sentinel; case-insensitive; fail-closed catch returns isMutable=true | unit | `npx vitest run --project unit test/unit/bytecodeScan.test.ts` | ❌ W0 | ⬜ pending |
| 18-03-02 | 03 | 1 | HONEY-02 | T-18-11 | scripts/check-mythril-report.ts exits 1 on Medium+ severity; exits 0 on clean report | smoke | Bash invocation against sample-high.json + sample-clean.json | ❌ W0 | ⬜ pending |
| 18-04-01 | 04 | 1 | HONEY-11 | T-18-13,T-18-14 | 8 per-gate regression test files in test/unit/safetyBank/; each asserts unsafe-equivalent + observable-effect call | unit | `npx vitest run --project unit test/unit/safetyBank/` | ❌ W0 | ⬜ pending |
| 18-04-02 | 04 | 1 | HONEY-11 | T-18-13 | isBlacklistedTokenForChain retrofitted with try/catch fail-closed `return true` | unit + grep | `npx vitest run --project unit test/unit/safetyBank/isBlacklistedTokenForChain.test.ts` | ❌ W0 | ⬜ pending |
| 18-04-03 | 04 | 1 | HONEY-11 | T-18-15 | v6.17-safety-bank-audit.md committed with 8-row per-gate table + Stop-the-Line determination + Retrofit decision | doc-grep | `node -e \"...grep audit doc...\"` | ❌ W0 | ⬜ pending |
| 18-05-01 | 05 | 2 | HONEY-02 | — | Operator confirms slither + mythril CLI versions captured | human | resume-signal payload | N/A | ⬜ pending |
| 18-05-02 | 05 | 2 | HONEY-02 | T-18-16,T-18-19 | Slither --fail-medium clean OR all findings dispositioned; Mythril severity gate clean; audit doc commits "NO escalation; deploy gate cleared for HONEY-03" OR "ESCALATED to HONEY-13"; audit covers V2 + V3 per Blocker #1 | doc-grep + tool | `node -e \"...grep audit doc has determination phrase...\"` | ❌ W0 | ⬜ pending |
| 18-05-03 | 05 | 2 | HONEY-02 | T-18-17 | .github/workflows/test.yml gains hardhat-compile + slither + mythril jobs gated on contracts/** | yaml-grep | `node -e \"...grep workflow has 3 new jobs...\"` | ❌ W0 | ⬜ pending |
| 18-06-01 | 06 | 2 | HONEY-05 | T-18-21 | ChainConfig.honeypotChecker field + tax-threshold env overlay; 4 templates default 1000 bps; out-of-range FATAL exit | unit + tsc | `npx tsc --noEmit && npx vitest run --project unit test/unit/chainRegistry.test.ts` | ❌ W0 | ⬜ pending |
| 18-06-02 | 06 | 2 | HONEY-05 | T-18-20 | hardhat.config has 4 deploy networks using DEPLOY_PRIVATE_KEY (NOT PRIVATE_KEY); etherscan.apiKey 4-key block | grep + compile | `node -e \"...grep + npx hardhat compile...\"` | ❌ W0 | ⬜ pending |
| 18-06-03 | 06 | 2 | HONEY-05 | T-18-22,T-18-23 | scripts/deploy-honeypot-checker.ts spawns Ignition deploy; FATAL on missing DEPLOY_PRIVATE_KEY; pino logging only | grep + tsc | `node -e \"...grep script...\"` | ❌ W0 | ⬜ pending |
| 18-07-01 | 07 | 3 | HONEY-03 | T-18-25b | Auto-grep precheck for "NO escalation; deploy gate cleared for HONEY-03" runs BEFORE operator instructions render (Blocker #4) | bash precheck + human | `grep -q "NO escalation; deploy gate cleared for HONEY-03" .planning/milestones/v6.17-honeypot-checker-audit.md` | N/A | ⬜ pending |
| 18-07-02 | 07 | 3 | HONEY-03 | T-18-24 | Operator runs deploy + verify; pastes back deployed address + tx hash | human | resume-signal payload | N/A | ⬜ pending |
| 18-07-03 | 07 | 3 | HONEY-03 | T-18-25,T-18-27b | ETH integration test asserts code-at-address; .env.example has 11 slots; chainRegistry.ts CHAIN_TEMPLATES['eth'].honeypotChecker.deployedAddress literal committed (Blocker #3); audit doc has HONEY-03 section | integration + grep | `npx tsc --noEmit && node -e \"...grep chainRegistry literal...\"` | ❌ W0 | ⬜ pending |
| 18-07-04 | 07 | 3 | HONEY-03 | T-18-26,T-18-27 | Operator confirms Etherscan verified source includes checkV2 + checkV3 (Blocker #1); 2-3 day observation calendar set | human | resume-signal | N/A | ⬜ pending |
| 18-08-01 | 08 | 5 | HONEY-04 | T-18-28 | Operator confirms ETH observation window closed cleanly | human | resume-signal | N/A | ⬜ pending |
| 18-08-02 | 08 | 5 | HONEY-04 | T-18-29,T-18-30 | Operator runs BSC + Base + Arb deploys + verifies; pastes back 3-chain table; rotates DEPLOY_PRIVATE_KEY out | human | resume-signal | N/A | ⬜ pending |
| 18-08-03 | 08 | 5 | HONEY-04 | T-18-31,T-18-31b | 3 integration tests exist; chainRegistry.ts CHAIN_TEMPLATES['bsc'|'base'|'arb'].honeypotChecker.deployedAddress literals committed via 3 separate per-chain commits (Blocker #3); audit doc has HONEY-04 section + chainRegistry Commit column | integration + grep + git-log | `node -e \"...grep chainRegistry ≥4 literals...\"` | ❌ W0 | ⬜ pending |
| 18-09-01 | 09 | 5 | HONEY-09,HONEY-10 | T-18-32,T-18-33,T-18-41,T-18-42 | simulateViaContractV2 + simulateViaContractV3 implemented (Blocker #1); from=ctx.wallet.address; 3-probe parallel; tax threshold enforcement; sentinel "NOT_IMPLEMENTED: checkerContract wave-5 deliverable" ABSENT (Warning #9) | unit + integration + grep | `npx tsc --noEmit && npx vitest run` | ❌ W0 | ⬜ pending |
| 18-09-02 | 09 | 5 | HONEY-07,HONEY-08 | T-18-39 | simulateSellForChain + simulateSellV3ForChain DELETED from tokenSafety.ts; no SAFETY_USE_LEGACY_SIM flag (D-ROLLBACK) | grep | `node -e \"...grep tokenSafety.ts has no exports...\"` | ❌ W0 | ⬜ pending |
| 18-09-03 | 09 | 5 | HONEY-08,HONEY-10 | T-18-34,T-18-35,T-18-40 | Fork tests against 5-mode Honeypot.sol (Warning #6) + V3 fixture (Blocker #1) all assert verdict !== 'safe'; multi-amount tests exercise mode-4 amountTierThreshold | fork | `npx vitest run --project fork` | ❌ W0 | ⬜ pending |
| 18-10-01 | 10 | 6 | HONEY-07,HONEY-08,HONEY-12 | T-18-36,T-18-38,T-18-43 | bot.ts wires V2 + V3 gates (V3 passes feeTier through per Blocker #1); parallel banks add isMutableTokenForChain as 9th/6th gate; D-ALERTS alert format augmented | tsc + grep | `npx tsc --noEmit && node -e \"...grep bot.ts...\"` | ❌ W0 | ⬜ pending |
| 18-10-02 | 10 | 6 | HONEY-07,HONEY-08,HONEY-12 | T-18-38 | V3 integration tests assert V3 unsafe (V3 honeypot fixture) + V3 safe (known-good token) reach the dispatch (Blocker #1 — V3 no longer perpetually 'unknown'); HONEY-12 mutable-tax test on both V2 + V3 paths | integration | `npx vitest run --project integration test/integration/v2HoneypotIntegration.test.ts test/integration/v3HoneypotIntegration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*File Exists: ✅ exists today · ❌ W0 created during execution as Wave-0 dependency · N/A operator-driven task*

---

## Wave 0 Requirements

Per `18-RESEARCH.md` §"Wave 0 Gaps" — 17 new test files + 3 tooling items (iter-2 revision: +2 V3 integration tests via 18-10; mode-4 contrived fixture authored at 18-01 per Warning #6).

**Test files (17 new):**
- [ ] `test/fixtures/contracts/Honeypot.sol` — contrived 5-mode test honeypot (Warning #6: mode-4 amount-tiered authored at 18-01)
- [ ] `test/fork/fixtures/honeypots/README.md` + `eth-sell-revert.json` + `eth-max-wallet.json` + `eth-v3-honeypot.json` (Blocker #1)
- [ ] `test/fork/honeypotChecker.fork.test.ts` — roundtrip against 4 V2 modes + V3 fixture (HONEY-01 + Blocker #1)
- [ ] `test/fork/honeypotMultiAmount.fork.test.ts` — 1%/50%/100% probe semantics using mode-4 (HONEY-10)
- [ ] `test/integration/honeypotDispatch.test.ts` — dispatch routing V2 + V3 (HONEY-05 + Blocker #1)
- [ ] `test/integration/honeypotUnknownFailsClosed.test.ts` — unknown semantics V2 + V3 (HONEY-06 + Blocker #1)
- [ ] `test/integration/honeypotDeploy.eth.test.ts` — code-at-address verification (HONEY-03)
- [ ] `test/integration/honeypotDeploy.bsc.test.ts` + base + arb (HONEY-04)
- [ ] `test/integration/v2HoneypotIntegration.test.ts` — V2 in-place replacement (HONEY-07)
- [ ] `test/integration/v3HoneypotIntegration.test.ts` — V3 in-place replacement with V3 unsafe + V3 safe coverage (HONEY-08 + Blocker #1)
- [ ] `test/unit/honeypotTypes.test.ts` — discriminated union compile gate (HONEY-06)
- [ ] `test/unit/honeypotDispatch.test.ts` — dispatch unit tests V2 + V3 (HONEY-05 + Blocker #1)
- [ ] `test/unit/honeypotTaxThreshold.test.ts` — threshold enforcement V2 + V3 (HONEY-09)
- [ ] `test/unit/bytecodeScan.test.ts` — HONEY-12 selector matching
- [ ] `test/unit/safetyBank/*.test.ts` × 8 — HONEY-11 audit regressions (one per gate)

**Tooling (3 new):**
- [ ] `scripts/check-mythril-report.ts` — JSON severity gate for Mythril CI
- [ ] Slither + Mythril install steps in `.github/workflows/test.yml`
- [ ] `npx hardhat compile` gate in CI on `contracts/**` changes

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live mainnet V2 snipe lands with `verdict: 'safe'` + Etherscan tx hash | HONEY-03, Success #1 | Requires real ETH + real new pair detection at runtime | Operator runs bot against `ENABLED_CHAINS=eth`; first V2 snipe attempt after deploy must succeed; tx hash captured in pino log |
| Live mainnet V3 snipe lands with `verdict: 'safe'` + Etherscan tx hash (Blocker #1) | HONEY-08, Success #1 | Requires real ETH + real new V3 pool detection | Operator confirms V3 path no longer perpetually skips; first V3 snipe attempt with safe verdict must succeed |
| Etherscan source verification on deployed `HoneypotChecker.sol` (checkV2 + checkV3) | HONEY-03, HONEY-04 | Explorer UI verification is interactive; Blocker #1 needs both functions visible | Operator runs `npx hardhat verify`; confirms both checkV2 + checkV3 functions appear in verified source |
| Real-mainnet honeypot fixture candidates pass live observation | HONEY-04 prereq | 2-3 day live observation window per D-CONTRACT-ROLLOUT | Operator monitors pino + Telegram for 2-3 days post-ETH-deploy; no false-unsafe verdicts on known-good launches |
| `DEPLOY_PRIVATE_KEY` rotated out of `.env` post-deploy | D-DEPLOY-KEY | Operational key hygiene | Operator removes line from `.env` after each chain's deploy commit |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — iter-2 revision verified
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — iter-2 revision verified
- [x] Wave 0 covers all MISSING references (17 test files + 3 tooling items above) — iter-2 revision updated counts
- [x] No watch-mode flags
- [x] Feedback latency < 5s for per-task quick run
- [x] `nyquist_compliant: true` set in frontmatter — iter-2 revision flipped from false

**Approval:** approved (iter-2 plan-checker revisions applied 2026-05-15)
