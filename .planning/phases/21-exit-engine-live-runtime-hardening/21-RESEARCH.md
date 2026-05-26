# Phase 21: Exit-Engine Live-Runtime Hardening - Research

**Researched:** 2026-05-26
**Domain:** Live-mainnet verification artifacts + test/observability hardening for an existing (shipped v6.16) exit engine on a real-capital ETH bot
**Confidence:** HIGH (this is a verification/hardening phase; every claim below is grounded in file:line code evidence from the actual repo, not external libraries)

## Summary

Phase 21 is a **verification + hardening** phase. It does NOT change exit-engine behavior — that engine shipped in v6.16 (`src/exitEngine.ts`). It (a) closes 6 deferred human-verification items with REAL-MAINNET artifacts, (b) adds the test-safety gate (`chainId===1` tripwire + `ALLOW_REAL_MAINNET` decorator), (c) builds the `realLaunches/` fork-fixture regression net + `scripts/capture-launch.ts`, and (d) enriches `src/exitEngine.ts` with `op`-field logging (the engine has ZERO `op` fields today — `[VERIFIED: grep src/exitEngine.ts]`).

The single most important finding for the planner — the HIGH-PRIORITY open question — is **confirmed**: on ETH (chainId 1), `executeFullSell` routes the SELL leg through Flashbots. The full call chain is `exitEngine.executeFullSell` → `sendTxWithRetry(txBuilder, ctx, …)` → `createMevStrategy(ctx.chain)` → (ETH `mevStrategy:'flashbots'`) `FlashbotsMevStrategy.sendTransaction` → `flashbotsProvider.sendBundle(...)`. This means **a single ETH buy+sell roundtrip yields both EXIT-LIVE-03 (sell `amount_out`) and EXIT-LIVE-04 (Flashbots bundle→mined mapping)** — exactly as D-CHAIN-SINGLE-ROUNDTRIP requires. D-CHAIN-SINGLE-ROUNDTRIP is **CONFIRMED by code**, with two important nuances the planner must internalize (see Architecture and Open Questions): (1) the BUY records a placeholder `txHash:'mev_bundle'`, NOT a real hash — only the SELL records a real mined hash; (2) the Flashbots strategy currently returns ONLY the mined tx hash (`bundleTransactions[0].hash`), it does NOT surface `bundle.bundleHash` — so EXIT-LIVE-04's "bundle-hash → mined-tx-hash mapping" requires the planner to add an `op` log line that captures BOTH from the `FlashbotsTransactionResponse`.

Two doc-vs-code anomalies surfaced and are reconciled below: (1) the REQUIREMENTS HONEY-07/08 "Pending" traceability is a **stale doc** — both gates are live in `bot.ts:253` (V2) and `bot.ts:566` (V3); (2) EXIT-LIVE-07's "`schema_version` rows" wording is **wrong against the code** — the schema uses `PRAGMA user_version` (an integer pragma), there is NO `schema_version` table.

**Primary recommendation:** Treat this phase as four work-streams that share an op-taxonomy spine: (A) `op`-enrichment of `src/exitEngine.ts` (replicate the exact `antirug.*`/`killswitch.cp*` logger shape) — this unblocks the telemetry every artifact references; (B) test-safety gate + fork harness extensions; (C) `scripts/capture-launch.ts` + 3 `realLaunches/` fixtures; (D) the live-capture run + `v6.17-VERIFICATION-EVIDENCE.md`. Do NOT add exit strategies or alter sell logic. Use the existing stack only — **no new npm packages are required** for this phase.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Live-sell capture strategy (EXIT-LIVE-03/04):**
- **D-CAPTURE-METHOD:** The bot **buys a hand-picked liquid/established safe token at minimum size via its real buy path**, then we capture *its exit*. The buy is just the means to obtain a position; this decouples buy-side risk from the sell-path evidence we actually need. NOT an organic snipe of a fresh launch (honeypot/timing risk on ~0.009 ETH), NOT a manual external buy.
- **D-CHAIN-SINGLE-ROUNDTRIP:** A **single ETH roundtrip captures both artifacts** — the buy gives the Flashbots bundle→mined mapping (EXIT-LIVE-04), the sell gives non-null `amount_out` (EXIT-LIVE-03). ETH is forced: Flashbots is ETH-only, and ETH is the only chain the bot can currently run end-to-end (HoneypotChecker not yet deployed on BSC/Base/Arb = HONEY-04, **out of this phase's scope**). The **sell must route through Flashbots** so the sell leg is itself a clean 04 artifact — *researcher to confirm `executeFullSell` → `sendTxWithRetry` uses the Flashbots MEV strategy on ETH.* → **CONFIRMED (see Open Question #1).**
- **D-NO-TOPUP:** **No wallet top-up.** Capture opportunistically at calm gas. Live conditions at discussion (2026-05-26): balance 0.00915 ETH, gas 0.82 gwei base → roundtrip ~$1-3. The position (~0.003 ETH) mostly returns on the sell; net spend is gas + slippage. **Abort the capture if gas has spiked** at capture time. Accept the expected, harmless **post-buy auto-pause** (after the 0.003 buy, balance dips below the 0.008 preflight floor → Phase 20 D-MID-RUN-CHECK flips global pause; exit monitors keep running, the sell still completes).
- **D-EXIT-TRIGGER:** Fire the sell by **configuring a take-profit/stop the position immediately satisfies**, so the exit engine's own 5s poll loop fires `executeFullSell` on the next cycle. Deterministic timing AND exercises the REAL exit-engine path (poll→evaluate→sell) — which is what the phase verifies. Captures EXIT-LIVE-03 + EXIT-LIVE-01 poll telemetry in one run. **NOT** the emergency-sell manual override (that bypasses the engine's own trigger logic).

**Real-mainnet test safety (EXIT-LIVE-08):**
- **D-CAPTURE-WALLET:** The Area-1 evidence capture runs as the **real production bot on its prod wallet** — the artifact's whole point is proving the PROD bot's exit works live (production-under-observation, not a "test"). EXIT-LIVE-08's "dedicated test wallet, NOT the prod wallet" rule therefore scopes to **the automated test suite only**, which must never load the prod key.
- **D-TEST-WALLET-FORKONLY:** The dedicated test wallet is **fork-only with zero real ETH** — a throwaway address used only for fork-impersonation signing. The prod key is never imported into any test. `ALLOW_REAL_MAINNET` stays a tripwire that is never actually crossed in normal operation (real capture runs as the prod bot directly, not via test infra).
- **D-GATE-BOTH-LAYERS:** Enforce the `chainId===1` / `ALLOW_REAL_MAINNET=1` guard via **both layers** — (a) a **global test-setup tripwire** that aborts the whole run if any test sees `chainId===1` without the gate (protects every test, including future ones that forget to opt in), plus (b) the **opt-in per-test decorator** the requirement names, as an explicit intent marker for any deliberate real-mainnet test. **CI never sets the gate.**
- **D-FORK-REHEARSAL:** **Rehearse the exact capture sequence on a mainnet-fork first** (bot-buy the chosen token → tight-threshold exit → verify `amount_out` + receipt decode + exit-engine trigger), confirm green end-to-end, THEN do the real run with **callStatic / `eth_callBundle` simulate-before-submit** at capture time. A local fork has no Flashbots relay, so the fork rehearsal de-risks everything *except* the Flashbots submission leg (covered by v6.16 FIX-09's tested retry path on the real run).

**Real-launch fixtures (EXIT-LIVE-09):**
- **D-FIXTURE-SELECTION:** **Hand-pick specific historical ETH launches by address** — tokens known to be safe + tradeable (passed the gate, real liquidity, no tax surprises) so the replay's buy lands and the full lifecycle runs. `capture-launch.ts` records each by token address + launch block (deterministic, guaranteed-green). NOT auto-discovery (would discard many honeypot/dead-LP launches first).
- **D-FIXTURE-EXITS:** The **3 fixtures each drive a DIFFERENT exit path** — e.g. full take-profit, partial-sell (the Phase 10/14 revenue path), and trailing-stop / age-weighted urgency — so the fixtures form a **regression net across the exit engine's branches**. The reject path stays covered by the existing `honeypots/` + `rugs/` fixtures (no reject-path launch added to `realLaunches/`).
- **D-FIXTURE-DEX:** **3 ETH fixtures spread across V2 and V3** so both DEX lifecycle paths in `handleNewPairForChain` are covered within the minimum count. (3 is the REQ minimum; expanding to a full V2×V3×exit matrix is deferred.)

**Evidence bar + op taxonomy (EXIT-LIVE-06/10/11):**
- **D-OP-CONVENTION:** Adopt the **dotted `exit.*` hierarchy, past-tense** (`exit.poll.cycle`, `exit.partial.executed`, `exit.full.executed`, `exit.flashbots.submitted`, `exit.receipt.decoded`, …). Matches the codebase's existing `antirug.*` / `killswitch.cp1` convention, success-criterion-4 (`exit.full.executed`), and industry best practice (Namespace.Object.Action); enables `op:exit.*` wildcard filtering. **Reword the conflicting REQUIREMENTS EXIT-LIVE-01 example** (`exit-poll-cycle` → `exit.poll.cycle`) during plan-phase — same pattern Phase 20 used to reword OPS-LIVE-02/06.
- **D-OP-DB-TRUTH:** **Comprehensive op coverage** across every meaningful exit-engine event for filtering — BUT the **ground truth for "an exit happened" is the DB receipt-decoded `amount_out` + the on-chain receipt, NEVER a log line or an instrumented try/catch metric** (success-criterion-4). Verification and the evidence artifacts assert against the DB/chain, not telemetry. Guards the telemetry-masks-issue failure mode.
- **D-INDUCE-RPC-DROP:** Capture EXIT-LIVE-06 (chain-restart warning) by **inducing the RPC drop deterministically** (point at a dead/unreachable RPC briefly, or a connection-drop proxy) — fast, repeatable, schedulable. EXIT-LIVE-05 (dashboard WS) **piggybacks on the Area-1 live capture** (the same on-chain event drives the position update); EXIT-LIVE-07 (migration log) is a deliberate **fresh-clone first boot**.
- **D-EVIDENCE-BAR:** **Strict ground-truth per item** — each artifact must show real, independently-verifiable evidence (a resolvable Etherscan tx hash, a DB row excerpt with the actual value, a pino excerpt with real fields, a timestamped browser screenshot). A fork-test pass alone NEVER closes an item. `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` (EXIT-LIVE-11) is the single source of truth.

**Carried-forward conventions:**
- **D-STOP-THE-LINE** [reaffirmed]: any bug surfaced during a capture or fixture replay **BLOCKS phase close** → escalates to a new requirement / decimal **phase 21.1**. Fix-in-flight and file-and-defer are both rejected.
- **D-ENV-EXAMPLE** [USER-BINDING]: every new env var (`ALLOW_REAL_MAINNET`, any test-wallet / capture-config vars, any archive-RPC var for `capture-launch.ts`) lands in `.env.example` with default + 1-line description.
- **D-ALERTS:** structured pino + Telegram for failures, with remediation pointers — same shape as Phase 18/20.
- **D-04 observable-effect rigor:** every new test asserts a concrete observable effect (DB row, pino field, process.exit code, on-chain receipt / tx hash) — no `expect(true).toBe(true)` hollow fills.
- **D-ROLLBACK:** no escape hatches; the test-safety gate has no bypass-in-prod-code path beyond the explicit `ALLOW_REAL_MAINNET` opt-in.

### Claude's Discretion

- `scripts/capture-launch.ts` CLI shape, output format, and the archive-RPC source — within "records PairCreated→Mint→first-Swap by address+block, deterministic replay."
- The exact set of `op` fields and where each fires — within the dotted `exit.*` convention + comprehensive coverage (D-OP-CONVENTION / D-OP-DB-TRUTH).
- EXIT-LIVE-02 SIGTERM-kill mechanism and fork-test structure — within "kills bot mid-cycle, verifies `exit_state` poll position identical pre/post restart."
- The budget-vs-actual poll-telemetry schema — within `{ op: 'exit.poll.cycle', positions, durationMs, budgetMs: 5000, overruns }`.
- How price action is driven to trigger the varied exits on fork replay (pool manipulation vs per-fixture threshold config).
- `v6.17-VERIFICATION-EVIDENCE.md` document structure — within "single source of truth, all 6 items, strict ground-truth artifacts" (follow the existing `.planning/milestones/v6.17-*.md` audit-doc shape).
- The global tripwire's RPC-detection mechanism (read `chainId` at fork setup).

### Deferred Ideas (OUT OF SCOPE)

- **Multi-chain live-artifact capture (BSC/Base/Arb)** — follows once HONEY-04 deploys HoneypotChecker on the other chains. The "split 03 onto a cheaper chain" option was rejected for Phase 21 specifically because it would pull HONEY-04 (Phase 18 scope) forward.
- **Small-funded dedicated test wallet** — rejected in favor of fork-only/zero-ETH (D-TEST-WALLET-FORKONLY).
- **Sepolia testnet rehearsal** — rejected (lower fidelity than a mainnet fork; no real Flashbots relay) in favor of D-FORK-REHEARSAL.
- **Expand `realLaunches/` to a full V2×V3×exit-trigger matrix (~5-6 fixtures)** — deferred; 3 (V2+V3 spread, varied exits) is the chosen minimum.
- **Synthetic canary-trade monitor (OPS-V2-01)** — stays v6.18+. Phase 21's D-OP-DB-TRUTH partially addresses the same telemetry-masks-issue risk for the exit path.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXIT-LIVE-01 | Live exit-poll cycle telemetry (budget-vs-actual vs 5s) | New `op:exit.poll.cycle` log wrapping `pollExitStrategy` (`exitEngine.ts:716`); budget = `exitConfig.pollIntervalMs` (`exitEngine.ts:116`, default 5000). Schema per discretion: `{op,positions,durationMs,budgetMs,overruns}`. Captured live during Area-1 run. |
| EXIT-LIVE-02 | Automated SIGTERM-restart `exit_state` persistence fork test | `exit_state` table (`db.ts:67-77`) persisted every cycle (`exitEngine.ts:757,819`); `gracefulShutdown` SIGTERM handler (`bot.ts:1354-1403`) clears timers + `closeDb()`; `resumeExitMonitor` (`exitEngine.ts:916`) reloads via `getExitState.get(tradeId)`. Test asserts persisted columns identical pre/post. **See Open Question #4 — "poll position" maps to HWM/trailing/tiers, NOT a literal poll counter.** |
| EXIT-LIVE-03 | Real-mainnet sell `amount_out` non-null artifact | `executeFullSell` → `decodeReceipt` (`exitEngine.ts:515`) → `trades.amount_out` (`insertTrade.run`, `exitEngine.ts:519-534`; column `db.ts:284`). Ground truth = DB row, per D-OP-DB-TRUTH. |
| EXIT-LIVE-04 | Flashbots bundle-hash→mined-tx-hash mapping artifact | `FlashbotsMevStrategy.sendTransaction` (`flashbots.ts:81` `sendBundle` → `:97` returns `bundleTransactions[0].hash`). **`FlashbotsTransactionResponse` exposes BOTH `bundleHash` AND `bundleTransactions[].hash` (lib `index.d.ts:41-46`) — current code surfaces only the latter.** Planner adds `op:exit.flashbots.submitted` logging both. See Open Question #1. |
| EXIT-LIVE-05 | Dashboard WS position-update screenshot | `server.ts:186-205` already broadcasts `positions_update` every 5s with live prices; dashboard renders it. **No new code** — observation only; piggybacks on Area-1 capture per D-INDUCE-RPC-DROP. See Open Question #7. |
| EXIT-LIVE-06 | Chain-restart warning on real RPC drop | WS reconnect path `bot.ts:856-884` (`'WebSocket disconnected … reconnecting'` / `'WebSocket reconnected'`); richer anti-rug WS health ops at `detector.ts` (`antirug.ws.disconnected` :872, `.reconnected` :932). Induce per D-INDUCE-RPC-DROP. Existing unit analog `test/unit/chainRestart.test.ts`. See Open Question #8. |
| EXIT-LIVE-07 | Fresh-clone SQLite + `.bot-state.json` migration log | `migrateSchema` (`db.ts:29-195`, PRAGMA `user_version`); `migrateJsonState` (`db.ts:203-248`, logs `'Migrated .bot-state.json to SQLite'`, renames to `.bak`). **ANOMALY: no `schema_version` table exists — it is `PRAGMA user_version`. Reword EXIT-LIVE-07.** See Open Question #5 / Anomalies. |
| EXIT-LIVE-08 | chainId guard + `ALLOW_REAL_MAINNET=1` gate; test wallet ≠ prod | Existing pattern `honeypotChecker.fork.test.ts:57-63` (`isHardhatFork`: `chainId !== 1 || ALLOW_REAL_MAINNET==='1'`). Prod-key load point: `chainRegistry.ts:1067` + `provider.ts:59` read `process.env.PRIVATE_KEY`. D-GATE-BOTH-LAYERS = global tripwire (in `test/fork/setup.ts`) + per-test decorator. |
| EXIT-LIVE-09 | `capture-launch.ts` + ≥3 `realLaunches/` fixtures replayed vs `handleNewPairForChain` | New script; archive-RPC = `ALCHEMY_URL` (`chainRegistry.ts:936`, `setup.ts:6`). Events: `FACTORY_ABI` PairCreated (`abis.ts:7`), V3 `PoolCreated` (`abis.ts:51`), Mint (`abis.ts:57`). CLI analog: `scripts/deploy-honeypot-checker.ts`. Fixture schema: extend `rugs/`+`honeypots/` JSON shape. See Open Questions #3, #6. |
| EXIT-LIVE-10 | Every exit-engine code path logs an `op` field | `src/exitEngine.ts` has ZERO `op` fields today (verified). Enumerate ~12 paths (see Architecture §op-surface). Replicate `antirug.*`/`killswitch.cp*` logger call shape. |
| EXIT-LIVE-11 | `v6.17-VERIFICATION-EVIDENCE.md` consolidated archive | Follow existing `.planning/milestones/v6.17-*-audit.md` shape (frontmatter + Methodology + per-item table + evidence links). Single source of truth per D-EVIDENCE-BAR. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Exit-poll telemetry (EXIT-LIVE-01) | Bot runtime (`exitEngine.ts` poll loop) | — | Telemetry must wrap the actual `setInterval` cycle that already exists at `exitEngine.ts:895`/`:968`. |
| `op`-field enrichment (EXIT-LIVE-10) | Bot runtime (`exitEngine.ts`) | — | Logs emit where the events happen; the engine owns sell/partial/poll/receipt paths. |
| `amount_out` ground truth (EXIT-LIVE-03) | Database (`trades` table) | Bot runtime (writes it) | D-OP-DB-TRUTH: the DB row is authoritative, never the log. |
| Flashbots bundle mapping (EXIT-LIVE-04) | MEV strategy (`flashbots.ts`) | Bot runtime (logs it) | The `FlashbotsTransactionResponse` lives in the strategy; the op-log that captures it lives at the `executeFullSell` confirm site. |
| Test-safety gate (EXIT-LIVE-08) | Test harness (`test/fork/setup.ts` + per-test) | — | Pure test infra; NO production-code change (D-ROLLBACK: no in-prod bypass). |
| Launch capture + replay (EXIT-LIVE-09) | Offline script (`scripts/`) + test harness (`test/fork/`) | Bot runtime (`handleNewPairForChain` is the SUT) | Capture is archive-RPC tooling; replay drives the real bot handler on a fork. |
| Dashboard WS position update (EXIT-LIVE-05) | Dashboard SPA + API WS hub (`server.ts`/`broadcaster.ts`) | — | Already implemented; observation only. |
| Chain-restart warning (EXIT-LIVE-06) | Bot runtime (WS reconnect in `bot.ts`/`detector.ts`) | — | Warning emits from the WS lifecycle; capture by inducing a drop. |
| Migration log (EXIT-LIVE-07) | Database module (`db.ts` boot-time migration) | — | Migration runs at module load; capture on fresh-clone boot. |
| Evidence archive (EXIT-LIVE-11) | Planning docs (`.planning/milestones/`) | — | Documentation deliverable. |

**Key tier insight:** This phase touches exactly ONE production source file for behavior-adjacent change — `src/exitEngine.ts` (op-enrichment + telemetry, both additive logging). Everything else is test infra, an offline script, observation, or docs. The planner should resist the temptation to "improve" the exit logic; the engine is the verification subject, not the work item.

## Standard Stack

This is a hardening phase on an existing codebase. **No new runtime packages are required.** All capabilities are served by already-installed dependencies. Versions below are `[VERIFIED: package.json]` (read from the repo's `package.json` on 2026-05-26).

### Core (already installed — reuse, do not add)
| Library | Version | Purpose | Why Standard (here) |
|---------|---------|---------|--------------|
| `ethers` | `6.16.0` | Archive log queries (`getLogs`/`queryFilter`), receipt fetch, event decoding for `capture-launch.ts`; fork-impersonation signing | Already the bot's chain library; v6 stable per REQUIREMENTS "viem migration deferred". |
| `@flashbots/ethers-provider-bundle` | `1.0.0` | `FlashbotsTransactionResponse` exposes `bundleHash` + `bundleTransactions[].hash` for EXIT-LIVE-04 | Already wired into `FlashbotsMevStrategy`; the EXIT-LIVE-04 subject. |
| `better-sqlite3` | `^12.8.0` | `exit_state` / `trades` reads + `forceWalCheckpoint` for SIGTERM-durability reasoning | The bot's DB; `db.ts` singleton. |
| `vitest` | `^4.1.1` | Fork test runner (EXIT-LIVE-02, -08, -09); `vitest.config.ts` `fork` project already exists | Project test framework. |
| `hardhat` | `2.26.0` | Mainnet-fork node (`hardhat node --fork`) for the fork harness + D-FORK-REHEARSAL | Already drives `test/fork/setup.ts`. Hardhat 3.x migration explicitly OUT of scope. |
| `pino` | `^10.3.1` | Structured `op`-field logging (top-level JSON keys; `base:undefined` so `op` is filterable) | The bot's logger (`logger.ts`). |
| `ts-node` | `10.9.2` | Run `scripts/capture-launch.ts` (`npx ts-node scripts/…`) | Existing script-run convention. |
| `axios` | `1.10.0` | (Optional) Etherscan API calls in `capture-launch.ts` if resolving by tx | Already a dep; used by `scripts/pause.ts`. |
| `@nomicfoundation/hardhat-network-helpers` | `^1.1.0` | `time`/`mine`/`impersonateAccount`/`setBalance` fork helpers for replay + SIGTERM-restart determinism | Already a devDep; the canonical fork-manipulation toolkit. |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nomicfoundation/hardhat-toolbox` | `^6.1.0` | Hardhat task surface (`hardhat_mine`, `hardhat_impersonateAccount` RPC) | Fork replay block advance / impersonation. |
| `pino-pretty` | `^13.1.3` | Human-readable pino in dev; pretty-printing op-filtered excerpts for the evidence doc | Producing readable EXIT-LIVE-01/06 pino excerpts. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hardhat fork node | Anvil (Foundry) | Repo is Hardhat-based; introducing Foundry adds toolchain + CI surface for zero benefit. Stay Hardhat 2.26. |
| `ALCHEMY_URL` archive RPC | Dedicated `ARCHIVE_RPC_URL` env | Existing `ETH_FORK_RPC_URL || ALCHEMY_URL` fallback (`setup.ts:6`) already provides an archive endpoint. Planner MAY add a distinct `CAPTURE_ARCHIVE_RPC_URL` for clarity (D-ENV-EXAMPLE) but reuse is sufficient. **Confirm the configured Alchemy tier is archive-enabled for historical `getLogs` at arbitrary blocks** (free tier supports archive reads on Ethereum mainnet). |
| Programmatic SIGTERM in-test | Spawn the real bot process + `process.kill` | See Open Question #4 — a full child-process spawn is the highest-fidelity EXIT-LIVE-02 but heaviest; a module-level resume/persist assertion is lighter and may satisfy the requirement. Planner decides. |

**Installation:** None. Verified all required libraries already present in `package.json` `[VERIFIED: package.json read 2026-05-26]`. The bot entry point is `npx ts-node src/bot.ts` `[VERIFIED: project memory]`.

## Package Legitimacy Audit

> This phase installs **no external packages**. All capabilities are served by already-installed, long-established dependencies verified present in `package.json`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | n/a | No new packages |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

If the planner later decides to add a helper (e.g., a connection-drop proxy for EXIT-LIVE-06), that single package MUST pass the Package Legitimacy Gate before install. The current recommendation is to induce the RPC drop with a bad URL or `provider.destroy()` — **no package needed**.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────── PHASE 21 SCOPE ───────────────────────┐

WORK-STREAM A: op-enrichment + telemetry (the spine — touches 1 prod file)
  src/exitEngine.ts  pollExitStrategy() ──[wrap cycle timing]──► log.info({op:'exit.poll.cycle',
     │                                                            positions, durationMs, budgetMs:5000, overruns})
     ├─ executeFullSell() ─► sendTxWithRetry(txBuilder, ctx) ─► createMevStrategy(ctx.chain)
     │                                                            │  (ETH → 'flashbots')
     │                                                            ▼
     │                              FlashbotsMevStrategy.sendTransaction ─► flashbotsProvider.sendBundle
     │                                                            │   returns FlashbotsTransactionResponse
     │                                                            │   { bundleHash, bundleTransactions[].hash }
     │   ◄────── add op:'exit.flashbots.submitted' {bundleHash, minedTxHash} ───────┘  ← EXIT-LIVE-04 needs BOTH
     │
     ├─ decodeReceipt(txHash) ─► {amountOut, gasCost, block} ─► log.info({op:'exit.receipt.decoded'})
     └─ insertTrade.run({action:'sell', amount_out}) ──────────► trades.amount_out  ← EXIT-LIVE-03 GROUND TRUTH

WORK-STREAM B: test-safety + fork harness
  test/fork/setup.ts ──[ADD global tripwire]──► read chainId; if ===1 && !ALLOW_REAL_MAINNET → throw (abort run)
  per-test decorator  ──► requireRealMainnetGate() helper (extends isHardhatFork pattern, honeypotChecker.fork.test.ts:57)
  test wallet ──► throwaway key (fork-only, 0 ETH); NEVER process.env.PRIVATE_KEY (prod, chainRegistry.ts:1067)

WORK-STREAM C: launch capture + replay
  scripts/capture-launch.ts ──getLogs via ALCHEMY_URL──► PairCreated → Mint → first-Swap (by token+block)
     │                                                    write test/fork/fixtures/realLaunches/<slug>.json
     ▼
  test/fork/realLaunchReplay.fork.test.ts ──fork-pin to launchBlock──► drive handleNewPairForChain(ctx, dex, t0,t1,pair)
                                                                        → validation→buy→exit-monitor→sell lifecycle

WORK-STREAM D: live capture run + evidence
  npm run preflight (read-only go/no-go) ─► bot buys hand-picked safe token ─► tight TP/stop ─► poll fires executeFullSell
     │                                       (D-FORK-REHEARSAL first on a local fork, THEN real run)
     ▼
  Etherscan tx hash + DB amount_out row + pino op-excerpts + dashboard screenshot
     ▼
  .planning/milestones/v6.17-VERIFICATION-EVIDENCE.md  (EXIT-LIVE-11 single source of truth)

                        └────────────────────────────────────────────────────────────┘
```

### Component Responsibilities
| File | Phase 21 Action | What it owns |
|------|-----------------|--------------|
| `src/exitEngine.ts` | **MODIFY** (additive logging only) | poll loop, `executeFullSell`, `executePartialSell`, receipt decode call. Add ~12 `op` fields + poll-cycle telemetry. |
| `test/fork/setup.ts` | **MODIFY** | Add global `chainId===1` tripwire (D-GATE-BOTH-LAYERS layer a). |
| `test/fork/realLaunchReplay.fork.test.ts` | **NEW** | Replay `realLaunches/*.json` against `handleNewPairForChain`. |
| `test/fork/fixtures/realLaunches/*.json` (≥3) | **NEW** | Hand-picked safe-launch fixtures (V2+V3, varied exits). |
| `test/fork/exitStatePersistence.fork.test.ts` | **NEW** | EXIT-LIVE-02 SIGTERM-restart persistence. |
| `scripts/capture-launch.ts` | **NEW** | Archive-RPC launch recorder. |
| `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` | **NEW** | EXIT-LIVE-11 evidence archive. |
| `.env.example` | **MODIFY** [USER-BINDING] | `ALLOW_REAL_MAINNET`, test-wallet key var, any archive-RPC var. |
| `docs/operations/going-live.md` | **MODIFY** | Live-capture runbook section (go/no-go, abort-if-gas-spiked, fork-rehearsal-first, simulate-before-submit). |
| REQUIREMENTS.md | **REWORD** | EXIT-LIVE-01 op example → dotted; EXIT-LIVE-07 `schema_version`→`user_version`; clarify EXIT-LIVE-08 test-wallet vs prod-capture. |

### Pattern 1: The exact `op`-field logger call shape to replicate (EXIT-LIVE-10)
**What:** Every `op` log in this codebase is `log.<level>({ <context fields>, op: '<namespace>.<object>.<action>' }, '<human message>')` — the `op` key sits inside the structured object, the human-readable string is the second arg. pino emits `op` as a top-level JSON key (`logger.ts` uses `base: undefined`), so `op:exit.*` filtering works via JSON grep or pino-pretty.
**When to use:** Every exit-engine code path.
**Examples (VERIFIED from the live codebase — copy this exact shape):**
```typescript
// Source: src/bot.ts:360  (killswitch convention — note ctx.log.info, op inside object)
ctx.log.info({ op: 'killswitch.cp1', token: targetToken, reason: 'global-pause' }, 'CP1 pause-check: aborting before bundle construction');

// Source: src/anti-rug/detector.ts:439  (antirug register — dotted past-tense)
log.info({ ..., op: 'antirug.register' }, '...');

// Source: src/anti-rug/detector.ts:932  (ws reconnected — namespace.object.action)
log.info({ ..., op: 'antirug.ws.reconnected' }, '...');

// Source: src/anti-rug/exitTrigger.ts:232  (exit dispatch — the closest existing 'exit-ish' op)
log.info({ ..., op: 'antirug.exit.dispatch' }, '...');

// Source: src/anti-rug/lpBaseline.ts:162  (snapshot — object.action)
log.info({ tradeId, pool, snapshotBlock, op: 'antirug.lp-baseline.snapshot' }, '...');
```

### Pattern 2: Fork chainId guard helper (EXIT-LIVE-08 — extend, don't reinvent)
**What:** The repo already has the exact gate logic; D-GATE-BOTH-LAYERS asks to (a) centralize it as a global tripwire and (b) keep a per-test opt-in marker.
**Example (VERIFIED — `honeypotChecker.fork.test.ts:57-63`):**
```typescript
// Source: test/fork/honeypotChecker.fork.test.ts:57
function isHardhatFork(provider: ethers.JsonRpcProvider): Promise<boolean> {
    return provider.getNetwork().then((n) => {
        // hardhat node default chainId is 31337; mainnet is 1.
        // Per Pitfall F: only allow chainId !== 1 OR ALLOW_REAL_MAINNET=1.
        return Number(n.chainId) !== 1 || process.env.ALLOW_REAL_MAINNET === '1';
    });
}
```
The global tripwire (layer a) inverts this: in `test/fork/setup.ts` (which runs as `globalSetup`), after the hardhat node is up, read its chainId — but note the local fork reports **31337**, not 1, so the tripwire fires only if a test points at a real-mainnet RPC. The per-test decorator (layer b) is a thin `it`-wrapper or `beforeAll` guard that throws unless `ALLOW_REAL_MAINNET==='1'` when the connected provider's chainId is 1.

### Pattern 3: Fork-fixture replay (EXIT-LIVE-09 — mirror the rugs/ pattern)
**What:** The `rugs/` and `honeypots/` fixtures use a JSON-per-scenario + fork-pin-to-`forkBlockNumber` + inject-state + advance-chain pattern. `realLaunches/` mirrors it but drives the REAL `handleNewPairForChain` (success criterion 2), not a manual swap.
**Example fixture shape (VERIFIED — `rugs/README.md:29-62`, extend for launches):**
```json
{
  "slug": "eth-v2-<token>",
  "chain": "eth",
  "dexType": "v2",
  "tokenAddress": "0x...",
  "pairAddress": "0x...",          // V2; poolAddress for V3
  "routerAddress": "0x7a25...488D",
  "feeTier": null,                 // 500/3000/10000 for V3
  "pairCreatedBlock": 18000000,
  "mintBlock": 18000000,
  "firstSwapBlock": 18000001,
  "forkBlockNumber": 17999999,     // launch block - 1 so replay sees PairCreated as next block
  "expectedVerdict": "safe",
  "expectedExitPath": "take-profit | partial-sell | trailing-stop",
  "discoveredVia": "etherscan",
  "discoveredOn": "2026-05-..",
  "notes": "..."
}
```
**Critical replay caveat (VERIFIED `rugs/README.md:81`):** `forkBlockNumber` MUST be `launchBlock - 1` so the fork replays the launch txn as the next block. The same caveat applies to capturing PairCreated → Mint → first-Swap ordering.

### Anti-Patterns to Avoid
- **Asserting "exit happened" from a log line or counter** — D-OP-DB-TRUTH forbids it. Ground truth is `trades.amount_out` non-null + the on-chain receipt. The `op:exit.full.executed` log is for *filtering*, not *proof*.
- **Loading `process.env.PRIVATE_KEY` in any test** — that is the PROD wallet (`chainRegistry.ts:1067`, `provider.ts:59`). D-TEST-WALLET-FORKONLY: tests use a throwaway fork-only key.
- **Changing exit logic** — the engine is the verification subject. Op-fields and the poll-cycle telemetry are additive logging; they must not alter control flow or timing semantics.
- **`expect(true).toBe(true)`** — D-04 forbids hollow fills.
- **Treating a fork-test pass as closure** — D-EVIDENCE-BAR: real-mainnet artifacts only for the 6 deferred items.
- **Recording the BUY as the EXIT-LIVE-04 artifact** — the buy records `txHash:'mev_bundle'` (a placeholder, `bot.ts:429`/`:728`), NOT a real hash. The SELL is the real Flashbots artifact (D-CHAIN-SINGLE-ROUNDTRIP relies on this).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Receipt → `amount_out` decode | A new sell-receipt parser | `decodeReceipt` (`receiptDecoder.ts:37`) | Already parses WETH Withdrawal (V2) + Transfer-to-wallet (V3); already wired into both sell paths; v6.16 Phase 14. |
| Flashbots bundle submit/retry | A new bundle sender | `FlashbotsMevStrategy.sendTransaction` (`flashbots.ts:41`) | v6.16 FIX-09 dynamic-relay + nonce-incrementing retry; the EXIT-LIVE-04 subject. Just add an op-log capturing `bundleHash`. |
| Position-update WS push | A new dashboard socket | `server.ts:186` `positions_update` broadcast | Already broadcasts every 5s with live prices (EXIT-LIVE-05 needs zero code). |
| Fork node lifecycle | A new harness | `test/fork/setup.ts` globalSetup | Already spawns `hardhat node --fork` on :8545. |
| chainId gating | A new guard | `isHardhatFork` pattern (`honeypotChecker.fork.test.ts:57`) | Established; D-GATE-BOTH-LAYERS just centralizes + adds opt-in marker. |
| Fork block-advance / impersonation | Raw RPC calls | `@nomicfoundation/hardhat-network-helpers` (`mine`, `impersonateAccount`, `setBalance`) | Already a devDep; canonical fork-manipulation API. |
| Schema migration | A new migration runner | `migrateSchema` (`db.ts:29`) | Already idempotent, PRAGMA-guarded; EXIT-LIVE-07 just observes it on fresh boot. |
| `.bot-state.json` → SQLite import | A new importer | `migrateJsonState` (`db.ts:203`) | Already idempotent, renames to `.bak`, logs the migration. |

**Key insight:** Phase 21 is a *capture-and-prove* phase over a *complete* engine. The single genuinely-new piece of code is `scripts/capture-launch.ts` (an offline archive-RPC reader). Everything else either already exists (just needs an `op` log) or is test/doc scaffolding. The temptation to "improve robustness while we're in here" must be resisted — D-STOP-THE-LINE channels any discovered bug to phase 21.1, not fix-in-flight.

## Runtime State Inventory

> This phase RENAMES nothing and migrates no data. It is verification + additive logging + new test/script files. The categories below are answered for completeness because the phase *exercises* runtime state (it does not change keys).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `exit_state` table (`db.ts:67-77`) and `trades.amount_out` (`db.ts:284`) are READ/asserted by EXIT-LIVE-02/03, not renamed. The live capture WRITES one real `trades` sell row + one `exit_state` lifecycle (deleted on close at `exitEngine.ts:537`). | None — verification reads existing schema. The live capture produces one real prod-DB sell row (expected, that's the artifact). |
| Live service config | The capture runs as the **prod bot on the prod wallet** (D-CAPTURE-WALLET) against the live ETH RPC + Flashbots relay (`relay.flashbots.net`, `chainRegistry.ts:202`). No service config is renamed. | None — the prod config IS the subject. Re-read live balance/gas at capture time (point-in-time per CONTEXT). |
| OS-registered state | None — no Task Scheduler / pm2 / systemd registration touched by this phase. | None — verified: phase adds test files + one script + logging. |
| Secrets/env vars | NEW vars added per D-ENV-EXAMPLE: `ALLOW_REAL_MAINNET` (tripwire, default unset/0), a fork-only test-wallet key var (e.g. `TEST_WALLET_PRIVATE_KEY`, zero-ETH throwaway), optionally `CAPTURE_ARCHIVE_RPC_URL`. **The prod `PRIVATE_KEY` (`provider.ts:59`) is NEVER read by tests** (D-TEST-WALLET-FORKONLY). `FLASHBOTS_AUTH_KEY` (`flashbots.ts:22`) used as-is on the real run. | Add new vars to `.env.example` with defaults + 1-line descriptions. No existing key renamed. |
| Build artifacts | `npx hardhat compile` produces `artifacts/` consumed by fork tests (`setup.ts:12`). No stale-artifact risk from this phase (no rename). | None — fork harness already compiles on setup. |

**The canonical question — "after every file is updated, what runtime systems still have an old string cached?"** — does not apply: this phase renames nothing. The only runtime side-effect is the deliberate live-capture sell (one real on-chain tx, the EXIT-LIVE-03/04 artifact).

## Common Pitfalls

### Pitfall 1: Confusing `exit_state` "poll position" with a literal poll counter (EXIT-LIVE-02)
**What goes wrong:** The success criterion says "verifies `exit_state` table reflects the same poll position pre/post restart." A reader expects a `poll_count` or `cursor` column. **There is none.**
**Why it happens:** `exit_state` (`db.ts:67-77`) persists exit-STRATEGY state — `entry_price`, `high_water_mark`, `trailing_activated`, `partial_tiers_completed`, `original_token_amount`, `urgency_start_ts`, `volatility_samples` — not a poll index. The poll loop re-derives everything from current price each cycle (`exitEngine.ts:716`).
**How to avoid:** Map "poll position" → the persisted state columns. EXIT-LIVE-02 asserts that `getExitState.get(tradeId)` returns identical `high_water_mark` / `trailing_activated` / `partial_tiers_completed` (and ideally `volatility_samples`) before SIGTERM and after `resumeExitMonitor` reload. State is written every cycle (`exitEngine.ts:819`) + after partial sells (`:757`).
**Warning signs:** A test plan that greps for a non-existent `poll_position` column.

### Pitfall 2: EXIT-LIVE-04 expects a mapping the code doesn't currently surface
**What goes wrong:** "bundle hash → mined tx hash mapping" implies you can read both from existing logs. Today `FlashbotsMevStrategy` returns ONLY `bundleTransactions[0].hash` (the mined hash, `flashbots.ts:97`); it never surfaces `bundle.bundleHash`.
**Why it happens:** The strategy was built to feed `decodeReceipt`, which needs the tx hash, not the bundle hash.
**How to avoid:** The op-enrichment task (EXIT-LIVE-10) must add a log at the bundle-included site that captures BOTH `bundle.bundleHash` and `bundleTransactions[0].hash` from the `FlashbotsTransactionResponse` (`@flashbots/ethers-provider-bundle` `index.d.ts:41-46`). Decide placement: either inside `flashbots.ts` (`op:'exit.flashbots.submitted'` — but that file logs under `module:'mev-flashbots'`, not the exit child logger) OR thread the response up to `executeFullSell`. Cleanest: add the op-log in `flashbots.ts` with `op:'flashbots.bundle.included'` AND a paired `op:'exit.flashbots.submitted'` at the exit confirm site (`exitEngine.ts:503`) using the returned hash. The planner picks one; the evidence needs both values resolvable.
**Warning signs:** An EXIT-LIVE-04 artifact that shows only a tx hash with no bundle hash to map FROM.

### Pitfall 3: The BUY is not a Flashbots-hash artifact
**What goes wrong:** Assuming the buy produces the EXIT-LIVE-04 mapping. The buy records `txHash:'mev_bundle'` literal (`bot.ts:429` V2, `:728` V3) and does not capture the bundle response (`sendTxWithRetry`'s return is discarded at the buy site).
**Why it happens:** The buy path predates the Phase-14 receipt-decode work that consumes the real hash; it never needed the hash.
**How to avoid:** D-CHAIN-SINGLE-ROUNDTRIP is correct to rely on the SELL for BOTH artifacts. The sell (`executeFullSell`) captures the real hash via the `sendTxWithRetry` return (`exitEngine.ts:501`). EXIT-LIVE-04's bundle→mined mapping comes from the SELL's Flashbots submission, not the buy. The buy's role is purely to obtain the position (D-CAPTURE-METHOD).
**Warning signs:** A capture plan that screenshots the buy's "mev_bundle" placeholder as evidence.

### Pitfall 4: SIGKILL vs SIGTERM durability for `exit_state` (EXIT-LIVE-02)
**What goes wrong:** "kills bot mid-cycle" could be read as SIGKILL. Under `synchronous = NORMAL` (`db.ts:22`), a SIGKILL can lose the last WAL-flush window; `exit_state` writes are NOT followed by `forceWalCheckpoint()` (that helper, `db.ts:612`, is only called for pause-state).
**Why it happens:** WAL durability tuned for throughput; only the kill-switch contract demanded the extra fsync.
**How to avoid:** EXIT-LIVE-02 should use **SIGTERM** (the requirement says SIGTERM explicitly), which triggers `gracefulShutdown` (`bot.ts:1402`) → `clearAllTimers()` + `closeDb()` (`bot.ts:1380,1396`). `db.close()` flushes the WAL on a clean close. The persisted state is from the last completed poll cycle before the signal. If the planner wants SIGKILL fidelity, note the durability gap honestly (it would test WAL-window loss, not the persistence contract).
**Warning signs:** A flaky EXIT-LIVE-02 test that intermittently loses the last state update — likely a SIGKILL-before-WAL-flush race.

### Pitfall 5: The `realLaunches/` replay must drive the REAL handler, not a manual swap
**What goes wrong:** Copying `snipeLifecycle.test.ts` (`test/fork/snipeLifecycle.test.ts`) — which manually deploys FakeToken + swaps via raw ethers — would NOT satisfy success criterion 2 ("replaying … against `handleNewPairForChain` … exercises the full validation→buy→exit-monitor→sell lifecycle").
**Why it happens:** `snipeLifecycle.test.ts` is a low-level harness that never calls `handleNewPairForChain`.
**How to avoid:** The replay test must construct a `ChainContext` (fork provider + fork-only wallet + ETH chain config) and invoke `handleNewPairForChain(ctx, dex, token0, token1, pairAddress)` directly (the V2 signature; `handleNewV3PoolForChain(ctx, dex, t0, t1, feeTier, pool, block)` for V3 per `bot.ts:909`/`:934`). This pulls in the honeypot gate, the safety bank, the buy, `startExitMonitor`, and the sell — the full lifecycle. The fork must be pinned so the chosen token's pair + liquidity exist (D-FIXTURE-SELECTION picks safe+tradeable tokens precisely so the gate passes and the buy lands).
**Warning signs:** A replay test with `deployer.swapExactETHForTokens(...)` instead of `handleNewPairForChain(...)`.

### Pitfall 6: `handleNewPairForChain` honeypot gate will block fixtures unless they pass the real gate
**What goes wrong:** A `realLaunches/` fixture for a token that the live HoneypotChecker (deployed at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`, `chainRegistry.ts:222`) would mark `unsafe` will be SKIPPED at the gate (`bot.ts:253`), so the buy never lands and the lifecycle never runs.
**Why it happens:** The full handler runs the honeypot roundtrip + 8-gate safety bank before buying (`bot.ts:253-348`).
**How to avoid:** D-FIXTURE-SELECTION explicitly hand-picks tokens that PASS the gate (real liquidity, no tax surprises). On a fork pinned to a historical block, the HoneypotChecker contract call executes against forked state — the fixture token must have been safe+tradeable at that block. Verify each fixture's gate-pass during fixture authoring (the capture script can run the roundtrip as a pre-commit check).
**Warning signs:** A replay test where `handleNewPairForChain` logs `'Honeypot gate blocked'` and returns before buying.

### Pitfall 7: ethers v6 WebSocketProvider does not auto-reconnect (EXIT-LIVE-06)
**What goes wrong:** Inducing an RPC drop and expecting the provider to silently recover.
**Why it happens:** Documented ethers v6 behavior (issue #1053, referenced in ANTIRUG-11). The bot handles it manually in `bot.ts:856-884` (PairCreated listener reconnect) and `detector.ts` (anti-rug WS health).
**How to avoid:** EXIT-LIVE-06's "chain-restart warning" is the bot's OWN reconnect log (`'WebSocket disconnected for … reconnecting'` `bot.ts:860`, or the richer `op:antirug.ws.disconnected` `detector.ts:872`). Induce the drop deterministically (D-INDUCE-RPC-DROP: dead RPC URL or `provider.destroy()`), then capture the pino warning excerpt. Note: the exit ENGINE itself uses the HTTP provider for price polling (`queryPrice` uses `ctx.httpProvider`, `exitEngine.ts:322,333`), so a WS drop does not stop exits — the "chain-restart warning" is a listener/anti-rug concern, not an exit-poll concern. Reconcile the EXIT-LIVE-06 wording accordingly.
**Warning signs:** Expecting the exit poll loop to emit the restart warning (it won't — it's HTTP-based).

## Code Examples

Verified patterns from the actual repo (file:line cited):

### EXIT-LIVE-03 ground-truth chain (sell → DB amount_out)
```typescript
// Source: src/exitEngine.ts:501-534  (executeFullSell — the real exit path D-EXIT-TRIGGER fires)
const txHash = await sendTxWithRetry(txBuilder, ctx, undefined, undefined, undefined, gasMultiplier);
// ... receipt decode ...
if (txHash) {
    receiptData = await decodeReceipt(txHash, ctx.httpProvider, ctx.chain.wethAddress, ctx.wallet.address);
}
insertTrade.run({
    token: tokenAddress.toLowerCase(), chain: ctx.chain.name, action: 'sell',
    txHash: txHash || null, block: receiptData.blockNumber,
    amountIn: balance.toString(),
    amountOut: receiptData.amountOut,   // ← EXIT-LIVE-03 ground truth: trades.amount_out
    // ...
});
```

### EXIT-LIVE-04 — where to capture bundleHash (the strategy returns only the tx hash today)
```typescript
// Source: src/utils/mevStrategies/flashbots.ts:90-101  (bundle included — bundleHash NOT logged today)
const waitResponse = await bundle.wait();
if (waitResponse === 0) {
    log.info({ block: targetBlock, attempt: attempt + 1 }, 'Flashbots bundle included');
    const realHash = bundle.bundleTransactions?.[0]?.hash;   // mined tx hash (returned)
    if (!realHash) { throw new Error(`... missing bundleTransactions[0].hash ...`); }
    return realHash;
    // EXIT-LIVE-04 ADD: log.info({ op:'flashbots.bundle.included', bundleHash: bundle.bundleHash, minedTxHash: realHash, block: targetBlock }, '...')
}
// `bundle` is FlashbotsTransactionResponse: { bundleHash: string; bundleTransactions: { hash, signedTransaction }[] }
// Source for shape: node_modules/@flashbots/ethers-provider-bundle/build/index.d.ts:41-46
```

### EXIT-LIVE-01 — poll-cycle telemetry insertion point
```typescript
// Source: src/exitEngine.ts:895-904  (the setInterval that runs every exitConfig.pollIntervalMs = 5000)
const interval = setInterval(async () => {
    try {
        const result = await pollExitStrategy(ctx, dex, tokenAddress, feeTier, buyAmountWei, state);
        // EXIT-LIVE-01 ADD around the call: const t0 = performance.now(); ... durationMs = performance.now() - t0;
        //   log.info({ op:'exit.poll.cycle', token: tokenAddress, durationMs, budgetMs: exitConfig.pollIntervalMs, overrun: durationMs > exitConfig.pollIntervalMs }, 'Exit poll cycle')
        if (result === 'exited') { clearInterval(interval); }
    } catch (e) { ctx.log.error({ err: e, token: tokenAddress }, 'Exit engine poll error'); }
}, exitConfig.pollIntervalMs);
```
Note: telemetry is per-position (the bot runs one `setInterval` per open position, not a single batched loop). The `positions:N` field in the discretion schema implies a fleet-level aggregate — the planner must decide whether to log per-position `durationMs` (matches the actual loop structure) or add a separate aggregate sweep. Per-position is the lower-risk, behavior-preserving choice; an aggregate `positions:N` count would require a new module-level timer the engine does not currently have.

### EXIT-LIVE-09 — events to decode in capture-launch.ts
```typescript
// Source: src/utils/abis.ts:7,51,57
// PairCreated (V2):  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
// PoolCreated (V3):  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"
// Mint (V3 pool):    "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)"
// Archive RPC source: process.env.ALCHEMY_URL  (chainRegistry.ts:936 fallback; test/fork/setup.ts:6 uses ETH_FORK_RPC_URL || ALCHEMY_URL)
// CLI shape analog:   scripts/deploy-honeypot-checker.ts  (dotenv.config(); pino child logger; fail-fast on argv; npx ts-node scripts/<name>.ts <args>)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Exit "happened" inferred from logs | DB receipt-decoded `amount_out` as ground truth | v6.16 Phase 14 (`receiptDecoder.ts`) + Phase 21 D-OP-DB-TRUTH | Telemetry-masks-issue failure mode closed for the exit path. |
| Fork-test pass = closure | Real-mainnet artifacts required for the 6 deferred items | Phase 21 D-EVIDENCE-BAR | "A fork test passing is no longer accepted as closure." |
| Plain message logs in exitEngine | Dotted `op` taxonomy (`exit.*`) | Phase 21 EXIT-LIVE-10 | `op:exit.*` filtering during live runs; matches `antirug.*`/`killswitch.cp*`. |
| No test-mainnet guard | `chainId===1` tripwire + `ALLOW_REAL_MAINNET` decorator | Phase 21 EXIT-LIVE-08 (pattern exists since Phase 18) | Automated suite can never accidentally transact on mainnet. |

**Deprecated/outdated:**
- **REQUIREMENTS EXIT-LIVE-01 op example `exit-poll-cycle`** (hyphenated): superseded by dotted `exit.poll.cycle` per D-OP-CONVENTION. Reword during plan-phase.
- **REQUIREMENTS EXIT-LIVE-07 "`schema_version` rows"**: there is no `schema_version` table — schema versioning is `PRAGMA user_version` (`db.ts:30,194`). Reword to "`PRAGMA user_version` confirms version 6" (current `CURRENT_SCHEMA_VERSION = 6`, `db.ts:27`).
- **REQUIREMENTS HONEY-07/08 "Pending" traceability**: stale — both gates are live (`bot.ts:253`, `:566`). See Anomalies.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The configured `ALCHEMY_URL` is on an archive-enabled tier supporting historical `getLogs` at arbitrary past blocks (needed for `capture-launch.ts`). | Standard Stack / OQ#6 | If the tier is full-node-only, capture by-block fails; planner adds a distinct archive endpoint env (`CAPTURE_ARCHIVE_RPC_URL`). Mitigation: Alchemy free tier supports Ethereum mainnet archive reads. |
| A2 | A mainnet-fork Hardhat node correctly executes the deployed HoneypotChecker contract call against forked historical state for `realLaunches/` gate-pass. | Pitfall 6 | If fork-state honeypot checks are unreliable at old blocks, fixture authoring must pin to blocks where the token + pair + checker all resolve. The capture script can run the roundtrip as a pre-commit verification. |
| A3 | SIGTERM (not SIGKILL) is acceptable for EXIT-LIVE-02 (the requirement text says SIGTERM). | Pitfall 4 | If SIGKILL fidelity is demanded, the WAL `synchronous=NORMAL` gap means last-cycle state may be lost — that tests WAL durability, not the persistence contract. |
| A4 | Per-position poll-cycle telemetry (not a fleet aggregate) satisfies EXIT-LIVE-01 given the engine runs one `setInterval` per position. | Code Examples / EXIT-LIVE-01 | If the operator wants a single `positions:N` aggregate line, a new module-level timer is needed (additive, low risk, but a design choice). |
| A5 | The live Area-1 capture can drive a tight-TP exit that satisfies immediately on the next 5s poll without the position first needing to reach 2x (trailing only activates at ≥2x; `stop-loss` fires below 2x). | OQ during plan | The `stop-loss` path (`exitEngine.ts:790-803`) fires below 2x when price ≤ entry×(1−stopLossPct/100); a hand-picked stable token's small downward tick or a configured aggressive `STOP_LOSS_PCT`/take-profit tier is the trigger. Partial-sell tiers (`PARTIAL_SELL_TARGETS`) fire at configured multiples ≥ entry. Planner/operator confirms the exact trigger config at capture time (capture-time operational pick per CONTEXT). |
| A6 | No production-code change is needed for EXIT-LIVE-05 (dashboard already broadcasts `positions_update`). | OQ#7 | Verified `server.ts:198`; risk only if the dashboard SPA does not render `positions_update` — confirmed it's the established Phase 8/20 WS event. |

**If this table looks long:** these are capture-time operational confirmations, not blocking unknowns. Every code claim in this document is VERIFIED against file:line. The assumptions are about the live environment (RPC tier, capture-time gas/price) which is point-in-time by nature.

## Open Questions

### 1. [RESOLVED — HIGH PRIORITY] Does the SELL leg route through Flashbots on ETH? → YES.
- **What we know (VERIFIED, full chain):** `exitEngine.executeFullSell` calls `sendTxWithRetry(txBuilder, ctx, …)` (`exitEngine.ts:501`). `sendTxWithRetry`'s multi-chain path calls `createMevStrategy(ctx.chain)` (`txManager.ts:83`) then `strategy.sendTransaction(...)` (`txManager.ts:88`). `createMevStrategy` returns `FlashbotsMevStrategy` when `chain.mevStrategy === 'flashbots'` (`txManager.ts:29-30`). ETH's config is `mevStrategy: 'flashbots'`, `chainId: 1` (`chainRegistry.ts:201,175`). `FlashbotsMevStrategy.sendTransaction` calls `flashbotsProvider.sendBundle(...)` (`flashbots.ts:81`). The ANTIRUG-08 gas-multiplier wiring (`exitEngine.ts:472,501` → `flashbots.ts:46,69-78`) confirms the same path. **D-CHAIN-SINGLE-ROUNDTRIP confirmed: a single ETH sell IS a Flashbots bundle submission.**
- **Nuance (not a blocker, but plan-shaping):** the strategy returns ONLY `bundleTransactions[0].hash`; `bundle.bundleHash` is available (`index.d.ts:41-46`) but not surfaced. EXIT-LIVE-04's mapping requires the op-enrichment task to log both (Pitfall 2). **The buy does NOT produce a Flashbots-hash artifact (records `'mev_bundle'`) — the sell does (Pitfall 3).**
- **Recommendation:** Plan EXIT-LIVE-04 around the SELL's Flashbots submission, with an op-log capturing `bundleHash` + mined `hash` together.

### 2. [RESOLVED] Exit-engine `op`-enrichment surface — enumerated.
Distinct code paths in `src/exitEngine.ts` needing an `op` (proposed dotted past-tense taxonomy, planner finalizes exact set per discretion):
| Path | Location | Proposed `op` |
|------|----------|---------------|
| Poll cycle (per position) | `exitEngine.ts:895/968` interval body | `exit.poll.cycle` |
| Exit monitor started | `:883` | `exit.monitor.started` |
| Exit monitor resumed | `:932` | `exit.monitor.resumed` |
| Partial-sell submit | `:615` | `exit.partial.submitted` |
| Partial-sell confirmed | `:621` | `exit.partial.executed` |
| Full-sell submit | `:490` | `exit.full.submitted` |
| Full-sell confirmed | `:503` | `exit.full.executed` (success-criterion-4 names this) |
| Flashbots bundle included | `flashbots.ts:92` (or threaded to exit) | `exit.flashbots.submitted` / `flashbots.bundle.included` |
| Receipt decoded | `:515` (call site) / `receiptDecoder.ts:82,98` | `exit.receipt.decoded` |
| Trailing-stop triggered | `:779` | `exit.trigger.trailing-stop` |
| Stop-loss triggered | `:799` | `exit.trigger.stop-loss` |
| Urgency hard exit | `:813` | `exit.trigger.urgency` |
| Trailing activated at 2x | `:786` | `exit.trailing.activated` |
| Zero-balance cleanup | `:448` | `exit.cleanup.zero-balance` |
| Exit-sell failed/abort | `:546` (catch) | `exit.full.failed` |
| Partial-sell failed | `:667` (catch) | `exit.partial.failed` |
- **Recommendation:** ~14-16 op points. Replicate the exact `ctx.log.<level>({ ..., op: 'exit.<object>.<action>' }, '<msg>')` shape from Pattern 1. These are ADDITIVE — they augment existing log lines, never alter control flow.

### 3. [RESOLVED] Test/fork harness mechanics.
- `test/fork/setup.ts` (globalSetup) spawns `npx hardhat node --fork $rpcUrl --port 8545` (`setup.ts:14`), `rpcUrl = ETH_FORK_RPC_URL || ALCHEMY_URL` (`:6`), compiles contracts first (`:12`). Local fork reports chainId **31337** (per `honeypotChecker.fork.test.ts:24-25`), so the global tripwire fires only when a test points at a real-mainnet RPC.
- `vitest.config.ts` `fork` project: `include: ['test/fork/**/*.test.ts']`, `testTimeout: 120000`, `globalSetup: ['test/fork/setup.ts']` (`vitest.config.ts:29-38`).
- Fixture shape: `rugs/`+`honeypots/` JSON-per-scenario; full schema documented in `rugs/README.md:29-92`. The fork-replay pattern: pin to `forkBlockNumber` (= launchBlock − 1), inject state, advance via `provider.send('hardhat_mine', …)` (`antiRugDetector.fork.test.ts:11-12`), assert.
- `snipeLifecycle.test.ts` does NOT call `handleNewPairForChain` (manual swap harness) — the `realLaunches/` replay MUST call the real handler (Pitfall 5).
- **Recommendation:** New `test/fork/realLaunchReplay.fork.test.ts` constructs a `ChainContext` (fork provider + fork-only wallet + ETH config) and invokes `handleNewPairForChain` / `handleNewV3PoolForChain` per fixture.

### 4. [PARTIALLY RESOLVED] `exit_state` persistence + SIGTERM (EXIT-LIVE-02).
- Schema, write cadence, reload path all VERIFIED (see Pitfall 1, 4 and the requirements table).
- **Open design choice (Claude's discretion per CONTEXT):** Two test shapes are viable. (a) **Module-level**: write `exit_state` via the engine, simulate "restart" by clearing in-memory timers and calling `resumeExitMonitor`, assert reloaded state equals pre-state — fast, deterministic, runs in the `fork` project, but does not exercise a real OS SIGTERM. (b) **Process-level**: spawn the bot as a child process against a fork, kill mid-cycle with `process.kill(pid,'SIGTERM')`, restart, assert DB state — highest fidelity, matches the literal requirement, but heavier and needs the prod-key-avoidance scaffolding (fork-only wallet). 
- **Recommendation:** Process-level (b) is the truer EXIT-LIVE-02; if the spawn harness proves brittle on Windows (the dev host), (a) is an acceptable fallback that still asserts the persistence contract. The planner should attempt (b) first and document the choice. Use SIGTERM (Pitfall 4).

### 5. [RESOLVED — ANOMALY] EXIT-LIVE-07 `schema_version` wording is wrong.
- **What we know:** There is NO `schema_version` table. Schema versioning uses `PRAGMA user_version` (`db.ts:30` read, `:194` write, `CURRENT_SCHEMA_VERSION = 6` `:27`). `migrateJsonState` (`db.ts:203-248`) handles `.bot-state.json` → SQLite (idempotent via trades-count check `:208`, renames to `.bak` `:242`, logs `'Migrated .bot-state.json to SQLite'` `:243`).
- **Recommendation:** Reword EXIT-LIVE-07 acceptance to "DB schema check confirming `PRAGMA user_version` = 6" (same reword-during-plan-phase pattern as OPS-LIVE-02/06). The fresh-clone boot artifact = the pino `'Created … (schema version N)'` lines (`db.ts:53,61,109,119,153,191`) + the JSON-migration line (if `.bot-state.json` present) + a `PRAGMA user_version` query result.

### 6. [RESOLVED] `capture-launch.ts` archive recorder.
- **ethers v6 support:** `getLogs`/`queryFilter` with explicit `fromBlock`/`toBlock` against an archive RPC; decode with the `FACTORY_ABI`/`V3_FACTORY_ABI`/`V3_POOL_ABI` event fragments (`abis.ts:7,51,57`). Resolve by token address + launch block deterministically.
- **Archive RPC source:** `ALCHEMY_URL` (`chainRegistry.ts:936`, `setup.ts:6`). Planner MAY add `CAPTURE_ARCHIVE_RPC_URL` for clarity (D-ENV-EXAMPLE) but the existing var suffices if archive-enabled (A1).
- **CLI shape analog:** `scripts/deploy-honeypot-checker.ts` (`dotenv.config()`, `logger.child({module})`, fail-fast on `process.argv[2]`, `npx ts-node scripts/<name>.ts <args>`). Output: write `test/fork/fixtures/realLaunches/<slug>.json` matching the extended fixture schema (Pattern 3).
- **Recommendation:** Script signature ~`npx ts-node scripts/capture-launch.ts <tokenAddress> [--dex v2|v3] [--block <launchBlock>]`; resolve PairCreated/PoolCreated → Mint → first-Swap around the launch block, emit JSON.

### 7. [RESOLVED] Dashboard WS position updates (EXIT-LIVE-05) — no new code.
- **What we know:** `server.ts:186-205` runs a 5s `setInterval` that calls `buildPositionsWithLivePrices(contexts)` and `broadcast('positions_update', { positions, chains })` (`:198`). The generic `broadcast` (`broadcaster.ts:39`) pushes to all authenticated WS clients. The dashboard SPA consumes `positions_update` (established Phase 8 + Phase 20 `pause_state_change` pattern).
- **Recommendation:** EXIT-LIVE-05 is observation only. During the Area-1 live capture, the open position appears/updates in the dashboard; screenshot it (timestamped). Confirmed NO new code.

### 8. [RESOLVED] RPC-drop inducement (EXIT-LIVE-06).
- **Where the warning emits:** WS reconnect in the PairCreated listener (`bot.ts:856-884`: `'WebSocket disconnected for ${dex.name}, reconnecting...'` → `'WebSocket reconnected for ${dex.name}'`) and the anti-rug detector WS health (`detector.ts` ops `antirug.ws.disconnected` `:872`, `antirug.ws.disconnected-over-60s` `:900`, `antirug.ws.reconnected` `:932`).
- **How to induce deterministically (D-INDUCE-RPC-DROP):** point the WS at a dead/unreachable URL briefly, or call `provider.destroy()` / terminate the socket to fire the `'close'` handler. ethers v6 does not auto-reconnect (Pitfall 7), so the bot's manual reconnect log fires.
- **Caveat:** the exit POLL loop uses `ctx.httpProvider` (`exitEngine.ts:322,333`), so a WS drop does not stop exits — EXIT-LIVE-06's "chain-restart warning" is a listener/anti-rug event, not an exit-poll event. Reword EXIT-LIVE-06 to point at the WS-listener warning, or capture the anti-rug WS-health op (richer evidence).
- **Existing analog:** `test/unit/chainRestart.test.ts` exercises the reconnect/MEV-health callback in isolation.

### 9. [RESOLVED — ANOMALY] HONEY-07/08 doc-lag.
- **What we know:** Both honeypot gates are LIVE in code: V2 at `bot.ts:253` (`simulateHoneypotRoundtrip(ctx, dex, targetToken)`, "Honeypot gate blocked V2 snipe" `:263`); V3 at `bot.ts:566` (`simulateHoneypotRoundtrip(ctx, dex, targetToken, feeTier)`, "Honeypot gate blocked V3 snipe" `:577`). The broken sell-sims were DELETED (D-ROLLBACK, plan 18-09 per STATE.md). ROADMAP shows 18-09/18-10 shipped; the live preflight `honeypot-checker-code` PASSes (CONTEXT). The REQUIREMENTS.md `[ ] HONEY-07/08` checkboxes (lines 33-34) AND the traceability table "Pending" rows (lines 156-157) are **STALE DOCS** — runtime confirms the gates are functional.
- **Why the disagreement:** HONEY-07/08 close in Phase 18; the requirement-list checkbox + traceability table were not flipped when 18-09/18-10 landed (a doc-update miss, not incomplete work). Phase 18 shows 10/11 plans complete (the outstanding one is 18-08 BSC/Base/Arb deploy = HONEY-04, genuinely Pending and out of Phase 21 scope).
- **Recommendation:** This is NON-BLOCKING for Phase 21. The planner SHOULD include a small doc-fix task (flip HONEY-07/08 to Complete in REQUIREMENTS.md, mirroring how STATE.md/ROADMAP already reflect reality) so the doc agrees with runtime before any real-money capture. Cite `bot.ts:253` + `:566` as evidence. Do NOT touch HONEY-04 (out of scope).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js + npm | All | ✓ (project runs) | — | — |
| `hardhat` (fork node) | EXIT-LIVE-02/08/09 fork tests + rehearsal | ✓ | 2.26.0 | — |
| `ethers` | capture script, fork tests | ✓ | 6.16.0 | — |
| `@flashbots/ethers-provider-bundle` | EXIT-LIVE-04 | ✓ | 1.0.0 | — |
| `better-sqlite3` | EXIT-LIVE-02/03/07 | ✓ | ^12.8.0 | — |
| `vitest` | all fork tests | ✓ | ^4.1.1 | — |
| Archive ETH RPC (`ALCHEMY_URL`) | `capture-launch.ts` historical `getLogs`; fork harness | ✓ (configured; `.env.example:54` REQUIRED) | — | Add `CAPTURE_ARCHIVE_RPC_URL` if Alchemy tier lacks archive (A1) |
| Funded ETH prod wallet | Area-1 live capture (EXIT-LIVE-03/04/05) | ✓ (0.00915 ETH, point-in-time 2026-05-26) | — | Capture at calm gas; abort if spiked (D-NO-TOPUP) |
| Flashbots relay (`relay.flashbots.net`) | EXIT-LIVE-04 real run | ✓ (preflight Flashbots health PASS per CONTEXT) | — | — |
| Live dashboard SPA (built) | EXIT-LIVE-05 screenshot | ✓ (Phase 20 rebuild step in going-live.md) | — | `cd dashboard && npm run build` if stale |

**Missing dependencies with no fallback:** None — all tooling present.
**Missing dependencies with fallback:** Archive RPC tier (A1) — fallback is a distinct archive endpoint env. Live capture requires re-reading point-in-time balance/gas at execution (operational, not a tooling gap).

## Validation Architecture

> nyquist_validation is ENABLED (`config.json` `workflow.nyquist_validation: true`). Per D-OP-DB-TRUTH, the ground truth for "an exit happened" is the DB receipt-decoded `amount_out` + on-chain receipt — NEVER a log line or instrumented metric. Per D-04, every test asserts a concrete observable effect.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` `[VERIFIED: package.json]` |
| Config file | `vitest.config.ts` (3 projects: unit / integration / fork) |
| Quick run command | `npm run test:unit` (per-task, < 30s for unit; fork tests are slower) |
| Fork run command | `npm run test:fork` (spawns hardhat fork node, `testTimeout: 120000`) |
| Full suite command | `npm run test:all` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | Ground-Truth Source / Observable | File Exists? |
|--------|----------|-----------|-------------------|----------------------------------|-------------|
| EXIT-LIVE-01 | Poll-cycle telemetry emits budget-vs-actual | unit (log assertion) | `vitest run test/unit/exitEngine/pollTelemetry.test.ts` | pino object has `{op:'exit.poll.cycle', durationMs:number, budgetMs:5000}` | ❌ Wave 0 |
| EXIT-LIVE-02 | `exit_state` persists identically across SIGTERM-restart | fork | `vitest run test/fork/exitStatePersistence.fork.test.ts` | `getExitState.get(tradeId)` cols (`high_water_mark`, `trailing_activated`, `partial_tiers_completed`) IDENTICAL pre/post | ❌ Wave 0 |
| EXIT-LIVE-03 | Sell records non-null `amount_out` | fork (rehearsal) + **live artifact** | `vitest run test/fork/realLaunchReplay.fork.test.ts` (rehearsal) + manual live capture | **DB:** `trades.amount_out IS NOT NULL` for the sell row + Etherscan tx hash (live = closure per D-EVIDENCE-BAR) | ❌ Wave 0 |
| EXIT-LIVE-04 | Flashbots bundleHash maps to mined tx hash | unit (log assertion) + **live artifact** | `vitest run test/unit/mevStrategies/flashbotsBundleHash.test.ts` | pino `{op:'...bundle.included', bundleHash, minedTxHash}`; **live:** Etherscan resolves the mined hash, bundle hash in pino | ❌ Wave 0 |
| EXIT-LIVE-05 | Dashboard WS pushes position update | **live artifact** (screenshot) | (observation — no automated test; existing `positions_update` already covered) | Timestamped browser screenshot of live position update | n/a (no new code) |
| EXIT-LIVE-06 | Chain-restart warning fires on RPC drop | unit (existing analog) + **live artifact** | `vitest run test/unit/chainRestart.test.ts` (analog) | pino `'WebSocket disconnected … reconnecting'` / `op:antirug.ws.disconnected`; **live:** pino excerpt on induced drop | ✓ (analog) / ❌ live |
| EXIT-LIVE-07 | Fresh-clone migration runs | integration + **live artifact** | `vitest run test/unit/db/*migration*.test.ts` (existing migration tests) | `PRAGMA user_version` = 6 + `'Migrated .bot-state.json'` pino line on fresh boot | ✓ (migration tests exist) / ❌ live boot |
| EXIT-LIVE-08 | Fork test at chainId 1 without gate fails loudly | fork (meta-test) | `vitest run test/fork/realMainnetGate.fork.test.ts` | `process.exit`/throw when chainId===1 && !ALLOW_REAL_MAINNET; CI never sets gate | ❌ Wave 0 |
| EXIT-LIVE-09 | Replay drives full lifecycle via `handleNewPairForChain` | fork | `vitest run test/fork/realLaunchReplay.fork.test.ts` | After replay: `trades` has a `buy` row + a sell/partial_sell row (`amount_out` set) for the fixture token; ≥3 fixtures, V2+V3, varied exits | ❌ Wave 0 |
| EXIT-LIVE-10 | Every exit path logs an `op` | unit (log assertions across paths) | `vitest run test/unit/exitEngine/opEnrichment.test.ts` | each path's pino object contains the expected `op:'exit.*'` value | ❌ Wave 0 |
| EXIT-LIVE-11 | Evidence doc committed | doc (CI/manual check) | grep/exists check for `v6.17-VERIFICATION-EVIDENCE.md` with all 6 items | File exists; each item links a resolvable artifact | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit` (op-enrichment + telemetry unit tests) — fast.
- **Per wave merge:** `npm run test:fork` (persistence + replay + gate fork tests) — spins up hardhat fork.
- **Phase gate:** Full suite green (`npm run test:all`) before `/gsd-verify-work`, PLUS the live-artifact items (03/04/05/06/07) closed in `v6.17-VERIFICATION-EVIDENCE.md` with real-mainnet evidence (a fork pass alone does NOT close these — D-EVIDENCE-BAR).

### Wave 0 Gaps
- [ ] `test/unit/exitEngine/pollTelemetry.test.ts` — covers EXIT-LIVE-01 (assert `op:exit.poll.cycle` + durationMs/budgetMs fields)
- [ ] `test/unit/exitEngine/opEnrichment.test.ts` — covers EXIT-LIVE-10 (assert each exit path emits its `op:exit.*`)
- [ ] `test/unit/mevStrategies/flashbotsBundleHash.test.ts` — covers EXIT-LIVE-04 (assert bundleHash + minedTxHash captured)
- [ ] `test/fork/exitStatePersistence.fork.test.ts` — covers EXIT-LIVE-02 (SIGTERM-restart, identical persisted cols)
- [ ] `test/fork/realLaunchReplay.fork.test.ts` — covers EXIT-LIVE-09 (drive `handleNewPairForChain`, ≥3 fixtures)
- [ ] `test/fork/realMainnetGate.fork.test.ts` — covers EXIT-LIVE-08 (chainId===1 without gate fails loudly)
- [ ] `test/fork/fixtures/realLaunches/*.json` (≥3) + README — fixture data (V2+V3, varied exits)
- [ ] `test/fork/setup.ts` tripwire addition — global chainId===1 guard (D-GATE-BOTH-LAYERS layer a)
- [ ] EXISTING (reuse, do not recreate): `test/unit/chainRestart.test.ts` (EXIT-LIVE-06 analog), `test/unit/db/*Migration*.test.ts` (EXIT-LIVE-07 analog), `test/fork/snipeLifecycle.test.ts` (harness reference — but does NOT call the real handler; see Pitfall 5)

*Note: EXIT-LIVE-03/04/05/06/07 each have an automated portion AND a live-artifact portion. The automated test proves the mechanism on a fork; the live artifact (DB row / Etherscan hash / screenshot / pino excerpt) is what actually CLOSES the item per D-EVIDENCE-BAR. A Wave-0 baseline of skipped tests with concrete observable assertions per D-04 mirrors the Phase 20 plan-20-00 pattern.*

## Security Domain

> `security_enforcement` is not present in `config.json` → treat as enabled. This phase's security surface is narrow but real (real-capital bot, prod-key handling, test-mainnet gating).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface (dashboard auth unchanged). |
| V3 Session Management | no | Unchanged. |
| V4 Access Control | yes | EXIT-LIVE-08: the test suite must NEVER load the prod `PRIVATE_KEY` (`provider.ts:59`, `chainRegistry.ts:1067`). Control: fork-only throwaway test wallet (D-TEST-WALLET-FORKONLY); `ALLOW_REAL_MAINNET` is an explicit opt-in tripwire, never set in CI. |
| V5 Input Validation | yes (light) | `capture-launch.ts` takes a token address + block from argv — validate with `ethers.getAddress` (checksum) before use (mirror `chainRegistry.ts:888`). |
| V6 Cryptography | yes (key handling) | The fork-only test key is a throwaway with zero real ETH; never reuse the prod key. Flashbots `FLASHBOTS_AUTH_KEY` (`flashbots.ts:22`) is the signing identity for bundles — used as-is on the real run, never in tests. |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Test accidentally transacts on real mainnet | Tampering / financial loss | `chainId===1` global tripwire + `ALLOW_REAL_MAINNET` opt-in (D-GATE-BOTH-LAYERS); CI never sets the gate; local fork reports chainId 31337 so it passes naturally. |
| Prod key leaked into test fixtures/CI logs | Information Disclosure | D-TEST-WALLET-FORKONLY: prod key never imported into a test; tests sign with a fork-only key. |
| `capture-launch.ts` writes a malicious/typo'd address into a fixture that later drives a real buy on a fork | Tampering | Validate address checksum on capture; fixtures are fork-only (no real funds); D-FIXTURE-SELECTION hand-picks known-safe tokens. |
| Live-capture run at gas-spike → unexpected spend | financial loss | D-NO-TOPUP: abort if gas spiked; `npm run preflight` go/no-go read-only; minimum size (~0.003 ETH); position mostly returns on sell. |
| Telemetry "looks green" while exits silently fail | repudiation / masked failure | D-OP-DB-TRUTH: ground truth is DB `amount_out` + on-chain receipt, NEVER the op-log; verification asserts against DB/chain. |

## Sources

### Primary (HIGH confidence — repo code, file:line)
- `src/exitEngine.ts` — exit engine (poll loop, executeFullSell/executePartialSell, op-surface, zero existing op fields)
- `src/utils/txManager.ts` — `sendTxWithRetry` MEV dispatch (Flashbots routing confirmation)
- `src/utils/mevStrategies/flashbots.ts` + `types.ts` — Flashbots strategy, bundle response handling, gas multiplier
- `src/chainRegistry.ts` — ETH config (`mevStrategy:'flashbots'`, chainId 1), prod-key load (`:1067`), `ALCHEMY_URL` fallback (`:936`)
- `src/utils/db.ts` — schema (`exit_state` `:67`, `trades.amount_out` `:284`), `PRAGMA user_version` (`:30,194`), `migrateJsonState` (`:203`), `forceWalCheckpoint` (`:612`)
- `src/utils/receiptDecoder.ts` — `amount_out` decode (V2 Withdrawal / V3 Transfer)
- `src/bot.ts` — `handleNewPairForChain` buy path + killswitch op examples (`:360,392,418`), `'mev_bundle'` placeholder (`:429,728`), WS reconnect warnings (`:856-884`), `gracefulShutdown` SIGTERM (`:1354-1403`), preflight call (`:955-975`), honeypot gates live (`:253,566`)
- `src/api/server.ts` — `positions_update` broadcast (`:186-205`)
- `src/api/ws/broadcaster.ts` — generic `broadcast` (`:39`)
- `src/anti-rug/detector.ts` / `exitTrigger.ts` / `lpBaseline.ts` / `circuitBreaker.ts` — `op` taxonomy exemplars (`antirug.*`)
- `test/fork/setup.ts` / `teardown.ts` — fork harness (hardhat node, `ALCHEMY_URL`/`ETH_FORK_RPC_URL`)
- `test/fork/honeypotChecker.fork.test.ts` — `isHardhatFork` chainId guard (`:57-63`)
- `test/fork/antiRugDetector.fork.test.ts` — fork-replay + chainId-guard convention
- `test/fork/snipeLifecycle.test.ts` — harness reference (does NOT call real handler)
- `test/fork/fixtures/rugs/README.md` + `eth-v2-horse.json`, `honeypots/eth-sell-revert.json` — fixture schema + fork-pin pattern
- `vitest.config.ts` — fork project config
- `package.json` — verified versions (ethers 6.16.0, flashbots 1.0.0, better-sqlite3 ^12.8.0, vitest ^4.1.1, hardhat 2.26.0, pino ^10.3.1)
- `node_modules/@flashbots/ethers-provider-bundle/build/index.d.ts` — `FlashbotsTransactionResponse` shape (`bundleHash` + `bundleTransactions[].hash`, `:41-46`)
- `scripts/deploy-honeypot-checker.ts` / `deploySepoliaTest.ts` — CLI script shape analogs
- `.planning/milestones/v6.17-safety-bank-audit.md` — milestone audit-doc shape for EXIT-LIVE-11
- `.planning/REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `21-CONTEXT.md`, `20-CONTEXT.md` — milestone source-of-truth + decisions

### Secondary (MEDIUM confidence)
- `.env.example` — `ALCHEMY_URL` REQUIRED (`:54`), env-var conventions

### Tertiary (LOW confidence — flagged for capture-time validation)
- A1 (Alchemy archive tier) — assumed archive-enabled; verify at capture/fixture-authoring time
- Live balance/gas (0.00915 ETH, 0.82 gwei) — point-in-time 2026-05-26; re-read at capture

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all versions verified in `package.json`.
- Architecture / code paths: HIGH — every claim cited to file:line in the actual repo; the HIGH-PRIORITY Flashbots-routing question is fully traced and confirmed.
- Pitfalls: HIGH — derived directly from reading the engine, DB, MEV strategy, and fork harness.
- Live-environment specifics (RPC tier, capture-time gas): MEDIUM — point-in-time / environment-dependent (A1, A5, A6); operational confirmations, not blocking unknowns.
- Doc anomalies (HONEY-07/08, schema_version): HIGH — code disproves the docs with file:line evidence.

**Research date:** 2026-05-26
**Valid until:** ~2026-06-25 for code claims (stable, internal codebase); live balance/gas figures are point-in-time and MUST be re-read at capture time.

## RESEARCH COMPLETE
