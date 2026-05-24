---
gsd_state_version: 1.0
milestone: v6.17
milestone_name: Defensive Hardening for Live Mainnet
status: executing
stopped_at: Phase 19 UI-SPEC approved
last_updated: "2026-05-24T00:41:20.953Z"
last_activity: 2026-05-24 -- Phase 19 planning complete
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 24
  completed_plans: 13
  percent: 20
---

# Project State

<!--
  total_plans: 0 — will be populated by /gsd-plan-phase as each of Phases 17-21 is decomposed.
  Roadmap intentionally leaves "Plans: TBD" per phase; per-phase plan counts are not pre-budgeted.
-->

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29 — v6.17 milestone scoped)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management
**Current focus:** Phase 18 — honeypot-detection-rebuild

## Current Position

Phase: 18 (honeypot-detection-rebuild) — EXECUTING (18-08 DEFERRED; 10/11 plans done; phase verification gated on 18-08)
Plan: 10 of 11 complete (18-00..18-07, 18-09, 18-10); 18-08 (BSC/Base/Arb multi-chain HoneypotChecker deploy) DEFERRED per operator direction
Status: Ready to execute
Last activity: 2026-05-24 -- Phase 19 planning complete

## Performance Metrics

**v6.16 velocity (reference):**

- Total plans completed: 55
- Timeline: 26 days (2026-03-19 → 2026-04-13)
- Git: 395 conventional commits, 379 files changed, +87,015 / -71 lines

Per-plan breakdown preserved in `.planning/milestones/v6.16-ROADMAP.md`.

## Accumulated Context

### Recent Decisions

Full Key Decisions log in PROJECT.md and archived in `milestones/v6.16-ROADMAP.md`.

**v6.17 decisions closed by research convergence (2026-04-29):**

- **Plan 18-05 (2026-05-15):** HONEY-02 Slither + Mythril audit complete. Slither 0.11.5 surfaced 13 medium+ findings (4 High = `arbitrary-send-eth` × 2 + `reentrancy-balance` × 2; 9 Medium = `unused-return` × 6 + `uninitialized-local` × 2 + `incorrect-equality` × 1) — ALL 13 dispositioned `false-positive` against the eth_call-only revert-always contract design (router is caller-controlled by intent; no state persists; lying-balanceOf catch IS the reentrancy-balance pattern; catch-always-reverts hides the uninitialized-local flow-path; strict equality IS the correct semantic for `V3_SELL_WETH_ZERO`). Mythril 0.24.8 reported `success: true, issues: []` with `--execution-timeout 300 --max-depth 30`. **Stop-the-Line determination: NO escalation; deploy gate cleared for HONEY-03 (plan 18-07).** 0 `accepted-risk` rows → no operator sign-off required. CI gate (`.github/workflows/test.yml`) locks audit-bar evergreen via `dorny/paths-filter@v3` + 3 new jobs (`hardhat-compile` / `slither` / `mythril`) gated on `contracts/**` path changes; Phase 17 evergreen `.todo` ban + `tsc --noEmit ×3` guards preserved verbatim.
- **Plan 18-05 (2026-05-15):** D-AUDIT-PATH documented in `.planning/milestones/v6.17-honeypot-checker-audit.md`. Windows-host Mythril install requires Docker workaround: (a) `pip install mythril` fails on Python 3.13 (no prebuilt wheels for `ckzg`/`pyethash`; native build needs MSVC `cl.exe`); use `mythril/myth:latest` Docker image; (b) the image hardcodes `solc-bin.ethereum.org` (now NXDOMAIN) — bind-mount pre-downloaded Linux solc 0.8.28 ELF into `/home/mythril/.solcx/solc-v0.8.28`; (c) Mythril `--solc-args` does NOT forward remappings (calls `solc --standard-json` internally) — remappings MUST live in `--solc-json` settings JSON. CI on `ubuntu-latest` uses native `pip install mythril` + the `--solc-json` heredoc and skips the Docker dance.
- **Plan 18-06 (2026-05-15):** `ChainConfig.honeypotChecker` promoted from optional declaration-merge bridge (plan 18-02) to a **required** field on the source-of-truth interface; `NULL_CFG` fallback removed from `src/utils/honeypot/index.ts`. Downstream reads `ctx.chain.honeypotChecker.{deployedAddress, method, maxBuyTaxBps, maxSellTaxBps}` as type-safe required fields; no-deployed-address case still flows through the `'unknown'` verdict via explicit `cfg.deployedAddress` check (no optional chaining). `HoneypotCheckerConfig` re-exported from `chainRegistry.ts` for import locality alongside `ChainConfig`.
- **Plan 18-06 (2026-05-15):** `hardhat.config.ts` mainnet/bsc/base/arbitrum network entries use `DEPLOY_PRIVATE_KEY` exclusively per **D-DEPLOY-KEY** capability split; existing `sepolia` entry retains `PRIVATE_KEY` for test-only deploys. Bot wallet has no deploy authority on any production chain — T-18-20 mitigation enforced at the config layer with grep-assertion in the plan's verify gate. Conditional-spread pattern used (`...(cond ? { name: {...} } : {})`) over `name: cond ? {} : undefined` for cleaner `HardhatUserConfig` typing. `etherscan.apiKey` block uses `arbitrumOne` (canonical hardhat-verify name for Arbitrum One).
- **Plan 18-06 (2026-05-15):** `scripts/deploy-honeypot-checker.ts` deliberately does **NOT** auto-update `src/chainRegistry.ts` — T-18-23 audit-trail mitigation. Operator manually pastes deployed address into `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` env, preserving git-history record of which contract address became canonical at which commit. Uses `spawnSync` with `shell: true` for Windows `npx.cmd` resolution (no-op on POSIX). `DEPLOY_PRIVATE_KEY` is inherited via `process.env` without `HARDHAT_PRIVATE_KEY` rename — plan 18-07 will smoke-test on a real chain and add the shim back if Ignition 0.15.x requires it.
- **Plan 18-06 (2026-05-15):** Tax-threshold env validation (`<PREFIX>_MAX_{BUY,SELL}_TAX_BPS`) implements `Number.isNaN || > 10000 || < 0` guard with `log.fatal + process.exit(1)` per the existing chainRegistry FATAL pattern (T-18-21 mitigation). Three dedicated unit tests cover the three invalid-shape paths.
- **Plan 18-03 (2026-05-16):** HONEY-12 `isMutableTokenForChain` function + 7 unit tests shipped, but the HONEY-12 row in REQUIREMENTS.md stays **Pending** — the row text requires the parallel-safety-bank wire-up at `src/bot.ts:229-238`, which is plan 18-09's responsibility. Function is import-ready for that plan; row closes there.
- **Plan 18-03 (2026-05-16):** Mythril severity-gate CLI (`scripts/check-mythril-report.ts`) ships with zero new npm deps (Node `fs` + `process` only) per T-18-SC `accept` disposition. Consumed by plan 18-05's audit job as `npx ts-node scripts/check-mythril-report.ts <report.json>`; exits 1 on any `Medium` or `High` Mythril issue.
- Honeypot sell-sim architecture: **Option D primary, Option C opt-in fallback.** Closed by STACK.md + ARCHITECTURE.md + PITFALLS.md convergence on storage-layout robustness, multi-chain coverage, and integration ergonomics.
- Anti-rug detection trigger model: **event-driven WebSocket subscription with single-listener-per-chain pattern + HTTP poll fallback.** Closed; per-position subscriptions explicitly rejected (Pitfall #10 subscription-cap leaks).
- Going-live runbook destination: **move to `docs/operations/going-live.md`** atomic with root-file delete + CI guard against re-creation. Closed.
- Phase ordering: **17 (DEBT) → 18 (HONEY) → 19 (ANTIRUG) → 20 (OPS-LIVE) → 21 (EXIT-LIVE).** Validated 2026-04-29 against the dependency reasoning in research SUMMARY.md and ARCHITECTURE.md; no requirements moved between categories.

**Open decisions for plan-phase:**

- ANTIRUG threshold tuning (50% LP-removal default, confirm-after-N-blocks default) requires 7-day operational baseline data the bot does not yet have — dry-run mode is the v1 mitigation.
- Bytecode static analysis for mutable-tax setters (PITFALLS.md #5, FEATURES.md "Owner-renunciation check") flagged but not budgeted; decide during Phase 18 plan-phase whether to fold a minimal selector-presence flag into the safety bank or defer to v6.18.
- HONEYPOT-SIM-BRIEFING.md disposition (move to `docs/decisions/honeypot-sim-rebuild.md` vs delete) — decided during HONEY plan-phase, executed in Phase 20 (OPS-LIVE-13).

### Pending Todos

None — Phase 17 complete; ready for `/gsd-discuss-phase 18` or `/gsd-plan-phase 18`.

### Blockers / Concerns

**Live-runtime validation items deferred from v6.16** (now Phase 21 EXIT-LIVE-01..11):

- Phase 3: bot startup with SQLite + `.bot-state.json` auto-migration → EXIT-LIVE-07
- Phase 4: `startMultiChainBot` live ETH RPC smoke test → covered via Phase 20 OPS-LIVE preflight
- Phase 7: live exit engine poll cycle + state persistence across restart → EXIT-LIVE-01, EXIT-LIVE-02
- Phase 8: visual dashboard rendering + WS position updates → EXIT-LIVE-05
- Phase 11: live price display, Telegram status, chain restart warnings → EXIT-LIVE-06
- Phase 14: real sell records non-null amount_out + real Flashbots tx hash → EXIT-LIVE-03, EXIT-LIVE-04

**Active production blocker (Phase 18 lead):**

- `simulateSellForChain` (V2) hard-blocks every snipe via `INSUFFICIENT_INPUT_AMOUNT` (balance=0 footgun). `simulateSellV3ForChain` silently returns true — zero honeypot detection. Bot is funded on mainnet but cannot trade. Lead requirement for v6.17.

**Tech debt status RESOLVED (Phase 17 wave-0 baseline):**

- The disputed v6.16 close audit numbers (37 `.todo` stubs / 6 TS errors) were both stale. Wave-0 CI run on 2026-04-30 confirmed: 0 `.todo` matches, 3/3 tsconfigs exit clean. Branch A (verified-empty) close-out committed in `.planning/milestones/v6.17-debt-baseline.md`. The wave-0 baseline is now locked as evergreen via `.github/workflows/test.yml` invariant guards (`.todo` ban + tsc × 3).

### Nyquist Validation Debt

Closed by Phase 17 (DEBT-05). Phases 01, 02, 03, 05, 06, 07, 08, 09, 10 each have a harm-prevention assertion: 7 phases got new `Phase N harm-prevention:` describe blocks in existing test files (1 new file `test/integration/v3LiquidityWait.test.ts`); Phases 02 (ethers v6) and 09 (testing infra) got inline `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` sections in their VALIDATION.md. FIX-04 (Phase 1 V2 sell-sim) and V3-03 (Phase 5 V3 sell-sim) deferred to Phase 18 fresh-implementation per Pitfall #19 (HONEY-07, HONEY-08).

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 260429-cleanup-empty-files | Find and clean up empty files/folders (root cause: 532b563 codebase mapping commit). Removed 8 empty placeholders + ignition/, cleaned 19 stale agent worktrees, patched 9 doc references, added pre-commit guard against future 0-byte commits | 2026-04-29 | 8bfab90 | Verified | [260429-cleanup-empty-files](./quick/260429-cleanup-empty-files/) |
| 260518-jsr | Inspect entire codebase and write a brand-new, fully-updated README.md at the project root (engineer-first deep-dive, 502 lines, prose+bullets, WIP marked inline; grounded in 727-line research inventory) | 2026-05-18 | 847b369 | Verified | [260518-jsr-inspect-entire-codebase-and-write-a-bran](./quick/260518-jsr-inspect-entire-codebase-and-write-a-bran/) |
| Phase 18 P05 | ~45min | 3 tasks | 4 files |

## Phase 18 Plan Execution Log

| Plan | Duration | Tasks | Files | Commit |
|------|----------|-------|-------|--------|
| 18-00 (HONEY-12 row) | <5min | 1/1 | 1 | 85fcd2b |
| 18-02 (HoneypotChecker.sol + TS skeleton) | 17min | 3/3 | 9 | 4571393 |
| 18-04 (HONEY-11 safetyBank audit + isBlacklistedTokenForChain fix-in-flight) | ~30min | 3/3 | 10 | 53df941 |
| 18-01 (Wave-1 honeypot fixtures: Honeypot.sol 5-mode + 3 ETH JSON fixtures) | ~8min | 2/2 | 6 | d33f32f |
| 18-03 (HONEY-12 bytecodeScan + HONEY-02 Mythril severity gate) | ~5min | 2/2 | 5 | b503572, aa77a00, 7178b61 |
| 18-06 (HONEY-05 chainRegistry honeypotChecker required field + hardhat networks + deploy CLI) | ~12min | 3/3 | 5 | fdeeefa, c00de8e, 511aa96 |
| 18-05 (HONEY-02 Slither + Mythril audit + CI gate evergreen) | ~45min | 3/3 (Task 1 inline) | 4 | ee2e2a1, c43c3cd |
| 18-07 (HONEY-03 ETH mainnet HoneypotChecker deploy + Etherscan verify) | ~60min | 4/4 | 5 | 6dfcec8, ae639f1, 3463973, 052a477, cffd035 |
| 18-09 (HONEY-07/08/09/10 Option-D V2+V3 wrapper + fork tests + D-ROLLBACK deletions) | ~30min | 3/3 | 10 | e1cd8da, 7d8f957, 3958060, d64507a, 3714a1e, 1c77e85 |
| 18-10 (HONEY-07/08/12 bot.ts V2+V3 wiring + parallel-bank HONEY-12 + D-ALERTS + D-18-09-01 fix-along) | ~25min | 2/2 | 5 | 8083c96, 95e0e51, 8badd7b |

## Session Continuity

Last session: 2026-05-23T22:56:48.409Z
Last activity: 2026-05-15 — Phase 18 plan 18-05 complete. HONEY-02 Slither + Mythril audit run on contracts/honeypot/HoneypotChecker.sol covering BOTH checkV2 + checkV3 entry points. Slither 0.11.5 surfaced 13 medium+ findings (4 High + 9 Medium) — ALL dispositioned `false-positive` against the eth_call-only revert-always design: `arbitrary-send-eth` × 2 = caller-chosen router is by design; `reentrancy-balance` × 2 = the documented lying-balanceOf catch; `unused-return` × 6 = balance-delta reads override router-returned values; `uninitialized-local` × 2 = catch-always-reverts flow-sense limitation; `incorrect-equality` × 1 = correct semantic for `V3_SELL_WETH_ZERO`. Mythril 0.24.8 reported `success: true, issues: []`. **Stop-the-Line determination: NO escalation; deploy gate cleared for HONEY-03.** 0 `accepted-risk` rows → no operator sign-off required. Audit doc `.planning/milestones/v6.17-honeypot-checker-audit.md` (`ee2e2a1`) commits the disposition table + D-AUDIT-PATH per-host install notes. CI gate (`c43c3cd`) locks audit-bar evergreen via `dorny/paths-filter@v3` + 3 new jobs (`hardhat-compile` / `slither` / `mythril`) gated on `contracts/**`; Phase 17 evergreen `.todo` ban + `tsc --noEmit ×3` guards preserved verbatim. HONEY-02 row marked Complete in REQUIREMENTS.md.
Stopped at: Phase 19 UI-SPEC approved
Resume file: .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
