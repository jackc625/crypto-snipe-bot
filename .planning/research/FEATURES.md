# Feature Research — v6.17 Defensive Hardening

**Domain:** Defensive hardening (pre-buy safety stack, anti-rug runtime monitoring, exit-engine live-runtime, going-live ops) for an existing live-mainnet multi-chain MEV sniper bot
**Researched:** 2026-04-29
**Confidence:** HIGH

---

## Scope Note

This is a **subsequent milestone** for an already-shipped bot (v6.16). Features that already exist — multi-chain detection, 5-rule canSnipe, unified exit engine, dashboard, SQLite audit, third-party API integrations as a parallel safety bank — are **NOT re-researched**. See `.planning/milestones/v6.16-research/FEATURES.md` for the v6.16 feature landscape.

**v6.17 is about closing concrete defensive gaps**, not greenfield features. Categorization here is therefore tighter than a typical "feature landscape" research output:
- **Table stakes** = published industry-standard practice for a 2026 mainnet sniper. Owner explicitly rejects shortcuts.
- **Differentiators** = features specifically valuable for this bot's posture (personal mainnet, real-money, defensive-first).
- **Anti-features** = things that look like obvious wins but introduce false-positive / fail-open risk that the owner has explicitly called out.

The owner's non-negotiables (from `HONEYPOT-SIM-BRIEFING.md` §"Constraints / non-negotiables"):
1. **No vacuous-pass** — `balance===0n → return true` is the bug being fixed, not the pattern to copy
2. **No third-party-API-only** — `honeypot.is`/`GoPlus` are good signals but rate-limited and can be deceived by upgrades; they are inputs, not the entire decision
3. **Must work for newly-launched tokens** — bot wallet has zero balance of target by definition
4. **Must fail-closed** — blocking the buy is the correct direction when uncertain

---

## Feature Landscape

### 1. Honeypot Detection Features

#### Table Stakes

| Feature | Why Expected | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **Buy/sell roundtrip simulation that exercises the token's `_transfer` hook in BOTH directions** | This is the single defining technique of every published industry honeypot detector ([honeypot.is](https://honeypot.is/), [GoPlus](https://goplussecurity.medium.com/dive-into-token-code-and-safeguard-web3-security-b7960a34a8fe), [valamidev/web3-defi-honeypot-and-slippage-checker](https://github.com/valamidev/web3-defi-honeypot-and-slippage-checker), [RugDoc](https://rugdoc.io/honeypot/)). Static analysis misses obfuscated honeypots; only execution against live state catches behavior. | HIGH | Replaces broken `simulateSellForChain` / `simulateSellV3ForChain` in `tokenSafety.ts:555-630`. Builds on existing `simulateSwapForChain` (which already works for buys via `staticCall` of `swapExactETHForTokens` with `value=amountIn` — the owner's briefing confirmed this). | Two viable architectures (briefing's options C and D): `eth_simulateV1` with state overrides on a public RPC (Alchemy/Infura), OR a deployed on-chain checker contract called via `eth_call`. Both exercise transfer hooks in both directions. The "valamidev" reference contract on GitHub is a public template that does buy→approve→sell in one call and returns buy/sell tax — already deployed on ETH/Arbitrum/BSC/Base. **Owner has flagged this for architecture decision in the discuss-phase.** |
| **Per-token buy-tax and sell-tax extraction (numerical, not boolean)** | Industry standard (`honeypot.is`, GoPlus return numerical taxes; valamidev contract returns "tax percentages"). Boolean "is honeypot" can't distinguish a 30%-tax legit-but-ugly token from a 100%-block honeypot, both of which fail a binary check. Owner's `hasHighTransferTaxForChain` (tokenSafety.ts:475-508) already wants a numerical answer but uses a fragile non-staticCall path that may have the same `amountIn=0` family of bugs. | MEDIUM | Replaces `hasHighTransferTaxForChain`. The roundtrip simulator above produces this naturally — buy_amount_received vs sell_amount_received gives both taxes from one simulation. | Threshold tunable per-chain (existing config supports per-chain tunables). Owner's current threshold is 25% — keep as default but make the bot's *decision* a function of (buy_tax + sell_tax + slippage_budget) not a single threshold. |
| **Deny-list-based buy block detection (whitelist-only-buys / "anti-snipe")** | Many honeypots permit only whitelisted addresses to buy *or sell*. The bot's wallet won't be on any whitelist. Detected via the same buy/sell simulation: if `buy.staticCall` from a fresh address reverts but `getAmountsOut` succeeds, the contract has selective transfer logic. ([Cyberfoxx 2025 hacking guide](https://cyberfoxx.medium.com/smart-contract-hacking-a-to-z-a-real-world-guide-2025-1c58d6b04595): "Contracts that allow buying but prevent selling, as well as contracts with hidden taxes or transfer restrictions.") | LOW | Falls out of the same simulation as buy/sell roundtrip — comparing `getAmountsOut` (pure math) vs simulated `_transfer` execution. **No new code path needed if roundtrip is implemented correctly.** | Deserves a *named* assertion in the simulator output (e.g., `buyOk: bool, sellOk: bool, taxBuy: pct, taxSell: pct`) so logs are diagnosable. |
| **Transfer-pause / `tradingEnabled=false` detection** | Many launches deploy with `tradingEnabled=false` and flip it after dev wallet snipes the token themselves. Bot would buy at the listed price and find sells reverting. Owner's `checkTokenMetadataForChain` (tokenSafety.ts:366-387) tries `tradingEnabled?()` but **it's a soft check that defaults to `true` when the method doesn't exist**, which is also the case for legitimate tokens that don't expose this method. | LOW | Already exists in `checkTokenMetadataForChain`. Auditable as part of the existing 8+ gate audit (DEBT scope). | Don't make this a hard gate on its own — combine with roundtrip simulation. If the simulation succeeds, the trading-enabled state is *behaviorally* true regardless of what method names the contract exposes. |
| **Max-tx / max-wallet limit detection** | Anti-snipe / anti-bot tokens use these to make first buyers stuck; many honeypots use them as a back-door sell-blocker (set `maxTxAmount = 1` after launch). Owner's `hasMaxWalletOrTxLimitsForChain` (tokenSafety.ts:513-549) already covers this. | LOW | Already exists. Audit pass during DEBT scope to confirm it's not silently failing. | The check correctly defaults to `true` (block) on any error. Confirm the named methods (`maxWalletAmount`, `maxWallet`, `maxTxAmount`, `maxTransactionAmount`) cover modern token templates — consider adding `_maxTxAmount`, `maxBuyAmount`. |
| **Failure-direction discipline: every gate fails CLOSED** | Industry standard for safety-critical systems. Owner has explicitly enumerated this as a non-negotiable. The current bug is failing closed *too aggressively* (always blocks) — the fix must preserve the closed direction when uncertain. | LOW | Cross-cutting audit of all gates in `tokenSafety.ts`. | Specifically forbid the V3 vacuous-pass pattern (`balance===0n → return true`). Replace with simulation that exercises transfer regardless of balance state. |

#### Differentiators

| Feature | Value Proposition | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **N-of-M consensus across simulation + 2 third-party APIs** | Owner already has honeypot.is + GoPlus integrated in parallel. Adding a self-controlled simulation (option C or D) gives a 3rd independent signal. Scoring rule like "block if any 2 of 3 say honeypot, OR if our own simulation says honeypot regardless" is more robust than any single source. Mirrors how production threat-intel platforms aggregate signals. | MEDIUM | Builds on existing `checkHoneypotForChain` (tokenSafety.ts:335-340) parallel-bank dispatch. Adds a 3rd parallel-bank entry. | Critical that the *self-controlled* signal carries veto power — third-party APIs are rate-limited and can fail-open silently if the consensus rule isn't tuned right. Recommended: own-simulation veto + (any third-party agreement) → block. |
| **"Last-block" simulation freshness check** | Honeypots can be flipped at any block (owner sets `tradingEnabled=true` for one block, scammers buy, then flips back). Simulation that runs against block N-2 may show a sellable token that's already become unsellable at block N. Best-practice is to simulate against the *latest* block, ideally block N+1 (pending state). | LOW | Existing simulation already runs at `latest`. Verify and assert this in code; consider `pending` for ETH if Alchemy supports it on the chosen RPC. | Documenting this is more useful than coding it — make it part of the simulator's contract that the block tag is `latest` (or `pending`), and log the block number alongside the sim result. |
| **Simulator output as structured object, not boolean** | Existing gates return `Promise<boolean>`. A structured object (`{ blocked: bool, reason: string, buyTax: pct, sellTax: pct, blockNumber: int }`) lets the dashboard and Telegram alerts say WHY a buy was skipped, which is critical for debugging false positives — and false positives in this category cost real opportunities. | MEDIUM | Touches `bot.ts:170-260` (handleNewPairForChain composition) and dashboard's recent-events surface. | Pair this with a "skip reason" enum in the SQLite audit trail. The audit trail (DB-04 in v6.16) already exists; adding a `skip_reason` column is additive. |
| **Simulator runs against MULTIPLE wallet addresses** | Some whitelists are `EOA-from-launch-block`. Simulating with a fresh-each-time address (state-override-faked) mimics the bot's actual wallet posture. Some honeypots deny *new* addresses transfers entirely. | LOW | If `eth_simulateV1` with state override is chosen (briefing option C), this is essentially free — pick a random EOA per simulation. | Tiny but valuable for catching "fresh-address-blocked" honeypots that don't show up if you reuse the same simulator address. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Skip simulation when third-party API says "ok"** | Looks like an obvious latency optimization | Defeats the entire defense-in-depth model. honeypot.is/GoPlus have rate limits, can be deceived by upgradeable proxies, can be bribed. Owner has explicitly rejected this. ([Sushi/GoPlus collaboration article notes](https://www.sushi.com/blog/sushi-x-goplus-security): "honeypot detectors are not 100% accurate as they rely on available information"). | Run all signals in parallel; require self-controlled simulation to pass. |
| **Trust `getAmountsOut` as a "fast path" for sell-sim** | Pure-math view function, no RPC cost beyond a simple call. | This was option B in the briefing — explicitly rejected. `getAmountsOut` does not invoke `_transfer`. **It's literally what the bug is.** | Replace with simulation that *executes* the call. |
| **Cache simulation results by token address for 5+ minutes** | Reduces RPC cost on duplicate detections | Honeypot state can flip mid-block. Even 1-block-old cached results are dangerous if a scammer toggles `tradingEnabled` after one buy. | If caching is needed for cost reasons, key by `(token, blockNumber)` not by token alone, and treat any block change as a cache invalidation. |
| **"Pure analysis" simulation in a forked Hardhat node** | Lets you simulate without spending mainnet RPC credits | Forked-node simulation drifts from real mainnet state in subtle ways (gas pricing, state from past blocks, missing recent events). It also requires keeping a forked node running, which adds operational complexity. Owner's bot is a single-process Node.js, not a multi-service infra stack. | Use `eth_simulateV1` against the real RPC. Free tier on Alchemy supports state overrides. Hardhat-fork is good for *test fixtures* (where you want determinism), not for live decisions. |
| **Auto-disable simulation gate if it's been blocking >X% of recent attempts** | Looks like a self-healing fail-open mechanism | This is exactly the fail-open mode the owner has rejected. A scammer flooding launches in a single hour could push the block-rate above any threshold and effectively disable the gate. | Always run the gate. If it's blocking everything, alert the operator (Telegram); never auto-disable. |

---

### 2. Anti-Rug Runtime Monitoring Features (DETECT-02)

#### Table Stakes

| Feature | Why Expected | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **`Pair.Burn` event monitoring (V2) for open positions** | Industry-standard rug detection signal. The Uniswap V2 `Burn(sender, amount0, amount1, to)` event fires every time someone removes liquidity ([Uniswap V2 docs](https://docs.uniswap.org/protocol/V2/reference/smart-contracts/pair)). When the dev's address calls Burn on the pair, it's the textbook rug. **Detection is the prerequisite for any frontrun-exit response.** | MEDIUM | Builds on existing per-chain provider (`ChainContext.httpProvider` / `ChainContext.wsProvider`), unified exit engine (which already polls each open position every 5s), and `getPair(token, weth)` helpers. | Subscribe to `Burn` filter for each open position's pair on entry; remove subscription on close. Do not poll — use WebSocket subscriptions. |
| **LP token Transfer-to-dead-address monitoring** | An alternative rug pattern: dev sends LP tokens to `0xdEaD` *before* burning to bypass time-locks. Conceptually equivalent to a rug; needs the same exit response. | LOW | Same as above — subscribe to `Transfer(_, to=0xdEaD, _)` events on the pair contract. | Combine with `Pair.Burn` into a single "liquidity-event" listener per position. |
| **Large LP withdrawal threshold (e.g., >50% of pair LP-total in one tx)** | Not every LP burn is a rug — legitimate LPs may withdraw small amounts. False-positive suppression: only react when the burn is large relative to the pair's total LP supply. | LOW | Requires reading `pair.totalSupply()` at position-open and comparing burn amount. SQLite already stores position open metadata. | Threshold should be configurable. Default 50% is what `[arxiv Token Spammers paper](https://arxiv.org/html/2206.08202v3)` uses to define "rug"; some implementations use 99%. Pick conservative default (50%) for first-block exit response. |
| **Frontrun-exit triggering: emit a sell tx when rug detected** | Industry-standard response ([Maestro anti-rug docs](https://docs.maestrobots.com/faq/smart-rug-auto-sell), [BananaGun docs](https://docs.bananagun.io/)). Detection alone is useless; the value is racing the dev's tx out of the mempool. | MEDIUM | Hooks into existing exit engine's sell pipeline. Requires "panic-sell" code path that bypasses normal exit conditions and uses elevated gas. | Note: Maestro/BananaGun document this is **less reliable on BSC** (3s blocks) than ETH (12s blocks), and **doesn't work at all if the rug tx is sent privately** (e.g., via private mempool / Flashbots-style). The bot should still attempt — even a 30% success rate at frontrun beats 100% loss from no attempt. |
| **Rate limit on auto-exit triggers** | Without a rate limit, a misbehaving event-stream (RPC reconnect → replay events) could trigger N panic-sells for one position, each consuming gas. | LOW | Trivial — flag on the position once frontrun-exit is initiated; subsequent triggers no-op. | Critical for mainnet — gas waste on misfires is a real failure mode. |
| **Failure-direction discipline: false-positive monitor failure does NOT trigger exit** | The opposite failure mode of pre-buy: here, false positives are expensive (panic-sell at the bottom of normal volatility). Must distinguish "actual rug signal received" from "WebSocket disconnected and we don't know." | LOW | Requires explicit monitor health state tracking. Builds on the existing Phase-7 monitor-health pattern. | If the WebSocket drops, log a warning, flip to HTTP-poll fallback for `Pair.Burn` (not great but better than nothing), but **do not** trigger exits on missing data. |

#### Differentiators

| Feature | Value Proposition | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **Tax-change detection (token contract `setTaxFee` / similar)** | Major rug variant: dev raises sell-tax to 99% so victims can't extract. Detected by re-running the buy/sell simulator (table-stakes #1) periodically against live state. ([BananaGun anti-rug coverage](https://docs.bananagun.io/) explicitly includes "tax changes".) | MEDIUM | Reuses the simulator built for pre-buy gate. Add a slow-poll loop (every 30s on open positions) that re-runs sell-sim and triggers exit if sell-tax has materially increased. | Threshold: if sell-tax > buy-time-sell-tax + 20pct OR > 50% absolute, panic-exit. |
| **Owner-blacklist-self detection** | Detected via the simulator failing on the bot's actual wallet (vs a fresh wallet) — i.e., simulator reports "selling from this address now reverts." This catches selective blacklisting attacks from production-grade scams. ([BananaGun has this as a named feature](https://docs.bananagun.io/) — "Blacklist Transfer Feature: triggered if a developer blacklists a token contract.") | MEDIUM | Builds on the differentiator #5 above (multi-address simulation). Run sell-sim from bot's actual wallet vs from a fresh state-override address. | Hard signal; trigger frontrun-exit immediately. |
| **`Ownable.transferOwnership` / proxy-admin change events** | Fake-renounce: contract's "owner" is a proxy-admin; rugger transfers proxy-admin to a fresh wallet just before pulling. Detection via subscribing to `OwnershipTransferred` event on the token contract. | MEDIUM | Token contracts emit standardized `OwnershipTransferred(prevOwner, newOwner)` from OZ Ownable. Subscribe per open-position. | Slow-burn signal — owner change isn't a rug yet, but an early warning. Soft alert (Telegram), don't auto-exit. |
| **Liquidity-lock expiry monitoring** | If the LP lock (Unicrypt/PinkLock) is expiring within N hours, increase exit pressure. Owner already has Unicrypt + Mudra integrations for *checking* lock at buy-time; the differentiator is monitoring expiry on open positions. | LOW | Builds on existing `isLiquidityLockedForChain` providers. Add a position-open metadata field for `lock_expiry_ts`; the unified exit engine's age-weighted urgency can incorporate this. | Doesn't trigger exit on its own. Tightens trailing stop / partial-sell ratio if expiry < 24h away. |
| **Aggregated rug-signal scoring** | Instead of individual triggers, compute a "rug score" = weighted sum of (LP burn observed, tax increased, ownership transferred, liquidity-lock expired). Trigger exit when score crosses threshold. Reduces false positives from any single signal. | HIGH | Complex enough to warrant its own phase if pursued. | **Recommend defer to v6.18.** v6.17 should ship the individual-signal exits first (table stakes #1-#5), then evolve to scoring once we have signal frequency data from real positions. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Mempool monitoring of pending transactions for "rugger calls Burn"** | "Frontrun" only works if you see the tx before it lands — strictly, the only way to be earlier is to be in the mempool first. | Out of scope (DETECT-01 mempool sniping is deferred to a future offensive milestone, per PROJECT.md). Even if scoped in, mempool monitoring on ETH requires premium RPC tiers; on BSC, mempool data is contested ground for MEV searchers. The defensive value is small relative to the implementation cost. | Subscribe to mined `Pair.Burn` events. Frontrun success rate even from mined-block detection is documented (Maestro: "highly consistent on Ethereum"). |
| **Aggressive trailing stop tightening on the slightest signal** | "If anything looks suspicious, exit" | False positives are expensive. Token volatility includes legitimate -30% retracements that recover. Auto-exit at the bottom of those is a permanent loss. | Use **rate-limited** signals with consensus thresholds. Single signal = soft alert (Telegram); multi-signal = hard exit. |
| **Trust API-provided "is_proxy" and "is_open_source" flags as exit triggers** | GoPlus provides these in `token_security` API. | Many legitimate tokens are proxies (UUPS upgradeable). Many are unverified at launch. Using these as auto-exit triggers would exit most positions. | Use them as *priors* in the rug-score (differentiator #5), not as direct exit triggers. |
| **Auto-exit on social-signal events (Twitter/Telegram chatter)** | Could front-run "dev abandoned project" announcements. | Out of scope — DEX-only sniper. Social parsing is a different product. Also a false-positive minefield. | Owner already has Telegram alerts (existing v6.16); operator can manually emergency-sell. |

---

### 3. Live-Runtime Hardening Features (EXIT-LIVE)

These cover the 6 deferred human-verification items from v6.16 close that need to be closed as real code/test work.

#### Table Stakes

| Feature | Why Expected | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **Live exit-poll cycle measurement: telemetry that the 5s loop actually completes within budget on real RPC** | Without this, the unified exit engine's claimed "5s polling interval" is unmeasured. Real RPCs have latency tail (Alchemy P99 ~500ms; can spike to 5s+). If a poll cycle takes 7s, positions go un-monitored for a window. | LOW | Builds on existing pino structured logging (INFRA-01). Add `loop_duration_ms` field to each exit-engine cycle log. | Add a slow-cycle alert if duration > 4000ms (80% of 5s budget) — operator gets warned before the loop falls behind. |
| **State-persistence-across-restart validation: real test that exit state survives a SIGTERM and reloads on next start** | v6.16 deferred this to manual testing. Without an automated test, a regression in `.bot-state.json` migration or SQLite write timing could silently corrupt state on restart. | MEDIUM | Builds on existing `.bot-state.json` migration (Phase 3) and SQLite WAL (DB-01..04). | Test fixture: open position → SIGTERM → restart → assert position monitored. Mainnet-fork test pattern from v6.16's TEST-05. |
| **Real sell `amount_out` non-null on live mainnet** | v6.16 added receipt-decoded amount_out (DB-04, "Receipt decoder wired into every sell path"). Deferred validation = unproven on live mainnet. P&L visibility breaks if even one sell path returns null. | LOW | Builds on existing receipt decoder. Add an integration assertion: every closed-trade row has non-null `amount_out`. | Low-risk to validate (just runs once on real swap), high-cost if regressed. |
| **Real Flashbots tx-hash on mainnet** | Flashbots bundles return *bundle hashes*, not tx hashes — operator needs to verify the actual tx hash is captured and matches a mined tx. Deferred to manual testing in v6.16. | MEDIUM | Builds on existing Flashbots integration (FIX-08, FIX-09 retry correctness). | Add an end-to-end smoke test that goes from "buy attempted via Flashbots" → "tx mined" → "DB row has actual tx_hash". |
| **Dashboard WebSocket position-update verification in browser** | Dashboard pushes position updates via WebSocket (DASH-04). Deferred verification = the WebSocket → React rendering path is unproven on a live mainnet position. Could be silent regression if there's a missed event. | MEDIUM | Builds on existing WebSocket push (DASH-04) and React dashboard (Phase 12). | Best implemented as a Playwright/headless-browser test that opens the dashboard, simulates a position event, asserts UI render. Cypress or similar acceptable. |
| **Live price / Telegram / chain-restart warnings working on real boot** | Operator needs to see "BSC RPC dropped, reconnecting" and similar warnings end-to-end. Deferred = unproven the warning-emission code paths actually fire. | LOW | Builds on existing pino logging and Telegram alert plumbing. | Add a smoke test that simulates RPC drop and asserts a warning was logged and a Telegram alert was attempted. |

#### Differentiators

| Feature | Value Proposition | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **Real-mainnet-fixture testing pattern (vs. mainnet-fork)** | v6.16 has fork tests that snapshot mainnet state. Live-runtime regressions (e.g., RPC-specific quirks of Alchemy vs Infura) only surface against real RPCs. A small set of "live" smoke tests, manually triggered or run on a CI cron, validates real-RPC behavior. | MEDIUM | Builds on existing TEST-04 (mainnet-fork). | Drawback: costs real RPC credits and gas (if any tx is sent). Best as a manually-triggered `npm run test:live` rather than CI. |
| **Telemetry on real Flashbots responses (relay reputation, bundle inclusion rate)** | Flashbots returns `bundleStats` with simulation results, inclusion blocks, etc. Logging this enables the operator to know whether bundles are landing reliably. | MEDIUM | Existing Flashbots integration. Add a `flashbots_bundle_stats` table to SQLite for postmortem analysis. | Useful for future tuning (which gas levels actually land) and for debugging "why didn't my buy get included." |
| **Synthetic position end-to-end test ("canary trade")** | A planned, tiny ($0.0001 ETH) trade that the operator can manually trigger to validate the entire stack from detection → buy → exit → DB → dashboard. | HIGH | Builds on entire bot. | High value for first-live-run confidence; high implementation cost because the test itself is a real on-chain action. **Consider deferring to a later phase** unless owner specifically prioritizes. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **CI runs the live-mainnet smoke tests on every push** | Catches regressions earlier | Costs real RPC credits and gas on every PR. CI also uses public RPC endpoints which often have aggressive rate limits. | Run mainnet-fork tests on every push (already done); manual `npm run test:live` for live tests. |
| **Live RPC requests in unit tests** | "More realistic" | Slows test suite to network speed; flakes on RPC outages. | Stub RPCs in unit tests. Mainnet-fork (v6.16's TEST-05) covers integration realism. |
| **"Replay every historical block from launch" to validate all positions** | Thorough validation | Massive RPC cost (millions of `eth_getLogs` calls), slow, mostly redundant. | Validate position state against latest block only on startup. |

---

### 4. Going-Live Ops Features (OPS-LIVE)

#### Table Stakes

| Feature | Why Expected | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **Wallet balance pre-flight check at startup** | Owner explicitly called out in PROJECT.md and GOING-LIVE.md `Operational notes`: "The bot does not check wallet balance at startup. If unfunded, it starts cleanly and just fails every snipe with insufficient-funds errors." Standard operational hygiene for any tx-emitting bot. | LOW | New code — add to `bot.ts` startup. Existing `chainRegistry.ts` provides per-chain providers. | Compare wallet balance against `MIN_BALANCE_REQUIRED = ETH_SNIPE_AMOUNT * 2 + reserve_for_gas`. Hard-fail (FATAL) on undercut, not warning — balance is non-recoverable at runtime. |
| **RPC health check at startup (chainId match, latest block freshness, WebSocket connectivity)** | GOING-LIVE.md §2 already describes manual `eth_chainId` curl. Automating this as a startup gate is industry-standard for trading systems. ([Cherry Servers RPC requirements article](https://www.cherryservers.com/blog/ethereum-rpc-node-requirements): pre-flight RPC checks are standard.) | LOW | Existing chainId mismatch check (single guard mentioned in GOING-LIVE.md preamble). Extend to: chainId, latest block age < 60s, WebSocket reachable, eth_call on a no-op contract. | Add structured log "Pre-flight check: PASS / FAIL" that operator can grep on startup. |
| **MEV connectivity health check (Flashbots relay reachable; bloXroute auth valid; private mempool reachable)** | Existing "Flashbots health check passed" log line in GOING-LIVE.md §8. Generalize to all enabled chains: BSC bloXroute auth header validated, Base private RPC reachable, etc. | LOW | Existing Flashbots health check (FIX-09 hardened). | Each enabled chain's MEV strategy contributes one assertion. Hard-fail if any required-MEV chain fails. |
| **Stale-data warnings (e.g., position open >1h with no price update; provider dropped events)** | Standard operational safety. Without these, the operator doesn't know when monitoring has silently broken. | MEDIUM | Builds on existing per-position monitoring loop. Add per-position "last-update" timestamp; flag when older than 2x poll-interval. | Telegram alert on stale data, not auto-action. |
| **Env-validation messaging upgrades (clear messages, not "TELEGRAM_BOT_TOKEN is required")** | v6.16's FIX-03 added env validation. Owner's note in PROJECT.md says env-validation needs upgrading — implies the existing messages don't surface configuration mismatches well. ([Sushi/GoPlus Sushi blog](https://www.sushi.com/blog/sushi-x-goplus-security): clear failure messages reduce time-to-repair.) | LOW | Existing FIX-03 env validation infrastructure. | Examples: detect `PRIVATE_KEY=ac0974be...` (Hardhat default key) and FATAL-exit with "Hardhat default key detected — change before mainnet"; detect `DASHBOARD_API_KEY=password` and FATAL-exit. |
| **Formalized runbook with kill-switch automation** | Owner has a `GOING-LIVE.md` and a kill-switch via dashboard pause endpoint. Formalizing into a versioned runbook (and perhaps a `npm run kill` script that calls the pause endpoint without the curl-with-cookies dance) reduces operator friction during an incident. ([RuleMatch kill-switch reference](https://www.rulematch.com/trading/kill-switch/): kill-switch must be operable in seconds, not minutes.) | LOW | Existing dashboard pause endpoint (DASH-03). | `npm run pause` and `npm run resume` scripts that wrap the cookies+curl. Reduces incident-response time from minutes to seconds. |

#### Differentiators

| Feature | Value Proposition | Complexity | Existing v6.16 Dependency | Notes |
|---|---|---|---|---|
| **First-run mode: lower risk caps + verbose logging + mandatory acknowledgement** | A `FIRST_RUN=true` env that tightens limits (1 max position, 0.001 snipe), emits all logs at debug, and requires operator to manually acknowledge a "live mainnet confirmation" prompt before trading. | MEDIUM | Builds on existing CONFIG layer. | Similar in spirit to the GOING-LIVE.md §6 manual tuning, but enforced rather than documented. |
| **Post-run rollback path (auto-state-export on shutdown for forensic analysis)** | Existing graceful shutdown (FIX-02) already persists state. Differentiator is exporting a *postmortem snapshot* (positions, recent trades, last 100 log lines) on every shutdown for analysis if something went wrong. | LOW | Existing graceful shutdown + SQLite. | `data/postmortem-{timestamp}.json` written on every clean exit. Rotated; oldest 5 kept. |
| **Operator dashboard "live status" panel: balance, open positions, recent skip reasons** | The dashboard already has positions and trades. Adding a single "is this bot running healthy?" view (last RPC poll time, current wallet balance, last 10 skip reasons) reduces operator anxiety on first runs. | MEDIUM | Builds on existing DASH-04 WebSocket push. New panel in React dashboard. | Specifically: surface the *reason* a buy was skipped (which gate blocked) so the operator can tell "broken safety bank" from "no good launches today." Connects to differentiator #3 in honeypot section (structured simulator output). |
| **Configurable maximum loss before auto-pause** | Existing 5-rule canSnipe has daily loss limit. Differentiator: a *session* loss limit (since last manual resume) that auto-pauses entries — defends against the day-rolling edge case where 1 morning rug doesn't trip daily limit but 5 in a row should. | MEDIUM | Builds on existing canSnipe (RISK-01..05). Adds a session-counter that resets on manual resume. | Tunable. Default: pause after 3 consecutive losses or session loss > 50% of daily limit. |
| **`npm run preflight` script that runs ALL startup checks without starting the bot** | Operator runs this before `npx ts-node src/bot.ts` to confirm everything is green. Faster feedback than starting and reading logs. | LOW | Reuses startup-check code paths. | Should print one-line per check: `[PASS] eth_chainId | [PASS] wallet balance: 0.0124 ETH | [WARN] sell-sim safety bank not yet enabled` etc. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Auto-restart on FATAL** | "More resilience" | FATAL-exit conditions are unrecoverable at runtime by definition (mismatched chainId, missing env, etc.). Auto-restart loops on these conditions burn CPU and obscure root cause. Production restart should be supervised externally (systemd, PM2, Docker restart policy). | Hard-exit on FATAL; document supervisor setup in runbook. |
| **Web-UI-only kill switch (no CLI / no signal)** | "Operator-friendly" | Web UI requires the bot's HTTP server to be healthy. If the bot is in an unrecoverable state, the UI may not respond. Owner already has `Ctrl+C` graceful shutdown + dashboard pause endpoint — keep both. | Both CLI (`Ctrl+C` / SIGTERM) and web pause endpoint. Operator picks based on situation. |
| **Custom alerting infrastructure (PagerDuty/Opsgenie integration)** | "Production-grade" | Personal mainnet sniper. Telegram alerts already exist and serve the operator directly. PagerDuty is overkill and adds infra dependencies. | Keep Telegram. Operator can manually wire Telegram → PagerDuty if ever needed. |
| **Heartbeat publishing to external monitoring service** | "Know if bot crashes" | Adds external dependency. The existing health endpoint (`MON-01`) is sufficient for an external uptime checker (e.g., UptimeRobot pinging `/health`). | Use existing health endpoint with external uptime monitor of operator's choice. |
| **Auto-rotating private keys** | "Security" | Bot's wallet must persist across restarts to track positions. Rotating the key invalidates open positions. Cold storage / spend-cap-per-wallet is the better security pattern. | Use a low-balance hot wallet (per GOING-LIVE.md §6: ETH_MAX_CAPITAL=0.02 for first run). Cold-storage majority funds. |

---

### 5. Tech Debt Cleanup (DEBT)

Not feature categories but worth listing for completeness — these are *quality* features that close v6.16 gaps.

#### Table Stakes

| Feature | Why Expected | Complexity | Existing v6.16 Dependency |
|---|---|---|---|
| **Retroactive Nyquist validation on 9 phases (01, 02, 03, 05, 06, 07, 08, 09, 10)** | Phases shipped without the validation gate; v6.17 closes the audit. | MEDIUM | Existing `/gsd-validate-phase` tooling. |
| **37 `.todo` exit-engine test stubs filled** | Phase 7 left 37 test stubs as `.todo`. They're test debt; closing them prevents regression in exit-engine paths. | HIGH | Existing test infrastructure (Vitest), exit engine. |
| **6 TS annotation errors in dashboard API routes** | Runtime-correct but compile-warning. Closes audit cleanly; reduces cognitive load. | LOW | Existing TypeScript config, dashboard. |
| **Diagnostic console.log cleanup (telegramListener.ts:55,61; db.ts:215)** | v6.16 close audit identified specific lines. Quick wins. | LOW | n/a — straight cleanup. |

---

## Feature Dependencies

```
[Pre-Buy Safety Stack Rebuild]
    |── requires ──> [Architecture decision: eth_simulateV1 vs deployed contract]
    |                    └── informs ──> STACK.md decision
    |
    |── replaces ──> [tokenSafety.ts:simulateSellForChain — broken]
    |── replaces ──> [tokenSafety.ts:simulateSellV3ForChain — vacuous]
    |── audits ──> [hasHighTransferTaxForChain (potential same bug class)]
    |── extends ──> [checkHoneypotForChain (parallel-bank dispatch)]
    |── enables ──> [Numerical buy/sell tax extraction]
    |── enables ──> [Tax-change detection in anti-rug monitoring]
    |
[Anti-Rug Runtime Monitoring]
    |── requires ──> [Pair.Burn event subscription per open position]
    |── builds on ──> [Unified exit engine 5s poll loop (v6.16)]
    |── consumes ──> [Pre-buy simulator (for tax-change detection)]
    |── produces ──> [Frontrun-exit panic-sell path]
    |── requires ──> [Rate limit on auto-exit triggers]
    |
[Live-Runtime Hardening]
    |── builds on ──> [Pino structured logging (v6.16 INFRA-01)]
    |── builds on ──> [Mainnet-fork test pattern (v6.16 TEST-05)]
    |── extends ──> [Receipt-decoded amount_out (v6.16 DB-04)]
    |── requires ──> [Live RPC test runner (manual; not in CI)]
    |
[Going-Live Ops Hardening]
    |── builds on ──> [Env validation (v6.16 FIX-03)]
    |── builds on ──> [Health endpoint (v6.16 MON-01)]
    |── builds on ──> [Dashboard pause endpoint (v6.16 DASH-03)]
    |── extends ──> [Graceful shutdown (v6.16 FIX-02)]
    |── enables ──> [npm run preflight workflow]
    |── enables ──> [npm run pause / resume workflows]
    |
[Tech Debt Cleanup]
    |── prerequisite for ──> [Confidence in retroactive Nyquist validation]
    |── independent of ──> [Other categories]
```

### Dependency Notes

- **Pre-buy safety is the gating phase:** It's the most-broken thing on the bot today (zero V2 sniping possible) AND it's a prerequisite for the anti-rug tax-change-detection feature. Should be the first phase of v6.17.
- **Anti-rug consumes the simulator:** Once the simulator works for pre-buy, it's reusable for slow-poll re-checks of open positions. Don't build anti-rug before pre-buy.
- **Live-runtime hardening can run in parallel** with ops hardening — they touch different code areas.
- **DEBT cleanup is a "tail" phase:** Close it last to lock in the milestone audit.

---

## MVP Definition

### Launch With (v6.17 — Defensive Hardening)

The minimum to safely run the bot live with real money on mainnet, given current state.

- [ ] **Pre-buy safety stack rebuild** — Fix V2 sell-sim, fix V3 vacuous-pass, audit all 8+ gates for `amountIn=0` family bugs, deploy or call honeypot-checker mechanism (architecture per STACK.md decision)
- [ ] **Anti-rug DETECT-02** — `Pair.Burn` event subscription per open position with frontrun-exit response, rate-limited
- [ ] **Wallet balance pre-flight at startup** — Hard-fail if undercut
- [ ] **RPC + MEV health pre-flight at startup** — Extend existing chainId check to full pre-flight
- [ ] **Stale-data warnings** — Telegram alert on positions with stale price updates
- [ ] **Receipt-decoded amount_out validation on live mainnet** — Real test, not deferred
- [ ] **Real Flashbots tx-hash on live mainnet** — Real test, not deferred
- [ ] **State persistence across restart** — Real test, not deferred
- [ ] **Tech debt cleanup (DEBT)** — Nyquist validation, .todo stubs, TS errors

### Add After Validation (v6.18+)

Once v6.17 is shipped and validated.

- [ ] **Aggregated rug-signal scoring** — Defer until we have signal frequency data from real positions
- [ ] **Synthetic canary trade** — Defer until pre-buy is proven safe
- [ ] **Tax-change detection on open positions** — Differentiator; defer if v6.17 scope is tight
- [ ] **Owner-blacklist-self detection (multi-address simulation)** — Differentiator
- [ ] **Operator dashboard live-status panel** — UX improvement, not safety

### Future Consideration

- [ ] **Mempool-based rug detection** — Out of scope per PROJECT.md (DETECT-01 deferred to offensive milestone)
- [ ] **DETECT-01 mempool sniping** — Offensive, not defensive
- [ ] **CHAIN-05 dynamic capital allocation** — Offensive, not defensive

---

## Feature Prioritization Matrix

Given v6.17's defensive-only scope and that the bot is **live on mainnet today with broken safety**, prioritization is heavily weighted toward unblocking safe operation.

| Feature | Owner-Stated Priority | Implementation Cost | Priority |
|---|---|---|---|
| Pre-buy safety stack rebuild (V2 sell-sim fix) | **CRITICAL** (bot can't snipe today) | HIGH | P0 |
| Pre-buy safety stack rebuild (V3 vacuous-pass fix) | **CRITICAL** (silent fail-open) | HIGH | P0 |
| Audit all 8+ gates for amountIn=0 family bugs | HIGH | MEDIUM | P0 |
| Wallet balance pre-flight at startup | HIGH | LOW | P1 |
| RPC + MEV health pre-flight at startup | HIGH | LOW | P1 |
| Anti-rug DETECT-02 (Pair.Burn → frontrun-exit) | HIGH | HIGH | P1 |
| Receipt-decoded amount_out live validation | HIGH | LOW | P1 |
| Real Flashbots tx-hash live validation | HIGH | MEDIUM | P1 |
| State persistence across restart validation | HIGH | MEDIUM | P1 |
| Stale-data warnings | MEDIUM | MEDIUM | P2 |
| npm run preflight script | MEDIUM | LOW | P2 |
| npm run pause / resume scripts | MEDIUM | LOW | P2 |
| Env-validation messaging upgrades | MEDIUM | LOW | P2 |
| Numerical buy/sell tax extraction | MEDIUM | MEDIUM | P2 |
| Structured simulator output (object, not bool) | MEDIUM | MEDIUM | P2 |
| Live-mainnet smoke test runner | MEDIUM | MEDIUM | P2 |
| Tax-change detection on open positions | LOW | MEDIUM | P3 |
| Owner-blacklist-self detection | LOW | MEDIUM | P3 |
| Aggregated rug-signal scoring | LOW | HIGH | P3 (defer) |
| Synthetic canary trade | LOW | HIGH | P3 (defer) |
| Tech debt: Nyquist validation 9 phases | MEDIUM | MEDIUM | P2 |
| Tech debt: 37 .todo stubs | LOW | HIGH | P3 |
| Tech debt: 6 TS errors, diagnostic logs | LOW | LOW | P3 (quick win) |

**Priority key:**
- P0: BLOCKING — bot cannot operate safely without these. Must be first phase of v6.17.
- P1: Must-have for "go-live confident" — must ship in v6.17.
- P2: Should-ship in v6.17 if scope allows.
- P3: Defer to v6.18 unless implementation is cheap.

---

## Competitor Feature Analysis

How v6.17's planned features compare to commercial sniping bots' published anti-honeypot / anti-rug stacks.

| Feature | Banana Gun | Maestro | Honeypot.is (API only) | This Bot v6.16 (current) | This Bot v6.17 (planned) |
|---|---|---|---|---|---|
| Buy/sell roundtrip simulation | Yes (own simulator) | Yes (own) | Yes (their core service) | NO (broken) | YES (replaces broken sim) |
| Per-token tax extraction | Yes (numerical) | Yes (numerical) | Yes (in API response) | Partial (boolean threshold) | YES (numerical) |
| Whitelist-only-buys / anti-snipe detection | Yes | Yes | Yes | Implicit in buy-sim only | YES (multi-address sim) |
| Transfer-pause detection | Yes | Yes | Yes | Soft check (can default true) | YES (audited + sim-backed) |
| Max-tx / max-wallet detection | Yes | Yes | Yes | Yes (existing) | Yes (audit pass) |
| LP burn event monitoring | Yes (anti-rug) | Yes (smart-rug auto-sell) | n/a | NO | YES (DETECT-02) |
| Tax-change runtime monitoring | Yes (anti-rug) | Yes (anti-rug) | n/a | NO | Differentiator (defer to v6.18 likely) |
| Frontrun-exit panic sell | Yes | Yes | n/a | NO | YES (DETECT-02) |
| Owner-blacklist-self detection | Yes (Blacklist Transfer) | Implied | n/a | NO | Differentiator (defer to v6.18 likely) |
| Wallet balance pre-flight | Implied (commercial) | Implied | n/a | NO | YES (OPS-LIVE) |
| Defense-in-depth: simulator + 2 third-party | UNCLEAR (likely yes) | UNCLEAR | n/a (single) | Partial (2 APIs, no own sim) | YES (3 sources) |
| Fee model | 1% per trade | 1% per trade | n/a (free API) | Self-hosted | Self-hosted |

**Competitive insight:** The commercial bots ship effectively the same defensive stack v6.17 plans. The owner's bot, post-v6.17, will be on par with them on defense — and self-hosted (no per-trade fee). The remaining gap with commercial bots is offensive (mempool sniping, dynamic capital allocation), which is explicitly deferred to a future milestone per PROJECT.md.

---

## Confidence Assessment

| Area | Confidence | Reasoning |
|---|---|---|
| Honeypot detection table-stakes | HIGH | Multiple converging sources (honeypot.is methodology, GoPlus methodology, deployed open-source contracts on GitHub, AB PlasTech 2026 explainer, MEXC 2026 ranking). Industry consensus is clear. |
| Anti-rug table-stakes | HIGH | Maestro and BananaGun both publish their anti-rug feature lists; arxiv 2206.08202 academic paper validates the technical detection patterns; Uniswap V2 docs confirm event surface. |
| Anti-rug differentiators | MEDIUM | Some features (multi-address sim, rug-score) are extrapolations from commercial bot patterns; not directly cited in industry literature. |
| Live-runtime hardening | HIGH | Standard production-engineering practice; not bot-specific. Smoke-test, real-fixture, observability patterns are well-published (CircleCI, Microsoft engineering playbook). |
| Going-live ops | HIGH | Standard trading-system practice (RuleMatch kill-switch reference, Flashbots health-check existing pattern, owner's already-documented GOING-LIVE.md gaps). |
| Anti-feature classification | MEDIUM | Anti-features are reasoned from owner's stated non-negotiables and from common architectural failure modes; not all are cited in literature. |

---

## Sources

### Honeypot Detection Methodology
- [honeypot.is – Honeypot Detector for ETH](https://honeypot.is/ethereum) — published methodology: "simulates a buy and a sell transaction"
- [GoPlus Security – Unveiling Honeypot Scams](https://goplussecurity.medium.com/dive-into-token-code-and-safeguard-web3-security-b7960a34a8fe) — detection methodology, transfer-blacklist mechanism
- [valamidev/web3-defi-honeypot-and-slippage-checker (GitHub)](https://github.com/valamidev/web3-defi-honeypot-and-slippage-checker) — open-source on-chain checker contract template, deployed across 11 chains, returns buy/sell tax
- [RugDoc Honeypot Token Checker Tool](https://rugdoc.io/honeypot/) — third-party reference detector
- [ApeSpace Honeypot Checker for BSC/ETH](https://apespace.io/honeypot) — third-party reference detector
- [AB PlasTech – Honeypot Detection, Explained](https://abplastech.com/honeypot-detection-explained-what-token-checkers-simulate-and-why-it-matters/) — 2026 explainer on simulation methodology
- [CoinGecko – How to Build a Honeypot Checker](https://www.coingecko.com/learn/build-honeypot-checker) — implementation guide
- [Demystifying Honeypots in Ethereum Smart Contracts (USENIX Security 2019)](https://www.usenix.org/system/files/sec19-torres.pdf) — academic taxonomy of honeypot mechanisms
- [Cube Exchange – What is a Honeypot Token?](https://www.cube.exchange/what-is/honeypot-token) — high-level explainer
- [Honeypot.is Premium API docs](https://docs.honeypot.is/premium) — referenced (premium tier not yet available)

### Simulation Architecture (Option C / D in briefing)
- [Alchemy – eth_simulateV1 docs](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-simulate-v-1) — state-override capabilities
- [QuickNode – eth_simulateV1 docs](https://www.quicknode.com/docs/ethereum/eth_simulateV1) — RPC method reference
- [MetaMask – eth_simulateV1 reference](https://docs.metamask.io/services/reference/ethereum/json-rpc-methods/eth_simulatev1/) — official spec
- [ethers-override (npm)](https://www.npmjs.com/package/ethers-override) — TypeScript helper for state overrides

### Anti-Rug Monitoring
- [Maestro – Anti-Rug / Smart Rug Auto-Sell docs](https://docs.maestrobots.com/faq/smart-rug-auto-sell) — published feature list, mechanism, limitations
- [Banana Gun docs](https://docs.bananagun.io/) — anti-rug coverage matrix
- [Banana Gun guide on Medium](https://medium.com/@0xkryptokeisarii/banana-gun-bot-sniper-how-to-easily-snipe-token-launches-on-eth-base-or-blast-14c9a01a774b) — operational details
- [Uniswap V2 Pair – Burn function docs](https://docs.uniswap.org/protocol/V2/reference/smart-contracts/pair) — Burn event signature
- [Uniswap V2 Subgraph – Burn entity](https://docs.uniswap.org/api/subgraph/subgraphs-devs/schemas/burn) — event field reference
- [Uniswap V2 Mint and Burn Functions Explained (RareSkills)](https://rareskills.io/post/uniswap-v2-mint-and-burn) — implementation walkthrough
- [arxiv 2206.08202 – Token Spammers, Rug Pulls, and Sniper Bots](https://arxiv.org/html/2206.08202v3) — academic analysis, defines "rug" as ≥99% LP burn pattern
- [USENIX Security 2023 – Cernera et al](https://www.usenix.org/system/files/sec23fall-prepub-460-cernera.pdf) — same paper, conference proceedings
- [Cyberfoxx – Smart Contract Hacking A to Z (2025)](https://cyberfoxx.medium.com/smart-contract-hacking-a-to-z-a-real-world-guide-2025-1c58d6b04595) — owner-blacklist-self pattern
- [OpenZeppelin – Renounce Ownership / Proxy Admin discussion](https://forum.openzeppelin.com/t/how-do-i-renounce-ownership-for-the-proxy-admin/4692) — fake-renounce pattern context

### Live-Runtime Hardening / Smoke Testing
- [CircleCI – Smoke testing in CI/CD pipelines](https://circleci.com/blog/smoke-tests-in-cicd-pipelines/) — production smoke-test patterns
- [Microsoft engineering playbook – Smoke Testing](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/smoke-testing/) — standard definitions
- [BrowserStack – Smoke Testing Tool guide](https://www.browserstack.com/guide/smoke-testing-tool) — implementation strategies
- [NodeSource – Real-Time Observability for Node.js](https://nodesource.com/blog/real-time-observability-for-Node.js-without-code-changes) — production observability patterns

### Going-Live Ops
- [RuleMatch – Kill switch documentation](https://www.rulematch.com/trading/kill-switch/) — kill-switch standards in trading
- [Cherry Servers – Ethereum RPC Node Requirements](https://www.cherryservers.com/blog/ethereum-rpc-node-requirements) — RPC pre-flight check standards
- [Flashbots Protect overview](https://docs.flashbots.net/flashbots-protect/overview) — referenced in v6.16; relevant for MEV health checks
- [Sushi x GoPlus Security blog](https://www.sushi.com/blog/sushi-x-goplus-security) — defense-in-depth posture rationale

### Industry Landscape (2026)
- [MEXC News – Best Crypto Sniper Bots in 2026 (ranked)](https://www.mexc.com/en-GB/news/1012768) — six measured variables for sniper bots: speed, snipe success, MEV protection, honeypot detection, fees, redistribution
- [TechBullion – Best Crypto Sniper Bots in 2026](https://techbullion.com/best-crypto-sniper-bots-in-2026-ranked-by-speed-safety-and-what-you-actually-keep/) — same ranking, alternate publication
- [Telegram Trading – Are Crypto Sniper Bots Safe and Legit (2026)](https://telegramtrading.net/are-sniper-bots-safe-and-legit/) — operational risk landscape

### Existing Project Context (Read into research)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\.planning\PROJECT.md` — v6.17 milestone scope and constraints
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\HONEYPOT-SIM-BRIEFING.md` — bug write-up, owner non-negotiables, four candidate fix architectures
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\GOING-LIVE.md` — operational checklist with current gaps
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\.planning\milestones\v6.16-research\FEATURES.md` — v6.16 feature landscape (NOT re-researched)
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\utils\tokenSafety.ts` — existing safety bank
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\utils\safetyProviders\honeypotIs.ts` — existing honeypot.is integration
- `C:\Users\jackc\WebstormProjects\crypto-snipe-bot\src\utils\safetyProviders\goplus.ts` — existing GoPlus integration

---
*Feature research for: v6.17 Defensive Hardening for Live Mainnet*
*Researched: 2026-04-29*
