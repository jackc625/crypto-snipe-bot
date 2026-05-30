# Phase 19: Anti-Rug Runtime Monitoring - Research

**Researched:** 2026-05-23
**Domain:** Runtime LP-removal detection (V2 + V3) with frontrun-exit through `executeFullSell`; single-listener-per-chain WS subscription; allowlist + multi-signal AND chain; dry-run-then-live graduation
**Confidence:** HIGH on event signatures + ethers v6 WS limits + canonical lockers; MEDIUM on per-RPC `getLogs` limits and historical rug fixtures; LOW on per-chain frontrun success rates and `flashbots_simulateBundle` semantics (corrected to `eth_callBundle`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture (CLOSED — researcher and planner do NOT re-evaluate):**

- **D-V3-COVERAGE:** Full V3-aware monitoring via NFT events in v6.17 (NOT deferred to
  v6.18; NOT log-only). REQUIREMENTS.md ANTIRUG-02/03 are V2-only as written; planner
  adds V3-specific rows (ANTIRUG-13+ or decimal renumbering) at plan-phase.
- **D-V3-THRESHOLD:** Snapshot `pool.liquidity()` (active liquidity at current tick) at
  buy success in `lp_baseline`. Trigger on >50% drop from baseline.
- **D-V3-EVENTS:** Subscribe to BOTH `UniswapV3Pool.Burn` and `UniswapV3Pool.Collect`.
  Either event arrives → re-evaluate the full multi-signal AND chain.
- **D-V3-SIGNAL3:** V3 third signal = sell-simulation slippage via
  `QuoterV2.quoteExactInputSingle(token, WETH, fee, ourPositionAmount)`. If quoted output
  is <50% of baseline expected, treat as "reserves below sell-threshold" equivalent.
- **D-V3-ALLOWLIST:** Owner-based allowlist with separate V3 locker list per chain. Check
  `owner` field on Burn (no `to` on V3 Burn), `recipient` field on Collect.

**Dry-run → live graduation (CLOSED):**

- **D-LIVE-GATE:** Hybrid — 7 calendar days dry-run minimum AND review of every observed
  dry-run trigger with 0 confirmed false-positives before flipping live.
- **D-LIVE-PER-CHAIN:** Per-chain env vars (`ETH_ANTIRUG_LIVE_EXECUTE`,
  `BSC_ANTIRUG_LIVE_EXECUTE`, `BASE_ANTIRUG_LIVE_EXECUTE`, `ARB_ANTIRUG_LIVE_EXECUTE`).
- **D-DRY-TELEMETRY:** Three-channel — structured pino log + Telegram `[DRY-RUN]`-prefixed
  alert + dedicated dashboard tile.
- **D-LIVE-ROLLBACK:** Env-flag flip in `.env` + bot restart. No hot-flip.
- **D-ENV-EXAMPLE [USER-BINDING]:** `.env.example` MUST be updated with every new env var:
  per-chain `ANTIRUG_LIVE_EXECUTE`, `ANTIRUG_LP_REMOVAL_PCT`, `ANTIRUG_CONFIRM_BLOCKS`,
  `ANTIRUG_CIRCUIT_BREAKER_TRIGGERS`, `ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS`,
  `ANTIRUG_GAS_MULTIPLIER`, `ANTIRUG_ALLOWLIST_EXTRA`.
- **D-OPERATOR-HANDOFF [USER-BINDING]:** Explicit operator handoff doc at
  `docs/operations/anti-rug-rollout.md` listing what to change in `.env`, restart
  procedure, per-chain verification protocol, CB reset procedure, troubleshooting.

**Operator visibility:**

- **D-VIS-LIVE-EXIT:** Full evidence + tx artifacts on live anti-rug exit Telegram alert.
- **D-VIS-CB-TRIPPED:** Red dashboard banner; Telegram with last 3 triggers; pino fatal.
- **D-VIS-WS-HEALTH:** Tiered alerts; dashboard per-chain indicator + Telegram only on
  reconnect-fails-3x OR disconnected-60s OR backfill-gap-10-blocks.
- **D-VIS-PER-POSITION:** New "Anti-Rug" dashboard column with state badges per position.

**Allowlist lifecycle:**

- **D-LIST-SOURCE:** Hardcoded base in `src/anti-rug/allowlist.ts` (+ per-chain in
  `CHAIN_TEMPLATES`) for Unicrypt UniLockerV2, TeamFinance V2+V3 vaults, PinkLock V2+V3
  per chain. Operator env overlay `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA=0xaaa,0xbbb`.
  Restart-only changes (not hot-reloadable).
- **D-LIST-VERIFY:** Startup-time `getCode()` check on every env-overlay address per
  chain. FATAL non-zero exit if any address has no code (EOA = wrong; lockers MUST be
  contracts). pino + stdout dumps the full merged allowlist with provenance.
- **D-LIST-AUDIT:** Per-hit pino log on every allowlist suppression.
- **D-LIST-FIXTURE:** Contrived `test/fixtures/contracts/RugPull.sol` (V2 + V3 variants)
  + 1+ V2 + 1+ V3 real pinned mainnet rug fixtures in
  `test/fork/fixtures/rugs/{slug}.json` (researcher identifies candidates).

**Frontrun race telemetry (D-RACE-TELEMETRY):** Triple measurement on every
would-have-sold during dry-run:
- (a) `evaluationLatencyMs` — time from event arrival to multi-signal verdict
- (b) Synthetic race (ETH only) via `flashbots_simulateBundle` (corrected:
  `eth_callBundle`) — record `flashbotsRaceVerdict`. Skip on BSC (bloXroute),
  Base/Arb (sequencer-ordered).
- (c) Post-hoc reality at block N+2 — `would-have-saved-X-ETH` vs `too-late-already-drained`.

**Threshold tuning (D-TUNE-PROTOCOL):** Manual review + documented protocol in
`docs/operations/anti-rug-tuning.md`. Per-chain env tunable defaults:
`<CHAIN>_ANTIRUG_LP_REMOVAL_PCT=50`, `<CHAIN>_ANTIRUG_CONFIRM_BLOCKS=1`,
`<CHAIN>_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS=3`,
`<CHAIN>_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS=1`,
`<CHAIN>_ANTIRUG_GAS_MULTIPLIER=2.0`.

**Position-subscription-termination (D-TERMINATION):** Subscription terminates ONLY when
position is fully closed (`trades.status='sold'` AND `amount_remaining=0`). Partial
sells do NOT terminate. Manual emergency-sell from dashboard also terminates. Cleanup
hook in `exitEngine` sell-success path. **No time-since-launch gate in v6.17.**

**Resume-on-restart (D-BACKFILL):** On restart, query
`getLogs(lastSeenBlock+1, currentBlock)` per subscribed pair. Cap window at 2000 blocks
per query (researcher caveat: VERIFY against actual RPC provider — Alchemy free tier is
**10 blocks**, not 2000). If downtime exceeds the cap: **FAIL CLOSED** — pino error +
`[GAP DETECTED]` Telegram + dashboard banner; operator manually reviews. Backfilled
events feed through the SAME multi-signal AND chain. Stale events fire historical-trigger
pino log + would-have-sold replay; tagged `'too-late'` in race telemetry. `lastSeenBlock`
stored per chain in `chain_state` table (or reused `bot_state` — planner decides).

**Carried-forward conventions:**

- Single-listener-per-chain WS pattern (NOT per-position) per Pitfall #10.
- Multi-signal AND chain trigger logic; single-signal triggers EXPLICITLY rejected
  per ANTIRUG-05.
- Bridge via `executeFullSell` with new `reason: 'anti-rug'` discriminant. Never direct
  `wallet.sendTransaction`.
- Elevated gas multiplier default `2.0×`, per-chain configurable.
- WebSocket resilience — heartbeat ping/pong via existing `ws@^8.20.0` (no built-in
  heartbeat in ethers v6 per issue #1053), reconnect → re-subscribe → backfill via
  `getLogs(lastSeen, current)`.
- Schema migration v4→v5 — additive `lp_baseline` table; existing tables unchanged.
- **D-STOP-THE-LINE** — any audit finding or fork test revealing a production bug
  BLOCKS Phase 19 close; treated as ANTIRUG-13+ or decimal phase 19.1.

### Claude's Discretion

- Exact heartbeat ping interval and timeout (within "default 30s, silent failure
  detection beyond library defaults" per ANTIRUG-12) — planner discretion.
- `lp_baseline` schema discriminator approach (single table with nullable V2+V3
  columns vs `pool_type` discriminator vs separate `lp_baseline_v2`/`lp_baseline_v3`)
  — planner discretion within "additive only, no existing tables modified".
- `src/anti-rug/` module file split — planner discretion within the
  "NOT folded into exit-engine" constraint.
- Exact `executeFullSell` reason-union extension shape — planner discretion.
- Dashboard component file structure — planner discretion.
- Backfill window cap (2000 blocks default) — planner discretion to adjust per RPC
  tier; verified during plan-phase against current Alchemy/Infura/public-RPC limits.
- V3 NFT Manager and Pool ABI imports — researcher identifies (see §1 below).
- Real-mainnet rug fixture token selection — researcher identifies candidates
  (see §4 below); planner finalizes.
- Telegram alert phrasing (within D-VIS-LIVE-EXIT shape) — planner refines.

### Deferred Ideas (OUT OF SCOPE — do not research)

- Time-since-launch gate (`<24h since buy` optional gate) — deferred to v6.18.
- Mempool-aware anti-rug detection (ANTIRUG-V2-01) — deferred to v6.18+.
- Aggregated rug-signal scoring (ANTIRUG-V2-02) — deferred to v6.18.
- Tax-change detection on open positions (ANTIRUG-V2-03) — deferred to v6.18.
- Owner-blacklist-self detection (ANTIRUG-V2-04) — deferred to v6.18.
- Allowlist hot-add via dashboard — rejected for v6.17.
- Bot-suggested threshold adjustments — rejected for v6.17.
- Allowlist Etherscan name-tag verification — rejected (getCode() preferred).
- Anti-rug auto-exit on backfilled triggers — rejected (tag as 'too-late' instead).
- Per-position WS subscriptions — explicitly rejected per Pitfall #10.
- Synthetic canary-trade monitor (OPS-V2-01) — deferred to v6.19.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANTIRUG-01 | `src/anti-rug/detector.ts` with single-listener-per-chain WS subscription pattern | §1 (V3 events on pool, V2 events on pair); §6 (heartbeat + reconnect-resubscribe pattern) |
| ANTIRUG-02 | `Pair.Burn` subscription per enabled chain with topic-filter on open-position pair addresses (V2) | §1.1 (V2 Burn event signature); §6 (single-listener dispatch) |
| ANTIRUG-03 | LP-token `Transfer(_, to=0xdEaD..., _)` subscription as alternative V2 rug pattern | §1.1 (LP Transfer signature on Pair contract); existing PAIR_ABI re-use |
| ANTIRUG-04 | Schema migration v4→v5 adds `lp_baseline` table (additive only) | §7 (db.ts migration framework precedent); CONTEXT.md Claude-discretion on V2/V3 discriminator shape |
| ANTIRUG-05 | Multi-signal AND trigger: (LP-removed-pct >threshold) AND (destination NOT in allowlist) AND (reserves drop below sell-threshold) | §1 (signals); §2 (allowlist sources); §3 (sell-sim via QuoterV2) |
| ANTIRUG-06 | Hardcoded allowlist of LP locker / multisig / known-safe destinations per chain | §2 (canonical lockers per chain, with citations) |
| ANTIRUG-07 | Confirm-after-N-blocks delay before exit fires; per-chain configurable | §6 (backfill semantics — confirm window is unrelated to backfill cap); ANTIRUG `<CHAIN>_ANTIRUG_CONFIRM_BLOCKS` env |
| ANTIRUG-08 | Bridge to `exitEngine.executeFullSell` with new `reason: 'anti-rug'`; elevated gas | §7 (existing reason union at `exitEngine.ts:429`); existing `gas.maxGasLimit` from `ChainConfig` |
| ANTIRUG-09 | Per-chain circuit breaker — auto-disable after N triggers in window; manual operator-reset via dashboard | §7 (existing per-chain SQLite state pattern); D-VIS-CB-TRIPPED dashboard signal |
| ANTIRUG-10 | 7-day dry-run mode — log "would-have-sold" without executing; explicit env flag to flip live | D-LIVE-GATE; D-LIVE-PER-CHAIN; CONTEXT.md telemetry contract |
| ANTIRUG-11 | WebSocket reconnect-resubscribe-backfill (ethers v6 has no auto-reconnect per #1053) | §5 (Alchemy `getLogs` cap CONTRADICTS CONTEXT 2000-block assumption — see CRITICAL); §6 (heartbeat + reconnect) |
| ANTIRUG-12 | Heartbeat ping/pong on `WebSocketProvider` using existing `ws@^8.20.0`; default 30s; silent failure detection | §6 (recommended ws `isAlive` pattern; 30s interval is the official ws library recommendation) |
| **ANTIRUG-13 (proposed)** | `UniswapV3Pool.Burn` + `UniswapV3Pool.Collect` subscription per enabled chain with topic-filter on open V3 position pool addresses | §1.2 (V3 event signatures verified against IUniswapV3PoolEvents.sol) |
| **ANTIRUG-14 (proposed)** | V3 multi-signal AND trigger uses `pool.liquidity()` baseline + `QuoterV2.quoteExactInputSingle` sell-sim as third signal | §1.3 (`pool.liquidity()` semantics), §3 (QuoterV2 ABI on ETH/BSC/Base/Arb) |
| **ANTIRUG-15 (proposed)** | Hardcoded V3 locker allowlist per chain — distinct from V2 list; verified contract addresses for UNCX/Unicrypt V3 + TeamFinance V3 + PinkLock V3 | §2.2 (V3 locker canonical addresses with citations) |
| **ANTIRUG-16 (proposed)** | `lp_baseline` schema supports both V2 (`token0_reserve`, `token1_reserve`, `lp_total_supply`) and V3 (`pool_active_liquidity`, `pool_tick_at_snapshot`, optional `position_nft_id`) per position type discriminator | §7 (additive migration; Claude's discretion on table shape) |

*Numbering: Planner may renumber as 19-A/19-B etc or accept ANTIRUG-13..16 as proposed. CONTEXT.md authorizes "ANTIRUG-13+ or decimal renumbering" — either is fine.*
</phase_requirements>

## Summary

Phase 19 is the **runtime-side** of the v6.17 defensive stack: after Phase 18 ships
honeypot detection at buy-time, Phase 19 monitors open positions for liquidity removal
on both V2 (`Pair.Burn` + LP Transfer-to-0xdEaD) and V3 (`UniswapV3Pool.Burn` +
`UniswapV3Pool.Collect`) and fires a frontrun-exit through the existing
`exitEngine.executeFullSell` with a 2.0× gas multiplier and new `reason: 'anti-rug'`.

The architecture is **closed** by CONTEXT.md and research convergence: a single
WS listener per chain (NOT per-position; subscription-cap leaks are Pitfall #10), a
multi-signal AND chain trigger (>50% LP removed AND destination not allowlisted AND
reserves/sell-sim below threshold) to suppress V2→V3 migrations, lock-contract
transfers, and multisig rebalances. Phase 19 ships in **default dry-run** with a 7-day
operator-review gate plus zero-false-positive requirement before the per-chain
`<CHAIN>_ANTIRUG_LIVE_EXECUTE` flag flips.

Two facts CONTRADICT prior CONTEXT.md assumptions and the planner must address:

1. **Alchemy free tier caps `eth_getLogs` at 10 blocks per query** — not 2000.
   The bot uses Alchemy on ETH. The D-BACKFILL "cap window at 2000 blocks" must be
   reduced to either (a) 10 blocks if free tier, (b) chunked iteration when the gap
   exceeds the per-query cap, or (c) the operator must upgrade to Alchemy Pay-As-You-Go
   (unlimited) before going live. See §5.
2. **`flashbots_simulateBundle` is not the correct method name.** Flashbots exposes
   `eth_callBundle` for synthetic simulation on the mainnet relay. The
   D-RACE-TELEMETRY (b) "Synthetic race (ETH only)" path uses `eth_callBundle` (with
   the `X-Flashbots-Signature` auth header) — not `flashbots_simulateBundle`. See §8.

**Primary recommendation:** Build the detector module against the verified V2 + V3 event
signatures in §1, wire the canonical lockers from §2 into `CHAIN_TEMPLATES`, use the
HORSE V2 fixture from §4 as the primary V2 rug fork test, and treat the 2000-block
backfill cap as planner-discretion to revise downward.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| LP-removal event ingestion (WS) | Bot process (`src/anti-rug/detector.ts`) | HTTP polling fallback (existing pattern at `bot.ts:758-810`) | Event-driven; uses existing `ctx.wsProvider` per chain. Single subscription per chain — not per position. |
| Allowlist storage + verification | Bot process (`src/anti-rug/allowlist.ts` + `CHAIN_TEMPLATES`) | env overlay (operator-controlled) | Hardcoded canonical addresses in source; restart-only operator override via `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA`. |
| LP baseline snapshot | SQLite (`lp_baseline` table) | — | Persistent across restart; written at buy-success; read at restart for resume. |
| Multi-signal evaluation | Bot process (`src/anti-rug/detector.ts`) | — | Pure in-process logic. Reads pair reserves (V2) or `pool.liquidity()` + QuoterV2 sell-sim (V3) via existing `ctx.httpProvider`. |
| Frontrun-exit trigger | `src/anti-rug/exitTrigger.ts` → `exitEngine.executeFullSell` | — | Never submits TX directly. Always goes through the existing sell lock + receipt decoder + DB cleanup + Telegram. |
| Circuit breaker counter | Bot process + SQLite (planner decides table) | Dashboard reset API | Per-chain trigger counter with rolling window; manual operator reset. |
| Heartbeat + reconnect | Bot process (`src/anti-rug/detector.ts` or shared util) | — | `ws@^8.20.0` `ping()` + `on('pong')` + `terminate()` pattern. ethers v6 has no built-in heartbeat. |
| Backfill on restart | Bot process (`src/anti-rug/detector.ts` resume path) | — | `provider.getLogs(filter, fromBlock, toBlock)` chunked by RPC cap. |
| Dashboard surfacing | `dashboard/` (existing React + Tailwind) | — | New "Anti-Rug" positions column + monitor tile + CB banner + WS-status indicator + frontrun-outcome panel. |
| Race telemetry (Flashbots simulate) | Bot process (`src/anti-rug/raceTelemetry.ts`) | — | ETH-only via `eth_callBundle`. BSC/Base/Arb degrade gracefully (skip). |

## Standard Stack

**No new npm packages.** Every dep is already in `package.json` from v6.16 + Phase 18.

### Core (unchanged)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ethers` | 6.16.0 | RPC, signing, ABI encoding, event subscriptions, `WebSocketProvider` | [VERIFIED: STACK.md] Already validated in v6.16 + Phase 18. No upgrade. |
| `ws` | ^8.20.0 | Direct WebSocket ping/pong for `WebSocketProvider` heartbeat | [VERIFIED: STACK.md + ws npm README] Already a top-level dep; used directly via `provider.websocket` because ethers v6 has no built-in heartbeat (`ethers-io/ethers.js#1053`). |
| `better-sqlite3` | ^12.8.0 | Schema migration v4→v5; `lp_baseline` prepared statements | [VERIFIED: STACK.md] Migration framework already wired in `src/utils/db.ts:27-123`. |
| `pino` | ^10.3.1 | Structured logging on all anti-rug paths | [VERIFIED: STACK.md] Already used; child-loggered per module (`logger.child({ module: 'antiRug' })`). |
| `@flashbots/ethers-provider-bundle` | 1.0.0 | `eth_callBundle` for D-RACE-TELEMETRY (b) on ETH | [VERIFIED: package.json] Already imported for MEV submission. `provider.send('eth_callBundle', ...)` is also viable. |
| `vitest` | ^4.1.1 | Unit + integration + fork tests | [VERIFIED: vitest.config.ts] Three projects already configured (`unit` / `integration` / `fork`). |
| `hardhat` | 2.26.0 | Solidity compile for `test/fixtures/contracts/RugPull.sol` | [VERIFIED: STACK.md] solc 0.8.28 already configured; matches the Phase 18 `Honeypot.sol` precedent. |

### Supporting (already in use)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dotenv` | 17.2.0 | New per-chain `<CHAIN>_ANTIRUG_*` env vars | Standard env layer — no extension needed. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `eth_callBundle` for D-RACE-TELEMETRY (b) | `provider.send('eth_simulateV1', [...])` | `eth_simulateV1` doesn't simulate against block-builder ordering; it tells you "could my tx be included" but NOT "would I win the race." `eth_callBundle` is the right method because Flashbots simulates ordering. **Use `eth_callBundle` per CONTEXT.md intent (despite the doc's `flashbots_simulateBundle` naming).** |
| ws@8.20 manual ping/pong | `reconnecting-websocket` library | Adds a dep; the `ws` library's built-in `ping()` + `on('pong')` + `isAlive` pattern is the recommended pattern in the official ws README (see §6.1). No new dep. |
| Per-position WS listeners | Single-listener-per-chain dispatch (CHOSEN) | Per-position hits Alchemy/Infura subscription caps (~10) at scale. Single-listener dispatches internally to subscribed positions. Pitfall #10 LOCKED THIS DECISION. |
| Polling-only (no WS) | Hybrid WS + HTTP polling fallback (CHOSEN) | WS detection is <12s on ETH; polling adds 2-5s. WS is preferred when available. HTTP fallback already exists at `bot.ts:758-810`. |

**Version verification (executed during research):** All packages above are confirmed
present in `package.json`. No new installs.

**Installation:** None.

## Package Legitimacy Audit

**Phase 19 installs NO new packages.** All dependencies are already in `package.json`
from v6.16 / Phase 18. slopcheck N/A; cross-ecosystem confusion not applicable; no
postinstall scripts to audit.

| Package | Registry | Disposition |
|---------|----------|-------------|
| *(none)* | — | Phase 19 adds zero new packages |

## Architecture Patterns

### System Architecture Diagram

```
                INGESTION LAYER (unchanged from v6.16)
+-------------------------------------------------------------------+
| Factory listeners (V2 PairCreated + V3 PoolCreated per chain)     |
+-------------------------+-----------------------------------------+
                          |
                          v
                ORCHESTRATION LAYER (unchanged by Phase 19)
+-------------------------------------------------------------------+
| handleNewPairForChain (V2) / handleNewV3PoolForChain (V3)         |
|   ...existing safety bank, HoneypotChecker (Phase 18)...           |
+-------------------------+-----------------------------------------+
                          | (on buy success)
                          v
                POSITION LIFECYCLE (extended by Phase 19)
+-------------------------------------------------------------------+
| startExitMonitor (exitEngine.ts:805) — 5s poll loop (existing)    |
|                                                                    |
|  *** NEW: startAntiRugMonitor (parallel attach, same call site)   |
|     - V2 path: read pair.getReserves() + LP totalSupply           |
|       → write lp_baseline row (token0_res, token1_res, lp_supply) |
|     - V3 path: read pool.liquidity() + pool.slot0()               |
|       → write lp_baseline row (active_liquidity, tick, nft_id?)   |
|     - subscribe to single per-chain WS topic-filter on pair/pool  |
|     - register position in per-chain dispatch table               |
+-------------------------+-----------------------------------------+
                          |
                          v
                ANTI-RUG DETECTOR (NEW; src/anti-rug/)
+-------------------------------------------------------------------+
| Single WS listener per chain (NOT per position)                   |
|   - V2 topics: Pair.Burn + LP.Transfer(to=0xdEaD)                 |
|   - V3 topics: Pool.Burn + Pool.Collect                           |
|                                                                    |
| On event arrival → dispatch to position(s) matching pair/pool     |
|                                                                    |
| Multi-signal AND chain (per position):                            |
|   Signal 1: LP-removed-pct > threshold (default 50%)              |
|             V2: amount0/lp_total_supply vs baseline               |
|             V3: pool.liquidity() now < 0.5 × baseline             |
|   Signal 2: destination/owner NOT in allowlist                    |
|             V2: Burn event `to` field                             |
|             V3: Burn event `owner` field; Collect `recipient`     |
|   Signal 3: reserves/sell-sim below threshold                     |
|             V2: pair.getReserves() shows <50% of baseline WETH    |
|             V3: QuoterV2.quoteExactInputSingle(token, WETH, fee,  |
|                   ourPositionAmount) < 50% of baseline expected   |
|                                                                    |
| ALL THREE → schedule confirm-after-N-blocks delay                 |
| After delay → re-evaluate (suppress reorg / one-tx noise)         |
| Still all-three → trigger exit                                    |
+-------------------------+-----------------------------------------+
                          |
                          v
                EXIT TRIGGER (NEW; src/anti-rug/exitTrigger.ts)
+-------------------------------------------------------------------+
| Bridge to exitEngine.executeFullSell with:                        |
|   reason: 'anti-rug'  (new union member)                          |
|   gas multiplier: ctx.chain.antiRug.gasMultiplier (default 2.0×)  |
|                                                                    |
| Existing sell pipeline handles: lock, receipt decode, DB cleanup, |
| Telegram alert, exit state delete.                                |
+-------------------------+-----------------------------------------+
                          |
                          v
                CIRCUIT BREAKER (NEW)
+-------------------------------------------------------------------+
| Per-chain trigger counter with rolling window                     |
| After N triggers in W hours → auto-disable anti-rug on chain      |
| Dashboard banner + Telegram + pino fatal                          |
| Manual operator reset via dashboard endpoint                      |
+-------------------------------------------------------------------+

           PARALLEL: WS resilience + race telemetry
+-------------------------------------------------------------------+
| Heartbeat (NEW; ws.ping every 30s, ws.terminate on no pong)       |
| Reconnect → resubscribe → getLogs(lastSeen+1, current) backfill   |
|   (chunked by RPC cap; FAIL CLOSED if gap exceeds cap)            |
|                                                                    |
| D-RACE-TELEMETRY (dry-run only):                                  |
|   (a) latency from event-arrival to verdict                       |
|   (b) eth_callBundle synthetic race (ETH only; skip BSC/Base/Arb) |
|   (c) post-hoc reality check at block N+2                         |
+-------------------------------------------------------------------+
```

### Recommended Project Structure

```
src/anti-rug/                    # NEW MODULE (NOT folded into exit-engine)
├── detector.ts                  # NEW: single-listener-per-chain WS dispatch + multi-signal AND chain
├── exitTrigger.ts               # NEW: bridge to executeFullSell with elevated gas
├── lpBaseline.ts                # NEW: snapshot V2 reserves + V3 active liquidity at buy
├── allowlist.ts                 # NEW: hardcoded base allowlist (V2 + V3) + env overlay + getCode() startup check
├── circuitBreaker.ts            # NEW: per-chain trigger counter with rolling window; dashboard reset API
├── raceTelemetry.ts             # NEW: D-RACE-TELEMETRY triple measurement
├── events.ts                    # NEW: V2 + V3 event ABI fragments + decode helpers (planner discretion to inline)
└── types.ts                     # NEW: RugEvaluation discriminated union + AntiRugConfig types

src/anti-rug/__tests__/          # OPTIONAL — Phase 18 used test/unit/ instead; planner discretion

test/fixtures/contracts/
└── RugPull.sol                  # NEW: contrived rug-pull V2 + V3 fixture (configurable destination + threshold)

test/fork/fixtures/rugs/         # NEW (parallels Phase 18's test/fork/fixtures/honeypots/)
├── eth-v2-horse.json            # NEW: HORSE token V2 rug fixture (block 18401609)
├── eth-v3-{slug}.json           # NEW: V3 rug fixture (planner-resolved; see §4.3 for candidates)
└── README.md                    # NEW: schema doc, modeled on honeypots/README.md

docs/operations/
├── anti-rug-rollout.md          # NEW [USER-BINDING per D-OPERATOR-HANDOFF]
└── anti-rug-tuning.md           # NEW per D-TUNE-PROTOCOL
```

### Pattern 1: Single-Listener-Per-Chain WS Dispatch

**What:** Subscribe once per chain to a topic-filter covering ALL open-position
pairs/pools. Internally dispatch each event to the matching position via a pair→position
lookup map.

**When to use:** This phase ONLY. Pitfall #10 explicitly forbids per-position listeners
at the subscription-cap-leak scale (4 chains × 10 positions × 2 events = 80 subs hits
Alchemy/Infura free-tier caps).

**Example (V2 path skeleton — planner refines):**

```typescript
// src/anti-rug/detector.ts
// Source: Pitfall #10 mitigation; matches existing factory-listener pattern at bot.ts:644-696

const positionRegistry = new Map<string, { tradeId: number; pairAddress: string; baseline: LpBaseline; isV3: false }>();
// Key: lowercased pair address. Single map per chain.

async function startChainAntiRugListener(ctx: ChainContext): Promise<void> {
    const ws = ctx.wsProvider;
    if (!ws) {
        // Reuse HTTP polling fallback pattern from bot.ts:758-810
        return startHttpPollingAntiRug(ctx);
    }

    // Build topic-filter union: Pair.Burn topic0 OR LP.Transfer-to-0xdEaD topic0
    // Filter by indexed `address` topic to scope to known pair addresses (cheaper at the RPC)
    const pairAddresses = [...positionRegistry.keys()];
    const burnTopic = ethers.id('Burn(address,uint256,uint256,address)');
    // (V3 path uses pool addresses + V3 Burn/Collect topics; combined or separate filters)

    const filter = {
        address: pairAddresses,
        topics: [[burnTopic, /* LP Transfer topic */]],
    };

    ws.on(filter, (logEvent) => {
        const pairAddress = logEvent.address.toLowerCase();
        const position = positionRegistry.get(pairAddress);
        if (!position) return; // not one of ours; ignore
        evaluateRugSignals(ctx, position, logEvent);
    });
}
```

### Pattern 2: Multi-Signal AND Chain (Never Single-Signal)

**What:** Every rug-trigger requires (a) LP-removal threshold AND (b) destination not
in allowlist AND (c) reserves/sell-sim below threshold. Single-signal events log
evidence but do NOT trigger exit.

**When to use:** ANTIRUG-05 mandates this. Single-signal triggers are EXPLICITLY rejected
in REQUIREMENTS.md.

**Example (evaluation skeleton):**

```typescript
// src/anti-rug/detector.ts
// Source: ANTIRUG-05 + CONTEXT.md D-V3-EVENTS

interface RugSignals {
    lpRemovedPct: number;        // 0-100; >50 trips signal 1
    destination: string;         // lowercase; allowlist check
    allowlistHit: 'safe' | 'unsafe' | 'unknown';
    sellSimSlippagePct: number | null;  // V3 only — null on V2 (uses reserves directly)
    v2ReservePctBelow: number | null;   // V2 only
}

type RugEvaluation =
    | { verdict: 'safe'; reason: 'partial-signal'; signals: RugSignals }
    | { verdict: 'allowlisted'; signals: RugSignals; lockerName: string }
    | { verdict: 'unsafe'; reason: 'three-signal-trigger'; signals: RugSignals }
    | { verdict: 'unknown'; reason: string };  // fail-closed default

async function evaluateRugSignals(...): Promise<RugEvaluation> {
    // Compute all three signals concurrently; require ALL three before returning unsafe
    // Vacuous pass is unrepresentable: missing data → 'unknown', not 'safe'
}
```

### Pattern 3: Bridge to executeFullSell via Reason Union Extension

**What:** Extend the existing `executeFullSell` `reason` union to include `'anti-rug'`.
Anti-rug NEVER submits transactions directly. Always goes through the existing sell
pipeline.

**When to use:** ANTIRUG-08 mandates this. Anti-Pattern #1 (parallel exit path) is
explicitly forbidden.

**Example (reason union extension):**

```typescript
// src/exitEngine.ts — MODIFY function signature at line 429
export async function executeFullSell(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug',  // <-- ADD 'anti-rug'
    tradeId: number,
    reasonDetail: string,
): Promise<boolean>
```

Within the function body, when `reason === 'anti-rug'`, the gas multiplier path reads
`ctx.chain.antiRug.gasMultiplier` (default 2.0×) and applies it to the tx-builder's
gas fields. Sell lock, receipt decoding, DB cleanup, and Telegram alerts are
unchanged. Discretion: planner may use a branded-string type or a discriminated union
with `reasonDetail` typed per variant.

### Pattern 4: Snapshot LP Baseline at Buy Success (Schema v4→v5 Additive)

**What:** At buy-success, snapshot the pair's `getReserves()` + `totalSupply()` (V2) or
the pool's `liquidity()` + `slot0()` (V3) and persist to `lp_baseline`. Resume-on-restart
loads these rows to seed the detector.

**When to use:** ANTIRUG-04 mandates this. Schema migration v4→v5 is additive (existing
tables unchanged) per CONTEXT.md.

**Example (planner discretion on table shape — option A shown):**

```typescript
// src/utils/db.ts — append migration step
if (version < 5) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lp_baseline (
            trade_id INTEGER PRIMARY KEY,
            pool_type TEXT NOT NULL CHECK(pool_type IN ('v2', 'v3')),
            pair_or_pool_address TEXT NOT NULL COLLATE NOCASE,
            -- V2 fields (NULL when pool_type='v3')
            v2_token0_reserve TEXT,
            v2_token1_reserve TEXT,
            v2_lp_total_supply TEXT,
            -- V3 fields (NULL when pool_type='v2')
            v3_active_liquidity TEXT,
            v3_tick_at_snapshot INTEGER,
            v3_position_nft_id TEXT,
            v3_fee_tier INTEGER,
            -- common
            snapshot_block INTEGER NOT NULL,
            snapshot_ts INTEGER NOT NULL,
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE INDEX IF NOT EXISTS idx_lp_baseline_pool ON lp_baseline(pair_or_pool_address);
    `);
    logger.info('Created lp_baseline table (schema version 5)');
}
db.pragma('user_version = 5');
```

Planner alternative: separate `lp_baseline_v2` + `lp_baseline_v3` tables. Both shapes
respect "additive only, no existing tables modified."

### Anti-Patterns to Avoid

- **Parallel exit path for anti-rug** — Anti-rug detector submits `wallet.sendTransaction`
  directly because it's "faster." Bypasses sell lock; two parallel exits (anti-rug +
  trailing-stop) submit simultaneously; one reverts and burns gas; receipt decoding
  doesn't run. **Always go through `executeFullSell`.** ARCHITECTURE.md §"Anti-Pattern 1"
  is authoritative.
- **Per-position WS subscriptions** — 4 chains × 10 positions × 2 events = 80 subs hits
  Alchemy/Infura free-tier caps. Pitfall #10 LOCKS single-listener-per-chain.
- **Single-signal trigger** — One Burn event → panic exit. False-positive cascades on
  V2→V3 migrations, lock transfers, multisig rebalances. ANTIRUG-05 EXPLICITLY rejects
  single-signal triggers.
- **Auto-exit on backfilled triggers** — Rejected per CONTEXT.md D-BACKFILL. Stale
  events tag race telemetry as `'too-late'`; no live exit. Logged + replayed only.
- **Vacuous "safe" return on RPC error** — Phase 18 Pitfall #1 carries forward: any
  branch that returns `verdict: 'safe'` without exercising all three signals is a bug.
  Discriminated-union `RugEvaluation` makes vacuous pass unrepresentable.
- **Hot-flipping live-execute via dashboard** — D-LIVE-ROLLBACK is env-flag + restart.
  No hot-flip.
- **Allowlist as EOAs** — D-LIST-VERIFY mandates `getCode()` check at startup. EOAs
  produce empty code; lockers MUST be contracts. FATAL exit on empty code.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WS heartbeat | Custom timeout/reconnect framework | `ws@8.20` `ping()`/`on('pong')`/`terminate()` per the official ws README pattern | Battle-tested by Node.js ecosystem; the ws README has the canonical 30s `isAlive` pattern (see §6.1). Custom implementations always miss edge cases (silent NAT timeouts, half-open sockets, half-closed states). |
| Event topic decoding | Manual `ethers.AbiCoder` calls | `Contract.on(filter, callback)` with ABI-loaded event spec | ethers v6 `Contract` auto-decodes indexed/non-indexed fields. Manual decoding requires re-implementing the indexed-vs-data split. |
| V3 NFT position discovery | Track `Transfer` of position NFTs on `NonfungiblePositionManager` | Use `tokenOfOwnerByIndex(wallet, 0..N)` if needed for resume; for runtime detection, subscribe to the POOL events not the manager | V3 positions are NFTs but the rug pattern is "LP-side removes liquidity from POOL" — pool events directly observe the loss. NFT-tracking is for ownership audits, not runtime rug detection. |
| getLogs pagination | Custom chunking with arbitrary 2000-block windows | Provider-aware chunking that respects each chain's cap (Alchemy free=10, Alchemy paid=unlimited, Infura paid=10k results, QuickNode paid=10k blocks) | Wrong cap → silent failures or hard 429s. See §5 for per-provider matrix. |
| Flashbots synthetic race | Custom mempool simulation | `eth_callBundle` against the Flashbots relay via existing `@flashbots/ethers-provider-bundle` | Already wired for buy bundles. Same `X-Flashbots-Signature` auth flow. |
| Allowlist freshness | Periodic refetch from Etherscan/Unicrypt API | Hardcoded base + restart-only env overlay (D-LIST-SOURCE) | Locker contracts are deployed once; addresses are stable for years. Periodic refetch adds API dependency without recurring signal. |

**Key insight:** Phase 19 is integration work, not greenfield. Every primitive needed
(WS listeners, prepared statements, ChainConfig extension, MEV submission, Telegram
alerts, dashboard WS push) already exists in v6.16 or Phase 18. The anti-rug module is
glue + a new dispatch loop + a new exit-trigger function — NOT a new framework.

## Runtime State Inventory

Phase 19 is a **greenfield feature addition**, not a rename / refactor / migration phase.
Section omitted per researcher discretion.

## Critical Findings (Read Before Planning)

### CRITICAL #1: Alchemy free-tier `getLogs` cap is 10 blocks, not 2000

The CONTEXT.md D-BACKFILL caps the backfill window at **2000 blocks** ("Alchemy
free-tier safe"). This is incorrect against current 2026-era documentation.

| Provider | Tier | `eth_getLogs` block-range cap | Source |
|----------|------|-------------------------------|--------|
| Alchemy | Free | **10 blocks per query** | [Alchemy eth_getLogs docs](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs) [VERIFIED] |
| Alchemy | Pay-As-You-Go | Unlimited (150 MB response cap) | Same source [VERIFIED] |
| Alchemy | Growth+ / Enterprise | Unlimited (150 MB response cap) | Same source [VERIFIED] |
| Infura | Free | Limited by 100k req/day and 10k-result cap per query | [Infura eth_getLogs docs](https://docs.infura.io/networks/ethereum/json-rpc-methods/eth_getlogs) [VERIFIED] |
| Infura | Paid | 10,000-result cap; concurrent-request limits | Same source [VERIFIED] |
| QuickNode | Free Trial | **5 blocks per query** | [QuickNode Understanding the 10k Block Range Limit](https://support.quicknode.com/hc/en-us/articles/10258449939473-Understanding-the-10-000-Block-Range-Limit-for-querying-Logs-and-Events) [VERIFIED] |
| QuickNode | Paid | 10,000 blocks per query | Same source [VERIFIED] |

**The bot uses Alchemy on ETH** (verified by reading `.env` — `ETH_RPC_URL` and
`ETH_WS_URL` resolve to Alchemy hosts). BSC/Base/Arb use non-Alchemy hosts (not
identified — likely public RPCs or Chainstack).

**Implication for the planner:**

- D-BACKFILL "cap window at 2000 blocks" must be revised downward OR the operator
  must upgrade Alchemy from Free to Pay-As-You-Go before going live on ETH.
- Recommended: chunked iteration. For a gap of K blocks, issue
  `ceil(K / CAP)` `getLogs` calls each spanning `CAP` blocks. CAP per chain comes from
  a new `<CHAIN>_ANTIRUG_BACKFILL_CAP_BLOCKS` env (default values: ETH=10 Alchemy free,
  500-2000 paid; BSC=500 conservative for public RPC; Base/Arb=500). Default in
  `CHAIN_TEMPLATES` should be the conservative-safe value, with operator override.
- A bot restart after a 1-hour outage on Alchemy free tier ETH = 300 blocks × 12 sec
  = 1 hour. Chunked at 10 blocks = 30 sequential `getLogs` calls. At ~200ms/call =
  6 seconds of backfill — acceptable but bursty.
- The **FAIL CLOSED on gap-exceeds-cap** semantic from CONTEXT.md is preserved; the
  cap is just smaller. Operator gets the `[GAP DETECTED]` Telegram either way; the
  difference is at what point the chunked iteration gives up and surfaces the gap.

[VERIFIED: Alchemy docs] [VERIFIED: QuickNode docs] [VERIFIED: Infura docs]

### CRITICAL #2: The correct Flashbots simulation method is `eth_callBundle`, not `flashbots_simulateBundle`

The CONTEXT.md D-RACE-TELEMETRY (b) names `flashbots_simulateBundle`. The actual
Flashbots-relay RPC method is **`eth_callBundle`** (a non-standard `eth_*` extension).
The MEV-Share variant is `mev_simBundle`. There is no method literally named
`flashbots_simulateBundle` on the mainnet relay.

| Method | Purpose | Auth | Where |
|--------|---------|------|-------|
| `eth_callBundle` | Simulate signed bundle against target block; returns gas + coinbaseDiff per tx | `X-Flashbots-Signature` header (EIP-191 of body) | [Flashbots Auction RPC Endpoints](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint) [VERIFIED] |
| `eth_sendBundle` | Submit signed bundle for inclusion | `X-Flashbots-Signature` header | Same source [VERIFIED] |
| `mev_simBundle` | MEV-Share matched-bundle simulation; richer return shape (profit, mevGasPrice) | `X-Flashbots-Signature` header | [Flashbots MEV-Share docs](https://docs.flashbots.net/flashbots-mev-share/searchers/sending-bundles) [VERIFIED] |

**Implication for the planner:**

- D-RACE-TELEMETRY (b) implementation uses `provider.send('eth_callBundle', [...params])`
  (via the existing `@flashbots/ethers-provider-bundle` provider OR via raw ethers
  send). The CONTEXT.md naming is a documentation slip — preserve the intent (synthetic
  race verdict on ETH), correct the method name.
- Required call shape:
  ```json
  {
    "jsonrpc": "2.0", "method": "eth_callBundle",
    "params": [{
      "txs": ["0x<signed_sell_tx>"],
      "blockNumber": "0x<targetBlockHex>",
      "stateBlockNumber": "latest",
      "timestamp": <optional unix ts>
    }],
    "id": 1
  }
  ```
- Response fields the telemetry consumes: `coinbaseDiff` (positive ⇒ would-have-included),
  `results[0].error` (error string from sim — drop the race verdict to "loss" if non-null),
  `bundleHash` (audit-trail).
- BSC/Base/Arb skip per CONTEXT.md — bloXroute exposes its own simulation surface and
  sequencer-ordered chains do not have block-builder race dynamics.

[VERIFIED: Flashbots Auction docs] [VERIFIED: ethers-provider-flashbots-bundle README]

### CRITICAL #3: V3 Burn event has `owner` not `to` — allowlist field differs from V2

Per the verified IUniswapV3PoolEvents.sol source (see §1.2 below), V3 `Burn` does NOT
have a `to` field. The first indexed parameter is `owner` (NFT-holder identity). The
allowlist check on V3 events must read different field names:

| Event | V2 | V3 |
|-------|-----|-----|
| Burn destination field | `to` (4th param, indexed) | `owner` (1st param, indexed) |
| Collect destination field | N/A | `recipient` (2nd param, NOT indexed) |

CONTEXT.md D-V3-ALLOWLIST correctly states this ("Check `owner` field on Burn (no `to`
on V3 Burn), `recipient` field on Collect"). Reproduced here to surface for the planner.

[VERIFIED: github.com/Uniswap/v3-core IUniswapV3PoolEvents.sol]

## §1: V2 + V3 Event Signatures (Verified)

### §1.1 — V2 Pair Events (Uniswap V2 / SushiSwap / PancakeSwap pair contracts)

```solidity
// From Uniswap/v2-core/contracts/UniswapV2Pair.sol — [VERIFIED: STACK.md sources]
event Burn(
    address indexed sender,
    uint256 amount0,
    uint256 amount1,
    address indexed to     // <-- ALLOWLIST CHECK: this is where the LP went
);

event Sync(uint112 reserve0, uint112 reserve1);  // fires alongside Burn; gives post-burn reserves

// LP token Transfer (the LP token is the pair contract itself, an ERC-20)
event Transfer(address indexed from, address indexed to, uint256 value);
// ANTIRUG-03 alternative pattern: Transfer(from=anyone, to=0xdEaD..., value=large)
// 0xdead address: 0x000000000000000000000000000000000000dEaD
```

**Event topic hashes (used in ethers v6 filters):**

```typescript
// Computed via ethers.id(...) — VERIFY in plan-phase
const PAIR_BURN_TOPIC = ethers.id('Burn(address,uint256,uint256,address)');
// Expected: 0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496
const PAIR_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
// Expected: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
// (the ERC-20 standard Transfer topic; identical across all ERC-20s)
```

**ABI fragment for ethers v6 `Contract`:**

```typescript
// Already present in src/utils/abis.ts as PAIR_ABI (re-use, do not duplicate)
const PAIR_BURN_EVENT_ABI = 'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)';
```

[VERIFIED: Uniswap v2-core UniswapV2Pair.sol via STACK.md cross-reference]

### §1.2 — V3 Pool Events (UniswapV3Pool contract)

Verified directly against
`github.com/Uniswap/v3-core/blob/main/contracts/interfaces/pool/IUniswapV3PoolEvents.sol`:

```solidity
event Burn(
    address indexed owner,      // <-- V3 ALLOWLIST CHECK (NFT-holder identity)
    int24 indexed tickLower,
    int24 indexed tickUpper,
    uint128 amount,             // amount of liquidity burned (NOT token0/token1)
    uint256 amount0,            // token0 owed to owner (NOT yet transferred)
    uint256 amount1             // token1 owed to owner (NOT yet transferred)
);

event Collect(
    address indexed owner,      // 1st indexed
    address recipient,          // <-- V3 ALLOWLIST CHECK on Collect (NOT indexed)
    int24 indexed tickLower,
    int24 indexed tickUpper,
    uint128 amount0,            // token0 actually transferred
    uint128 amount1             // token1 actually transferred
);

event Mint(
    address sender,
    address indexed owner,
    int24 indexed tickLower,
    int24 indexed tickUpper,
    uint128 amount,
    uint256 amount0,
    uint256 amount1
);

event Swap(
    address indexed sender,
    address indexed recipient,
    int256 amount0,
    int256 amount1,
    uint160 sqrtPriceX96,
    uint128 liquidity,          // <-- post-swap active liquidity at current tick (used for monitoring drift)
    int24 tick
);
```

**Key semantic distinctions vs V2:**

1. **V3 `Burn` does NOT move tokens.** It decreases position liquidity and credits the
   owner with `amount0`/`amount1` *owed* but pending. The actual transfer happens on
   `Collect`. This is why CONTEXT.md D-V3-EVENTS subscribes to BOTH.
2. **V3 has no LP token.** Positions are NFTs held by `owner`. Multi-signal AND chain
   suppresses Burn-without-Collect (legitimate fee-claim) naturally — `Collect` event
   with a recipient in the allowlist + reserves unchanged = no trigger.
3. **`pool.liquidity()` returns active liquidity at the current tick** — concentrated
   liquidity may straddle the tick or be entirely out-of-range. CONTEXT.md D-V3-THRESHOLD
   accepts this as the V3 baseline metric. (Alternative: aggregate `liquidityGross` over
   all ticks; rejected per CONTEXT.md complexity argument.)

**Event topic hashes (V3):**

```typescript
const POOL_BURN_TOPIC = ethers.id('Burn(address,int24,int24,uint128,uint256,uint256)');
const POOL_COLLECT_TOPIC = ethers.id('Collect(address,address,int24,int24,uint128,uint128)');
// Planner verifies in test/unit/v3Abis.test.ts (existing test file is the right home)
```

**ABI fragments:**

```typescript
const POOL_BURN_EVENT_ABI = 'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)';
const POOL_COLLECT_EVENT_ABI = 'event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)';
```

[VERIFIED: github.com/Uniswap/v3-core interfaces/pool/IUniswapV3PoolEvents.sol via WebFetch on 2026-05-23]

### §1.3 — `pool.liquidity()` semantics

```solidity
// From IUniswapV3PoolState.sol — VERIFIED in Phase 18 work; re-verify in plan-phase
function liquidity() external view returns (uint128);
// Returns the currently in-range liquidity available to the pool.
// "Active" means: at the current tick, only positions covering this tick contribute.
// A large swap that crosses ticks may change the active liquidity even without a Burn.
```

**Implication for D-V3-THRESHOLD:**

- Baseline snapshot at buy-success captures the active liquidity at the buy block's tick.
- A swap that moves the pool price across ticks WILL change `pool.liquidity()` even
  without a Burn. **Multi-signal AND chain protects against this false positive:**
  signal 1 trips (liquidity dropped), but signal 2 (destination check on swap doesn't
  apply — Swap has `recipient`, not a locker check) and signal 3 (`QuoterV2` sell-sim
  on real WETH for our position size) keep the pool functional.
- The actual rug pattern emits a `Burn` (signal 2 destination check fires) **and**
  drops `pool.liquidity()` (signal 1) **and** drops the QuoterV2 quote below threshold
  (signal 3). All three required.

[VERIFIED: Phase 18 RESEARCH.md V3 sections; CONTEXT.md D-V3-THRESHOLD]

## §2: Canonical Locker Addresses Per Chain

### §2.1 — V2 Locker Allowlist Sources

| Locker | Chain | Address | Source |
|--------|-------|---------|--------|
| UNCX/Unicrypt UniLockerV2 (Uniswap V2) | ETH | `0x59d7d55ddc58494fbbbca29904f108ece82ac7fb` | [VERIFIED: UNCX docs Liquidity Lockers V2](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v2) |
| UNCX UniLockerV2 (PancakeSwap V2) | BSC | `0xC765bddB93b0D1c1A88282BA0fa6B2d00E3e0c83` | [VERIFIED: UNCX docs + BscScan token-tagged contract](https://bscscan.com/address/0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83) |
| UNCX UniLockerV2 (Uniswap V2) | Base | `0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB` | [VERIFIED: UNCX docs](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v2) |
| UNCX UniLockerV2 (Uniswap V2) | Arbitrum | `0x63F4B2C082B1E0bbA38874567E053800379bF8D7` | [VERIFIED: UNCX docs](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v2) |
| TeamFinance / TrustSwap Lock | ETH | `0xe2fe530c047f2d85298b07d9333c05737f1435fb` | [VERIFIED: Etherscan token-tagged contract](https://etherscan.io/address/0xe2fe530c047f2d85298b07d9333c05737f1435fb) |
| PinkLock V2 (PinkSale Pink Lock) | ETH | `0x71b5759d73262fbb223956913ecf4ecc51057641` | [VERIFIED: Etherscan token-tagged contract + CertiK PinkLock02 record](https://etherscan.io/address/0x71b5759d73262fbb223956913ecf4ecc51057641) |
| PinkLock | ETH (older) | `0x33d4cc8716beb13f814f538ad3b2de3b036f5e2a` | [VERIFIED: Etherscan token-tagged contract](https://etherscan.io/address/0x33d4cc8716beb13f814f538ad3b2de3b036f5e2a) |
| PinkLock V2 | BSC | `0x407993575c91ce7643a4d4ccacc9a98c36ee1bbe` | [VERIFIED: BscScan token-tagged contract](https://bscscan.com/address/0x407993575c91ce7643a4d4ccacc9a98c36ee1bbe) |
| PinkLock (older) | BSC | `0x7ee058420e5937496f5a2096f04caa7721cf70cc` | [VERIFIED: BscScan token-tagged contract](https://bscscan.com/address/0x7ee058420e5937496f5a2096f04caa7721cf70cc) |

**Notes for planner:**

- All addresses must be **checksummed** at the source-of-truth in `chainRegistry.ts`.
  ethers v6 `getAddress(addr)` validates and normalizes checksum.
- Per D-LIST-VERIFY, every address gets a startup-time `getCode()` check. If any returns
  `0x` (EOA), FATAL exit. This catches a typo in the hardcoded list before the bot
  ever runs.
- TeamFinance V3 specific vault address NOT cleanly resolved from public sources for
  Base/Arb. **TeamFinance V3 NFT vault address per chain is a Wave-1 follow-up** —
  planner should accept null in `chainRegistry.ts` initially and resolve via Etherscan
  contract-tag verification during plan-phase. This mirrors Phase 18 D-FIXTURE
  null-block-pin pattern.
- 0xdEaD burn address: `0x000000000000000000000000000000000000dEaD` — universal across
  all chains; effectively an "allowlist of one" entry. Burn-to-dead is the canonical
  "permanently lock" pattern and must be in the allowlist.

### §2.2 — V3 Locker Allowlist Sources

| Locker | Chain | Address | Source |
|--------|-------|---------|--------|
| UNCX/Unicrypt V3 Locker (NFT-holding) | ETH | `0xFD235968e65B0990584585763f837A5b5330e6DE` | [VERIFIED: UNCX docs Liquidity Lockers V3](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v3) |
| UNCX V3 Locker | BSC | `0xfe88DAB083964C56429baa01F37eC2265AbF1557` | [VERIFIED: UNCX docs](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v3) |
| UNCX V3 Locker | Base | `0x231278eDd38B00B07fBd52120CEf685B9BaEBCC1` | [VERIFIED: UNCX docs](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v3) |
| UNCX V3 Locker | Arbitrum | `0x6b5360B419e0851b4b81644e0F63c1A9778f2506` | [VERIFIED: UNCX docs](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v3) |
| UNCX V3 "Proof of Reserves 2" | Arbitrum | `0xcb8b00d4018ad6031e28a44bf74616014bfb62ec` | [VERIFIED: Arbiscan token-tagged contract](https://www.arbiscan.io/address/0xcb8b00d4018ad6031e28a44bf74616014bfb62ec) |
| TeamFinance V3 NFT vault | ETH | `[ASSUMED — Wave-1 verify]` | [ASSUMED] TeamFinance docs reference V3 NFT support but no clean contract-tag address surfaced in public docs; planner verifies via TeamFinance app UI or contract enumeration at plan-phase |

**Notes for planner:**

- The UNCX V3 lockers hold the NonfungiblePositionManager NFT (token ID), not LP tokens.
  When a V3 position is locked, the NFT `owner` on the pool's `Burn` event is the locker
  address. This is exactly what D-V3-ALLOWLIST is designed to detect.
- The `Collect` event's `recipient` may differ from the NFT `owner` — the locker
  contract typically transfers fees to a configurable recipient. **The allowlist
  check on Collect should consider BOTH the `recipient` and the `owner`** — a Collect
  to a fresh EOA from a locked NFT is still a rug attempt by the locker operator
  (or compromised locker contract). Planner discretion: treat allowlist as either
  (a) owner-only — simpler, allowlists fees-to-fresh-EOA, or (b) recipient-AND-owner
  match — stricter, may have false positives on legitimate fee withdrawals.
  Recommendation: **(a) owner-only on Burn, owner-only on Collect** — matches CONTEXT.md
  D-V3-ALLOWLIST phrasing; revisit if dry-run shows false negatives.
- PinkLock V3 specific address not surfaced cleanly. The `0x71b5759d…57641` PinkLock02
  on ETH may handle V3 — Etherscan contract-source-read at plan-phase clarifies.
  Flag for Wave-1 verification.

[VERIFIED: UNCX docs] [VERIFIED: Arbiscan]
[ASSUMED: TeamFinance V3 NFT vault address per chain — needs Wave-1 verification]
[ASSUMED: PinkLock V3 specific address per chain — needs Wave-1 verification]

## §3: QuoterV2 Sell-Sim for V3 Third Signal

**Canonical addresses per chain** (from Uniswap V3 deployments docs):

| Chain | QuoterV2 Address | NonfungiblePositionManager | Source |
|-------|------------------|---------------------------|--------|
| ETH | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | [VERIFIED: developers.uniswap.org Ethereum deployments] |
| BSC | `[CITED: Uniswap V3 BSC deployments docs]` | `[CITED: same]` | Planner verifies addresses via Uniswap docs at plan-phase |
| Base | `[CITED: Uniswap V3 Base deployments docs]` | `[CITED: same]` | Same |
| Arb | `[CITED: Uniswap V3 Arbitrum deployments docs]` | `[CITED: same]` | Same |

The existing `chainRegistry.ts` already populates `quoterAddress` per chain on the V3
DexConfig entries (Phase 18 work — re-use, do not duplicate). Read
`ctx.chain.dexes.find(d => d.dexType === 'v3').quoterAddress`.

**Method signature for D-V3-SIGNAL3:**

```typescript
// V3_QUOTER_V2_ABI is already in src/utils/abis.ts (Phase 18 / earlier phases)
// Existing usage at src/bot.ts:569-577 calls it for buy-side slippage quote

interface QuoteExactInputSingleParams {
    tokenIn: string;        // OUR position's token (the rug-suspect)
    tokenOut: string;       // WETH (or chain native wrapped)
    amountIn: bigint;       // OUR remaining position balance (or a fixed probe amount)
    fee: number;            // V3 fee tier (500 / 3000 / 10000) — from lp_baseline row
    sqrtPriceLimitX96: bigint;  // 0n — no limit
}

// staticCall — does NOT consume gas; pure simulation against current state
const quoter = new Contract(quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);
const result = await quoter.quoteExactInputSingle.staticCall({
    tokenIn: targetToken,
    tokenOut: ctx.chain.wethAddress,
    amountIn: positionBalance,
    fee: feeTier,
    sqrtPriceLimitX96: 0n,
});

// QuoterV2 returns a tuple: (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
const amountOut = result[0]; // bigint — expected WETH out
const baselineExpected = /* stored on lp_baseline row OR re-computed from baseline */;
const slippageRatio = Number(amountOut * 10000n / baselineExpected) / 10000;  // 0.0-1.0+

const sellSimSlippageTrips = slippageRatio < 0.5;  // Signal 3 fires if <50% of baseline
```

**Cost considerations:**

- One `staticCall` per Burn/Collect event (V3) or per Burn / LP-Transfer event (V2 uses
  `pair.getReserves()` directly — different signal). RPC cost: one read per event.
- High-volume tokens fire Burn rarely (legitimate fee-claims are NOT Burn — they're
  `Collect` only). Estimated peak: 1-5 events/minute/position during volatile periods.
- Storing baseline `expected amountOut` at buy-time avoids re-computing the "expected"
  side each evaluation. Planner discretion on `lp_baseline.v3_baseline_quote_amount`
  field — adds clarity but optional (re-computing from `pool.liquidity()` snapshot is
  also viable).

**Edge cases:**

- **Pool becomes single-sided.** QuoterV2 will return a tiny `amountOut` (near zero)
  if the WETH side has been drained. This is exactly what signal 3 is meant to catch.
- **Multi-pool tokens.** A token may have V3 pools at multiple fee tiers
  (500/3000/10000). The bot's position is in ONE pool (recorded in `trades.fee_tier`).
  Only that pool's QuoterV2 quote is signal 3.
- **QuoterV2 reverts.** Empty pool or impossible swap → revert. Treat revert as Signal 3
  trip (sell impossible == reserves below threshold) per fail-closed discipline.

[VERIFIED: developers.uniswap.org ETH deployments]
[CITED: Uniswap V3 BSC/Base/Arb deployments — verify at plan-phase]

## §4: Real-Mainnet Historical Rug Fixtures

Per D-LIST-FIXTURE the planner needs at least 1 V2 + 1 V3 real pinned mainnet rug
in `test/fork/fixtures/rugs/{slug}.json`. Below are researcher-identified candidates;
**planner finalizes selection at plan-phase**.

### §4.1 — V2 Rug Fixture Candidates

#### Candidate A: HORSE token (RECOMMENDED — fully sourced)

| Field | Value |
|-------|-------|
| Slug | `eth-v2-horse` |
| Chain | ETH |
| Token symbol | HORSE |
| Pair address | `0x77A838d43Aa717b5C0eEd82E3A3078560e9429b3` |
| Pair type | V2 (Uniswap V2; pair contract IS the LP token) |
| LP-add block | 18401564 |
| **LP-removal block (the fixture target)** | **18401609** |
| LP-removal tx hash | `0xed945fa47225956c7dfdd7ec29fb4201f7a914bbdad2f81a7903f4726ebf3952` |
| LP removed | 641.34B HORSE for 1.090 WETH |
| Scammer address suffix | `…33b03A` |
| Pool lifespan | <10 minutes |
| Bug pattern | `lp-removal-no-allowlist` (the canonical 100% rug) |
| Source | [VERIFIED: Medium article "Understanding Rugpulls and Liquidity in Ethereum"](https://medium.com/@natelapinski/understanding-rugpulls-and-liquidity-in-ethereum-67765fcf2cb2) |

**Use:** Fork-pin to block 18401608 (one before removal); inject a synthetic bot
position on this pair; replay block 18401609; assert anti-rug detector fires multi-signal
verdict `unsafe` with `signals: { lpRemovedPct: >99, allowlistHit: 'unsafe', v2ReservePctBelow: >99 }`.

#### Candidate B: AnubisDAO (CONTEXT only — token launched on Sushiswap initially; complex case)

| Field | Value |
|-------|-------|
| Token | ANKH |
| Date | 28-29 Oct 2021 |
| Drained | 13,597 ETH (~$60M) |
| Notable | LP deployer held the LP tokens directly; cashed out 20h after launch |
| Stolen-funds wallet | `0x9fc53c75046900d1f58209f50f534852ae9f912a` |
| Suitability | Older; harder to pin block; useful as additional V2 case if HORSE proves insufficient |
| Source | [VERIFIED: The Block 2022](https://www.theblock.co/post/154004/anubisdao-funds-move-for-the-first-time-eight-months-after-rug-pull) [CITED: Bitcoinist](https://bitcoinist.com/nft-tycoon-tied-to-60million-rug-pull/) |

**Recommendation:** HORSE (Candidate A) is the **primary V2 rug fixture** for Phase 19.
It's a clean 100% rug at a known block, with verifiable on-chain artifacts. AnubisDAO
is documented here for context only — block-pin work would be substantial.

### §4.2 — V3 Rug Fixture Candidates

V3 rug fixtures are SIGNIFICANTLY HARDER to source than V2. Reasons:

1. V3 rugs are less common in the wild — most rugs use V2 (lower deploy cost, simpler
   tokenomics).
2. V3 "rug" patterns are slow-rug — `decreaseLiquidity` + `collect` over multiple txs.
   The Burn event fires when liquidity drops to a tick range; the Collect fires when
   tokens actually transfer out. Both events arrive in the same block or close blocks
   for a fast rug, but slow rugs may stretch over hours.
3. Public databases (honeypot.is, GoPlus) focus on V2; V3-specific rug feeds are
   thinner.

**Recommended approach — Wave-1 follow-up pattern (same as Phase 18 fixtures):**

- Plan-phase commits `test/fork/fixtures/rugs/eth-v3-CANDIDATE.json` with
  `tokenAddress: null`, `forkBlockNumber: null`, and notes pointing to discovery
  approaches below.
- Operator (Jack) backfills the address + block during the 7-day dry-run window using
  one of these discovery paths:
  1. **Honeypot.is V3 feed:** query their API for V3 entries flagged with
     "rugged_status".
  2. **DEX Screener "graveyard":** filter for V3 pools with `liquidity < $1000`
     created from a one-time `Mint` and now-zeroed `liquidity`.
  3. **Contrived fallback during fixture-resolution gap:** the
     `test/fixtures/contracts/RugPull.sol` V3 mode covers the integration assertions
     while the real fixture is being resolved (same fallback pattern as Phase 18).
- Schema for the V3 fixture JSON (extends the Phase 18 honeypots format):

```json
{
  "chain": "eth",
  "dexType": "v3",
  "tokenAddress": null,
  "poolAddress": null,
  "swapRouterAddress": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  "quoterAddress": "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  "nonfungiblePositionManager": "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  "feeTier": 3000,
  "lpAddBlock": null,
  "lpRemovalBlock": null,
  "removalTxHash": null,
  "destinationOnBurn": null,
  "destinationOnCollect": null,
  "expectedVerdict": "unsafe",
  "expectedSignals": {
    "lpRemovedPct": ">50",
    "allowlistHit": "unsafe",
    "sellSimSlippagePct": ">50"
  },
  "bugPattern": "v3-decrease-liquidity-then-collect",
  "notes": "Block-pin pending Wave-1 follow-up. Discovery via honeypot.is V3 API or DEX Screener V3 graveyard.",
  "discoveredVia": null,
  "discoveredOn": null
}
```

### §4.3 — Overlap with Phase 18 honeypot fixtures (no duplication)

Existing Phase 18 fixtures in `test/fork/fixtures/honeypots/`:

| Phase 18 fixture | Pattern | Phase 19 reuse? |
|------------------|---------|-----------------|
| `eth-max-wallet.json` | Max-wallet honeypot (sell-blocked via wallet limit) | NO — not a rug; pre-buy honeypot pattern |
| `eth-sell-revert.json` | Sell-revert honeypot (selective transfer-blacklist) | NO — not a rug; pre-buy honeypot |
| `eth-v3-honeypot.json` | V3 sell-tax-spike honeypot | NO — not a rug |

**No overlap.** Phase 19 needs fresh fixtures specifically capturing LP-removal events.
Honeypots and rugs are different attack vectors. The honeypot fixture format is the
schema template (Phase 19 schema extends it), but the fixture instances are net-new.

## §5: RPC `getLogs` Block-Range Limits Per Tier (CRITICAL)

**See Critical Finding #1 above.** Summary table reproduced for plan-phase reference:

| Provider | Chain coverage | Free tier `eth_getLogs` cap | Paid tier cap | Notes |
|----------|----------------|----------------------------|----------------|-------|
| **Alchemy** | ETH, Base, OP, Arb, World, zkSync, BSC, Polygon, Linea | **10 blocks/query (free)** | Unlimited (paid; 150 MB response cap) | The bot uses Alchemy on ETH per `.env`. **D-BACKFILL 2000-block cap is invalid on free tier; reduce to 10 OR upgrade tier before going live.** |
| **Infura/MetaMask** | ETH + L2s | 10,000-result cap on the response, NOT a block-count cap; concurrent-request limits | Same | Different limit shape than Alchemy. |
| **QuickNode** | ETH + L2s | 5 blocks/query (Free Trial) | 10,000 blocks (paid) | Free tier extremely restrictive. |
| **Chainstack** | ETH + L2s | Documented per-plan | 10,000+ blocks (paid) | Bot may use Chainstack on non-ETH chains; verify. |
| **Public RPCs** (PancakeSwap pool dataseed for BSC, etc.) | BSC, Polygon | Provider-specific; often <100 blocks | N/A | Rate-limited; large `getLogs` calls likely to 429 or timeout. |

**Recommendation for planner:**

- Add per-chain env `<CHAIN>_ANTIRUG_BACKFILL_CAP_BLOCKS` with conservative defaults:
  - ETH: 10 (Alchemy free-tier safe) — operator overrides to 2000+ on upgrade
  - BSC: 500 (conservative for public/Chainstack)
  - Base: 500
  - Arb: 500
- Implementation: chunked iteration. For gap K, issue
  `Math.ceil(K / CAP)` `getLogs` calls.
- Hard ceiling: if K > `<CHAIN>_ANTIRUG_MAX_BACKFILL_BLOCKS` (default 7200 = 1 day on ETH),
  surface `[GAP DETECTED]` and STOP — operator manually triages whether to skip the
  gap or risk hammering the RPC.

[VERIFIED: Alchemy, QuickNode, Infura docs]

## §6: WebSocket Heartbeat Pattern (`ws@^8.20.0` + ethers v6)

### §6.1 — Recommended pattern from the official `ws` README

```typescript
// Source: ws library README "How to detect and close broken connections"
// https://github.com/websockets/ws  (VERIFIED via WebSearch)

function heartbeat(this: WebSocket) {
    (this as any).isAlive = true;
}

// On open / connection:
const ws: WebSocket = (ctx.wsProvider as any).websocket;  // ethers v6 exposes raw ws
(ws as any).isAlive = true;
ws.on('pong', heartbeat);

// Periodic check:
const heartbeatInterval = setInterval(() => {
    if ((ws as any).isAlive === false) {
        ctx.log.warn({ chain: ctx.chain.name }, 'WS heartbeat dead — terminating');
        return ws.terminate();  // triggers 'close' which triggers reconnect path
    }
    (ws as any).isAlive = false;
    ws.ping();
}, 30_000);

// On close (existing reconnect path at bot.ts:686-707):
ws.on('close', () => clearInterval(heartbeatInterval));
```

### §6.2 — Reconnect → resubscribe → backfill flow

The existing pattern at `bot.ts:644-752` already implements (a) WS close detection,
(b) exponential backoff reconnect, (c) re-subscribing to PairCreated/PoolCreated.
Phase 19 extends this pattern with backfill:

```
[On WS close]
  ↓ clearInterval(heartbeatInterval)
  ↓ exponential backoff (existing 1s → 60s pattern)
  ↓ new WebSocketProvider + reconnect
[On WS open]
  ↓ re-subscribe to anti-rug topic filter (covering all open positions)
  ↓ NEW: backfill via getLogs(lastSeenBlock+1, currentBlock)
  ↓       chunked by <CHAIN>_ANTIRUG_BACKFILL_CAP_BLOCKS
  ↓       FAIL CLOSED if gap exceeds <CHAIN>_ANTIRUG_MAX_BACKFILL_BLOCKS
  ↓ for each event in backfill window:
  ↓   evaluate signals; if 'unsafe', log 'too-late' would-have-sold event
  ↓                    (do NOT fire live exit per CONTEXT.md D-BACKFILL)
  ↓ resume streaming
```

### §6.3 — Interval and timeout recommendations

| Parameter | Value | Source |
|-----------|-------|--------|
| Ping interval | 30 seconds | [ws README] official recommendation; matches CONTEXT.md ANTIRUG-12 "default 30s" |
| Pong timeout | One ping interval (no pong before next ping → dead) | [ws README] standard pattern |
| Reconnect initial delay | 1 second | Existing pattern at `bot.ts:682` |
| Reconnect max delay | 60 seconds | Existing pattern at `bot.ts:683` |
| Heartbeat-dead → reconnect | Immediate via `ws.terminate()` | [ws README] |

**Per-provider context:**

- Alchemy and Infura close idle WS connections after ~5 minutes silence. Ping every 30s
  keeps them alive.
- Pong frames are sent automatically by the WebSocket protocol; no application-level
  acknowledgement needed — `ws.on('pong', heartbeat)` just notes the response arrived.
- Half-open connections (NAT timeout, mobile network switch) are the failure mode
  heartbeat detects. Without it, ethers v6 silently stops receiving events.

[VERIFIED: ws README "How to detect and close broken connections"]
[VERIFIED: ethers-io/ethers.js#1053 — no built-in heartbeat in ethers v6]

## §7: Existing Code Asset Audit

Confirms the assets CONTEXT.md `<code_context>` lists are present and usable:

| Asset | Location | Phase 19 use |
|-------|----------|--------------|
| `executeFullSell` signature | `src/exitEngine.ts:424-519`; reason union at line 429 | Extend reason union to include `'anti-rug'`. [VERIFIED via direct file read] |
| `tryAcquireSellLock` mutex | `src/exitEngine.ts:433-436` + `src/utils/exitManager.ts` | Anti-rug acquires lock; another exit holding lock → no-op + structured pino log. [VERIFIED] |
| Schema migration framework | `src/utils/db.ts:27-123` | Append v4→v5 step for `lp_baseline`. [VERIFIED] |
| `ChainConfig` extension pattern | `src/chainRegistry.ts:54-80` (already has `honeypotChecker`) | Add `antiRug` field per chain with gas multiplier + thresholds + allowlist references. [VERIFIED] |
| Existing WS reconnect at factory | `src/bot.ts:644-752` | Pattern to copy + extend with heartbeat + backfill. [VERIFIED] |
| Per-chain env-overridable thresholds | Phase 18 `ETH_MAX_BUY_TAX_BPS` etc. | Template for new `<CHAIN>_ANTIRUG_*` envs. [VERIFIED] |
| `sendCtxAlert` + structured pino | `src/utils/notifier.ts` + module-level child loggers | D-VIS-* and D-LIST-AUDIT use existing helpers. [VERIFIED] |
| Discriminated-union return pattern | Phase 18 `HoneypotResult` in `src/utils/honeypot/types.ts` | Template for new `RugEvaluation` discriminated union. [VERIFIED] |
| Buy-success → startExitMonitor attach site | V2: `bot.ts:332-341` (specifically `:406` call); V3: `bot.ts:522-530` (specifically `:641` call) | Parallel attach for `startAntiRugMonitor`. [VERIFIED via direct file read] |
| Existing test layout | `test/unit/` + `test/integration/` + `test/fork/` + `test/fork/fixtures/` | Anti-rug tests file into existing projects. No new vitest project needed. [VERIFIED] |
| `vitest.config.ts` projects | unit / integration / fork (no new project needed) | [VERIFIED] |

## §8: Flashbots `eth_callBundle` for Synthetic Race Telemetry

**See Critical Finding #2 above.** Implementation sketch for the D-RACE-TELEMETRY (b)
path:

```typescript
// src/anti-rug/raceTelemetry.ts (NEW — ETH only)
// Source: [VERIFIED: docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint]

import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';

interface RaceVerdict {
    method: 'eth_callBundle';
    chain: 'eth';
    targetBlock: number;
    coinbaseDiff: bigint;          // > 0n => bundle would have been profitable / included
    bundleHash: string;            // audit trail
    error: string | null;          // populated if sim revert
    verdict: 'would-have-won' | 'would-have-lost' | 'error';
}

async function simulateFlashbotsRace(
    ctx: ChainContext,
    signedSellTxHex: string,
    targetBlock: number,
): Promise<RaceVerdict> {
    if (ctx.chain.name !== 'eth') {
        throw new Error('Flashbots simulation only on ETH');  // BSC/Base/Arb skip per CONTEXT.md
    }

    // Use the existing Flashbots provider from MEV bundle wiring
    const fbProvider = await FlashbotsBundleProvider.create(
        ctx.httpProvider,
        flashbotsAuthSigner,
        'https://relay.flashbots.net',
    );

    const sim = await fbProvider.simulate(
        [signedSellTxHex],
        targetBlock,
        'latest',  // stateBlockNumber
    );

    if ('error' in sim) {
        return { method: 'eth_callBundle', chain: 'eth', targetBlock, coinbaseDiff: 0n, bundleHash: '', error: sim.error.message, verdict: 'error' };
    }

    const coinbaseDiff = BigInt(sim.coinbaseDiff);
    return {
        method: 'eth_callBundle',
        chain: 'eth',
        targetBlock,
        coinbaseDiff,
        bundleHash: sim.bundleHash,
        error: null,
        verdict: coinbaseDiff > 0n ? 'would-have-won' : 'would-have-lost',
    };
}
```

**Notes:**

- `coinbaseDiff > 0` is a proxy for "would the bundle have been included" — a non-zero
  positive value means the bundle paid the block builder more than competing
  transactions. This is the **race verdict signal** D-RACE-TELEMETRY needs.
- The simulation runs in dry-run only; production live-execute exits use the existing
  `sendTxWithRetry` MEV path, not `eth_callBundle` directly.
- Flashbots auth key already configured (`FLASHBOTS_AUTH_KEY` env per `src/config.ts:23`).
  No new auth wiring.
- BSC/Base/Arb path: skip with structured pino log; the race-telemetry tile shows
  `'N/A — chain not supported'` for those chains.

[VERIFIED: Flashbots Auction docs]
[VERIFIED: @flashbots/ethers-provider-bundle README]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-position WS subscriptions (one `pair.on('Burn', ...)` per open position) | Single-listener-per-chain with internal dispatch | Phase 19 inception | 4× chain × 10 positions × 2 events = 80 → 4 subscriptions total. Stays under Alchemy/Infura free-tier caps; no silent drop. |
| Single-event trigger (Burn → exit) | Multi-signal AND chain (LP-removed + allowlist + reserves/sell-sim) | Phase 19 inception | Eliminates false positives on V2→V3 migrations, lock transfers, multisig rebalances. |
| Boolean `Promise<boolean>` safety return | Discriminated-union `RugEvaluation` with `verdict: 'safe' \| 'unsafe' \| 'allowlisted' \| 'unknown'` | Phase 17 D-13/14 → Phase 18 HoneypotResult → Phase 19 RugEvaluation | Vacuous-pass unrepresentable in type system. Pitfall #1 mitigated by construction. |
| Direct `wallet.sendTransaction` for emergency exits | Bridge via `executeFullSell` reason-union extension | Phase 19 D-bridge | Reuses sell lock, receipt decoding, DB cleanup, Telegram alerts. No parallel exit path. |
| Hardcoded 2000-block backfill cap | Per-chain configurable cap respecting actual RPC tier limits | Phase 19 plan-phase (revising CONTEXT.md D-BACKFILL) | Alchemy free is 10 blocks, not 2000. Chunked iteration + FAIL CLOSED on gap exceeds. |
| `flashbots_simulateBundle` (misnomer) | `eth_callBundle` against the Flashbots relay | Phase 19 research correction | The method exists and works; the name was a documentation slip. |

**Deprecated/outdated:**

- Trusting CONTEXT.md "Alchemy free-tier safe 2000 blocks" — superseded by current
  Alchemy docs (10 blocks free, unlimited paid).
- The phrase `flashbots_simulateBundle` — use `eth_callBundle` (auction relay) or
  `mev_simBundle` (MEV-Share). Phase 19 uses auction relay path.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TeamFinance V3 NFT vault per-chain address | §2.2 | Allowlist misses TeamFinance V3 lockers → false-positive exits on legitimate V3 lock transfers. **Mitigation:** Wave-1 follow-up backfill; planner accepts null in `chainRegistry.ts` initially. Tolerable because UNCX V3 lockers (verified) catch the majority of V3 locks. |
| A2 | PinkLock V3 specific address per chain (V2-style PinkLock02 may or may not handle V3) | §2.2 | Same as A1 — false positive on PinkLock V3 transfers. **Mitigation:** Wave-1 follow-up; PinkLock00..02 V2 lockers verified, V3 explicit address is the gap. |
| A3 | Uniswap V3 QuoterV2 / NonfungiblePositionManager addresses on BSC/Base/Arb | §3 | Bot reads `ctx.chain.dexes.find(...).quoterAddress` — already populated by Phase 18 / earlier phases. **Mitigation:** Test in `test/integration/honeypotDispatch.test.ts` already exercises this surface; Phase 19 inherits the verified per-chain values. |
| A4 | V3 rug fixture token candidates | §4.2 | Without a real V3 fork-test fixture, V3 detector coverage rests on the contrived `RugPull.sol` only. **Mitigation:** Wave-1 follow-up backfill during 7-day dry-run; contrived V3 mode is a sufficient fallback (matches Phase 18 D-FIXTURE pattern). |
| A5 | `eth_callBundle` is the correct method (CONTEXT.md says `flashbots_simulateBundle`) | §8, Critical #2 | Telemetry tile shows wrong race verdict if implemented against a non-existent method. **Mitigation:** Method verified against Flashbots Auction docs; planner uses `eth_callBundle`. |
| A6 | The 2000-block backfill cap is wrong for Alchemy free | §5, Critical #1 | Backfill calls hard-429 or silently truncate. **Mitigation:** Reduce cap to 10 OR upgrade Alchemy tier before live; chunked iteration + FAIL CLOSED. |
| A7 | `pool.liquidity()` baseline is sufficient for V3 threshold detection (vs aggregating `liquidityGross` over all ticks) | §1.3 | False positives if pool sees a normal price-cross-tick event during high volatility. **Mitigation:** Multi-signal AND chain — signal 2 (no allowlist hit on a Swap-only event) and signal 3 (QuoterV2 still quotes >50% baseline) suppress this naturally. |
| A8 | `eth.callBundle` `coinbaseDiff > 0` is a sufficient race-win proxy | §8 | The telemetry might be optimistic — a positive `coinbaseDiff` means the bundle was profitable to a builder, not that it would have beaten a competing rug tx. **Mitigation:** Telemetry is dry-run-only; the operator reviews the distribution; absolute accuracy is not load-bearing. |

If A1-A4 turn out wrong, Phase 19 still ships safely — they affect false-positive
rates, not capital-loss prevention. A5-A6 are CRITICAL planner inputs.

## Open Questions

1. **`lp_baseline` schema discriminator shape (3 options).**
   - What we know: CONTEXT.md authorizes "Claude's discretion within additive only, no
     existing tables modified." Three viable shapes: (a) single table with
     nullable V2+V3 columns + `pool_type` discriminator, (b) `pool_type` column +
     JSON column for type-specific fields, (c) separate `lp_baseline_v2` /
     `lp_baseline_v3` tables.
   - What's unclear: Which shape minimizes future-maintenance cost when v6.18 adds
     "tax-change detection" reusing baseline data.
   - Recommendation: **(a) single table with nullable type-specific columns + CHECK
     constraint** matches the existing v3 migration pattern in `db.ts:64-110` (which
     uses CHECK constraints heavily). Planner can choose (c) if separation feels cleaner
     — both shapes are valid per CONTEXT.md.

2. **Race telemetry path on BSC.**
   - What we know: bloXroute has a private mempool but their simulation surface is
     `blxr_simulate_bundle` (different protocol, different auth, requires bloXroute
     API key).
   - What's unclear: Whether the operator wants D-RACE-TELEMETRY (b) extended to
     bloXroute on BSC, or accepts the "skip" default per CONTEXT.md.
   - Recommendation: Honor CONTEXT.md — skip on BSC. Telemetry can be extended in v6.18
     if dry-run BSC data proves valuable.

3. **`v3_position_nft_id` capture timing.**
   - What we know: For V3 buys, the `NonfungiblePositionManager` mints an NFT to the
     buyer (the bot wallet). The NFT ID is in the `IncreaseLiquidity` event from the
     manager, NOT directly available at SwapRouter02 exit time.
   - What's unclear: Whether `lp_baseline` captures the NFT ID at buy-success (extra
     `provider.getLogs` call) or treats the V3 baseline as pool-only (ignoring NFT
     ownership).
   - Recommendation: **Treat V3 baseline as pool-only** — the rug pattern is "LP-side
     removes from pool" which is observable at the pool level without NFT tracking.
     NFT ownership audits are a v6.18+ ANTIRUG-V2 feature.

4. **TeamFinance V3 + PinkLock V3 address resolution timing.**
   - What we know: Verified addresses absent from clean public docs (see §2.2).
   - Recommendation: Plan-phase accepts these as Wave-1 follow-up entries with
     `chainRegistry.ts` null values, mirroring Phase 18's null-block-pin pattern in
     `test/fork/fixtures/honeypots/README.md`. Document in
     `docs/operations/anti-rug-rollout.md` so the operator knows to resolve during
     dry-run.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ws@^8.20.0` | Heartbeat (ANTIRUG-12) | ✓ | 8.20.0 (top-level dep) | — |
| `ethers@6.16.0` | Event decoding, RPC | ✓ | 6.16.0 | — |
| `better-sqlite3@^12.8.0` | `lp_baseline` migration | ✓ | 12.8.0 | — |
| `@flashbots/ethers-provider-bundle@1.0.0` | `eth_callBundle` race telemetry | ✓ | 1.0.0 | Skip (BSC/Base/Arb) |
| `pino@^10.3.1` | Structured logging | ✓ | 10.3.1 | — |
| `vitest@^4.1.1` | Tests | ✓ | 4.1.1 | — |
| `hardhat@2.26.0` + solc 0.8.28 | `RugPull.sol` fixture compile | ✓ | 2.26.0 | — |
| Alchemy ETH RPC (`ETH_RPC_URL` / `ETH_WS_URL`) | WS subs + backfill | ✓ | Free or paid (operator confirms) | **If free: 10-block backfill cap. If paid: 2000+ ok.** |
| Flashbots relay (`relay.flashbots.net`) | `eth_callBundle` ETH telemetry | ✓ | Already wired (Phase 14 FIX-09) | Skip dry-run (b) on RPC failure |
| BSC bloXroute (BSC MEV) | NOT used by anti-rug telemetry (BSC skips) | ✓ | Already wired | — |
| Base/Arb providers | WS subs only (no MEV simulation) | ✓ | Existing | HTTP polling fallback (existing) |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:**

- If operator's Alchemy plan is **Free**, the D-BACKFILL 2000-block cap MUST be reduced
  to 10 OR the operator must upgrade tier before going live on ETH. Phase 19 plan-phase
  surfaces this as an operator decision in `docs/operations/anti-rug-rollout.md`.
- D-RACE-TELEMETRY (b) skips BSC/Base/Arb explicitly per CONTEXT.md.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@4.1.1` (existing) |
| Config file | `vitest.config.ts` (existing — 3 projects: unit / integration / fork) |
| Quick run command | `npx vitest run --project unit --reporter=verbose` (per-task; <5s) |
| Full suite command | `npm run test:all` (all 3 projects; ~3-5 min) |
| Fork command | `npm run test:fork` (fork tests only; ~60-120s) |

### Phase Requirements → Test Map

Per ANTIRUG-01..16 (12 existing + 4 proposed V3 requirements):

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ANTIRUG-01 | Single-listener-per-chain WS subscription created on chain startup | unit | `npx vitest run --project unit test/unit/antiRugDetector.test.ts -t 'single-listener'` | ❌ Wave 0 |
| ANTIRUG-02 | `Pair.Burn` event filter wires to internal dispatch; subscribed pair addresses match open positions | integration | `npx vitest run --project integration test/integration/antiRugV2Subscription.test.ts -t 'pair-burn-dispatch'` | ❌ Wave 0 |
| ANTIRUG-03 | LP `Transfer(to=0xdEaD..., value=large)` triggers signal-1 evaluation | unit | `npx vitest run --project unit test/unit/antiRugDetector.test.ts -t 'lp-transfer-to-dead'` | ❌ Wave 0 |
| ANTIRUG-04 | Schema migration v4→v5 creates `lp_baseline` table; existing tables unchanged | unit | `npx vitest run --project unit test/unit/db.test.ts -t 'v4-to-v5 lp_baseline'` | ❌ Wave 0 (extends existing `db.test.ts`) |
| ANTIRUG-05 | Multi-signal AND: trigger fires only when ALL THREE signals true; one signal false → no trigger | unit | `npx vitest run --project unit test/unit/antiRugDetector.test.ts -t 'multi-signal-and'` | ❌ Wave 0 |
| ANTIRUG-06 | Allowlist hit suppresses signal 2; allowlist miss with empty `getCode()` FATAL at startup | unit + integration | `npx vitest run --project unit test/unit/antiRugAllowlist.test.ts && npx vitest run --project integration test/integration/antiRugStartupVerify.test.ts` | ❌ Wave 0 |
| ANTIRUG-07 | Confirm-after-N-blocks delay schedules re-evaluation; no immediate exit on signal-trip | unit | `npx vitest run --project unit test/unit/antiRugDetector.test.ts -t 'confirm-after-n'` | ❌ Wave 0 |
| ANTIRUG-08 | Bridge invokes `exitEngine.executeFullSell` with `reason: 'anti-rug'`; elevated gas multiplier applied | integration | `npx vitest run --project integration test/integration/antiRugExitBridge.test.ts -t 'execute-full-sell-anti-rug'` | ❌ Wave 0 |
| ANTIRUG-09 | Circuit breaker disables anti-rug after N triggers in W hours; manual reset via dashboard endpoint | integration | `npx vitest run --project integration test/integration/antiRugCircuitBreaker.test.ts -t 'auto-disable && manual-reset'` | ❌ Wave 0 |
| ANTIRUG-10 | Dry-run mode logs would-have-sold pino + Telegram + dashboard tile; no `executeFullSell` call | integration | `npx vitest run --project integration test/integration/antiRugDryRun.test.ts -t 'no-execute-when-dry-run'` | ❌ Wave 0 |
| ANTIRUG-11 | WS reconnect re-subscribes filter; `getLogs` backfill chunked by cap; FAIL CLOSED on gap-exceeds-max | integration | `npx vitest run --project integration test/integration/antiRugReconnect.test.ts -t 'reconnect-resubscribe-backfill'` | ❌ Wave 0 |
| ANTIRUG-12 | Heartbeat ping every 30s; no-pong → `ws.terminate()` → reconnect | integration | `npx vitest run --project integration test/integration/antiRugHeartbeat.test.ts -t '30s-ping-timeout'` | ❌ Wave 0 |
| **ANTIRUG-13** | V3 `UniswapV3Pool.Burn` + `Collect` event subscription wires to dispatch | integration | `npx vitest run --project integration test/integration/antiRugV3Subscription.test.ts -t 'pool-burn-collect-dispatch'` | ❌ Wave 0 |
| **ANTIRUG-14** | V3 multi-signal AND: `pool.liquidity()` drop + non-allowlisted `owner`/`recipient` + QuoterV2 sell-sim <50% → trigger | unit | `npx vitest run --project unit test/unit/antiRugDetectorV3.test.ts -t 'v3-multi-signal'` | ❌ Wave 0 |
| **ANTIRUG-15** | V3 locker allowlist hit on `owner` field of Burn / Collect suppresses trigger | unit | `npx vitest run --project unit test/unit/antiRugAllowlist.test.ts -t 'v3-locker-owner'` | ❌ Wave 0 |
| **ANTIRUG-16** | `lp_baseline` row stores V2 (reserves + LP supply) OR V3 (active liquidity + tick + fee tier) per pool_type | unit | `npx vitest run --project unit test/unit/antiRugLpBaseline.test.ts -t 'v2-v3-schema-discriminator'` | ❌ Wave 0 |

**Fork tests (real-mainnet replay):**

| Test | Behavior | Command | File |
|------|----------|---------|------|
| HORSE V2 rug replay | At block 18401608, inject synthetic bot position on HORSE pair; replay 18401609 LP-removal; assert detector fires verdict `unsafe` and `executeFullSell` called with `reason='anti-rug'` | `npx vitest run --project fork test/fork/antiRug.horse.fork.test.ts` | ❌ Wave 0 |
| V2→V3 migration NOT trigger | Construct fork where V2 LP burn coincides with V3 pool creation for same pair; assert detector returns `verdict: 'safe'` (signal 2 destination is allowlisted OR signal 3 reserves don't drop) | `npx vitest run --project fork test/fork/antiRug.v2v3migration.fork.test.ts` | ❌ Wave 0 |
| Lock-contract transfer NOT trigger | LP burn destination = UNCX UniLockerV2 address; assert `verdict: 'allowlisted'`, structured log emits `lockerName: 'Unicrypt UniLockerV2 ETH'` | `npx vitest run --project fork test/fork/antiRug.lockerTransfer.fork.test.ts` | ❌ Wave 0 |
| V3 contrived rug replay (fallback) | `test/fixtures/contracts/RugPull.sol` V3 mode; LP burn from non-allowlisted owner; `pool.liquidity()` drops; QuoterV2 quote drops; assert multi-signal trigger | `npx vitest run --project fork test/fork/antiRug.v3Contrived.fork.test.ts` | ❌ Wave 0 |
| V3 real rug replay (Wave-1 follow-up) | Real V3 rug fixture from §4.2 once resolved | `npx vitest run --project fork test/fork/antiRug.v3Real.fork.test.ts` | ❌ Pending fixture resolution |
| WS disconnect → backfill | Force-kill WS mid-test; verify reconnect re-subscribes AND `getLogs` backfill replays the missed events as `'too-late'` | `npx vitest run --project integration test/integration/antiRugWsKill.test.ts` | ❌ Wave 0 |
| Schema migration roundtrip | Open `data/test-bot-v4.db`; run migration; assert `lp_baseline` table exists, existing tables unchanged | `npx vitest run --project unit test/unit/db.test.ts -t 'v4-to-v5 migration'` | ❌ Wave 0 |
| Heartbeat dead-connection detection | Mock WS that stops responding to pong; assert `ws.terminate()` called after timeout; reconnect fires | `npx vitest run --project integration test/integration/antiRugHeartbeat.test.ts -t 'dead-connection'` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run --project unit --reporter=verbose` (typically <5s)
- **Per wave merge:** `npm run test:integration && npm run test:unit` (~30s combined)
- **Phase gate:** `npm run test:all` (full suite green) before `/gsd:verify-work`. Fork
  tests run on-demand (`npm run test:fork`) due to 60-120s cost; CI green is gating.

### Wave 0 Gaps

- [ ] `test/unit/antiRugDetector.test.ts` — multi-signal logic, signal-evaluation,
  confirm-after-N
- [ ] `test/unit/antiRugAllowlist.test.ts` — hardcoded base + env overlay + getCode()
  startup verification
- [ ] `test/unit/antiRugLpBaseline.test.ts` — V2 + V3 schema discriminator
- [ ] `test/unit/antiRugDetectorV3.test.ts` — V3-specific signals, QuoterV2 mock
- [ ] `test/integration/antiRugV2Subscription.test.ts` — V2 Pair.Burn dispatch
- [ ] `test/integration/antiRugV3Subscription.test.ts` — V3 Pool.Burn + Collect dispatch
- [ ] `test/integration/antiRugExitBridge.test.ts` — `executeFullSell` bridge with mock
  exitEngine
- [ ] `test/integration/antiRugCircuitBreaker.test.ts` — counter + window + reset
- [ ] `test/integration/antiRugDryRun.test.ts` — dry-run telemetry, no executeFullSell call
- [ ] `test/integration/antiRugReconnect.test.ts` — reconnect/resubscribe/backfill flow
- [ ] `test/integration/antiRugHeartbeat.test.ts` — 30s ping interval + timeout +
  terminate
- [ ] `test/integration/antiRugStartupVerify.test.ts` — startup getCode() check + FATAL
  exit on empty code
- [ ] `test/integration/antiRugWsKill.test.ts` — WS kill mid-test + backfill semantics
- [ ] `test/fork/antiRug.horse.fork.test.ts` — V2 HORSE rug fixture replay
- [ ] `test/fork/antiRug.v2v3migration.fork.test.ts` — V2→V3 migration no-trigger
- [ ] `test/fork/antiRug.lockerTransfer.fork.test.ts` — lock-contract transfer
  allowlisted
- [ ] `test/fork/antiRug.v3Contrived.fork.test.ts` — V3 contrived rug via `RugPull.sol`
- [ ] `test/fork/antiRug.v3Real.fork.test.ts` — V3 real rug (Wave-1 follow-up)
- [ ] `test/fixtures/contracts/RugPull.sol` — contrived V2 + V3 rug-pull contract
- [ ] `test/fork/fixtures/rugs/eth-v2-horse.json` — HORSE V2 fixture (block 18401609)
- [ ] `test/fork/fixtures/rugs/eth-v3-CANDIDATE.json` — V3 fixture with null
  `tokenAddress`/`blockNumber` for Wave-1 resolution
- [ ] `test/fork/fixtures/rugs/README.md` — schema doc (modeled on
  `test/fork/fixtures/honeypots/README.md`)
- [ ] `test/unit/db.test.ts` — extend with v4→v5 migration assertions (existing file;
  no new file)

## Security Domain

`security_enforcement` not explicitly set in `.planning/config.json` → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes (for dashboard reset endpoint) | Existing `DASHBOARD_API_KEY` Bearer auth (Phase 8) — extend to anti-rug CB reset |
| V3 Session Management | no (no user sessions; operator-only dashboard) | — |
| V4 Access Control | yes (dashboard CB reset) | Existing `DASHBOARD_API_KEY` gate; same pattern as `npm run pause`/`resume` (Phase 20 OPS-LIVE-11) |
| V5 Input Validation | yes | env-var validation in `config.ts` validator; `getAddress()` checksum normalization; `getCode()` non-zero check on allowlist |
| V6 Cryptography | yes | Flashbots `X-Flashbots-Signature` — existing wired via `@flashbots/ethers-provider-bundle`; do NOT hand-roll |

### Known Threat Patterns for crypto-snipe-bot stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Allowlist spoofing (operator misspells env var → wrong address) | Tampering | Startup `getCode()` check; EOA = FATAL; pino dump of merged allowlist + provenance |
| Anti-rug false positive cascades panic-sells across portfolio | Denial-of-service-by-defense | Multi-signal AND chain + circuit breaker (per-chain trigger counter) + confirm-after-N-blocks + dry-run-7-days gate |
| WS subscription leak (per-position subs hit free-tier cap) | DoS | Single-listener-per-chain pattern (Pitfall #10) |
| Stale events on backfill firing live exits | Tampering | D-BACKFILL tags backfilled events as `'too-late'`; no live execute on stale signals |
| Hot-reloadable allowlist (an attacker who gets dashboard access adds malicious destinations) | Elevation of Privilege | Restart-only env overlay (D-LIST-SOURCE); not hot-mutable |
| `executeFullSell` reason union allowing unauthorized 'anti-rug' triggers | Tampering | Sell lock (`tryAcquireSellLock`) + reason union is internal to exitEngine; not callable from dashboard |
| Flashbots `eth_callBundle` simulation costs ETH gas | Spoofing the operator's wallet | `eth_callBundle` is a simulation — does NOT submit tx; no gas consumed. Telemetry-only. |
| RPC provider returning manipulated event logs | Tampering | Phase 18's defense-in-depth — third-party APIs in parallel bank still run; anti-rug events cross-checked against `pair.getReserves()` (V2) or `pool.liquidity()` (V3) directly |
| Operator accidentally flips ETH live before 7 days | Elevation (operator error) | D-LIVE-GATE 7-day floor + 0-FP requirement; env-flag-flip + bot-restart pattern (not hot-flip) ensures operator sees the change |

## Sources

### Primary (HIGH confidence)

- `github.com/Uniswap/v3-core/blob/main/contracts/interfaces/pool/IUniswapV3PoolEvents.sol`
  — V3 Burn / Collect / Mint / Swap event signatures (VERIFIED via WebFetch
  2026-05-23)
- [docs.uncx.network/guides/for-projects/liquidity-lockers-v3](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v3) —
  UNCX V3 locker addresses per chain (VERIFIED)
- [docs.uncx.network/guides/for-projects/liquidity-lockers-v2](https://docs.uncx.network/guides/for-projects/liquidity-lockers-v2) —
  UNCX V2 locker addresses per chain (VERIFIED)
- [developers.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments](https://developers.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments)
  — V3 NonfungiblePositionManager + QuoterV2 ETH addresses (VERIFIED)
- [docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint)
  — `eth_callBundle` semantics + `X-Flashbots-Signature` (VERIFIED)
- [alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs)
  — Alchemy `eth_getLogs` 10-block free-tier cap (VERIFIED — contradicts CONTEXT.md
  2000-block assumption)
- [npmjs.com/package/ws](https://www.npmjs.com/package/ws) + ws GitHub README — heartbeat pattern (VERIFIED)
- [ethers-io/ethers.js#1053](https://github.com/ethers-io/ethers.js/issues/1053) —
  confirms ethers v6 has no built-in WS heartbeat (carried forward from
  `.planning/research/STACK.md`)
- Direct code reads of `src/exitEngine.ts` (executeFullSell + reason union),
  `src/chainRegistry.ts` (CHAIN_TEMPLATES + honeypotChecker extension pattern),
  `src/utils/db.ts` (schema migration v3→v4 pattern), `src/bot.ts` (buy-success attach
  sites + WS reconnect pattern), `src/config.ts` (REQUIRED_ENV_VARS)
- `.planning/research/SUMMARY.md` Phase 19 convergence section
- `.planning/research/ARCHITECTURE.md` §"Anti-Rug Runtime Architecture"
- `.planning/research/PITFALLS.md` #8 (cascading panic-sells), #9 (frontrun racing),
  #10 (WS subscription leaks)
- `.planning/research/STACK.md` §"Anti-Rug LP-Removal Detection"
- `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md` — D-FIXTURE,
  D-ALERTS, D-ROLLBACK, D-STOP-THE-LINE patterns (carry-forward)

### Secondary (MEDIUM confidence)

- [medium.com/@natelapinski "Understanding Rugpulls and Liquidity in Ethereum"](https://medium.com/@natelapinski/understanding-rugpulls-and-liquidity-in-ethereum-67765fcf2cb2)
  — HORSE V2 rug fixture details (block 18401609, tx hash, scammer profit)
- [docs.infura.io/networks/ethereum/json-rpc-methods/eth_getlogs](https://docs.infura.io/networks/ethereum/json-rpc-methods/eth_getlogs)
  — Infura 10,000-result cap (different limit shape than Alchemy)
- [support.quicknode.com QuickNode 10k Block Range Limit](https://support.quicknode.com/hc/en-us/articles/10258449939473-Understanding-the-10-000-Block-Range-Limit-for-querying-Logs-and-Events)
  — QuickNode 5-block free / 10k-block paid
- [Etherscan TrustSwap/Team Finance Lock contract page](https://etherscan.io/address/0xe2fe530c047f2d85298b07d9333c05737f1435fb)
  — TeamFinance V2/V3 unified locker; V3 NFT vault specific address unclear from
  public docs
- [Etherscan PinkSale Pink Lock](https://etherscan.io/address/0x71b5759d73262fbb223956913ecf4ecc51057641)
  — PinkLock02 verified on ETH; V3 support unclear
- [BscScan UNCX Liquidity Lockers V2](https://bscscan.com/address/0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83)
  — BSC V2 locker confirmation
- [Arbiscan UNCX V3 Proof of Reserves 2](https://www.arbiscan.io/address/0xcb8b00d4018ad6031e28a44bf74616014bfb62ec)
  — Arbitrum V3 locker confirmation
- [theblock.co AnubisDAO funds move](https://www.theblock.co/post/154004/anubisdao-funds-move-for-the-first-time-eight-months-after-rug-pull)
  — AnubisDAO context (older rug, harder to pin)

### Tertiary (LOW confidence — needs validation during plan-phase)

- TeamFinance V3 NFT vault per-chain addresses — needs Wave-1 resolution via
  Etherscan contract enumeration or TeamFinance app UI
- PinkLock V3-specific address per chain — needs Wave-1 resolution
- V3 rug fixture token selection (real-mainnet) — operator backfills during dry-run
  window per Phase 18 D-FIXTURE precedent
- Per-chain operator Alchemy tier (Free vs Pay-As-You-Go) — operator confirms in
  `docs/operations/anti-rug-rollout.md`; affects backfill cap defaults
- Frontrun success rate realistic baseline — CONTEXT.md acknowledges this is what
  the 7-day dry-run measures (D-RACE-TELEMETRY); no upfront number is load-bearing

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` is NOT present at the project root (`C:\Users\jackc\WebstormProjects\crypto-snipe-bot\CLAUDE.md` — file does not exist).
`.claude/skills/` and `.agents/skills/` directories not present.

The user's global `~/.claude/CLAUDE.md` instructs **RTK (Rust Token Killer)** command
prefixing for token-optimized commands. However, the project-level `memory/MEMORY.md`
explicitly notes:

> **[No RTK prefix](feedback_no_rtk.md) — rtk not installed, use npx/npm directly**

Phase 19 inherits this: **do NOT use `rtk` prefix in commands.** Use `npx` / `npm` /
`node` directly.

Per project `memory/MEMORY.md`:

- **Bot start command:** `npx ts-node src/bot.ts`
- **Merge commit safety:** Always audit before/after merges to prevent destructive
  code deletion
- **Repo cleanup sweeps:** Include `.claude/worktrees/agent-*/` when scanning empty/dead
  files, not just git-tracked
- **High-stakes blockchain ops:** mainnet/fund/key operations require testnet rehearsal
  first, step-by-step with verify-each-step, address-check protocol. **User is new to
  contract deployment.** ← Phase 19 doesn't deploy contracts but ships allowlist
  hardcoded addresses; the address-check protocol applies via D-LIST-VERIFY `getCode()`.
- **Don't dismiss anomalies:** On verification, NOTOK/error/weird output must be
  diagnosed before marking pass — never "non-blocking" without investigation. ← D-STOP-
  THE-LINE inherits this; Phase 19 close blocks on any failing assertion.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every dep verified present in `package.json`; no new installs
- Architecture: HIGH — CLOSED by CONTEXT.md + research convergence; researcher does
  NOT re-evaluate alternatives
- V2 + V3 event signatures: HIGH — verified against IUniswapV3PoolEvents.sol via
  WebFetch
- Canonical lockers (V2): HIGH — UNCX V2 lockers verified per chain via official docs
- Canonical lockers (V3): MEDIUM — UNCX V3 verified; TeamFinance V3 + PinkLock V3
  specific addresses are Wave-1 follow-up
- RPC backfill caps: HIGH — multi-source verification (Alchemy + Infura + QuickNode
  docs)
- HORSE V2 rug fixture: HIGH — explicit block number + tx hash + addresses from primary
  source
- V3 rug fixture: LOW — researcher could not source a clean V3 rug at a specific
  block; Wave-1 follow-up + contrived `RugPull.sol` V3 mode fallback
- `eth_callBundle` semantics: HIGH — Flashbots official docs
- ws heartbeat pattern: HIGH — official ws README
- Validation Architecture: HIGH — pattern matches Phase 18 (existing 3 vitest projects)

**Research date:** 2026-05-23
**Valid until:** 2026-06-22 (30 days for stable items: event sigs, lockers, ws heartbeat).
RPC `getLogs` caps may change as providers update tiers; re-verify before live-flip on
each chain.

## RESEARCH COMPLETE
