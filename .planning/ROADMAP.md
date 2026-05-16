# Roadmap: Crypto Snipe Bot

## Overview

Production-ready multi-chain MEV sniper bot with Uniswap V2/V3 support,
intelligent exit strategies, portfolio risk management, SQLite audit trail,
and real-time web dashboard across ETH, BSC, Base, and Arbitrum.

## Milestones

- ✅ **v6.16 Production-Ready Multi-Chain MEV Sniper** — Phases 1-16 (shipped 2026-04-14) — [archive](milestones/v6.16-ROADMAP.md)
- 🚧 **v6.17 Defensive Hardening for Live Mainnet** — Phases 17-21 (planning)

## Phases

<details>
<summary>✅ v6.16 Production-Ready Multi-Chain MEV Sniper (Phases 1-16) — SHIPPED 2026-04-14</summary>

- [x] Phase 1: Bug Fixes & Hardening (4/4 plans)
- [x] Phase 2: ethers v6 Migration (2/2 plans)
- [x] Phase 3: SQLite Storage & Code Quality (4/4 plans)
- [x] Phase 4: Multi-Chain Architecture (5/5 plans)
- [x] Phase 5: Uniswap V3 Integration (4/4 plans)
- [x] Phase 6: Risk Management (2/2 plans)
- [x] Phase 7: Smart Exit Strategies (4/4 plans) — completed 2026-03-26
- [x] Phase 8: Monitoring & Web Dashboard (6/6 plans)
- [x] Phase 9: Testing Infrastructure (5/5 plans) — completed 2026-03-28
- [x] Phase 10: partial_sell Revenue Fix (2/2 plans) — completed 2026-03-30
- [x] Phase 11: Dashboard Accuracy & Bot Wiring (7/7 plans) — completed 2026-04-05
- [x] Phase 12: Integration Gap Fixes (3/3 plans) — completed 2026-04-06
- [x] Phase 13: Config Env-Var Correctness (1/1 plan) — completed 2026-04-06
- [x] Phase 14: Sell Revenue Receipt Decoding (2/2 plans) — completed 2026-04-07
- [x] Phase 15: Chain-Scoped Dedup & Dashboard Env (2/2 plans) — completed 2026-04-13
- [x] Phase 16: Dashboard Type Alignment & Dead Code Cleanup (2/2 plans) — completed 2026-04-13

Full archive: [milestones/v6.16-ROADMAP.md](milestones/v6.16-ROADMAP.md)

</details>

### 🚧 v6.17 Defensive Hardening for Live Mainnet (Phases 17-21) — PLANNING

- [x] **Phase 17: Tech Debt Cleanup & Audit Baseline** — CI-verified baseline of `.todo`/TS-error counts, fills/skips remaining stubs, retroactive Nyquist on 9 phases, diagnostic-log cleanup *(completed 2026-04-30)*
- [ ] **Phase 18: Honeypot Detection Rebuild** — Deploy `HoneypotChecker.sol` (Option D) on 4 chains; replace broken V2/V3 sell-sim gates; discriminated-union `HoneypotResult`; multi-amount tax probe; safety-bank audit
- [ ] **Phase 19: Anti-Rug Runtime Monitoring** — Single-listener-per-chain LP-removal detector; multi-signal trigger with allowlist + confirm-after-N-blocks; bridge to `executeFullSell` with elevated gas; 7-day dry-run mode
- [ ] **Phase 20: Going-Live Ops Hardening** — Fail-closed preflight (wallet/RPC/MEV/checker code-at-address); cross-variable env validation; multi-stage kill-switch with SQLite-persisted pause; `npm run preflight/pause/resume`; runbook formalization
- [ ] **Phase 21: Exit-Engine Live-Runtime Hardening** — Real-mainnet verification artifacts (Etherscan tx hashes, dashboard screenshots, log excerpts) for all 6 deferred v6.16 items; chainId guard + `ALLOW_REAL_MAINNET=1` test infrastructure; `op`-field log enrichment

## Phase Details

### Phase 17: Tech Debt Cleanup & Audit Baseline
**Goal**: Operator can trust the v6.17 audit baseline — every claim of done in v6.16 close is verified by CI artifact (not a doc number), every retroactively-validated phase has one production-relevant assertion, and remaining stubs/errors are addressed via real fixes (not suppression)
**Depends on**: Nothing (Phase 17 is the foundation; CI-discovery pass settles disputed `.todo`/TS status before substantive work)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06
**Success Criteria** (what must be TRUE):
  1. `find test/ -name '*.todo*' -print` and `npx tsc --noEmit` artifacts are committed in `.planning/milestones/v6.17-debt-baseline.md` so the operator (and future audits) can see the actual counts of `.todo` stubs and TS annotation errors as ground truth — not the disputed 37/6 numbers from the v6.16 close audit
  2. After Phase 17 completes, `npx tsc --noEmit` exits clean across all tsconfig projects with zero `as any` suppressions added in this phase, and `find test/ -name '*.todo*'` either returns empty or each remaining hit has been converted to `.skip` with an explicit reason
  3. Each of the 9 retroactively-validated phases (01, 02, 03, 05, 06, 07, 08, 09, 10) produces one production-relevant assertion documented in its `VALIDATION.md` — answering "does this prevent the harm we said it would?" — explicitly excluding FIX-04 and V3-03 which are addressed via fresh implementation in Phase 18 and validated there
  4. The diagnostic `console.log` lines at `src/telegramListener.ts:55,61` and the `getTradesByToken` unused const at `src/utils/db.ts:215` no longer appear in the codebase as called out; logs preserved as `log.debug` where appropriate, deleted where not
**Plans**: 3 plans

  **Wave 0** *(no dependencies; produces ground-truth baseline doc)*
  - [x] 17-01-baseline-and-close-evidence-PLAN.md — Wave-0 CI-output baseline doc + DEBT-03/04 conditional close-out (Branch A verified-empty / Branch B remaining work) [DEBT-01, DEBT-02, DEBT-03 cond, DEBT-04 cond]

  **Wave 1** *(blocked on Wave 0; both plans run in parallel after 17-01 commits)*
  - [x] 17-02-retroactive-nyquist-PLAN.md — Hybrid 7+2 retroactive Nyquist: 7 new harm-prevention tests across phases 01/03/05/06/07/08/10 + 2 inline VALIDATION.md augmentations (phases 02/09); D-07 stop-the-line applies [DEBT-05]
  - [x] 17-03-cleanup-and-ci-invariants-PLAN.md — Verify-then-act sweep: delete getTradesByToken from src/utils/db.ts; append .todo ban + tsc x 3 tsconfigs as evergreen CI guards [DEBT-06 + DEBT-01..04 invariant lock]

  **Cross-cutting constraints** *(invariants spanning multiple plans):*
  - **D-07 stop-the-line:** any retroactive harm-prevention test (Plan 17-02) revealing a real production bug BLOCKS Phase 17 close — surface to user, treat as DEBT-07 / decimal phase 17.1; NOT fix-in-flight, NOT file-and-defer
  - **D-11 verify-then-act:** Plans 17-01 and 17-03 both gate any modification on a fresh-checkout verification step before acting (pre-scout findings are informational, not authoritative)
  - **D-04 observable-effect rigor:** every new test in 17-02 must assert at least one concrete observable effect (DB row, mock-call args, structured pino log, transaction submit/block) — no `expect(true).toBe(true)` style hollow fills

### Phase 18: Honeypot Detection Rebuild
**Goal**: The bot can again snipe new tokens — V2 and V3 — on live mainnet without the broken sell-sim hard-blocking every attempt; honeypots that the v6.16 vacuous-pass let through are now caught locally (not just by third-party APIs); and the architecture (discriminated-union `HoneypotResult`, fail-closed `unknown` verdict) makes a vacuous-pass regression unrepresentable in the type system
**Depends on**: Phase 17 (clean audit baseline; FIX-04/V3-03 validated at fresh implementation here, not retroactively)
**Requirements**: HONEY-01, HONEY-02, HONEY-03, HONEY-04, HONEY-05, HONEY-06, HONEY-07, HONEY-08, HONEY-09, HONEY-10, HONEY-11, HONEY-12
**Success Criteria** (what must be TRUE):
  1. The bot snipes a real V2 token on Ethereum mainnet — the new `simulateHoneypotRoundtrip(...)` call at `bot.ts:220-226` returns `verdict: 'safe'` with `evidence.buyTaxBps` and `evidence.sellTaxBps` populated as numerical bps, the buy lands, and an Etherscan tx hash is captured. The "balance=0 hard-block" footgun no longer fires on legitimate launches
  2. A known honeypot token (committed as test fixture) gets `verdict: 'unsafe'` from the new dispatch — both for V2 (replacing the broken sell-sim) and V3 (replacing the silent vacuous-pass) — and the bot skips the buy with a structured pino log line containing the revert reason and a Telegram alert pointing at the token address
  3. `HoneypotChecker.sol` is deployed and Etherscan/BscScan-verified at the addresses recorded in `chainRegistry.ts` `CHAIN_TEMPLATES['eth'|'bsc'|'base'|'arb'].honeypotChecker.deployedAddress` for all 4 enabled chains, with the Slither + Mythril audit report committed in `.planning/milestones/v6.17-honeypot-checker-audit.md` (any flagged issues triaged with documented disposition)
  4. The multi-amount tax probe (1% / 50% / 100% of `snipeAmount`) catches an amount-varying-tax fixture token in the test suite — a token that returns 0% tax on small probes and >25% tax on production-sized swaps no longer passes the gate
  5. The `safetyBank` audit (HONEY-11) findings are committed in `.planning/milestones/v6.17-safety-bank-audit.md` — every gate in `tokenSafety.ts` (buy-sim, tax check, max-wallet, blacklist, liquidity-sufficiency, metadata, transfer-tax, blocklist) has a documented "exercised the underlying behavior" assertion or has been fixed to add one; no other `amountIn=0` family bugs remain undocumented
**Plans**: 11 plans (iter-2 plan-checker revision: +18-00 wave-0 + 18-10 wiring split)

  **Wave 0** *(pre-wave; closes Blocker #2 chicken-and-egg):*
  - [x] 18-00-PLAN.md — REQUIREMENTS.md HONEY-12 row [HONEY-12]

  **Wave 1** *(after 18-00; parallel):*
  - [x] 18-01-PLAN.md — contrived Honeypot.sol 5-mode fixture (4 standard + amount-tiered per Warning #6) + 3 real-mainnet honeypot fixtures (2 V2 + 1 V3 per Blocker #1) [HONEY-12]
  - [x] 18-02-PLAN.md — HoneypotChecker.sol with checkV2 + checkV3 (~160-190 LOC per Blocker #1) + Ignition module + types.ts + abi.ts + dispatch index.ts + simulator.ts stub + checkerContract.ts placeholder with Warning #9 sentinel [HONEY-01, HONEY-05, HONEY-06]
  - [x] 18-03-PLAN.md — bytecodeScan.ts HONEY-12 + scripts/check-mythril-report.ts severity gate [HONEY-12, HONEY-02 tooling]
  - [x] 18-04-PLAN.md — HONEY-11 safetyBank audit: 8 per-gate regression tests + isBlacklistedTokenForChain fail-closed retrofit + audit milestone doc [HONEY-11]

  **Wave 2** *(after Wave 1):*
  - [ ] 18-05-PLAN.md — Slither + Mythril audit covering BOTH checkV2 + checkV3 (Blocker #1) + audit milestone doc + CI gates on contracts/** [HONEY-02] (autonomous: false)
  - [x] 18-06-PLAN.md — chainRegistry.ts honeypotChecker field + tax thresholds + hardhat.config.ts deploy networks + scripts/deploy-honeypot-checker.ts CLI [HONEY-05]

  **Wave 3** *(after audit clean + chainRegistry wired):*
  - [ ] 18-07-PLAN.md — ETH mainnet deploy + Etherscan verify (V2 + V3) + integration test + COMMIT ETH LITERAL INTO src/chainRegistry.ts (Blocker #3) + auto-grep audit precheck (Blocker #4) + 2-3 day observation window [HONEY-03] (autonomous: false)

  **Wave 5** *(parallel after observation window closes):*
  - [ ] 18-08-PLAN.md — BSC + Base + Arbitrum batch deploy + verify + 3 integration tests + 3 chainRegistry.ts per-chain literal commits (Blocker #3) [HONEY-04] (autonomous: false)
  - [ ] 18-09-PLAN.md — checkerContract.ts V2 + V3 wrappers (Blocker #1) + multi-amount probe + tax thresholds + DELETE broken sell-sims (D-ROLLBACK) + fork/integration/unit tests + Warning #9 sentinel removal [HONEY-07, HONEY-08, HONEY-09, HONEY-10]

  **Wave 6** *(after 18-09 wrapper layer; Warning #8 density split):*
  - [ ] 18-10-PLAN.md — bot.ts V2 + V3 in-place gate replacement (V3 feeTier passthrough per Blocker #1) + parallel-bank HONEY-12 on both paths + D-ALERTS tiered alert format + V2/V3 integration tests asserting active V3 unsafe + V3 safe paths [HONEY-07, HONEY-08, HONEY-12]

  **Cross-cutting constraints:**
  - **D-STOP-THE-LINE:** any audit finding revealing a bug worse than V2/V3 sell-sims BLOCKS Phase 18 close; escalates to HONEY-13+ / decimal phase 18.1
  - **D-AUDIT-TIMING:** wave 5/6 closes only after (a) 18-07 ETH deploy live + (b) 18-04 + 18-05 audit-discovered fixes merged; depends_on in 18-09 STRUCTURALLY enforces dep on [18-04, 18-05, 18-07] per iter-2 Blocker #4
  - **D-ROLLBACK:** plan 18-09 DELETES broken simulateSellForChain + simulateSellV3ForChain entirely; no legacy fallback flag retained

### Phase 19: Anti-Rug Runtime Monitoring
**Goal**: When liquidity is removed from a pool the bot has an open position in, the bot fires a frontrun-exit through the existing `executeFullSell` path with elevated gas — within 1-2 confirmation blocks of the LP-removal event, with multi-signal logic (>50% LP removed AND destination not in allowlist AND reserves below sell-threshold) that does not cascade into panic-sells on legitimate V2→V3 migrations, lock-contract transfers, or normal multisig rebalances
**Depends on**: Phase 18 (HONEY establishes the `ChainConfig` extension pattern that ANTIRUG reuses for its own per-chain config; ANTIRUG bridges to `executeFullSell` whose reason union is extended here)
**Requirements**: ANTIRUG-01, ANTIRUG-02, ANTIRUG-03, ANTIRUG-04, ANTIRUG-05, ANTIRUG-06, ANTIRUG-07, ANTIRUG-08, ANTIRUG-09, ANTIRUG-10, ANTIRUG-11, ANTIRUG-12
**Success Criteria** (what must be TRUE):
  1. On a contrived-fork rug-pull scenario (real captured rug-pull replayed against a fork), the bot exits the rugged position via `executeFullSell` with `reason: 'anti-rug'` and a 2.0× gas multiplier within N blocks of the LP-removal event firing — the sell lock, receipt decoding, DB cleanup, and Telegram alert all execute through the existing v6.16 sell pipeline (no parallel exit path)
  2. A V2→V3 migration test (LP burn coinciding with V3 pool creation for the same token pair) does NOT trigger the exit because the destination is in the allowlist and/or reserves do not drop below sell-threshold — the multi-signal logic (>50% removed AND not-allowlisted AND reserves drop) prevents the cascading-panic-sell pattern. Lock-contract transfers (Unicrypt, TeamFinance, PinkLock canonical addresses per chain) likewise do NOT trigger exits
  3. Default deploy is dry-run mode (`ANTIRUG_LIVE_EXECUTE=false`) — the bot logs structured "would-have-sold" pino events on detection without executing, so the operator can compare against actual outcomes for 7 days before flipping the env-flag to live execution. Live-execution requires the explicit env flag
  4. WebSocket disconnect-and-reconnect on the LP-removal listener restores monitoring without losing events — heartbeat ping/pong on `WebSocketProvider` detects silent failures, automatic reconnect re-subscribes the active filters, and `getLogs` over `(lastSeenBlock, currentBlock)` backfills the disconnect window. A simulated WS-kill in the test suite proves the bot does not silently miss events
  5. The per-chain circuit breaker disables anti-rug for that chain after N triggers in a configurable window (default 3 in 1h) — operator can manually reset via the dashboard, and the dashboard surfaces "anti-rug halted on chain X" prominently. A misbehaving event-stream cannot trigger N panic-sells in a row
**Plans**: TBD

### Phase 20: Going-Live Ops Hardening
**Goal**: The bot refuses to start in any internally-inconsistent or unsafe state — undercut wallet, mismatched chainId, missing checker code-at-address, `MEV_STRATEGY=flashbots` without `FLASHBOTS_AUTH_KEY`, etc. — with operator-facing error messages that point to the runbook; the operator can run `npm run preflight` to verify readiness without starting the bot, and `npm run pause`/`npm run resume` to operate the kill-switch from the CLI; the runbook is in versioned docs and the multi-stage kill-switch cannot result in a position opening 30s after pause
**Depends on**: Phase 18 (preflight verifies `chainRegistry[chain].honeypotChecker.deployedAddress` via `getCode` — needs the field to exist with a real deployed address)
**Requirements**: OPS-LIVE-01, OPS-LIVE-02, OPS-LIVE-03, OPS-LIVE-04, OPS-LIVE-05, OPS-LIVE-06, OPS-LIVE-07, OPS-LIVE-08, OPS-LIVE-09, OPS-LIVE-10, OPS-LIVE-11, OPS-LIVE-12, OPS-LIVE-13
**Success Criteria** (what must be TRUE):
  1. `MEV_STRATEGY=flashbots` set with `FLASHBOTS_AUTH_KEY` unset causes the bot to exit non-zero at startup with a structured pino fatal log line that names the offending pair AND points to `docs/operations/going-live.md` — the cross-variable env validator catches this combo, refuses to start, and never reaches chain-context creation. The same is true for `ENABLED_CHAINS` including `bsc` without `BLOXROUTE_AUTH_HEADER`, and for the `TELEGRAM_API_ID` 5-tuple
  2. Wallet balance below per-chain `maxCapital` causes a FATAL non-zero exit at startup (never warn-and-continue) — and an undercut detected by the periodic re-check (default every 5 minutes) during operation halts new buys with a Telegram alert. `getCode` against `chainRegistry[chain].honeypotChecker.deployedAddress` returning `0x` likewise FATAL-exits with a "run `npx ts-node scripts/deploy-honeypot-checker.ts <chain>`" message
  3. Operator runs `npm run preflight` from a fresh terminal — script executes all OPS-LIVE-02..05 checks, prints structured per-chain pass/fail output, and exits non-zero on any FATAL — without starting the bot. Operator runs `npm run pause` and dashboard reflects pause state; operator runs `npm run resume` and dashboard reflects resume — both wrap the existing dashboard endpoints with `DASHBOARD_API_KEY` from `.env`
  4. Operator presses pause via dashboard while a snipe is mid-flight in `handleNewPairForChain` — the multi-stage kill-switch re-check at post-safety-bank, post-bundle-build, and post-MEV-submit aborts the in-flight execution. Pause state survives a full bot restart (loaded from SQLite at boot), so an operator-pressed pause cannot result in a position opening after the bot reboots
  5. `GOING-LIVE.md` no longer exists at the repo root — moved to `docs/operations/going-live.md` (atomic with the root-file delete in the same PR), README links to the new path, and a CI guard fails the build if `GOING-LIVE.md` reappears at the repo root. `HONEYPOT-SIM-BRIEFING.md` is either moved to `docs/decisions/honeypot-sim-rebuild.md` (preserved as decision record) or deleted — disposition documented during HONEY plan-phase and resolved in this phase
**Plans**: TBD

### Phase 21: Exit-Engine Live-Runtime Hardening
**Goal**: The 6 deferred human-verification items from v6.16 close are CLOSED with real-mainnet artifacts — Etherscan tx hashes, dashboard screenshots, pino log excerpts, DB row excerpts — committed in `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md`. "Test passing on a fork" is no longer accepted as closure for any of these items. Future regressions in the exit engine are caught earlier via real-launch fork fixtures and `op`-field log enrichment
**Depends on**: Phase 20 (verification artifacts exercise the new HONEY/ANTIRUG/OPS-LIVE surface — preflight, kill-switch, env validation must be in place when the artifacts are captured); also depends on Phase 19 because anti-rug emits log lines under the same `op`-field convention being established here
**Requirements**: EXIT-LIVE-01, EXIT-LIVE-02, EXIT-LIVE-03, EXIT-LIVE-04, EXIT-LIVE-05, EXIT-LIVE-06, EXIT-LIVE-07, EXIT-LIVE-08, EXIT-LIVE-09, EXIT-LIVE-10, EXIT-LIVE-11
**Success Criteria** (what must be TRUE):
  1. `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` is committed with real-mainnet artifacts for all 6 deferred v6.16 items: (a) live exit-poll cycle telemetry showing budget-vs-actual against the 5s budget on real RPC, (b) automated state-persistence-across-restart Vitest fork test that kills bot mid-cycle and verifies `exit_state` table reflects the same poll position pre/post restart, (c) Etherscan tx hash + DB row excerpt + pino log proving `amount_out` non-null on a live mainnet sell, (d) Flashbots bundle-hash-to-mined-tx-hash mapping, (e) browser screenshot showing dashboard WebSocket position updates in real time, (f) pino log excerpts of chain-restart warnings firing on a real RPC drop, plus the SQLite + `.bot-state.json` migration log on a fresh-clone first boot
  2. `scripts/capture-launch.ts` is committed and at least 3 captured-real-launch JSON fixtures live in `test/fork/fixtures/realLaunches/` — replaying any of them against `handleNewPairForChain` in a fork test exercises the full validation → buy → exit-monitor → sell lifecycle with realistic transfer hooks, gas costs, and event ordering
  3. Test infrastructure refuses to send real-mainnet transactions without explicit gating — chainId guard + `ALLOW_REAL_MAINNET=1` env-gate decorator means a fork test running with `chainId === 1` (mainnet) without the gate fails loudly. CI never sets the gate. A dedicated test wallet (NOT the operator's prod wallet) is used for any real-mainnet test
  4. Every exit-engine code path logs with an `op` field (`op: 'exit-poll-cycle'`, `op: 'partial-sell-trigger'`, `op: 'flashbots-submit'`, etc.) — operator can filter logs by `op:exit.full.executed` during real-mainnet runs and see only confirmed exit transactions, not "code path executed" telemetry. The ground-truth metric for "exit happened" is the DB-receipt-decoded `amount_out`, NOT an instrumented try/catch metric
**Plans**: TBD

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
| 18. Honeypot Detection Rebuild | v6.17 | 6/11 | In Progress|  |
| 19. Anti-Rug Runtime Monitoring | v6.17 | 0/? | Not started | - |
| 20. Going-Live Ops Hardening | v6.17 | 0/? | Not started | - |
| 21. Exit-Engine Live-Runtime Hardening | v6.17 | 0/? | Not started | - |

---
*Last updated: 2026-04-30 — Phase 17 complete (DEBT-01..06 closed; baseline doc + 7+2 retroactive Nyquist + getTradesByToken deletion + CI invariant lock)*
