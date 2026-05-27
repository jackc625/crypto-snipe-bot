# Roadmap: Crypto Snipe Bot

## Overview

Production-ready multi-chain MEV sniper bot with Uniswap V2/V3 support,
intelligent exit strategies, portfolio risk management, SQLite audit trail,
and real-time web dashboard across ETH, BSC, Base, and Arbitrum.

## Milestones

- âœ… **v6.16 Production-Ready Multi-Chain MEV Sniper** â€” Phases 1-16 (shipped 2026-04-14) â€” [archive](milestones/v6.16-ROADMAP.md)
- ðŸš§ **v6.17 Defensive Hardening for Live Mainnet** â€” Phases 17-21 (planning)

## Phases

<details>
<summary>âœ… v6.16 Production-Ready Multi-Chain MEV Sniper (Phases 1-16) â€” SHIPPED 2026-04-14</summary>

- [x] Phase 1: Bug Fixes & Hardening (4/4 plans)
- [x] Phase 2: ethers v6 Migration (2/2 plans)
- [x] Phase 3: SQLite Storage & Code Quality (4/4 plans)
- [x] Phase 4: Multi-Chain Architecture (5/5 plans)
- [x] Phase 5: Uniswap V3 Integration (4/4 plans)
- [x] Phase 6: Risk Management (2/2 plans)
- [x] Phase 7: Smart Exit Strategies (4/4 plans) â€” completed 2026-03-26
- [x] Phase 8: Monitoring & Web Dashboard (6/6 plans)
- [x] Phase 9: Testing Infrastructure (5/5 plans) â€” completed 2026-03-28
- [x] Phase 10: partial_sell Revenue Fix (2/2 plans) â€” completed 2026-03-30
- [x] Phase 11: Dashboard Accuracy & Bot Wiring (7/7 plans) â€” completed 2026-04-05
- [x] Phase 12: Integration Gap Fixes (3/3 plans) â€” completed 2026-04-06
- [x] Phase 13: Config Env-Var Correctness (1/1 plan) â€” completed 2026-04-06
- [x] Phase 14: Sell Revenue Receipt Decoding (2/2 plans) â€” completed 2026-04-07
- [x] Phase 15: Chain-Scoped Dedup & Dashboard Env (2/2 plans) â€” completed 2026-04-13
- [x] Phase 16: Dashboard Type Alignment & Dead Code Cleanup (2/2 plans) â€” completed 2026-04-13

Full archive: [milestones/v6.16-ROADMAP.md](milestones/v6.16-ROADMAP.md)

</details>

### ðŸš§ v6.17 Defensive Hardening for Live Mainnet (Phases 17-21) â€” PLANNING

- [x] **Phase 17: Tech Debt Cleanup & Audit Baseline** â€” CI-verified baseline of `.todo`/TS-error counts, fills/skips remaining stubs, retroactive Nyquist on 9 phases, diagnostic-log cleanup *(completed 2026-04-30)*
- [ ] **Phase 18: Honeypot Detection Rebuild** â€” Deploy `HoneypotChecker.sol` (Option D) on 4 chains; replace broken V2/V3 sell-sim gates; discriminated-union `HoneypotResult`; multi-amount tax probe; safety-bank audit
- [x] **Phase 19: Anti-Rug Runtime Monitoring** â€” Single-listener-per-chain LP-removal detector; multi-signal trigger with allowlist + confirm-after-N-blocks; bridge to `executeFullSell` with elevated gas; 7-day dry-run mode
 (completed 2026-05-24)
- [x] **Phase 20: Going-Live Ops Hardening** â€” Fail-closed preflight (wallet/RPC/MEV/checker code-at-address); cross-variable env validation; multi-stage kill-switch with SQLite-persisted pause; `npm run preflight/pause/resume`; runbook formalization
 (completed 2026-05-24)
- [ ] **Phase 21: Exit-Engine Live-Runtime Hardening** â€” Real-mainnet verification artifacts (Etherscan tx hashes, dashboard screenshots, log excerpts) for all 6 deferred v6.16 items; chainId guard + `ALLOW_REAL_MAINNET=1` test infrastructure; `op`-field log enrichment
- [ ] **Phase 21.1: V3-Buy Tax-Gate + Flashbots Inclusion Fix (INSERTED)** — STOP-THE-LINE-01 (every V3 buy aborts: `bot.ts:610` passes the V3 SwapRouter to the V2-only `hasHighTransferTaxForChain`) + STOP-THE-LINE-02 (CRITICAL — Flashbots `bundle.wait()` false-negative reported a landed LADYS buy as failed → untracked/unmonitored position) + STOP-THE-LINE-03 (the mirror V2 `hasHighTransferTaxForChain` call at `bot.ts:303` fires a REAL `amountOutMin=0` buy with broken NaN tax math on every V2 snipe — promoted into scope 2026-05-26); all block the 21-07 live capture

## Phase Details

### Phase 17: Tech Debt Cleanup & Audit Baseline
**Goal**: Operator can trust the v6.17 audit baseline â€” every claim of done in v6.16 close is verified by CI artifact (not a doc number), every retroactively-validated phase has one production-relevant assertion, and remaining stubs/errors are addressed via real fixes (not suppression)
**Depends on**: Nothing (Phase 17 is the foundation; CI-discovery pass settles disputed `.todo`/TS status before substantive work)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06
**Success Criteria** (what must be TRUE):
  1. `find test/ -name '*.todo*' -print` and `npx tsc --noEmit` artifacts are committed in `.planning/milestones/v6.17-debt-baseline.md` so the operator (and future audits) can see the actual counts of `.todo` stubs and TS annotation errors as ground truth â€” not the disputed 37/6 numbers from the v6.16 close audit
  2. After Phase 17 completes, `npx tsc --noEmit` exits clean across all tsconfig projects with zero `as any` suppressions added in this phase, and `find test/ -name '*.todo*'` either returns empty or each remaining hit has been converted to `.skip` with an explicit reason
  3. Each of the 9 retroactively-validated phases (01, 02, 03, 05, 06, 07, 08, 09, 10) produces one production-relevant assertion documented in its `VALIDATION.md` â€” answering "does this prevent the harm we said it would?" â€” explicitly excluding FIX-04 and V3-03 which are addressed via fresh implementation in Phase 18 and validated there
  4. The diagnostic `console.log` lines at `src/telegramListener.ts:55,61` and the `getTradesByToken` unused const at `src/utils/db.ts:215` no longer appear in the codebase as called out; logs preserved as `log.debug` where appropriate, deleted where not
**Plans**: 3 plans

  **Wave 0** *(no dependencies; produces ground-truth baseline doc)*
  - [x] 17-01-baseline-and-close-evidence-PLAN.md â€” Wave-0 CI-output baseline doc + DEBT-03/04 conditional close-out (Branch A verified-empty / Branch B remaining work) [DEBT-01, DEBT-02, DEBT-03 cond, DEBT-04 cond]

  **Wave 1** *(blocked on Wave 0; both plans run in parallel after 17-01 commits)*
  - [x] 17-02-retroactive-nyquist-PLAN.md â€” Hybrid 7+2 retroactive Nyquist: 7 new harm-prevention tests across phases 01/03/05/06/07/08/10 + 2 inline VALIDATION.md augmentations (phases 02/09); D-07 stop-the-line applies [DEBT-05]
  - [x] 17-03-cleanup-and-ci-invariants-PLAN.md â€” Verify-then-act sweep: delete getTradesByToken from src/utils/db.ts; append .todo ban + tsc x 3 tsconfigs as evergreen CI guards [DEBT-06 + DEBT-01..04 invariant lock]

  **Cross-cutting constraints** *(invariants spanning multiple plans):*
  - **D-07 stop-the-line:** any retroactive harm-prevention test (Plan 17-02) revealing a real production bug BLOCKS Phase 17 close â€” surface to user, treat as DEBT-07 / decimal phase 17.1; NOT fix-in-flight, NOT file-and-defer
  - **D-11 verify-then-act:** Plans 17-01 and 17-03 both gate any modification on a fresh-checkout verification step before acting (pre-scout findings are informational, not authoritative)
  - **D-04 observable-effect rigor:** every new test in 17-02 must assert at least one concrete observable effect (DB row, mock-call args, structured pino log, transaction submit/block) â€” no `expect(true).toBe(true)` style hollow fills

### Phase 18: Honeypot Detection Rebuild
**Goal**: The bot can again snipe new tokens â€” V2 and V3 â€” on live mainnet without the broken sell-sim hard-blocking every attempt; honeypots that the v6.16 vacuous-pass let through are now caught locally (not just by third-party APIs); and the architecture (discriminated-union `HoneypotResult`, fail-closed `unknown` verdict) makes a vacuous-pass regression unrepresentable in the type system
**Depends on**: Phase 17 (clean audit baseline; FIX-04/V3-03 validated at fresh implementation here, not retroactively)
**Requirements**: HONEY-01, HONEY-02, HONEY-03, HONEY-04, HONEY-05, HONEY-06, HONEY-07, HONEY-08, HONEY-09, HONEY-10, HONEY-11, HONEY-12
**Success Criteria** (what must be TRUE):
  1. The bot snipes a real V2 token on Ethereum mainnet â€” the new `simulateHoneypotRoundtrip(...)` call at `bot.ts:220-226` returns `verdict: 'safe'` with `evidence.buyTaxBps` and `evidence.sellTaxBps` populated as numerical bps, the buy lands, and an Etherscan tx hash is captured. The "balance=0 hard-block" footgun no longer fires on legitimate launches
  2. A known honeypot token (committed as test fixture) gets `verdict: 'unsafe'` from the new dispatch â€” both for V2 (replacing the broken sell-sim) and V3 (replacing the silent vacuous-pass) â€” and the bot skips the buy with a structured pino log line containing the revert reason and a Telegram alert pointing at the token address
  3. `HoneypotChecker.sol` is deployed and Etherscan/BscScan-verified at the addresses recorded in `chainRegistry.ts` `CHAIN_TEMPLATES['eth'|'bsc'|'base'|'arb'].honeypotChecker.deployedAddress` for all 4 enabled chains, with the Slither + Mythril audit report committed in `.planning/milestones/v6.17-honeypot-checker-audit.md` (any flagged issues triaged with documented disposition)
  4. The multi-amount tax probe (1% / 50% / 100% of `snipeAmount`) catches an amount-varying-tax fixture token in the test suite â€” a token that returns 0% tax on small probes and >25% tax on production-sized swaps no longer passes the gate
  5. The `safetyBank` audit (HONEY-11) findings are committed in `.planning/milestones/v6.17-safety-bank-audit.md` â€” every gate in `tokenSafety.ts` (buy-sim, tax check, max-wallet, blacklist, liquidity-sufficiency, metadata, transfer-tax, blocklist) has a documented "exercised the underlying behavior" assertion or has been fixed to add one; no other `amountIn=0` family bugs remain undocumented
**Plans**: 11 plans (iter-2 plan-checker revision: +18-00 wave-0 + 18-10 wiring split)

  **Wave 0** *(pre-wave; closes Blocker #2 chicken-and-egg):*
  - [x] 18-00-PLAN.md â€” REQUIREMENTS.md HONEY-12 row [HONEY-12]

  **Wave 1** *(after 18-00; parallel):*
  - [x] 18-01-PLAN.md â€” contrived Honeypot.sol 5-mode fixture (4 standard + amount-tiered per Warning #6) + 3 real-mainnet honeypot fixtures (2 V2 + 1 V3 per Blocker #1) [HONEY-12]
  - [x] 18-02-PLAN.md â€” HoneypotChecker.sol with checkV2 + checkV3 (~160-190 LOC per Blocker #1) + Ignition module + types.ts + abi.ts + dispatch index.ts + simulator.ts stub + checkerContract.ts placeholder with Warning #9 sentinel [HONEY-01, HONEY-05, HONEY-06]
  - [x] 18-03-PLAN.md â€” bytecodeScan.ts HONEY-12 + scripts/check-mythril-report.ts severity gate [HONEY-12, HONEY-02 tooling]
  - [x] 18-04-PLAN.md â€” HONEY-11 safetyBank audit: 8 per-gate regression tests + isBlacklistedTokenForChain fail-closed retrofit + audit milestone doc [HONEY-11]

  **Wave 2** *(after Wave 1):*
  - [x] 18-05-PLAN.md â€” Slither + Mythril audit covering BOTH checkV2 + checkV3 (Blocker #1) + audit milestone doc + CI gates on contracts/** [HONEY-02] (autonomous: false)
  - [x] 18-06-PLAN.md â€” chainRegistry.ts honeypotChecker field + tax thresholds + hardhat.config.ts deploy networks + scripts/deploy-honeypot-checker.ts CLI [HONEY-05]

  **Wave 3** *(after audit clean + chainRegistry wired):*
  - [x] 18-07-PLAN.md â€” ETH mainnet deploy + Etherscan verify (V2 + V3) + integration test + COMMIT ETH LITERAL INTO src/chainRegistry.ts (Blocker #3) + auto-grep audit precheck (Blocker #4) + 2-3 day observation window [HONEY-03] (autonomous: false)

  **Wave 5** *(parallel after observation window closes):*
  - [ ] 18-08-PLAN.md â€” BSC + Base + Arbitrum batch deploy + verify + 3 integration tests + 3 chainRegistry.ts per-chain literal commits (Blocker #3) [HONEY-04] (autonomous: false)
  - [x] 18-09-PLAN.md â€” checkerContract.ts V2 + V3 wrappers (Blocker #1) + multi-amount probe + tax thresholds + DELETE broken sell-sims (D-ROLLBACK) + fork/integration/unit tests + Warning #9 sentinel removal [HONEY-07, HONEY-08, HONEY-09, HONEY-10]

  **Wave 6** *(after 18-09 wrapper layer; Warning #8 density split):*
  - [x] 18-10-PLAN.md â€” bot.ts V2 + V3 in-place gate replacement (V3 feeTier passthrough per Blocker #1) + parallel-bank HONEY-12 on both paths + D-ALERTS tiered alert format + V2/V3 integration tests asserting active V3 unsafe + V3 safe paths [HONEY-07, HONEY-08, HONEY-12]

  **Cross-cutting constraints:**
  - **D-STOP-THE-LINE:** any audit finding revealing a bug worse than V2/V3 sell-sims BLOCKS Phase 18 close; escalates to HONEY-13+ / decimal phase 18.1
  - **D-AUDIT-TIMING:** wave 5/6 closes only after (a) 18-07 ETH deploy live + (b) 18-04 + 18-05 audit-discovered fixes merged; depends_on in 18-09 STRUCTURALLY enforces dep on [18-04, 18-05, 18-07] per iter-2 Blocker #4
  - **D-ROLLBACK:** plan 18-09 DELETES broken simulateSellForChain + simulateSellV3ForChain entirely; no legacy fallback flag retained

### Phase 19: Anti-Rug Runtime Monitoring
**Goal**: When liquidity is removed from a pool the bot has an open position in, the bot fires a frontrun-exit through the existing `executeFullSell` path with elevated gas â€” within 1-2 confirmation blocks of the LP-removal event, with multi-signal logic (>50% LP removed AND destination not in allowlist AND reserves below sell-threshold) that does not cascade into panic-sells on legitimate V2â†’V3 migrations, lock-contract transfers, or normal multisig rebalances
**Depends on**: Phase 18 (HONEY establishes the `ChainConfig` extension pattern that ANTIRUG reuses for its own per-chain config; ANTIRUG bridges to `executeFullSell` whose reason union is extended here)
**Requirements**: ANTIRUG-01, ANTIRUG-02, ANTIRUG-03, ANTIRUG-04, ANTIRUG-05, ANTIRUG-06, ANTIRUG-07, ANTIRUG-08, ANTIRUG-09, ANTIRUG-10, ANTIRUG-11, ANTIRUG-12, ANTIRUG-13, ANTIRUG-14, ANTIRUG-15, ANTIRUG-16
**Success Criteria** (what must be TRUE):
  1. On a contrived-fork rug-pull scenario (real captured rug-pull replayed against a fork), the bot exits the rugged position via `executeFullSell` with `reason: 'anti-rug'` and a 2.0Ã— gas multiplier within N blocks of the LP-removal event firing â€” the sell lock, receipt decoding, DB cleanup, and Telegram alert all execute through the existing v6.16 sell pipeline (no parallel exit path)
  2. A V2â†’V3 migration test (LP burn coinciding with V3 pool creation for the same token pair) does NOT trigger the exit because the destination is in the allowlist and/or reserves do not drop below sell-threshold â€” the multi-signal logic (>50% removed AND not-allowlisted AND reserves drop) prevents the cascading-panic-sell pattern. Lock-contract transfers (Unicrypt, TeamFinance, PinkLock canonical addresses per chain) likewise do NOT trigger exits
  3. Default deploy is dry-run mode (`ANTIRUG_LIVE_EXECUTE=false`) â€” the bot logs structured "would-have-sold" pino events on detection without executing, so the operator can compare against actual outcomes for 7 days before flipping the env-flag to live execution. Live-execution requires the explicit env flag
  4. WebSocket disconnect-and-reconnect on the LP-removal listener restores monitoring without losing events â€” heartbeat ping/pong on `WebSocketProvider` detects silent failures, automatic reconnect re-subscribes the active filters, and `getLogs` over `(lastSeenBlock, currentBlock)` backfills the disconnect window. A simulated WS-kill in the test suite proves the bot does not silently miss events
  5. The per-chain circuit breaker disables anti-rug for that chain after N triggers in a configurable window (default 3 in 1h) â€” operator can manually reset via the dashboard, and the dashboard surfaces "anti-rug halted on chain X" prominently. A misbehaving event-stream cannot trigger N panic-sells in a row
**Plans**: 10 plans (revision iteration 1: 19-04 split into 19-04a/b/c per Warning 6; 19-02 + 19-05 + 19-06 + 19-08 also revised per Blockers 1-4 + Warnings 5-11 + Infos 12-13)

  **Wave 1** *(foundation; parallel-safe - no inter-plan file overlap):*
  - [x] 19-01-PLAN.md - Schema migration v4 to v5 (lp_baseline + chain_state) + db.ts prepared statements [ANTIRUG-04] *(completed 2026-05-24)*
  - [x] 19-02-PLAN.md - ChainConfig.antiRug field + per-chain envs + .env.example + REQUIRED_ENV_VARS + hardcoded V2+V3 allowlists; + operator checkpoint for TeamFinance V3 + PinkLock V3 (Blocker 4) [ANTIRUG-06, ANTIRUG-07, ANTIRUG-09, ANTIRUG-10, ANTIRUG-11]

  **Wave 2** *(after Wave 1; foundation modules + detector registry skeleton):*
  - [x] 19-03-PLAN.md - anti-rug/types.ts + events.ts + allowlist.ts (verify+lookup+merge) + lpBaseline.ts (snapshot+load+clear) [ANTIRUG-04, ANTIRUG-06, ANTIRUG-15, ANTIRUG-16]
  - [x] 19-04a-PLAN.md - anti-rug/detector.ts skeleton: position registry + WS subscription pattern + topic filter union + getLogsForBackfill primitive (Warning 6 split) [ANTIRUG-01, 02, 03, 13]

  **Wave 3** *(after Wave 2; multi-signal evaluator):*
  - [x] 19-04b-PLAN.md - anti-rug/detector.ts: multi-signal AND chain evaluator (V2 + V3 + V3 Burn-without-Collect grace window per Blocker 2 resolution (a)) + confirm-after-N-blocks gate (Warning 6 split) [ANTIRUG-05, 07, 14] *(completed 2026-05-24)*

  **Wave 4** *(after Wave 3; lifecycle layer — sequential after evaluator due to same-file modifications):*
  - [x] 19-04c-PLAN.md - anti-rug/detector.ts: heartbeat + reconnect + backfill + HTTP polling fallback + tiered D-VIS-WS-HEALTH alerts (Warning 6 split + Warning 9 added tests) [ANTIRUG-11, 12]

  **Wave 5** *(after Wave 4; exit pipeline + bot.ts wiring):*
  - [x] 19-05-PLAN.md - exitEngine reason union + elevated-gas + cleanup hook (Task 1a per Warning 7); exitTrigger bridge + raceTelemetry (Task 1b); bot.ts V2+V3 buy-success attach + resumeAntiRugMonitoring (Task 2); + Warning 11 ring buffer size note [ANTIRUG-08, ANTIRUG-09, ANTIRUG-10]

  **Wave 6** *(after Wave 5; parallel - dashboard + tests):*
  - [x] 19-06-PLAN.md - API routes (/circuit-breaker/:chain/reset, /events/:chain) + 5 display-only dashboard components (Task 2a per Warning 8) + 3 interactive components + PositionTable column + Overview mounting (Task 2b); + useWebSocket switch (Task 1); + Info 12 plumbing note [ANTIRUG-09, ANTIRUG-10]
  - [x] 19-07-PLAN.md - RugPull.sol fixture + HORSE V2 fixture + V3 candidate skeleton + fork test (5 RugPull modes + HORSE replay) + end-to-end multi-signal integration test; + Blocker 2 grace-window deterministic test propagation + Info 13 HORSE address resolution directive [ANTIRUG-01, 02, 03, 05, 08, 13, 14]

  **Wave 7** *(after Wave 6; operator-facing docs):*
  - [x] 19-08-PLAN.md - docs/operations/anti-rug-rollout.md (D-OPERATOR-HANDOFF [USER-BINDING]) + anti-rug-tuning.md (D-TUNE-PROTOCOL) + README.md anti-rug section; + Warning 10 revision_path on operator checkpoint + Warning 5 env-count 7-to-9 callout + Blocker 4 V3 allowlist follow-through [ANTIRUG-10]

**Cross-cutting constraints:**
  - **D-V3-COVERAGE:** Phase 19 ships full V3-aware monitoring per CONTEXT.md (NOT log-only; NOT deferred). Researcher proposed ANTIRUG-13..16 as V3-specific requirement rows.
  - **D-LIVE-GATE:** Default deploy is dry-run; per-chain live-flip requires 7-day floor AND 0 confirmed false-positives per CONTEXT.md.
  - **D-OPERATOR-HANDOFF [USER-BINDING]:** Phase 19 cannot ship without docs/operations/anti-rug-rollout.md per CONTEXT.md non-negotiable.
  - **D-ENV-EXAMPLE [USER-BINDING]:** Every new env var lands in .env.example with default + 1-line description per CONTEXT.md non-negotiable.
  - **D-STOP-THE-LINE:** Any fork test revealing a production bug BLOCKS Phase 19 close (escalates to ANTIRUG-13+ or decimal phase 19.1).

### Phase 20: Going-Live Ops Hardening
**Goal**: The bot refuses to start in any internally-inconsistent or unsafe state â€” undercut wallet, mismatched chainId, missing checker code-at-address, `MEV_STRATEGY=flashbots` without `FLASHBOTS_AUTH_KEY`, etc. â€” with operator-facing error messages that point to the runbook; the operator can run `npm run preflight` to verify readiness without starting the bot, and `npm run pause`/`npm run resume` to operate the kill-switch from the CLI; the runbook is in versioned docs and the multi-stage kill-switch cannot result in a position opening 30s after pause
**Depends on**: Phase 18 (preflight verifies `chainRegistry[chain].honeypotChecker.deployedAddress` via `getCode` â€” needs the field to exist with a real deployed address)
**Requirements**: OPS-LIVE-01, OPS-LIVE-02, OPS-LIVE-03, OPS-LIVE-04, OPS-LIVE-05, OPS-LIVE-06, OPS-LIVE-07, OPS-LIVE-08, OPS-LIVE-09, OPS-LIVE-10, OPS-LIVE-11, OPS-LIVE-12, OPS-LIVE-13
**Success Criteria** (what must be TRUE):
  1. `MEV_STRATEGY=flashbots` set with `FLASHBOTS_AUTH_KEY` unset causes the bot to exit non-zero at startup with a structured pino fatal log line that names the offending pair AND points to `docs/operations/going-live.md` â€” the cross-variable env validator catches this combo, refuses to start, and never reaches chain-context creation. The same is true for `ENABLED_CHAINS` including `bsc` without `BLOXROUTE_AUTH_HEADER`, and for the `TELEGRAM_API_ID` 5-tuple
  2. Wallet balance below per-chain `maxCapital` causes a FATAL non-zero exit at startup (never warn-and-continue) â€” and an undercut detected by the periodic re-check (default every 5 minutes) during operation halts new buys with a Telegram alert. `getCode` against `chainRegistry[chain].honeypotChecker.deployedAddress` returning `0x` likewise FATAL-exits with a "run `npx ts-node scripts/deploy-honeypot-checker.ts <chain>`" message
  3. Operator runs `npm run preflight` from a fresh terminal â€” script executes all OPS-LIVE-02..05 checks, prints structured per-chain pass/fail output, and exits non-zero on any FATAL â€” without starting the bot. Operator runs `npm run pause` and dashboard reflects pause state; operator runs `npm run resume` and dashboard reflects resume â€” both wrap the existing dashboard endpoints with `DASHBOARD_API_KEY` from `.env`
  4. Operator presses pause via dashboard while a snipe is mid-flight in `handleNewPairForChain` â€” the multi-stage kill-switch re-check at post-safety-bank, post-bundle-build, and post-MEV-submit aborts the in-flight execution. Pause state survives a full bot restart (loaded from SQLite at boot), so an operator-pressed pause cannot result in a position opening after the bot reboots
  5. `GOING-LIVE.md` no longer exists at the repo root â€” moved to `docs/operations/going-live.md` (atomic with the root-file delete in the same PR), README links to the new path, and a CI guard fails the build if `GOING-LIVE.md` reappears at the repo root. `HONEYPOT-SIM-BRIEFING.md` is either moved to `docs/decisions/honeypot-sim-rebuild.md` (preserved as decision record) or deleted â€” disposition documented during HONEY plan-phase and resolved in this phase
**Plans**: 8 plans (Wave 0 Nyquist baseline + 7 implementation waves)

  **Wave 0** *(no dependencies; produces Nyquist test stub baseline before any implementation):*
  - [x] 20-00-PLAN.md — 14 vitest test stubs across test/unit/preflight/, test/unit/db/, and test/integration/ for all OPS-LIVE-NN requirements; every it.skip names the concrete observable per D-04 [OPS-LIVE-01..11] (completed 2026-05-24)

  **Wave 1** *(after Wave 0; parallel-safe foundation):*
  - [x] 20-01-PLAN.md — Schema migration v5→v6 (pause_state table + antirug_dry_run_started column on chain_state) + 5 new prepared statements + REQUIREMENTS.md row reword for OPS-LIVE-02 (D-BALANCE-FLOOR) + OPS-LIVE-06 (D-STALE-THRESHOLDS) [OPS-LIVE-02, OPS-LIVE-06, OPS-LIVE-09] *(completed 2026-05-24)*

  **Wave 2** *(after Wave 1; preflight module + chainRegistry extension):*
  - [x] 20-02-PLAN.md — src/preflight.ts (preflight + preflightDryRun dual-shape API, 7 check functions, cross-env validator, anti-rug 7-day live-gate, stale-data) + chainRegistry.ts defaultGasBuffer + defaultBlockAgeToleranceSec per chain + config.ts REQUIRED_ENV_VARS (12 new envs) + .env.example per D-ENV-EXAMPLE [OPS-LIVE-02, OPS-LIVE-03, OPS-LIVE-04, OPS-LIVE-05, OPS-LIVE-06, OPS-LIVE-07] *(completed 2026-05-24)*

  **Wave 3** *(after Wave 2; bot.ts wiring + anti-rug timestamp):*
  - [x] 20-03-PLAN.md — src/anti-rug/detector.ts: insert setAntirugDryRunStarted.run() at startChainAntiRugListener first-time-start path (D-ANTIRUG-LIVE-GATE-CODE source for Plan 20-02 7-day floor check) [OPS-LIVE-07]
  - [x] 20-04-PLAN.md — src/bot.ts: preflight() call at line 880 + chainId-block removal + 3 V2 killswitch checkpoints + 3 V3 killswitch checkpoints + mid-run wallet setInterval (D-MID-RUN-CHECK + D-KILLSWITCH-CP1/CP2/CP3 + D-PREFLIGHT-FLOW + D-ROLLBACK) [OPS-LIVE-01, OPS-LIVE-02, OPS-LIVE-08]

  **Wave 4** *(after Wave 3; dashboard endpoints + CLI scripts + banner):*
  - [x] 20-05-PLAN.md — src/api/routes/controls.ts (POST /pause + POST /resume + GET /pause with sanitized reason + WS broadcast) + scripts/preflight.ts + scripts/pause.ts + scripts/resume.ts + package.json wiring [OPS-LIVE-09, OPS-LIVE-10, OPS-LIVE-11]
  - [x] 20-06-PLAN.md — dashboard/src/components/PauseBanner.tsx full-bleed red banner (bg-loss text-white per CB banner analog) + WebSocketContext + useWebSocket extension for pause_state_change WS event + initial state hydration via GET /api/controls/pause + Resume button (D-PAUSE-UI) [OPS-LIVE-09]

  **Wave 5** *(after Wave 4; runbook + CI guard + docs):*
  - [x] 20-07-PLAN.md — git mv GOING-LIVE.md → docs/operations/going-live.md + git rm HONEYPOT-SIM-BRIEFING.md + README.md link update + .github/workflows/test.yml CI guard step + docs/operations/going-live.md content authoring (5 sections per D-OPERATOR-HANDOFF) [OPS-LIVE-12, OPS-LIVE-13]

  **Wave 6 — Gap closure (live UAT 20-HUMAN-UAT.md)** *(major-first; 08/09/10 parallel, no file overlap):*
  - [x] 20-08-PLAN.md — [major] CORS same-origin fix (src/api/server.ts compares Origin host:port to request Host) + [major/security] DASHBOARD_API_KEY placeholder/empty/short FATAL in preflight validateCrossEnvRules [OPS-LIVE-07, OPS-LIVE-09, OPS-LIVE-10]
  - [x] 20-09-PLAN.md — [major] pause/resume CLI default URL derived from DASHBOARD_HOST:DASHBOARD_PORT (fixes :3000 vs :8080 ECONNREFUSED crash) + clear connection errors + config.ts DASHBOARD_URL doc fix [OPS-LIVE-11]
  - [x] 20-10-PLAN.md — [cosmetic] restyle PauseBanner + CircuitBreakerBanner to the dashboard card idiom (bg-surface-light border-loss border-l-4 rounded-lg) + update pauseBanner.test.ts Test 6 [OPS-LIVE-09]

  **Wave 7 — Gap closure docs** *(after Wave 6; documents the Wave-6 behavior):*
  - [x] 20-11-PLAN.md — .env.example DASHBOARD_ALLOWED_ORIGINS + DASHBOARD_URL=127.0.0.1:8080 + config.ts DASHBOARD_ALLOWED_ORIGINS entry + going-live.md dashboard-rebuild step / strong-key FATAL / CLI URL+CORS docs [OPS-LIVE-07, OPS-LIVE-11, OPS-LIVE-12] (commits c7372ca, c006483)

  **Cross-cutting constraints:**
  - **D-ENV-EXAMPLE [USER-BINDING]:** every new env var introduced in Phase 20 lands in .env.example with default + 1-line description (Plan 20-02 owns the registration)
  - **D-OPERATOR-HANDOFF [USER-BINDING]:** docs/operations/going-live.md IS the operator handoff doc at phase close (Plan 20-07 authors all 5 sections)
  - **D-STOP-THE-LINE:** any preflight discovery revealing a production bug (e.g., a chain config silently broken because preflight wasn't catching it) BLOCKS Phase 20 close; treated as OPS-LIVE-14+ / decimal phase 20.1
  - **D-ROLLBACK:** no legacy fallback flags; preflight is always-on; no SKIP_PREFLIGHT=true escape hatch; if preflight is buggy, operator git-reverts the preflight commit
  - **D-ALERTS:** structured pino + Telegram alerts for every FATAL preflight failure with: chain name, failed check, specific reason, remediation pointer to docs/operations/going-live.md
  - **D-04 observable-effect rigor:** every new preflight check test asserts a concrete observable effect (process.exit code, pino log line content, SQLite row written, Telegram alert sent) — no expect(true).toBe(true) hollow fills

### Phase 21: Exit-Engine Live-Runtime Hardening
**Goal**: The 6 deferred human-verification items from v6.16 close are CLOSED with real-mainnet artifacts â€” Etherscan tx hashes, dashboard screenshots, pino log excerpts, DB row excerpts â€” committed in `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md`. "Test passing on a fork" is no longer accepted as closure for any of these items. Future regressions in the exit engine are caught earlier via real-launch fork fixtures and `op`-field log enrichment
**Depends on**: Phase 20 (verification artifacts exercise the new HONEY/ANTIRUG/OPS-LIVE surface â€” preflight, kill-switch, env validation must be in place when the artifacts are captured); also depends on Phase 19 because anti-rug emits log lines under the same `op`-field convention being established here
**Requirements**: EXIT-LIVE-01, EXIT-LIVE-02, EXIT-LIVE-03, EXIT-LIVE-04, EXIT-LIVE-05, EXIT-LIVE-06, EXIT-LIVE-07, EXIT-LIVE-08, EXIT-LIVE-09, EXIT-LIVE-10, EXIT-LIVE-11
**Success Criteria** (what must be TRUE):
  1. `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` is committed with real-mainnet artifacts for all 6 deferred v6.16 items: (a) live exit-poll cycle telemetry showing budget-vs-actual against the 5s budget on real RPC, (b) automated state-persistence-across-restart Vitest fork test that kills bot mid-cycle and verifies `exit_state` table reflects the same poll position pre/post restart, (c) Etherscan tx hash + DB row excerpt + pino log proving `amount_out` non-null on a live mainnet sell, (d) Flashbots bundle-hash-to-mined-tx-hash mapping, (e) browser screenshot showing dashboard WebSocket position updates in real time, (f) pino log excerpts of chain-restart warnings firing on a real RPC drop, plus the SQLite + `.bot-state.json` migration log on a fresh-clone first boot
  2. `scripts/capture-launch.ts` is committed and at least 3 captured-real-launch JSON fixtures live in `test/fork/fixtures/realLaunches/` â€” replaying any of them against `handleNewPairForChain` in a fork test exercises the full validation â†’ buy â†’ exit-monitor â†’ sell lifecycle with realistic transfer hooks, gas costs, and event ordering
  3. Test infrastructure refuses to send real-mainnet transactions without explicit gating â€” chainId guard + `ALLOW_REAL_MAINNET=1` env-gate decorator means a fork test running with `chainId === 1` (mainnet) without the gate fails loudly. CI never sets the gate. A dedicated test wallet (NOT the operator's prod wallet) is used for any real-mainnet test
  4. Every exit-engine code path logs with an `op` field (`op: 'exit-poll-cycle'`, `op: 'partial-sell-trigger'`, `op: 'flashbots-submit'`, etc.) â€” operator can filter logs by `op:exit.full.executed` during real-mainnet runs and see only confirmed exit transactions, not "code path executed" telemetry. The ground-truth metric for "exit happened" is the DB-receipt-decoded `amount_out`, NOT an instrumented try/catch metric
**Plans**: 8 plans (5 waves)

  **Wave 1** *(autonomous foundation; parallel-safe, no file overlap):*
  - [x] 21-01-PLAN.md — exitEngine.ts op-field enrichment (dotted exit.*) + poll-cycle telemetry + flashbots.ts bundleHash->minedTxHash log [EXIT-LIVE-01, EXIT-LIVE-04, EXIT-LIVE-10]
  - [x] 21-02-PLAN.md — test-safety gate: global chainId===1 tripwire in setup.ts + requireRealMainnetGate decorator + fork-only test key + .env.example vars [EXIT-LIVE-08]
  - [x] 21-05-PLAN.md — REQUIREMENTS reword (EXIT-LIVE-01 dotted / 07 PRAGMA user_version / 06 WS-listener) + HONEY-07/08 reconciliation + going-live.md live-capture runbook [EXIT-LIVE-01, EXIT-LIVE-06, EXIT-LIVE-07]

  **Wave 2** *(autonomous; after Wave 1 gate helper; parallel-safe):*
  - [x] 21-03-PLAN.md — scripts/capture-launch.ts archive recorder + 3 realLaunches fixtures (V2+V3, varied exits) + realLaunchReplay.fork.test.ts driving the REAL handler [EXIT-LIVE-09] *(⚠ surfaced D-STOP-THE-LINE V3-buy blocker → phase 21.1; V2 legs green)*
  - [x] 21-04-PLAN.md — exitStatePersistence.fork.test.ts: SIGTERM-restart, asserts identical exit_state strategy columns [EXIT-LIVE-02] *(module-level restart per D-TEST-WALLET-FORKONLY; columns durable)*

  **Wave 3** *(autonomous; the hard gate before any real run):*
  - [x] 21-06-PLAN.md — captureRehearsal.fork.test.ts: fork rehearsal of the exact buy->tight-exit->poll-fires-sell->amount_out sequence, green end-to-end (D-FORK-REHEARSAL) *(GREEN on V2 token LADYS; non-null amount_out via decodeReceipt; 21-07 unblocked)* [rehearsal gate - closes no requirement; validates the EXIT-LIVE-03 mechanism + EXIT-LIVE-04 Flashbots call path; a fork has no relay so 03/04 close on the 21-07 real run]

  **Wave 4** *(OPERATOR-GATED real capital; autonomous: false):*
  - [ ] 21-07-PLAN.md — one controlled real-mainnet ETH buy+sell roundtrip: captures sell amount_out + Etherscan hash, Flashbots bundle->mined mapping, dashboard WS screenshot, live poll telemetry [EXIT-LIVE-01, EXIT-LIVE-03, EXIT-LIVE-04, EXIT-LIVE-05] (autonomous: false)

  **Wave 5** *(operator-confirmed captures + consolidation; autonomous: false):*
  - [ ] 21-08-PLAN.md — induced-RPC-drop warning (06) + fresh-clone migration log/user_version=6 (07) captures + v6.17-VERIFICATION-EVIDENCE.md consolidation [EXIT-LIVE-06, EXIT-LIVE-07, EXIT-LIVE-11] (autonomous: false)

  **Cross-cutting constraints:**
  - **D-EVIDENCE-BAR:** a fork-test pass alone NEVER closes any of the 6 deferred items — each needs a resolvable real-mainnet artifact (Etherscan hash / DB amount_out row / pino excerpt / timestamped screenshot) in v6.17-VERIFICATION-EVIDENCE.md
  - **D-OP-DB-TRUTH:** the ground truth for "an exit happened" is the DB receipt-decoded trades.amount_out + the on-chain receipt, NEVER an op log line or instrumented metric
  - **D-STOP-THE-LINE:** any bug surfaced during a capture or fixture replay BLOCKS phase close and escalates to a new requirement / decimal phase 21.1 — not fix-in-flight, not file-and-defer
  - **D-TEST-WALLET-FORKONLY:** the automated suite uses a fork-only throwaway key with zero real ETH; the prod PRIVATE_KEY is NEVER imported into any test; ALLOW_REAL_MAINNET is never set in CI
  - **D-ENV-EXAMPLE [USER-BINDING]:** ALLOW_REAL_MAINNET, TEST_WALLET_PRIVATE_KEY, CAPTURE_ARCHIVE_RPC_URL land in .env.example with defaults + 1-line descriptions (Plan 02)

### Phase 21.1: V3-Buy Tax-Gate + Flashbots Inclusion Fix (INSERTED — urgent)
**Goal**: The two STOP-THE-LINE blockers surfaced during Phase 21's live-capture work are fixed so the 21-07 real-mainnet roundtrip can proceed — (1) the funded bot can again snipe Uniswap **V3** tokens (the V3 buy path no longer aborts at a V2-only transfer-tax gate), and (2) the Flashbots submit path never reports a buy/sell that actually landed on-chain as failed (a bundle that mined is reconciled against chain state and the position is registered + monitored), with a retry loop that cannot double-spend
**Depends on**: Phase 21 Waves 1-2 (which surfaced these bugs via the 21-03 regression net + the 21-07 live attempt). BLOCKS Phase 21 Wave 4 (21-07 real-capital capture) and therefore Phase 21 close (D-STOP-THE-LINE)
**Requirements**: STOP-THE-LINE-01 (V3-buy tax-gate), STOP-THE-LINE-02 (Flashbots false-negative inclusion), STOP-THE-LINE-03 (V2-buy tax-call real-buy removal — the mirror of -01; added 2026-05-26 per D-V2-TAX-REMOVE) — full diagnoses in `.planning/phases/21-exit-engine-live-runtime-hardening/21-STOP-THE-LINE-01-v3-buy-tax-gate.md` and `21-STOP-THE-LINE-02-flashbots-false-negative.md`; formalize as REQUIREMENTS.md rows at plan-phase
**Success Criteria** (what must be TRUE):
  1. **STOP-THE-LINE-01 resolved:** a benign Uniswap V3 token passes the bot's transfer-tax safety gate on the V3 buy path (`src/bot.ts:~610-617`, today routed into the V2-only `hasHighTransferTaxForChain` at `tokenSafety.ts:482`) and the buy proceeds, while a real high-tax/honeypot V3 token still fails closed — proven by a unit/fork test. `test/fork/realLaunchReplay.fork.test.ts` is updated so the `eth-v3-trailing.json` fixture asserts the full validation→buy→exit→sell lifecycle instead of today's blocked-at-gate observable
  2. **STOP-THE-LINE-02 resolved (inclusion reconciliation):** when `FlashbotsMevStrategy.sendTransaction` (`src/utils/mevStrategies/flashbots.ts:~52-120`) gets a non-`BundleIncluded` `bundle.wait()` result, it reconciles against chain state — `getTransactionCount(wallet,'latest')` and/or the bundle tx-hash receipt — and a bundle that actually mined is returned as the real on-chain hash so the trade is recorded, the position registered, and the exit monitor started. A regression test replays the live LADYS scenario (`wait()` says "not included" but the nonce advanced / receipt exists) and asserts success, not failure
  3. **Retry path is nonce-safe:** the submit retry loop re-fetches the nonce each attempt and never resubmits a nonce that may already be mined; a test proves a misreported-but-landed attempt-0 cannot trigger a second real buy (no double-spend)
  4. **Verified before the 21-07 retry:** both fixes are green in the test suite (unit + fork) before any real-capital re-attempt; because `executeFullSell` (`src/exitEngine.ts`) submits through the same `sendTransaction`, the sell leg inherits the inclusion-reconciliation fix so a captured sell `amount_out` / Flashbots bundle artifact cannot be a false-negative
**Plans**: 6 plans

  **Wave 0** *(no deps; Nyquist stubs + REQ formalization):*
  - [ ] 21.1-01-PLAN.md — REQUIREMENTS.md STOP-THE-LINE-01/02/03 rows (all ACTIVE; -03 = V2 tax-call removal, promoted from deferred 2026-05-26) + Nyquist it.skip stubs for the reconciliation + config-var tests + the V2-unsafe-real-buy assertion [STOP-THE-LINE-01, STOP-THE-LINE-02, STOP-THE-LINE-03]

  **Wave 1** *(parallel; foundation + the independent V3 fix):*
  - [ ] 21.1-02-PLAN.md — shared reconciliation.ts helper (nonce-safe retry + receipt-primary reconciliation + bounded confirm-window + sell-gas-reserving fee escalation) + 5 MEV env vars in config.ts/.env.example [STOP-THE-LINE-02]
  - [ ] 21.1-03-PLAN.md — remove the V2-only tax call from BOTH the V2 and V3 banks (+delete the now-dead `hasHighTransferTaxForChain` function/import/test) + flip the V3 fork fixture to the full buy→exit→sell lifecycle (+ dumpV3Pool price-mover) [STOP-THE-LINE-01, STOP-THE-LINE-03]

  **Wave 2** *(after the helper + stubs):*
  - [ ] 21.1-04-PLAN.md — wire all 3 MEV strategies (flashbots/bloXroute/passthrough) through submitWithReconciliation + flip per-strategy misreport-but-landed / mined-but-reverted / nonce-safe / sell-leg tests green [STOP-THE-LINE-02]

  **Wave 3** *(after strategy wiring):*
  - [ ] 21.1-05-PLAN.md — delete the dead legacy sendTxWithRetry branch (D-DELETE-LEGACY) + record the real tx hash on the buy row (D-RECORD-REAL-HASH, V2+V3) [STOP-THE-LINE-02]

  **Wave 4** *(pre-21-07 gate; depends on everything):*
  - [ ] 21.1-06-PLAN.md — full-suite + mainnet-fork rehearsal (passthrough path) before the 21-07 real-capital retry; records the Flashbots-is-21-07 caveat [STOP-THE-LINE-01, STOP-THE-LINE-02]

  **Cross-cutting constraints:**
  - **D-QUALITY-FIRST [USER-BINDING]:** at every choice pick the better+safer+higher-quality option regardless of LOC; "minimal surface / least code" is NOT a tiebreaker
  - **D-V3-ONLY-SCOPE [AMENDED 2026-05-26]:** the V3-only fence was PARTIALLY LIFTED — the V2 `hasHighTransferTaxForChain` tax-call removal (bot.ts:303) is now IN scope as STOP-THE-LINE-03 (research confirmed it fires a real amountOutMin=0 buy with broken NaN math, not the "V2 works" premise); with both call sites gone the dead function/import/tokenSafety.ts:482/test are deleted. The fence STILL holds for the REST of the V2 capture flow — only the broken tax call is removed; the bot.ts:253 honeypot roundtrip, buy/sell submit, and exit path are untouched
  - **D-FORK-REHEARSAL-21.1:** the fork rehearsal proves the passthrough reconciliation + buy→register→exit wiring; the Flashbots false-negative path is unit-proven and validated for real ONLY on the Phase-21 21-07 retry

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Bug Fixes & Hardening | v6.16 | 4/4 | Complete | 2026-03-20 |
| 2. ethers v6 Migration | v6.16 | 2/2 | Complete | 2026-03-21 |
| 3. SQLite Storage & Code Quality | v6.16 | 4/4 | Complete | 2026-03-22 |
| 4. Multi-Chain Architecture | v6.16 | 5/5 | Complete | 2026-03-24 |
| 5. Uniswap V3 Integration | v6.16 | 4/4 | Complete | 2026-03-25 |
| 6. Risk Management | v6.16 | 2/2 | Complete | 2026-03-25 |
| 7. Smart Exit Strategies | v6.16 | 4/4 | Complete | 2026-03-26 |
| 8. Monitoring & Web Dashboard | v6.16 | 6/6 | Complete | 2026-03-28 |
| 9. Testing Infrastructure | v6.16 | 5/5 | Complete | 2026-03-28 |
| 10. partial_sell Revenue Fix | v6.16 | 2/2 | Complete | 2026-03-30 |
| 11. Dashboard Accuracy & Bot Wiring | v6.16 | 7/7 | Complete | 2026-04-05 |
| 12. Integration Gap Fixes | v6.16 | 3/3 | Complete | 2026-04-06 |
| 13. Config Env-Var Correctness | v6.16 | 1/1 | Complete | 2026-04-06 |
| 14. Sell Revenue Receipt Decoding | v6.16 | 2/2 | Complete | 2026-04-07 |
| 15. Chain-Scoped Dedup & Dashboard Env | v6.16 | 2/2 | Complete | 2026-04-13 |
| 16. Dashboard Type Alignment & Dead Code Cleanup | v6.16 | 2/2 | Complete | 2026-04-13 |
| 17. Tech Debt Cleanup & Audit Baseline | v6.17 | 3/3 | Complete | 2026-04-30 |
| 18. Honeypot Detection Rebuild | v6.17 | 10/11 | In Progress|  |
| 19. Anti-Rug Runtime Monitoring | v6.17 | 10/10 | Complete   | 2026-05-24 |
| 20. Going-Live Ops Hardening | v6.17 | 12/12 | Complete    | 2026-05-26 |
| 21. Exit-Engine Live-Runtime Hardening | v6.17 | 6/8 | In Progress (21-07/08 operator-gated; 21.1 blocker open) | - |
| 21.1. V3-Buy Tax-Gate + Flashbots Inclusion Fix | v6.17 | 0/6 | Planned (6 plans, 3 reqs STOP-THE-LINE-01/02/03; blocks 21-07) | - |

---
*Last updated: 2026-05-24 — Phase 20 plan 20-00 complete: 14 Wave-0 vitest test stubs (37 unit + 29 integration = 66 it.skip) shipped covering OPS-LIVE-01..11 + schema v5→v6 migration; D-04 observable-effect rigor preserved (concrete pino fields / process.exit codes / SQLite rows / broadcast events in every reason string); D-09 .todo ban CI guard preserved (0 .todo matches); full unit suite 487 passed + 37 skipped; full integration suite 169 passed + 29 skipped; tsc clean ×3. Plans 20-02..05 unblocked — implementation plans flip skip→it per per-file ownership map in 20-00-SUMMARY.md.*
