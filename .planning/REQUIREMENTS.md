# Requirements: Crypto Snipe Bot — v6.17 Defensive Hardening for Live Mainnet

**Defined:** 2026-04-29
**Core Value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — the bot must never lose money to preventable bugs, race conditions, or security flaws.

**Milestone goal:** Make the bot safe to run with real money on live mainnet by rebuilding the broken pre-buy safety stack, adding anti-rug runtime monitoring, hardening exit-engine live-runtime behavior, formalizing the going-live ops path, and closing v6.16 tech debt.

REQ-IDs continue from v6.16 categories where appropriate (DEBT extends prior tech-debt themes) and introduce new categories (HONEY, ANTIRUG, OPS-LIVE, EXIT-LIVE) where v6.17 covers fundamentally new surface area.

## v1 Requirements (v6.17)

### Tech Debt Cleanup (DEBT)

Pre-substantive-work cleanup of v6.16 close debt. Phase 17 first verifies status via CI before pre-budgeting fix work — research disputed whether `.todo` stubs and TS errors remain.

- [ ] **DEBT-01**: CI verification produces an artifact recording the actual count of `.todo` test stubs (`find test/ -name '*.todo*' -print` plus equivalent for `*.test.ts` `.todo()` blocks). Artifact committed in `.planning/milestones/v6.17-debt-baseline.md`.
- [ ] **DEBT-02**: CI verification produces an artifact recording the actual count of TypeScript annotation errors in dashboard API routes (`npx tsc --noEmit --project tsconfig.dashboard.json` or equivalent). Artifact committed in the same baseline doc as DEBT-01.
- [ ] **DEBT-03**: Any remaining `.todo` exit-engine test stubs (count from DEBT-01) are filled with real behavioral assertions, OR converted to `.skip` with explicit reason. No `expect(true).toBe(true)` style hollow fills.
- [ ] **DEBT-04**: Any remaining TS annotation errors (count from DEBT-02) are fixed via real type definitions — not `as any` suppression. `tsc --noEmit` exits clean across all tsconfig projects after DEBT-04 lands.
- [ ] **DEBT-05**: Retroactive Nyquist validation completed on phases 01, 02, 03, 05, 06, 07, 08, 09, 10. Excludes FIX-04 (V2 sell-sim) and V3-03 (V3 sell-sim) — these are addressed via fresh implementation in HONEY-07/HONEY-08 and validated at fresh-implementation time, not retroactively. Each validated phase produces one production-relevant assertion (not just "tests pass").
- [ ] **DEBT-06**: Diagnostic `console.log` lines and dead local variables removed: `src/telegramListener.ts:55,61`, `src/utils/db.ts:215` (`getTradesByToken` unused const). Replaced with structured `log.debug` where retention is appropriate; deleted otherwise.

### Honeypot Detection Rebuild (HONEY)

The current pre-buy safety-stack rebuild — fixes the broken V2 sell-sim (`amountIn=0` hard-block) and silent-pass V3 sell-sim. Architecture: Option D (deploy `HoneypotChecker.sol`) primary; Option C (`eth_simulateV1`) opt-in fallback only. Decision closed by research convergence (STACK + ARCHITECTURE + PITFALLS).

- [ ] **HONEY-01**: `contracts/honeypot/HoneypotChecker.sol` authored — ~80 LOC Solidity round-trip checker; reverts at end of buy→sell to roll back; uses OZ `IERC20`; storage-agnostic (exercises token's own `_transfer` hook); compiled under existing solc 0.8.28 toolchain.
- [ ] **HONEY-02**: Slither + Mythril static analysis runs clean (or all flagged issues triaged with documented disposition) on `HoneypotChecker.sol` before any mainnet deploy. Audit report committed in `.planning/milestones/v6.17-honeypot-checker-audit.md`.
- [ ] **HONEY-03**: `HoneypotChecker.sol` deployed on Ethereum mainnet via Hardhat Ignition. Deployed address recorded in `chainRegistry.ts` `CHAIN_TEMPLATES['eth'].honeypotChecker.deployedAddress`. Etherscan-verified.
- [ ] **HONEY-04**: `HoneypotChecker.sol` deployed on BSC, Base, and Arbitrum mainnets. Deployed addresses recorded in respective `CHAIN_TEMPLATES` entries. Each block-explorer-verified.
- [ ] **HONEY-05**: `src/utils/honeypot/` module created with: dispatch layer (`index.ts`), Option-D wrapper (`checkerContract.ts`), Option-C fallback skeleton (`simulator.ts`), shared `types.ts`. Per-chain dispatch via new `ChainConfig.honeypotChecker.method` field.
- [ ] **HONEY-06**: `HoneypotResult` type defined as discriminated union: `{ verdict: 'safe' | 'unsafe' | 'unknown', evidence: { buyTaxBps?, sellTaxBps?, revertReason?, ... } }`. Vacuous pass is unrepresentable in the type system. `unknown` verdict fails closed at every caller.
- [ ] **HONEY-07**: V2 honeypot gate at `bot.ts:220-226` replaced in-place with new `simulateHoneypotRoundtrip(...)` dispatch call. The hard-block-before-parallel-bank semantic of FIX-04 preserved. Existing parallel safety bank at `bot.ts:229-238` unchanged.
- [ ] **HONEY-08**: V3 honeypot gate at `bot.ts:411-416` replaced in-place with new `simulateHoneypotRoundtrip(...)` dispatch call. Eliminates the silent vacuous-pass — `unknown` verdict now fails closed instead of returning `true`.
- [ ] **HONEY-09**: Numerical buy-tax + sell-tax extraction in basis points returned in `HoneypotResult.evidence`. Per-chain configurable max-tax thresholds (`ETH_MAX_BUY_TAX_BPS`, etc.) enforced at gate; logged in structured pino output on every safety check.
- [ ] **HONEY-10**: Multi-amount tax probe at 1%, 50%, and 100% of intended position size. Catches amount-varying taxes that single-amount probes miss. Implemented as N=3 calls into the deployed checker; aggregated into the `HoneypotResult`.
- [ ] **HONEY-11**: Audit pass on the other 8+ gates in `tokenSafety.ts` (buy-sim, tax check, max-wallet, blacklist, liquidity-sufficiency, metadata, transfer-tax, blocklist) for `amountIn=0` / vacuous-pass family bugs. Findings documented in `.planning/milestones/v6.17-safety-bank-audit.md`; fixes shipped atomically with HONEY-07/08 if any are found.

### Anti-Rug Runtime Monitoring (ANTIRUG)

DETECT-02 — runtime monitoring of open positions for liquidity-removal events with frontrun-exit on detection. Loss minimization, not rug prevention; frontrun success is realistically 30-40% per published patterns.

- [ ] **ANTIRUG-01**: New `src/anti-rug/detector.ts` module with single-listener-per-chain WebSocket subscription pattern. NOT per-position (avoids subscription-cap leaks at scale). Internal dispatch routes events to subscribed positions.
- [ ] **ANTIRUG-02**: `Pair.Burn` event subscription per enabled chain with topic-filter on currently-open position pair addresses (V2 path).
- [ ] **ANTIRUG-03**: LP-token `Transfer(_, to=0xdEaD..., _)` event subscription as alternative rug-pattern (V2 path).
- [ ] **ANTIRUG-04**: Schema migration v4→v5 — adds `lp_baseline` table (`trade_id`, `pair_address`, `token0_reserve`, `token1_reserve`, `lp_total_supply`, `snapshot_ts`). Snapshot taken at buy-success. Additive only; no existing tables modified.
- [ ] **ANTIRUG-05**: Multi-signal trigger logic — fires only when (a) >50% of LP removed vs baseline AND (b) destination address NOT in allowlist AND (c) reserves drop below configurable sell-threshold. Single-signal triggers explicitly rejected.
- [ ] **ANTIRUG-06**: Hardcoded allowlist of LP locker / multisig / known-safe destinations per chain — Unicrypt, TeamFinance, PinkLock canonical addresses verified during plan-phase. Stored in `src/anti-rug/allowlist.ts` and per-chain in `CHAIN_TEMPLATES`.
- [ ] **ANTIRUG-07**: Confirm-after-N-blocks delay before exit fires (default 1 block on ETH, configurable per chain via env). Suppresses false positives on reorg-volatile or fast-finality chains.
- [ ] **ANTIRUG-08**: Bridge to `exitEngine.executeFullSell` with new `reason: 'anti-rug'` discriminant on the existing reason union. Anti-rug calls `executeFullSell` (does NOT submit transactions directly — preserves sell lock, receipt decoding, DB cleanup, Telegram alerts). Elevated gas multiplier (default 2.0×, per-chain configurable).
- [ ] **ANTIRUG-09**: Per-chain circuit breaker — auto-disable anti-rug for that chain after N triggers in a configurable window (default 3 in 1h). Manual operator-reset via dashboard.
- [ ] **ANTIRUG-10**: 7-day dry-run mode — log "would-have-sold" events without executing the exit. Dry-run flips to live via explicit env-flag (`ANTIRUG_LIVE_EXECUTE=true`); default dry-run-only at first deploy.
- [ ] **ANTIRUG-11**: WebSocket reconnect-resubscribe-backfill — on disconnect, ethers v6 `WebSocketProvider` does not auto-reconnect (issue #1053). Module reconnects, re-subscribes, and backfills missed events via `getLogs` over `(lastSeenBlock, currentBlock)`.
- [ ] **ANTIRUG-12**: Heartbeat ping/pong on `WebSocketProvider` using existing `ws@^8.20.0`. Periodic ping (default 30s); silent failure detection beyond library defaults.

### Going-Live Ops Hardening (OPS-LIVE)

Code-level hardening of the going-live runbook gaps, env validation upgrades, kill-switch hardening. Formalizes the working-tree-root briefing files into versioned docs.

- [ ] **OPS-LIVE-01**: New `src/preflight.ts` startup-time fail-fast module. Called from `startMultiChainBot` BEFORE chain context creation. All checks below execute via this module.
- [ ] **OPS-LIVE-02**: Wallet balance pre-flight — FATAL on undercut (exit non-zero), never warn-and-continue. Per-chain minimum derived from `chainRegistry.ts` `maxCapital` field. Periodic re-check during operation (default every 5 minutes); halt + Telegram alert if balance falls below threshold mid-run.
- [ ] **OPS-LIVE-03**: RPC health pre-flight per enabled chain — chainId match (FATAL on mismatch, preserves v6.16 behavior), latest-block-age within tolerance, WebSocket reachability.
- [ ] **OPS-LIVE-04**: MEV connectivity pre-flight per chain — Flashbots auth on ETH (HEAD against `relay.flashbots.net`), bloXroute auth on BSC (HEAD with auth header), passthrough chains skipped explicitly.
- [ ] **OPS-LIVE-05**: HoneypotChecker code-at-address pre-flight — `getCode` against `chainRegistry[chain].honeypotChecker.deployedAddress` for each enabled chain. FATAL if no code at address.
- [ ] **OPS-LIVE-06**: Stale-data warnings — at startup, flag positions whose `last_update_ts` exceeds 2× the current poll interval. Tiered severity (warn under 4×, error over 4×).
- [ ] **OPS-LIVE-07**: Cross-variable env validation — refuse to start with internally-inconsistent env. Rules include: `MEV_STRATEGY=flashbots` requires `FLASHBOTS_AUTH_KEY`; `ENABLED_CHAINS` includes `bsc` requires `BLOXROUTE_AUTH_HEADER`; `TELEGRAM_API_ID` requires the full 5-tuple of Telegram listener vars; etc.
- [ ] **OPS-LIVE-08**: Multi-stage kill-switch — pause flag re-checked at three points within `handleNewPairForChain`: post-safety-bank, post-bundle-build, post-MEV-submit. Operator-pressed pause cannot result in a position opening 30s later.
- [ ] **OPS-LIVE-09**: SQLite-persisted pause state — pause flag survives restart. Loaded at boot from `bot_state` table (or new dedicated table); read-through on dashboard control queries; written on operator pause/resume.
- [ ] **OPS-LIVE-10**: `npm run preflight` script — runs all OPS-LIVE-02..05 checks and exits non-zero if any fail; does NOT start the bot. Operator can run before manual boot.
- [ ] **OPS-LIVE-11**: `npm run pause` and `npm run resume` scripts — operator-friendly wrappers around the existing dashboard pause/resume endpoints. Read `DASHBOARD_API_KEY` from `.env`; perform login + pause/resume in one command.
- [ ] **OPS-LIVE-12**: `GOING-LIVE.md` moved from working-tree root to `docs/operations/going-live.md` (atomic with root-file delete). README links to it. CI guard added that fails the build if `GOING-LIVE.md` reappears at the repo root.
- [ ] **OPS-LIVE-13**: `HONEYPOT-SIM-BRIEFING.md` either moved to `docs/decisions/honeypot-sim-rebuild.md` (preserved as decision record) or deleted (briefing closed by HONEY-01..11) — disposition decided during HONEY plan-phase.

### Exit-Engine Live-Runtime Hardening (EXIT-LIVE)

Resolves the 6 deferred human-verification items from v6.16 close as real-mainnet artifacts (Etherscan tx hashes, dashboard screenshots, log excerpts). "Test passing on a fork" is explicitly insufficient for closure.

- [ ] **EXIT-LIVE-01**: Live exit-poll cycle telemetry — pino log per cycle records budget-vs-actual against the 5s poll budget. Field schema: `{ op: 'exit-poll-cycle', positions: N, durationMs: M, budgetMs: 5000, overruns: ... }`.
- [ ] **EXIT-LIVE-02**: Automated state-persistence-across-restart test — Vitest fork test that kills bot mid-cycle (SIGTERM), restarts, and verifies `exit_state` table reflects the same poll position pre/post restart.
- [ ] **EXIT-LIVE-03**: Real-mainnet artifact captured for `amount_out` non-null on a live mainnet sell — Etherscan tx hash, DB row excerpt (`amount_out` non-null), pino log excerpt.
- [ ] **EXIT-LIVE-04**: Real-mainnet artifact captured for Flashbots tx-hash mapping — bundle hash from submission maps to mined tx hash on Etherscan. Demonstrates v6.16 FIX-09 (Flashbots dynamic relay + nonce-incrementing retry) working under real MEV competition.
- [ ] **EXIT-LIVE-05**: Real-mainnet artifact captured for dashboard WebSocket position-update — browser screenshot showing position appearing/updating in real time after a real on-chain event.
- [ ] **EXIT-LIVE-06**: Real-mainnet artifact captured for chain-restart warning — pino log excerpt showing the warning fires on a real RPC drop (induced or naturally observed).
- [ ] **EXIT-LIVE-07**: Real-mainnet artifact captured for bot startup with SQLite + `.bot-state.json` migration — pino log excerpt showing the migration ran on a fresh-clone first boot, plus DB schema check confirming `schema_version` rows.
- [ ] **EXIT-LIVE-08**: Test infrastructure — chainId guard + `ALLOW_REAL_MAINNET=1` env-gate decorator. Fork tests fail loudly if `chainId === 1` (mainnet) without the gate. Dedicated test wallet (not operator's prod wallet) required.
- [ ] **EXIT-LIVE-09**: `scripts/capture-launch.ts` + `test/fork/fixtures/realLaunches/*.json` — captures real mainnet PairCreated → Mint → first-Swap sequences from Etherscan; replays them against `handleNewPairForChain` in fork tests. At least 3 captured launches committed.
- [ ] **EXIT-LIVE-10**: pino log enrichment — every exit-engine code path logs with an `op` field (e.g., `op: 'exit-poll-cycle'`, `op: 'partial-sell-trigger'`, `op: 'flashbots-submit'`). Enables filtered log queries during real-mainnet runs.
- [ ] **EXIT-LIVE-11**: `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` archive consolidating all six real-mainnet artifacts (EXIT-LIVE-03..07) — single-file source of truth that the deferred v6.16 items are now actually closed.

## v2 Requirements (deferred to v6.18+)

Acknowledged but not in v6.17 scope. Carried forward without committing; can be promoted via `/gsd-review-backlog`.

### Anti-Rug

- **ANTIRUG-V2-01**: Mempool-aware anti-rug detection (consumes the same mempool stream as DETECT-01 mempool sniping). Block-confirmed detection in v6.17 caps frontrun success at 30-40%; mempool detection is the only path to higher rates against fast deployers.
- **ANTIRUG-V2-02**: Aggregated rug-signal scoring — combines LP-removal, dev-wallet dump, transfer-pause, owner-renunciation-faking signals into a single risk score. Requires real-world signal-frequency baseline data v6.17 doesn't have yet.
- **ANTIRUG-V2-03**: Tax-change detection on open positions — periodic re-simulation via deployed `HoneypotChecker` to catch deployer-flipping-tax mid-position. Reuses HONEY infrastructure.
- **ANTIRUG-V2-04**: Owner-blacklist-self detection — multi-address simulation against deployer + bot wallet to catch tokens that allow buys for some addresses but block sells for others.

### Honeypot

- **HONEY-V2-01**: Bytecode static analysis as parallel safety gate — scan token bytecode for `setTax`, `setBuyTax`, `setBlacklist`, `setMaxWallet`, `excludeFromFees` selectors. Flags mutable-tax tokens before buy.
- **HONEY-V2-02**: Owner-renunciation + tax-setter-timelock checks. Static checks; cheap to add to the parallel bank but scope-debatable.
- **HONEY-V2-03**: N-of-M consensus across own simulator + 2 third-party APIs (own-sim has veto). Defense-in-depth across heterogeneous detection paths.

### Operations

- **OPS-V2-01**: Synthetic monitor / canary-trade watchdog — separate watchdog process opens a tiny dummy position every N hours and verifies the exit fires. Strongest mitigation against telemetry-masks-issue. Defer until pre-buy/anti-rug proven safe.
- **OPS-V2-02**: Dashboard banner during graceful shutdown. Small UX polish; deferred.

### Future Offensive (out of v6.17 by definition)

Tracked in PROJECT.md "Future" section; will be a separate milestone:

- **CHAIN-05** (continued): fully-dynamic capital allocation by opportunity quality
- **DETECT-01**: mempool / block-0 sniping

## Out of Scope

Explicitly excluded — documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Mock the broken honeypot sim, accept third-party APIs as sole defense | Owner explicitly rejected (HONEYPOT-SIM-BRIEFING.md non-negotiables). Defense-in-depth requires own simulator. |
| Vacuous-pass shortcut (the V3 bug pattern) | Owner explicitly rejected. Type-system prevention via discriminated union (HONEY-06) instead. |
| `getAmountsOut` shortcut for honeypot detection | Pure-math AMM curve check; never invokes token's `_transfer` hook. Catches empty pools, not honeypots. |
| `eth_simulateV1` as primary honeypot detection | Multi-chain RPC support gaps (Infura/MetaMask: "Mainnet and Sepolia only"; BSC/Arbitrum unverified). Option D primary; Option C is opt-in fallback only. |
| Hardhat 3.x migration | Complete rewrite (ESM-first, Node 22, `compile`→`build`); out of v6.17 scope. Stay on Hardhat 2.26. |
| `viem` migration | 6-month rewrite; ethers v6.16 stable. |
| Mobile app, CEX integration, copy trading, arbitrage, limit orders, AI/ML scoring, multi-wallet, presale sniping | Inherited from v6.16 PROJECT.md Out of Scope. |

## Traceability

Initial mapping based on research SUMMARY.md phase recommendations. Roadmapper finalizes during `/gsd-plan-milestone`.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEBT-01 | Phase 17 | Pending |
| DEBT-02 | Phase 17 | Pending |
| DEBT-03 | Phase 17 | Pending |
| DEBT-04 | Phase 17 | Pending |
| DEBT-05 | Phase 17 | Pending |
| DEBT-06 | Phase 17 | Pending |
| HONEY-01 | Phase 18 | Pending |
| HONEY-02 | Phase 18 | Pending |
| HONEY-03 | Phase 18 | Pending |
| HONEY-04 | Phase 18 | Pending |
| HONEY-05 | Phase 18 | Pending |
| HONEY-06 | Phase 18 | Pending |
| HONEY-07 | Phase 18 | Pending |
| HONEY-08 | Phase 18 | Pending |
| HONEY-09 | Phase 18 | Pending |
| HONEY-10 | Phase 18 | Pending |
| HONEY-11 | Phase 18 | Pending |
| ANTIRUG-01 | Phase 19 | Pending |
| ANTIRUG-02 | Phase 19 | Pending |
| ANTIRUG-03 | Phase 19 | Pending |
| ANTIRUG-04 | Phase 19 | Pending |
| ANTIRUG-05 | Phase 19 | Pending |
| ANTIRUG-06 | Phase 19 | Pending |
| ANTIRUG-07 | Phase 19 | Pending |
| ANTIRUG-08 | Phase 19 | Pending |
| ANTIRUG-09 | Phase 19 | Pending |
| ANTIRUG-10 | Phase 19 | Pending |
| ANTIRUG-11 | Phase 19 | Pending |
| ANTIRUG-12 | Phase 19 | Pending |
| OPS-LIVE-01 | Phase 20 | Pending |
| OPS-LIVE-02 | Phase 20 | Pending |
| OPS-LIVE-03 | Phase 20 | Pending |
| OPS-LIVE-04 | Phase 20 | Pending |
| OPS-LIVE-05 | Phase 20 | Pending |
| OPS-LIVE-06 | Phase 20 | Pending |
| OPS-LIVE-07 | Phase 20 | Pending |
| OPS-LIVE-08 | Phase 20 | Pending |
| OPS-LIVE-09 | Phase 20 | Pending |
| OPS-LIVE-10 | Phase 20 | Pending |
| OPS-LIVE-11 | Phase 20 | Pending |
| OPS-LIVE-12 | Phase 20 | Pending |
| OPS-LIVE-13 | Phase 20 | Pending |
| EXIT-LIVE-01 | Phase 21 | Pending |
| EXIT-LIVE-02 | Phase 21 | Pending |
| EXIT-LIVE-03 | Phase 21 | Pending |
| EXIT-LIVE-04 | Phase 21 | Pending |
| EXIT-LIVE-05 | Phase 21 | Pending |
| EXIT-LIVE-06 | Phase 21 | Pending |
| EXIT-LIVE-07 | Phase 21 | Pending |
| EXIT-LIVE-08 | Phase 21 | Pending |
| EXIT-LIVE-09 | Phase 21 | Pending |
| EXIT-LIVE-10 | Phase 21 | Pending |
| EXIT-LIVE-11 | Phase 21 | Pending |

**Coverage:**
- v1 requirements: 53 total (DEBT 6, HONEY 11, ANTIRUG 12, OPS-LIVE 13, EXIT-LIVE 11)
- Mapped to phases: 53 (initial mapping; roadmapper finalizes)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 after initial definition (research-informed)*
