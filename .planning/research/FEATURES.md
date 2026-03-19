# Feature Research

**Domain:** Multi-chain MEV sniper bot (DEX token sniping with risk management)
**Researched:** 2026-03-19
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any production sniper bot must have. Missing these means the bot loses money or is unusable in competitive markets. Based on analysis of Banana Gun, Maestro, Unibot, and open-source sniper implementations.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Block-0 / First-block sniping** | Getting in at the exact block liquidity is added is the entire value proposition. Competitors execute within milliseconds. Late entry = buying at inflated price = loss. | MEDIUM | Already partially implemented via PairCreated listener, but lacks mempool monitoring for pending liquidity txs. Current approach uses block-mode (listening for mined events), not the more competitive pending-tx mode. |
| **Honeypot detection** | 70-85% of new token launches are scams. Without honeypot detection, bot will buy unsellable tokens. This is capital preservation, not optional. | MEDIUM | Exists (checkHoneypot in tokenSafety.ts). Uses honeypot.is API with callStatic fallback. Bug: fallback passes private key as address parameter (line 51). |
| **Anti-rug-pull protection** | Rug pulls (liquidity removal) destroy positions instantly. Production bots like Banana Gun detect and frontrun contract changes that make tokens unsellable. | HIGH | Partially exists via liquidity lock check (Unicrypt API + burn fallback). Missing: real-time monitoring for liquidity removal events after purchase, owner function call detection. |
| **MEV protection (private transactions)** | Without private mempool submission, the bot's buy transactions are visible in the public mempool and will be sandwiched by MEV bots, eating 5-20% of value. | MEDIUM | Exists via Flashbots on Ethereum. Bugs: hardcoded to mainnet, broken nonce on retry. Missing: BSC (bloXroute/48Club), Base/Arbitrum (sequencer-based, private RPCs). |
| **Stop-loss** | Micro-cap tokens can drop 90%+ in minutes. Without automatic stop-loss, a single bad position wipes out multiple winning trades. | LOW | Exists (monitorStopLoss). Bug: race condition with take-profit, interval never cleared on shutdown, continues polling after balance reaches 0. |
| **Take-profit** | New tokens can spike 10-100x then crash to zero within minutes. Without automatic take-profit, unrealized gains evaporate. | LOW | Exists (monitorTakeProfit). Same bugs as stop-loss. Sells 100% of position -- no partial sell capability. |
| **Slippage control** | High slippage tolerance = paying more than intended. Low slippage = missed trades. Must be configurable per trade. | LOW | Exists. CONFIG.slippagePercent = 5%. Hardcoded, not adjustable per token or market conditions. |
| **Token metadata validation** | Tokens with suspicious metadata (no name, weird decimals, trading disabled) are almost always scams. | LOW | Exists (checkTokenMetadata). Checks symbol length, name, decimals range, tradingEnabled flag. |
| **Sell simulation before buy** | If the bot cannot verify it can sell a token before buying, it risks buying a honeypot that passed the API check. Simulating the sell path is a second line of defense. | LOW | Exists but DISABLED (bot.ts line 236-243, marked "TEMPORARY"). Critical safety mechanism currently skipped. |
| **Deduplication / already-sniped tracking** | Without dedup, bot buys the same token multiple times on re-detection or Telegram re-posts. | LOW | Exists (storage.ts). JSON file-based, has concurrency bugs. |
| **Notification system** | Operator must know what the bot is doing: buys, sells, errors, opportunities skipped. Without alerts, you discover losses hours later. | LOW | Exists via Telegram bot API. Sends alerts for all major events. |
| **Configurable buy amount** | Fixed position size is dangerous. Operator needs to control capital-at-risk per snipe. | LOW | Exists. CONFIG.snipeAmountETH = "0.01". Global, not per-token or per-chain. |
| **Blocklist / token filtering** | Known bad tokens, pairs, and creators must be filtered without re-analyzing each time. | LOW | Exists (blocklist.ts). Static set of known bad addresses. |
| **Graceful shutdown** | Abrupt kills orphan monitoring intervals, corrupt state, and lose track of open positions. Bot must handle SIGTERM/SIGINT cleanly. | LOW | MISSING. No signal handlers. Intervals and timeouts are never cleaned up on process exit. |
| **Environment validation on startup** | Missing env vars cause cryptic runtime crashes mid-trade. All required credentials and RPC endpoints must be validated before the bot starts listening. | LOW | MISSING. Uses `!` non-null assertions. No pre-flight validation. |

### Differentiators (Competitive Advantage)

Features that separate a capable sniper bot from the crowd. These are where the planned milestone features add real value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Multi-chain simultaneous operation** | Most self-hosted bots run single-chain. Running ETH + BSC + Base + Arbitrum concurrently multiplies opportunity surface by 4x. Commercial bots (Maestro, Banana Gun) support this, but DIY bots rarely do. | HIGH | Not yet built. Requires chain abstraction layer, per-chain config, concurrent event listeners, per-chain MEV protection strategies. This is the largest planned feature. |
| **Uniswap V3 pool detection** | V3 concentrated liquidity pools are increasingly where new tokens launch. V2-only bots miss a growing share of opportunities. V3 adds complexity (fee tiers, tick ranges) but captures more volume. | HIGH | Not yet built. V3 PoolCreated event has different parameters. Price monitoring needs V3 oracle/sqrtPriceX96 instead of getAmountsOut. |
| **Trailing stop-loss** | Static stop-loss (current: -25% from buy) leaves profits on the table. Trailing stop ratchets up as price rises, locking in gains. Industry standard in 3Commas, Cornix, and production trading bots. | MEDIUM | Not yet built. Requires tracking price high-water mark per position. Moderate change to existing monitoring loop structure. |
| **Partial take-profit (scaled exits)** | Selling 100% at one price point is suboptimal. Selling 50% at 2x, 25% at 5x, trailing the rest captures both the safe profit and the moonshot upside. Banana Gun and Maestro support this. | MEDIUM | Not yet built. Requires splitting position into tranches, tracking partial balances, multiple sell targets per position. |
| **Daily loss limit / circuit breaker** | Prevents cascade failures. If the bot hits -5% of portfolio in 24h, it pauses sniping until the next day. Production risk management standard. Without this, a bad day of rug pulls can drain the wallet. | MEDIUM | Not yet built. Requires tracking realized P&L per day, portfolio valuation, and a global pause mechanism. |
| **Max position sizing** | Caps ETH/BNB per trade based on opportunity quality and portfolio exposure. Prevents the bot from going all-in on a single token. | LOW | Partially exists as CONFIG.snipeAmountETH but it's static. Not dynamically adjusted based on liquidity depth, safety score, or portfolio state. |
| **Max open positions limit** | Prevents over-diversification into too many micro-cap tokens simultaneously. Each open position consumes monitoring resources and capital. | LOW | Not yet built. Simple counter-based gate before execution. |
| **Cooldown between snipes** | Prevents overtrading during launch waves where 10+ tokens launch in the same minute. Ensures each snipe gets proper attention. | LOW | Partially exists for Telegram alpha (5s cooldown). Not implemented for blockchain event listener. |
| **Dynamic capital allocation across chains** | Allocate more capital to chains with better opportunity quality. BSC may have more launches but lower quality. ETH has fewer but higher liquidity. Smart allocation outperforms equal distribution. | HIGH | Not yet built. Requires cross-chain portfolio view, opportunity scoring, and real-time rebalancing logic. Complex and novel. |
| **Web dashboard** | Real-time visibility into positions, P&L, chain status, and bot controls. Beyond what Telegram alerts provide. Enables operators to manage the bot without SSH access. | HIGH | Not yet built. Full-stack addition: API server, WebSocket for real-time updates, React/Vue frontend. Significant scope. |
| **SQLite storage with audit trail** | Full transaction history enables P&L analysis, strategy optimization, and debugging. Current JSON file storage has concurrency bugs and no query capability. | MEDIUM | Not yet built. Replace .bot-state.json with SQLite. Adds atomic writes, proper transactions, and historical queries. |
| **Time-weighted exit urgency** | The longer a position is open, the more likely it is a slow rug or dead project. Escalate exit pressure over time: tighten stop-loss, reduce take-profit targets. | MEDIUM | Not yet built. Novel feature -- few competitors implement this explicitly. Adds time dimension to existing monitoring loops. |
| **Volatility-adjusted stop-loss/take-profit** | Static percentage thresholds (25% stop, 50% TP) are wrong for different tokens. A high-volatility token needs wider stops. A low-volatility token should take profit sooner. | MEDIUM | Not yet built. Requires real-time volatility measurement (price variance over N blocks) and dynamic threshold adjustment. |
| **Structured logging with levels** | Replace console.log/emoji with proper structured logging (JSON format, severity levels, correlation IDs). Essential for debugging production issues and feeding into monitoring tools. | LOW | Not yet built. Current logging is console.log with emoji prefixes. Logger utility exists but only adds timestamps. |
| **Health check HTTP endpoint** | External monitoring systems (uptime robots, Grafana) need an HTTP endpoint to verify bot liveness, chain connectivity, and position count. | LOW | Not yet built. Simple Express/Fastify endpoint exposing bot state. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem appealing but create problems for this specific use case. Explicitly documented to prevent scope creep.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Copy trading / wallet tracking** | "Follow smart money" -- copy buys from known profitable wallets | Adds massive latency (you're always behind the leader), requires mempool monitoring of specific wallets, and smart money profits come from being first not from following. In sniping specifically, copying someone else's block-0 buy means you're buying at block-1+ at a worse price. | Focus on better token safety scoring and faster execution instead. The bot's edge comes from speed and risk management, not from following others. |
| **Arbitrage between DEXes** | "Buy low on one DEX, sell high on another" | Completely different product with different architecture (cross-DEX routing, flash loans, gas optimization for multi-hop). Arbitrage bots compete with professional MEV searchers running on co-located infrastructure. Not viable as a bolt-on feature. | Keep scope to new token sniping. If arbitrage is wanted, build it as a separate bot. |
| **Limit orders / manual trading** | "Let me manually set a price to buy at" | The bot is fully automated. Adding manual trading UI and order management is a separate product. Manual trading competes with DEX aggregators (1inch, Paraswap) that already do this well. | Use Banana Gun or Maestro for manual trading. This bot's value is full automation. |
| **AI/ML token scoring** | "Use AI to predict which tokens will moon" | Training data for micro-cap token prediction is extremely noisy (70-85% of tokens are scams). ML models require historical data collection, feature engineering, model training, and ongoing retraining -- each a project in itself. False positives are expensive (buy scams), false negatives miss opportunities. | Use rule-based heuristics: liquidity depth, holder count growth rate, contract age, social signals. These are interpretable, debuggable, and don't require ML infrastructure. |
| **Mobile app** | "Monitor the bot from my phone" | Native mobile development (iOS + Android) doubles frontend scope. Push notifications are complex. The web dashboard is mobile-responsive by default. | Build web dashboard as mobile-responsive PWA. Telegram notifications already provide mobile alerting. |
| **Centralized exchange (CEX) support** | "Snipe new listings on Binance/Coinbase" | CEX APIs have rate limits, listing announcements are unpredictable, and CEX trading is a regulated activity in many jurisdictions. The bot's architecture assumes DEX (on-chain events, smart contract interaction). | Stay DEX-only. CEX sniping is a fundamentally different product. |
| **Multi-wallet support** | "Run different strategies on different wallets" | Adds complexity to key management, nonce tracking, balance monitoring, and position attribution. Each wallet needs its own MEV protection auth. | Use separate bot instances for different strategies. Simpler, safer, and easier to debug. |
| **Real-time everything via WebSocket** | "Stream all price updates via WebSocket to the dashboard" | WebSocket connections to RPC providers have rate limits and reconnection complexity. Streaming every price update for every monitored token generates excessive data. | Poll at reasonable intervals (5-15s). Use WebSocket only for the dashboard's connection to the API server, not for all RPC calls. |
| **Presale / fair-launch sniping** | "Buy tokens during presale before they list" | Presale contracts vary wildly in implementation. Each launchpad (PinkSale, DxSale, Unicrypt) has different contract ABIs, contribution mechanics, and timing. Supporting all of them is a maintenance nightmare. | Focus on liquidity-add sniping (PairCreated events). This is the standardized, cross-chain approach. |

## Feature Dependencies

```
[Multi-Chain Abstraction Layer]
    |-- requires --> [Per-Chain Config (RPCs, contracts, gas)]
    |-- requires --> [Per-Chain MEV Protection]
    |                    |-- ETH: Flashbots (exists, needs bug fixes)
    |                    |-- BSC: bloXroute / 48Club private tx
    |                    |-- Base: Private RPC (no public mempool)
    |                    |-- Arbitrum: Timeboost / private RPC
    |-- enables --> [Concurrent Chain Listeners]
    |-- enables --> [Dynamic Capital Allocation]
    |-- enables --> [Cross-Chain Portfolio View]

[SQLite Storage]
    |-- enables --> [Transaction Audit Trail]
    |-- enables --> [Daily P&L Tracking]
    |-- enables --> [Historical Trade Log (Dashboard)]
    |-- enables --> [Daily Loss Limit (needs realized P&L)]
    |-- fixes  --> [Storage Race Conditions (atomic writes)]

[Trailing Stop-Loss]
    |-- requires --> [Price High-Water Mark Tracking]
    |-- enhances --> [Stop-Loss (existing)]

[Partial Take-Profit]
    |-- requires --> [Position Tranche Tracking]
    |-- enhances --> [Take-Profit (existing)]

[Volatility-Adjusted Exits]
    |-- requires --> [Price History Buffer (per token)]
    |-- enhances --> [Trailing Stop-Loss]
    |-- enhances --> [Partial Take-Profit]

[Time-Weighted Exit Urgency]
    |-- requires --> [Position Age Tracking (SQLite)]
    |-- enhances --> [Stop-Loss]
    |-- enhances --> [Take-Profit]

[Daily Loss Limit]
    |-- requires --> [SQLite Storage (P&L queries)]
    |-- requires --> [Portfolio Valuation]
    |-- enables --> [Circuit Breaker (pause sniping)]

[Uniswap V3 Support]
    |-- requires --> [V3 Factory Event Listener (PoolCreated)]
    |-- requires --> [V3 Price Monitoring (sqrtPriceX96 / oracle)]
    |-- requires --> [V3 Swap Router Integration]
    |-- independent of --> [Multi-Chain] (can be built on ETH first)

[Web Dashboard]
    |-- requires --> [API Server (HTTP + WebSocket)]
    |-- requires --> [SQLite Storage (query historical data)]
    |-- enhances --> [All monitoring/position features]

[Graceful Shutdown]
    |-- requires --> [Interval/Timeout Registry]
    |-- prerequisite for --> [Multi-Chain] (must clean up per-chain listeners)

[ethers v6 Migration]
    |-- prerequisite for --> [Multi-Chain] (don't build abstractions on EOL library)
    |-- prerequisite for --> [V3 Support] (V3 SDK expects v6)
```

### Dependency Notes

- **Multi-chain requires ethers v6 first:** Building chain abstractions on ethers v5 (EOL) means an immediate rewrite. Migrate first, then abstract.
- **SQLite is a prerequisite for risk management:** Daily loss limits, P&L tracking, and audit trails all need queryable storage. JSON file storage cannot support these features.
- **Graceful shutdown must come before multi-chain:** Multi-chain adds N sets of event listeners and monitoring loops. Without a shutdown registry, the cleanup problem multiplies.
- **V3 support is independent of multi-chain:** Can be developed and tested on Ethereum first, then extended to other chains via the abstraction layer.
- **Web dashboard depends on SQLite:** The dashboard needs historical trade data, P&L calculations, and position history. Without SQLite, there's nothing meaningful to display.
- **Smart exit strategies build on each other:** Trailing stop is foundational. Partial take-profit extends it. Volatility-adjusted and time-weighted exits layer on top.

## MVP Definition

Context: The bot already works on Ethereum Sepolia with V2 detection, safety pipeline, Flashbots, and basic stop-loss/take-profit. The milestone is about hardening, multi-chain, V3, smart exits, and dashboard.

### Launch With (v1 -- Hardened Single-Chain)

The first priority is fixing bugs and hardening the existing bot so it doesn't lose money to preventable issues.

- [ ] Fix race condition: stop-loss and take-profit firing simultaneously -- **prevents double-sell and wasted gas**
- [ ] Fix Flashbots relay hardcoded to mainnet -- **bundles currently fail on testnet**
- [ ] Fix nonce never incrementing on Flashbots retry -- **all retries currently fail**
- [ ] Re-enable sell simulation safety check -- **critical honeypot protection currently disabled**
- [ ] Add graceful shutdown with signal handlers -- **prevents state corruption**
- [ ] Add startup environment validation -- **prevents cryptic runtime crashes**
- [ ] Migrate ethers v5 to v6 -- **foundation for all subsequent features**
- [ ] Replace JSON storage with SQLite -- **fixes concurrency bugs, enables P&L tracking**
- [ ] Add structured logging -- **required for production debugging**

### Add After Validation (v1.x -- Multi-Chain + Smart Exits)

Once the bot is reliable on Ethereum, extend reach and sophistication.

- [ ] Multi-chain abstraction layer (ETH, BSC, Base, Arbitrum) -- **trigger: v1 is profitable on ETH**
- [ ] Per-chain MEV protection -- **trigger: multi-chain layer is working**
- [ ] Trailing stop-loss -- **trigger: SQLite storage working, basic exits reliable**
- [ ] Partial take-profit at configurable targets -- **trigger: trailing stop works**
- [ ] Daily loss limit / circuit breaker -- **trigger: SQLite P&L tracking working**
- [ ] Max open positions limit -- **trigger: multi-chain operational**
- [ ] Uniswap V3 pool detection and trading -- **trigger: multi-chain abstraction exists to plug V3 into**
- [ ] Health check HTTP endpoint -- **trigger: multi-chain adds monitoring complexity**

### Future Consideration (v2+)

Features to defer until the bot is reliably profitable across chains.

- [ ] Web dashboard -- **defer: significant scope, Telegram notifications sufficient initially**
- [ ] Dynamic capital allocation across chains -- **defer: needs operational data to calibrate algorithms**
- [ ] Volatility-adjusted stop/take-profit -- **defer: needs price history collection running for weeks**
- [ ] Time-weighted exit urgency -- **defer: novel feature, needs backtesting against real trade data**
- [ ] Anti-rug real-time monitoring (detect liquidity removal after buy) -- **defer: complex event monitoring, diminishing returns if safety pipeline is strong**

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fix race conditions (stop-loss/take-profit) | HIGH | LOW | P1 |
| Fix Flashbots bugs (network, nonce) | HIGH | LOW | P1 |
| Re-enable sell simulation | HIGH | LOW | P1 |
| Graceful shutdown | HIGH | LOW | P1 |
| Startup env validation | MEDIUM | LOW | P1 |
| ethers v5 to v6 migration | HIGH | MEDIUM | P1 |
| SQLite storage | HIGH | MEDIUM | P1 |
| Structured logging | MEDIUM | LOW | P1 |
| Multi-chain abstraction | HIGH | HIGH | P2 |
| Per-chain MEV protection | HIGH | MEDIUM | P2 |
| Trailing stop-loss | HIGH | MEDIUM | P2 |
| Partial take-profit | HIGH | MEDIUM | P2 |
| Daily loss limit | HIGH | MEDIUM | P2 |
| Max open positions | MEDIUM | LOW | P2 |
| Uniswap V3 support | HIGH | HIGH | P2 |
| Health check endpoint | MEDIUM | LOW | P2 |
| Web dashboard | MEDIUM | HIGH | P3 |
| Dynamic capital allocation | MEDIUM | HIGH | P3 |
| Volatility-adjusted exits | MEDIUM | MEDIUM | P3 |
| Time-weighted exit urgency | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have -- bot loses money or is unreliable without these
- P2: Should have -- competitive features that multiply the bot's edge
- P3: Nice to have -- valuable but can operate profitably without them

## Competitor Feature Analysis

| Feature | Banana Gun | Maestro | Unibot | This Bot (Current) | This Bot (Planned) |
|---------|------------|---------|--------|--------------------|--------------------|
| Multi-chain | ETH, BSC, SOL | ETH, BSC, ARB | ETH, Base | ETH only | ETH, BSC, Base, ARB |
| V2 sniping | Yes | Yes | Yes | Yes | Yes |
| V3 sniping | Yes | Yes | Yes | No | Planned |
| Honeypot detection | Yes (simulation) | Yes | Yes | Yes (API + fallback) | Improve fallback |
| Anti-rug (frontrun exits) | Yes (frontrun contract changes) | Yes | Partial | No (LP lock check only) | Consider for v2+ |
| MEV protection | Yes (private tx) | Yes | Yes | Yes (Flashbots, buggy) | Fix + multi-chain |
| Stop-loss | Yes | Yes | Yes | Yes (buggy) | Fix + trailing |
| Take-profit | Yes | Yes | Yes | Yes (all-or-nothing) | Add partial sells |
| Trailing stop | Yes | Yes | No | No | Planned |
| Limit orders | Yes | Yes | Yes | No | Anti-feature (out of scope) |
| Copy trading | Yes (Solana only) | No | Yes (mirror sniping) | No | Anti-feature |
| Wallet tracking | Yes | No | No | No | Anti-feature |
| Telegram UI | Yes | Yes | Yes | Partial (alerts only) | Keep alerts, add web dashboard |
| Web dashboard | No | No | No | No | Planned (P3) |
| Daily loss limit | Unclear | Unclear | No | No | Planned |
| Partial take-profit | Yes | Yes | No | No | Planned |
| Fee model | 0.5% per trade | 1% per trade | 0.6-1% per trade | Self-hosted (no fee) | Self-hosted |

**Key competitive insight:** Self-hosted is the differentiator. Commercial bots (Banana Gun, Maestro) charge 0.5-1% per trade. On high-frequency sniping, those fees compound significantly. A self-hosted bot with comparable features has a built-in cost advantage. The tradeoff is operational complexity, which the web dashboard and structured logging help mitigate.

## Sources

- [CryptoNews - Best Crypto Sniper Bots March 2026](https://cryptonews.com/cryptocurrency/best-crypto-sniper-bots/)
- [Dysnix - Building Production-Grade Solana Sniper Bots 2026](https://dysnix.com/blog/complete-stack-competitive-solana-sniper-bots)
- [CoinGecko - Top 5 Telegram Trading Bots 2025](https://www.coingecko.com/learn/top-telegram-trading-bots)
- [DEV Community - BullX vs Banana Gun vs Maestro](https://dev.to/airesearchnow/best-telegram-crypto-trading-bots-2025-bullx-vs-banana-gun-vs-maestro-1h95)
- [3Commas - Advanced Stop-Loss Logic 2025](https://3commas.io/blog/optimizing-your-trades-advanced-stop-loss-and-take)
- [Mizar - Smart Way to Use Sniper Bots](https://mizar.com/blog/the-smart-way-to-use-sniper-bots-safeguard-crypto-profits-with-take-profit)
- [Cornix - Stop-Loss & Trailing Stop-Loss Guide](https://cornix.io/stop-loss-trailing-stop-loss-the-ultimate-guide-for-automated-crypto-trading/)
- [Flashbots - MEV Protection Overview](https://docs.flashbots.net/flashbots-protect/overview)
- [bloXroute - BSC Private Transactions](https://docs.bloxroute.com/bsc-and-eth/apis/frontrunning-protection/bsc-private-transactions)
- [BNB Chain - MEV FAQs](https://www.bnbchain.org/en/blog/bnb-chain-mev-faqs)
- [Arbitrum - Timeboost Introduction](https://docs.arbitrum.io/how-arbitrum-works/timeboost/gentle-introduction)
- [Banana Gun](https://bananagun.io/)
- [Maestro Docs - Auto Snipe](https://docs.maestrobots.com/auto-snipe)
- [FourChain - Crypto Trading Bot Risk Management](https://www.fourchain.com/trading-bot/crypto-trading-bot-risk-management-strategies)
- [Uniswap - Concentrated Liquidity Docs](https://docs.uniswap.org/concepts/protocol/concentrated-liquidity)

---
*Feature research for: Multi-chain MEV sniper bot*
*Researched: 2026-03-19*
