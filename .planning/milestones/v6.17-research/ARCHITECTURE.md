# Architecture Research — v6.17 Defensive Hardening Integration

**Domain:** Multi-chain EVM crypto sniper bot — defensive hardening for live mainnet
**Researched:** 2026-04-29
**Confidence:** HIGH (existing architecture is well-documented and code paths verified by direct read)

---

## Scope

This is **integration architecture only**. The full v6.16 system architecture
lives in `.planning/milestones/v6.16-research/ARCHITECTURE.md` and
`.planning/codebase/ARCHITECTURE.md` — those describe the orchestrator,
chain registry, exit engine, persistence layer, and dashboard. This file
describes **only** how the five v6.17 capability bundles slot into the
existing v6.16 system without architectural duplication.

The five integration concerns:

1. Honeypot detection (Option C `eth_simulateV1` vs Option D on-chain
   checker contract)
2. Anti-rug runtime monitoring (DETECT-02)
3. Exit-engine live-runtime hardening
4. Going-live ops hardening (preflight, env validation, runbook)
5. Tech debt cleanup (Nyquist validation, exit-engine `.todo` stubs,
   dashboard TS errors, dead-code)

---

## Existing-System Hooks (read-only reference)

The following load-bearing v6.16 modules and lines are referenced
throughout this document. They are unchanged by v6.17 except where
explicitly noted.

| File | Lines | Role |
|------|-------|------|
| `src/bot.ts` | 174-347 | `handleNewPairForChain` — V2 buy pipeline; honeypot gate slots here |
| `src/bot.ts` | 220-226 | Current FIX-04 sell-sim gate (broken; gets replaced) |
| `src/bot.ts` | 229-238 | Parallel safety bank (8 checks via `Promise.all`) |
| `src/bot.ts` | 353-536 | `handleNewV3PoolForChain` — V3 buy pipeline; same honeypot integration as V2 |
| `src/bot.ts` | 411-416 | V3 sell-sim gate (silent vacuous pass; gets replaced) |
| `src/bot.ts` | 332-341 | Buy-success → `startExitMonitor` handoff (anti-rug attaches here) |
| `src/bot.ts` | 702-832 | `startMultiChainBot` — startup sequence (preflight slots in here) |
| `src/utils/tokenSafety.ts` | 555-586 | `simulateSellForChain` — V2 sell-sim (broken) |
| `src/utils/tokenSafety.ts` | 593-634 | `simulateSellV3ForChain` — V3 sell-sim (vacuous pass) |
| `src/utils/tokenSafety.ts` | 335-340 | `checkHoneypotForChain` — third-party API dispatch (HONEY/SAFETY supplements) |
| `src/utils/safetyProviders/` | dir | Existing provider adapters (honeypot.is, GoPlus, Mudra, Unicrypt) — pattern to extend |
| `src/exitEngine.ts` | 805-866 | `startExitMonitor` — single 5s poll loop entry; anti-rug subscribes alongside |
| `src/exitEngine.ts` | 424-519 | `executeFullSell` — exit path that anti-rug invokes for frontrun-exit |
| `src/exitEngine.ts` | 433-436 | `tryAcquireSellLock` — mutex anti-rug must respect |
| `src/utils/db.ts` | 27-123 | Schema migration system — anti-rug needs new `lp_baseline` table |
| `src/utils/exitManager.ts` | dir | Per-token sell lock + timer registry; reused by anti-rug |
| `src/chainRegistry.ts` | 99-263 | `CHAIN_TEMPLATES` — extension point for `honeypotCheckerAddress` |
| `src/config.ts` | 13-66 | `REQUIRED_ENV_VARS` validator — extension point for new vars |

---

## System Overview — v6.17 Additions

The v6.17 milestone adds three new components and extends two existing
ones. Everything respects the v6.16 chain-registry / strategy-dispatch /
single-exit-loop architecture.

```
                    INGESTION LAYER (unchanged from v6.16)
+---------------------------------------------------------------+
| Factory listeners (V2 + V3 per chain) | Telegram listener     |
+---------------------+-----------------+-----------------------+
                      |
                      v
                ORCHESTRATION LAYER (extended)
+---------------------------------------------------------------+
| handleNewPairForChain / handleNewV3PoolForChain (bot.ts)      |
|                                                                |
|   Pre-existing gates (1-5):                                   |
|     dedup, blocklist, isKnownBadToken, canSnipe (risk)        |
|                                                                |
|   *** NEW v6.17: Replace broken sell-sim gate (line 220-226)  |
|     simulateSellForChain   --> rebuilt (Option C or D)        |
|     simulateSellV3ForChain --> rebuilt (same module)          |
|                                                                |
|   Pre-existing parallel bank (lines 229-238) — UNCHANGED:     |
|     checkHoneypotForChain (third-party API)  ← still runs     |
|     isBlacklistedTokenForChain                                 |
|     isLiquidityLockedForChain                                  |
|     isLiquiditySufficientForChain                              |
|     checkTokenMetadataForChain                                 |
|     simulateSwapForChain                                       |
|     hasHighTransferTaxForChain                                 |
|     hasMaxWalletOrTxLimitsForChain                             |
+---------------------+-----------------------------------------+
                      |
                      v
              EXECUTION LAYER (unchanged from v6.16)
+---------------------------------------------------------------+
|  sendTxWithRetry → MEV strategy (Flashbots/bloXroute/passthr) |
+---------------------+-----------------------------------------+
                      | (on buy success)
                      v
                POSITION LIFECYCLE (extended)
+---------------------------------------------------------------+
|  startExitMonitor (exitEngine.ts:805) — 5s poll loop          |
|    Step 1: queryPrice                                          |
|    Step 2: update HWM + volatility                             |
|    Step 3: check partial sell tiers                            |
|    Step 4: compute effective trailing %                        |
|    Step 5: check trailing stop                                 |
|    Step 6: check fixed stop-loss                               |
|    Step 7: check 30-min urgency                                |
|    Step 8: persist state                                       |
|                                                                |
|  *** NEW v6.17: Anti-rug detector (parallel subscription)     |
|    Pair.Burn / Pair.Transfer(to=0x0) WS subscription          |
|    LP-removal threshold check                                  |
|    On rug: fire emergency executeFullSell with frontrun gas    |
+---------------------+-----------------------------------------+
                      |
                      v
              PERSISTENCE LAYER (extended schema)
+---------------------------------------------------------------+
|  trades, exit_state (existing)                                 |
|  *** NEW v6.17: lp_baseline (per-position LP snapshot at buy) |
+---------------------------------------------------------------+
                      |
                      v
              INTERFACE LAYER (extended)
+---------------------------------------------------------------+
|  Express + WebSocket dashboard (unchanged routing)             |
|  *** NEW v6.17: anti-rug events broadcast via existing WS hub |
+---------------------------------------------------------------+
                      |
                      v
                STARTUP SEQUENCE (extended)
+---------------------------------------------------------------+
|  *** NEW v6.17: src/preflight.ts                              |
|    Wallet balance check (fail-fast if < ETH_MAX_CAPITAL)       |
|    DB migration assertion (fail-fast if schema < CURRENT)     |
|    Honeypot checker address verification (Option D only)      |
|    Stale data warnings (existing positions older than X days) |
+---------------------------------------------------------------+
```

### Component Responsibilities — Net New

| Component | Responsibility | File Location |
|-----------|----------------|---------------|
| Honeypot simulator | Execute buy→sell roundtrip in single eth_call; return numerical buy/sell tax + revert reason | `src/utils/honeypot/simulator.ts` (Option C) or `src/utils/honeypot/checkerContract.ts` (Option D) |
| Honeypot checker contract (Option D only) | Solidity contract that takes ETH via call, performs buy via router, then sell via router, returns success/tax | `contracts/honeypot/HoneypotChecker.sol` |
| Anti-rug detector | Subscribe to Pair.Burn / Transfer(to=0x0) per open position; trigger emergency exit when threshold exceeded | `src/anti-rug/detector.ts` |
| Anti-rug exit trigger | Bridge between detector and exitEngine.executeFullSell with elevated gas | `src/anti-rug/exitTrigger.ts` |
| LP baseline store | Snapshot LP reserves at buy time for delta-based rug detection | `src/utils/db.ts` (new prepared statements + schema migration v5) |
| Preflight checker | Startup-time fail-fast checks: wallet balance, DB schema, honeypot checker code-at-address (D), env-var soft warnings | `src/preflight.ts` |
| Smoke harness | Real-mainnet replay test — scripted PairCreated→buy→sell sequence against fork | `test/fork/smokeHarness.test.ts` + `test/fork/fixtures/realLaunches/*.json` |

---

## 1. Honeypot Detection Integration

### Option C vs Option D — Recommendation

**Recommendation: Option D (deploy on-chain HoneypotChecker contract)** as
the primary path, with **Option C as opt-in fallback** for chains where
deployment is gas-prohibitive or where the team chooses not to deploy.

The trade-off matrix below assumes the comparison-research file
(COMPARISON.md, sibling document) has the deeper Solidity-vs-RPC
evaluation. This file restricts itself to **integration mechanics**.

| Concern | Option C (`eth_simulateV1` / state overrides) | Option D (deploy HoneypotChecker contract) |
|---------|-----------------------------------------------|-------------------------------------------|
| Where the simulation runs | Inside the RPC node, ephemeral | On the chain, real bytecode at fixed address |
| Storage layout dependency | YES — must guess balance/allowance slots, breaks on Vyper / UUPS / rebasing | NO — uses standard ERC20 calls and `try/catch` |
| Multi-chain implications | Per-chain RPC support varies (Alchemy yes, BSC-public no, Base/Arb depends on provider) | One deploy per chain (~$2-5 gas, one-shot) |
| ethers v6 wiring | `provider.send('eth_simulateV1', [...params])` (low-level escape hatch confirmed) | Plain `Contract.staticCall` against deployed address |
| Failure mode | Brittle — silent wrong-answer if storage layout differs | Fail-loud — revert reason surfaces |
| Test fixtures | Hard — need to mock RPC method response | Easy — fork mainnet, deploy, call against real tokens |
| Code volume in bot | ~80-150 lines (per-chain RPC adapter + slot-probing fallback) | ~30-50 lines (just a `staticCall` wrapper) |

**The integration architecture supports both.** The dispatch layer is the
same; only the implementation file differs. Build Option D first (closer
to the existing safety-provider pattern, lower brittleness risk), and
add Option C as a config-flag fallback if a chain's deployment path is
blocked.

### File layout (Option D primary)

```
src/utils/honeypot/
├── index.ts              # Dispatch: simulateHoneypot(ctx, token) → calls Option D or C based on config
├── checkerContract.ts    # Option D: ethers v6 staticCall against deployed HoneypotChecker
├── simulator.ts          # Option C: provider.send('eth_simulateV1', ...) + state-override fallback
└── types.ts              # HoneypotResult { isHoneypot, buyTaxBps, sellTaxBps, error?, method }

contracts/honeypot/
└── HoneypotChecker.sol   # Solidity: takes router/token, buys via router (msg.value), then sells, returns tax bps

scripts/
└── deploy-honeypot-checker.ts  # Per-chain deploy script; writes deployed address to addresses.json
```

### Address-table extension in `chainRegistry.ts`

The existing `ChainConfig` interface (`chainRegistry.ts:47-65`) gets one
new field. Avoids creating a parallel registry — extension only.

```typescript
// chainRegistry.ts — add to interface ChainConfig
export interface ChainConfig {
    // ... existing fields ...
    honeypotChecker: {
        deployedAddress: string | null;  // null when Option C is used for this chain
        method: 'on-chain-contract' | 'eth_simulateV1';
    };
}

// Then in CHAIN_TEMPLATES (lines 99-263), add per-chain entries:
eth: {
    // ... existing ...
    honeypotChecker: { deployedAddress: '0x...' /* deployed address */, method: 'on-chain-contract' },
},
bsc: {
    // ... existing ...
    honeypotChecker: { deployedAddress: '0x...', method: 'on-chain-contract' },
},
base: {
    // ... existing ...
    honeypotChecker: { deployedAddress: '0x...', method: 'on-chain-contract' },
},
arb: {
    // ... existing ...
    honeypotChecker: { deployedAddress: '0x...', method: 'on-chain-contract' },
},
```

This co-locates the address with the rest of the chain configuration
(WETH, factory, router, MEV strategy, gas) and inherits the same
"add a chain = add a config object" pattern from the v6.16 architecture.

### Where the new gate slots in (`bot.ts:220-226`)

The current broken sell-sim is a **standalone gate before the parallel
safety bank**. Three placement options were considered. The recommended
choice is option (a):

| Placement | Lines | Trade-off |
|-----------|-------|-----------|
| **(a) Replace in-place at lines 220-226** | bot.ts:220-226 | Minimal diff. Preserves the "always-on hard block before parallel bank" semantic from FIX-04. Same Telegram alert wiring. **Chosen.** |
| (b) Add to the parallel `Promise.all` at lines 229-238 | bot.ts:229-238 | Concurrent with other 8 checks. Slight latency improvement. But mixing the deterministic, slow sim with the high-variance API-based bank makes timeout tuning awkward. Rejected. |
| (c) Both (a) and (b) — sim before, third-party honeypot check parallel | both | Defense-in-depth. But the third-party check (`checkHoneypotForChain` at line 230) already lives in the parallel bank, providing this layering for free. Rejected as duplication. |

**The chosen wiring (option a):**

```typescript
// src/bot.ts:220-226 (post-replacement)
import { simulateHoneypot } from './utils/honeypot';

// ... within handleNewPairForChain after the canSnipe check ...

// Replaces the broken simulateSellForChain (always-on, hard block on failure)
// HONEY-01: Uses on-chain HoneypotChecker (Option D) by default; falls back to eth_simulateV1
// per ctx.chain.honeypotChecker.method.
const honeypotResult = await simulateHoneypot(ctx, dex, targetToken);
if (honeypotResult.isHoneypot || honeypotResult.error) {
    ctx.log.warn({ token: targetToken, reason: honeypotResult.error ?? 'sell-blocked', buyTax: honeypotResult.buyTaxBps, sellTax: honeypotResult.sellTaxBps }, 'Honeypot detected, skipping buy');
    await sendCtxAlert(ctx, `*Honeypot blocked* \`${targetToken}\`: ${honeypotResult.error ?? `sell-tax=${honeypotResult.sellTaxBps}bps`}`);
    return;
}
```

The parallel bank (lines 229-238) is **unchanged** — `checkHoneypotForChain`
(third-party API dispatch) continues to run alongside as defense-in-depth.
The new sim catches honeypots that third-party APIs miss; the third-party
APIs catch honeypots that exist in their databases but might fool the sim
(rare but possible with delayed-activation traps).

### V3 integration

`handleNewV3PoolForChain` at `bot.ts:411-416` has the same broken sell-sim
gate (V3 vacuous pass). It gets the same replacement at the same relative
position. The `simulateHoneypot` dispatch passes `dex.dexType` and the
relevant V3 router/quoter addresses; the implementation switches on DEX
type internally.

### Multi-chain implications

**Option D:** One contract deploy per enabled chain. The deploy script is
parameterized over the chain's V2 router and WETH addresses (the contract
can be DEX-version-agnostic — V3 uses the same swap path, just through
different router ABI). Deployed addresses get hardcoded into
`CHAIN_TEMPLATES` after deployment. Total one-time cost: ~$10 across all
four chains.

**Option C:** Requires `eth_simulateV1` RPC support. Per chain:

| Chain | `eth_simulateV1` support | Notes |
|-------|--------------------------|-------|
| ETH (Alchemy/Infura) | Yes | Available since Cancun fork; Alchemy and Infura both expose it |
| BSC | Provider-dependent | bloXroute private RPC has it; public BNB endpoints don't |
| Base | Yes via Alchemy | Coinbase sequencer also supports |
| Arbitrum | Yes via Alchemy | Arbitrum Nitro RPC has it |

Practical implication: the bot must detect at startup whether the
configured RPC supports the method. The preflight checker (see §4) verifies
this. If unsupported, the bot either falls back to Option D (if deployed
on that chain) or fails-fast at startup.

### Failure semantics

**Both options must fail-closed.** If the simulator throws, the RPC times
out, the contract reverts unexpectedly, or the response is malformed, the
gate returns `{ isHoneypot: true, error: '<reason>' }`. The buy is
skipped. This matches the existing v6.16 fail-closed pattern in
`tokenSafety.ts:506-507` (transfer-tax check defaults to true on
exception).

---

## 2. Anti-Rug Runtime Architecture

### Module structure

```
src/anti-rug/
├── detector.ts        # Per-position WS subscription to Pair.Burn / Transfer(to=0x0); threshold logic
├── exitTrigger.ts     # Bridge to exitEngine.executeFullSell with elevated gas + 'anti-rug' reason
└── lpBaseline.ts      # Snapshot LP reserves at buy time; persist to lp_baseline table
```

**Decision: New `src/anti-rug/` module — NOT folded into `src/exit-engine/`.**

The exit engine is a single 5s poll loop with deterministic ordering of 7
exit conditions. Anti-rug is **event-driven**, not poll-driven. The two
have different lifecycles:

| Concern | Exit engine (existing) | Anti-rug (new) |
|---------|------------------------|---------------|
| Trigger | Time-based poll every 5s | WS event from Pair contract |
| Latency budget | 5s acceptable | < 1 block (12s ETH, 3s BSC) — must frontrun the rug pull's sell |
| Cleanup hook | `clearAllTimersForToken` (interval) | `unsubscribeAntiRug` (WS listener removal) |
| Failure mode | Skip cycle, retry next 5s | Hard error — log + alert + escalate |

Folding anti-rug into the existing 5s loop would **add latency**
(detection has to wait up to 5s for the next poll) and would couple two
unrelated lifecycles. The new module respects the existing
`exitManager.ts` lock registry but owns its own subscription registry.

### Subscription lifecycle

```
[Buy success @ bot.ts:332-341]
    |
    v
[startExitMonitor]  ──── existing v6.16 ────────────────┐
    |                                                    |
    | (parallel call site, both attach in bot.ts buy block)
    v                                                    |
[startAntiRugMonitor (NEW)]                              |
    |                                                    |
    | 1. Snapshot LP reserves (read pair.getReserves())  |
    | 2. INSERT INTO lp_baseline (trade_id, token0_res, ─┘
    |    token1_res, lp_total_supply, ts)
    | 3. Subscribe to Pair.Burn(sender, amount0, amount1, to)
    | 4. Subscribe to Pair.Transfer(from, to=0x0, value)
    |    (catches LP-token burns going to 0x0)
    | 5. Register WS listener in antirug timer registry
    v
[On Pair.Burn or LP Transfer to 0x0 event]
    |
    | Compute: removed % = (amount_removed / lp_baseline.total_supply) * 100
    | Check: is amount_removed > threshold (e.g., 50%)?
    | YES →
    v
[exitTrigger.frontrunExit]
    |
    | 1. tryAcquireSellLock (respects existing exit-engine mutex)
    | 2. Build elevated-gas tx (priority fee multiplier from config)
    | 3. Call exitEngine.executeFullSell with reason='anti-rug'
    |    (executeFullSell becomes a discriminated union; see "Reason
    |    type extension" below)
    | 4. clearAllTimersForToken (also kills the 5s exit loop)
    v
[Position exits via existing exit-engine path]
```

**The anti-rug detector does NOT submit transactions directly.** It calls
into `exitEngine.executeFullSell` because that path already implements:

- The sell lock (`tryAcquireSellLock`) — prevents double-sell race with
  the 5s poll loop
- Receipt decoding (`decodeReceipt`) — populates `amount_out`, `gas_cost`
- Trade-row insertion (`insertTrade.run` with action='sell')
- DB cleanup (`deleteExitState`, `clearAllTimersForToken`)
- Telegram alerts (`sendCtxAlert`)

Re-implementing any of these would duplicate the v6.16 exit pipeline. The
new code is purely "detect rug → call existing sell" — no parallel exit
path.

### Reason-type extension in `exitEngine.ts`

`executeFullSell` (`exitEngine.ts:424`) currently accepts:

```typescript
reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell',
```

v6.17 extends to:

```typescript
reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug',
```

`anti-rug` triggers the **elevated-gas path**: the existing
`buildV2SellTx` / `buildV3SellTx` builders accept a `gasLimit`; for
anti-rug exits, the tx builder additionally passes a higher
`maxFeePerGas` / `maxPriorityFeePerGas` (or `gasPrice` for legacy chains)
multiplier — sourced from `ctx.chain.gas.multiplier * antiRugMultiplier`,
default 2.0x. The existing MEV strategies (Flashbots/bloXroute/passthrough)
all support custom gas params; this is just a parameter passed through.

### Threshold logic — what counts as "rug"

The detector must distinguish legitimate liquidity adjustments from rugs.
Recommended threshold (deferable to PITFALLS.md research depth):

| Signal | Threshold | Rationale |
|--------|-----------|-----------|
| LP burned (Transfer to 0x0) | > 50% of `lp_baseline.total_supply` | Half the LP gone in one tx is the canonical hard-rug signature |
| Pair.Burn event | `amount_removed > 0.5 * lp_baseline.token0_res` (WETH side) | Same, but caught earlier — Burn fires before Transfer |
| Time-since-launch | < 24h since buy | Optional gate — old positions sometimes see legit LP movements; new launches almost never. Defer to PITFALLS research |

The thresholds are **per-chain configurable** via env vars
(`ETH_ANTIRUG_PCT=50`, etc.), with sensible defaults baked into
`CHAIN_TEMPLATES`.

### Frontrun-exit integration

Pure "detect → submit sell" cannot guarantee frontrun on every chain. On
ETH, Flashbots gives priority via the bundle. On BSC, bloXroute private
mempool gives priority. On Base / Arbitrum sequencer-ordered chains,
frontrun is not possible — the sequencer determines order.

**The anti-rug exit submits via the same `sendTxWithRetry` path** as a
normal exit. The "frontrun" comes for free from MEV strategies on chains
that support it; on Base/Arbitrum it degrades gracefully to "submit a
sell ASAP and hope it lands in the next block alongside the rug." This
is the realistic ceiling — guaranteeing frontrun across all four chains
isn't achievable without per-chain custom infrastructure that's out of
scope.

### Multi-chain implications

Anti-rug detection is **per-position**, so chain-awareness is inherited
from the position's `ChainContext`. The detector subscribes to events on
`ctx.wsProvider`, the same WS connection the factory listener uses. No
new RPC connections.

For chains without WS (HTTP polling fallback in `bot.ts:644-696`),
anti-rug must also fall back to polling — a 2-3s `pair.getReserves()`
loop in `detector.ts`. Latency is worse but the detection still works.
This polling fallback is the same pattern the existing factory listener
uses; reuses the polling interval.

### Resume-on-restart

Just like exit state, anti-rug subscriptions must be re-established on
bot restart. The flow:

```
[Bot startup → resumeMultiChainMonitoring (bot.ts:838)]
    |
    | For each pending trade in DB:
    | 1. Resume exit monitor (existing v6.16 code path)
    | 2. NEW: Resume anti-rug monitor
    |    - SELECT FROM lp_baseline WHERE trade_id = ? → load baseline
    |    - Re-subscribe to Pair.Burn / Transfer events
    |    - If lp_baseline missing (pre-v6.17 trade) → snapshot now
```

---

## 3. Exit Engine Live-Runtime Hardening

The 6 deferred human-verification items from v6.16 close. Each gets
real code/test work, organized below by integration point.

### Smoke test harness — file layout

```
test/fork/
├── smokeHarness.test.ts             # NEW: end-to-end real-mainnet replay
├── fixtures/
│   └── realLaunches/                # NEW: captured real launches
│       ├── pepe2-launch.json        # PairCreated event + initial mints + first 100 swaps
│       ├── shib-launch.json
│       └── README.md                # How to capture new fixtures
├── snipeLifecycle.test.ts           # EXISTING: synthetic FakeToken lifecycle
├── setup.ts                         # EXISTING: hardhat fork setup
└── teardown.ts                      # EXISTING
```

**The smoke harness is a Vitest fork test, NOT a separate Vitest project.**
The existing `vitest.config.ts` has a `fork` project (used by
`npm run test:fork`); the new harness file lives there. Discovered by
glob — no config change.

The capture process:

1. Capture script (`scripts/capture-launch.ts`) takes a token address +
   block range, queries mainnet for `PairCreated` event, then queries
   the next N blocks for `Mint` and `Swap` events on that pair.
2. Serializes the events to JSON in `test/fork/fixtures/realLaunches/`.
3. The smoke harness loads each fixture, deploys mock factory + WETH on
   the fork, replays the events to drive the bot's
   `handleNewPairForChain`, and asserts the full lifecycle (validation,
   buy, exit-engine ticks, sell on stop-loss / trailing).

This catches integration bugs that synthetic FakeToken tests miss —
real tokens have real transfer hooks, real fee-on-transfer behavior,
real gas costs.

### Real-mainnet-fixture test pattern (the v6.16 deferral resolution)

The 6 deferred items resolve as follows:

| Deferred item | Resolution path | Files touched |
|---------------|-----------------|---------------|
| Live exit poll cycle + state persistence across restart | New fork test: start exit monitor, kill process mid-poll, restart, assert resume from DB matches expected high-water mark | `test/fork/exitResume.test.ts` |
| Real sell `amount_out` non-null | Fork test: simulate a buy + sell on real WETH, assert `decodeReceipt` populates `amount_out` from the Transfer event log | `test/fork/receiptDecoder.fork.test.ts` |
| Real Flashbots tx hash on mainnet | Cannot test on fork — requires Sepolia+Flashbots. Add to `GOING-LIVE.md` runbook §pre-flight checks; manual verification on first live snipe | `docs/operations/going-live.md` |
| Dashboard WS position updates in browser | Vitest browser-mode test (or Playwright) — open dashboard, trigger position via API, assert WS message arrives with correct payload | `test/integration/api/dashboardWs.test.ts` |
| Live price/Telegram/chain restart warnings | Fork test: stop ETH chain via API, restart, assert warnings array contains expected strings | `test/integration/api/chainRestart.test.ts` (extends existing file) |
| SQLite + `.bot-state.json` migration on real boot | Fork test: drop a `.bot-state.json` with synthetic data alongside an empty `data/bot.db`, run `migrateJsonState()`, assert rows imported correctly | `test/integration/dbMigration.test.ts` |

### Telemetry — pino enrichment vs new dashboard panel

**Recommendation: pino log enrichment ONLY** (no new dashboard panel) for
v6.17.

Add a structured `op` field to all exit-engine logs:

```typescript
// exitEngine.ts (modify existing log calls)
ctx.log.info({ op: 'exit.poll.tick', token, priceMultiple, hwm }, 'Exit engine tick');
ctx.log.info({ op: 'exit.partial.executed', token, tier, amount }, 'Partial sell completed');
ctx.log.info({ op: 'exit.full.executed', token, reason, txHash }, 'Exit sell TX confirmed');
ctx.log.error({ op: 'exit.poll.error', token, err }, 'Exit engine poll error');
```

This makes log-aggregation queries trivial (`op:exit.full.executed` shows
all exits) without UI work. A dashboard "exit engine ticker" panel was
considered but rejected for v6.17:

- Already shipped: live positions panel (positions.ts) shows current
  high-water mark and trailing %.
- Already shipped: trades table (trades.ts) shows realized exits.
- A live tick stream would be expensive (60+ events/min per position
  via WS) and provides little new info.

Defer the dashboard panel to a future polish milestone.

### State persistence verification

The existing `exit_state` table (db.ts schema v3) stores all exit-engine
state. The verification work is purely a test, not a code change:

```typescript
// test/fork/exitResume.test.ts (sketch)
test('exit state survives bot restart', async () => {
    // 1. Start bot, snipe, let exit engine tick 10 times
    await runBot(); await snipe(); await wait(50_000);
    const stateBefore = db.prepare('SELECT * FROM exit_state').all();

    // 2. Kill bot (SIGTERM)
    await killBot();

    // 3. Restart, assert exit_state intact
    await runBot();
    const stateAfter = db.prepare('SELECT * FROM exit_state').all();
    expect(stateAfter).toEqual(stateBefore);

    // 4. Wait one poll cycle, assert engine is ticking again
    await wait(10_000);
    const stateNext = db.prepare('SELECT * FROM exit_state').all();
    expect(stateNext[0].volatility_samples).not.toEqual(stateBefore[0].volatility_samples);
});
```

No production-code change needed — the persistence is correct in v6.16.
The test is the deliverable.

---

## 4. Going-Live Ops Hardening Integration

### Wallet balance preflight — file location

**Decision: New `src/preflight.ts` module, called from
`startMultiChainBot` BEFORE any chain context creation.**

Rejected alternatives:

| Alternative | Why rejected |
|-------------|--------------|
| Inline in `bot.ts:702-714` | Couples preflight to orchestrator startup; harder to test in isolation |
| In `chainRegistry.ts` `createChainContext` | Per-chain preflight runs on every chain start (e.g., chain restart via dashboard); should be one-shot |
| In `config.ts` validator | Config validator is for env-var presence; balance-checking requires live RPC + wallet, different concern |

The preflight module:

```typescript
// src/preflight.ts (NEW)
import type { ChainConfig } from './chainRegistry';
import { JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';

export interface PreflightResult {
    passed: boolean;
    fatalErrors: string[];
    warnings: string[];
}

export async function runPreflight(chains: ChainConfig[]): Promise<PreflightResult> {
    const fatalErrors: string[] = [];
    const warnings: string[] = [];

    for (const chain of chains) {
        const provider = new JsonRpcProvider(chain.httpRpcUrl);
        const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
        const balance = await provider.getBalance(wallet.address);
        const required = parseEther(chain.maxCapital);

        if (balance < required) {
            fatalErrors.push(
                `[${chain.name}] Wallet balance ${formatEther(balance)} < ${chain.maxCapital} (max capital). Fund or lower ${chain.envPrefix}_MAX_CAPITAL.`
            );
        }

        // Honeypot checker code-at-address verification (Option D)
        if (chain.honeypotChecker.method === 'on-chain-contract' && chain.honeypotChecker.deployedAddress) {
            const code = await provider.getCode(chain.honeypotChecker.deployedAddress);
            if (!code || code === '0x') {
                fatalErrors.push(
                    `[${chain.name}] HoneypotChecker not deployed at ${chain.honeypotChecker.deployedAddress}. Run: npx ts-node scripts/deploy-honeypot-checker.ts ${chain.name}`
                );
            }
        }

        // eth_simulateV1 support check (Option C)
        if (chain.honeypotChecker.method === 'eth_simulateV1') {
            try {
                await provider.send('eth_simulateV1', [{ blockStateCalls: [] }, 'latest']);
            } catch (e: unknown) {
                fatalErrors.push(`[${chain.name}] RPC does not support eth_simulateV1: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    // Stale-data warnings (warning, not fatal)
    const { db } = require('./utils/db');
    const stalePositions = db.prepare(
        `SELECT COUNT(*) as c FROM trades WHERE status='pending' AND timestamp < ?`
    ).get(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60) as { c: number };
    if (stalePositions.c > 0) {
        warnings.push(`${stalePositions.c} pending positions older than 7 days — review or manually resolve`);
    }

    return { passed: fatalErrors.length === 0, fatalErrors, warnings };
}
```

Wired into `bot.ts:702-714`:

```typescript
// src/bot.ts startMultiChainBot, after buildChainRegistry, before chain context loop
const enabled = getEnabledChains(registry);
const result = await runPreflight(enabled);
for (const w of result.warnings) mainLog.warn(w);
if (!result.passed) {
    for (const e of result.fatalErrors) mainLog.fatal(e);
    process.exit(1);
}
```

### Env validation upgrades — extend `src/config.ts`

The existing `REQUIRED_ENV_VARS` array (`config.ts:13-66`) is the
extension point. v6.17 adds:

```typescript
// config.ts — append to REQUIRED_ENV_VARS
{ name: 'ANTIRUG_THRESHOLD_PCT', required: false, description: 'LP-removal % that triggers anti-rug exit (default: 50)' },
{ name: 'ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Gas-price multiplier for anti-rug frontrun exits (default: 2.0)' },
{ name: 'HONEYPOT_CHECKER_METHOD', required: false, description: 'on-chain-contract|eth_simulateV1 (default per-chain)' },
```

The existing validator (`validateEnvVars()` at `config.ts:68-79`) handles
these automatically. No new validation logic.

The validation **error message upgrade** (a v6.17 deliverable) modifies
the existing function:

```typescript
// config.ts — replacement for current validateEnvVars
function validateEnvVars(): void {
    const missing: string[] = [];
    for (const spec of REQUIRED_ENV_VARS) {
        if (spec.required && !process.env[spec.name]) {
            missing.push(`  ${spec.name}: ${spec.description}`);
        }
    }
    if (missing.length > 0) {
        const firstMissing = missing[0].trim().split(':')[0];
        const message = [
            'Missing required environment variables. Bot cannot start.',
            '',
            'Missing:',
            ...missing,
            '',
            `Quick fix: Set ${firstMissing} in your .env file. See docs/operations/going-live.md for the full setup checklist.`,
        ].join('\n');
        logger.fatal({ missing: missing.map(m => m.trim().split(':')[0]) }, message);
        process.exit(1);
    }
}
```

Better error message, points to the runbook, otherwise same behavior.

### Stale-data warnings

Already covered in the preflight module above. The query:

```sql
SELECT COUNT(*) FROM trades WHERE status='pending' AND timestamp < unixepoch() - 7*24*60*60
```

Logs as a warning (not fatal). Operator decides whether to manually
mark them as failed or restart the exit monitor for each.

### Runbook formalization

Move `GOING-LIVE.md` to `docs/operations/going-live.md` and link from
`README.md`. Add CI link-check (markdown-link-check or lychee) to
`.github/workflows/ci.yml`.

```
docs/
└── operations/
    └── going-live.md        # MOVED from /GOING-LIVE.md
README.md                    # Updated to link to docs/operations/going-live.md
.github/workflows/ci.yml     # Add: link-check step
```

---

## 5. Tech Debt Cleanup Integration

These are not architectural changes — they're targeted code/test edits
within existing files.

### Per-phase Nyquist validation

Run `/gsd-validate-phase {N}` for phases 01, 02, 03, 05, 06, 07, 08, 09,
10. This is a planning-tool operation, not a code change. It creates
`.planning/phases/{N}-*/VALIDATION.md` files and may surface follow-up
work, but the v6.17 plan budgets the surfaced work as discoverable
during the phase, not pre-budgeted.

### 37 `.todo` exit-engine test stubs

The previously-claimed "37 .todo stubs" appear to have been already
filled — `test/unit/exitEngine.test.ts` line 3 reads
"All .todo stubs from Phase 7 replaced with real test implementations"
and a grep for `\.todo\(` finds no matches. **The v6.17 phase verifies
this claim** with a specific assertion in the phase-validation pass:
search recursively for `.todo(` across `test/`, expect zero matches. If
matches surface, treat per-stub as either fill-or-delete.

### 6 TS annotation errors in `src/dashboard/api/`

The codebase actually mounts the dashboard at `src/api/`, not
`src/dashboard/api/` — the project name in PROJECT.md is informal. A
fresh `npx tsc --noEmit` came back clean (no errors emitted). The v6.17
phase **verifies via CI that `tsc --noEmit` passes**, and if errors do
surface (perhaps with stricter `tsconfig` flags introduced as part of
v6.17), the fix-or-suppress decision is per-error:

| Error class | Action |
|-------------|--------|
| Missing return type | Add explicit return type |
| Implicit any | Annotate with proper type from existing types |
| Unused import | Remove |
| Genuine type error | Fix the underlying issue (no `@ts-ignore`) |

The `@ts-expect-error` and `@ts-ignore` keywords are banned in the
v6.17 phase per the existing project convention (see
`.planning/codebase/CONVENTIONS.md` §Type-system discipline if defined,
otherwise add it).

### Dead-code / diagnostic-log cleanup

Remove the items called out in v6.16 close audit:

| Item | File | Action |
|------|------|--------|
| Diagnostic console.log lines 55, 61 | `src/telegramListener.ts` | Replace with `log.debug` or remove |
| `getTradesByToken` unused const | `src/utils/db.ts:215` | Either export-and-use or remove (likely remove, no callers) |

This cleanup is a single-file-per-fix pattern; no architecture impact.

---

## Build Order

The five v6.17 capability bundles have dependencies. Recommended order:

```
Stage 1 — Foundations (no inter-dependencies, parallelizable)
├── DEBT-01: Tech debt cleanup
│   - Verify .todo stubs claim
│   - Verify tsc --noEmit clean
│   - Diagnostic log + dead-code removal
├── OPS-LIVE-01: Runbook move (GOING-LIVE.md → docs/operations/going-live.md)
└── OPS-LIVE-02: Env-var error message upgrade

Stage 2 — Honeypot Detection (HONEY)
├── HONEY-01: Add ChainConfig.honeypotChecker field + CHAIN_TEMPLATES entries
├── HONEY-02 (Option D): Author HoneypotChecker.sol + tests
├── HONEY-03 (Option D): Author scripts/deploy-honeypot-checker.ts
├── HONEY-04: Author src/utils/honeypot/checkerContract.ts (Option D primary)
├── HONEY-05 (optional): Author src/utils/honeypot/simulator.ts (Option C fallback)
├── HONEY-06: Author src/utils/honeypot/index.ts dispatch
├── HONEY-07: Replace src/bot.ts:220-226 (V2) and bot.ts:411-416 (V3)
├── HONEY-08: Delete or archive src/utils/tokenSafety.ts simulateSell* functions
└── HONEY-09: Deploy on first chain (ETH); verify with preflight

Stage 3 — Exit Engine Live Runtime (EXIT-LIVE)
├── EXIT-LIVE-01: Capture real-launch fixtures (scripts/capture-launch.ts)
├── EXIT-LIVE-02: Smoke harness (test/fork/smokeHarness.test.ts)
├── EXIT-LIVE-03: Each of the 6 deferred items as separate test files
└── EXIT-LIVE-04: Pino log enrichment (op-field) — touches exitEngine.ts

Stage 4 — Anti-Rug (ANTIRUG)  [DEPENDS on HONEY for the safety pattern]
├── ANTIRUG-01: Schema migration v5 — lp_baseline table (db.ts)
├── ANTIRUG-02: src/anti-rug/lpBaseline.ts (snapshot + persist)
├── ANTIRUG-03: src/anti-rug/detector.ts (subscription logic)
├── ANTIRUG-04: src/anti-rug/exitTrigger.ts (bridge to executeFullSell)
├── ANTIRUG-05: Extend exitEngine reason union to include 'anti-rug'
├── ANTIRUG-06: Wire startAntiRugMonitor at bot.ts:332-341 (V2) and 522-530 (V3)
├── ANTIRUG-07: Wire resume on restart at bot.ts:838-880
└── ANTIRUG-08: Per-chain threshold env vars + CHAIN_TEMPLATES defaults

Stage 5 — Going-Live Preflight (OPS-LIVE)  [DEPENDS on HONEY-01 for honeypotChecker config]
├── OPS-LIVE-03: src/preflight.ts module
├── OPS-LIVE-04: Wire runPreflight in startMultiChainBot (bot.ts:702-714)
└── OPS-LIVE-05: New env-var entries in REQUIRED_ENV_VARS

Stage 6 — Verification
└── DEBT-02: Per-phase Nyquist validation (background, low-priority)
```

Stage 4 (ANTIRUG) depends on Stage 2 (HONEY) only because both extend
`ChainConfig` — building HONEY first means ANTIRUG inherits a known-good
extension pattern. The two could in principle be developed in parallel
if the `ChainConfig` extension is committed in a precursor PR.

Stage 5 (OPS-LIVE preflight) depends on HONEY-01 because preflight
verifies the honeypot-checker code-at-address. Run after HONEY.

---

## Architectural Patterns

### Pattern 1: Strategy Dispatch via Chain Config

**What:** New capabilities (honeypot, anti-rug) are configured per-chain
in `CHAIN_TEMPLATES` and dispatched via the `ChainContext.chain.<feature>`
field. No `if (chainName === 'eth')` branches outside the registry.

**When to use:** Any capability that has chain-specific behavior
(addresses, RPC method support, threshold defaults).

**Trade-offs:** One level of indirection (`ctx.chain.honeypotChecker.method`)
in exchange for trivial multi-chain extensibility.

**Example:**
```typescript
// src/utils/honeypot/index.ts
import { simulateViaContract } from './checkerContract';
import { simulateViaRPC } from './simulator';

export async function simulateHoneypot(
    ctx: ChainContext,
    dex: DexConfig,
    token: string,
): Promise<HoneypotResult> {
    const method = ctx.chain.honeypotChecker.method;
    if (method === 'on-chain-contract') {
        return simulateViaContract(ctx, dex, token);
    }
    if (method === 'eth_simulateV1') {
        return simulateViaRPC(ctx, dex, token);
    }
    throw new Error(`Unknown honeypot method: ${method}`);
}
```

### Pattern 2: Defense in Depth — Pre-Buy + Runtime

**What:** Honeypot and rug detection run **both before the buy**
(simulator) **and during the position lifetime** (anti-rug). The pre-buy
gate catches honeypots that already exist at launch; the runtime
detector catches rugs that activate after launch.

**When to use:** Any safety property that can change post-launch
(transfer-blacklists, delayed-tax, LP removal).

**Trade-offs:** More code than a single check. But MEV-extracted-token
attacks specifically exploit the gap between pre-buy validation and
position lifetime.

**Example:**
```
[Pre-buy] simulateHoneypot → caught: token reverts on sell
[Pre-buy] checkHoneypotForChain → caught: honeypot.is database hit
                                  ↓ all pass
                               [Buy]
                                  ↓
[Runtime] startExitMonitor → 5s poll for trailing/stop-loss
[Runtime] startAntiRugMonitor → WS sub for LP removal
```

### Pattern 3: Reuse Existing Sell Path

**What:** New triggers (anti-rug) call into existing
`exitEngine.executeFullSell` instead of submitting transactions
directly. Adds a new `reason` value to the discriminated union; the
function dispatches.

**When to use:** Any new exit trigger.

**Trade-offs:** Couples new triggers to the exit engine's invariants
(sell lock, receipt decoding, DB cleanup). Avoids re-implementing those.

### Pattern 4: Extend Schema, Don't Replace

**What:** The new `lp_baseline` table is an additive schema migration
(v4→v5). Existing tables (`trades`, `exit_state`) unchanged.

**When to use:** Always — additive migrations only. SQLite cannot
ALTER CHECK constraints, so any change to existing constraints requires
recreate-and-copy (the v3 migration did this); avoid that pattern when
possible.

**Example:**
```typescript
// src/utils/db.ts — add to migrateSchema after v4
if (version < 5) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lp_baseline (
            trade_id INTEGER PRIMARY KEY,
            pair_address TEXT NOT NULL COLLATE NOCASE,
            token0_reserve TEXT NOT NULL,
            token1_reserve TEXT NOT NULL,
            lp_total_supply TEXT NOT NULL,
            snapshot_ts INTEGER NOT NULL,
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE INDEX IF NOT EXISTS idx_lp_baseline_trade ON lp_baseline(trade_id);
    `);
    logger.info('Created lp_baseline table (schema version 5)');
}
db.pragma(`user_version = 5`);
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Parallel Exit Path for Anti-Rug

**What people do:** Anti-rug detector submits a sell transaction
directly via `wallet.sendTransaction` because it's "faster."

**Why it's wrong:** Bypasses the sell lock. Two parallel exits (anti-rug
+ trailing-stop) can submit simultaneously; one reverts and burns gas.
Receipt decoding doesn't run; `amount_out` is null. Trade row inserted
out-of-band; dashboard shows phantom position.

**Do this instead:** Always go through `exitEngine.executeFullSell`. It
holds the lock. The "frontrun speed" comes from the gas multiplier and
MEV strategy, not from skipping the lock.

### Anti-Pattern 2: New Module for Honeypot Detection Outside `src/utils/`

**What people do:** Create `src/honeypot/` as a top-level directory
parallel to `src/utils/`.

**Why it's wrong:** Breaks the existing convention. `src/utils/` already
hosts `safetyProviders/` (chain-aware safety APIs) and `tokenSafety.ts`
(legacy single-chain safety). Honeypot detection is conceptually
identical — it's a token-safety gate.

**Do this instead:** `src/utils/honeypot/` as a sibling to
`safetyProviders/`. Imports via `import { simulateHoneypot } from
'./utils/honeypot'`.

### Anti-Pattern 3: Storage-Slot Probing as Default

**What people do:** Implement Option C (state overrides) as the primary
honeypot path because "no contract deploy needed."

**Why it's wrong:** Storage-slot probing is brittle (Vyper, UUPS, rebasing
tokens have non-standard layouts). Silent wrong-answer when the layout
guess is wrong. The bot loses ETH on tokens that pass the bogus check.

**Do this instead:** Option D (deploy contract) as default. Option C as
**explicit opt-in fallback** (`HONEYPOT_CHECKER_METHOD=eth_simulateV1`)
for chains where deployment is impractical, with a startup warning that
flags the reduced reliability.

### Anti-Pattern 4: Silent Vacuous Pass on Edge Cases

**What people do:** When a check encounters an unexpected state (zero
balance, missing pair, RPC timeout), return `true` to "not block the
bot."

**Why it's wrong:** This is what shipped in v6.16 V3 sell-sim
(`tokenSafety.ts:603-606`) and is precisely what v6.17 is fixing. A
"pass" on unknown state is fail-OPEN.

**Do this instead:** Return `{ passed: false, reason: 'unknown_state' }`
or throw. Always fail-CLOSED. Skipping a buy is cheap; losing ETH to a
honeypot is not.

### Anti-Pattern 5: Dashboard Panel for Every New Feature

**What people do:** New telemetry → new dashboard panel.

**Why it's wrong:** Dashboard surface area grows. Each panel is a
maintenance cost. Real operators rarely watch the dashboard during a
snipe — they watch Telegram alerts.

**Do this instead:** Default to pino structured logs (queryable via
`grep`/`jq`/log-aggregator). Reserve dashboard panels for state that
operators actually look at: open positions, P&L, recent trades. Anti-rug
events fit better as Telegram alerts (already wired via `sendCtxAlert`)
than as a panel.

---

## Integration Points

### Internal Boundaries — v6.17 Additions

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `bot.ts:220-226` ↔ `src/utils/honeypot` | Direct function call (`simulateHoneypot(ctx, dex, token)`) | Replaces the two broken sell-sim functions |
| `bot.ts:332-341` ↔ `src/anti-rug/detector` | Direct call (`startAntiRugMonitor(ctx, dex, token, tradeId)`) parallel to existing `startExitMonitor` | Both attach on buy success |
| `src/anti-rug/exitTrigger` ↔ `src/exitEngine.executeFullSell` | Direct call with new `reason='anti-rug'` | Reuses existing sell pipeline |
| `bot.ts:702-714` ↔ `src/preflight` | Direct call before chain context loop | New startup gate |
| `src/utils/db` ↔ `src/anti-rug/lpBaseline` | New prepared statements (`upsertLpBaseline`, `getLpBaseline`) | Repository pattern; consistent with existing exit_state pattern |

### External Services — v6.17 Net New

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| HoneypotChecker contract (deployed) | `Contract.staticCall` via ethers v6 | One-time per-chain deploy via Hardhat. Address lives in `chainRegistry.ts`. |
| `eth_simulateV1` RPC method (Option C) | `provider.send('eth_simulateV1', [...])` (low-level escape hatch confirmed in ethers v6 docs) | Provider support varies by chain; verified in preflight. |
| Pair.Burn / Transfer events | WS subscription via `ctx.wsProvider`; HTTP polling fallback | Reuses existing factory-listener WS pattern. |

---

## Sources

- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\bot.ts` — Lines 220-226 (broken FIX-04 gate), 411-416 (V3 vacuous pass), 332-341 (post-buy hook), 702-832 (startup sequence)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\utils\tokenSafety.ts` — Lines 555-586 (V2 sim), 593-634 (V3 sim)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\exitEngine.ts` — Lines 424-519 (executeFullSell), 805-866 (startExitMonitor)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\chainRegistry.ts` — Lines 47-65 (ChainConfig), 99-263 (CHAIN_TEMPLATES)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\config.ts` — Lines 13-66 (REQUIRED_ENV_VARS)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\utils\db.ts` — Lines 27-123 (schema migrations)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\.planning\milestones\v6.16-research\ARCHITECTURE.md` — v6.16 architecture baseline
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\HONEYPOT-SIM-BRIEFING.md` — Bug brief and Option A/B/C/D candidate matrix
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\GOING-LIVE.md` — Existing runbook, target of formalization move
- ethers.js v6 docs (Context7 `/websites/ethers_v6`) — `JsonRpcProvider.send(method, params)` confirmed as escape hatch for `eth_simulateV1` and `eth_call` with state overrides
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\test\fork\snipeLifecycle.test.ts` — Existing fork-test pattern, model for smoke harness

---

*Architecture research for: v6.17 defensive hardening integration into existing v6.16 multi-chain sniper bot*
*Researched: 2026-04-29*
