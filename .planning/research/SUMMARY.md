# Project Research Summary

**Project:** crypto-snipe-bot — v6.17 Defensive Hardening for Live Mainnet
**Domain:** Multi-chain MEV sniper — defensive hardening (honeypot detection, anti-rug monitoring, ops, tech debt)
**Researched:** 2026-04-29
**Confidence:** HIGH

---

## Executive Summary

v6.17 is a **subsequent milestone on top of an already-shipped v6.16 production bot** (16 phases, 343/343 tests, live mainnet today with ~0.0124 ETH funded). The bot currently cannot snipe any V2 token because `simulateSellForChain` passes `balance=0` to the router and hard-blocks every snipe; the V3 sell-sim is silently worse — it vacuously returns `true` and provides zero honeypot detection. v6.17 closes that gap and four adjacent ones: anti-rug runtime monitoring (DETECT-02), exit-engine live-runtime hardening (6 deferred verifications from v6.16 close), going-live ops hardening (wallet preflight, env validation), and tech-debt cleanup.

**The four research files converge on a single decision:** ship **Option D — deploy a self-controlled `HoneypotChecker.sol` contract** as the primary honeypot detection mechanism, with Option C (`eth_simulateV1` + state overrides) as a per-chain fallback only. STACK, ARCHITECTURE, and PITFALLS independently identified Option D as superior on storage-layout robustness (Option C's slot-probing breaks on Vyper / UUPS proxies / rebasing tokens), multi-chain coverage (Option C is verifiably ETH-mainnet-and-Sepolia-only on Infura/MetaMask; BSC support is unconfirmed), and integration ergonomics (one ~80-line `.sol`, one Hardhat Ignition module, deployed once per chain at ~$2-5 gas). FEATURES did not pick a side architecturally but identified the table-stakes feature — buy/sell **roundtrip** simulation that exercises the token's `_transfer` hook in BOTH directions — which Option D delivers natively while Option C requires extra care to do correctly.

**Key risks** are concentrated in two places: (1) regressing into the V3 vacuous-pass pattern during the rebuild — mitigated by changing safety-check return types from `Promise<boolean>` to a discriminated union with explicit `unknown`-as-fail-closed; and (2) anti-rug false positives cascading into portfolio-wide panic-sells on legitimate LP movements (V2→V3 migrations, lock contracts, multisig transfers) — mitigated by multi-signal triggers, an allowlist of safe destinations, and confirm-after-N-blocks delay before exit fires. The bot is **live with real money today** and the sell-sim is broken; v6.17 must ship safely-correct, not fast-and-incomplete.

---

## Key Findings

### Decision: Option C vs Option D — Closed (D)

The lead architectural question from `HONEYPOT-SIM-BRIEFING.md` was: should the rebuilt honeypot detector use `eth_simulateV1` with state overrides on a public RPC (Option C), or deploy a self-controlled checker contract called via `eth_call` (Option D)?

**Decision: Option D primary, Option C as opt-in fallback.** Convergent rationale across STACK, ARCHITECTURE, PITFALLS:

| Dimension | Option C verdict | Option D verdict |
|-----------|------------------|------------------|
| Multi-chain coverage | MetaMask/Infura: "Mainnet and Sepolia only"; BSC/Base/Arb unverified per-provider | Plain `eth_call` against deployed contract works on every RPC at every tier |
| Storage-layout robustness | Brittle — fails on Vyper, UUPS proxies, rebasing tokens, diamond proxies; can silently devolve into vacuous-pass-with-extra-steps | Storage-agnostic — exercises the token's own `_transfer` hook |
| Round-trip discipline | Requires `eth_simulateV1` (not `eth_call+stateOverride`) to chain buy→sell with state diff | Native — buy→sell in one transaction with revert-at-end rollback |
| New deps | Zero (ethers v6 `provider.send(...)` already supports the call) | Zero (Hardhat 2.26 + OZ contracts ^5.4.0 already in `package.json`) |
| Implementation surface | ~80-150 LOC + per-chain RPC adapters + slot-probing fallback | ~80 LOC Solidity + ~30-50 LOC ethers wrapper + one Ignition module per chain |
| One-time cost | Tier verification per chain + per-provider | ~$2-5 gas × 4 chains = ~$10-20 once |
| Auditability | Operator can't audit ethers↔RPC-provider state-override semantics | 80 lines of Solidity, public-verified on Etherscan/BscScan |

ARCHITECTURE supports the dispatch layer for both: extend `ChainConfig` with `honeypotChecker: { deployedAddress, method: 'on-chain-contract' | 'eth_simulateV1' }` and switch internally in `src/utils/honeypot/index.ts`. Build D first; add C if a chain's deployment path is genuinely blocked (none currently are).

### Recommended Stack

**Stack delta from v6.16 is minimal — no new npm packages.** The v6.16 stack already covers ~95% of v6.17. Only one new first-party artifact: `contracts/HoneypotChecker.sol`. See `.planning/research/STACK.md` for full version compatibility matrix.

**Core technologies (unchanged from v6.16):**
- `ethers@6.16.0` — RPC, signing, ABI, event subs; supports `provider.send('eth_call', [tx, blockTag, stateDiff])` and `provider.send('eth_simulateV1', [...])` natively. **6.16.0 is current latest npm release; no upgrade.**
- `hardhat@2.26.0` — Solidity compile + Ignition deploy for `HoneypotChecker.sol`. **Stay on 2.x.** Hardhat 3.4.2 is a complete rewrite (ESM-first, Node 22-required, `compile`→`build`); migration is out of scope for v6.17.
- `@openzeppelin/contracts@^5.4.0` — `IERC20` for the new checker contract. Already a dep.
- `better-sqlite3@^12.8.0` — schema migration v4→v5 adds one new `lp_baseline` table for anti-rug LP snapshots. Additive only.
- `pino@^10.3.1` — structured logging for new safety/anti-rug paths; child-loggered per module.
- `vitest@^4.1.1` — fork tests for the checker contract; 37 prior `.todo` exit-engine stubs (status disputed — see Gaps).
- `ws@^8.20.0` — already a top-level dep; used directly for ping/pong heartbeat on `WebSocketProvider` since ethers v6 has **no built-in heartbeat** (open issue ethers-io/ethers.js#1053).

**One new on-chain artifact (first-party):**
- `HoneypotChecker.sol` — ~80-line Solidity contract; deploys once per chain via `npx hardhat ignition deploy`. Stores no state; reverts at end of round-trip to roll back; called via `eth_call` from `src/utils/honeypot/checkerContract.ts`.

**Explicitly NOT used:** Hardhat 3.x (rewrite scope), Tenderly Simulation API (paid third-party on hot path), `eth_simulateV1` as primary (multi-chain coverage gaps), `viem` (6-month rewrite), `dotenv-vault` / `dotenv-expand` (current `dotenv@17.2.0` sufficient), third-party deployed honeypot checkers (e.g., honeypot.is's contract — adds external dependency without independent signal beyond the parallel HTTP-API bank already in place).

### Expected Features

Categorized per v6.17 PROJECT.md scope (HONEY, ANTIRUG, EXIT-LIVE, OPS-LIVE, DEBT). See `.planning/research/FEATURES.md` for full per-category landscape, dependencies, and competitor matrix vs Banana Gun / Maestro / honeypot.is.

**Must have (table stakes), per category:**

*HONEY (pre-buy safety stack rebuild):*
- Buy/sell **roundtrip** simulation that exercises `_transfer` in BOTH directions (the rebuild's defining feature; Option D natural)
- Per-token buy-tax + sell-tax extraction as **numerical bps**, not boolean
- Whitelist-only-buys / "anti-snipe" detection (falls out of roundtrip naturally)
- Transfer-pause / `tradingEnabled=false` audit (exists today; verify behaviorally rather than via method-name probing)
- Max-tx / max-wallet limit detection (exists today; audit pass for `amountIn=0`-family bugs)
- Failure-direction discipline: every gate fails CLOSED, every gate has a discriminated-union return type with explicit `unknown`

*ANTIRUG (DETECT-02 runtime monitoring):*
- `Pair.Burn` event subscription per open position (V2)
- LP-token `Transfer(_, to=0xdEaD, _)` subscription (alternative rug pattern)
- Large LP withdrawal threshold (default 50% of pre-event LP supply)
- Frontrun-exit triggering: emergency `executeFullSell` with elevated gas
- Rate limit on auto-exit triggers (one-shot per position)
- Failure-direction discipline: WS disconnect ≠ rug signal (don't auto-exit on missing data)

*EXIT-LIVE (the 6 deferred v6.16 human-verification items):*
- Live exit-poll cycle telemetry (5s budget tracked per cycle)
- State-persistence-across-restart automated test (currently manual)
- Real sell `amount_out` non-null on live mainnet (validate receipt decoder end-to-end)
- Real Flashbots tx-hash on mainnet (bundle hash ≠ tx hash; capture mined tx)
- Dashboard WebSocket position-update verification in browser
- Live price/Telegram/chain-restart warnings on real boot

*OPS-LIVE (going-live ops hardening):*
- Wallet balance pre-flight check at startup (FATAL on undercut, never warn-and-continue)
- RPC health check (chainId + latest-block-age + WS reachability)
- MEV connectivity health check (Flashbots / bloXroute auth / private mempool)
- Stale-data warnings (positions > 2× poll-interval since last update)
- Env-validation messaging upgrades + cross-variable rules (`MEV_STRATEGY=flashbots → FLASHBOTS_AUTH_KEY required`)
- Formalized runbook (move `GOING-LIVE.md` → `docs/operations/going-live.md` atomic-with-delete)

*DEBT (tech debt cleanup):*
- Retroactive Nyquist validation on 9 phases (01, 02, 03, 05, 06, 07, 08, 09, 10) — note: validation must include one production-relevant assertion per phase, not just "tests pass"
- 37 `.todo` exit-engine test stubs filled with real assertions (claim-of-completion is **disputed** — see Gaps)
- 6 TS annotation errors in dashboard API routes (claim-of-cleanness is **disputed** — see Gaps)
- Diagnostic console.log cleanup (telegramListener.ts:55,61; db.ts:215)

**Should have (differentiators):**
- Numerical buy/sell tax extraction with per-chain configurable thresholds
- Structured simulator output (object, not bool) — enables dashboard/Telegram reasons-for-skip
- Multi-amount tax probe (1% / 50% / 100% of position) to catch amount-varying taxes
- N-of-M consensus across simulator + 2 third-party APIs (own-sim has veto)
- `npm run preflight` script (run all startup checks without starting bot)
- `npm run pause` / `npm run resume` scripts (kill-switch automation)

**Defer to v6.18+ (out of scope):**
- Aggregated rug-signal scoring (need real-world signal frequency data first)
- Synthetic canary-trade monitor (high cost; defer until pre-buy proven safe)
- Tax-change detection on open positions (differentiator if scope tight)
- Owner-blacklist-self detection (multi-address simulation differentiator)
- Mempool-aware anti-rug (DETECT-01 mempool sniping is offensive milestone)
- Bytecode static analysis (mutable-tax-setter / owner-renunciation flagging) — flagged as a gap by PITFALLS but not budgeted for v6.17
- Owner-renunciation / tax-setter-timelock checks (parallel-bank addition)
- CHAIN-05 dynamic capital allocation (offensive)

### Architecture Approach

**Integration architecture only.** The full v6.16 system architecture (orchestrator, chain registry, exit engine, persistence, dashboard) is unchanged. v6.17 adds three new modules and extends two existing ones, all respecting the v6.16 chain-registry / strategy-dispatch / single-exit-loop pattern. See `.planning/research/ARCHITECTURE.md` for full integration diagrams and code-level wiring.

**Major components (net new):**

1. **`src/utils/honeypot/`** — dispatch layer (`index.ts`), Option-D wrapper (`checkerContract.ts`), Option-C fallback (`simulator.ts`), shared `types.ts` with discriminated-union `HoneypotResult`. Replaces broken `simulateSellForChain` / `simulateSellV3ForChain` in `tokenSafety.ts:555-630`. Slots into `bot.ts:220-226` (V2) and `bot.ts:411-416` (V3) **in-place** — preserves the FIX-04 "always-on hard block before parallel bank" semantic; the parallel bank itself (lines 229-238) is unchanged.

2. **`contracts/honeypot/HoneypotChecker.sol`** + **`ignition/modules/HoneypotChecker.ts`** + **`scripts/deploy-honeypot-checker.ts`** — Solidity round-trip checker, declarative deploy, per-chain deploy script. Deployed addresses get hardcoded into `CHAIN_TEMPLATES` (one new field: `honeypotChecker: { deployedAddress, method }`).

3. **`src/anti-rug/`** — `detector.ts` (per-position WS subscription with **single-listener-per-chain** pattern), `exitTrigger.ts` (bridge to `exitEngine.executeFullSell` with elevated gas), `lpBaseline.ts` (snapshot LP reserves at buy + persist). New module, **not** folded into `src/exit-engine/` — exit engine is poll-driven (5s), anti-rug is event-driven (<1 block); different lifecycles.

4. **`src/preflight.ts`** — startup-time fail-fast gate called from `startMultiChainBot` BEFORE chain context creation. Wallet balance, DB schema, honeypot-checker code-at-address (Option D), `eth_simulateV1` capability probe (Option C), stale-data warnings.

5. **Schema migration v4→v5** in `src/utils/db.ts` — adds one `lp_baseline` table (`trade_id`, `pair_address`, `token0_reserve`, `token1_reserve`, `lp_total_supply`, `snapshot_ts`). Additive only; existing tables unchanged.

**Major extension to `src/exitEngine.ts`:** the `reason` field of `executeFullSell` extends from `'trailing-stop' | 'stop-loss' | 'urgency-market-sell'` to include `'anti-rug'`. The new reason triggers an **elevated-gas** path (default 2.0× normal multiplier; per-chain configurable via env). The anti-rug detector calls `executeFullSell` rather than submitting transactions directly — reuses sell lock, receipt decoding, DB cleanup, Telegram alerts.

**Architectural patterns enforced:**
- Strategy dispatch via `ChainConfig` (no `if (chainName === 'eth')` branches outside the registry)
- Defense in depth: pre-buy roundtrip simulator + parallel HTTP API bank + runtime LP-event monitor
- Reuse existing sell path (anti-rug bridges to `executeFullSell`, doesn't parallel it)
- Extend schema additively (never ALTER existing CHECK constraints)
- Single-listener-per-chain for WS events (NOT per-position; per-position leaks subscriptions and hits Alchemy free-tier cap of ~10)

### Critical Pitfalls (Top per Category)

22 pitfalls were catalogued in `.planning/research/PITFALLS.md`. The 1-2 highest-leverage per category:

*HONEY/SAFETY:*
- **#1 Vacuous-pass regression** — early-return `return true` on RPC error / unknown state, repeating the V3 bug. Mitigation: change return type to `Promise<{ verdict: 'safe' | 'unsafe' | 'unknown', evidence/reason }>` so vacuous pass is unrepresentable in the type system; PR-review rule that every `return safe` must be preceded by evidence the actual safety behavior was exercised.
- **#6 Sell-direction-only honeypot** — implementer interprets "sell-sim" as "simulate sell only" rather than "buy-then-sell roundtrip"; new check covers sell-side gap but inherits a buy-side gap. Mitigation: rename `simulateSell*` → `simulateBuySellRoundtrip*`; reviewers reject any sell-only PR; tests assert a buy-only-honeypot (allows buy, blocks sell) is caught.

*ANTIRUG:*
- **#8 False-positive cascading panic-sells** — naive single-event filter triggers on V2→V3 migrations, lock contracts, multisig transfers, partial rebalances. Mitigation: multi-signal trigger ((a) >50% LP removed + (b) destination not in allowlist of well-known lockers/multisigs/burn addresses + (c) reserves drop below sell-threshold), confirm-after-1-2-blocks delay, position-by-position evaluation (don't propagate panic across portfolio), circuit-breaker after N triggers per chain, **dry-run mode for first 7 days** to log "would-have-sold" against actual outcomes before going live.
- **#10 WS subscription resource leaks** — per-position listeners (4 chains × 10 positions × 2 events = 80 subs) hit Alchemy free-tier cap silently; reconnects don't auto-resubscribe; no backfill on reconnect window. Mitigation: **single-listener-per-chain pattern** (subscribe once at chain level, dispatch internally); explicit teardown on `closePosition`; heartbeat + reconnect-with-resubscribe + backfill via `getLogs` over `(lastSeenBlock, currentBlock)`.

*EXIT-LIVE:*
- **#11 Fork tests pass but real mainnet behaves differently** — central pitfall of the entire EXIT-LIVE category. Forks have no mempool, no MEV competition, different gas estimation, no real RPC errors. Mitigation: each of the 6 deferred items needs a **real-mainnet artifact** (Etherscan tx hash + dashboard screenshot + log excerpt) in `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md`; "test passing" is not closure.
- **#12 Real-mainnet test footgun** — shared `.env` causes a fork test to send a real tx, or a real-mainnet test runs against Sepolia and incorrectly closes the item. Mitigation: hard chainId guard + `ALLOW_REAL_MAINNET=1` gate + dedicated test wallet (not prod wallet) + naming convention (`*.fork.test.ts` vs `*.real-mainnet.test.ts`).

*OPS-LIVE:*
- **#14 Wallet balance pre-flight that fails open** — try/catch around RPC errors that warn-and-continue, leaving bot unfunded and silently failing every snipe. Mitigation: fail-CLOSED on pre-flight RPC failure (exit non-zero); bounded retry budget (3 × 5s); per-chain threshold from `chainRegistry.ts`; **periodic re-check** during operation (not just at startup); loud Telegram alert on halt.
- **#18 Kill switch that doesn't actually kill** — pause flag checked once at entry to `handleNewPairForChain` but in-flight executions don't re-check. Operator presses pause; position opens 30s later. Mitigation: multi-stage flag re-check (post-safety-bank, post-bundle-build, post-MEV-submit); SIGTERM-after-5s as hard-kill alongside SIGINT graceful; document pause-vs-cancel distinction; persist pause state to SQLite (don't lose on restart).

*DEBT:*
- **#19 Retroactive validation rubber-stamps original bugs** — running `/gsd-validate-phase` against existing tests-passing state confirms the existing claim rather than re-deriving the requirement (FIX-04 was marked complete in v6.16 but actually broken; rubber-stamping it makes the bug "validated"). Mitigation: validation must include one production-relevant assertion per phase ("does this prevent the harm we said it would?"); for requirements where the original is suspected broken (FIX-04, V3-03), do NOT retroactive-validate — re-open the requirement, address as part of v6.17, validate at fresh-implementation time.
- **#20 Hollow `.todo` test fills** — `expect(true).toBe(true)` to remove the `.todo` mark without testing behavior. Mitigation: each filled test asserts at least one observable effect (DB row, mock argument, log line, coverage delta); PR review template includes "no hollow assertions"; `.skip` with reason is acceptable when unit-test value is genuinely low; lint rule against `expect(true)`.

---

## Watch Out For (Top 7 Critical Pitfalls Overall)

The highest-leverage pitfalls across the entire milestone, ordered by blast radius:

1. **Vacuous-pass regression in HONEY rebuild (#1)** — repeats the bug being fixed. Bot loses ETH to honeypots in production.
2. **HONEY rebuild ships sell-only sim instead of roundtrip (#6)** — silently no marginal information beyond the existing buy-sim. Catches sell-blocks but misses subtler honeypot patterns.
3. **ANTIRUG cascading false-positive panic-sells (#8)** — single-event trigger on a high-volatility day exits multiple healthy positions at the bottom of normal volatility. Realized losses from "defense."
4. **WS subscription leaks in ANTIRUG (#10)** — per-position listeners hit free-tier cap silently; reconnects don't auto-resubscribe; bot is "monitoring" while events are dropped on the floor.
5. **EXIT-LIVE deferred items closed by more fork tests, not real-mainnet artifacts (#11)** — the central pitfall of EXIT-LIVE. Closes the audit while leaving the underlying gap unverified.
6. **OPS-LIVE wallet preflight fails open (#14)** — bot starts unfunded, every snipe fails for hours, operator notices nothing. The opposite of v6.16's chainId-mismatch hard-fail pattern.
7. **OPS-LIVE kill switch doesn't kill in-flight buys (#18)** — operator presses pause, position opens 30s later. Real money committed against operator intent.

Also escalating but not in the top 7: storage-slot probing (Option C if chosen, #2), `eth_simulateV1` provider gaps (#3), checker contract reentrancy attack surface (#4), retroactive validation rubber-stamping bugs (#19).

---

## Implications for Roadmap

Five v6.17 capability bundles map cleanly to phases. Build order is constrained by dependencies (HONEY and ANTIRUG both extend `ChainConfig`; ANTIRUG consumes HONEY's checker pattern), but Stage 1 foundations parallelize.

### Phase 17: Tech Debt Cleanup (DEBT) + Foundations
**Rationale:** No inter-dependencies; clears the audit deck before substantive feature work; **also a CI-discovery pass** to settle the disputed status of `.todo` stubs and TS errors (see Gaps). Includes runbook move (atomic with root-file delete) and env-var error-message upgrade.
**Delivers:** `tsc --noEmit` clean, `find test/ -name '*.todo*'` empty (or honest accounting of remaining stubs), diagnostic logs converted to structured `log.debug`, `docs/operations/going-live.md` in place with CI guard against root-recreation, env validator points to runbook.
**Avoids pitfalls:** #17 (runbook drift), #19 (rubber-stamp validation), #20 (hollow stubs), #21 (`as any` suppression), #22 (dead-code-removal breaks dependency).
**Research flag:** SKIP (well-understood code edits; standard cleanup patterns).

### Phase 18: Honeypot Detection Rebuild (HONEY)
**Rationale:** **Most critical and most foundational.** Bot cannot snipe any V2 token today; pre-buy safety is the gating capability for everything else. ANTIRUG's tax-change detection (deferred but feature dependency exists) consumes the same simulator. Must be the first substantive feature phase.
**Delivers:** `contracts/HoneypotChecker.sol` deployed on ETH (other chains follow), `src/utils/honeypot/` dispatch + Option-D wrapper, `bot.ts:220-226` and `bot.ts:411-416` replaced in-place with `simulateHoneypot` call, discriminated-union `HoneypotResult` type, structured logging of buy/sell tax bps + revert reason. Existing parallel bank unchanged; new gate runs **before** the bank as defense-in-depth.
**Architecture decision (CLOSED):** Option D primary, Option C as opt-in fallback. Architecture, Stack, and Pitfalls all converged.
**Avoids pitfalls:** #1, #2 (skip slot-probing entirely by default), #3 (Option D works on every RPC), #4 (audited Solidity vs unaudited stateOverride dynamics), #5 (numerical bps + multi-amount probe), #6 (roundtrip enforced by contract design), #7 (checker-in-buy-tx can eliminate sim-vs-buy race).
**Research flag:** **YES — needs `/gsd-research-phase` for the Solidity contract design specifically.** Reentrancy guards, gas-griefing protection, attack-surface review, Slither/Mythril audit before mainnet deploy. Also research multi-amount probing pattern (#5) and `tx.origin`-spoofing mitigation (#4).

### Phase 19: Anti-Rug Runtime Monitoring (ANTIRUG)
**Rationale:** Depends on HONEY for the `ChainConfig` extension pattern; logically the next defensive layer once pre-buy is solid. ANTIRUG's exit path bridges to `exitEngine.executeFullSell` (existing v6.16) with elevated gas, so doesn't require EXIT-LIVE first. Schema migration v4→v5 (lp_baseline table) is additive and isolated.
**Delivers:** `src/anti-rug/{detector,exitTrigger,lpBaseline}.ts`, `Pair.Burn` + LP `Transfer-to-0xdEaD` subscriptions per open position (using **single-listener-per-chain** dispatch pattern), `executeFullSell` reason union extended with `'anti-rug'`, frontrun-exit elevated gas path, allowlist of well-known lockers/multisigs (Unicrypt, TeamFinance, PinkLock), confirm-after-N-blocks delay, circuit breaker after N triggers per chain, **dry-run mode for first 7 days** before flipping to live execution.
**Avoids pitfalls:** #8 (multi-signal + allowlist + confirm-delay + dry-run), #9 (panic-fee budget + multi-builder submission + circuit breaker), #10 (single-listener-per-chain + reconnect-resubscribe-backfill).
**Research flag:** **YES — needs `/gsd-research-phase`** for: (a) reconnect-and-resubscribe-and-backfill pattern in ethers v6 with `WebSocketProvider` (#10 specifically); (b) frontrun racing dynamics on each chain (Flashbots vs bloXroute vs Base/Arb sequencer-ordered) and realistic success-rate baselines; (c) LP locker contract address discovery for the allowlist (Unicrypt/TeamFinance/PinkLock canonical addresses per chain).

### Phase 20: Going-Live Ops Hardening (OPS-LIVE)
**Rationale:** Depends on HONEY-01 (`ChainConfig.honeypotChecker`) because preflight verifies the checker code-at-address. Otherwise independent of ANTIRUG. Quick-cycle phase; mostly small wired-correctly modules.
**Delivers:** `src/preflight.ts` (wallet balance hard-fail, RPC health, MEV connectivity, honeypot checker code-at-address, `eth_simulateV1` capability probe if Option C in use, stale-data warnings), env-validation cross-variable rules + loud-defaults + refuse-on-dangerous-combos, `npm run preflight` / `npm run pause` / `npm run resume` scripts, multi-stage kill-switch flag re-check in `handleNewPairForChain`, persist pause state to SQLite, dashboard banner during graceful shutdown.
**Avoids pitfalls:** #14 (fail-CLOSED preflight), #15 (cross-variable env rules), #16 (tiered severity for stale-data warnings; baseline-measure-before-tune), #18 (multi-stage kill-switch).
**Research flag:** SKIP (standard production-engineering patterns; no novel research needed beyond what's already in PITFALLS.md mitigations).

### Phase 21: Exit-Engine Live-Runtime Hardening (EXIT-LIVE)
**Rationale:** Independent of HONEY/ANTIRUG/OPS-LIVE in the code-path sense (different files), but **logically last** because the verifications it produces are tested against the new HONEY/ANTIRUG/OPS-LIVE code paths. Closes the 6 deferred v6.16 human-verification items as real test artifacts.
**Delivers:** `test/fork/{smokeHarness,exitResume,receiptDecoder.fork,chainRestart,dbMigration}.test.ts`, `scripts/capture-launch.ts` + `test/fork/fixtures/realLaunches/*.json`, pino log enrichment with `op` field on exit-engine paths, `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` with **real-mainnet artifacts** (Etherscan tx hashes + dashboard screenshots + log excerpts) for each of the 6 deferred items. Includes the chainId guard + `ALLOW_REAL_MAINNET=1` gate test infrastructure.
**Avoids pitfalls:** #11 (real-mainnet artifacts, not more fork tests), #12 (chainId guard), #13 (DB-receipt-decoded amount as ground truth, not instrumented metrics).
**Research flag:** SKIP (verification work uses existing v6.16 patterns; the heavy lifting is the artifacts, not the test code).

### Phase Ordering Rationale

- **DEBT first** — clears the audit, settles disputed-status questions via CI before substantive work, low risk, parallel to nothing.
- **HONEY before ANTIRUG** — both extend `ChainConfig`; HONEY establishes the extension pattern; ANTIRUG's tax-change-detection differentiator (deferred but on the radar) consumes HONEY's simulator.
- **OPS-LIVE after HONEY** — preflight verifies checker code-at-address; needs `ChainConfig.honeypotChecker` field present.
- **OPS-LIVE before EXIT-LIVE** — verification artifacts exercise the OPS-LIVE preflight and pause paths; want them in place first.
- **EXIT-LIVE last** — closes the v6.16 audit using the v6.17 surface as the test bed.
- **ANTIRUG and OPS-LIVE could run in parallel** if developer capacity allows — they touch different code areas (anti-rug/ vs preflight.ts, config.ts).

### Research Flags

Phases needing deeper `/gsd-research-phase` during planning:

- **Phase 18 (HONEY)** — Solidity contract design (reentrancy, gas-griefing, attack surface), multi-amount tax-probing pattern, `tx.origin`-spoofing mitigation, security-audit gating before mainnet deploy. Solidity-specific research is light on the existing PITFALLS.md.
- **Phase 19 (ANTIRUG)** — ethers v6 WebSocket reconnect-resubscribe-backfill pattern (open issue ethers-io/ethers.js#1053; vendor docs reference but no canonical solution in our codebase), per-chain frontrun racing dynamics + realistic success rates, LP locker contract address inventory (Unicrypt/TeamFinance/PinkLock per chain).

Phases with standard patterns (skip research-phase):

- **Phase 17 (DEBT)** — well-understood code edits.
- **Phase 20 (OPS-LIVE)** — standard production-engineering patterns; preflight, env validation, kill-switch all have established implementations.
- **Phase 21 (EXIT-LIVE)** — verification work using existing v6.16 patterns.

### Parallelism Opportunities

- **Phase 17 (DEBT)** is fully parallel to anything else; can run alongside Phase 18 if cleanup is split between developers.
- **Phase 19 (ANTIRUG) and Phase 20 (OPS-LIVE)** can run in parallel after Phase 18 lands (different files, only shared dependency is the `ChainConfig` extension which Phase 18 commits).
- Within Phase 18, **`HoneypotChecker.sol` authoring + ethers wrapper + dispatch layer** can be three short parallel tracks once the discriminated-union type is committed first.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Context7 + npm registry verification + multi-source corroboration on `eth_simulateV1` coverage gaps; Hardhat 3 migration scope confirmed against official migration guide. STACK.md cites HIGH-confidence on every load-bearing decision. |
| Features | HIGH | Multiple converging sources (honeypot.is + GoPlus + valamidev open-source contract + USENIX 2019 academic taxonomy + Maestro/BananaGun published feature lists + arxiv 2206.08202). Industry consensus on the table-stakes set is clear. Differentiators are extrapolations from commercial patterns and rated MEDIUM by FEATURES.md. |
| Architecture | HIGH | Direct code-read verification of every load-bearing line reference (`bot.ts:220-226`, `tokenSafety.ts:555-630`, `exitEngine.ts:805-866`, etc.); integration design respects v6.16 patterns. Integration mechanics solid; only the disputed-status DEBT items pull the overall confidence down marginally (see Gaps). |
| Pitfalls | HIGH | 22 pitfalls cross-referenced against codebase + briefing + external sources (eth_simulateV1 coverage, V2 LP-event detection, honeypot contract attack surface, ethers WebSocket reconnection). Owner non-negotiables explicitly traced to specific pitfalls. Recovery strategies and warning signs concrete. |

**Overall confidence:** HIGH

### Gaps to Address

1. **Tech debt status is contested between researchers and the v6.16 close audit.** ARCHITECTURE.md ran a grep for `\.todo(` against `test/` and got zero matches and ran `npx tsc --noEmit` and got no errors emitted — suggesting both the 37 `.todo` stubs and the 6 TS errors may already be resolved. PROJECT.md (and PITFALLS.md by reference) list both as outstanding tech debt. **Resolution: Phase 17 must verify-via-CI as its first task** — `find test/ -name '*.todo*' -print` and `npx tsc --noEmit` are the source of truth, not the v6.16-MILESTONE-AUDIT.md numbers. If the items are already resolved, Phase 17's scope shrinks to runbook-move + env-validation upgrade + diagnostic-log cleanup; the 9-phase Nyquist validation remains. **Do not blindly trust the v6.16 close audit numbers.**

2. **Mempool-aware anti-rug is deferred.** PITFALLS.md #9 notes that mempool-based detection is the only way to reliably frontrun a rug pull on chains where the deployer has informational advantage. v6.17 ships block-confirmed detection only — realistic frontrun success rate is documented as "loss minimization, not rug prevention" with 30-40% success when the deployer is fast. This is a **known limitation by design**; CHAIN-05 / DETECT-01 are the offensive milestone. Roadmap should set operator expectations explicitly.

3. **Bytecode static analysis (mutable-tax-setter / owner-renunciation flagging) is flagged but not budgeted.** PITFALLS.md #5 recommends scanning token bytecode for `setTax`, `setBuyTax`, `setSellTax`, `setMaxWallet`, `excludeFromFees` selectors as a parallel-bank addition; FEATURES.md's "Owner-renunciation check" / "Tax-setter-timelock check" lists the same gap. Not in the v6.17 MVP. Worth deciding during Phase 18 planning whether to fold a minimal version (selector-presence flag) into the parallel bank, or defer entirely.

4. **Synthetic monitor (canary-trade watchdog) is deferred.** PITFALLS.md #13 prescribes a synthetic-monitor pattern (separate watchdog process opens a tiny dummy position, verifies exit fires) as the strongest mitigation against telemetry-masks-issue. FEATURES.md classifies it as a P3 differentiator. Not in v6.17 MVP. The EXIT-LIVE phase relies on real-mainnet verification artifacts as the primary mitigation; synthetic monitor is the v2 follow-up.

5. **Owner-renunciation / tax-setter-timelock checks** are differentiator-level features called out in PITFALLS.md #5 and FEATURES.md but not in v6.17 MVP. Static check is cheap (one bytecode scan); decision deferred to Phase 18 planning.

6. **Threshold tuning** for ANTIRUG (50% LP-removal default) and stale-data warnings (95th-percentile baseline) require **operational data the bot doesn't have yet**. PITFALLS.md #16 prescribes 7 days of normal-operation baseline measurement before tuning thresholds; ANTIRUG's dry-run-for-7-days addresses the LP threshold. Roadmap should budget for a tuning pass in Phase 19/20 close, not assume defaults are correct.

7. **Per-chain `eth_simulateV1` capability matrix** for Option C fallback is uncertain on BSC/Base/Arbitrum (see STACK.md and PITFALLS.md #3). If Option C is ever activated for a chain, capability probe at startup is mandatory and per-chain. v6.17 should ship Option D on all chains; Option C is "build the dispatch layer, leave the implementation a stub or thin wrapper" until needed.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/websites/ethers_v6` — ethers v6 API for `provider.send('eth_call', [tx, blockTag, stateDiff])` and `provider.send('eth_simulateV1', [...])` confirmed
- [npm: ethers](https://www.npmjs.com/package/ethers) — version 6.16.0 confirmed latest
- [npm: hardhat](https://www.npmjs.com/package/hardhat) — version 3.4.2 latest; pinned at 2.26.0 for stability
- [MetaMask/Infura `eth_simulateV1`](https://docs.metamask.io/services/reference/ethereum/json-rpc-methods/eth_simulatev1/) — "Supported Networks: Mainnet and Sepolia only" — source of the BSC/Base/Arb caveat
- [ethers-io/ethers.js#2393](https://github.com/ethers-io/ethers.js/discussions/2393) — exact state-diff syntax for ethers v6
- [ethers-io/ethers.js#1053](https://github.com/ethers-io/ethers.js/issues/1053) — confirms ethers v6 has no built-in WS heartbeat
- [Uniswap V2 Pair.Burn / Sync events](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol) — event signatures verified
- [valamidev/web3-defi-honeypot-and-slippage-checker](https://github.com/valamidev/web3-defi-honeypot-and-slippage-checker) — open-source reference checker contract
- [Hardhat 3 migration guide](https://hardhat.org/docs/migrate-from-hardhat2) — confirms breaking nature of 3.x
- [USENIX Security 2019 — Demystifying Honeypots](https://www.usenix.org/system/files/sec19-torres.pdf) — academic honeypot taxonomy
- [arxiv 2206.08202 — Token Spammers, Rug Pulls, Sniper Bots](https://arxiv.org/html/2206.08202v3) — defines "rug" threshold
- [honeypot.is methodology](https://honeypot.is/ethereum) and [GoPlus methodology](https://goplussecurity.medium.com/dive-into-token-code-and-safeguard-web3-security-b7960a34a8fe) — published detection methodologies
- [Maestro anti-rug docs](https://docs.maestrobots.com/faq/smart-rug-auto-sell) and [Banana Gun docs](https://docs.bananagun.io/) — competitor anti-rug feature matrices
- Direct code reads: `src/bot.ts`, `src/utils/tokenSafety.ts`, `src/exitEngine.ts`, `src/chainRegistry.ts`, `src/config.ts`, `src/utils/db.ts`, `HONEYPOT-SIM-BRIEFING.md`, `GOING-LIVE.md`, `.planning/PROJECT.md`

### Secondary (MEDIUM confidence)
- [Alchemy `eth_simulateV1`](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-simulate-v-1), [QuickNode docs](https://www.quicknode.com/docs/ethereum/eth_simulateV1) — provider docs lag actual coverage; tier requirements not always specified
- [Chainstack: redundant event listeners](https://docs.chainstack.com/docs/ethereum-redundant-event-llstener-ethers-web3js) — vendor-doc but pattern widely reproduced
- [Tenderly Simulations docs](https://docs.tenderly.co/simulations) — pricing not retrievable from public pages
- [MEXC Best Crypto Sniper Bots 2026](https://www.mexc.com/en-GB/news/1012768) and [TechBullion 2026 ranking](https://techbullion.com/best-crypto-sniper-bots-in-2026-ranked-by-speed-safety-and-what-you-actually-keep/) — industry landscape; ranking publications
- [Cyberfoxx 2025 Smart Contract Hacking Guide](https://cyberfoxx.medium.com/smart-contract-hacking-a-to-z-a-real-world-guide-2025-1c58d6b04595) — owner-blacklist-self pattern
- [BuildBear Practical Guide on Honeypot Attacks](https://medium.com/buildbear/a-practical-guide-on-honeypot-attacks-in-smart-contracts-c67835028ba7) — modern (2026-era) evasion patterns

### Tertiary (LOW confidence — needs validation during planning)
- Per-chain `eth_simulateV1` support across Alchemy/Infura/QuickNode/public-RPC tiers — provider docs lag actual coverage
- Anti-rug differentiators (multi-address sim, rug-score) — extrapolations from commercial bot patterns; not directly cited in literature
- Frontrun racing dynamics realistic success rates (#9) — Maestro publishes "highly consistent on Ethereum" but no measured rate; need own measurement during ANTIRUG dry-run
- LP locker contract canonical addresses per chain (Unicrypt, TeamFinance, PinkLock) — needs verification at Phase 19 planning time
- Tech debt status of `.todo` stubs and TS errors — **disputed; verify via CI in Phase 17**

---

*Research completed: 2026-04-29*
*Ready for roadmap: yes*
*Architecture decision (Option C vs D): CLOSED — Option D primary, Option C opt-in fallback*
