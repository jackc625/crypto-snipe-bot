# Crypto Snipe Bot

A production-grade, multi-chain DEX sniping and automated trading engine written in TypeScript. The bot listens to factory events on four EVM networks, validates newly deployed tokens through an eight-stage safety pipeline, submits buys through chain-appropriate private-mempool relays, and then manages exits with a volatility-adaptive trailing stop, tiered partial sells, and an age-based urgency escalator. Positions, partial-sell progress, high-water marks, and volatility samples are persisted to SQLite so the bot survives crashes without losing exit state.

Rather than wrapping an external sniping service, the bot constructs and signs its own router calldata and dispatches transactions through Flashbots, bloXroute, or public RPC depending on the chain. A hardened Express + WebSocket control plane and a React/Vite dashboard (bundled in `dashboard/`) expose live positions, trade history, per-chain risk exposure, and runtime kill-switches.

---

## What The Bot Actually Does

The end-to-end lifecycle of a single trade:

1. **Discover** — A `PairCreated` (Uniswap V2-style) or `PoolCreated` (Uniswap V3) event fires on one of the configured DEX factories. Alternatively, a contract address is posted in a whitelisted Telegram channel and auto-routed into the same pipeline.
2. **Validate** — Honeypot APIs, liquidity-lock registries, static-call swap and sell simulations, reserve floors, transfer-tax probes, metadata sanity, and bytecode heuristics for anti-bot / max-wallet patterns.
3. **Gate** — Five portfolio-level risk checks: per-snipe size cap, global open-position count, per-chain cooldown, global deployed-capital cap, and a rolling 24-hour realized-loss circuit breaker per chain.
4. **Execute** — Build V2 or V3 swap calldata (V3 wrapped in `multicall(deadline, …)` to preserve deadline semantics), then hand the signed transaction to the chain's MEV strategy (Flashbots bundle on Ethereum, bloXroute private tx on BSC, direct submission on Base/Arbitrum).
5. **Monitor** — A 5-second polling loop per open position maintains a high-water mark, a circular buffer of price samples, and an effective trailing-stop percentage adjusted by recent volatility and position age.
6. **Exit** — Fixed stop-loss, partial sell tiers (coalesced when multiple tiers fire in the same tick), volatility-adaptive trailing stop (activated once the position doubles), and an urgency escalator that hard-exits stale unprofitable positions.
7. **Observe** — Every event fans out to Telegram (Markdown alerts) and the local dashboard (WebSocket broadcasts every 5 seconds).

Single long-lived Node.js process. Entry point: `npx ts-node src/bot.ts`.

---

## Highlights Worth Calling Out

These are the parts most worth reading during code review or an interview:

- **Pluggable MEV strategy layer (`src/utils/mevStrategies/`).** Three implementations (Flashbots bundle relay, bloXroute `bsc_private_tx` JSON-RPC, passthrough) sit behind a two-method `MevStrategy` interface. Selection is declarative on the chain config; the caller in `txManager` branches on nothing. Each strategy runs a liveness check at startup and every five minutes.
- **Volatility-adaptive exit engine (`src/exitEngine.ts`, ~938 lines).** A circular price-sample buffer feeds a coefficient-of-variation calculation that scales the trailing pullback inside configured bounds (`TRAILING_MIN_PCT` / `TRAILING_MAX_PCT`). The same engine handles tiered partial sells, age-based urgency, and fixed stop-losses, all coordinated through a single `(chain, token)` sell-lock mutex so concurrent triggers never double-sell.
- **Restart-safe exit state.** The `exit_state` table persists entry price, high-water mark, completed tier indices, volatility samples, and urgency anchor. On startup, `resumeExitMonitor` rebuilds the live monitor for every pending position without re-executing partial sells that already settled.
- **V3 multicall deadline wrapping.** Uniswap V3's `SwapRouter02.exactInputSingle` has no deadline field on its parameter struct. The bot wraps the encoded call in `multicall(deadline, [data])` so deadline enforcement matches V2 semantics.
- **Chain-aware safety dispatch.** `tokenSafety.ts` exposes `…ForChain()` variants that resolve each safety adapter from `chainRegistry.ts` — Ethereum routes honeypot checks through `honeypot.is` first and GoPlus second, BSC flips to GoPlus + Mudra, and so on. Simulation-based checks (sell-after-buy balance delta) function as a last-resort fallback when every external API is unreachable.
- **WebSocket listener with exponential-backoff reconnect.** On socket close the bot strips stale listeners, destroys the provider, backs off from 1 s to a 60 s cap, and re-attaches. Every reconnect surfaces to Telegram and logs.
- **Typed multi-chain registry.** `chainRegistry.ts` holds the full per-chain template — RPC env keys, DEX list, MEV strategy, safety provider stack, gas strategy, explorer URL, default capital. `ENABLED_CHAINS=eth,bsc` is enough to turn on two chains with independent wallets, listeners, and child loggers.
- **Ethers v6, asserted.** A dedicated unit test (`ethersV5PatternsAbsent.test.ts`) fails the build if any v5-era pattern resurfaces. Another test pins the toolbox version. Upgrades aren't left to convention.

---

## Architecture

```
                    +----------------------+
                    |  ENABLED_CHAINS      |
                    |  eth | bsc | base | arb
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | chainRegistry        |  per-chain ChainContext
                    |  providers (HTTP/WS) |  (wallet, logger, DEXes)
                    +----------+-----------+
                               |
          +--------------------+---------------------+
          |                                          |
          v                                          v
+-------------------+                     +------------------------+
| Factory listeners |                     | Telegram MTProto       |
|  V2 PairCreated   |                     |  sender/channel ACL    |
|  V3 PoolCreated   |                     |  0x[40hex] extractor   |
|  WS + HTTP poll   |                     |  chain detection via   |
|  auto-reconnect   |                     |  provider.getCode      |
+---------+---------+                     +------------+-----------+
          |                                            |
          +---------------+   +------------------------+
                          |   |
                          v   v
                +--------------------------+
                | Eight-stage safety       |
                |  honeypot / lock /        |
                |  liquidity / metadata /   |
                |  swap+sell simulation /   |
                |  tax probe / anti-bot     |
                +------------+-------------+
                             |
                             v
                +--------------------------+
                | Risk gates (5 rules)     |
                |  size / daily-loss /     |
                |  count / cooldown /      |
                |  total exposure          |
                +------------+-------------+
                             |
                             v
                +--------------------------+
                | Swap builder (V2 / V3)   |
                |  multicall(deadline,...) |
                +------------+-------------+
                             |
                             v
                +--------------------------+
                | MEV strategy dispatch    |
                |  Flashbots | bloXroute | |
                |  passthrough             |
                +------------+-------------+
                             |
                             v
                +--------------------------+
                | SQLite (WAL)             |
                |  trades + exit_state     |
                +------------+-------------+
                             |
                             v
                +--------------------------+
                | Exit engine (5s tick)    |
                |  stop / partial /        |
                |  trailing / urgency      |
                |  sell-lock mutex         |
                +------------+-------------+
                             |
          +------------------+------------------+
          v                                     v
+--------------------+               +--------------------+
| Express + WS       |               | Telegram Bot API   |
|  /health, /api,    |               |  Markdown alerts   |
|  /ws @ 127.0.0.1   |               +--------------------+
+--------------------+
```

---

## Key Features

### Multi-chain discovery
- **Ethereum, BSC, Base, Arbitrum** — each toggled independently via `ENABLED_CHAINS`.
- Chain IDs are verified at startup via `provider.getNetwork()` and a mismatch causes the chain to be dropped, not silently wrong.
- Each chain carries its own RPC/WS endpoints, wallet funding cap, snipe size, DEX list, MEV strategy, safety provider stack, gas strategy (EIP-1559 on ETH/Base/Arb, legacy on BSC), and a `pino` child logger with `chain` set.

### Multi-DEX support (V2 and V3)
Current registry (`src/chainRegistry.ts`):

| Chain | V2 DEXes | V3 DEXes |
|-------|----------|----------|
| Ethereum | Uniswap V2, SushiSwap | Uniswap V3 |
| BSC | PancakeSwap V2, BiSwap | Uniswap V3, PancakeSwap V3 |
| Base | Uniswap V2, Aerodrome | Uniswap V3 |
| Arbitrum | Uniswap V2, Camelot V2 | Uniswap V3 |

V3 pool discovery probes the three standard fee tiers (500, 3000, 10000 bps). V3 pricing uses `QuoterV2.quoteExactInputSingle` with `staticCall`; V3 swaps use `SwapRouter02.exactInputSingle` wrapped in a `multicall(deadline, …)` so deadline semantics survive.

### Pool discovery
- **Primary:** WebSocket subscription on every factory (`PairCreated` for V2, `PoolCreated` for V3). On disconnect, the provider is destroyed via `removeWsProvider`, a fresh `WebSocketProvider` is created with the expected chainId, and subscriptions are re-attached.
- **Fallback:** 2-second HTTP polling via `queryFilter` against the latest block when `*_WS_URL` is unset.
- **V3 "wait for liquidity":** After `PoolCreated`, the bot scans the same block for a `Mint` event (atomic-launch case) and otherwise subscribes to the pool for up to 30 seconds, dropping the opportunity if liquidity never arrives.
- **Dedup:** Per-chain `isTokenSniped` check against the `trades` table prevents the same token from being sniped twice even when a second DEX on the same chain emits a later event.

### Eight-stage token safety pipeline
Every candidate, from either a factory event or a Telegram message, is rejected unless it passes all of:

1. `checkHoneypotForChain` — honeypot.is or GoPlus, chain-dependent.
2. `isBlacklistedTokenForChain` — bytecode selector scan.
3. `isLiquidityLockedForChain` — Unicrypt (ETH), Mudra (BSC), GoPlus (all), burn-address fallback.
4. `isLiquiditySufficientForChain` — `getReserves()` on V2, QuoterV2 reference-amount probe on V3, against a per-chain native threshold.
5. `checkTokenMetadataForChain` — name, symbol, decimals.
6. `simulateSwapForChain` — V2 `getAmountsOut` or V3 `quoteExactInputSingle`.
7. `hasHighTransferTaxForChain` — simulated buy then simulated sell, comparing expected vs observed balance delta.
8. `hasMaxWalletOrTxLimitsForChain` — bytecode heuristics for max-tx / max-wallet revert patterns.

A `simulateSellForChain` (or `simulateSellV3ForChain` for V3) also runs before the parallel bank as a hard gate — if the sell path doesn't work in simulation, the buy is aborted regardless of the other checks.

### MEV-protected execution
- **Ethereum:** `FlashbotsBundleProvider` signs the bundle with a dedicated `FLASHBOTS_AUTH_KEY` and targets the next two blocks.
- **BSC:** Hand-rolled JSON-RPC client posting to bloXroute's `bsc_private_tx` method with an `Authorization` header from `BLOXROUTE_AUTH_HEADER`.
- **Base / Arbitrum:** Direct `wallet.sendTransaction()` with chain-appropriate fee data. Neither chain has a mainstream private relay, so this is a deliberate passthrough.

Each strategy implements a two-method `MevStrategy` interface (`healthCheck`, `sendTransaction`). Health is checked once at startup and then every five minutes.

### Exit engine (`src/exitEngine.ts`)
A single 5-second polling interval per open position runs through this order:

1. **Stop-loss** at `STOP_LOSS_PCT` below entry (default 25%). Active only before trailing activates.
2. **Partial tiers** configured via `PARTIAL_SELL_TARGETS="2x:50,5x:25"` — sell 50% at 2x and 25% at 5x. Simultaneous tiers are coalesced into one transaction. Executed indices persist so restarts don't re-sell.
3. **Trailing stop** activates at 2x. Pullback is base `TRAILING_STOP_PCT` (default 15%) multiplied by a volatility factor (CoV over the last 60 samples, baseline 0.03) and tightened by an urgency factor. Bounded by `TRAILING_MIN_PCT` / `TRAILING_MAX_PCT`.
4. **Urgency escalator** — linear decay over 30 minutes that first tightens the trailing stop, then hard-exits the position at market.

A `(chainName, tokenAddress)` mutex in `exitManager.ts` guarantees that when two triggers fire in the same tick, only one sell leaves the process. Sell revenue is decoded from receipts by `receiptDecoder.ts`, which understands both the WETH `Withdrawal` pattern (V2 routers that unwrap) and the direct WETH `Transfer` pattern.

### Risk manager (`src/riskManager.ts`)
Five gates evaluated in `canSnipe` before any safety API is even called:

- **Position size** — hard reject if `snipeAmount > MAX_POSITION_SIZE`.
- **Daily realized loss** — rolling 24-hour loss per chain, compared against `-(chain.maxCapital × DAILY_LOSS_PCT / 100)`. Blocks new entries without disturbing open exits.
- **Open positions** — global count vs `MAX_OPEN_POSITIONS`.
- **Per-chain cooldown** — in-memory `Map<chainName, lastSnipeTs>` debounces successive snipes per chain by `SNIPE_COOLDOWN_MS`; different chains stay independent.
- **Total exposure** — `getTotalExposure` sums pending buys net of partial-sell proceeds; rejects when adding the new snipe would exceed `MAX_TOTAL_EXPOSURE`.

### Dashboard control plane
`src/api/server.ts` wires Express 5 + `ws`:

- `GET /health` — unauthenticated liveness, reports chain statuses and Telegram status.
- `POST /api/auth/login` — exchange `DASHBOARD_API_KEY` for a signed session cookie.
- `GET /api/positions` — live positions with on-demand price fetches from the chain.
- `GET /api/trades` — paginated history with CSV export.
- `GET /api/risk/summary`, `GET /api/risk/exposure` — aggregated risk state.
- `GET /api/chains/*` — per-chain status; `POST` variants to pause/restart listeners.
- `POST /api/controls/pause-snipes` — runtime kill-switch for new entries. Does not tear down exit monitors.
- `GET /ws` — WebSocket stream; broadcasts `positions_update` every 5 seconds when clients are connected, plus severity-tagged notifications pushed by the notifier.
- A built SPA served from `dashboard/dist/` (if present) with an `index.html` catch-all for client-side routing. Missing build falls back to a 404 JSON rather than crashing.

Middleware stack (in order): `express.json`, `cookie-parser`, `helmet` (CSP disabled for the SPA), `cors` (credentials on). Default bind `127.0.0.1:8080`.

### Telegram integration
- **Outbound:** `src/utils/notifier.ts` sends Markdown alerts via the Bot API for snipes, rejections, buys, sells, risk blocks, and WS/MEV health events.
- **Inbound:** `src/telegramListener.ts` runs a full MTProto client (`telegram` package) authenticated with a session string. Whitelists from `TELEGRAM_ALLOWED_SENDERS` and `TELEGRAM_ALLOWED_CHANNELS` gate every incoming message.
- **Alpha routing:** `src/alphaDrop.ts` extracts `0x[a-fA-F0-9]{40}` addresses from the message body and, for each enabled chain, calls `provider.getCode()` to figure out which chain the contract actually lives on before routing the candidate into the same pipeline the factory listener uses.

---

## Data Model

Two SQLite tables in `./data/bot.db` (WAL mode, `better-sqlite3`, prepared statements, synchronous NORMAL):

### `trades` (schema v4)
| Column | Notes |
|---|---|
| `id` | PK |
| `token` | `COLLATE NOCASE` |
| `chain` | `eth` / `bsc` / `base` / `arb` |
| `action` | `buy` / `sell` / `partial_sell` / `fail` |
| `tx_hash`, `block`, `timestamp` | on-chain provenance |
| `amount_in`, `amount_out` | native and token amounts as strings to preserve BigInt precision |
| `gas_cost`, `price_at_action` | decoded from the receipt |
| `status` | `pending` / `sold` / `failed` |
| `pool_type`, `fee_tier`, `dex_name` | V2/V3 discriminator, V3 fee tier (bps), DEX identity |

Hot-path indices cover `token`, `chain`, `timestamp`, and `status`.

### `exit_state` (schema v3)
| Column | Purpose |
|---|---|
| `trade_id` | FK into `trades` |
| `entry_price` | reference for stop-loss |
| `high_water_mark` | drives trailing stop, never reset across partial sells |
| `trailing_activated` | boolean (integer) — latches at 2x |
| `partial_tiers_completed` | JSON array of tier indices already executed |
| `original_token_amount` | BigInt-as-string snapshot for tier sizing |
| `urgency_start_ts` | anchor for the age escalator |
| `volatility_samples` | JSON circular buffer of recent prices |

Migrations are additive and run on every startup, advancing from v1 → v4.

---

## Tech Stack

- **Language:** TypeScript 5.8, strict mode, ES2022 target.
- **Runtime:** Node.js via `ts-node`; compiles cleanly to `dist/` with `npm run build`.
- **Chain I/O:** `ethers` v6.16 — fully on the v6 API, with a negative test that fails the build on v5 patterns.
- **State:** `better-sqlite3` 12.8 with WAL and prepared statements.
- **MEV:** `@flashbots/ethers-provider-bundle`; a hand-rolled bloXroute client.
- **HTTP / realtime:** Express 5, `ws` 8, Helmet, CORS, cookie-parser.
- **Telegram:** `telegram` (MTProto) for inbound; Bot API over HTTPS for outbound.
- **Logging:** `pino` structured JSON with per-module child loggers; `pino-pretty` for dev.
- **External APIs:** `axios` for honeypot.is, GoPlus, Unicrypt, Mudra.
- **Testing:** `vitest` 4 with three project profiles (unit, integration, fork) and a 70% coverage floor enforced by `@vitest/coverage-v8`.
- **Solidity (optional, dev only):** Hardhat toolbox + TypeChain for fork-based contract tests.

---

## Security and Production Considerations

- **Key handling.** Trading private key and Flashbots auth key are separate env vars; neither is ever written to disk by the bot.
- **Dashboard auth.** Everything under `/api` except `/api/auth/login` requires a signed session cookie. Default bind is `127.0.0.1:8080` — exposing remotely requires deliberately setting `DASHBOARD_HOST`. Helmet and CORS (credentials on) are applied globally.
- **Chain-ID verification.** Every chain's provider is checked against its expected chainId at startup; mismatched chains are dropped with a fatal log rather than used.
- **Startup health checks.** MEV relay health is probed per chain at boot and every 5 minutes thereafter. An unreachable relay surfaces a Telegram alert but does not crash the process.
- **Runtime kill-switch.** `POST /api/controls/pause-snipes` stops new entries without touching in-flight exit monitors.
- **Restart safety.** The exit engine's state is persisted after every meaningful transition. On reboot, `resumeMultiChainMonitoring` reads pending positions from `trades`, reconstructs DEX context from `pool_type` + `fee_tier`, and re-arms the monitor without re-selling completed tiers.
- **Graceful shutdown.** `SIGINT` / `SIGTERM` close the API server, disconnect Telegram, clear all timers, destroy WebSocket providers, and close the DB handle. A 5-second force-exit timer (`setTimeout … .unref()`) prevents a hung shutdown.
- **Observability.** Every module logs structured JSON through a named pino child — `{module, chain, dex, token}` fields make log shipping and chain-scoped filtering trivial.
- **Input validation.** Required env vars are enforced at startup. Per-chain RPC URLs fall back to the legacy `ALCHEMY_URL` when unset but never to a wrong chainId.

---

## Project Structure

```
src/
  bot.ts                Orchestrator: startup, per-chain WS/HTTP listeners,
                        reconnect, resume, graceful shutdown, V2 + V3 handlers
  chainRegistry.ts      Chain templates (eth/bsc/base/arb), DEX list,
                        ChainContext factory, buildChainRegistry
  config.ts             Env parsing, required-var validation, legacy CONFIG
  exitEngine.ts         Stop-loss, partial tiers, trailing stop, urgency,
                        volatility calc, resume, sell-lock coordination
  riskManager.ts        Five risk gates, cooldown map, exposure accounting
  alphaDrop.ts          Telegram-sourced candidate router with chain detection
  telegramListener.ts   MTProto client, sender/channel ACL, address extraction
  api/
    server.ts           Express + HTTP + WS factory, middleware order, 5s broadcast
    routes/             health, auth, positions, trades, risk, chains, controls
    middleware/         authMiddleware (cookie), errorMiddleware
    ws/                 upgrade handler, broadcaster + client registry
    helpers/positions.ts  on-demand price fetch for dashboard rows
  utils/
    db.ts               SQLite (WAL, prepared stmts, v1→v4 migrations)
    tokenSafety.ts      Eight-stage pipeline (legacy + per-chain variants)
    txManager.ts        Swap dispatch, retries, MEV strategy factory
    exitManager.ts      Timer registry, sell-lock mutex
    mevStrategies/      flashbots.ts, bloxroute.ts, passthrough.ts, types.ts
    safetyProviders/    goplus.ts, honeypotIs.ts, unicrypt.ts, mudra.ts, types.ts
    provider.ts         JsonRpcProvider / WebSocketProvider singletons + recovery
    gasManager.ts       EIP-1559 vs legacy fee data, per-chain multiplier
    receiptDecoder.ts   WETH Withdrawal / Transfer log parsing for sell revenue
    pairDiscovery.ts    Legacy single-chain pair lookup helper
    notifier.ts         Telegram outbound + WS-bridged severity alerts
    retry.ts            Exponential-backoff wrapper for HTTP calls
    abis.ts             ERC20, V2 Factory/Router/Pair, V3 Factory/Router/Quoter/Pool
    blocklist.ts        Hardcoded token + pair blocklist Sets
    logger.ts           pino factory + child-logger helper
  scripts/              e.g. addLiquidity.ts, deploySepoliaTest.ts (Hardhat ops)

dashboard/              React/Vite SPA source and build output (served from dist/)
contracts/              Solidity (Hardhat) — optional dev surface
test/
  unit/                 19 files: schema, risk, exit-engine branches, safety,
                        ethers v6 invariants, chain registry, config, v3 ABIs
  integration/          exit monitor, MEV strategies, txManager retries,
                        WS reconnect, full API suite under api/
  fork/                 Hardhat mainnet-fork scaffolding
  fixtures/, helpers/
```

---

## Configuration

All configuration is environment-driven. `.env.example` lists every supported variable. Main groups:

- **Wallet:** `PRIVATE_KEY` (required).
- **Chains:** `ENABLED_CHAINS` (default `eth`) plus per-chain `*_RPC_URL`, `*_WS_URL`, `*_SNIPE_AMOUNT`, `*_MAX_CAPITAL` for `ETH`, `BSC`, `BASE`, `ARB`.
- **MEV:** `FLASHBOTS_AUTH_KEY` (ETH), `BLOXROUTE_AUTH_HEADER` (BSC).
- **Risk:** `MAX_POSITION_SIZE`, `MAX_OPEN_POSITIONS`, `MAX_TOTAL_EXPOSURE`, `DAILY_LOSS_PCT`, `SNIPE_COOLDOWN_MS`.
- **Exits:** `STOP_LOSS_PCT`, `TRAILING_STOP_PCT`, `TRAILING_MIN_PCT`, `TRAILING_MAX_PCT`, `PARTIAL_SELL_TARGETS`.
- **Telegram outbound:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Telegram inbound:** `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, optional `TELEGRAM_ALLOWED_SENDERS` / `TELEGRAM_ALLOWED_CHANNELS`.
- **Dashboard:** `DASHBOARD_API_KEY`, `DASHBOARD_PORT` (8080), `DASHBOARD_HOST` (127.0.0.1).
- **Infra:** `LOG_LEVEL`, `DB_PATH`.

---

## Running

```bash
# install
npm install

# configure
cp .env.example .env    # fill in PRIVATE_KEY, RPC URLs, API keys

# run (development)
npx ts-node src/bot.ts

# run (compiled)
npm run build
node dist/bot.js
```

Tests:

```bash
npm test                 # all three projects
npm run test:unit
npm run test:integration
npm run test:fork
npm run test:coverage    # HTML report in coverage/
```

---

## Testing

`vitest.config.ts` defines three profiles:

- **unit (19 files)** — schema + migration, risk gates, exit-engine branches (including zero-balance recovery and the dedicated sell path), safety-check dispatch, receipt decoding, chain registry validation, config parsing, V3 ABI shape invariants, and ethers v6 surface assertions (negative test against v5 patterns, toolbox config pin).
- **integration** — the full exit monitor loop driven by mocked prices, MEV strategy health-check + submit behavior, `txManager` retry and nonce-increment paths, WebSocket reconnect scenarios, and a complete Express endpoint suite under `test/integration/api/`.
- **fork** — Hardhat mainnet-fork scaffolding for contract-level verification.

Coverage thresholds are set to 70% lines / functions / branches / statements. The test suite asserts structural invariants (ethers version, required env enforcement, schema migration ordering) alongside business logic, which is uncommon for a bot project.

---

## Extensibility

The seams where adding new functionality does not require touching unrelated code:

- **New chain.** Add a template to `CHAIN_TEMPLATES` in `chainRegistry.ts`, wire a `createMevStrategy` branch if the chain needs something other than passthrough, and optionally register safety providers. Everything downstream reads from `ChainContext`.
- **New DEX.** Append a `DexConfigV2` or `DexConfigV3` to the chain's `dexes`. Discovery, safety, swap construction, and the exit engine already branch on the `isDexV2` / `isDexV3` type guards.
- **New MEV relay.** Implement `MevStrategy` (`healthCheck`, `sendTransaction`) and slot it into the `createMevStrategy` factory.
- **New safety provider.** Implement `HoneypotCheckFn` or `LiquidityLockCheckFn` and reference it by name in a chain's `safetyApis`.
- **New exit rule.** The exit engine's trigger evaluation is ordered and idempotent; an additional predicate sits alongside the existing four and, if it needs persistence, adds a column to `exit_state` with a new migration.

---

## Summary

This project treats algorithmic DEX trading as a systems problem rather than a single script: a typed multi-chain registry, pluggable per-chain MEV transport, a layered safety pipeline with per-chain adapters and simulation fallbacks, a real risk manager with rolling-window loss accounting and portfolio-level exposure, persistent exit state with volatility-adaptive trailing logic, a secured local control plane with a SPA and WebSocket feed, and a test suite that asserts structural invariants — ethers version, schema migrations, MEV strategy contracts — alongside business behavior.

Every claim in this README is grounded in code that currently lives in `src/`. No feature is described that isn't implemented.
