---
gsd_state_version: 1.0
milestone: v6.17
milestone_name: Defensive Hardening for Live Mainnet
status: executing
stopped_at: Phase 20 COMPLETE (all 8 plans shipped — going-live ops hardening done)
last_updated: "2026-05-24T23:13:00Z"
last_activity: 2026-05-24 -- Phase 20 plan 20-07 complete (docs/operations/going-live.md consolidated runbook + root-doc CI guard + vitest self-test); Phase 20 COMPLETE 8/8 plans
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 32
  completed_plans: 32
  percent: 60
---

# Project State

<!--
  total_plans: 0 — will be populated by /gsd-plan-phase as each of Phases 17-21 is decomposed.
  Roadmap intentionally leaves "Plans: TBD" per phase; per-phase plan counts are not pre-budgeted.
-->

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29 — v6.17 milestone scoped)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management
**Current focus:** Phase 20 — going-live-ops-hardening

## Current Position

Phase: 20 (going-live-ops-hardening) — EXECUTING
Plan: 7 of 8 (20-00 through 20-06 complete; 20-07 next)
Status: Ready to execute
Last activity: 2026-05-24 — Phase 20 plan 20-04 complete (bot.ts preflight wiring + 6 V2/V3 killswitch CPs + mid-run wallet setInterval with T-20-04 idempotence; 16 new integration tests across 4 files; 2 cascade fix-in-flight test mocks; 7 commits; full unit 535/535 + integration 185/185; tsc clean ×3)

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

- **Plan 19-08 (2026-05-24) — Phase 19 FINAL plan, COMPLETE:** Anti-rug operator-handoff documentation shipped. `docs/operations/anti-rug-rollout.md` (567 lines, 7 sections per D-OPERATOR-HANDOFF) documents env-var reference (9 envs per chain × 4 chains = 36 anti-rug env vars), bot restart procedure, dry-run + live-mode verification per D-LIVE-GATE (7-day floor + 0 confirmed FPs + per-chain `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` exact-lowercase match + bot restart), CB reset procedure (dashboard modal walkthrough with N acknowledge checkboxes + `Type RESET to confirm` input + POST /api/anti-rug/circuit-breaker/:chain/reset; curl backup with `Bearer DASHBOARD_API_KEY` header; last-resort `ENABLED_CHAINS` removal), 4 troubleshooting scenarios (🟡 Reconnecting >60s, 🔴 Disconnected >60s with Telegram per D-VIS-WS-HEALTH, [GAP DETECTED] banner per D-BACKFILL FAIL CLOSED, ⚪ Unmonitored badge for pre-Phase-19 + baseline-snapshot-failed cases), Wave-1 V3 follow-up tracker (TeamFinance V3: ETH resolved-as-V2-proxy per TrustSwap blog; BSC/Base/Arb operator-accepted-gap with pre-enable verification protocol; PinkLock V3: ETH resolved-as-non-existent per Etherscan ABI inspection 2026-05-23; BSC/Base/Arb operator-accepted-gap; V3 rug fixture skeleton backfill protocol). `docs/operations/anti-rug-tuning.md` (134 lines, 3 sections per D-TUNE-PROTOCOL) documents tunable parameter tables (5 categories × when-to-tune-up/down columns: detection thresholds, CB tuning, gas tuning, backfill caps, allowlist overlay), 4-tier review cadence (daily during 7-day window, end-of-7-day go/no-go, monthly post-live audit, post-CB-trip review), `.env` + git history + pino structured-log audit trail recipes. README.md updated: new "Anti-Rug Runtime Monitoring (Phase 19, v6.17+)" subsection in Key Features (before Phase 18 Honeypot Pipeline section) with SAFETY DEFAULT callout + 3 links to rollout doc + 1 link to tuning doc + 5-paragraph operational summary (detector, multi-signal trigger, executeFullSell bridge, dashboard surfaces, CB); Status Snapshot flipped "Not started" → "Shipped in v6.17 Phase 19"; In-Progress Work line flipped to "Shipped; operator-driven live-mode graduation pending per-chain 7-day window". ANTIRUG-10 closed (backend gate in Plan 19-05; operator-facing handoff lands here). Task 3 `checkpoint:human-verify` deferred per spawn-prompt "this plan does NOT contain a `checkpoint:human-action` task — the prior USER-BINDING decisions (V3 lockers, env vars) were already resolved in Plans 19-02 + 19-03. This plan documents the operator's process; the actual flip-to-live happens AFTER the 7-day dry-run, not during this plan execution. If the executor encounters a real human-action gate, it should surface it; otherwise proceed autonomously." guidance — no real human-action gate, all automated verification passing. Phase 19 COMPLETE (10 of 10 plans). Operator can now begin the 7-day dry-run window per D-LIVE-GATE; per-chain live-mode graduation requires `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` `.env` flip + bot restart after the 7-day floor + 0-FP review gate. Commits: `d3f7c71` (rollout doc) + `7dd77f4` (tuning doc + README).
- **Plan 19-04a (2026-05-24):** Anti-rug detector FOUNDATION skeleton landed at `src/anti-rug/detector.ts` (634 lines, 5 public + 2 test-hook + 1 type exports). Position registry shape: `Map<chain, Map<addr, RegisteredPosition[]>>` — array bucket per address handles the multi-position-same-pair case (Test 20) without dispatch loss. Single-listener-per-chain WS subscription with TOPIC FILTER UNION covering all four V2 + V3 topics (`PAIR_BURN_TOPIC`, `PAIR_TRANSFER_TOPIC`, `POOL_BURN_TOPIC`, `POOL_COLLECT_TOPIC`) per Pitfall #10. `startChainAntiRugListener` is idempotent via explicit drop+recreate (`wsProvider.off(activeFilter, activeDispatcher)` before `wsProvider.on(newFilter, newDispatcher)`) — ethers v6 has no filter-replace; multiple `.on()` calls would dispatch each event N times. `evaluateRugSignals` shim mechanism: module-scoped `let` defaulted to warn-only stub + `_setEvaluateRugSignalsForTesting` injection hook so the dispatch-routing tests can run before Plan 19-04b ships the real evaluator. Chunked `getLogsForBackfill` primitive with `chunkStart += cap` / `chunkEnd = min(chunkStart + cap - 1, toBlock)` math — 6 chunks for [100,150] cap=10 (deliberate off-by-one enforces "cap blocks per call" Alchemy semantics per RESEARCH CRITICAL #1; the plan's `<behavior>` narration "5 chunks" was a typo against the unambiguous `<action>` code which the test verifies directly). 11/11 tests passing in `test/unit/anti-rug/detectorRegistry.test.ts`; full unit suite 354/354 (+11 new); tsc clean ×3. Commits: `7f671e0` (test RED) + `7f75581` (feat GREEN). **Hand-off:** Plans 19-04b (multi-signal evaluator) + 19-04c (heartbeat / reconnect / backfill / HTTP polling fallback) consume this skeleton via the stable public API (`registerAntiRugPosition` / `unregisterAntiRugPosition` / `startChainAntiRugListener` / `getLogsForBackfill` / `getRegisteredPositions`). TODO Plan 19-04c markers at lines 441 (HTTP fallback) + 512 (heartbeat / reconnect / backfill / dashboard broadcast).
- **Plan 19-01 (2026-05-24):** ANTIRUG-04 + ANTIRUG-16 schema migration v4→v5 landed. Single-table-with-`pool_type`-discriminator shape chosen for `lp_baseline` (vs separate v2/v3 tables) per CONTEXT.md Claude's-discretion + Research Open Question #1 recommendation — matches existing v3 exit_state CHECK constraint pattern at `db.ts:64-110`. `v3_position_nft_id` stays NULLABLE in v6.17 per Research Open Question #3 (V3 baseline is pool-only; NFT-tracking deferred to v6.18+). 5 prepared statements (`upsertLpBaseline` named-bind / `getLpBaseline` / `deleteLpBaseline` / `upsertChainState` positional / `getChainState`) exported from `src/utils/db.ts`. New `chain_state` table tracks `last_seen_block` per chain for restart-time `getLogs` backfill per D-BACKFILL. 12/12 tests passing in `test/unit/db/lpBaselineMigration.test.ts` (10 behaviors + 2 production-module integration); full unit suite 288/288 with zero regressions; tsc clean across all 3 tsconfig projects. Existing tables (`trades`, `exit_state`, `bot_state`, `schema_version`) unchanged per ANTIRUG-04 additive-only acceptance. Commits: `6091100` (test RED) + `522ae08` (feat GREEN). Production `data/bot.db` migrated in-place from v4 to v5 on first module load. **Hand-off:** Plans 19-03 (`lpBaseline.ts`), 19-04a/b/c (`detector.ts`), 19-05 (cleanup hook on full close) now unblocked.
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
| Phase 19 P04a | 25 | 1 tasks | 2 files |
| Phase 19 P19-04c | 17min | 1 tasks | 2 files |
| Phase 19 P19-08 | 28 | 2 tasks | 3 files |
| Phase 20 P20-00 | ~10min | 2 tasks | 14 files |
| Phase 20 P04 | ~33min | 4 tasks | 6 files |

## Phase 19 Plan Execution Log

| Plan | Duration | Tasks | Files | Commit |
|------|----------|-------|-------|--------|
| 19-01 (ANTIRUG-04 schema v4 to v5 + 5 prepared statements) | ~20min | 2/2 | 2 | 6091100 (test RED), 522ae08 (feat GREEN) |

## Phase 20 Plan Execution Log

| Plan | Duration | Tasks | Files | Commit |
|------|----------|-------|-------|--------|
| 20-00 (Wave-0 vitest stubs: 14 files / 66 it.skip across OPS-LIVE-01..11 + schema v5→v6) | ~10min | 2/2 | 14 | 4327725 (8 unit stubs), 5a2a195 (6 integration stubs) |
| 20-01 (Schema v5→v6 migration + 5 prepared statements + REQUIREMENTS.md OPS-LIVE-02/06 reword) | ~25min | 2/2 | 4 | 131b54b (test RED), 103e953 (feat GREEN), 67db735 (docs REQUIREMENTS) |
| 20-02 (src/preflight.ts dual-shape API + chainRegistry/config/.env.example Phase 20 envs) | ~50min | 2/2 | 5 | 629e6ba (test RED — pre-existing), c2c7699 (Task 2 chainRegistry+config+env), 67f2066 (Task 1 GREEN preflight.ts + antiRug boundary fix) |

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

Last session: 2026-05-24T22:06:14.744Z
Last activity: 2026-05-24 — Phase 20 plan 20-02 complete. `src/preflight.ts` shipped (641 LOC, 11 exports) implementing the dual-shape API: `preflight(registry)` collect-all-then-FATAL boot entry + `preflightDryRun(registry)` returns-without-exit for Plan 20-05 CLI consumer. Six per-chain check functions (`checkRpcChainId`, `checkRpcBlockAge`, `checkWalletBalance` [exported per W4 fix for Plan 20-04 mid-run setInterval reuse], `checkMevHealth`, `checkHoneypotCheckerCode`, `checkAntiRugLiveGate`) + chain-agnostic `validateCrossEnvRules` (4 rules: MEV-flashbots-auth-key, bsc-bloxroute, telegram-5-tuple, per-chain-rpc-url) + `checkStaleData` one-shot stale-position scanner. D-PREFLIGHT-FLOW collect-all then exit; D-BALANCE-FLOOR formula `parseEther(snipeAmount) × MAX_OPEN_POSITIONS + parseEther(gasBuffer)`; D-ANTIRUG-LIVE-GATE-CODE `SEVEN_DAYS_SEC = 7 * 86400` floor; D-ALERTS structured pino + `sendTelegramAlert` with remediation pointer to `docs/operations/going-live.md`; D-ROLLBACK enforced statically (grep `SKIP_PREFLIGHT` returns 0 even in comments). Type-only `import type { ChainConfig }` + inlined generic `getEnabledChains<T extends { enabled: boolean }>` to avoid the runtime chainRegistry → provider → config → `dotenv.config()` cascade that would clobber test isolation (Rule 1 fix-in-flight discovered during first vitest run). Exported `PreflightChain = ChainConfig & { httpProvider; wallet }` + `PreflightRegistry = Map<string, PreflightChain>` so Plan 20-04 wiring can adapt ChainContext list → PreflightRegistry without circular dependency. Empty `describe('checkAntiRugLiveGate boundary', ...)` block from 629e6ba (vitest treats empty suites as failures) populated with the exact-7-day-boundary test (Rule 1 fix-in-flight). chainRegistry.ts extended: `ChainConfig.gasBuffer` + `.blockAgeToleranceSec`; `ChainTemplate.defaultGasBuffer` + `.defaultBlockAgeToleranceSec`; 4 per-chain template defaults (ETH 0.005/300, BSC 0.003/60, Base 0.0005/30, Arb 0.0005/30 per D-GAS-BUFFER + RESEARCH OQ4); env-overlay reads in `buildChainRegistry()` with fail-loud NaN/`<=0` FATAL on block-age tolerance. config.ts +12 REQUIRED_ENV_VARS entries under Phase 20 header (4 GAS_BUFFER + 4 BLOCK_AGE_TOLERANCE_SEC + MID_RUN_CHECK_INTERVAL_SEC + STALE_WARN_SEC + STALE_ERROR_SEC + DASHBOARD_URL). .env.example +30 LOC Phase 20 section with all 12 envs + inline-comment descriptions per D-ENV-EXAMPLE [USER-BINDING]. **Test results:** 32/32 preflight tests pass (6+4+4+3+6+4+5); full unit suite 531 pass / 0 fail (up from 499, +32 from this plan); full integration 169 pass / 29 skip (skips are Phase 20 Wave 0 stubs from Plans 20-04..07; no regressions); tsc clean ×3 (root + bot + dashboard). Commits: `c2c7699` (Task 2 chainRegistry+config+.env.example) + `67f2066` (Task 1 GREEN preflight.ts + antiRug boundary fix-in-flight). **Hand-off:** Plan 20-03 (anti-rug detector timestamp wiring) inserts `setAntirugDryRunStarted.run(chain.name, ts, ts)` at `startChainAntiRugListener` first-time-start path so `checkAntiRugLiveGate` has timestamps to read; Plan 20-04 (bot.ts preflight call + mid-run setInterval + 3 V2 + 3 V3 killswitch checkpoints) imports `preflight`, `checkWalletBalance`, and `PreflightChain` from `./preflight`, builds PreflightRegistry by spreading ChainContext into the shape preflight expects, calls preflight at line 880, removes the inline chainId check at lines 887-895, and adds the mid-run wallet setInterval after line 926; Plan 20-05 (operator CLI) imports `preflightDryRun` from `../src/preflight` and uses the no-exit shape so the CLI can format human/--json output + decide its own exit code.
Last activity (priorline preserved): 2026-05-24 — Phase 20 plan 20-01 complete. Schema migration v5→v6 in `src/utils/db.ts` shipped via single atomic `db.transaction()` block: creates `pause_state` (id INTEGER PK CHECK(id=1) + paused INTEGER DEFAULT 0 + paused_at/paused_by/reason nullable per D-PAUSE-STORAGE single-row pattern); INSERT OR IGNORE seeds the id=1 row preventing double-insert on re-run; ALTER guard via `PRAGMA table_info('chain_state')` + `columns.some(c => c.name === 'antirug_dry_run_started')` clones v3→v4 pattern as defense-in-depth before `ADD COLUMN antirug_dry_run_started INTEGER`. 5 new prepared statements exported (`getPauseState` / `setPauseState` / `clearPauseState` / `setAntirugDryRunStarted` COALESCE-on-conflict idempotent UPSERT so first-call-per-chain wins per D-ANTIRUG-LIVE-GATE-CODE / `getAntirugDryRunStarted`). Production `data/bot.db` migrated in-place to user_version=6 on first module load post-merge (verified via `node -e "...pragma('user_version')..."` → `[{user_version: 6}]`). 12/12 tests pass in `test/unit/db/pauseStateMigration.test.ts` (10 in-memory schema/statement behaviors + 2 production integration). REQUIREMENTS.md OPS-LIVE-02 reworded per D-BALANCE-FLOOR (operational floor `snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER` replaces `maxCapital` deployment ceiling — bot funded at 0.0124 ETH < 1.0 ETH `maxCapital` would have FATAL-exited despite being capable of running one snipe); OPS-LIVE-06 reworded per D-STALE-THRESHOLDS (2-min warn / 10-min error envs `STALE_WARN_SEC` / `STALE_ERROR_SEC` replace 10s/20s "2× poll interval" wording that would have flooded operator with normal-poll-cycle noise). A1 verified: `db.transaction()` accepts DDL on better-sqlite3 v12.8.0; ALTER guard stays as defense-in-depth per T-20-W1-04. **One Rule 1 fix-in-flight:** `test/unit/db/lpBaselineMigration.test.ts:207` `expect(version).toBe(5)` → `.toBeGreaterThanOrEqual(5)` — Phase 19 test was implicitly coupled to v5 being permanent; greater-than-or-equal preserves "v5 schema is the floor" intent without breaking on every future schema bump. Full unit suite 499 passed + 31 skipped (+12 new from pauseStateMigration; -6 flipped from skip→it); tsc clean ×3 (tsconfig.json + tsconfig.bot.json + dashboard/tsconfig.json). Commits: `131b54b` (test RED) + `103e953` (feat GREEN) + `67db735` (docs REQUIREMENTS reword). Hand-off: Plans 20-02 (preflight) / 20-03 (anti-rug timestamp wiring) / 20-04 (bot.ts kill-switch) / 20-05 (controls.ts pause/resume endpoints) consume the 5 new prepared statements via `import { ... } from './utils/db'`; OPS-LIVE-02 + OPS-LIVE-06 refined text is the verbatim acceptance criterion for Plans 20-02 walletBalance + 20-06 staleData.
Stopped at: Phase 20 plan 20-04 complete
Resume file: .planning/phases/20-going-live-ops-hardening/20-05-PLAN.md
