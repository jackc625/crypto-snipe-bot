# Crypto Snipe Bot

A multi-chain token sniping engine for EVM-compatible blockchains. Detects new token launches in real time, validates them through a multi-layered safety pipeline, executes MEV-protected trades across four chains, and manages open positions with automated exit strategies — all backed by persistent state and structured risk controls.

Built in TypeScript on ethers.js v6. Supports Ethereum, BSC, Base, and Arbitrum with chain-specific DEX routing, MEV protection, and safety provider selection.

---

## Key Features

### Token Discovery
- Real-time monitoring of `PairCreated` (V2) and `PoolCreated` (V3) factory events across all enabled chains
- WebSocket-first with automatic reconnection (exponential backoff, 1s–60s cap)
- HTTP polling fallback when WebSocket endpoints are unavailable
- Telegram signal listener for manual alpha drops — parses contract addresses from whitelisted senders/channels and routes them into the same execution pipeline

### 9-Stage Token Safety Pipeline
Every token passes through a strict validation sequence before any capital is deployed:

1. **Honeypot detection** — API-based via honeypot.is (ETH, Base) or GoPlus (BSC, Arbitrum)
2. **Blacklist check** — bytecode scan for anti-bot function selectors + known bad token/pair registry
3. **Liquidity lock verification** — Unicrypt (ETH), Mudra (BSC), or GoPlus (Base, Arbitrum) with on-chain burn address fallback
4. **Liquidity sufficiency** — minimum reserve threshold (configurable per chain, default 1 native unit)
5. **Token metadata validation** — name, symbol length, decimal range (6–18), `tradingEnabled()` check
6. **Swap simulation** — static call dry-run of the buy path before committing
7. **Sell simulation** — hard gate; if the token cannot be sold in simulation, the snipe is rejected outright
8. **Transfer tax detection** — compares theoretical vs. simulated output; blocks tokens with >25% hidden tax
9. **Max wallet / max tx limit detection** — detects anti-bot limits below 1% of total supply

Safety checks 1–8 execute in parallel after the sell simulation gate, minimizing latency.

### 5-Rule Risk Management Gate
Applied before safety checks to fast-fail before expensive API calls:

| Rule | Control | Default |
|------|---------|---------|
| RISK-01 | Per-trade position size cap | Disabled (configurable) |
| RISK-02 | Rolling 24h realized loss circuit breaker | 10% of chain max capital |
| RISK-03 | Global open position limit | 10 positions |
| RISK-04 | Per-chain snipe cooldown | 30 seconds |
| RISK-05 | Portfolio-level total exposure cap | 10 native units |

Risk state is DB-backed (positions, exposure, realized losses) with in-memory cooldowns that reset on restart by design.

### Multi-Chain Trading
- **Ethereum** — Uniswap V2, SushiSwap, Uniswap V3
- **BSC** — PancakeSwap V2, Biswap, PancakeSwap V3, Uniswap V3
- **Base** — Uniswap V2, Aerodrome, Uniswap V3
- **Arbitrum** — Uniswap V2, Camelot, Uniswap V3

Each chain has independent configuration for snipe amount, max capital, gas pricing, MEV strategy, and safety API routing. A single wallet signs across all chains.

### MEV Protection
- **Flashbots Protect** (Ethereum) — bundle submission to Flashbots relay, private mempool
- **bloXroute** (BSC) — private transaction relay via `bsc_private_tx`
- **Passthrough** (Base, Arbitrum) — direct submission; these chains have sequencer-level privacy or FCFS ordering

MEV services are health-checked at startup and every 5 minutes during runtime. Snipes are rejected (not downgraded) if the chain's MEV service is unhealthy.

### Automated Exit Strategies
Three independent exit mechanisms run concurrently per position:

- **Stop-loss** — 15-second polling, triggers sell when price drops below threshold (default: 25% loss)
- **Take-profit** — 15-second polling, triggers sell when price exceeds target (default: 50% gain)
- **Timed exit** — auto-liquidates after a configurable delay (default: 5 minutes)

A per-token sell mutex ensures only one exit mechanism can execute — the first to fire wins, and all other timers for that token are immediately cleared.

### Uniswap V3 Support
- Concentrated liquidity pool detection across all fee tiers (100, 500, 3000, 10000 bps)
- QuoterV2 for accurate pricing that accounts for tick depth and fee tiers
- SwapRouter02 multicall pattern for deadline enforcement
- Liquidity wait mechanism (30-second timeout for initial `Mint` event on new pools)
- Cross-DEX deduplication — prevents double-buying the same token across V2 and V3

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      Event Sources                           │
│   Factory Listeners (WS/HTTP)  ·  Telegram Signal Listener   │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    Risk Gate (5 rules)                        │
│   Position size · Daily loss · Open positions · Cooldown     │
│   · Total exposure                                           │
└──────────────────┬───────────────────────────────────────────┘
                   │ pass
                   ▼
┌──────────────────────────────────────────────────────────────┐
│               Safety Pipeline (9 checks)                     │
│   Sell simulation (hard gate) → 8 parallel checks            │
│   Honeypot · Blacklist · Lock · Liquidity · Metadata ·       │
│   Swap sim · Tax · Max limits                                │
└──────────────────┬───────────────────────────────────────────┘
                   │ all pass
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                  Trade Execution                             │
│   TX Builder → MEV Strategy Dispatch                         │
│   Flashbots (ETH) · bloXroute (BSC) · Passthrough (Base/Arb)│
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│               Position Management                            │
│   SQLite persistence · Stop-loss · Take-profit · Timed exit  │
│   Per-token sell mutex · Timer cascade cleanup                │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                   Observability                               │
│   Pino structured JSON logging · Telegram alerts              │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.8, strict mode, ES2022 target |
| Runtime | Node.js (CommonJS) |
| Blockchain | ethers.js 6.16 — providers, wallets, contract interaction, native BigInt |
| MEV | @flashbots/ethers-provider-bundle (ETH), bloXroute API (BSC) |
| Smart Contracts | Solidity 0.8.28 via Hardhat 2.26 (test tokens, local dev) |
| Type Generation | TypeChain — typed contract bindings from ABIs |
| Database | SQLite via better-sqlite3 (WAL mode, prepared statements) |
| Logging | Pino (structured JSON, child loggers per module/chain) |
| Notifications | Telegram Bot API (alerts) + Telegram Client API (signal listener) |
| HTTP | Axios (safety provider API calls) |
| Linting | ESLint 9 + typescript-eslint with BigInt/Number mixing enforcement |

---

## Feature Deep Dive

### Chain Registry

`chainRegistry.ts` is the single source of truth for all chain-specific configuration. It uses a discriminated union (`DexConfigV2 | DexConfigV3`) for compile-time DEX type safety and maps each chain to its:

- WETH address and native currency symbol
- Array of V2 and V3 DEX configs with hardcoded contract addresses
- MEV strategy identifier and credentials
- Safety API routing (which providers to use per check type)
- Gas configuration (EIP-1559 vs. legacy, multiplier, max gas limit)
- Per-chain capital limits (snipe amount, max capital, min liquidity)

`buildChainRegistry()` reads environment variables at startup, validates RPC URLs and MEV credentials, and returns a typed `Map<string, ChainConfig>`. Invalid chains are rejected before the bot starts.

### Transaction Manager

The transaction manager implements a strategy pattern for MEV dispatch. `createMevStrategy()` maps chain config to the appropriate implementation:

- **Flashbots**: authenticates with a separate ECDSA signer, bundles transactions for target block + 1, retries with nonce increments
- **bloXroute**: submits via JSON-RPC `bsc_private_tx` with HTTP auth header
- **Passthrough**: direct `wallet.sendTransaction()` with EIP-1559 gas parameters

All strategies support configurable retry counts (default: 3) with nonce management.

### Gas Manager

Per-chain gas configuration handles the split between EIP-1559 and legacy chains:

| Chain | Gas Model | Multiplier | Max Gas Limit |
|-------|-----------|-----------|---------------|
| Ethereum | EIP-1559 | 1.2x | 300,000 |
| BSC | Legacy | 1.1x | 500,000 |
| Base | EIP-1559 | 1.1x | 500,000 |
| Arbitrum | EIP-1559 | 1.1x | 1,000,000 |

`getGasOptions()` queries the provider's `getFeeData()`, applies the chain-specific multiplier as a safety margin, and returns typed gas parameters.

### Safety Provider Adapters

External safety APIs are abstracted behind a consistent adapter layer in `safetyProviders/`:

- **honeypot.is** — `GET /v2/IsHoneypot` with chain ID routing (ETH, Base)
- **GoPlus** — `GET /api/v1/token_security/{chainId}` with multi-field response parsing (BSC, Arbitrum)
- **Unicrypt** — liquidity lock API with expiry time validation (ETH)
- **Mudra** — liquidity lock API with `unlockDate` check (BSC)

Each adapter has a primary API path and an on-chain fallback (e.g., burn address check for liquidity locks, bytecode scan for blacklists).

### Exit Manager

`exitManager.ts` solves the concurrent exit problem. When stop-loss, take-profit, and timed-sell all watch the same token, race conditions can cause double-sells. The solution:

- `tryAcquireSellLock()` — atomic check-and-set using a `Map` (safe in single-threaded JS)
- Timer registry tracks all interval/timeout handles per token (keyed by `chain:address`)
- `clearAllTimersForToken()` cancels all competing monitors when any exit fires
- Multi-chain overloads coexist with legacy single-chain signatures for backward compatibility

### Database Layer

SQLite with WAL mode provides concurrent read access during monitoring loops without blocking writes:

```sql
trades (
  id INTEGER PRIMARY KEY,
  token TEXT COLLATE NOCASE,
  chain TEXT DEFAULT 'mainnet',
  action TEXT CHECK(action IN ('buy', 'sell', 'fail')),
  tx_hash, block, timestamp, amount_in, amount_out,
  gas_cost, price_at_action,
  status TEXT CHECK(status IN ('pending', 'sold', 'failed')),
  pool_type TEXT CHECK(pool_type IN ('v2', 'v3')),
  fee_tier INTEGER
)
```

Indexes on `token`, `chain`, `timestamp`, and `status` support the risk manager's prepared-statement queries. Realized P&L is computed on read (`sell_revenue - buy_cost - buy_gas - sell_gas`), not stored.

Schema migrations run at startup (v1 → chain column, v2 → pool_type/fee_tier). Legacy `.bot-state.json` is imported automatically and renamed to `.bak`.

### Startup & Shutdown

**Startup sequence:**
1. Build chain registry from environment (validates all RPC/MEV credentials)
2. Create chain context per enabled chain (HTTP + WS providers, wallet, child logger)
3. Validate chain IDs via RPC round-trip
4. Health-check MEV services
5. Start V2/V3 listeners per DEX per chain
6. Resume monitoring for any pending trades in the database
7. Start 5-minute periodic MEV health check

**Shutdown:**
- SIGTERM/SIGINT handlers clear all monitoring timers, close DB connections, and destroy WebSocket providers
- 5-second force-exit safety net prevents zombie processes

---

## Data Model

The core entity is the `trades` table, which tracks every trading action:

- **Buy actions** create a row with `status='pending'` and `action='buy'`
- **Sell actions** create a second row with `action='sell'` matched by token address
- **Failed actions** are recorded with `action='fail'` for audit trail completeness

**Derived metrics** (computed via prepared statements, not stored):
- Open position count → `COUNT(*) WHERE status='pending' AND action='buy'`
- Total exposure → `SUM(amount_in) WHERE status='pending' AND action='buy'`
- Per-chain deployed capital → grouped by `chain`
- Daily realized loss → `SUM(pnl)` over rolling 24-hour window per chain

This design keeps the schema simple while supporting all risk management queries through indexed lookups.

---

## Security & Reliability

- **Private key isolation** — wallet key loaded from environment variable, never logged or persisted
- **MEV protection** — transactions never enter the public mempool on Ethereum or BSC
- **Sell simulation as hard gate** — no capital is deployed unless the bot can confirm the exit path works
- **Transfer tax detection** — catches hidden fee mechanisms that could trap funds
- **Strict type safety** — TypeScript strict mode with ESLint rules that flag BigInt/Number mixing at lint time
- **WAL-mode SQLite** — concurrent reads during monitoring loops without lock contention
- **Graceful shutdown** — signal handlers ensure timers are cleared and DB is closed cleanly
- **Resume on restart** — pending positions are reloaded from the database and monitoring resumes automatically
- **Rate limiting** — per-chain cooldowns prevent rapid-fire snipes during volatile periods
- **Circuit breaker** — daily loss limit halts new snipes per chain while allowing existing positions to be managed

---

## Project Structure

```
src/
├── bot.ts                  Core orchestrator — listeners, handlers, buy/sell logic
├── chainRegistry.ts        Multi-chain config registry (DEXes, MEV, gas, safety APIs)
├── config.ts               Environment variable validation and legacy defaults
├── riskManager.ts          5-rule risk gate with DB-backed state
├── telegramListener.ts     Telegram signal listener with sender/channel whitelisting
├── alphaDrop.ts            Routes Telegram signals into the standard snipe pipeline
└── utils/
    ├── abis.ts             Centralized ABI definitions (Factory, Router, ERC20, etc.)
    ├── blocklist.ts        Known bad tokens and pairs
    ├── db.ts               SQLite singleton — schema, migrations, prepared statements
    ├── exitManager.ts      Per-token sell mutex, timer registry, shutdown handlers
    ├── flashbots.ts        Flashbots bundle provider wrapper
    ├── gasManager.ts       Per-chain gas pricing (EIP-1559 / legacy)
    ├── logger.ts           Pino structured JSON logger
    ├── notifier.ts         Telegram Bot API alert dispatch
    ├── pairDiscovery.ts    Token → pair address resolution
    ├── provider.ts         Singleton HTTP/WebSocket provider cache
    ├── retry.ts            Exponential backoff retry wrapper
    ├── tokenSafety.ts      9-stage safety validation (legacy + chain-aware variants)
    ├── txManager.ts        MEV strategy factory and TX submission with retry
    ├── mevStrategies/
    │   ├── types.ts        MevStrategy interface (name, healthCheck, sendTransaction)
    │   ├── flashbots.ts    Flashbots Protect implementation
    │   ├── bloxroute.ts    bloXroute private TX implementation
    │   └── passthrough.ts  Direct submission for chains with native privacy
    └── safetyProviders/
        ├── types.ts        Safety provider function signatures
        ├── goplus.ts       GoPlus token security API adapter
        ├── honeypotIs.ts   Honeypot.is API adapter
        ├── mudra.ts        Mudra liquidity lock adapter (BSC)
        └── unicrypt.ts     Unicrypt liquidity lock adapter (ETH)

contracts/                  Solidity test contracts (ERC20, Uniswap Factory/Router)
test/                       Test fixtures and skeleton test suites
```

---

## Primary User Flow

1. **Configure** — set chain RPC URLs, wallet key, capital limits, and risk parameters in `.env`
2. **Start** — bot builds the chain registry, validates config, health-checks MEV services, and begins listening
3. **Detect** — factory event listeners pick up new token pairs/pools across all enabled chains and DEXes; alternatively, a Telegram signal provides a contract address
4. **Validate** — each candidate passes through the risk gate (5 rules) and safety pipeline (9 checks)
5. **Execute** — approved tokens are sniped via the chain's MEV strategy with slippage protection
6. **Monitor** — stop-loss, take-profit, and timed-exit monitors run in parallel, each polling every 15 seconds
7. **Exit** — the first trigger to fire acquires the sell lock, executes the sell, clears all other monitors, and updates the database
8. **Alert** — Telegram notifications fire on buys, sells, safety rejections, and risk gate blocks

---

## Configuration

The bot is configured entirely through environment variables. See `.env.example` for the full template.

**Core settings:**
- `ENABLED_CHAINS` — comma-separated list of chains to monitor (`eth`, `bsc`, `base`, `arb`)
- Per-chain `*_RPC_URL` and optional `*_WS_URL` for WebSocket listeners
- Per-chain `*_SNIPE_AMOUNT` and `*_MAX_CAPITAL` for capital allocation
- `FLASHBOTS_AUTH_KEY` and `BLOXROUTE_AUTH_HEADER` for MEV protection
- Telegram credentials for alerts and signal listening
- Risk parameters: `MAX_OPEN_POSITIONS`, `MAX_TOTAL_EXPOSURE`, `DAILY_LOSS_PCT`, `SNIPE_COOLDOWN_MS`

---

## Technical Highlights

**Why this project is technically interesting:**

- **Chain-aware polymorphism** — the chain registry, MEV strategies, safety providers, and gas manager all dispatch based on chain identity at runtime, avoiding conditional chains of `if chain === 'bsc'` scattered throughout the codebase
- **Safety-first trade execution** — the sell simulation hard gate is a deliberate design choice: if the bot cannot prove it can exit a position, it will not enter one. This prevents the most common class of DeFi loss (honeypot tokens)
- **Concurrent exit safety** — the per-token sell mutex and timer cascade cleanup solve a real concurrency problem where multiple exit strategies can fire simultaneously on the same position
- **DB-backed risk management** — portfolio-level constraints (exposure caps, daily loss limits) survive restarts and are computed from the actual trade history, not ephemeral state
- **V3 QuoterV2 integration** — uses the Quoter contract (not the SwapRouter) for pricing, which provides accurate quotes accounting for concentrated liquidity tick depth and fee tiers
- **Multi-provider safety fallbacks** — each safety check has a primary API and an on-chain fallback, so the pipeline degrades gracefully when third-party services are down
- **Native BigInt throughout** — ethers.js v6 with strict ESLint rules preventing accidental BigInt/Number mixing, eliminating an entire class of precision bugs common in DeFi applications

---

## Future Expansion

The architecture was designed to support several planned extensions:

- **Smart exit strategies** — trailing stop-loss, partial position scaling, time-weighted urgency (infrastructure for monitoring loops and exit dispatch is in place)
- **Web dashboard** — real-time portfolio view, P&L tracking, and manual trade controls (the SQLite database and structured logging provide the data layer)
- **Testing infrastructure** — test fixtures and skeleton suites exist for chain config, MEV strategies, and safety providers; the modular architecture supports unit testing each layer independently

These are planned but not yet implemented.

---

## Setup

```bash
npm install
cp .env.example .env     # Configure your environment
npm run build             # Compile TypeScript
node dist/index.js        # Start the bot
```

Requires Node.js 18+ and RPC endpoints for each enabled chain.
