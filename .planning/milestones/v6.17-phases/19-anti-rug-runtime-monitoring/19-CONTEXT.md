# Phase 19: Anti-Rug Runtime Monitoring - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Build DETECT-02: runtime monitoring of open positions for liquidity-removal
events on both V2 and V3 pools, with frontrun-exit through the existing
`exitEngine.executeFullSell` path with elevated gas. This is **loss
minimization**, not rug prevention — published patterns put V2 frontrun
success at 30-40%; ETH/Base/Arb/BSC each have different MEV-game dynamics
that cap realistic outcomes.

The phase delivers a new `src/anti-rug/` module (NOT folded into
`src/exit-engine/`) with single-listener-per-chain WebSocket subscriptions
to LP-removal events, a multi-signal trigger with allowlist + confirm-
after-N-blocks suppression, a discriminated-union exit reason union
extension, schema migration v4→v5 for `lp_baseline`, per-chain dry-run
mode with three-channel telemetry, per-chain circuit breaker, and
WebSocket resilience (heartbeat + reconnect-resubscribe-backfill).

**Architecture is CLOSED** by research convergence (STACK + ARCHITECTURE +
PITFALLS): single-listener-per-chain WS subscription, multi-signal AND'd
trigger, bridge to `executeFullSell` (never direct tx submission), default
dry-run mode with 7-day operator-review window before flipping live.

**Real capital context (unchanged from Phase 18):** bot is funded on
mainnet with ~0.0124 ETH but cannot trade today due to broken V2 sell-sim
(Phase 18 ships the fix). At Phase 19 ship time, bot has zero open
positions, so the "pre-v6.17 positions without lp_baseline" case is
theoretical at ship; `lp_baseline` is mandatory for every position going
forward. Capital safety > throughput > LOC > clean-code (Phase 18
owner-binding carries forward).

</domain>

<decisions>
## Implementation Decisions

### V3 position coverage

- **D-V3-COVERAGE:** Full V3-aware monitoring via NFT events in v6.17 (NOT
  deferred to v6.18; NOT log-only). REQUIREMENTS.md ANTIRUG-02/03 are V2
  path only as written; D-V3-COVERAGE expands scope to include V3.
  Researcher / planner should add V3-specific requirement rows
  (ANTIRUG-13+ or decimal renumbering) during plan-phase.
- **D-V3-THRESHOLD:** Snapshot `pool.liquidity()` (active liquidity at
  current tick) at buy success in `lp_baseline`. Trigger on >50% drop
  from baseline. Simple, single value; matches V2 intuition. Multi-signal
  AND'd-rules suppress false positives from legitimate large swaps moving
  price across ticks.
- **D-V3-EVENTS:** Subscribe to BOTH `UniswapV3Pool.Burn` and
  `UniswapV3Pool.Collect`. Either event arrives → re-evaluate the full
  multi-signal AND chain. Multi-signal AND'd rules naturally suppress
  Burn-without-Collect false positives (since reserves haven't dropped
  until Collect).
- **D-V3-SIGNAL3:** V3 third multi-signal = sell-simulation slippage via
  `QuoterV2.quoteExactInputSingle(token, WETH, fee, ourPositionAmount)`.
  If quoted output is <50% of baseline expected, treat as "reserves below
  sell-threshold" equivalent. Directly answers "can we even sell?" — RPC
  cost: one staticCall per Burn/Collect event evaluation.
- **D-V3-ALLOWLIST:** Owner-based allowlist with separate V3 locker list
  per chain. Check `owner` field on Burn (no `to` on V3 Burn), `recipient`
  field on Collect. Allowlist contains Unicrypt UniLockerV2, TeamFinance
  V3 vaults, PinkLock V3 — distinct from V2 lockers. NFT-holder identity
  is the strongest signal.

### Dry-run → live graduation

- **D-LIVE-GATE:** Hybrid gating. 7 calendar days dry-run minimum AND
  review of every observed dry-run trigger with 0 confirmed false-
  positives before flipping live. If 0 events fire in 7 days (no rugs
  observed), operator can still flip after the 7-day baseline since no
  FPs were observed. Time floor protects against early panic; signal
  review protects against confidence in untested logic.
- **D-LIVE-PER-CHAIN:** Per-chain env vars
  (`ETH_ANTIRUG_LIVE_EXECUTE`, `BSC_ANTIRUG_LIVE_EXECUTE`,
  `BASE_ANTIRUG_LIVE_EXECUTE`, `ARB_ANTIRUG_LIVE_EXECUTE`). Each chain
  graduates independently after its own 7-day-AND-event-review gate.
  Aligns with Phase 18's per-chain HoneypotChecker deploy ladder. Bot
  currently runs `ENABLED_CHAINS=eth`, so ETH graduation is the only
  near-term gate.
- **D-DRY-TELEMETRY:** Three-channel — structured pino log (audit trail),
  Telegram alert with explicit `[DRY-RUN]` prefix (real-time review),
  dedicated dashboard tile showing dry-run event count per chain + last
  10 events (at-a-glance). Operator gets the same visibility they'd
  have in live mode minus the actual exit.
- **D-LIVE-ROLLBACK:** Env-flag flip in `.env` + bot restart. SQLite-
  persisted state survives. Bot resumes in dry-run within ~30s of
  operator decision. Paired with **D-CB** (ANTIRUG-09 circuit breaker
  auto-halt) for runaway-misfire protection before operator action.
  No code-level fallback flag; no hot-flip; matches Phase 18 D-ROLLBACK
  audit-trail discipline.
- **D-ENV-EXAMPLE:** [USER-BINDING — must comply] `.env.example` MUST be
  updated with every new env var introduced in Phase 19 — per-chain
  `ANTIRUG_LIVE_EXECUTE`, `ANTIRUG_LP_REMOVAL_PCT`,
  `ANTIRUG_CONFIRM_BLOCKS`, `ANTIRUG_CIRCUIT_BREAKER_TRIGGERS`,
  `ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS`, `ANTIRUG_GAS_MULTIPLIER`,
  `ANTIRUG_ALLOWLIST_EXTRA`. Each entry has an inline comment with the
  default value and a 1-line description. Verify gate at phase close.
- **D-OPERATOR-HANDOFF:** [USER-BINDING — must comply] At end of Phase
  19, produce explicit operator handoff document at
  `docs/operations/anti-rug-rollout.md` listing: (a) what to change in
  `.env` (every new var, default value, what changing it does); (b) bot
  restart procedure post-changes; (c) per-chain verification protocol
  (how to confirm anti-rug is in dry-run, then how to confirm it's live
  after the 7-day flip); (d) circuit-breaker reset procedure; (e)
  troubleshooting common WS-disconnect / backfill-gap scenarios.

### Operator visibility (Telegram + Dashboard)

- **D-VIS-LIVE-EXIT:** Full evidence + tx artifacts on live anti-rug
  exit Telegram: `[ANTI-RUG EXIT]` + token symbol + token address + pair
  address + signals fired (LP removed %, allowlist check result, sell-
  sim slippage) + exit tx hash with Etherscan link + sell amount + ETH
  received + ROI vs entry + gas multiplier used + chain. Same evidence
  dumped to pino structured log + dashboard event detail modal. Anti-
  rug exits are rare and high-stakes; operator wants full audit trail
  in one alert.
- **D-VIS-CB-TRIPPED:** Prominent red dashboard banner
  `ANTI-RUG HALTED ON {chain} — {N} triggers in last hour. Click to
  review and reset.` Telegram alert with last 3 trigger details. pino
  fatal log line. Manual-reset button opens confirmation modal showing
  the 3 trigger events; operator must click through review before reset.
  Hard-to-miss, audit-trail-preserving.
- **D-VIS-WS-HEALTH:** Tiered alerts. Dashboard per-chain WS-status
  indicator: 🟢 connected with recent pong, 🟡 reconnecting, 🔴
  disconnected >60s. Telegram alert only when (a) reconnect fails 3
  times in a row OR (b) disconnected >60s OR (c) backfill window >10
  blocks missed. pino: `debug` on reconnect, `warn` on >30s, `error`
  on backfill gap. Operator sees flaps as visual but only gets pinged
  for real outages.
- **D-VIS-PER-POSITION:** New "Anti-Rug" column in dashboard positions
  table with state badges: 🟢 Live, 🟡 Dry-run, 🟠 Would-have-sold
  (click to review), 🔴 Exit fired, ⚫ Halted (circuit breaker), ⚪
  Unmonitored. Click badge → detail modal with last LP-event timestamp,
  signal values at evaluation time, allowlist hits, sell-sim quote.
  Operator sees at-a-glance which positions are at risk.

### Allowlist lifecycle

- **D-LIST-SOURCE:** Hardcoded base in `src/anti-rug/allowlist.ts` (+
  per-chain in `CHAIN_TEMPLATES`) for Unicrypt UniLockerV2, TeamFinance
  V2+V3 vaults, PinkLock V2+V3 canonical addresses per chain. Operator
  env overlay: `ETH_ANTIRUG_ALLOWLIST_EXTRA=0xaaa,0xbbb`,
  `BSC_ANTIRUG_ALLOWLIST_EXTRA=...`, etc. Restart-only changes (not
  hot-reloadable) — keeps the surface auditable in `.env` + git.
- **D-LIST-VERIFY:** Startup-time `getCode()` check on every env-overlay
  address per chain. FATAL non-zero exit if any address has no code (EOA
  = wrong; lockers must be contracts). pino + stdout dumps the full
  merged allowlist per chain with provenance (`[hardcoded]` vs
  `[env-overlay]`) and address checksums. Operator visually verifies
  the startup print before pressing enter on bot start. Aligns with
  OPS-LIVE-05 preflight pattern.
- **D-LIST-AUDIT:** Per-hit pino log line on every allowlist
  suppression: `{ op: 'antirug.allowlist-hit', token, pair, event,
  destinationAddress, lockerName }` where `lockerName` is the source-
  comment label (e.g. `'Unicrypt UniLockerV2 ETH'`). Dashboard
  "Anti-Rug Monitor" tile shows `Suppressed today: N` per chain. Click
  → list of suppressed events with token, locker, timestamp. Auditable
  in logs.
- **D-LIST-FIXTURE:** Inherit Phase 18 D-FIXTURE pattern. Contrived
  `test/fixtures/contracts/RugPull.sol` (configurable rug + configurable
  destination, V2 + V3 variants) for controlled allowlist + multi-
  signal assertions. Plus 1-2 real pinned mainnet rug-pulls in
  `test/fork/fixtures/rugs/{slug}.json` (researcher identifies specific
  historical rugs). Minimum coverage: 1 V2 rug + 1 V3 rug.

### Frontrun race telemetry

- **D-RACE-TELEMETRY:** Triple measurement on every would-have-sold
  event during dry-run:
  - **(a) Detection latency** — `evaluationLatencyMs` = time from event
    arrival to multi-signal verdict completion.
  - **(b) Synthetic race (ETH only)** — `flashbots_simulateBundle` with
    our hypothetical sell tx targeting next block; record win/loss
    verdict in `flashbotsRaceVerdict`. Skip on BSC (bloXroute), Base/Arb
    (sequencer-ordered).
  - **(c) Post-hoc reality** — at block N+2 after the LP-removal event,
    query pool reserves and compute what a sell of our position size
    WOULD have received. Tag outcome `'would-have-saved-X-ETH'` vs
    `'too-late-already-drained'` based on the result.
  Combined into a structured pino event per would-have-sold trigger.
  Dashboard surfaces a "Frontrun outcome distribution" panel for
  operator review during the 7-day window. Feeds directly into the
  D-LIVE-GATE 0-FP review process.

### Threshold tuning loop

- **D-TUNE-PROTOCOL:** Manual review + documented protocol. After 7-day
  dry-run, operator reviews dry-run telemetry (FPs, frontrun outcome
  distribution, allowlist hit rate). Edits per-chain env vars and
  restarts bot. Documented in
  `docs/operations/anti-rug-tuning.md` (created in Phase 19). Audit
  trail = `.env` + git history.
- **Tunable defaults (per-chain envs):**
  - `<CHAIN>_ANTIRUG_LP_REMOVAL_PCT` — default `50` (% of baseline LP)
  - `<CHAIN>_ANTIRUG_CONFIRM_BLOCKS` — default `1` ETH (configurable per
    chain; reorg-volatile chains get higher value)
  - `<CHAIN>_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS` — default `3`
  - `<CHAIN>_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS` — default `1`
  - `<CHAIN>_ANTIRUG_GAS_MULTIPLIER` — default `2.0`

### Position-subscription-termination

- **D-TERMINATION:** Anti-rug subscription terminates ONLY when position
  is fully closed (`trades.status='sold'` AND `amount_remaining=0`).
  **Partial sells DO NOT terminate** — v6.16 trailing-stop, partial-sell
  triggers leave a remaining position which is still at rug risk.
  Manual emergency-sell from dashboard also terminates subscription.
  Cleanup hook in `exitEngine` sell-success path: `unsubscribeAntiRug
  (tradeId)` invoked when `amount_remaining` transitions to 0. No
  time-based fallback in v6.17 — the optional "<24h since launch" gate
  noted in ARCHITECTURE.md is deferred to v6.18 if operationally needed.

### Resume-on-restart semantics

- **D-BACKFILL:** On restart, query `getLogs(lastSeenBlock+1,
  currentBlock)` for each subscribed pair. Cap window at 2000 blocks
  per query (Alchemy free-tier safe). If downtime exceeds the cap:
  **FAIL CLOSED** — pino error log with `gapBlocks=N`, surface
  `[GAP DETECTED]` Telegram alert + dashboard banner; operator manually
  reviews and acknowledges. Backfilled events feed through the SAME
  multi-signal AND chain (no special-case). Stale events fire historical-
  trigger pino log + would-have-sold replay; backfill exits are tagged
  `'too-late'` in race telemetry (can't actually frontrun events from N
  blocks ago).
- **`lastSeenBlock`** stored per chain in a new `chain_state` table (or
  reused `bot_state` table — planner decides). Updated on every confirmed
  event processed.

### Carried-forward conventions (inherited from Phase 18 + research)

- **Single-listener-per-chain** WS pattern (NOT per-position) per
  Pitfall #10. Internal dispatch routes events to subscribed positions
  by pair-address lookup.
- **Multi-signal AND chain** trigger logic: `(LP-removal-% >threshold)
  AND (destination NOT in allowlist) AND (V2: reserves below sell-
  threshold / V3: QuoterV2 quoted output <50% of baseline)`. Single-
  signal triggers are EXPLICITLY rejected per ANTIRUG-05.
- **Bridge via `executeFullSell`** with new `reason: 'anti-rug'`
  discriminant. Never direct `wallet.sendTransaction` — preserves sell
  lock, receipt decoding, DB cleanup, Telegram alerts.
- **Elevated gas multiplier** default `2.0×`, per-chain configurable.
  Frontrun comes from MEV strategy on Flashbots ETH / bloXroute BSC;
  Base/Arb degrade gracefully to "submit ASAP and hope it lands in the
  next block alongside the rug" (sequencer-ordered).
- **WebSocket resilience** — heartbeat ping/pong via existing
  `ws@^8.20.0` (no built-in heartbeat in ethers v6 per issue #1053),
  reconnect → re-subscribe → backfill via `getLogs(lastSeen, current)`.
- **Schema migration v4→v5** — additive `lp_baseline` table; existing
  tables unchanged. Snapshot at buy success in the buy-success path
  (parallel to `markSniped` / `recordTrade` writes).
- **D-STOP-THE-LINE** (Phase 17 → 18 carry-forward) — any audit finding
  or fork test revealing a production bug BLOCKS Phase 19 close;
  treated as a first-class requirement upgrade (likely ANTIRUG-13+ or
  decimal phase 19.1). Fix-in-flight and file-and-defer are rejected.

### Claude's Discretion

- Exact heartbeat ping interval and timeout values (within "default 30s,
  silent failure detection beyond library defaults" per ANTIRUG-12) —
  planner discretion.
- `lp_baseline` schema discriminator approach (single table with
  nullable V2+V3 columns vs `pool_type` discriminator column vs
  separate `lp_baseline_v2` / `lp_baseline_v3` tables) — planner
  discretion within "additive only, no existing tables modified".
- `src/anti-rug/` module file split (`detector.ts`, `exitTrigger.ts`,
  `lpBaseline.ts` per ARCHITECTURE.md vs alternative shapes) — planner
  discretion within the "NOT folded into exit-engine" constraint.
- Exact `executeFullSell` reason-union extension shape (TS literal
  string union vs discriminated branded type) — planner discretion.
- Dashboard component file structure for the new Anti-Rug column +
  Anti-Rug Monitor tile + Circuit Breaker banner + modal layouts —
  planner discretion. Reuses existing dashboard React + Tailwind
  conventions.
- Backfill window cap (2000 blocks default) — planner discretion to
  adjust per RPC tier; verified during plan-phase against current
  Alchemy / Infura / public-RPC limits.
- V3 NFT Manager and Pool ABI imports (researcher identifies during
  research-phase; current codebase has V3 sell paths via SwapRouter02
  + QuoterV2 but no NFT-events surface yet).
- Real-mainnet rug fixture token selection (which historical rugs,
  which block-pin) — researcher identifies candidates during research-
  phase; planner finalizes. Minimum coverage 1 V2 + 1 V3.
- Telegram alert phrasing (within D-VIS-LIVE-EXIT shape) — planner
  refines for clarity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v6.17 milestone source-of-truth

- `.planning/PROJECT.md` — v6.17 milestone scope; "Current State"
  section; owner non-negotiables.
- `.planning/REQUIREMENTS.md` ANTIRUG-01..ANTIRUG-12 — full
  requirement IDs and acceptance criteria (V3 row additions ANTIRUG-13+
  added by planner per D-V3-COVERAGE).
- `.planning/ROADMAP.md` §"Phase 19: Anti-Rug Runtime Monitoring" —
  goal, depends-on (Phase 18), 5 success criteria.
- `.planning/STATE.md` — milestone status, recent activity, open
  decisions for plan-phase.

### Research convergence (architectural decisions are CLOSED)

- `.planning/research/SUMMARY.md` §"Phase 19: Anti-Rug Runtime
  Monitoring" — closed architecture: event-driven WebSocket + HTTP poll
  fallback, single-listener-per-chain, bridge via `executeFullSell`.
- `.planning/research/ARCHITECTURE.md` — integration design;
  `src/anti-rug/` module layout (`detector.ts`, `exitTrigger.ts`,
  `lpBaseline.ts`); `ChainConfig` extension pattern; resume-on-restart
  flow; reason-union extension.
- `.planning/research/PITFALLS.md` #8 (cascading false-positive
  panic-sells — multi-signal mitigation), #9 (frontrun racing dynamics
  — panic-fee budget + multi-builder submission + circuit breaker),
  #10 (WS subscription resource leaks — single-listener-per-chain +
  reconnect-resubscribe-backfill).
- `.planning/research/FEATURES.md` §"Anti-Rug Runtime Monitoring" —
  table-stakes vs differentiator classification; competitor matrix
  (Maestro, Banana Gun, honeypot.is anti-rug feature spread).
- `.planning/research/STACK.md` — `ws@^8.20.0` for WS heartbeat;
  `better-sqlite3@^12.8.0` for schema migration; ethers v6 WS
  reconnection caveats.

### Phase 18 carry-forward (precedent set in HONEY phase)

- `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md` —
  D-ALERTS tiered Telegram format, D-FIXTURE pattern (contrived + real),
  D-ROLLBACK posture (no legacy fallback flag), D-STOP-THE-LINE,
  D-DEPLOY-KEY separation pattern. Phase 19 inherits all conventions.
- `.planning/phases/18-honeypot-detection-rebuild/18-10-PLAN.md` —
  bot.ts wiring pattern; integration test structure; D-ALERTS format
  reference implementation.
- `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md`
  — D-04 observable-effect rigor, D-07 stop-the-line convention,
  D-08/09 CI guards as evergreen invariants.

### External library docs (verified by researcher / planner)

- ethers-io/ethers.js#1053 — confirmed ethers v6 has no built-in WS
  heartbeat; `ws@^8.20.0` ping/pong required.
- Uniswap V2 Pair contract `Burn` event signature.
- Uniswap V3 Pool contract `Burn` + `Collect` event signatures.
- Uniswap V3 `NonfungiblePositionManager` event signatures (for
  validation only; subscription target is the pool, not the manager).
- `QuoterV2.quoteExactInputSingle` ABI — V3 sell-sim third-signal
  basis.
- Alchemy / Infura `getLogs` block-range limits per tier — verified
  by researcher during plan-phase (informs D-BACKFILL 2000-block cap).
- Unicrypt UniLockerV2 canonical addresses per chain (ETH, BSC, Base,
  Arb) — researcher confirms during plan-phase.
- TeamFinance V2 + V3 vault canonical addresses per chain — researcher
  confirms.
- PinkLock V2 + V3 canonical addresses per chain — researcher
  confirms.

### Code modification + new-artifact targets

- `src/anti-rug/detector.ts` — NEW; single-listener-per-chain WS
  subscription dispatch + multi-signal evaluation.
- `src/anti-rug/exitTrigger.ts` — NEW; bridge to
  `exitEngine.executeFullSell` with elevated gas + reason='anti-rug'.
- `src/anti-rug/lpBaseline.ts` — NEW; snapshot V2 reserves + V3 active
  liquidity at buy success; persist to `lp_baseline` table.
- `src/anti-rug/allowlist.ts` — NEW; hardcoded base allowlist per
  chain (V2 + V3 lockers); env-overlay merge logic at startup with
  `getCode()` verification.
- `src/anti-rug/circuitBreaker.ts` — NEW; per-chain trigger counter
  with rolling window; dashboard reset API.
- `src/anti-rug/raceTelemetry.ts` — NEW; D-RACE-TELEMETRY triple
  measurement (detection latency + Flashbots simulate + post-hoc).
- `src/exitEngine.ts` — MODIFY; extend `reason` union with `'anti-rug'`;
  elevated-gas path for that reason; `unsubscribeAntiRug` cleanup hook
  on `amount_remaining=0`.
- `src/bot.ts:332-341` (V2) + `bot.ts:522-530` (V3) — MODIFY; wire
  `startAntiRugMonitor(ctx, dex, token, tradeId)` parallel to existing
  `startExitMonitor` on buy-success.
- `src/bot.ts:702-832` (`startMultiChainBot`) — MODIFY; resume anti-rug
  subscriptions on restart (load `lp_baseline` rows, re-subscribe to
  WS events, kick off backfill via `getLogs`).
- `src/chainRegistry.ts` `CHAIN_TEMPLATES` — MODIFY; add `antiRug`
  field per chain (gas multiplier, confirm-blocks, threshold defaults,
  hardcoded allowlist references).
- `src/utils/db.ts` — MODIFY; schema migration v4→v5 adding
  `lp_baseline` table; new prepared statements (`upsertLpBaseline`,
  `getLpBaseline`, `deleteLpBaseline`).
- `src/config.ts` `REQUIRED_ENV_VARS` — MODIFY; add per-chain
  `ANTIRUG_LIVE_EXECUTE`, `ANTIRUG_LP_REMOVAL_PCT`,
  `ANTIRUG_CONFIRM_BLOCKS`, `ANTIRUG_CIRCUIT_BREAKER_TRIGGERS`,
  `ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS`, `ANTIRUG_GAS_MULTIPLIER`,
  `ANTIRUG_ALLOWLIST_EXTRA`.
- `dashboard/` — MODIFY; new "Anti-Rug" column in positions table
  with state badges; "Anti-Rug Monitor" tile (event count + last 10
  events + allowlist hit count); circuit-breaker banner + reset modal;
  WS-status indicator per chain; "Frontrun outcome distribution" panel
  during dry-run window.
- `test/fixtures/contracts/RugPull.sol` — NEW; contrived V2 + V3 rug
  contract with configurable destination + threshold.
- `test/fork/fixtures/rugs/{slug}.json` — NEW; 1+ V2 + 1+ V3 real
  pinned mainnet rug fixtures.
- `.env.example` — MODIFY [USER-BINDING]; all new env vars with inline
  comments + default values.
- `docs/operations/anti-rug-rollout.md` — NEW [USER-BINDING]; operator
  handoff doc per D-OPERATOR-HANDOFF.
- `docs/operations/anti-rug-tuning.md` — NEW; threshold tuning protocol
  per D-TUNE-PROTOCOL.

### Test infrastructure context

- `vitest.config.ts` — existing projects: unit / integration / fork.
  Phase 19 tests file into appropriate project; no new project needed.
- `package.json` scripts — `test:unit` / `test:integration` /
  `test:fork` / `test:all` already wired.
- `hardhat.config.ts` — solc 0.8.28 + Hardhat 2.26 already configured;
  `test/fixtures/contracts/RugPull.sol` compiles under existing
  toolchain.
- `.github/workflows/test.yml` — Phase 17 evergreen CI guards (`.todo`
  ban + `tsc --noEmit ×3`) + Phase 18 contract gates preserved. Phase
  19 adds anti-rug tests under existing test:unit / test:integration /
  test:fork buckets.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`exitEngine.executeFullSell`** at `src/exitEngine.ts:424-519` — the
  ONLY path anti-rug uses to fire exits. Already implements sell lock
  (`tryAcquireSellLock` at 433-436), receipt decoding, DB cleanup, and
  Telegram alerts. Anti-rug extends the `reason` union; the function
  body's elevated-gas branch is new.
- **`startExitMonitor`** at `src/exitEngine.ts:805-866` — anti-rug
  attaches alongside this on buy-success at `bot.ts:332-341` (V2) and
  `bot.ts:522-530` (V3). Independent lifecycle; both started in parallel.
- **`tryAcquireSellLock`** mutex — anti-rug exit path MUST respect it.
  Two parallel exits (anti-rug + trailing-stop) cannot submit
  simultaneously; one acquires, the other no-ops with a structured pino
  log.
- **Schema migration framework** at `src/utils/db.ts:27-123` — additive
  v4→v5 migration adds `lp_baseline` table; existing tables unchanged.
  Verified pattern from prior Phase 3 / Phase 14 migrations.
- **`ChainConfig` per-chain extension pattern** at
  `src/chainRegistry.ts:99-263` — Phase 18 added `honeypotChecker`;
  Phase 19 adds `antiRug` field per chain. Same conditional-merge
  pattern; no `if (chainName === 'eth')` branches outside the registry.
- **`sendCtxAlert` + structured pino logging** — already used across
  `bot.ts` and `exitEngine.ts` for Telegram + log emission. D-VIS-* and
  D-LIST-AUDIT extend existing format; no new infrastructure.
- **`sendTxWithRetry` + Flashbots dynamic relay** at `src/bot.ts:294+`
  — unchanged by Phase 19. Anti-rug bypasses this path (uses
  `executeFullSell`, which has its own sell-tx submission).
- **`isKnownBadTokenForChain`** at `bot.ts:205` — first-pass blocklist;
  unrelated to anti-rug but the allowlist pattern is symmetrical.
- **`ws@^8.20.0`** already top-level dep — used directly for heartbeat
  ping/pong (per ANTIRUG-12 + STACK.md).
- **Existing factory-listener WS pattern** at `bot.ts:644-696` — same
  per-chain subscription template that anti-rug detector reuses
  (HTTP-polling-fallback path also defined there).
- **Discriminated-union pattern (D-13/14 from Phase 17/18)** —
  `HoneypotResult { verdict, evidence }` is the template. Anti-rug
  introduces `RugEvaluation { verdict: 'safe' | 'unsafe' | 'allowlisted',
  signals: { lpRemovedPct, destination, allowlistHit, sellSimSlippage } }`
  with vacuous pass unrepresentable in the type system.

### Established Patterns

- **In-place wiring at buy-success** — `startExitMonitor` is wired at
  `bot.ts:332-341` (V2) and `bot.ts:522-530` (V3). Anti-rug attaches at
  the same call sites, parallel (`Promise.all` style) — both
  subscriptions start, both fail-loudly if either fails.
- **Per-chain env-overridable thresholds** — pattern from Phase 18
  `ETH_MAX_BUY_TAX_BPS` etc. is the template for the new ANTIRUG envs.
- **Test layout** — `test/unit/`, `test/integration/`, `test/fork/`
  with fixtures co-located in `test/fixtures/`. Anti-rug tests follow
  the existing convention; `test/fork/fixtures/rugs/` is new but
  matches the `test/fork/fixtures/honeypots/` Phase 18 precedent.
- **Resume-on-restart in `startMultiChainBot`** — Phase 4+ pattern:
  for each open trade in DB, resume exit monitor; Phase 19 adds anti-rug
  resume alongside, gated by `lastSeenBlock` backfill window.
- **Dashboard real-time push via WebSocket hub** at
  `dashboard/src/services/wsClient.ts` (or equivalent) — anti-rug events
  broadcast through the existing hub; no new transport.

### Integration Points

- **`bot.ts:332-341` (V2 buy success)** — wire
  `startAntiRugMonitor(ctx, dex, targetToken, tradeId)` parallel to
  existing `startExitMonitor`. Both attach as buy-success completes.
- **`bot.ts:522-530` (V3 buy success)** — same wiring as V2 but with
  V3-specific `startAntiRugMonitorV3(ctx, dex, targetToken, tradeId,
  fee)` dispatching to the V3 path.
- **`bot.ts:702-832` (`startMultiChainBot` startup)** — adds: (a)
  initialize per-chain WS connections for anti-rug, (b) load
  `lp_baseline` rows for open trades, (c) re-subscribe to pair events,
  (d) backfill via `getLogs(lastSeenBlock+1, currentBlock)` with cap +
  gap detection per D-BACKFILL. Runs AFTER existing exit-monitor
  resume.
- **`exitEngine.ts` reason union** — extend
  `'trailing-stop' | 'stop-loss' | 'urgency-market-sell'` to include
  `'anti-rug'`. Elevated-gas path: `buildV2SellTx` / `buildV3SellTx`
  read `ctx.chain.antiRug.gasMultiplier` when reason is `'anti-rug'`.
- **`exitEngine.executeFullSell` cleanup hook** — when
  `amount_remaining` transitions to 0 (full close), invoke
  `unsubscribeAntiRug(tradeId)` to terminate the WS subscription per
  D-TERMINATION.
- **`chainRegistry.ts` `CHAIN_TEMPLATES`** — add `antiRug` field per
  chain with default thresholds + hardcoded allowlist references.
- **Dashboard `dashboard/src/` (TBD planner)** — new positions-table
  column, new tile (Anti-Rug Monitor), new banner (CB tripped), new
  modal (CB reset confirm), new status indicator (per-chain WS health),
  new panel (frontrun outcome distribution during dry-run).
- **Telegram listener (`telegramListener.ts`)** — unchanged. Outbound
  alerts only.

</code_context>

<specifics>
## Specific Ideas

- **Owner's binding constraint** (carry-forward from Phase 18): "If it
  is better and safer, then we take that option. This is real capital
  being traded." Every D-* above is graded against capital safety first,
  throughput / LOC / clean-code second.
- **Operator-handoff is non-negotiable** (D-OPERATOR-HANDOFF): operator
  needs an explicit "what to change in `.env`, restart how, verify how"
  document at phase close. This is a USER-BINDING and Phase 19 must not
  ship without it.
- **`.env.example` is non-negotiable** (D-ENV-EXAMPLE): every new env
  var lands in `.env.example` with default value + 1-line description.
  Verified at phase close.
- **V3 anti-rug is a v6.17 commitment** (D-V3-COVERAGE) — operator
  chose full V3-aware monitoring over the simpler "defer to v6.18"
  path. The researcher / planner must add V3-specific requirements
  (ANTIRUG-13+ or decimal renumbering) during plan-phase.
- **Dry-run review depth is high** (D-RACE-TELEMETRY) — operator wants
  triple measurement (timing + Flashbots simulate + post-hoc) so the
  7-day dry-run window produces a confident go/no-go signal, not just
  "tests pass on a fork."
- **Per-chain graduation, not global** (D-LIVE-PER-CHAIN) — each chain
  has its own `<CHAIN>_ANTIRUG_LIVE_EXECUTE` env var; ETH can be live
  while BSC stays in dry-run.

</specifics>

<deferred>
## Deferred Ideas

- **Time-since-launch gate** ("<24h since buy" optional gate noted in
  ARCHITECTURE.md) — deferred. ARCHITECTURE.md raised the option; D-
  TERMINATION explicitly leaves it out of v6.17. Reconsider in v6.18
  based on operational data from dry-run.
- **Mempool-aware anti-rug detection (ANTIRUG-V2-01)** — block-
  confirmed detection in v6.17 caps frontrun success at 30-40%;
  mempool detection is the only path to higher rates against fast
  deployers. Deferred to v6.18+ per REQUIREMENTS.md v2-requirements
  section.
- **Aggregated rug-signal scoring (ANTIRUG-V2-02)** — combines LP-
  removal, dev-wallet dump, transfer-pause, owner-renunciation-faking
  signals into a single risk score. Requires real-world signal-frequency
  baseline data v6.17 doesn't have yet.
- **Tax-change detection on open positions (ANTIRUG-V2-03)** — periodic
  re-simulation via deployed `HoneypotChecker` to catch deployer-
  flipping-tax mid-position. Reuses Phase 18 infrastructure. Deferred
  to v6.18.
- **Owner-blacklist-self detection (ANTIRUG-V2-04)** — multi-address
  simulation against deployer + bot wallet to catch tokens that allow
  buys for some addresses but block sells for others. Deferred to v6.18.
- **Allowlist hot-add via dashboard** — discussed and rejected for
  v6.17 in favor of D-LIST-SOURCE env-overlay + restart pattern.
  Reconsider in v6.18 if operational evidence shows new lockers appear
  faster than restart cadence.
- **Bot-suggested threshold adjustments** — discussed and rejected in
  favor of D-TUNE-PROTOCOL (manual review + documented protocol).
  Reconsider in v6.18+ if 7-day dry-run data is reliable enough to
  recommend adjustments programmatically.
- **Allowlist Etherscan name-tag verification** — discussed and
  rejected in favor of D-LIST-VERIFY `getCode()` check (faster, no
  external API dependency, contract-vs-EOA discrimination is the
  strongest base signal).
- **Anti-rug auto-exit on backfilled triggers** — discussed and
  rejected in favor of D-BACKFILL "tag as too-late" replay model.
  Stale events firing live exits risks bad trades on already-drained
  or already-recovered pools.
- **Per-position WS subscriptions** — explicitly rejected per
  Pitfall #10 (subscription-cap leaks); single-listener-per-chain is
  locked.
- **Synthetic canary-trade monitor (OPS-V2-01)** — strongest mitigation
  against telemetry-masks-issue. Deferred until pre-buy + anti-rug
  proven safe in operation; possibly v6.19.

</deferred>

---

*Phase: 19-anti-rug-runtime-monitoring*
*Context gathered: 2026-05-23*
