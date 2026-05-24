# Crypto Snipe Bot

Multi-chain EVM token-launch sniper with on-chain pre-buy safety probes, chain-aware MEV-protected execution, and a unified state-machine exit engine. Written in TypeScript on top of ethers v6, persisted to SQLite, fronted by a React/Express operator dashboard.

## Overview

`crypto-snipe-bot` listens for new Uniswap-style liquidity events across four EVM mainnets — Ethereum, BSC, Base, and Arbitrum — runs each candidate token through a parallel bank of on-chain and third-party safety probes, and for survivors submits a buy through the chain-appropriate MEV-protected transaction path: Flashbots bundles on Ethereum, bloXroute private transactions on BSC, and direct submission through the natively-private mempools on Base and Arbitrum. After a buy, a single unified exit engine polls each position every 5 seconds and dispatches partial sells, trailing-stop sells, stop-loss sells, or time-urgency market sells. State is persisted to local SQLite in WAL mode with a full trade audit trail and computed P&L. An operator dashboard (React 19 + Vite + Tailwind 4 served by Express 5) shows live positions, P&L, risk gauges, chain controls, and an emergency-sell-all button. A separate Telegram MTProto listener pipes contract addresses from "alpha drop" channels into the same buy pipeline.

The bot is intentionally **single-operator**. There is no multi-tenant story, no SaaS frontend, no public API. The dashboard binds to `127.0.0.1` by default and is authenticated by a single shared API key plus a UUID session cookie. The audience for this README is engineers and technical interviewers, not end users.

What makes the project interesting from an engineering perspective: chain abstraction via TypeScript discriminated unions with exhaustive `never` checks, three different MEV submission strategies behind one interface, an immutable eth_call-only Solidity contract under active Slither + Mythril CI audit, a restart-survivable exit state machine with per-token sell mutex, and a careful "vacuous-pass guard" baked into the `HoneypotResult` type so the v6.16 silent-pass bug cannot reoccur by construction.

## Status Snapshot

**Shipped today:** the four-chain multi-DEX detection pipeline, the 8-call parallel safety bank, the 5-rule risk gate, the unified exit engine with partial tiers + trailing stop + volatility-adjusted urgency + state persistence, the receipt decoder + computed P&L, the operator dashboard with WebSocket push, the Telegram alpha-drop listener, and the SIGINT/SIGTERM graceful-shutdown sequence with a 5s force-exit safety net.

**Mid-rollout (v6.17 defensive-hardening milestone):** the pre-buy honeypot sell-simulation rebuild is shipped on Ethereum and pending deploy on BSC/Base/Arb. The on-chain `HoneypotChecker.sol` contract is **audited** (Slither + Mythril clean, 2026-05-15), the audit gate is **live in CI** on every `contracts/**` change, and the contract is **deployed on Ethereum mainnet** at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`. Plan 18-09 wired the real `simulateViaContractV2` / `simulateViaContractV3` adapter implementations in `src/utils/honeypot/checkerContract.ts`; plan 18-10 wired the runtime gate at `src/bot.ts` (V2 line 232 and V3 line 459) and added the HONEY-12 bytecode mutability scan to both parallel safety banks. ETH snipes are now gated by the on-chain HoneypotChecker; BSC/Base/Arb chain deploys are pending plan 18-08.

The old V2 and V3 sell-simulation entry points in `src/utils/tokenSafety.ts` were documented broken-by-design stubs that the rebuild has now replaced.

**Shipped in v6.17 Phase 19:** anti-rug runtime monitoring. Single-listener-per-chain WebSocket subscription to V2 `Pair.Burn` / LP `Transfer→0xdEaD` + V3 `Pool.Burn` / `Pool.Collect`; multi-signal AND-chain trigger (LP removed >50% AND destination not in allowlist AND reserves/sell-sim below threshold); per-chain dry-run mode with three-channel telemetry; per-chain circuit breaker; bridge to `executeFullSell` with 2.0× elevated gas; full operator handoff at `docs/operations/anti-rug-rollout.md`. **DEFAULT IS DRY-RUN** on every chain — per-chain live-mode graduation requires 7 calendar days dry-run + zero confirmed false positives + an explicit `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` `.env` flip + bot restart.

**Shipped in v6.17 Phase 20:** going-live ops hardening. Fail-closed preflight at startup (`src/preflight.ts` — seven per-chain checks plus cross-env validator); multi-stage kill-switch at three V2 + three V3 checkpoints; SQLite-persisted global pause flag (`pause_state` table) that survives restart; mid-run wallet undercut detector that auto-pauses; `npm run preflight | pause | resume` operator CLIs; dashboard pause banner; and a consolidated operator runbook at [`docs/operations/going-live.md`](./docs/operations/going-live.md) (moved atomically from the repo root with a CI guard against re-creation). Phase 21 EXIT-LIVE items are a list of v6.16 features that were validated only in tests during the previous milestone and need real-mainnet validation.

## Key Features

### Multi-Chain Detection & Execution

- WebSocket-first listener on `PairCreated` (V2) and `PoolCreated` (V3) events for every configured DEX on every enabled chain, with exponential-backoff reconnect from 1s to a 60s cap and full re-subscription on socket close.
- HTTP-polling fallback at a 2s interval when no WebSocket URL is configured for a chain. The runbook warns this misses most real launches.
- V3 `waitForLiquidity` subscribes to `Mint` with a 30s deadline and also checks the same block first, because atomic launch scripts often emit `PoolCreated` and `Mint` in a single block.
- V3 minimum-liquidity check using a `QuoterV2.quoteExactInputSingle` reference quote plus a threshold quote.
- Per-chain `chainId` validation at startup; chains whose RPC returns a mismatched chainId are skipped, not fatal.
- Entry point is `npx ts-node src/bot.ts`, which runs the file's bottom-of-module guard and calls `startMultiChainBot()`.

### Pre-Buy Safety Stack

- 8-call `Promise.all` parallel safety bank per candidate token, with any failure aborting the buy:
  - honeypot check (chain-aware: honeypot.is for ETH/Base, GoPlus for BSC/Arb)
  - liquidity-lock check (Unicrypt for ETH, Mudra for BSC, GoPlus + burn-percentage fallback elsewhere)
  - bytecode anti-bot selector scan
  - V2 pair reserve depth check (at least 1 native unit minimum)
  - token metadata sanity (symbol, name, decimals, plus optional `tradingEnabled()`)
  - buy-direction `staticCall` swap simulation roundtrip
  - transfer-tax probe (`getAmountsOut` vs actual swap static-call output, default 25% threshold)
  - max-wallet / max-tx limits probe across four standard ABI method names
- Already-sniped dedup, manual token/pair blocklist sets (plumbing exists; contents intentionally empty), and a `getCode`-non-empty contract check are run **before** the parallel bank, in fixed sequence.
- Risk gate runs between contract validation and the safety bank — see Risk Management below.
- Third-party safety APIs are wrapped behind per-provider adapters in `src/utils/safetyProviders/`; all fail-closed (any provider error blocks the buy).

### Risk Management

- 5-rule `canSnipe` gate, evaluated sequentially with first-failure-returns semantics. Each rule returns a structured `{allowed, reason?, details?}` for Telegram-friendly rejection messages:
  - Hard position-size cap (`MAX_POSITION_SIZE`)
  - Rolling 24h daily-loss circuit breaker per chain (`DAILY_LOSS_PCT` of that chain's `maxCapital`)
  - Global max open positions, summed across all chains
  - Per-chain snipe cooldown (in-memory map, deliberately resets on restart so a crash does not lock the bot out)
  - Portfolio total-exposure cap, computed as the sum of `amount_in − Σ partial_sell.amount_out` across all open positions
- `getPortfolioExposure()` returns total + per-chain breakdown for the dashboard's exposure donut.
- `recordSnipe(chain)` stamps the cooldown map after TX submission so the cooldown window starts from submission time, not from buy completion.

### Unified Exit Engine

- Single 5s `setInterval` per open position, in `src/exitEngine.ts`. Every poll cycle handles:
  - **Stop loss** — flat percentage below entry, active until trailing activates at 2× entry, after which it is disengaged.
  - **Partial sells** — env-configured tiers like `"2x:50,5x:25"` (sell 50% at 2× entry, then 25% of original at 5× entry). BigInt math over the original buy amount so dust does not drift. Validation rejects tier totals at or above 100%.
  - **Gap sells** — if price jumps past multiple unfilled tiers in one poll cycle, the engine emits a single combined sell rather than firing them serially.
  - **Trailing stop** — base percentage widened by a volatility multiplier (coefficient of variation across the most recent 12–60 price samples) and tightened by an age-weighted urgency multiplier (linear decay over the position's first 30 minutes), then clamped to a configured `[trailingMinPct, trailingMaxPct]` band.
  - **Time-urgency hard sell** — at age greater than 30 minutes the urgency multiplier hits zero, forcing a market sell regardless of price.
- Exit state is persisted to the `exit_state` SQLite table every poll cycle, so a restart resumes with the high-water mark, completed tiers, original token amount, urgency anchor, and volatility samples fully intact.
- Per-token sell mutex on composite `chain:token` keys (in `src/utils/exitManager.ts`) eliminates the same-tick double-sell race that single-threaded JavaScript otherwise permits.
- Force-sell and emergency-sell-all paths invoked from the dashboard always call `clearAllTimersForToken` before invoking `executeFullSell` so the interval cannot fire a duplicate sell mid-call.

### MEV-Protected Transaction Submission

- Flashbots bundle submission on Ethereum via `@flashbots/ethers-provider-bundle`, 3 retries with bumped nonce per attempt, real bundle tx hash returned (Phase 14 hardening defensively null-checks the bundle response).
- bloXroute `bsc_private_tx` JSON-RPC on BSC over `axios` with an `Authorization` header. The strategy's `healthCheck()` pings the endpoint with a benign call and inspects 401/403 codes.
- Direct submission with EIP-1559 fee data (legacy `gasPrice` fallback) on Base and Arbitrum, both of which expose natively private mempools that obviate Flashbots-style bundling. Three retries, `tx.wait(3)`.
- All three strategies sit behind one `MevStrategy` interface in `src/utils/mevStrategies/types.ts` and are dispatched by `createMevStrategy(chain)` in `src/utils/txManager.ts` with an exhaustive `never`-check on the discriminated `MevStrategyType` union.
- A recurring 5-minute MEV health check runs on each enabled chain and fans out Telegram alerts on degradation.

### Persistence & Audit Trail

- SQLite via `better-sqlite3` with WAL journal mode, NORMAL synchronous, and a 5s busy timeout. The DB file lives at `./data/bot.db` by default (overridable via `DB_PATH`).
- Schema migrations run automatically at module load and currently ladder up to version 4 — adding the `exit_state` table, the `pool_type` / `fee_tier` / `dex_name` columns on `trades`, and the legacy `chain='mainnet' → 'eth'` row normalization.
- One-shot legacy `.bot-state.json → SQLite` migration runs once on first boot and renames the JSON file to `.bak`.
- Full audit trail per trade: `tx_hash`, `block`, `gas_cost`, receipt-decoded `amount_out`, `pool_type`, `fee_tier`, `dex_name`, `chain`.
- P&L is computed, not stored — a single self-join over the `trades` table aggregates buy cost (plus gas) and pro-rates it across `sell` and `partial_sell` events. The same query powers the trades API and the dashboard P&L chart.

### Operator Dashboard

- React 19 + react-router-dom 7 SPA built by Vite 8 with Tailwind 4, served by Express 5 from `dashboard/dist/` after `npm run build`.
- Login screen using an httpOnly cookie session, 24h TTL, `timingSafeEqual` against `DASHBOARD_API_KEY` to prevent length-extension timing attacks.
- Overview page: stat cards for total P&L, open positions, exposure, and 24h P&L; a real-time positions table with force-sell buttons; live risk gauges; and an event feed that mirrors Telegram alerts.
- Trades page: paginated and filterable trade history (chain × date × `profit | loss | all` outcome) with CSV export that escapes the `= + - @ \t \r` prefix-attack vectors so a malicious token name cannot inject a spreadsheet formula.
- Risk page: cumulative-P&L line chart via `lightweight-charts` and an exposure-donut via `chart.js` + `react-chartjs-2`.
- Chain Controls page: per-chain status cards with masked RPC hostnames, stop/start buttons, warnings surfaced from the orchestrator's `onRestart` callback, and an Emergency Sell All button with confirmation dialog.
- WebSocket push: `positions_update` every 5s, on-event `chain_status_change`, and every Telegram alert fanned out as a `notification` with inferred severity and category.

### Telegram Integration

- Outbound bot alerts via the plain Telegram HTTP API over `axios`. `sendTelegramAlert`, `sendChainAlert`, and `sendCtxAlert` are the three entry points.
- Inbound MTProto user-account listener (GramJS / `telegram` 2.26.22) for alpha-drop channels. The listener greps each inbound message for every `0x[a-fA-F0-9]{40}` address, deduplicates the set, enforces a 5s cooldown across all addresses, applies sender/channel allowlists (OR-combined), and then for each address calls `getCode(address)` against every enabled chain context and forwards to the bot's handlers on chains where the contract exists.
- Telegram alerts are also fanned out to the dashboard WebSocket as typed notifications, with severity and category inferred from the message text.
- The Telegram listener is graceful — missing `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION` returns `{client: null, connected: false}` without aborting boot, so the bot can run factory-event-only.

### Smart Contract & Audit Pipeline

- `contracts/honeypot/HoneypotChecker.sol` is an immutable, stateless, eth_call-only revert-always Solidity contract that performs a pre-buy roundtrip simulation for both Uniswap V2 and V3 routers and encodes its verdict in a custom-error revert payload (`RoundtripResult(buyTaxBps, sellTaxBps, status)` for V2; `RoundtripResultV3(...)` for V3). The dispatcher decodes the error to extract the verdict; there is no state-changing call path.
- The contract has **no owner key, no proxy, no `killSwitch`, no `selfdestruct`, no `tx.origin` use**. The patch path is "deploy v2 at a new address and update env." This rejection of every conventional smart-contract escape hatch is what allows the audit-once-deploy-once model to hold.
- 3-bit status bitmap: `0x01` = sold-back-some-ETH, `0x02` = balance-nonzero-after-buy (catches lying `balanceOf`), `0x04` = sell-completed-without-revert. Caller must require `status === 0x07` to consider the token safe.
- Audited 2026-05-15: Slither 0.11.5 surfaced 13 medium+ findings (4 High + 9 Medium); all 13 were dispositioned **false-positive** against the eth_call-only revert-always design, with the disposition table preserved at `.planning/milestones/v6.17-honeypot-checker-audit.md`. Mythril 0.24.8 with `--execution-timeout 300 --max-depth 30` reported `success: true, issues: []`. Stop-the-Line determination: no escalation; deploy gate cleared.
- CI gate is live and evergreen: `.github/workflows/test.yml` uses `dorny/paths-filter@v3` to detect `contracts/**` changes, then runs three gated jobs (`hardhat-compile`, `slither`, `mythril`) that fail the build on any new medium+ finding. The Mythril severity gate is `scripts/check-mythril-report.ts` — a Node script that uses only `fs` and `process`, zero new npm deps.
- Deploy uses a capability-split `DEPLOY_PRIVATE_KEY` separate from the bot wallet's `PRIVATE_KEY` on the four production hardhat networks (`mainnet`, `bsc`, `base`, `arbitrum`); the existing `sepolia` network entry continues to use `PRIVATE_KEY` for test-only deploys.
- **Status: Shipped on ETH; other chains pending 18-08** — runtime wire-up at `src/bot.ts:232` (V2) / `:459` (V3) is live, and the real `simulateViaContractV2` / `simulateViaContractV3` implementations in `src/utils/honeypot/checkerContract.ts` shipped under plan 18-09. The dispatcher in `src/utils/honeypot/index.ts` routes between V2 + V3 paths AND between on-chain-contract + eth_simulateV1 methods. The ETH chain consumes the deployed checker contract at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`; BSC, Base, and Arb still return `verdict: 'unknown'` (no-deployed-address) until plan 18-08 deploys the checker there.

### Operational Hardening

- Graceful shutdown on SIGINT and SIGTERM: API close → Telegram disconnect → clear all exit timers → destroy WebSocket providers → close DB → `process.exit(0)`, all wrapped in a 5s force-exit safety net.
- Fail-loud env validation at startup — missing required env vars trigger `logger.fatal` plus `process.exit(1)` with a structured log record. The `<PREFIX>_MAX_BUY_TAX_BPS` / `<PREFIX>_MAX_SELL_TAX_BPS` env vars are range-validated `[0, 10000]` with NaN detection.
- 33 documented env vars in `.env.example`, mirrored in `REQUIRED_ENV_VARS` in `src/config.ts`.
- Chain-scoped pino child logger threaded through every `ChainContext`, so every log line carries the chain it came from.

## Technical Highlights

These are the architectural decisions that read well in interviews:

- **Discriminated-union chain and DEX abstractions.** `DexConfig = DexConfigV2 | DexConfigV3` and `MevStrategyType` are discriminated unions with exhaustive `never`-checks at every dispatch site. Adding a new chain or DEX type is a typed-template addition, not a refactor — and `tsc --noEmit` refuses to compile a missing branch.

- **Layered MEV strategy.** The bot mixes Flashbots bundles (ETH), bloXroute private transactions (BSC), and direct submission with EIP-1559 fee data (Base/Arbitrum) behind one `MevStrategy` interface and one `sendTxWithRetry` call site. Each strategy owns its own retry semantics, fee handling, and health-check protocol. The dispatch factory is a single discriminated switch.

- **`HoneypotResult` as a compile-gate vacuous-pass guard.** The v6.16 silent-pass bug — where a `{verdict: 'safe', evidence: {}}` literal flowed through a zero-balance short-circuit and bypassed honeypot detection — is impossible by construction in v6.17. The `safe` variant of `HoneypotResult` requires non-optional `buyTaxBps` and `sellTaxBps` numbers. TypeScript refuses to compile an empty-evidence pass.

- **Single source of truth for chain configuration.** `src/chainRegistry.ts` overlays static `CHAIN_TEMPLATES` with environment values, fails loud on bad input, and exposes a fully-typed `ChainContext` to every downstream consumer. The legacy single-chain `CONFIG` object in `src/config.ts` is vestigial — it remains only because the exit engine still reads trailing-stop tuning from it. Net effect: every consumer that needs chain configuration takes a `ChainContext`, and that context is built exactly once at boot.

- **Immutable, stateless, eth_call-only on-chain checker.** Every conventional smart-contract escape hatch is deliberately rejected — no owner, no proxy, no killSwitch, no selfdestruct, no tx.origin. This is the engineering stance that makes "audit once, deploy once" credible. Every audited Slither and Mythril finding is dispositioned on the record against this stance in `.planning/milestones/v6.17-honeypot-checker-audit.md`.

- **Capability-split deploy key.** `DEPLOY_PRIVATE_KEY` is a deliberately-scoped wallet that exists only to deploy the checker contract. The bot wallet's `PRIVATE_KEY` cannot push a new checker. If the bot wallet leaks, the attacker drains positions but cannot deploy a malicious checker at the trusted address.

- **Restart-survivable exit state machine.** The unified exit engine writes the full `ExitStateData` row to `exit_state` every poll cycle. On boot, `resumeMultiChainMonitoring` reconstructs every exit monitor by reading the open trades back out of SQLite, calling `getExitState(trade_id)`, and continuing from the persisted high-water mark, completed tiers, and volatility samples. The bot wears its own state correctly even after a SIGKILL.

- **Per-token sell mutex.** Composite `chain:token` key with check-and-set in a single event-loop tick. This eliminates the case where two interval callbacks both decide to sell in the same tick — which single-threaded JavaScript otherwise allows when both callbacks resolve their awaits at the same `process.nextTick` boundary.

- **Audit gate as evergreen CI invariant.** `dorny/paths-filter@v3` triggers the Slither and Mythril jobs on every `contracts/**` change. The Mythril severity gate is implemented with zero new npm deps (Node `fs` + `process` only) and exits non-zero on any new Medium or High issue.

- **Receipt-decoded P&L.** Every sell's `amount_out` is parsed from real receipt logs (WETH `Withdrawal` for V2, WETH `Transfer→wallet` for V3) with a single 2s retry if the receipt is not yet propagated. On permanent miss, the column is set to `null` rather than `0`, so the P&L view distinguishes "we do not know" from "the trade returned zero."

- **Defense-in-depth env handling.** `DASHBOARD_API_KEY` is validated at startup and re-validated at login time, so a hot-reload or test harness that mutates `process.env` mid-process cannot weaken the auth surface.

- **Formula-injection-safe CSV export.** `/api/trades/export` escapes the `= + - @ \t \r` prefix-attack vectors so a malicious token name cannot run a spreadsheet formula when an operator opens the file in Excel or Google Sheets.

## Architecture Overview

The runtime is a single Node 22 process with several internally-isolated subsystems. Imports drive the boot order: `src/config.ts` runs env validation and `dotenv.config()` at module load, `src/utils/db.ts` opens SQLite and runs schema migrations at module load, and then `src/bot.ts` invokes `startMultiChainBot()` from its bottom-of-module `require.main === module` guard. There is no application framework holding the pieces together — the orchestrator in `bot.ts` wires the chain registry, dex listeners, exit monitors, API server, Telegram listener, and shutdown handler into one process.

### Bot Orchestrator

`src/bot.ts` is the entry point (roughly 950 lines). It owns the multi-chain boot sequence:

- `buildChainRegistry()` parses `ENABLED_CHAINS`, validates each name against `{eth, bsc, base, arb}`, validates per-chain RPC URLs and MEV auth keys, parses and range-checks the tax-threshold bps, and resolves the `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` env per chain.
- For each enabled chain, `createChainContext(chain)` builds the HTTP + optional WS providers, the `Wallet`, and the chain-scoped pino logger. `provider.getNetwork()` is awaited and the chain is **skipped** (not fatal) on chainId mismatch — important when an operator accidentally points `ETH_RPC_URL` at a Goerli or Sepolia endpoint.
- An MEV strategy `healthCheck()` runs per chain (Flashbots key parse, bloXroute auth-header ping, or always-true passthrough).
- A per-DEX listener is started on each enabled chain's V2 `PairCreated` and V3 `PoolCreated` events, with the WebSocket-first reconnect logic or the HTTP-polling fallback.
- A recurring 5-minute MEV health check is scheduled; degradation fans out a Telegram alert.
- `resumeMultiChainMonitoring(contexts)` reattaches every open position's exit monitor (see "Restart and Resume Flow" below).
- The `onRestart(ctx)` closure used by the dashboard's stop/start buttons is constructed and captured.
- `startApiServer(contexts, onRestart, getTelegramStatus)` launches Express + WebSocket on `DASHBOARD_HOST:DASHBOARD_PORT`.
- `startTelegramListener(contexts)` connects the MTProto user-account client if all three env vars are present, gracefully returning `{client: null, connected: false}` otherwise.
- `initMultiChainShutdownHandler` installs the SIGINT/SIGTERM teardown sequence with a 5s force-exit safety net.

### Chain Registry & ChainContext

`src/chainRegistry.ts` is the source of truth for chain configuration. It defines the `ChainConfig` shape, the `DexConfig` discriminated union over `dexType: 'v2' | 'v3'`, the `MevStrategyType` and `GasConfig` shapes, and the `HoneypotCheckerConfig` block. `CHAIN_TEMPLATES` hardcodes router, factory, quoter, and swap-router addresses for ETH/BSC/Base/Arb. `buildChainRegistry()` overlays the templates with environment values (`ENABLED_CHAINS`, per-chain RPC URLs, capital, honeypot checker address, tax-threshold bps) and fails loud on missing required values or out-of-range bps. `createChainContext(chain)` produces the runtime `ChainContext` carrying HTTP and optional WebSocket providers, a Wallet, and a chain-scoped pino logger.

### MEV Strategy Layer

`src/utils/mevStrategies/` holds the three strategy implementations (`flashbots.ts`, `bloxroute.ts`, `passthrough.ts`) and the shared `MevStrategy` interface in `types.ts`. The dispatch factory `createMevStrategy(chain)` lives in `src/utils/txManager.ts` alongside `sendTxWithRetry(txBuilder, ctx | provider, ...)` which carries a dual signature for backward compatibility with the legacy single-chain code path.

### Safety Stack

`src/utils/tokenSafety.ts` is the parallel safety bank — ten `*ForChain` functions, eight of which are invoked together in a `Promise.all` per candidate. Each function dispatches to chain-specific providers via the `ChainContext`. The third-party API adapters live in `src/utils/safetyProviders/` (`honeypotIs.ts`, `goplus.ts`, `unicrypt.ts`, `mudra.ts`, plus a shared `types.ts`).

### Risk Gate

`src/riskManager.ts` exposes `canSnipe(chain, snipeAmount, maxCapital)` and `getPortfolioExposure()`. Each of the five rules is implemented as its own short function with its own DB query (or in-memory map for cooldown). The result type is `{allowed: boolean, reason?: string, details?: object}`, designed for direct rendering in Telegram alerts.

### Unified Exit Engine

`src/exitEngine.ts` (roughly 1100 lines) is the largest single file in the runtime. Exports include `startExitMonitor`, `resumeExitMonitor`, `executeFullSell`, `VolatilityTracker`, `parsePartialSellTargets`, `buildExitConfig`, `exitConfig` (singleton), and the pure helpers `computeUrgencyMultiplier` / `computeEffectiveTrailingPct` / `getUnfilledTiers` / `calculatePartialSellAmount` / `queryPrice` / `serializeExitState` / `deserializeExitState`. Volatility tracking is a sliding window of 12 to 60 price samples; urgency is a linear decay over 30 minutes starting from the position's `urgency_start_ts`.

### Persistence & Migrations

`src/utils/db.ts` holds the `better-sqlite3` singleton, the 4-version migration ladder, the legacy `.bot-state.json → SQLite` migration, prepared statements (`insertTrade`, `updateTradeStatus`, `isTokenSniped`, `upsertExitState`, `getExitState`, `deleteExitState`, `getOpenPositionCount`, `getTotalExposure`, `getDailyRealizedLoss`, `getTradeIdForPendingToken`), and the `getPnL()` and `getPnLChartData()` query builders.

### Dashboard API + WebSocket

`src/api/server.ts` assembles middleware (helmet, cors with credentials, cookie-parser, express.json), mounts routers in the strict order `health → auth → /api/* (gated) → static dashboard/dist/ → SPA catchall → error middleware`, and starts the 5s position-broadcast interval. WebSocket lives under `src/api/ws/` with `handler.ts` doing cookie-based upgrade auth and `broadcaster.ts` maintaining a `Set<WebSocket>` of authenticated clients and pushing typed `{type, data, timestamp}` JSON events.

### Telegram Listener

`src/telegramListener.ts` runs the MTProto user-account client. `src/alphaDrop.ts` is the routing helper that walks every DEX on a chain (V2 via `factory.getPair`, V3 across fee tiers `[500, 3000, 10000]` via `factory.getPool`) and forwards to `handleNewPairForChain` or `handleNewV3PoolForChain` from `bot.ts` via dynamic import (to break the circular dependency).

### Smart-Contract Audit Pipeline

`contracts/honeypot/HoneypotChecker.sol` (roughly 360 lines) is the audited revert-always pre-buy simulator. `ignition/modules/HoneypotChecker.ts` is the no-arg Ignition deploy module. `scripts/deploy-honeypot-checker.ts <chain>` is a pino-logging Windows-friendly CLI wrapper that maps `eth|bsc|base|arb` to the corresponding hardhat network name and spawns `npx hardhat ignition deploy`. `scripts/check-mythril-report.ts` is the Mythril severity gate consumed by CI.

### Inter-Component Data Flow

A new V2 candidate flows through the system in a fixed order: `WebSocketProvider` fires `PairCreated` → `startDexListener` callback in `bot.ts` → `handleNewPairForChain(ctx, dex, t0, t1, pair)` is invoked → already-sniped dedup via `isTokenSniped` → token/pair blocklist checks → `isKnownBadTokenForChain` (verifies non-empty `getCode`) → `canSnipe(chain, ...)` from `riskManager.ts` → 8-call `Promise.all` safety bank in `tokenSafety.ts` → reserves snapshot → outbound Telegram alert → `sendTxWithRetry(txBuilder, ctx, ...)` from `txManager.ts` (dispatches to the chain's MEV strategy) → on success, `recordSnipe(chain)` stamps the cooldown map → `insertTrade(...)` writes the row → `startExitMonitor(...)` opens the 5s `setInterval`. V3 follows the same pattern except `handleNewV3PoolForChain` inserts `waitForLiquidity` and `checkMinLiquidity` before the safety bank, and the swap path is `exactInputSingle` wrapped in `multicall(deadline, [...])` because SwapRouter02 dropped the deadline field. The sell direction is symmetric: the unified exit engine's interval callback acquires the per-token mutex, computes the sell decision, calls `executeFullSell` or the partial-sell helper, the receipt decoder parses logs, `updateTradeStatus` flips the row to `sold`, and `deleteExitState(trade_id)` clears the `exit_state` row.

## Tech Stack

### Runtime

- Node 22 (CI target via `actions/setup-node@v4`).
- TypeScript 5.8.3 with `"type": "commonjs"`.
- Entry point: `npx ts-node src/bot.ts`.

### Blockchain

- ethers v6.16.0 — `JsonRpcProvider`, `WebSocketProvider`, `Wallet`, `Contract`, native BigInt arithmetic throughout.
- @flashbots/ethers-provider-bundle 1.0.0 for ETH bundle submission.
- ws ^8.20.0 for both the dashboard server and the ethers `WebSocketProvider`.

### Smart Contracts & Hardhat

- Hardhat 2.26.0 with `@nomicfoundation/hardhat-toolbox` ^6.1.0.
- `@nomicfoundation/hardhat-ignition` 0.15.16 plus `hardhat-ignition-ethers` for deploys.
- `@nomicfoundation/hardhat-verify` ^2.1.0 for Etherscan / BscScan / BaseScan / ArbiScan verification (canonical `arbitrumOne` key name).
- `@nomicfoundation/hardhat-chai-matchers`, `@typechain/hardhat`, `typechain`, `hardhat-gas-reporter`, `solidity-coverage`.
- `@openzeppelin/contracts` ^5.4.0 — `IERC20` import in `HoneypotChecker.sol`, `ERC20` import in `FakeToken.sol`.
- Solidity 0.8.28.

### Web Framework / Dashboard Backend

- express ^5.2.1 with helmet ^8.1.0, cors ^2.8.6, cookie-parser ^1.4.7.
- ws ^8.20.0 — WebSocket server for real-time position push.
- uuid ^13.0.0 — session token generation.

### Dashboard Frontend (`dashboard/package.json`)

- react 19.1, react-dom 19.1, react-router-dom 7.13.
- tailwindcss 4.2 via `@tailwindcss/vite`.
- vite 8.0 with `@vitejs/plugin-react` 6.0.
- lightweight-charts 5.1 for the cumulative P&L line chart; chart.js 4.5 plus react-chartjs-2 5.3 for the exposure donut.
- lucide-react 0.510 for iconography.

### Telegram

- telegram 2.26.22 (the GramJS / MTProto client) for the alpha-drop listener.
- Outbound alerts via the plain Telegram HTTP API over axios 1.10.0.

### Observability

- pino ^10.3.1 structured JSON logging with pino-pretty ^13.1.3 in dev.
- axios 1.10.0 for third-party HTTP (honeypot.is, GoPlus, Unicrypt, Mudra, bloXroute).

### Persistence

- better-sqlite3 ^12.8.0 — synchronous SQLite driver, WAL journal mode, NORMAL synchronous, 5s busy timeout.

### Testing & Lint

- vitest ^4.1.1 with @vitest/coverage-v8 ^4.1.2 — three projects (`unit`, `integration`, `fork`), 70% lines/functions/branches/statements coverage threshold via the v8 provider.
- chai 4.3.10 plus `@nomicfoundation/hardhat-chai-matchers` for Hardhat-side tests.
- eslint ^9.39.4 with `typescript-eslint` ^8.57.1 (flat config in `eslint.config.mjs`).
- slither and mythril installed in CI via `pip` (not npm deps).

### Other

- dotenv 17.2.0 — env loading at module init in `src/config.ts` and `hardhat.config.ts`.

## Feature Deep Dive

### Multi-Chain Detection

The detection layer runs one DEX listener per chain × DEX pair. Each listener subscribes via `WebSocketProvider` to either the V2 factory's `PairCreated` event or the V3 factory's `PoolCreated` event. Reconnect logic is built in: a `close` event on the underlying socket triggers an exponential backoff from 1 second to a 60-second cap, creates a new `WebSocketProvider`, and re-subscribes the listener. When a chain has no `<PREFIX>_WS_URL` configured, the bot falls back to a 2-second HTTP polling loop. The runbook (`docs/operations/going-live.md`) is explicit that the polling fallback misses most launches and is intended only as a "do not fail" mode.

For V3 detection, `PoolCreated` does not guarantee liquidity exists — many launch scripts emit `PoolCreated` first, then `Mint` immediately after (often in the same block). `waitForLiquidity` subscribes to the pool's `Mint` event with a 30s deadline and also checks the just-emitted block for a same-block `Mint`, so the bot does not race a launch script that filed both events atomically. After a `Mint` is observed, `checkMinLiquidity` runs two `QuoterV2.quoteExactInputSingle` calls — one reference quote and one at the configured liquidity threshold — to confirm the pool actually has tradeable depth.

### Pre-Buy Safety Bank

After dedup, blocklist, contract-existence, and risk-gate checks pass, the bot executes an 8-call `Promise.all` against the candidate token. The eight checks operate independently; any rejection aborts the buy with a structured Telegram alert. The checks are:

- `checkHoneypotForChain` — chain-aware: honeypot.is on ETH and Base, GoPlus elsewhere.
- `isBlacklistedTokenForChain` — three-selector bytecode scan for anti-bot fingerprints.
- `isLiquidityLockedForChain` — Unicrypt on ETH, Mudra on BSC, GoPlus plus burn-percentage fallback elsewhere.
- `isLiquiditySufficientForChain` — V2 pair reserve depth at or above 1 native unit.
- `checkTokenMetadataForChain` — name, symbol, decimals sanity plus optional `tradingEnabled()` if the contract exposes it.
- `simulateSwapForChain` — V2 staticCall buy-direction round-trip.
- `hasHighTransferTaxForChain` — `getAmountsOut` versus actual `swapExactETHForTokens` static-call output, with a 25% default threshold.
- `hasMaxWalletOrTxLimitsForChain` — probes the four standard ABI methods (`maxWalletAmount`, `maxWallet`, `maxTxAmount`, `maxTransactionAmount`) and flags any returned value at or below 1% of total supply.

All eight returns are OR-combined into a single block decision. Every adapter fails closed — any provider error returns "block" rather than "allow."

### Anti-Rug Runtime Monitoring (Phase 19, v6.17+)

The bot monitors every open position for liquidity-removal events across both Uniswap V2 and Uniswap V3 pools on every enabled chain. The detector is a single WebSocket subscription per chain with a topic-filter union covering V2 `Pair.Burn`, LP `Transfer(_, 0xdEaD, _)`, V3 `Pool.Burn`, and V3 `Pool.Collect` — single-listener-per-chain, not per-position, to avoid the subscription-cap leak that the per-position pattern would hit at scale (per Pitfall #10).

A multi-signal AND-chain trigger fires only when: (1) LP removed exceeds the threshold (default 50% vs the baseline snapshotted at buy success in the new `lp_baseline` table), AND (2) the destination address is not in the merged V2+V3 locker allowlist (Unicrypt, TeamFinance, PinkLock per-chain canonical addresses plus the operator's `ALLOWLIST_EXTRA` overlay), AND (3) on V3 the `QuoterV2.quoteExactInputSingle` sell-simulation quotes less than 50% of the baseline expected output OR on V2 reserves dropped below the sell-threshold. Single-signal triggers are explicitly rejected. The discriminated-union `RugEvaluation` type makes a vacuous-pass return unrepresentable.

When the trigger fires and the chain is in live mode, the bridge calls the existing `exitEngine.executeFullSell` path with the new `reason: 'anti-rug'` discriminant and a 2.0× gas multiplier — preserving the sell lock, receipt decoding, DB cleanup, and Telegram alerts. There is no direct `wallet.sendTransaction` path; anti-rug never bypasses the unified exit pipeline. The dashboard surfaces six new components (Anti-Rug column with six-state badges, Anti-Rug Monitor tile, full-bleed Circuit Breaker banner, gated CB-reset modal with N acknowledge checkboxes plus the `RESET` confirm-text gate, WS-health indicator, frontrun outcome distribution panel) and the WebSocket dispatch carries five new event types (`antirug_state_update`, `antirug_event`, `chain_ws_health_change`, `cb_tripped`, `cb_reset`). A per-chain circuit breaker auto-disables anti-rug after N triggers in W hours (default 3 in 1 h); manual operator reset is required after evidence review.

**SAFETY DEFAULT: all chains ship in DRY-RUN MODE.** The bot logs `[DRY-RUN] Anti-rug would-have-sold:` events to Telegram, structured pino, and the dashboard tile without executing the exit. Per-chain graduation to live mode requires: (1) 7 calendar days minimum in dry-run, (2) review of every triggered event with 0 confirmed false-positives via the dashboard Frontrun Outcome Distribution panel, and (3) per-chain `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` (exact lowercase string) in `.env` plus a bot restart. There is no hot-flip and no code-level fallback flag — the `.env` + git-history audit trail is intentional.

**See `docs/operations/anti-rug-rollout.md`** for the authoritative operator handoff: every env var (9 per chain × 4 chains = 36 anti-rug env vars), the bot restart procedure, per-chain dry-run + live verification, the circuit-breaker reset procedure (dashboard modal flow + curl backup with `DASHBOARD_API_KEY` Bearer auth), and troubleshooting for WS-disconnect / `[GAP DETECTED]` / `Unmonitored` scenarios. **See `docs/operations/anti-rug-tuning.md`** for the threshold-tuning protocol: when to tune each parameter up vs down, the daily/end-of-7-day/monthly/post-CB review cadence, and the `.env` + git audit trail.

### Phase 18 Honeypot Pipeline — Status: In Progress

The v6.16 milestone shipped a `simulateSellForChain` (V2) and `simulateSellV3ForChain` (V3) pair that turned out to be broken-by-design. The V2 implementation called `erc20.balanceOf(ctx.wallet.address)` — which is always 0 for newly-listed tokens — and passed that zero balance into `swapExactTokensForETHSupportingFeeOnTransferTokens.staticCall`. The router rejected `amountIn=0` with `INSUFFICIENT_INPUT_AMOUNT`, the check returned `false`, and every V2 buy was hard-blocked. The V3 implementation had a `if (balance === 0n) return true;` short-circuit that silently passed every newly-listed token through without ever exercising the token's transfer logic. Both bugs motivated the v6.17 milestone; the original briefing was preserved in `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md` (per Phase 18 D-BRIEFING-DISPOSITION) and superseded by the Phase 18 rebuild that ships today.

The v6.17 rebuild is **mid-flight**. The architecture is "Option D primary, Option C opt-in fallback":

- **Option D** is the audited `HoneypotChecker.sol` contract deployed once per chain. The bot calls it via `provider.call(...)` with `msg.value === amountIn`, captures the revert payload, decodes the `RoundtripResult` custom error, and consumes the 3-bit status bitmap and the buy/sell tax bps.
- **Option C** is `eth_simulateV1` with state overrides — opt-in per chain, activated only if a chain's Option-D deploy is genuinely blocked. Stubbed today.

Both routes feed the same `HoneypotResult` discriminated union. The `safe` variant requires non-optional `buyTaxBps` and `sellTaxBps`, so an empty-evidence pass is a TypeScript compile error.

Today's state: the contract is audited, the CI gate is live, and the contract is **deployed on Ethereum mainnet** at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`. The deploy pipeline (Hardhat networks, Ignition module, capability-split deploy key, CLI wrapper) is shipped. The TypeScript dispatcher (`src/utils/honeypot/index.ts`) is wired and routes ETH snipes through the real `simulateViaContractV2` / `simulateViaContractV3` implementations in `src/utils/honeypot/checkerContract.ts` (plan 18-09 shipped these). The HONEY-12 bytecode mutability scan in `src/utils/honeypot/bytecodeScan.ts` is called from `src/bot.ts` at the V2 parallel safety bank (line 270 — 9th gate) and the V3 parallel safety bank (line 496 — 6th gate). BSC/Base/Arb chains still return `verdict: 'unknown'` (no-deployed-address) because the contract has not yet been deployed to those chains; plan 18-08 covers those deploys. **Status: Shipped on ETH; other chains pending 18-08.**

### Risk Gate

The risk gate is implemented as a simple sequential evaluator in `src/riskManager.ts`. The first-failure-returns shape makes the function trivial to extend and trivial to reason about; each rule contributes one short function and one DB query (or in-memory map). The five rules are listed above in Key Features. Cooldown state lives in an in-memory map and deliberately resets on restart — RISK-04 D-09 decided this prevents a crash from locking the bot out for the remainder of its cooldown window.

The math for the rolling-24h daily-loss rule is worth describing in detail. `getDailyRealizedLoss(chain, since)` runs a query that joins `sell` and `partial_sell` rows whose timestamp is at or after `now - 24h`, computing each event's realized P&L by pro-rating the buy cost across the sell, and summing only the negative deltas. The rule fails-closed if the sum exceeds `DAILY_LOSS_PCT × maxCapital` for that chain. Because the window is rolling, the bot self-recovers as old losses age out — no manual reset is required. The MAX_TOTAL_EXPOSURE rule operates similarly: `getTotalExposure()` sums `amount_in - Σ partial_sell.amount_out` across all open positions (not just the current chain), so partial sells reduce exposure as they fill, freeing capacity for the next candidate.

### Emergency Sell and Force-Sell

The dashboard's "Emergency Sell All" button calls `POST /api/controls/emergency-sell`, which iterates open positions sequentially (not in parallel — to avoid hitting per-chain rate limits and to keep the audit trail readable), clears every position's exit timers via `clearAllTimersForToken`, then invokes `executeFullSell` for each. The response is a per-position manifest of success/failure, rendered as a result modal in the SPA. The per-position force-sell (`POST /api/controls/force-sell/:tradeId`) follows the same clear-timers-then-sell pattern but for a single position. Both paths route through the same per-token sell mutex as the exit engine, so the operator clicking force-sell at the same tick the interval decides to sell will not produce a double-sell — one side wins the mutex, the other side observes the lock and skips.

### MEV Strategy Layer

Each MEV strategy implements the `MevStrategy` interface (`name`, `healthCheck()`, `sendTransaction(tx, wallet, provider, maxRetries) → txHash`). The dispatch happens once, at the bottom of `createMevStrategy(chain)`, on a discriminated `MevStrategyType` union with an exhaustive `never`-check at the end. Adding a strategy is "add a variant to the union, add a case to the switch, write the strategy." Removing one is just as small.

The Flashbots strategy creates a `FlashbotsBundleProvider` via `.create`, builds a bundle, and submits to the next block. Three retries; each retry bumps the nonce. Phase 14 hardening added a defensive null-check on the bundle response — `bundle.bundleTransactions[0].hash` can be undefined on a malformed lib response, and the strategy now throws rather than silently returning `undefined`.

The bloXroute strategy posts a `bsc_private_tx` JSON-RPC call to `api.blxrbdn.com` over axios with an `Authorization` header. Its `healthCheck()` pings with a benign call and inspects 401/403 status codes — if the auth header is wrong, the bot logs a fatal and exits at startup.

The passthrough strategy is just `wallet.sendTransaction(tx)` followed by `tx.wait(3)`. It uses EIP-1559 fee data via `provider.getFeeData()` when available and falls back to legacy `gasPrice`. Its `healthCheck()` always returns true — Base and Arbitrum have natively private mempools, and there is no Flashbots-equivalent endpoint to ping.

### Unified Exit Engine

The exit engine is a single `setInterval` per open position. Every 5 seconds the callback queries the current price (via the chain's router on V2, via `QuoterV2.quoteExactInputSingle` on V3), updates the volatility tracker, evaluates the four exit conditions, and decides whether to fire a sell. The first decision-step is to acquire the per-token sell mutex from `src/utils/exitManager.ts`; if another callback or a dashboard force-sell is already mid-sell, the interval skips this tick.

Trailing-stop math is more involved than a flat percentage. The base `trailingStopPct` is widened by a volatility multiplier — the coefficient of variation over the most recent 12 to 60 price samples — so high-volatility tokens get a wider band that does not panic-sell on chop. The widened band is then tightened by an age-weighted urgency multiplier (linear decay over the first 30 minutes), so old positions get a tighter band. The final result is clamped to a configured `[trailingMinPct, trailingMaxPct]`. When position age exceeds 30 minutes, the urgency multiplier hits zero and the engine emits a hard market sell regardless of price.

Partial sells are configured via `PARTIAL_SELL_TARGETS`, e.g. `"2x:50,5x:25"` to sell 50% at 2× entry and 25% more (of the original amount) at 5× entry. `parsePartialSellTargets` validates the input and rejects totals at or above 100%. Gap-sell handling matters: when a price tick jumps past multiple unfilled tiers at once (common at launch), the engine emits a single combined sell rather than firing the tiers serially.

Every poll cycle, the engine upserts the full `ExitStateData` row to `exit_state` keyed by `trade_id`. The persisted shape carries the high-water mark, the trailing-activated flag, the JSON-encoded `partial_tiers_completed` array, the BigInt-as-string `original_token_amount`, the urgency anchor timestamp, and the JSON-encoded volatility samples. `resumeExitMonitor` rebuilds the entire monitor from this row on boot.

### Receipt Decoder

After every sell, `src/utils/receiptDecoder.ts` parses the receipt logs to extract `amountOut`, `gasCost`, and `blockNumber`. For V2, it looks for the WETH `Withdrawal` event and reads the `wad` field. For V3, it looks for a WETH `Transfer` where the `to` address is the wallet and reads the `value` field. `gasCost` is `receipt.gasUsed × receipt.effectiveGasPrice`. If the receipt is null on the first call (rare — most providers return it synchronously after `tx.wait`), a single 2s retry runs. On permanent miss, the returned fields are `null` — explicitly so that the P&L view distinguishes "we do not know" from "the trade returned zero."

### Dashboard, WebSocket, and Real-Time Push

The Express router order in `src/api/server.ts` is strict: `/health` (unauthenticated) → `/api/auth/login` (unauthenticated, but rate-limited by middleware) → all `/api/*` routes (auth-gated by cookie middleware) → static `dashboard/dist/` → SPA catchall → error middleware. WebSocket upgrade is gated on the same session cookie; the upgrade handler in `src/api/ws/handler.ts` validates the cookie before adding the client to the broadcaster's `Set<WebSocket>`.

The broadcaster fires `positions_update` events on a 5s interval, derived from `buildPositionsWithLivePrices(contexts)` which joins DB rows with live on-chain prices. `chain_status_change` is fired on every stop/start invocation from `src/api/routes/chains.ts`. Every Telegram alert from `src/utils/notifier.ts` is also fanned out to the dashboard with `inferSeverity` and `inferCategory` heuristics applied to the message text.

### Telegram Listener and Alpha-Drop Pipeline

The Telegram listener is a separate MTProto user-account client (not the outbound HTTP-API bot used for alerts). On each new message it greps for all `0x[a-fA-F0-9]{40}` addresses, deduplicates the set, enforces a 5s cooldown across all addresses (regardless of source), and applies sender/channel allowlists from `TELEGRAM_ALLOWED_SENDERS` and `TELEGRAM_ALLOWED_CHANNELS` (OR-combined). For each surviving address, it iterates every enabled `ChainContext` and runs `getCode(address)` against that chain's HTTP provider; if the contract exists on that chain it forwards to `handleAlphaDropForChain`.

`src/alphaDrop.ts` is the routing helper. For each DEX configured on the chain, it tries V2 first via `factory.getPair(token, WETH)`, then V3 across the standard fee tiers `[500, 3000, 10000]` via `factory.getPool(...)`. First match wins, and the helper calls `handleNewPairForChain` or `handleNewV3PoolForChain` from `bot.ts` via a dynamic `import()` to break the circular dependency.

### Persistence and P&L

`getPnL()` in `src/utils/db.ts:241-274` is a single self-join over the `trades` table. The left side is the `buy` row; the right side is `SUM(sell.amount_out − sell.gas_cost)` aggregated across `sell` and `partial_sell` actions, with the buy cost pro-rated equally across the sell events. Nullable bound vars `token` / `chain` / `fromTimestamp` / `toTimestamp` allow the same query to power the `/api/trades`, `/api/risk/pnl`, and dashboard-overview endpoints.

### Restart and Resume Flow

The single most important reliability property of the bot is that exit monitors survive a crash. The `resumeMultiChainMonitoring(contexts)` function runs as part of the boot sequence in `src/bot.ts:836-880`. It queries `trades WHERE status='pending' AND action='buy'` to get every open position, then for each pending row:

- Looks up the current wallet balance of the position's token via `erc20.balanceOf(wallet.address)`.
- If the balance is non-zero, calls `resumeExitMonitor(...)` which reads the persisted `exit_state` row keyed by `trade_id`, deserializes the volatility samples, the completed tiers, the high-water mark, and the urgency anchor, then opens a fresh 5s `setInterval` continuing from exactly that state.
- If the balance is zero, marks the row `failed` (the position was sold while the bot was down, or the buy itself never settled).

The implication is operational: the operator can SIGKILL the bot, restart from a fresh process, and the exit engine resumes every position at its persisted high-water mark, completed-tier set, and volatility window. The bot's view of "where each position is on its exit curve" is durable. This is the single most-tested property of the runtime — the integration suite includes `exitMonitor.test.ts` and the v6.16 acceptance criteria included restart-survives behavior tests across every exit branch.

The mirror image is the dashboard's "stop chain" and "start chain" flow. Stopping a chain removes its WebSocket listeners but **keeps** its providers and exit monitors alive — open positions continue to be monitored and sold. Restarting a chain runs the `onRestart(ctx)` closure built by the orchestrator: re-attach WebSocket, re-run MEV health check, re-attach DEX listeners. Warnings (e.g. WebSocket reconnect failed, MEV strategy unhealthy) are surfaced through a returned array and rendered on the chain's status card on the dashboard.

## Data & Domain Model

### SQLite Schema

The database lives at `./data/bot.db` (overridable via `DB_PATH`), runs in WAL journal mode, and ladders up through four schema versions at module load. Two tables hold the meaningful state.

The `trades` table is one row per `buy / sell / partial_sell / fail` action. Columns: `id` (PK), `token` (NOCASE), `chain` (one of `eth / bsc / base / arb`, defaulting to `eth`), `action`, `tx_hash` (set to `mev_bundle` for Flashbots until the receipt is decoded), `block`, `timestamp` (unix epoch), `amount_in` (native-currency string), `amount_out` (receipt-decoded BigInt string, nullable), `gas_cost` (`gasUsed × effectiveGasPrice` BigInt string, nullable), `price_at_action`, `status` (`pending / sold / failed`), `pool_type` (`v2 / v3`), `fee_tier` (V3 only — 500, 3000, 10000), and `dex_name` (e.g. `uniswap-v2`, `pancakeswap-v3`). Indexes on `token`, `chain`, `timestamp`, `status`.

The `exit_state` table is one row per open trade, keyed by `trade_id`. Columns: `entry_price`, `high_water_mark`, `trailing_activated` (0/1 flag), `partial_tiers_completed` (JSON array of filled tier indices), `original_token_amount` (BigInt as string), `urgency_start_ts`, and `volatility_samples` (JSON array of recent price samples). This row is upserted every 5 seconds while the position is open and deleted when the position closes.

### Computed P&L

P&L is computed at query time, not stored. `getPnL()` does a single self-join over `trades`, aggregating `buy.amount_in + buy.gas_cost` against `SUM(sell.amount_out − sell.gas_cost)` for `sell` and `partial_sell` actions per `buy`. `getPnLChartData()` pro-rates the buy cost equally across all sell events for a position so the line chart can plot per-event realized P&L. The same query shape powers `/api/trades`, `/api/risk/pnl`, and the dashboard overview cards.

### Risk Queries

`getOpenPositionCount()` filters `trades` `WHERE status = 'pending' AND action = 'buy'`. `getTotalExposure()` computes `SUM(amount_in − Σ partial_sell.amount_out)` across all open positions. `getDailyRealizedLoss(chain, since)` sums negative-P&L sells over a rolling 24h window per chain. `exposureByChain` groups by chain for the dashboard donut.

### TypeScript Domain Types

The most load-bearing domain types are concentrated in three files. `src/chainRegistry.ts` exports `ChainConfig` (the full chain shape), `DexConfig = DexConfigV2 | DexConfigV3` (discriminated on `dexType`), `ChainContext` (the runtime carrier of provider + wallet + log), and `HoneypotCheckerConfig`. `src/utils/honeypot/types.ts` exports `HoneypotResult` (the discriminated union over `'safe' | 'unsafe' | 'unknown'` where the `safe` variant requires non-optional `buyTaxBps` and `sellTaxBps`). `src/exitEngine.ts` exports `ExitConfig`, `ExitStateData`, `PartialTier`, and `VolatilityTracker`. `src/utils/mevStrategies/types.ts` defines the `MevStrategy` interface. `src/utils/receiptDecoder.ts` defines `ReceiptData = {amountOut: string | null, gasCost: string | null, blockNumber: number | null}`.

### Auxiliary State

The legacy `.bot-state.json` (single-chain JSON snapshot) is migrated into SQLite once on first boot and renamed to `.bak`. The current repo carries `.bot-state.json.bak` from 2026-03-22, confirming the migration ran. Session storage is an in-memory `Map<token, {createdAt}>` with 24h TTL and hourly cleanup; sessions intentionally do not survive restart. Snipe-cooldown timestamps are also in-memory and reset on restart by design (RISK-04 D-09).

## Chain & DEX Support

The bot supports four EVM mainnets out of the box. All router, factory, quoter, and swap-router addresses are hardcoded in `CHAIN_TEMPLATES` at `src/chainRegistry.ts:121-296`. Each chain has its own gas profile (`eip1559` vs `legacy`), default snipe amount, default max capital, default minimum liquidity threshold, and default tax-bps thresholds.

| Chain | chainId | Native | Wrapped | MEV strategy | V2 DEXes | V3 DEXes |
|-------|---------|--------|---------|--------------|----------|----------|
| Ethereum | 1 | ETH | WETH | Flashbots (`relay.flashbots.net`) | uniswap-v2, sushiswap-v2 | uniswap-v3 |
| BSC | 56 | BNB | WBNB | bloXroute (`api.blxrbdn.com`) | pancakeswap-v2, biswap-v2 | uniswap-v3, pancakeswap-v3 |
| Base | 8453 | ETH | WETH | passthrough (native private mempool) | uniswap-v2, aerodrome | uniswap-v3 |
| Arbitrum | 42161 | ETH | WETH | passthrough (FCFS ordering) | uniswap-v2, camelot-v2 | uniswap-v3 |

RPC providers can be anything supporting standard JSON-RPC. The runbook examples use Alchemy. `<PREFIX>_WS_URL` is strongly recommended for every chain you actually want to trade on — without it the bot falls back to a 2s HTTP polling loop and misses most launches. Per-chain `chainId` validation runs at startup and skips (does not fatal-exit) any chain whose RPC returns a mismatched chainId.

Adding a new chain is a typed-template addition in `CHAIN_TEMPLATES` plus an env-variable triple (RPC URL, optional WS URL, snipe amount). The discriminated-union shape of `DexConfig` and `MevStrategyType` forces every consumer to handle the new chain or fail `tsc --noEmit`.

## Security & Reliability

- **Authentication.** Dashboard login posts the API key to `POST /api/auth/login` and is compared via `crypto.timingSafeEqual` against `DASHBOARD_API_KEY` to defeat length-extension timing attacks. The login route mints a UUID session token, sets an httpOnly cookie with `sameSite: 'strict'` and `secure: process.env.NODE_ENV === 'production'`, and stores the session in an in-memory `Map<token, {createdAt}>`. An hourly cleanup interval evicts sessions older than 24h.
- **Validation.** Env validation is fail-loud at startup — missing required vars trigger `logger.fatal` plus `process.exit(1)` with a structured log record. `DASHBOARD_API_KEY` is re-validated at login time so hot-reload or test harnesses cannot weaken auth mid-process. Per-chain tax-bps env vars are range-validated `[0, 10000]` with `Number.isNaN` detection.
- **MEV protection.** Flashbots on ETH, bloXroute private transactions on BSC, and direct submission through the natively-private mempools on Base and Arbitrum. Every strategy implements 3-retry submission with bumped nonces.
- **Sell-race mutex.** Composite `chain:token` keys with check-and-set in a single event-loop tick eliminate the same-tick double-sell case. Force-sell and emergency-sell-all from the dashboard always clear timers before calling `executeFullSell`.
- **Capability-split deploy key.** `DEPLOY_PRIVATE_KEY` is a separate wallet, used only by `scripts/deploy-honeypot-checker.ts`. The bot's `PRIVATE_KEY` has no deploy authority on any production chain. If the bot wallet leaks, the attacker cannot push a malicious checker to the trusted address.
- **Audit gate as evergreen CI.** `dorny/paths-filter@v3` triggers `hardhat-compile`, `slither`, and `mythril` on every `contracts/**` change. Mythril severity gate `scripts/check-mythril-report.ts` blocks any new Medium or High issue, with zero new npm deps.
- **Formula-injection-safe CSV export.** `/api/trades/export` escapes `= + - @ \t \r` prefix-attack vectors so a malicious token name cannot run a spreadsheet formula in Excel or Google Sheets.
- **Graceful shutdown.** SIGINT and SIGTERM handlers walk the shutdown sequence: API close → Telegram disconnect → clear all exit timers → destroy WebSocket providers → close DB → `process.exit(0)`. A 5s force-exit safety net covers the case where a downstream hangs.
- **Chain-scoped logger.** Every `ChainContext` carries a pino child logger with the chain pre-bound, so every log line is unambiguous about which chain it came from.
- **`HoneypotResult` compile-gate.** The discriminated union refuses to compile an empty-evidence "safe" verdict, baking the v6.16 silent-pass bug fix into the type system.

### Observability and Failure Modes

Logging is structured JSON via pino, with `pino-pretty` enabled in dev. Every `ChainContext` carries a child logger pre-bound with `{chain: 'eth'}` (or `bsc` / `base` / `arb`), so log lines from different chains never get confused on a single-host operator deploy. The bot also writes a structured `event` field for high-signal lines (e.g. `event: 'snipe_executed'`, `event: 'safety_check_failed'`, `event: 'mev_health_degraded'`) to enable jq-grep style filtering.

The Telegram fan-out is the operator's primary push channel. `sendTelegramAlert` formats a message and posts it to the bot's chat ID, while `sendCtxAlert` adds the chain tag. Every alert is also broadcast to the dashboard WebSocket as a `notification` event with `inferSeverity` (`info | warning | error`) and `inferCategory` (`snipe | sell | health | risk | system`) heuristics applied to the message text, so the dashboard's event feed groups and color-codes them.

Failure modes are deliberately loud. A failed safety check on a candidate emits a Telegram alert with the failing rule and a `reason` field, then the buy is aborted. An MEV strategy health-check failure (Flashbots key parse error, bloXroute 401/403) at boot exits the bot with `logger.fatal` and a non-zero exit code; at runtime it fans out a degradation alert and continues to attempt sends (the strategy may transiently recover). A WebSocket disconnect triggers exponential-backoff reconnect with a 60s cap, logging each retry. A SQLite write error throws inline and is caught by the surrounding handler — no swallowing, no silent degradation.

## In-Progress Work

- **Pre-buy sell-simulation rebuild (Phase 18, shipped on ETH).** Contract audited 2026-05-15 (Slither and Mythril clean). Audit gate live in CI. Deploy pipeline (Ignition module + CLI wrapper + per-chain hardhat networks + capability-split deploy key + `hardhat-verify` config) is shipped. The contract is **deployed on Ethereum mainnet** at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`. Plan 18-09 wired the real `simulateViaContractV2` / `simulateViaContractV3` implementations in `src/utils/honeypot/checkerContract.ts`. Plan 18-10 wired the runtime gate at `src/bot.ts` (V2 line 232 / V3 line 459) and added the HONEY-12 bytecode mutability scan to both parallel safety banks. The broken-by-design `simulateSellForChain` / `simulateSellV3ForChain` stubs in `src/utils/tokenSafety.ts` have been deleted. BSC/Base/Arb chain deploys are pending plan 18-08. **Status: Shipped on ETH; other chains pending 18-08.**
- **Anti-rug runtime monitoring (Phase 19 ANTIRUG, shipped — DEFAULT IS DRY-RUN).** Single-listener-per-chain WebSocket subscription to V2 `Pair.Burn` / LP `Transfer→0xdEaD` + V3 `Pool.Burn` / `Pool.Collect`; multi-signal AND-chain trigger; bridge to `executeFullSell` with `reason='anti-rug'` and 2.0× gas multiplier; per-chain circuit breaker; six dashboard surfaces (badge, monitor tile, CB banner, gated reset modal, WS-health indicator, frontrun distribution panel); five new WS event types. All chains ship in dry-run; per-chain live-mode graduation requires 7-day dry-run window + 0 confirmed FPs + `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` `.env` flip + restart per `docs/operations/anti-rug-rollout.md`. Wave-1 V3 follow-up tracker (TeamFinance V3 + PinkLock V3 NFT vaults per non-ETH chain; V3 rug-fixture skeleton) documented in the rollout doc §7. **Status: Shipped; operator-driven live-mode graduation pending per-chain 7-day window.**
- **Going-live ops hardening (Phase 20 OPS-LIVE, shipped).** Fail-closed preflight (`src/preflight.ts`) runs seven per-chain checks (chain ID, RPC block age, wallet balance per the D-BALANCE-FLOOR operational formula, MEV health, HoneypotChecker code-at-address, anti-rug 7-day live-gate) plus a chain-agnostic cross-env validator and a one-shot stale-position scanner. Six multi-stage kill-switch checkpoints (three V2 + three V3) honor a SQLite-persisted global pause flag that survives restart per D-PAUSED-RESTART. Mid-run wallet undercut detector auto-pauses (every `MID_RUN_CHECK_INTERVAL_SEC`, default 300s) without panic-selling. Operator CLIs: `npm run preflight | pause | resume`. Dashboard pause banner with WebSocket-pushed `pause_state_change` events. The consolidated runbook lives at [`docs/operations/going-live.md`](./docs/operations/going-live.md) — moved atomically from the repo root in Phase 20 Plan 20-07 with a CI guard that fails the build if either `GOING-LIVE.md` or `HONEYPOT-SIM-BRIEFING.md` reappears at the repo root. **Status: Shipped.**
- **v6.16 deferred live-runtime validation (Phase 21 EXIT-LIVE).** The following were validated only in tests during v6.16 and need real-mainnet validation in Phase 21: live exit-poll cycle and state persistence across restart, real sell `amount_out` non-null on mainnet, real Flashbots tx hash on mainnet, dashboard WebSocket position updates rendered in an actual browser, live price / Telegram / chain-restart warnings, bot-startup SQLite plus `.bot-state.json` migration on real boot. **Status: Deferred live-runtime validation.**

## Project Structure

- `src/` — production TypeScript runtime. Sub-areas: `src/bot.ts` is the orchestrator; `src/chainRegistry.ts` is the source-of-truth chain config; `src/exitEngine.ts` is the unified exit engine; `src/riskManager.ts` is the 5-rule risk gate; `src/telegramListener.ts` and `src/alphaDrop.ts` are the Telegram alpha-drop pipeline; `src/api/` is the Express plus WebSocket dashboard server; `src/utils/` holds the safety bank, MEV strategies, receipt decoder, DB layer, logger, and honeypot dispatcher.
- `contracts/` — Solidity contracts. `contracts/honeypot/HoneypotChecker.sol` is the audited pre-buy roundtrip simulator. `contracts/FakeToken.sol` is a 13-line ERC20 mintable test fixture used for Sepolia bootstrap.
- `ignition/modules/` — Hardhat Ignition deploy modules. `HoneypotChecker.ts` is the no-arg module consumed by the deploy CLI.
- `scripts/` — operational TypeScript scripts. `deploy-honeypot-checker.ts` is the per-chain Ignition wrapper. `check-mythril-report.ts` is the CI severity gate (zero new npm deps). `addLiquidity.ts` and `deploySepoliaTest.ts` are Sepolia bootstrap helpers. `check-empty-files.sh` is a pre-commit guard added 2026-04-29 after a cleanup sweep.
- `dashboard/` — React + Vite + Tailwind SPA. Builds to `dashboard/dist/` which Express serves statically.
- `test/` — Vitest suites under `unit/`, `integration/`, and `fork/`, plus `fixtures/` and `helpers/`. `test/fixtures/contracts/Honeypot.sol` is the 5-mode contrived honeypot fixture used by fork tests. `test/fork/fixtures/honeypots/` holds three ETH JSON fixtures.
- `.github/workflows/` — one workflow file (`test.yml`) that runs the unit and integration tests, the `.todo` ban, three `tsc --noEmit` invocations, and (only on `contracts/**` changes) the hardhat-compile / slither / mythril audit gate.
- `docs/` — long-form internal docs (`ARCHITECTURE.md`, `CONFIGURATION.md`, `DEVELOPMENT.md`, `GETTING-STARTED.md`, `TESTING.md`).
- `data/` — runtime artifact directory; SQLite DB lives here (gitignored).
- `artifacts/`, `cache/`, `typechain-types/`, `coverage/`, `dist/`, `reports/` — build outputs from Hardhat / TypeChain / Vitest / Slither / Mythril (all gitignored).
- `docs/operations/` — operator-facing runbooks. Contains `going-live.md` (consolidated first-time live-mainnet setup + Phase 20 preflight failure modes + pause/resume + mid-run undercut + anti-rug live-gate flip + RPC/MEV/checker troubleshooting), `anti-rug-rollout.md` (Phase 19 anti-rug operator handoff), and `anti-rug-tuning.md` (anti-rug threshold-tuning protocol). Root-level operator docs are banned by `.github/workflows/test.yml` "Ban root-level operator-facing docs" CI guard — `GOING-LIVE.md` and `HONEYPOT-SIM-BRIEFING.md` cannot reappear at the repo root.

## Tests & CI

The test suite uses Vitest 4 with three projects defined in `vitest.config.ts`:

- **unit** — `test/unit/**/*.test.ts`, 5s timeout, `environment: 'node'`, `mockReset: true`. 29 files.
- **integration** — `test/integration/**/*.test.ts`, 15s timeout. 13 files.
- **fork** — `test/fork/**/*.test.ts`, 120s timeout, with `globalSetup: ['test/fork/setup.ts']` that boots a local Ethereum mainnet fork via the hardhat node. 1 file.

Total **43 `*.test.ts` files**. Coverage threshold is **70%** across lines, functions, branches, and statements, enforced by the v8 provider with HTML and JSON-summary reports written to `coverage/`. The dashboard package is excluded from coverage.

Unit suites cover the chain registry overlay plus range validation, all five risk rules, the exit engine (partial tiers, volatility tracker, urgency math, gap-sells, zero-balance edge cases), every safety-bank dispatch function, the `HoneypotResult` discriminated union (compile-time plus runtime asserts), the HONEY-12 bytecode selector scan (asserts `MUTABLE_SELECTORS.length === 19`), the DB schema migration ladder plus the JSON migration, the receipt decoder for both V2 Withdrawal and V3 Transfer paths, the chain stop/start state machine, the Telegram listener whitelist plus dedup plus cooldown, the env validation harm-prevention assertions, and the Phase 17 retroactive harm-prevention assertions on the v5 to v6 ethers migration.

Integration suites cover every Express router (`auth`, `positions`, `trades`, `risk`, `chains`, `controls`, `health`, `wsPush`) end-to-end against a test DB, the MEV strategy dispatch and bundle handling, the full exit-monitor lifecycle, V3 liquidity-wait behavior, and WebSocket reconnect logic.

The single fork suite (`snipeLifecycle.test.ts`) exercises a complete pair-detection → safety → buy → sell lifecycle against a forked Ethereum mainnet state. Fork tests are **excluded** from CI because they require RPC credentials.

Two **CI invariants** are enforced on every push and pull request to `main` / `master`, in addition to the audit gate:

- The `.todo` test-stub ban — `it.todo()`, `test.todo()`, and `describe.todo()` all fail the build. Phase 17 DEBT baseline confirmed zero matches; the ban locks that result evergreen.
- Three `tsc --noEmit` invocations against `tsconfig.json`, `tsconfig.bot.json`, and `dashboard/tsconfig.json`. Phase 17 DEBT baseline confirmed all three exit clean; the invariant locks that result evergreen.

The audit gate adds three more jobs that run only when `dorny/paths-filter@v3` detects a `contracts/**` change: `hardhat-compile` (5-min timeout), `slither` (5-min timeout; runs slither with `--exclude-informational --exclude-low --fail-medium` on `contracts/honeypot/HoneypotChecker.sol`), and `mythril` (10-min timeout; runs `myth analyze` with `--execution-timeout 300 --max-depth 30`, then pipes the JSON report through `scripts/check-mythril-report.ts` to fail on Medium-plus severity).

### What Is Not Tested

Honest framing matters here. The current suite does not assert honeypot-detection behavior on `simulateSellForChain` or `simulateSellV3ForChain` — doing so would expose the broken-by-design implementations those functions currently carry, and those implementations are being replaced by plan 18-09. No tests exercise the real `HoneypotChecker.sol` contract from TypeScript yet because the adapters in `checkerContract.ts` are still placeholders. Once plan 18-09 lands, the TypeScript-side integration tests for the dispatcher are scoped in.

### Local Audit Tooling Notes

Windows-host Mythril setup is non-trivial. `pip install mythril` fails on Python 3.13 because no prebuilt wheels exist for `ckzg` and `pyethash` and the native build needs MSVC `cl.exe`. The documented workaround is to use the official `mythril/myth:latest` Docker image — but that image hardcodes `solc-bin.ethereum.org`, which now NXDOMAINs, so a Linux solc 0.8.28 ELF must be bind-mounted into `/home/mythril/.solcx/`. Mythril's `--solc-args` does not forward remappings (it calls `solc --standard-json` internally), so remappings must live in a `--solc-json` settings JSON file. CI on `ubuntu-latest` sidesteps all of this with native `pip install mythril` plus the `--solc-json` heredoc. These notes are preserved at `.planning/milestones/v6.17-honeypot-checker-audit.md` for any future operator who has to re-run the audit locally.

## Running the Bot

The entry point is `npx ts-node src/bot.ts`. The file's bottom-of-module guard checks `require.main === module` and calls `startMultiChainBot()`. There is no separate executable wrapper — the runtime is a single TypeScript file's worth of orchestration.

Environment configuration lives in `.env` at the repo root. `.env.example` documents the 33 supported variables; `src/config.ts` mirrors them in `REQUIRED_ENV_VARS` and runs `validateEnvVars()` at module load to fail loud on missing required values. The minimum to boot is `PRIVATE_KEY`, `ALCHEMY_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, and `DASHBOARD_API_KEY`. Per-chain configuration uses the prefix triple `<ETH|BSC|BASE|ARB>_RPC_URL` / `<…>_WS_URL` / `<…>_SNIPE_AMOUNT` / `<…>_MAX_CAPITAL` / `<…>_MIN_LIQUIDITY`. MEV-strategy auth (`FLASHBOTS_AUTH_KEY` for ETH, `BLOXROUTE_AUTH_HEADER` for BSC) is required when the corresponding chain is enabled. Risk and exit-engine tuning (`MAX_OPEN_POSITIONS`, `MAX_TOTAL_EXPOSURE`, `DAILY_LOSS_PCT`, `TRAILING_STOP_PCT`, `STOP_LOSS_PCT`, `PARTIAL_SELL_TARGETS`, etc.) all have sensible defaults documented in `.env.example`.

The dashboard requires a build step before first run: `cd dashboard && npm run build` produces the static bundle at `dashboard/dist/`, which Express serves statically from `src/api/server.ts`. The dashboard listens on `DASHBOARD_HOST:DASHBOARD_PORT` (default `127.0.0.1:8080`) and requires `DASHBOARD_API_KEY` for login.

Hardhat tooling (compile, ignition deploy, verify, fork tests) runs through `npx hardhat <task>`. The `scripts/deploy-honeypot-checker.ts <chain>` CLI is the thin wrapper around `npx hardhat ignition deploy` for the four production chains; operators paste the resulting deployed address into `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` in `.env` and run `npx hardhat verify --network <network> <address>` manually. The script deliberately does **not** auto-update `chainRegistry.ts` — T-18-23 audit-trail mitigation preserves a git-history record of which contract address became canonical at which commit.

The [`docs/operations/going-live.md`](./docs/operations/going-live.md) runbook walks through the full first-time setup: funding the bot wallet, funding the deploy wallet, validating env vars, running the audit gate locally, deploying the checker per chain, pasting addresses into env, and starting the bot. The same doc covers the Phase 20 surface: preflight failure modes + remediation, pause/resume CLI usage, mid-run wallet undercut recovery, the anti-rug live-gate flip procedure (with cross-link to `docs/operations/anti-rug-rollout.md`), and RPC/MEV/checker validation troubleshooting.

## Conclusion

`crypto-snipe-bot` is a serious multi-chain trading runtime built around four engineering ideas: chain abstraction via discriminated unions with exhaustive `never`-checks, layered MEV submission behind one strategy interface, a restart-survivable exit state machine with per-token sell mutex, and a deliberately-narrow on-chain safety primitive under live Slither plus Mythril CI audit.

The v6.17 milestone is closing the last credibility gap — the silent-pass bug in the v6.16 sell simulation is being replaced by an immutable, stateless, eth_call-only audited contract, with the runtime wire-up scheduled for plan 18-09. The bot is intentionally single-operator, intentionally loud about its in-progress surface, and intentionally honest about which parts are shipped and which are mid-flight.

Every claim in this README is back-able by a file path in the codebase. The arc from the v6.16 sell-sim discovery through the audited HoneypotChecker design, the capability-split deploy key, the evergreen Slither + Mythril CI gate, and the planned runtime wire-up represents the kind of defense-in-depth iteration that turns a working bot into a credible one.
