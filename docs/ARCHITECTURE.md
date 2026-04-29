<!-- generated-by: gsd-doc-writer -->
# Architecture

## System Overview

`crypto-snipe-bot` is a multi-chain token sniping engine for EVM-compatible blockchains, built in TypeScript on `ethers.js` v6. It detects newly created liquidity pools across Ethereum, BSC, Base, and Arbitrum in real time, validates each candidate token through a layered risk and safety pipeline, dispatches MEV-protected buy transactions through chain-specific strategies, and manages open positions through concurrent exit monitors with a SQLite-backed durable state store. The architecture is **layered and event-driven**: factory event listeners (and optional Telegram alpha-drop signals) are the inputs, a synchronous validation pipeline enforces risk and safety preconditions, a strategy-pattern transaction layer executes trades, and a separate exit engine manages open positions until liquidation. A React + Vite dashboard served by an Express + WebSocket API on the same Node process provides observability and manual controls.

## Component Diagram

```
            ┌──────────────────────────────────────────────────────┐
            │                  Event Sources                        │
            │   Factory listeners (V2/V3, WS+HTTP)                  │
            │   Telegram signal listener (alphaDrop.ts)             │
            └────────────────────────┬─────────────────────────────┘
                                     │
                                     ▼
            ┌──────────────────────────────────────────────────────┐
            │           Risk Manager (riskManager.ts)              │
            │   5 rules · DB-backed positions/exposure/loss        │
            └────────────────────────┬─────────────────────────────┘
                                     │ pass
                                     ▼
            ┌──────────────────────────────────────────────────────┐
            │        Token Safety Pipeline (utils/tokenSafety)     │
            │   Sell-sim hard gate → 8 parallel checks             │
            │   Adapters: utils/safetyProviders/{honeypotIs,       │
            │   goplus, unicrypt, mudra}                           │
            └────────────────────────┬─────────────────────────────┘
                                     │ all pass
                                     ▼
            ┌──────────────────────────────────────────────────────┐
            │   TX Execution (utils/txManager + gasManager)        │
            │   MEV strategy dispatch:                              │
            │     flashbots (ETH) · bloxroute (BSC) ·              │
            │     passthrough (Base, Arb)                           │
            └────────────────────────┬─────────────────────────────┘
                                     │
                                     ▼
            ┌──────────────────────────────────────────────────────┐
            │       Exit Engine (exitEngine.ts)                    │
            │   Trailing stop · partial sells · stop-loss · timed  │
            │   Per-token sell mutex (utils/exitManager)           │
            │   exit_state persistence (utils/db)                  │
            └────────────────────────┬─────────────────────────────┘
                                     │
                                     ▼
            ┌──────────────────────────────────────────────────────┐
            │   Persistence + Observability                        │
            │   SQLite (better-sqlite3, WAL mode)                  │
            │   Pino structured logs · Telegram alerts             │
            │   Express + WS dashboard API (src/api/)              │
            └──────────────────────────────────────────────────────┘
```

The chain registry (`chainRegistry.ts`) is a cross-cutting concern: every component above receives a `ChainContext` (chain config + HTTP/WS providers + wallet + child logger) rather than reading globals.

## Data Flow

A typical snipe flows through the system as follows:

1. A V2 factory `PairCreated` event (or V3 `PoolCreated` event) fires on a WebSocket subscription created in `src/bot.ts`. If WebSocket is unavailable, an HTTP polling fallback is used. Alternatively, `src/telegramListener.ts` receives a contract address from a whitelisted sender and `src/alphaDrop.ts` injects it into the same handler.
2. The handler builds a candidate `{ chain, token, pair, dex }` record and calls `canSnipe()` in `src/riskManager.ts`. Five rules are evaluated against DB-derived state (open positions, total exposure, daily realized loss, per-chain cooldown, optional per-trade cap). Failures short-circuit before any external API calls are made.
3. If allowed, the handler invokes the safety pipeline in `src/utils/tokenSafety.ts`. The chain-aware variants (`*ForChain`) route external calls through `src/utils/safetyProviders/` adapters chosen by the chain's `SafetyApiConfig`. The sell simulation runs first as a hard gate; the remaining eight checks run in parallel.
4. On a clean pass, the bot constructs a swap transaction (V2 router or V3 `SwapRouter02` multicall), applies per-chain gas parameters from `src/utils/gasManager.ts`, and delegates submission to `sendTxWithRetry()` in `src/utils/txManager.ts`. That function selects the chain's MEV strategy via `createMevStrategy()` and calls its `sendTransaction()` method.
5. On a successful receipt, `insertTrade()` writes a `buy` row to the `trades` table (status `pending`) and `recordSnipe()` updates the per-chain cooldown timestamp. `startExitMonitor()` in `src/exitEngine.ts` opens a polling loop for the position and persists the initial `exit_state` row.
6. The exit monitor polls price every `pollIntervalMs` (default 15s). Trailing stop, stop-loss, partial-sell tiers, and timed-urgency triggers all evaluate against the same price snapshot. The first trigger to fire calls `tryAcquireSellLock()`; only the lock-holder executes a sell, and `clearAllTimersForToken()` cancels any other timers for that `chain:token` key.
7. Receipts are decoded by `src/utils/receiptDecoder.ts`, the matching trade row is updated to `sold`/`failed`, and a Telegram alert is dispatched via `src/utils/notifier.ts`. Realized P&L is computed on read by the risk manager and the dashboard from the trade ledger; it is not stored.

The dashboard API (`src/api/server.ts`) consumes the same SQLite database and chain contexts. WebSocket clients receive broadcast events from `src/api/ws/broadcaster.ts`.

## Key Abstractions

The most important interfaces and modules, with file locations:

- **`ChainConfig` / `ChainContext` / `buildChainRegistry()`** — `src/chainRegistry.ts`. Single source of truth for per-chain RPC URLs, DEX list, MEV strategy, safety provider routing, gas model, and capital limits. Emits typed `ChainContext` objects consumed by every other layer.
- **`DexConfig` discriminated union (`DexConfigV2 | DexConfigV3`)** — `src/chainRegistry.ts`. Compile-time DEX type safety; narrow with `isDexV2()` / `isDexV3()` before accessing v2-only `routerAddress` or v3-only `swapRouterAddress` / `quoterAddress`.
- **`MevStrategy` interface** — `src/utils/mevStrategies/types.ts`. Implementations: `flashbots.ts`, `bloxroute.ts`, `passthrough.ts`. Each provides `name`, `healthCheck()`, and `sendTransaction()`.
- **Safety provider adapters** — `src/utils/safetyProviders/{goplus,honeypotIs,unicrypt,mudra}.ts` with shared types in `types.ts`. Adapters present a uniform signature regardless of upstream API shape.
- **`tokenSafety` module** — `src/utils/tokenSafety.ts`. Exposes legacy single-chain helpers (`checkHoneypot`, `simulateSell`, …) and chain-aware variants (`checkHoneypotForChain`, `simulateSellForChain`, `simulateSellV3ForChain`, …).
- **`riskManager.canSnipe()` / `recordSnipe()`** — `src/riskManager.ts`. Returns a `RiskCheckResult { allowed, reason?, details? }` object rather than a bare boolean so callers can route reasoned rejections to alerts.
- **Exit engine** — `src/exitEngine.ts` (`startExitMonitor`, `resumeExitMonitor`, `ExitConfig`, `ExitStateData`). Pairs with `src/utils/exitManager.ts`'s sell mutex (`tryAcquireSellLock` / `releaseSellLock`) and timer registry (`registerExitMonitor` / `clearAllTimersForToken`).
- **Database layer** — `src/utils/db.ts`. Exports the `db` singleton plus prepared-statement helpers (`insertTrade`, `updateTradeStatus`, `getOpenPositionCount`, `getTotalExposure`, `getDailyRealizedLoss`, `upsertExitState`, etc.). Schema is versioned (current version 4) with migrations applied at startup.
- **Provider cache** — `src/utils/provider.ts`. Singleton HTTP/WebSocket provider factories keyed by chain so listeners and the wallet share a single connection per RPC URL.
- **API server factory** — `src/api/server.ts` (`startApiServer`). Composes Express middleware, route routers, and the WebSocket upgrade handler; returns a `{ close() }` handle for graceful shutdown.

## Directory Structure Rationale

The repository is split between the bot runtime (`src/`), the React dashboard (`dashboard/`), Solidity test contracts (`contracts/`), and the Vitest test suites (`test/`). Within `src/`, top-level files own orchestration concerns and `src/utils/` owns reusable infrastructure.

```
src/
├── bot.ts                Main orchestrator: starts listeners, owns the buy handler,
│                         resumes monitoring on startup, wires shutdown handlers.
├── chainRegistry.ts      Cross-cutting chain config registry (DEXes, MEV, safety,
│                         gas, capital). Emits ChainConfig and ChainContext.
├── config.ts             Environment variable specs, dotenv loading, legacy defaults.
├── riskManager.ts        Five-rule pre-snipe gate with DB-derived state.
├── exitEngine.ts         Smart exit engine: trailing stops, partial sells, stop-loss,
│                         timed urgency, volatility tracking.
├── exitEngine.ts         (re-exports startExitMonitor/resumeExitMonitor)
├── telegramListener.ts   Telegram client API listener with sender/channel whitelist.
├── alphaDrop.ts          Adapter that routes Telegram-supplied addresses into the
│                         standard snipe handler.
├── api/                  Express + WebSocket dashboard API (server, routes,
│                         middleware, ws handler/broadcaster, helpers).
├── scripts/              Operator utilities (e.g., addLiquidity.ts, deploySepoliaTest.ts).
└── utils/                Reusable infrastructure:
    ├── abis.ts                 Centralized ABI constants (V2/V3 factory, router, ERC20…)
    ├── blocklist.ts            Static known-bad token / pair registry.
    ├── db.ts                   SQLite singleton, schema migrations, prepared statements.
    ├── exitManager.ts          Per-token sell mutex and timer registry.
    ├── flashbots.ts            Flashbots bundle provider wrapper.
    ├── gasManager.ts           Per-chain gas pricing (EIP-1559 / legacy).
    ├── logger.ts               Pino structured JSON logger with child-logger pattern.
    ├── notifier.ts             Telegram Bot API alert dispatch.
    ├── pairDiscovery.ts        Token → pair address resolution helpers.
    ├── provider.ts             Singleton HTTP/WS provider cache.
    ├── receiptDecoder.ts       Transaction receipt parsing (gas cost, swap output).
    ├── retry.ts                Exponential backoff retry wrapper.
    ├── tokenSafety.ts          Nine-stage safety validation.
    ├── txManager.ts            MEV strategy factory + retry-aware TX submission.
    ├── mevStrategies/          MevStrategy implementations + shared types.
    └── safetyProviders/        External safety API adapters + shared types.

dashboard/                React 19 + Vite + Tailwind SPA built into dashboard/dist/,
                          served as static files by the API server.
├── src/components/       Reusable UI (charts, tables, status indicators, dialogs).
├── src/pages/            Top-level views (Overview, RiskExposure, TradeHistory,
│                         ChainControls, Login).
├── src/hooks/            React hooks for API/WebSocket state.
├── src/utils/            Client-side helpers.
└── src/types/            Shared TypeScript types.

contracts/                Solidity test fixtures (FakeToken, UniswapV2Factory,
                          UniswapV2Router02) and interfaces; compiled via Hardhat.
test/                     Vitest projects:
├── unit/                 Pure-function and module unit tests.
├── integration/          Multi-module + API integration suites.
└── fork/                 Mainnet-fork tests (setup.ts / teardown.ts bracket them).
```

This layout enforces three boundaries that map to the runtime architecture:

- **`src/utils/` is leaf-level infrastructure** that knows nothing about orchestration. Anything that needs to be reusable (gas, providers, DB, ABIs, retries, MEV strategies, safety providers) lives here so `bot.ts`, `exitEngine.ts`, and the API can compose it without circular imports.
- **`src/api/` is a self-contained HTTP/WS surface** that depends on `chainRegistry` and `utils/db` only — the same way an external consumer would. The bot can be run with the dashboard disabled by simply not invoking `startApiServer()`.
- **`dashboard/` is an independent npm project** with its own `package.json`, `tsconfig.json`, and Vite build. It produces static assets that the API server picks up at runtime; there is no build-time coupling between the two TypeScript projects (the bot uses `tsconfig.bot.json` which excludes the dashboard sources).
