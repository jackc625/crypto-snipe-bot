# Crypto Snipe Bot

A multi-chain, MEV-protected DEX sniping and automated trading bot written in TypeScript. It listens for newly deployed liquidity on major EVM chains, runs tokens through an eight-stage safety pipeline, executes buys through chain-appropriate private-mempool relays, and manages exits with volatility-aware trailing stops, tiered partial sells, and time-based urgency rules. State is persisted in SQLite so open positions survive restarts, and a hardened Express + WebSocket dashboard exposes live positions, trade history, risk exposure, and runtime controls.

The project is not a wrapper around a third-party sniping service. It talks directly to factory and router contracts, builds and signs its own swap calldata, and dispatches transactions through Flashbots, bloXroute, or public RPC depending on the chain.

---

## Overview

The bot exists to automate the end-to-end lifecycle of a speculative on-chain trade:

1. **Discover** newly created pools the moment they appear on a DEX factory, or ingest contract addresses posted to a whitelisted Telegram channel.
2. **Validate** each candidate token against honeypot APIs, static-call simulations, liquidity-lock registries, bytecode heuristics, and transfer-tax probes.
3. **Gate** the trade against portfolio-level risk controls — position count, total exposure, per-chain cooldowns, rolling 24h realized loss, and max position size.
4. **Execute** the buy via the chain's preferred MEV path, record it in SQLite, and spin up an exit monitor.
5. **Exit** based on a combination of stop-loss, take-profit tiers, trailing stop (activated after 2x and adjusted by recent price volatility), and an age-based urgency escalator.
6. **Surface** every event through a local dashboard API, a WebSocket feed, and Telegram alerts.

It runs as a single long-lived Node.js process started with `npx ts-node src/bot.ts`.

---

## Key Features

### Multi-chain sniping
- Ethereum, BSC, Base, and Arbitrum, enabled independently via `ENABLED_CHAINS`.
- Each chain carries its own RPC endpoints, WebSocket provider, wallet funding cap, snipe size, DEX registry, MEV strategy, and safety provider stack.
- Chain configuration is a typed registry (`src/chainRegistry.ts`) of hardcoded templates overlaid with environment overrides — no YAML, no external config service.

### Multi-DEX coverage (V2 and V3)
- Uniswap V2, SushiSwap, PancakeSwap V2, BiSwap, Aerodrome, Camelot V2.
- Uniswap V3 and PancakeSwap V3 with fee-tier aware pool discovery (500 / 3000 / 10000 bps) and QuoterV2-based pricing.
- V3 swaps are wrapped in `multicall(deadline, ...)` to enforce deadlines that the V3 router does not accept natively.

### Pool discovery
- Primary: WebSocket subscriptions to each factory's `PairCreated` (V2) and `PoolCreated` (V3) events.
- Fallback: HTTP polling via `queryFilter` on the latest block when no WebSocket URL is configured or the socket drops.
- Exponential-backoff reconnect (1s -> 60s cap) that strips stale listeners before re-subscribing.
- Chain-scoped deduplication so the same token hitting multiple DEXs on different chains is evaluated per chain.

### Eight-stage token safety pipeline
Tokens are rejected unless they pass all of:
1. Honeypot check — `honeypot.is` and/or GoPlus, with a static-call swap simulation as a last-resort fallback.
2. Anti-bot / blacklist-function detection via bytecode selector scanning.
3. Liquidity lock status — Unicrypt (Ethereum), Mudra (BSC), GoPlus (all chains), with burn-address fallback.
4. Liquidity sufficiency — `getReserves` (V2) or zero-liquidity quoter probe (V3) against a per-chain minimum.
5. Metadata sanity — name, symbol, decimals.
6. Swap simulation — `getAmountsOut` (V2) or `quoteExactInputSingle` (V3).
7. Transfer-tax detection — simulated buy followed by a simulated sell, comparing expected vs. observed balance deltas.
8. Max-wallet / max-tx limit detection via bytecode heuristics.

Failures are hard rejects, logged and routed to Telegram.

### MEV-protected execution
- **Ethereum:** Flashbots bundle relay (`@flashbots/ethers-provider-bundle`) signed by a dedicated auth key, two-block target window.
- **BSC:** bloXroute `bsc_private_tx` JSON-RPC, authenticated with a header secret.
- **Base / Arbitrum:** Passthrough direct submission (these chains have no mainstream private relay).
- Chosen at runtime via a small `MevStrategy` interface (`healthCheck`, `sendTransaction`) in `src/utils/mevStrategies/`. Each chain's bot startup verifies the relay is reachable and re-checks every five minutes.

### Exit engine
All exit logic lives in `src/exitEngine.ts` (~940 lines) and is driven by a single 5-second polling loop per position:
- **Stop-loss** at a configurable percentage below entry (default 25%).
- **Partial sell tiers** like `2x:50,5x:25` — sell 50% at 2x entry, 25% at 5x, with simultaneous tiers coalesced into one transaction.
- **Trailing stop** activated once the position doubles. The pullback percentage adapts to recent price volatility (coefficient of variation over a circular sample buffer), bounded by `TRAILING_MIN_PCT` / `TRAILING_MAX_PCT`.
- **Urgency escalator** — positions older than 30 minutes without a 1.5x move tighten their trailing stop progressively.
- **Sell-lock mutex** per `(chain, token)` prevents double-sells when multiple triggers fire in the same tick.
- Full exit state (entry price, high-water mark, completed tiers, volatility samples) is persisted to the `exit_state` table and re-hydrated on startup via `resumeExitMonitor`.

### Risk manager
Five gates, evaluated before a snipe is even simulated, in `src/riskManager.ts`:
- `MAX_POSITION_SIZE` — hard cap per snipe.
- `DAILY_LOSS_PCT` — rolling 24-hour realized loss circuit breaker, per chain.
- `MAX_OPEN_POSITIONS` — global concurrent-position cap.
- `SNIPE_COOLDOWN_MS` — per-chain debounce between snipes.
- `MAX_TOTAL_EXPOSURE` — global deployed-capital cap computed from pending buys net of partial sell proceeds.

### Dashboard API and WebSocket feed
`src/api/server.ts` spins up an Express 5 server (Helmet, CORS, cookie-parser) bound by default to `127.0.0.1:8080`:
- `GET /health` — unauthenticated liveness probe.
- `POST /api/auth/login` — API-key session, cookie-based.
- `GET /api/positions` — live positions with prices fetched on-demand from the chain.
- `GET /api/trades` — paginated trade history with CSV export.
- `GET /api/risk/summary`, `GET /api/risk/exposure` — aggregated risk state.
- `GET /api/chains/*` — introspection plus listener restart controls.
- `POST /api/controls/pause-snipes` — runtime kill-switch for new entries.
- WebSocket at `/ws` — 5-second position broadcasts plus severity-tagged notifications.

### Telegram integration
- **Outbound notifier** (`src/utils/notifier.ts`) — Markdown alerts for snipes, rejections, exits, risk events, and WebSocket/RPC health.
- **Inbound listener** (`src/telegramListener.ts` + `src/alphaDrop.ts`) — a full Telegram client (via the `telegram` MTProto library) that watches whitelisted senders and channels, extracts contract addresses from messages, detects which chain each address lives on by checking for deployed bytecode, and routes the candidate into the same snipe pipeline used by factory events.

### Persistence
SQLite via `better-sqlite3` with WAL mode and an automatic schema migrator (`src/utils/db.ts`). Two core tables:
- `trades` — every buy, sell, partial sell, and failure, including `pool_type` (v2/v3), `fee_tier`, `dex_name`, gas cost, price at action, and status.
- `exit_state` — full serialized state of the exit engine per open position, enabling lossless restart recovery.

All queries are prepared at load time. Schema migrations run on startup and advance incrementally from v1 through v4.

---

## Technical Highlights

These are the parts of the codebase that are most worth looking at:

- **Pluggable MEV strategy interface.** Three implementations behind one type — Flashbots, bloXroute, passthrough — selected by chain with no conditional sprawl in `txManager`.
- **Safety provider adapters.** `HoneypotCheckFn` and `LiquidityLockCheckFn` signatures let each chain assemble its own stack (honeypot.is -> GoPlus -> static-call) without the caller knowing which provider answered.
- **Volatility-adaptive trailing stops.** A circular buffer of price samples feeds a coefficient-of-variation calculation that widens or tightens the trailing pullback inside configured bounds. The same engine handles partial-sell tiers and age-based urgency, and they all respect a single sell-lock.
- **V3 multicall deadline wrapping.** V3's `SwapRouter` has no deadline parameter on `exactInputSingle`; the bot wraps the call in `multicall(deadline, data)` to preserve V2-equivalent deadline semantics.
- **Exit state resume.** On crash or restart, `resumeExitMonitor` rebuilds every open position's monitor from `exit_state` without losing high-water marks, completed partial tiers, or volatility history.
- **Chain-scoped dedup and cooldowns.** The same token launched on multiple chains is treated as distinct snipe candidates; the same chain can't fire two snipes inside a cooldown window.
- **WebSocket auto-recovery.** Factory listeners detect socket closure, destroy stale providers, back off exponentially to a 60-second cap, and re-attach without event-duplication bugs.
- **Dual config surface.** A legacy single-chain `CONFIG` in `src/config.ts` still works, but the real source of truth is `src/chainRegistry.ts`, which builds a `ChainContext` (provider pair, wallet, scoped logger, typed DEX list) per enabled chain.

---

## Architecture

Layers:

- **Orchestration** — `src/bot.ts` owns startup, graceful shutdown (SIGINT/SIGTERM), signal handlers, provider health checks, listener restart logic, and resumption of in-flight positions.
- **Chain abstraction** — `ChainConfig` + `ChainContext` hold a chain's RPC/WS providers, wallet, gas strategy, DEX registry, MEV strategy, and a child logger with a `chain` label.
- **Discovery** — native event subscriptions on V2/V3 factories plus a Telegram-driven alpha path.
- **Validation** — pipeline in `tokenSafety.ts` with pluggable providers.
- **Trading** — `txManager.ts` builds and dispatches swaps; `mevStrategies/` hides the per-chain relay detail.
- **Exits** — `exitEngine.ts` and `utils/exitManager.ts` (timer registry + sell mutex).
- **State** — `utils/db.ts` — SQLite (WAL, prepared statements, auto-migrations).
- **Surfaces** — `api/` (Express + WS) and `utils/notifier.ts` (Telegram).
- **Infra utilities** — `utils/provider.ts` (provider singletons + recovery), `utils/gasManager.ts`, `utils/retry.ts`, `utils/receiptDecoder.ts` (WETH Withdrawal/Transfer log parsing for sell revenue).

Data flow for a single snipe:

```
Factory event / Telegram message
        |
        v
Token safety pipeline  ----- reject -----> Telegram alert + log
        |                                        (no state change)
        | pass
        v
Risk manager gates  -------- reject -----> log + cooldown record
        |
        | pass
        v
Swap calldata (V2/V3)
        |
        v
MEV strategy (Flashbots / bloXroute / passthrough)
        |
        v
trades row (status=pending) + exit_state row
        |
        v
Exit monitor loop (5s)
        |
        v
Trigger: stop-loss / partial / trailing / urgency
        |
        v
Sell tx + trades row (status=sold) + exit_state update
        |
        v
Dashboard broadcast + Telegram alert
```

---

## Tech Stack

- **Language:** TypeScript 5.8 (strict mode, ES2022 target).
- **Runtime:** Node.js via `ts-node`; compiles cleanly to `dist/` with `npm run build`.
- **Blockchain:** `ethers` v6.16 — the codebase is fully on the v6 API, with dedicated tests asserting no v5 patterns remain.
- **Database:** `better-sqlite3` 12.8 (synchronous, WAL mode, prepared statements).
- **MEV:** `@flashbots/ethers-provider-bundle`, plus a hand-rolled bloXroute JSON-RPC client.
- **HTTP / realtime:** Express 5, `ws` 8, Helmet, CORS, cookie-parser.
- **Telegram:** `telegram` (MTProto client) for inbound signals; Bot API over HTTP for outbound alerts.
- **Logging:** `pino` structured JSON, per-module child loggers, `pino-pretty` available for dev.
- **HTTP client:** `axios` for external safety/security APIs.
- **Testing:** `vitest` 4 with three project profiles (unit, integration, fork) and a 70% coverage threshold via `@vitest/coverage-v8`.
- **Solidity tooling (installed, not required at runtime):** Hardhat toolbox, TypeChain — available for contract-side work against forked networks.

---

## Feature Deep Dive

### DEX factory discovery
`startDexListener` in `src/bot.ts` opens a contract instance on each configured factory using the chain's WebSocket provider if one exists, otherwise a 2-second HTTP polling loop driven by `queryFilter`. For V2 it subscribes to `PairCreated(token0, token1, pair)`; for V3 to `PoolCreated(token0, token1, fee, tickSpacing, pool)`. Target-token selection is "the one that isn't WETH." A per-chain in-memory `Set<string>` suppresses duplicate work for the same token within a run.

On WebSocket disconnect the bot tears down all listeners, destroys the provider, backs off exponentially up to 60 seconds, and re-establishes the subscription. Every reconnect cycle is surfaced to Telegram.

### Safety pipeline
`src/utils/tokenSafety.ts` (~630 lines) exposes both a legacy single-chain API and a `...ForChain` variant that accepts a `ChainContext`. The per-chain variants look up which safety adapters (`honeypot.is`, `goplus`, `unicrypt`, `mudra`) are wired for that chain in `chainRegistry.ts` and call them in order, short-circuiting on a definite verdict and falling through on API failures.

Simulation-based checks bypass external APIs entirely — a buy is simulated with `getAmountsOut` or `quoteExactInputSingle`, then a sell is simulated against the resulting balance. Divergence between expected and observed output flags transfer tax or honeypot behavior even when no safety API is reachable.

### Swap construction
V2 snipes call `swapExactETHForTokens(minOut, [WETH, token], recipient, deadline)` on the chain's router. Slippage is applied to the quoter output before it becomes `minOut`. V3 snipes populate `ExactInputSingleParams` and wrap the call in `multicall(deadline, encodedExactInputSingle)` so the deadline is honored on a router that otherwise ignores it. Gas is computed by `utils/gasManager.ts` — EIP-1559 fee data where supported, legacy `gasPrice` for BSC — and multiplied by the chain's configured multiplier.

### Exit monitor
Each open position gets a single `setInterval` at 5-second cadence (see `utils/exitManager.ts` for the timer registry). On each tick the engine re-prices the position, updates the high-water mark and volatility samples, and evaluates triggers in precedence order: stop-loss -> partial tiers -> trailing stop -> age-urgency. A `(chain, token)` mutex prevents two triggers from firing their sells concurrently. Completed partial tiers are persisted so a restart does not re-sell tiers that already executed.

Sell revenue is parsed from the transaction receipt by `utils/receiptDecoder.ts`, which understands both direct WETH `Transfer` patterns and the WETH `Withdrawal` -> native-value path some routers use.

### Dashboard
The API layer (`src/api/`) has `routes/`, `middleware/` (auth + error handler), `ws/` (upgrade handler + broadcaster), and `helpers/` (most notably `positions.ts`, which fetches live prices on-demand when the dashboard asks for open positions). Authentication uses a single `DASHBOARD_API_KEY` exchanged for a signed cookie on `/api/auth/login`; everything under `/api` except the login endpoint requires that cookie. Health is exposed unauthenticated at `/health`.

### Telegram alpha drop
`alphaDrop.ts` extracts Ethereum-format addresses from inbound Telegram messages via regex, then probes each candidate by calling `provider.getCode()` on every enabled chain. The first chain with deployed bytecode wins, and the candidate is injected into the same pipeline used for factory-detected pairs — same safety checks, same risk gates, same execution path. Per-chain cooldowns and an in-memory dedup set prevent a viral message from triggering a flood.

---

## Data Model

Two tables, both in SQLite (`./data/bot.db` by default):

**`trades`** (schema v4)

| Column | Notes |
|---|---|
| `id` | Primary key. |
| `token` | Token contract address (`COLLATE NOCASE`). |
| `chain` | `eth`, `bsc`, `base`, or `arb`. |
| `action` | `buy`, `sell`, `partial_sell`, or `fail`. |
| `tx_hash`, `block`, `timestamp` | On-chain provenance. |
| `amount_in`, `amount_out` | Native / token amounts as strings to preserve precision. |
| `gas_cost`, `price_at_action` | Cost and unit price at the moment of execution. |
| `status` | `pending`, `sold`, or `failed`. |
| `pool_type`, `fee_tier`, `dex_name` | V2/V3 discriminator, V3 fee tier, DEX identity. |

**`exit_state`** (schema v3)

| Column | Purpose |
|---|---|
| `trade_id` | FK into `trades`. |
| `entry_price` | Starting price reference. |
| `high_water_mark` | Peak observed; drives trailing stop. |
| `trailing_activated` | Whether the position has ever hit 2x. |
| `partial_tiers_completed` | JSON array of already-executed tier indices. |
| `original_token_amount` | Snapshot for tier-relative sizing. |
| `urgency_start_ts` | Anchor for the age-based escalator. |
| `volatility_samples` | JSON circular buffer of recent prices. |

Indices cover the hot read paths (`token`, `chain`, `timestamp`, `status`, `trade_id`). WAL mode allows exit-monitor reads to proceed while the main loop writes new trades.

---

## Security and Production Considerations

- **Key handling.** Private keys live only in environment variables and never touch disk through the bot. The Flashbots auth key is separate from the trading key so rotation is independent.
- **Dashboard auth.** Helmet is applied globally, CORS is locked down, and `/api/*` requires a signed cookie obtained by posting `DASHBOARD_API_KEY` to `/api/auth/login`. The server binds to `127.0.0.1` by default.
- **Runtime kill-switch.** `POST /api/controls/pause-snipes` stops new entries without tearing down exit monitors for already-open positions.
- **Risk gates short-circuit early.** The five risk checks run before any safety API call, keeping per-opportunity cost bounded when the bot is already at capacity.
- **Restart safety.** Exit state is persisted on every meaningful transition and re-hydrated at startup; partial sells that already completed are not re-executed.
- **Graceful shutdown.** Signal handlers stop accepting new pairs, disconnect Telegram, clear timers, destroy WebSocket providers, close the SQLite handle, and enforce a 5-second force-exit ceiling.
- **Validation.** Required env vars are validated at startup; RPC endpoints have their chain IDs checked against the expected value before the bot starts listening.
- **Observability.** Every subsystem logs JSON through a named child logger, which plugs directly into container log shipping without additional instrumentation.

---

## Project Structure

```
src/
  bot.ts               Orchestrator: lifecycle, listeners, per-chain startup
  chainRegistry.ts     Typed multi-chain configuration + ChainContext factory
  config.ts            Env loading and legacy single-chain CONFIG object
  exitEngine.ts        Exit orchestrator: stops, trailing, partials, urgency
  riskManager.ts       Five risk gates + exposure accounting
  alphaDrop.ts         Telegram-sourced candidate router
  telegramListener.ts  MTProto client + whitelist enforcement
  api/                 Express + WebSocket dashboard
    server.ts, routes/, middleware/, ws/, helpers/
  utils/
    db.ts              SQLite (WAL, prepared statements, migrations)
    tokenSafety.ts     Eight-stage safety pipeline
    txManager.ts       Swap dispatch + retries
    exitManager.ts     Timer registry and sell-lock mutex
    mevStrategies/     Flashbots, bloXroute, passthrough
    safetyProviders/   honeypot.is, GoPlus, Unicrypt, Mudra adapters
    provider.ts        HTTP/WS provider singletons + recovery
    pairDiscovery.ts, gasManager.ts, receiptDecoder.ts,
    notifier.ts, retry.ts, abis.ts, blocklist.ts, logger.ts

test/
  unit/          Schema, risk, exit engine, safety, ethers v6 invariants (19 files)
  integration/   Exit monitor, MEV strategies, txManager, WS reconnect, API
  fork/          Hardhat fork scaffolding
  helpers/, fixtures/
```

---

## Configuration

All configuration is environment-driven. A template with every supported variable lives at `.env.example`. The most important groups:

- **Wallet:** `PRIVATE_KEY`.
- **Chains:** `ENABLED_CHAINS`, plus `ETH_RPC_URL` / `ETH_WS_URL` / `ETH_SNIPE_AMOUNT` / `ETH_MAX_CAPITAL` (and BSC, BASE, ARB equivalents).
- **MEV:** `FLASHBOTS_AUTH_KEY`, `BLOXROUTE_AUTH_HEADER`.
- **Risk:** `MAX_OPEN_POSITIONS`, `MAX_TOTAL_EXPOSURE`, `DAILY_LOSS_PCT`, `SNIPE_COOLDOWN_MS`, `MAX_POSITION_SIZE`.
- **Exits:** `STOP_LOSS_PCT`, `TRAILING_STOP_PCT`, `TRAILING_MIN_PCT`, `TRAILING_MAX_PCT`, `PARTIAL_SELL_TARGETS`.
- **Telegram outbound:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Telegram inbound:** `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, `TELEGRAM_ALLOWED_SENDERS`, `TELEGRAM_ALLOWED_CHANNELS`.
- **Dashboard:** `DASHBOARD_API_KEY`, `DASHBOARD_PORT`, `DASHBOARD_HOST`.
- **Infra:** `LOG_LEVEL`, `DB_PATH`.

---

## Running

```bash
# install
npm install

# configure
cp .env.example .env     # then fill in values

# run (development)
npx ts-node src/bot.ts

# run (compiled)
npm run build
node dist/bot.js
```

Tests:

```bash
npm test                 # all projects
npm run test:unit
npm run test:integration
npm run test:fork
npm run test:coverage    # HTML report in coverage/
```

---

## Testing

`vitest.config.ts` defines three project profiles:

- **unit** — schema, migrations, risk gates, exit-engine branches, safety check dispatch, ethers v6 invariants, chain registry validation, config parsing, receipt decoding, V3 ABI shapes (19 files).
- **integration** — the full exit monitor loop with mocked prices, MEV strategy health/submit behavior, txManager retry paths, WebSocket reconnect scenarios, and Express endpoint suites under `test/integration/api/`.
- **fork** — Hardhat mainnet-fork scaffolding for contract-level tests.

Coverage thresholds are set to 70% for lines, functions, branches, and statements. There are dedicated negative tests that fail the build if v5-era ethers patterns reappear (`ethersV5PatternsAbsent.test.ts`).

---

## Extensibility

The boundaries where the bot is deliberately easy to extend:

- **New chain.** Add a `ChainConfig` template to `chainRegistry.ts`, wire a `createMevStrategy` branch if the chain needs something other than passthrough, optionally register safety providers.
- **New DEX.** Add a `DexConfigV2` or `DexConfigV3` to the chain's `dexes` list. Discovery and execution already branch on the `isDexV2` / `isDexV3` type guards.
- **New MEV relay.** Implement the `MevStrategy` interface (`healthCheck`, `sendTransaction`) and register it.
- **New safety provider.** Implement the `HoneypotCheckFn` / `LiquidityLockCheckFn` signature and plug it into a chain's `safetyApis`.
- **New exit rule.** The exit engine's trigger evaluation is ordered and idempotent; adding a new predicate alongside the existing four is localized to `exitEngine.ts` and the exit-state schema if new persistence is required.

---

## Summary

This project treats algorithmic DEX trading as a full systems problem rather than a single script: pluggable per-chain transport, layered safety, a real risk manager, persistent exit state with volatility-aware logic, a secured local control plane, and a test suite that asserts structural invariants (ethers version, schema migrations, MEV strategy behavior) alongside business logic. Every claim in this README is grounded in code currently in `src/` — there are no roadmap features dressed up as shipped ones.
