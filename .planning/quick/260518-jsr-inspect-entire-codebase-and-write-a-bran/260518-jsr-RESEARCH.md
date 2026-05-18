---
quick_id: 260518-jsr
title: Codebase Research for README rewrite
date: 2026-05-18
---

# Codebase Research: Crypto Snipe Bot

## 1. Product Summary (Grounded)

`crypto-snipe-bot` is a TypeScript/Node service that listens for new Uniswap-style liquidity events across four EVM mainnets (Ethereum, BSC, Base, Arbitrum), runs each candidate token through a stack of on-chain and third-party safety probes, and — for survivors — submits a buy via a chain-appropriate MEV-protected transaction path (Flashbots on ETH, bloXroute on BSC, native private mempool on Base/Arbitrum). After a buy, a single unified exit engine polls the position every 5 seconds and dispatches partial sells, trailing-stop sells, stop-loss sells, or time-urgency market sells per-position. State is persisted to local SQLite (WAL) with full trade audit and computed P&L. An operator dashboard (React + Vite + Express + WebSocket) shows live positions, P&L, risk gauges, chain controls, and emergency sell. A Telegram listener can pipe contract addresses from "alpha drop" channels into the same buy pipeline.

The repo is mid-way through a defensive-hardening milestone (v6.17) that rebuilds the broken pre-buy honeypot-sell-simulation stack via a deploy-once-per-chain on-chain `HoneypotChecker` Solidity contract under Hardhat, with the contract already audited via Slither + Mythril gated in CI.

**Audience:** the operator is the developer themselves — there is no multi-tenant story, no SaaS frontend, no public API. The dashboard is bound to `127.0.0.1` by default.

---

## 2. Stack & Dependencies

### Runtime
- **Node 22** (CI target: `actions/setup-node@v4` with `node-version: '22'` — `.github/workflows/test.yml:15`)
- **TypeScript 5.8.3** (`package.json`)
- **CommonJS** module format (`"type": "commonjs"` in `package.json`)
- **Entry point:** `npx ts-node src/bot.ts` → `startMultiChainBot()` (`src/bot.ts:949-951`)

### Blockchain
- **ethers v6.16.0** — `JsonRpcProvider`, `WebSocketProvider`, `Wallet`, `Contract`, native BigInt arithmetic everywhere (`package.json`, `src/chainRegistry.ts:4`)
- **@flashbots/ethers-provider-bundle 1.0.0** — Flashbots bundle submission for ETH (`src/utils/mevStrategies/flashbots.ts:2`)
- **better-sqlite3 ^12.8.0** — synchronous SQLite driver with WAL mode (`src/utils/db.ts:4-22`)

### Smart contracts / Hardhat
- **Hardhat 2.26.0** with `@nomicfoundation/hardhat-toolbox ^6.1.0` (`package.json:34-58`)
- **@nomicfoundation/hardhat-ignition 0.15.16** + `hardhat-ignition-ethers` for deploys (`package.json:36-37`)
- **@nomicfoundation/hardhat-verify ^2.1.0** for Etherscan/BscScan/BaseScan/ArbiScan verification (`hardhat.config.ts:102-109`)
- **@nomicfoundation/hardhat-chai-matchers ^2.1.2**, **@typechain/hardhat ^9.1.0**, **typechain ^8.3.2**, **hardhat-gas-reporter ^2.3.0**, **solidity-coverage ^0.8.17**
- **@openzeppelin/contracts ^5.4.0** — used by `contracts/honeypot/HoneypotChecker.sol` for `IERC20` (`contracts/honeypot/HoneypotChecker.sol:4`) and by `contracts/FakeToken.sol` for `ERC20`
- **Solidity 0.8.28** (`hardhat.config.ts:49`)

### Web framework / dashboard
- **express ^5.2.1** with `helmet ^8.1.0`, `cors ^2.8.6`, `cookie-parser ^1.4.7` (`src/api/server.ts:5-10`)
- **ws ^8.20.0** — WebSocket server for real-time position push every 5s (`src/api/server.ts:7,94-113`)
- **uuid ^13.0.0** — session token generation (`src/api/middleware/auth.ts:7`)

### Dashboard frontend (`dashboard/package.json`)
- **react 19.1**, **react-dom 19.1**, **react-router-dom 7.13**
- **tailwindcss 4.2** via `@tailwindcss/vite`
- **vite 8.0** with `@vitejs/plugin-react 6.0`
- **lightweight-charts 5.1** (P&L line chart), **chart.js 4.5** + **react-chartjs-2 5.3** (exposure donut)
- **lucide-react 0.510** for iconography

### Telegram
- **telegram 2.26.22** (the GramJS / MTProto client, for the alpha-drop listener) — `src/telegramListener.ts:5-7`
- The outbound bot uses the plain Telegram HTTP API via `axios` (`src/utils/notifier.ts:10`)

### Observability
- **pino ^10.3.1** structured JSON logging + **pino-pretty ^13.1.3** for dev (`src/utils/logger.ts:4-10`)
- **axios 1.10.0** — third-party HTTP (honeypot.is, GoPlus, Unicrypt, Mudra, bloXroute) — see `src/utils/safetyProviders/*`

### Testing & lint
- **vitest ^4.1.1** + **@vitest/coverage-v8 ^4.1.2** with three projects: `unit`, `integration`, `fork` (`vitest.config.ts:8-39`)
- **chai 4.3.10** + **@nomicfoundation/hardhat-chai-matchers** for any hardhat-side tests
- **eslint ^9.39.4** + **typescript-eslint ^8.57.1** (`eslint.config.mjs`)
- **slither** + **mythril** — installed in CI via `pip` (`.github/workflows/test.yml:100-103, 135-136`), not npm deps

### Other
- **dotenv 17.2.0** — env loading at module init (`src/config.ts:2-4`, `hardhat.config.ts:9`)

---

## 3. Entry Point & Boot Flow

`npx ts-node src/bot.ts` runs the file's bottom guard `if (require.main === module) { startMultiChainBot(); }` (`src/bot.ts:949-951`). Imports trigger these side effects in order:

1. **`src/config.ts`** loads `.env` via `dotenv.config()`, runs `validateEnvVars()` which calls `logger.fatal(...) + process.exit(1)` if any of seven REQUIRED vars is missing (PRIVATE_KEY, ALCHEMY_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION, DASHBOARD_API_KEY). Also validates `NETWORK` against `{sepolia, mainnet}` for the legacy single-chain code path. (`src/config.ts:68-79`)
2. **`src/utils/db.ts`** opens `./data/bot.db` (or `DB_PATH`), creates the dir if missing, sets `journal_mode=WAL`, runs schema migrations to version 4 (creates `trades` + `exit_state` tables, adds `pool_type` / `fee_tier` / `dex_name` columns), runs the legacy `.bot-state.json → SQLite` migration once if the JSON file exists, and normalizes any legacy `chain='mainnet'` rows to `chain='eth'`. (`src/utils/db.ts:9-206`)
3. **`startMultiChainBot()`** then:
   1. `buildChainRegistry()` — reads `ENABLED_CHAINS`, validates each name against `{eth, bsc, base, arb}`, validates per-chain RPC URLs and MEV auth keys for enabled chains (`process.exit(1)` on missing). Parses and range-checks `<PREFIX>_MAX_BUY_TAX_BPS` / `<PREFIX>_MAX_SELL_TAX_BPS` and `<PREFIX>_HONEYPOT_CHECKER_ADDRESS`. (`src/chainRegistry.ts:311-433`)
   2. For each enabled chain: creates a `ChainContext` (HTTP + optional WS provider, Wallet, scoped pino logger), `await provider.getNetwork()` and skips the chain on chainId mismatch, runs an MEV strategy `healthCheck()` (Flashbots key parse, bloXroute auth header ping, or always-true passthrough), and starts a per-DEX listener on `PairCreated` (V2) or `PoolCreated` (V3). WebSocket listeners have a built-in exponential-backoff reconnect loop (`src/bot.ts:565-637`); chains without WS URL fall back to a 2s HTTP polling loop (`src/bot.ts:644-696`).
   3. Schedules a recurring 5-minute MEV health check that fires Telegram alerts when degraded (`src/bot.ts:744-754`).
   4. `resumeMultiChainMonitoring(contexts)` — queries `trades WHERE status='pending' AND action='buy'`, looks up wallet balance, and (if non-zero) calls `resumeExitMonitor()` per pending trade so positions survive bot restarts. Zero-balance pending rows are marked `failed`. (`src/bot.ts:836-880`)
   5. Builds an `onRestart(ctx)` closure used by the dashboard's "start chain" button (re-attaches WS, re-runs health check, re-attaches DEX listeners, returns warnings array).
   6. `startApiServer(contexts, onRestart, getTelegramStatus)` — Express + WebSocket on `DASHBOARD_HOST:DASHBOARD_PORT` (default `127.0.0.1:8080`). Mounts `/health` (unauthed), `/api/auth/login`, then auth-gated routers for positions / trades / risk / chains / controls, plus static SPA serving from `dashboard/dist/`. Starts a 5s interval that broadcasts a `positions_update` event with live prices to all connected dashboard clients. (`src/api/server.ts`)
   7. `startTelegramListener(contexts)` — connects to MTProto if all three env vars present (returns `{client:null, connected:false}` if any missing — graceful). On a matching message it extracts every `0x[a-fA-F0-9]{40}` address, deduplicates with a 5s cooldown, and routes each address to every chain where `getCode(address) !== '0x'` (multi-chain dispatch). (`src/telegramListener.ts`)
   8. `initMultiChainShutdownHandler` installs `SIGINT` / `SIGTERM` handlers that close the API server, disconnect Telegram, clear all exit-timers, destroy WebSocket providers, close the DB, then `process.exit(0)` — with a 5s force-exit safety net.

---

## 4. Top-Level Directory Map

| Path | Purpose |
|------|---------|
| `src/` | TypeScript bot code (the production runtime) |
| `contracts/` | Solidity contracts (`FakeToken.sol` for Sepolia test, `honeypot/HoneypotChecker.sol` for the audited pre-buy roundtrip simulator) |
| `ignition/modules/` | Hardhat Ignition deploy module for `HoneypotChecker` (`HoneypotChecker.ts`) |
| `scripts/` | Operational TypeScript scripts: `deploy-honeypot-checker.ts` (per-chain Ignition wrapper), `check-mythril-report.ts` (CI severity gate), `addLiquidity.ts` + `deploySepoliaTest.ts` (Sepolia test fixtures), `check-empty-files.sh` (pre-commit guard) |
| `dashboard/` | React + Vite + Tailwind SPA. Builds to `dashboard/dist/` which Express serves statically |
| `test/` | Vitest suites: `unit/`, `integration/`, `fork/`, plus `fixtures/` and `helpers/` |
| `test/fixtures/contracts/Honeypot.sol` | 5-mode contrived honeypot Solidity fixture used by fork tests (Hardhat config includes this path via a subtask override) |
| `test/fork/fixtures/honeypots/` | JSON fixtures: `eth-sell-revert.json`, `eth-max-wallet.json`, `eth-v3-honeypot.json` |
| `test/fixtures/mythril/` | Mythril sample reports for unit-testing the severity gate (`sample-high.json`, `sample-clean.json`) |
| `.github/workflows/` | One workflow file: `test.yml` — runs unit + integration tests, `.todo` ban, three `tsc --noEmit`, and (only when `contracts/**` is touched) hardhat-compile + slither + mythril gates |
| `.planning/` | Project-management directory: phases, milestones, requirements, state. Out of README scope but present at repo root |
| `docs/` | Long-form internal docs: `ARCHITECTURE.md`, `CONFIGURATION.md`, `DEVELOPMENT.md`, `GETTING-STARTED.md`, `TESTING.md` |
| `data/` | Runtime artifact: SQLite database lives here (gitignored) |
| `artifacts/`, `cache/`, `typechain-types/`, `coverage/`, `dist/`, `reports/` | Build outputs from Hardhat / TypeChain / Vitest / Slither / Mythril (gitignored) |
| `GOING-LIVE.md` | First-time-setup runbook for live mainnet trading (still at root; STATE.md notes a planned move to `docs/operations/`) |
| `HONEYPOT-SIM-BRIEFING.md` | Bug write-up for the broken V2/V3 sell-sim; informed the v6.17 Phase 18 architecture decisions |
| `README.md` | Existing README — about to be replaced |
| `hardhat.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.bot.json`, `eslint.config.mjs`, `.env.example`, `.npmrc`, `.gitignore` | Standard tooling configs |

---

## 5. `src/` Subdirectory Map

### `src/bot.ts` (entry point, ~950 lines)
Houses the multi-chain orchestrator. Key exports:
- `startMultiChainBot()` — full boot sequence (registry build, chain validation, listener wiring, monitor resume, API server, Telegram, shutdown)
- `handleNewPairForChain(ctx, dex, t0, t1, pair)` — V2 path: blocklist → `isKnownBadTokenForChain` → `canSnipe` → `simulateSellForChain` (FIX-04 gate, **currently broken**, see §14) → 8-call `Promise.all` safety bank → reserves snapshot → Telegram alert → `swapExactETHForTokens` via `sendTxWithRetry` → `recordSnipe` + `insertTrade` → `startExitMonitor`
- `handleNewV3PoolForChain(ctx, dex, t0, t1, fee, pool, block)` — V3 path: `waitForLiquidity` (Mint subscribe with 30s timeout, same-block check first) → `checkMinLiquidity` (QuoterV2 reference quote + threshold quote) → identical risk + safety chain → `simulateSellV3ForChain` (**vacuous-pass on zero balance**, see §14) → `exactInputSingle` wrapped in `multicall(deadline, [...])` since SwapRouter02 dropped the deadline field
- `startDexListener(ctx, dex, registry)` — WS-first; falls back to HTTP polling. Includes exponential-backoff reconnect (1s→60s cap) with full re-subscription on `close`
- `resumeMultiChainMonitoring`, `initMultiChainShutdownHandler` — restart and shutdown logic

### `src/chainRegistry.ts`
Source-of-truth for chain config. Defines `ChainConfig`, `DexConfig` (discriminated union over `dexType: 'v2' | 'v3'`), `MevStrategyType`, `GasConfig`, `SafetyApiConfig`, `HoneypotCheckerConfig`. Hardcoded `CHAIN_TEMPLATES` for ETH/BSC/Base/Arb with router/factory addresses, WETH addresses, MEV strategy, gas profile, default snipe/capital amounts. `buildChainRegistry()` overlays env (`ENABLED_CHAINS`, per-chain RPC URLs, capital, honeypot-checker address, tax-threshold bps) with fail-loud range validation on bps fields. `createChainContext(chain)` produces the runtime `ChainContext` with cached providers and a chain-scoped logger.

### `src/config.ts`
Legacy single-chain CONFIG object + env validation. Defines `REQUIRED_ENV_VARS` (33 entries with descriptions), the validation routine, and a backward-compatible single-chain RPC map (`{sepolia, mainnet, bsc}`). New code reads `ChainConfig` from `chainRegistry`; only the exit engine still pulls trailing-stop / volatility / urgency tuning from `CONFIG`.

### `src/exitEngine.ts` (~1100 lines)
Phase 7 unified exit engine. Single 5s `setInterval` per open position. Computes:
- **Stop loss** — flat % below entry, active until trailing activates at 2× entry
- **Partial sells** — env-configured tiers like `"2x:50,5x:25"` (50% sold at 2×, 25% more at 5×). Validation rejects total ≥ 100%. Uses BigInt math on `originalTokenAmount`. Supports "gap" sells (price jumps past multiple unfilled tiers in one poll → combined sell).
- **Trailing stop** — base pct widened by volatility multiplier (coefficient of variation of last ≥12, ≤60 price samples) and tightened by age-weighted urgency (linear decay over 30 min). Clamped to `[trailingMinPct, trailingMaxPct]`.
- **Time-urgency** — at age > 30 min the urgency multiplier hits 0 → hard market sell
- **Persistence** — exit state is upserted to `exit_state` table (one row per `trade_id`) every poll cycle, so a restart resumes with full high-water mark, completed tiers, original amount, urgency anchor, and volatility samples preserved.

Exports: `startExitMonitor`, `resumeExitMonitor`, `executeFullSell`, `VolatilityTracker`, `parsePartialSellTargets`, `buildExitConfig`, `exitConfig` (singleton), plus pure helpers `computeUrgencyMultiplier` / `computeEffectiveTrailingPct` / `getUnfilledTiers` / `calculatePartialSellAmount` / `queryPrice` / `serializeExitState` / `deserializeExitState`.

### `src/riskManager.ts`
5-rule canSnipe gate, evaluated sequentially first-failure-returns. Each rule has its own DB query (or in-memory map for cooldown):
1. **Position size** (`MAX_POSITION_SIZE` hard cap)
2. **Daily loss limit** (rolling 24h, `DAILY_LOSS_PCT` of per-chain `maxCapital`)
3. **Max open positions** (`MAX_OPEN_POSITIONS`, global across chains)
4. **Cooldown** (`SNIPE_COOLDOWN_MS`, per chain, in-memory map cleared on restart by design)
5. **Total exposure cap** (`MAX_TOTAL_EXPOSURE`, sum of `amount_in - partial_sell.amount_out` across all open positions)

Returns `{allowed, reason?, details?}` for Telegram-friendly rejection messages. `recordSnipe(chain)` stamps the cooldown map after TX submission. `getPortfolioExposure()` returns total + per-chain breakdown for the dashboard.

### `src/telegramListener.ts`
MTProto user-account listener (separate from the bot's outbound message API). Greps each new message for `0x[a-fA-F0-9]{40}` addresses, deduplicates the address set, enforces a 5s cooldown across all addresses, applies allowlists (`TELEGRAM_ALLOWED_SENDERS` and `TELEGRAM_ALLOWED_CHANNELS`, OR-combined), then for each address runs `getCode(address)` against every chain context and forwards to `handleAlphaDropForChain` for chains where the contract exists.

### `src/alphaDrop.ts`
Pair/pool discovery helper for the Telegram listener. For each DEX on the chain: V2 calls `factory.getPair(token, WETH)`; V3 tries fee tiers `[500, 3000, 10000]` via `factory.getPool(...)`. First match wins; calls `handleNewPairForChain` or `handleNewV3PoolForChain` from `bot.ts` (dynamic import to break the circular dep).

### `src/api/` — Express + WebSocket layer
- **`server.ts`** — assembles middleware (helmet, cors with credentials, cookie-parser, express.json), mounts routers in the strict order `health → auth → /api/* (gated)` → static `dashboard/dist/` → SPA catchall → error middleware. Starts the 5s position-broadcast interval.
- **`routes/health.ts`** — unauthenticated `GET /health`. Returns `{status, version, uptime, chains[{name, displayName, connected, latestBlock, wsConnected}], positions:{open, totalExposure, dailyPnL}, telegramConnected, telegramError}`. Returns 503 if any chain is disconnected.
- **`routes/auth.ts`** + **`middleware/auth.ts`** — `POST /api/auth/login` with `timingSafeEqual` against `DASHBOARD_API_KEY`, mints a UUID session, sets an httpOnly cookie (24h TTL, `sameSite:'strict'`, `secure` in production). In-memory session store with an hourly cleanup interval.
- **`routes/positions.ts`** — `GET /api/positions` using a shared `buildPositionsWithLivePrices(contexts)` helper that joins DB rows with live on-chain prices.
- **`routes/trades.ts`** — `GET /api/trades` (paginated, filterable by chain / date range / outcome `profit|loss|all`, max 50/page) and `GET /api/trades/export` (CSV with formula-injection-safe escaping for `= + - @ \t \r` prefixes).
- **`routes/risk.ts`** — `GET /api/risk/exposure` (donut), `GET /api/risk/pnl?range=24h|7d|30d|all` (cumulative line-chart data points with pro-rated buy cost across partial sells), `GET /api/risk/limits` (position / exposure / daily-loss utilization).
- **`routes/chains.ts`** — `GET /api/chains` (status, masked RPC hostnames, snipe params, risk limits, exit strategy summary, dex names), `POST /api/chains/:name/stop` (removes WS listeners but keeps providers alive for exit monitors), `POST /api/chains/:name/start` (calls the orchestrator's `onRestart` callback). Broadcasts `chain_status_change` events on transition.
- **`routes/controls.ts`** — `POST /api/controls/force-sell/:tradeId` (per-position), `POST /api/controls/emergency-sell` (sequential market-sell of all open positions, returns a per-position success/failure manifest). Always clears exit timers before invoking `executeFullSell` to eliminate races.
- **`ws/handler.ts`** + **`ws/broadcaster.ts`** — upgrade handler validates the session cookie on connection; broadcaster maintains a `Set<WebSocket>` of authenticated clients and pushes typed `{type, data, timestamp}` JSON events. Used for `positions_update` (5s), `chain_status_change` (on stop/start), and `notification` (every Telegram alert is fanned out to the dashboard with `inferSeverity` / `inferCategory` heuristics — see `src/utils/notifier.ts:75-98`).
- **`middleware/errorHandler.ts`** — `asyncHandler` wrapper + final-fallback `errorMiddleware`.

### `src/utils/`

| File | Purpose |
|------|---------|
| `abis.ts` | All Uniswap V2/V3, ERC20, PAIR, WETH ABIs centralized (FACTORY_ABI, ROUTER_ABI, ERC20_ABI, PAIR_ABI, TOKEN_LIMITS_ABI, V3_FACTORY_ABI, V3_POOL_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI, WETH_ABI) |
| `db.ts` | better-sqlite3 singleton, WAL pragmas, 4-version migration ladder, JSON→SQLite legacy migration, prepared statements (`insertTrade`, `updateTradeStatus`, `isTokenSniped`, `upsertExitState`, `getExitState`, `deleteExitState`, `getOpenPositionCount`, `getTotalExposure`, `getDailyRealizedLoss`, `getTradeIdForPendingToken`), `getPnL()` and `getPnLChartData()` query builders |
| `logger.ts` | pino singleton with ISO timestamps, level from `LOG_LEVEL` |
| `provider.ts` | Cached HTTP + WS provider factories, keyed by network name |
| `notifier.ts` | `sendTelegramAlert`, `sendChainAlert`, `sendCtxAlert` — outbound message API + dashboard WS fan-out with severity/category heuristics |
| `retry.ts` | Generic retry wrapper used by axios calls |
| `blocklist.ts` | Two `Set<string>` for hand-curated blocked token and pair addresses (currently empty — populated manually) |
| `flashbots.ts` | Legacy single-chain Flashbots provider factory (kept for `sendTxWithRetry`'s legacy overload) |
| `gasManager.ts` | `getGasOptions()` helper for legacy code path |
| `pairDiscovery.ts` | Small V2 pair query helper |
| `receiptDecoder.ts` | After every sell, parses receipt logs to extract `amountOut` (V2 = WETH Withdrawal event; V3 = WETH Transfer-to-wallet event) + `gasCost` (gasUsed × effectiveGasPrice) + `blockNumber`. One 2s retry if receipt is null. Returns `{amountOut, gasCost, blockNumber}` with nullable fields. |
| `txManager.ts` | `createMevStrategy(chain)` factory + `sendTxWithRetry(txBuilder, ctx|provider, ...)` with dual signature (new ChainContext overload + legacy 5-arg overload). Dispatches to FlashbotsMevStrategy / BloxrouteMevStrategy / PassthroughMevStrategy. |
| `exitManager.ts` | Per-token sell mutex (composite `chain:token` keys) + multi-timer registry (stop-loss / take-profit / timed / unified). `tryAcquireSellLock` / `releaseSellLock` / `clearAllTimersForToken` / `clearAllTimers`. |
| `mevStrategies/types.ts` | `MevStrategy` interface (`name`, `healthCheck()`, `sendTransaction(tx, wallet, provider, maxRetries) → txHash`) |
| `mevStrategies/flashbots.ts` | `FlashbotsBundleProvider.create` + `sendBundle` to next block. Three retries (nonce bumped each attempt). Defensive null-check on `bundle.bundleTransactions[0].hash` — throws if the lib response is malformed (Phase 14 hardening). |
| `mevStrategies/bloxroute.ts` | `bsc_private_tx` JSON-RPC via axios + `Authorization` header. `healthCheck()` pings with a benign call and inspects 401/403 codes. |
| `mevStrategies/passthrough.ts` | Direct `wallet.sendTransaction` + `tx.wait(3)`. `healthCheck()` always returns true (Base/Arbitrum have natively private mempools). Uses EIP-1559 fee data when available, falls back to legacy `gasPrice`. |
| `safetyProviders/honeypotIs.ts` | honeypot.is `/v2/IsHoneypot` adapter. Returns `true` (block) on API failure. Used for ETH + Base. |
| `safetyProviders/goplus.ts` | GoPlus Security `/v1/token_security/{chainId}` adapter. Covers all four chains. Provides `goplusHoneypotCheck` and `goplusLiquidityLockCheck`. |
| `safetyProviders/unicrypt.ts` | Unicrypt lock-status query (ETH only). |
| `safetyProviders/mudra.ts` | Mudra lock-status query (BSC only). |
| `safetyProviders/types.ts` | Shared interface for safety-API adapters. |
| `tokenSafety.ts` | The "parallel safety bank" pipeline (`checkHoneypotForChain`, `isLiquidityLockedForChain`, `isBlacklistedTokenForChain`, `isLiquiditySufficientForChain`, `checkTokenMetadataForChain`, `simulateSwapForChain`, `hasHighTransferTaxForChain`, `hasMaxWalletOrTxLimitsForChain`, `isKnownBadTokenForChain`, `simulateSellForChain` and `simulateSellV3ForChain`). Each function dispatches to chain-specific providers via `ChainContext`. Both `simulateSell*` functions are the broken FIX-04 / V3-03 gates being rebuilt in Phase 18. |
| `honeypot/types.ts` | Discriminated-union `HoneypotResult` (`safe | unsafe | unknown`) where the `safe` variant requires `buyTaxBps` and `sellTaxBps` as non-optional numbers — making the vacuous-pass `{verdict:'safe', evidence:{}}` literal a `tsc --noEmit` error by construction. Also `HoneypotCheckerConfig`, `HoneypotProbeResult`. |
| `honeypot/abi.ts` | ABI for the deployed `HoneypotChecker` contract (consumed by the dispatch layer once plan 18-09 ships) |
| `honeypot/index.ts` | `simulateHoneypotRoundtrip(ctx, dex, token)` dispatcher. Routes on `method ∈ {on-chain-contract, eth_simulateV1}` and `dexType ∈ {v2, v3}`. NEVER throws — bad method or missing `deployedAddress` returns `verdict:'unknown'` (one-shot skip, no retry). |
| `honeypot/checkerContract.ts` | **Phase 18 placeholder** — `simulateViaContractV2` and `simulateViaContractV3` currently return `verdict:'unknown'` with reason `'NOT_IMPLEMENTED: checkerContract wave-5 deliverable'`. Plan 18-09 overwrites this file with the real `provider.call → encodeFunctionData('checkV2'|'checkV3', [...]) → parseError → multi-amount aggregation` implementation. A literal-sentinel grep gate in the plan asserts the placeholder string is gone post-overwrite. |
| `honeypot/simulator.ts` | **Stub only** — Option-C `eth_simulateV1` path. Returns `verdict:'unknown', reason:'NOT_IMPLEMENTED: eth_simulateV1 path is stubbed in Phase 18'`. Activated only if a chain's Option-D deploy is genuinely blocked in a future milestone. |
| `honeypot/bytecodeScan.ts` | **Shipped (HONEY-12)** — `isMutableTokenForChain(ctx, token) → {isMutable, hits}`. Substring-scans `getCode(token)` against 19 verified 4-byte selectors for `setTax`/`setBuyTax`/`setSellTax`/`setFees`/`setMaxWallet*`/`setMaxTxAmount`/`setBlacklist`/`blacklist`/`excludeFromFees`/`pauseTrading`/`setTrading*`. Fail-closed: on `getCode` throw returns `{isMutable:true, hits:['scan-failed']}`. **Not yet wired into bot.ts:229** — that wire-up is plan 18-09's job, and the HONEY-12 requirement row in `.planning/REQUIREMENTS.md` remains Pending until then. |

---

## 6. Smart Contracts (`contracts/`)

### `contracts/FakeToken.sol` (~13 lines)
Trivial ERC20 with a public `mint(address, uint256)` for Sepolia test fixtures. Imports `@openzeppelin/contracts/token/ERC20/ERC20.sol`. Compiled with `^0.8.28`.

### `contracts/honeypot/HoneypotChecker.sol` (~360 lines)
The centerpiece of the v6.17 pre-buy safety rebuild. **Immutable, stateless, eth_call-only revert-always pre-buy roundtrip simulator** for both Uniswap V2 and V3 routers.

**Design properties (per `D-CONTRACT-IMMUTABLE` in CONTEXT decisions):**
- No owner key, no proxy, no `killSwitch`, no `selfdestruct`, no `tx.origin` use. Patch path is "deploy v2 at a new address and update env."
- The contract **always reverts** at the end; results are encoded in the revert payload (`error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status)` for V2 and `RoundtripResultV3(...)` for V3). The dispatcher decodes the error to get the verdict — there is no state-changing call path.
- Caller MUST require `status === 0x07` (all three bits set) to consider the token safe.

**Status bitmap:**
- `0x01` = sold-back-some-ETH (post-sell ETH/WETH balance increased)
- `0x02` = balance-nonzero-after-buy (catches lying-`balanceOf`)
- `0x04` = sell-completed-without-revert

**Entry points:**
- `checkV2(router, token, amountIn) external payable` — `msg.value` must equal `amountIn`. Performs buy via `swapExactETHForTokens(0, [WETH, token], this, +60)`, then approves and sells via `swapExactTokensForETHSupportingFeeOnTransferTokens`. Computes `buyTaxBps` and `sellTaxBps` from `getAmountsOut` vs actual deltas.
- `checkV3(swapRouter, quoter, token, amountIn, fee)` — uses `QuoterV2.quoteExactInputSingle` for expected outputs and `SwapRouter02.exactInputSingle` for execution. Notes that V3 returns WETH (not ETH) to the recipient, so accepts WETH balance as the success signal; reverts with `V3_SELL_WETH_ZERO` if zero.
- Specific revert channels: `BuyFailed(reason)`, `SellFailed(reason)`, `QuoteFailed(reason)` — including string reasons `BUY_BAL_ZERO`, `BUY_BAL_LIE`, `SELL_ETH_ZERO`, `V3_SELL_WETH_ZERO`.

**Audit status (HONEY-02, plan 18-05, committed 2026-05-15):**
- **Slither 0.11.5** with `--exclude-informational --exclude-low --fail-medium`: 13 medium+ findings (4 High + 9 Medium). **All 13 dispositioned as false-positive** against the eth_call-only revert-always design (`arbitrary-send-eth` ×2 = caller-chosen router is by design; `reentrancy-balance` ×2 = the documented lying-balanceOf catch IS the reentrancy-balance pattern; `unused-return` ×6 = balance-delta reads deliberately override router-returned values; `uninitialized-local` ×2 = catch-always-reverts hides the flow path; `incorrect-equality` ×1 = `V3_SELL_WETH_ZERO` is the correct strict-equality semantic).
- **Mythril 0.24.8** with `--execution-timeout 300 --max-depth 30`: `success: true, issues: []`.
- **Stop-the-Line determination:** no escalation; deploy gate cleared for HONEY-03.
- Disposition table preserved at `.planning/milestones/v6.17-honeypot-checker-audit.md`.

**CI gate (committed 2026-05-15):** `.github/workflows/test.yml` uses `dorny/paths-filter@v3` to detect `contracts/**` changes, then runs three gated jobs (`hardhat-compile`, `slither`, `mythril`) that fail the build on any new medium+ finding. The pre-existing test job's Phase-17 evergreen guards (`.todo` ban + three `tsc --noEmit` invocations) are preserved verbatim.

**Deploy story (plan 18-06, committed 2026-05-15):**
- Hardhat networks for `mainnet`, `bsc`, `base`, `arbitrum` are conditionally added when both `<CHAIN>_RPC_URL` and `DEPLOY_PRIVATE_KEY` are set. The existing `sepolia` entry continues to use `PRIVATE_KEY` for test-only deploys.
- **Capability split:** the four production networks use `DEPLOY_PRIVATE_KEY` — a **separate** deploy wallet — never the bot's `PRIVATE_KEY`. If the bot wallet leaks, the attacker drains funds but cannot deploy a malicious checker at a trusted address.
- Etherscan/BscScan/BaseScan/ArbiScan API keys wired through `hardhat.config.ts:etherscan.apiKey` (using canonical `arbitrumOne` key name).
- `ignition/modules/HoneypotChecker.ts` is a 10-line Ignition module with no constructor args.
- `scripts/deploy-honeypot-checker.ts <chain>` is a thin pino-logging CLI wrapper that maps `eth|bsc|base|arb` to the corresponding hardhat network name and spawns `npx hardhat ignition deploy`. Deliberately does NOT auto-update `chainRegistry.ts` — operators paste the deployed address into `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` in `.env` and run `npx hardhat verify --network <network> <address>` manually. Audit-trail decision (T-18-23 mitigation).

**Wire-up status:** the dispatcher (`src/utils/honeypot/index.ts`) is shipped. The contract is audited. The deploy CLI is shipped. The `checkerContract.ts` adapter and the parallel-safety-bank wire-up at `src/bot.ts:229-238` are **plan 18-09 work** — see §14.

---

## 7. Chain & DEX Integrations

| Chain | chainId | Native | WETH/W-native | MEV strategy | DEXes (V2) | DEXes (V3) |
|-------|---------|--------|---------------|--------------|------------|------------|
| **eth** | 1 | ETH | `0xC02aaA39…56Cc2` | flashbots (`relay.flashbots.net`) | uniswap-v2, sushiswap-v2 | uniswap-v3 |
| **bsc** | 56 | BNB | `0xbb4CdB…5c` (WBNB) | bloxroute (`api.blxrbdn.com`) | pancakeswap-v2, biswap-v2 | uniswap-v3, pancakeswap-v3 |
| **base** | 8453 | ETH | `0x4200…0006` | passthrough (native private mempool) | uniswap-v2, aerodrome | uniswap-v3 |
| **arb** | 42161 | ETH | `0x82aF49…Bab1` | passthrough (FCFS ordering) | uniswap-v2, camelot-v2 | uniswap-v3 |

All factory, router, quoter, and swap-router addresses are hardcoded in `CHAIN_TEMPLATES` (`src/chainRegistry.ts:121-296`). Each chain has its own native gas profile (`eip1559` vs `legacy`) and max gas limit (300k for ETH up to 1M for Arbitrum), per-chain default snipe amount (0.005 to 0.05 native) and default max-capital, default minimum liquidity threshold (0.1 to 1.0 native), and per-chain default tax thresholds (`defaultMaxBuyTaxBps: 1000`, `defaultMaxSellTaxBps: 1000` = 10%).

**RPC providers:** anything supporting standard JSON-RPC. The example uses Alchemy. `ETH_WS_URL` is strongly recommended — without it the bot falls back to 2s HTTP polling and "misses most launches" (per `GOING-LIVE.md`).

**Third-party safety APIs:**
- **honeypot.is** — `https://api.honeypot.is/v2/IsHoneypot?address=&chainID=` (ETH, Base)
- **GoPlus Security** — `https://api.gopluslabs.io/api/v1/token_security/{chainId}` (all chains, no API key needed for basic use)
- **Unicrypt** — `https://api.unicrypt.network/api/v2/locker/pair/{addr}?chainId=11155111` (ETH liquidity lock)
- **Mudra** — BSC liquidity lock

Per-chain assignment is in each `CHAIN_TEMPLATES[chain].safetyApis`: e.g. ETH uses `honeypot:'honeypot.is', liquidityLock:'unicrypt', tokenSecurity:'goplus'`; BSC uses `honeypot:'goplus', liquidityLock:'mudra', tokenSecurity:'goplus'`.

---

## 8. Honeypot / Safety Logic

### Pre-buy gate sequence (`src/bot.ts:174-273` V2, `src/bot.ts:353-446` V3)

1. **Already-sniped dedup** — `isTokenSniped(token, chain)` chain-scoped (CHAIN-02 + Phase-15 legacy-mainnet→eth normalizer)
2. **Token blocklist** — `BLOCKLIST.tokens` Set (manually curated, currently empty)
3. **Pair blocklist** — `BLOCKLIST.pairs` Set (manually curated, currently empty)
4. **`isKnownBadTokenForChain`** — verifies non-empty `getCode` plus blocklist
5. **Risk gate** — `canSnipe(chain, snipeAmount, maxCapital)`: position size, daily loss, max open, cooldown, exposure cap (see §5 `riskManager.ts`)
6. **(V3 only)** `waitForLiquidity` — subscribes to `Mint` on the pool with a 30s timeout; checks same-block `Mint` first (atomic launch scripts)
7. **(V3 only)** `checkMinLiquidity` — QuoterV2 reference + threshold quote
8. **Pre-buy sell simulation** — `simulateSellForChain` (V2) or `simulateSellV3ForChain` (V3) — *FIX-04 gate, currently broken — see §14*
9. **Parallel safety bank (`Promise.all`)** —
   - `checkHoneypotForChain` (chain-aware: honeypot.is or GoPlus)
   - `isBlacklistedTokenForChain` (bytecode scan for 3 anti-bot selectors)
   - `isLiquidityLockedForChain` (chain-aware: Unicrypt / Mudra / GoPlus + burn-check fallback)
   - `isLiquiditySufficientForChain` (V2 only — pair reserves ≥ 1 native unit)
   - `checkTokenMetadataForChain` (name/symbol/decimals sanity + `tradingEnabled` if exists)
   - `simulateSwapForChain` (V2 staticCall round-trip for buy direction)
   - `hasHighTransferTaxForChain` (`getAmountsOut` vs actual `swapExactETHForTokens` static-call output; threshold 25%)
   - `hasMaxWalletOrTxLimitsForChain` (probes `maxWalletAmount` / `maxWallet` / `maxTxAmount` / `maxTransactionAmount` — flags any < 1% of total supply)

All eight returns are OR-combined into a single block — any failure aborts the buy with a Telegram alert.

### Post-buy safety
- `executeFullSell` and partial sells use the **same router** that was used for the buy (V2 router or V3 SwapRouter02 + Quoter). Sell paths are routed via the per-chain MEV strategy (Flashbots / bloXroute / passthrough).
- Slippage is computed via `getAmountsOut` (V2) or `QuoterV2.quoteExactInputSingle` (V3) and applied to `amountOutMinimum`. Default `slippagePercent=5` (`src/config.ts:119`).
- **Sell mutex** in `exitManager.ts` (composite `chain:token` keys) prevents two interval callbacks both deciding to sell in the same JS event-loop tick.
- **Receipt decoder** (`src/utils/receiptDecoder.ts`) extracts `amount_out` from WETH `Withdrawal` (V2) or `Transfer→wallet` (V3) events; one 2s retry if the receipt isn't yet available. Falls back to `null` if no matching event found — exposes that in DB so P&L queries can detect the case.

### v6.17 honeypot rebuild architecture (in flight)
- **Option D (primary):** the audited on-chain `HoneypotChecker` contract above, deployed once per chain with a separate `DEPLOY_PRIVATE_KEY`. Called via `provider.call(...)` with `msg.value === amountIn`, decoded from the revert payload.
- **Option C (opt-in fallback):** `eth_simulateV1` with state overrides. Stubbed today; activated per-chain only if Option D deploy is blocked.
- Both routes feed the same discriminated-union `HoneypotResult` (`safe` requires non-optional `buyTaxBps` + `sellTaxBps`, making vacuous pass a compile error).
- **HONEY-12 bytecode scan** (`bytecodeScan.ts`) is shipped and unit-tested but not yet wired into `bot.ts:229-238` — that wire-up is plan 18-09.

---

## 9. Data Model & Persistence

### SQLite database — `./data/bot.db` (or `DB_PATH`)
- WAL journal mode, NORMAL synchronous, 5s busy timeout (`src/utils/db.ts:20-24`)
- Schema migrations run automatically at module load (version 4 current)

### Table: `trades`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `token` | TEXT NOT NULL COLLATE NOCASE | |
| `chain` | TEXT NOT NULL DEFAULT 'eth' | values: `eth`, `bsc`, `base`, `arb` |
| `action` | TEXT NOT NULL CHECK in (`buy`, `sell`, `partial_sell`, `fail`) | |
| `tx_hash` | TEXT | `mev_bundle` for Flashbots until receipt decoded |
| `block` | INTEGER | |
| `timestamp` | INTEGER NOT NULL | unix epoch |
| `amount_in` | TEXT | native-currency string |
| `amount_out` | TEXT | bigint string from receipt decoder, nullable |
| `gas_cost` | TEXT | bigint string (gasUsed × effectiveGasPrice), nullable |
| `price_at_action` | TEXT | |
| `status` | TEXT CHECK in (`pending`, `sold`, `failed`) | |
| `pool_type` | TEXT CHECK in (`v2`, `v3`) | |
| `fee_tier` | INTEGER | V3 only (500, 3000, 10000…) |
| `dex_name` | TEXT | `uniswap-v2`, `pancakeswap-v3`, etc. |

Indexes on `token`, `chain`, `timestamp`, `status`.

### Table: `exit_state` (one row per open trade)
| Column | Type | Notes |
|--------|------|-------|
| `trade_id` | INTEGER PK, FK → trades.id | |
| `entry_price` | REAL | |
| `high_water_mark` | REAL | |
| `trailing_activated` | INTEGER 0/1 | |
| `partial_tiers_completed` | TEXT (JSON array) | indices of filled tiers |
| `original_token_amount` | TEXT (BigInt as string) | |
| `urgency_start_ts` | INTEGER | |
| `volatility_samples` | TEXT (JSON array of price samples) | |

### P&L (computed, not stored — `getPnL()` query in `src/utils/db.ts:241-274`)
A single self-join over `trades` aggregates `buy.amount_in`, `buy.gas_cost`, and `SUM(sell.amount_out − sell.gas_cost)` across `sell` and `partial_sell` actions, producing `realized_pnl` and `sell_count` per buy. Filters by `token` / `chain` / `fromTimestamp` / `toTimestamp` (nullable bound vars). Powers `/api/trades` and `/api/risk/pnl`. Per-event chart data uses `getPnLChartData()` which pro-rates buy cost equally across all sell events for a position.

### Risk queries
- `getOpenPositionCount` — `WHERE status='pending' AND action='buy'`
- `getTotalExposure` — `SUM(amount_in − Σ partial_sell.amount_out)` for open positions
- `getDailyRealizedLoss(chain, since)` — sum of negative-P&L sells over rolling 24h, per chain
- `exposureByChain` — grouped by chain for the dashboard donut

### Domain types (TypeScript)
- **`ChainConfig`** — full chain shape (`src/chainRegistry.ts:54-80`)
- **`DexConfig`** = `DexConfigV2 | DexConfigV3` (discriminated on `dexType`)
- **`ChainContext`** = `{chain, httpProvider, wsProvider, wallet, log}`
- **`HoneypotResult`** = `{verdict:'safe', evidence:{buyTaxBps:number, sellTaxBps:number, ...}} | {verdict:'unsafe', reason, evidence} | {verdict:'unknown', reason, evidence}`
- **`HoneypotCheckerConfig`** = `{deployedAddress, method:'on-chain-contract'|'eth_simulateV1', maxBuyTaxBps, maxSellTaxBps}`
- **`ExitConfig`**, **`ExitStateData`**, **`PartialTier`**, **`VolatilityTracker`** — in `src/exitEngine.ts`
- **`MevStrategy`** interface — `src/utils/mevStrategies/types.ts`
- **`ReceiptData`** = `{amountOut:string|null, gasCost:string|null, blockNumber:number|null}`

### Auxiliary state
- `.bot-state.json` — legacy single-chain JSON snapshot. Imported into SQLite once at first boot and renamed to `.bak`. The current repo holds `.bot-state.json.bak` (89 bytes, dated 2026-03-22) — the migration already ran.
- Sessions: in-memory `Map<token, {createdAt}>` with 24h TTL and hourly cleanup interval (sessions do not survive restart).
- Cooldown timestamps: in-memory `Map<chain, ms>` (resets on restart by design — RISK-04 D-09).

---

## 10. Configuration & Environment

### Environment variables (full list at `.env.example`, validated at startup in `src/config.ts:13-66`)

**Required (8):**
- `PRIVATE_KEY` — bot wallet
- `ALCHEMY_URL` — legacy fallback for `ETH_RPC_URL`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — outbound alerts
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` — alpha-drop listener (MTProto)
- `DASHBOARD_API_KEY` — dashboard login

**Multi-chain:**
- `ENABLED_CHAINS` (default `eth`)
- Per-chain: `<PREFIX>_RPC_URL`, `<PREFIX>_WS_URL`, `<PREFIX>_SNIPE_AMOUNT`, `<PREFIX>_MAX_CAPITAL`, `<PREFIX>_MIN_LIQUIDITY` for prefixes `ETH`, `BSC`, `BASE`, `ARB`

**MEV (conditional on chain):**
- `FLASHBOTS_AUTH_KEY` — required when `eth` enabled
- `BLOXROUTE_AUTH_HEADER` — required when `bsc` enabled

**Risk:**
- `MAX_OPEN_POSITIONS` (10), `MAX_TOTAL_EXPOSURE` (10.0), `DAILY_LOSS_PCT` (10), `SNIPE_COOLDOWN_MS` (30000), `MAX_POSITION_SIZE` (empty = use chain snipe)

**Exit strategy:**
- `TRAILING_STOP_PCT` (15), `TRAILING_MIN_PCT` (5), `TRAILING_MAX_PCT` (40), `STOP_LOSS_PCT` (25), `PARTIAL_SELL_TARGETS` (e.g. `"2x:50,5x:25"`)

**HoneypotChecker (Phase 18):**
- `<PREFIX>_HONEYPOT_CHECKER_ADDRESS` per chain (operator-pasted after deploy)
- `<PREFIX>_MAX_BUY_TAX_BPS`, `<PREFIX>_MAX_SELL_TAX_BPS` (default 1000 = 10%, validated `[0, 10000]` with fail-loud on NaN)
- `DEPLOY_PRIVATE_KEY` — **only** for `scripts/deploy-honeypot-checker.ts` (separate from `PRIVATE_KEY` per D-DEPLOY-KEY capability split)
- `ETHERSCAN_API_KEY`, `BSCSCAN_API_KEY`, `BASESCAN_API_KEY`, `ARBISCAN_API_KEY` for `hardhat verify`

**Dashboard:**
- `DASHBOARD_PORT` (8080), `DASHBOARD_HOST` (127.0.0.1)

**General:**
- `LOG_LEVEL` (info), `DB_PATH` (./data/bot.db), `NETWORK` (legacy single-chain selector), `NODE_ENV` (used to gate `secure` cookie flag), `ETH_FORK_RPC_URL` (for hardhat fork tests)

### TypeScript configs
- `tsconfig.json` — root project + dashboard
- `tsconfig.bot.json` — bot-only, used by `tsc --noEmit` CI guard

### Hardhat config (`hardhat.config.ts`)
- Solidity 0.8.28
- Networks built conditionally: `sepolia` (PRIVATE_KEY-gated), `mainnet`/`bsc`/`base`/`arbitrum` (DEPLOY_PRIVATE_KEY-gated)
- `hardhat` network has forking enabled when `ETH_FORK_RPC_URL` or `ALCHEMY_URL` is set
- Subtask override extends `TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS` to also compile `.sol` files under `test/fixtures/contracts/` (the Phase-18 multi-mode `Honeypot.sol` fixture)
- `etherscan.apiKey` block consumed by `hardhat-verify`

---

## 11. Tests & Coverage

### Framework
**Vitest 4.1.1** with three projects (`vitest.config.ts:8-39`):
- **unit** — `test/unit/**/*.test.ts`, timeout 5s, `environment: 'node'`, `mockReset: true`
- **integration** — `test/integration/**/*.test.ts`, timeout 15s
- **fork** — `test/fork/**/*.test.ts`, timeout 120s, with `globalSetup: ['test/fork/setup.ts']` (boots a local mainnet fork via hardhat node)

### File counts (verified by find)
| Project | Files |
|---------|-------|
| Total `*.test.ts` | **43** |
| Unit | **29** |
| Integration | **13** |
| Fork | **1** |

### Coverage thresholds (`vitest.config.ts:46-52`)
70% lines / functions / branches / statements (v8 provider). HTML + JSON-summary reports written to `coverage/`. `src/dashboard/**` excluded.

### What's tested

**Unit suites (sampling):**
- `chainRegistry.test.ts` — env validation, range checks, registry build
- `riskManager.test.ts` — all 5 risk rules
- `exitEngine.test.ts`, `exitEngineSell.test.ts`, `exitEngineZeroBalance.test.ts` — partial tiers, volatility tracker, urgency math, gap-sells, zero-balance edge cases
- `tokenSafety.test.ts` — full safety-bank dispatch
- `safetyBank/*.test.ts` (8 files) — one test per ForChain function
- `honeypotTypes.test.ts` — discriminated-union compile-time + runtime asserts
- `bytecodeScan.test.ts` — HONEY-12 selector matching (asserts `MUTABLE_SELECTORS.length === 19`)
- `db.test.ts` — schema migration ladder + JSON migration
- `chainRegistry.test.ts` — config overlay
- `receiptDecoder.test.ts` — V2 Withdrawal / V3 Transfer parsing + null fallback
- `provider.test.ts` — singleton + remove
- `chainRestart.test.ts` — chain stop/start state machine
- `configEnvVar.test.ts` — env validation harm-prevention
- `telegramListener.test.ts` — whitelist, dedup, cooldown
- `ethersV6BigIntArithmetic.test.ts`, `ethersV5PatternsAbsent.test.ts`, `ethersV6ToolboxConfig.test.ts` — Phase 17 DEBT-05 retroactive harm-prevention assertions on the v5→v6 migration
- `codeQuality.test.ts` — lint-style assertions baked into CI
- `v3Abis.test.ts` — V3 ABI shape

**Integration suites:**
- `api/auth.test.ts`, `api/positions.test.ts`, `api/trades.test.ts`, `api/risk.test.ts`, `api/chains.test.ts`, `api/controls.test.ts`, `api/health.test.ts`, `api/wsPush.test.ts` — Express routers end-to-end against a test DB
- `txManager.test.ts`, `mevStrategies.test.ts` — MEV strategy dispatch and bundle handling
- `exitMonitor.test.ts`, `v3LiquidityWait.test.ts`, `wsReconnect.test.ts` — full event-driven scenarios

**Fork suite:**
- `snipeLifecycle.test.ts` (single file) — boots an Ethereum mainnet fork via Hardhat, exercises a full pair-detection → safety → buy → sell lifecycle against forked state. Excluded from CI (requires RPC access — see `.github/workflows/test.yml`).

### Test invariants enforced in CI
- `.todo` test-stub ban — fails the build if anyone uses `it.todo()` / `test.todo()` / `describe.todo()` (`.github/workflows/test.yml:20-33`)
- Three `tsc --noEmit` invocations against `tsconfig.json`, `tsconfig.bot.json`, `dashboard/tsconfig.json` (`.github/workflows/test.yml:34-39`)

### Known gaps
- `simulateSellForChain` / `simulateSellV3ForChain` honeypot-detection behavior is not asserted (would expose the broken-by-design FIX-04 / V3-03 implementations — see §14)
- No tests exercise the real `HoneypotChecker.sol` contract from TypeScript yet — adapters in `checkerContract.ts` are still placeholders pending plan 18-09

---

## 12. CI / CD / Tooling

### GitHub Actions (`.github/workflows/test.yml`)
Single workflow, triggered on push and pull_request to `main` / `master`. Five jobs:

1. **test** — Node 22 + `npm ci --legacy-peer-deps` → `npm run test:unit` → `npm run test:integration` → `.todo` ban grep → three `tsc --noEmit`. Always runs.
2. **detect-contract-changes** — `dorny/paths-filter@v3` to set `contracts: true` when `contracts/**` changed.
3. **hardhat-compile** — runs `npx hardhat compile` when (2) is true. 5-min timeout.
4. **slither** — installs `slither-analyzer` + `solc-select` (Python 3.11), pins solc 0.8.28, runs `slither contracts/honeypot/HoneypotChecker.sol --exclude-informational --exclude-low --filter-paths node_modules --json reports/slither-honeypot.json --fail-medium`. 5-min timeout. Depends on `hardhat-compile`.
5. **mythril** — installs `mythril` via pip, writes `reports/solc-settings.json` (remappings + optimizer off), runs `myth analyze contracts/honeypot/HoneypotChecker.sol --solc-json reports/solc-settings.json --solc-args "--allow-paths node_modules" --execution-timeout 300 --max-depth 30 -o json > reports/mythril-honeypot.json`, then `npx ts-node scripts/check-mythril-report.ts reports/mythril-honeypot.json` (the local severity gate written for plan 18-03 — exits 1 on any Medium/High issue, zero new npm deps). 10-min timeout. Depends on `hardhat-compile`.

Fork tests (`test:fork`) are **not** run in CI — they need RPC credentials.

### Operational scripts (`scripts/`)
- `deploy-honeypot-checker.ts` — per-chain Ignition wrapper described in §6
- `check-mythril-report.ts` — Mythril severity gate consumed by the CI workflow above
- `addLiquidity.ts`, `deploySepoliaTest.ts` — Sepolia test bootstrap
- `check-empty-files.sh` — pre-commit guard that catches 0-byte files (added 2026-04-29 after a cleanup sweep)

### Lint
ESLint 9 flat config (`eslint.config.mjs`) with `typescript-eslint`. Not currently wired into CI but available locally.

### Build
- Bot: `npm run build` → `tsc` → `dist/`
- Dashboard: `cd dashboard && npm run build` → `tsc -b && vite build` → `dashboard/dist/`

---

## 13. Implemented Features (Concrete List)

**Multi-chain detection & execution**
- WebSocket-first listener on `PairCreated` (V2) and `PoolCreated` (V3) for every configured DEX on every enabled chain, with exponential-backoff reconnect (1s → 60s cap) and full re-subscription on the new socket
- HTTP-polling fallback (2s interval) when no WebSocket URL is configured for a chain
- V3 `waitForLiquidity`: subscribes to `Mint` with a 30s deadline; also checks the same block first (atomic launch scripts emit `PoolCreated + Mint` in one block)
- V3 minimum-liquidity check via `QuoterV2.quoteExactInputSingle` reference quote + threshold quote
- Per-chain `chainId` validation at startup — chains with mismatched RPC are skipped (not fatal)

**Pre-buy safety bank (8-call `Promise.all` per candidate)**
- honeypot check (honeypot.is or GoPlus, chain-aware)
- liquidity-lock check (Unicrypt / Mudra / GoPlus + burn-percentage fallback)
- bytecode anti-bot selector scan
- pair/pool reserve depth check (V2)
- token metadata sanity (symbol/name/decimals + optional `tradingEnabled()`)
- buy-direction `staticCall` swap simulation
- transfer-tax probe (`getAmountsOut` vs actual swap static call, 25% threshold)
- max-wallet / max-tx limits probe (4 standard method names)

**Risk gate (5 rules, first-failure-returns)**
- Hard position-size cap (`MAX_POSITION_SIZE`)
- Rolling 24h daily-loss circuit breaker per chain (`DAILY_LOSS_PCT` of chain `maxCapital`)
- Global max open positions across all chains
- Per-chain snipe cooldown
- Portfolio-level total exposure cap

**MEV-protected transaction submission**
- Flashbots bundle submission on ETH with `FLASHBOTS_AUTH_KEY` (3 retries with bumped nonce, real bundle tx hash returned by Phase-14 hardening)
- bloXroute `bsc_private_tx` on BSC (3 retries with bumped nonce, auth-header health check)
- Direct submission with EIP-1559 fee data on Base / Arbitrum (3 retries, `tx.wait(3)`)
- Exhaustive `MevStrategyType` discriminated dispatch with TypeScript `never`-check
- Periodic 5-minute MEV health check fans out Telegram alerts on degradation

**Unified exit engine (one 5s poll per position)**
- Trailing stop with volatility-coefficient-of-variation widening + age-weighted urgency tightening, clamped to a min/max band
- Stop loss active until trailing activates at 2× entry
- Configurable partial-sell tiers (`"2x:50,5x:25"`-style) with BigInt math over the original buy amount
- Gap-sell handling — price jumps past multiple tiers in one poll → combined sell
- Time-urgency hard market-sell at 30 min (linear decay)
- Full state persistence to `exit_state` table every poll cycle — restart resumes with high-water mark, completed tiers, original amount, urgency anchor, and volatility samples intact
- Per-token sell mutex (`chain:token` composite keys) eliminates the same-tick race between interval callbacks
- Force-sell and emergency-sell-all paths invoked from the dashboard always clear timers before the sell

**Persistence**
- SQLite (WAL) with one schema-migration ladder up to v4
- `.bot-state.json → trades` one-shot migration at first boot
- Legacy `chain='mainnet' → 'eth'` row normalization (Phase-15 dedup safety)
- Full audit trail of `buy / sell / partial_sell / fail` with `tx_hash`, `block`, `gas_cost`, `amount_out` (receipt-decoded), `pool_type`, `fee_tier`, `dex_name`, `chain`
- Computed P&L via single self-join query (pro-rated buy cost across partial sells)

**Receipt decoding (per-sell)**
- V2: parses WETH `Withdrawal` event for amount_out
- V3: parses WETH `Transfer(to=wallet)` event for amount_out
- Gas cost = `gasUsed × effectiveGasPrice`
- One 2s retry if the receipt isn't yet propagated; `null` fields on permanent miss (recorded, not silently zeroed)

**Dashboard (React + Vite + Tailwind, served by Express)**
- Login screen (httpOnly cookie session, 24h TTL, `timingSafeEqual` against `DASHBOARD_API_KEY`)
- Overview: stat cards (total P&L, open positions, exposure, 24h P&L), real-time positions table with force-sell, live risk gauges, event feed (Telegram alerts mirror), confirmation dialogs
- Trades: paginated/filterable history (chain × date × profit/loss outcome), CSV export with spreadsheet-formula-injection-safe escaping
- Risk: lightweight-charts cumulative P&L line, chart.js exposure donut
- Chain Controls: per-chain status cards with masked RPC hostnames, stop/start buttons, warnings array surfaced from the orchestrator's `onRestart` callback, **Emergency Sell All** with confirmation
- WebSocket push: 5s `positions_update`, on-event `chain_status_change`, every Telegram alert as `notification` (severity + category inferred from message text)

**Telegram integration**
- Outbound bot for alerts (HTTP API via axios)
- Inbound MTProto user-account listener — extracts `0x` addresses from messages, dedup + 5s cooldown, sender/channel allowlists (OR-combined), multi-chain dispatch via `getCode(address)` against every chain context
- Alpha-drop pipeline calls into the same `handleNewPairForChain` / `handleNewV3PoolForChain` path as factory events (`alphaDrop.ts`)

**Smart contract / audit pipeline**
- Immutable, stateless `HoneypotChecker.sol` with eth_call-only revert-always semantics (V2 + V3 entry points, 3-bit status bitmap, tax-bps math, custom errors for `BuyFailed/SellFailed/QuoteFailed/V3_SELL_WETH_ZERO`)
- Hardhat Ignition deploy module + Windows-friendly CLI wrapper with chain-name mapping
- Slither + Mythril CI gate on every `contracts/**` change (paths-filter trigger, audit-bar evergreen since 2026-05-15)
- Audited 2026-05-15: Slither 13 medium+ findings all dispositioned false-positive against the contract design; Mythril clean. Deploy gate cleared for HONEY-03.

**Misc operational hardening**
- Graceful shutdown on SIGINT / SIGTERM with a 5s force-exit safety net (API close → Telegram disconnect → timer clear → WS provider destroy → DB close)
- Fail-loud env validation at startup — missing required vars `process.exit(1)` with structured log
- 33 documented env vars in `.env.example` and `REQUIRED_ENV_VARS`
- Chain-scoped pino child logger threaded through `ChainContext`
- Single source of truth for chain configuration (`chainRegistry.ts`)

---

## 14. WIP / Partial Features

### Pre-buy honeypot sell-simulation rebuild — **WIP (Phase 18, mid-execution)**

**Today's state (`src/utils/tokenSafety.ts`):**
- **V2:** `simulateSellForChain` (lines 560-585) calls `erc20.balanceOf(ctx.wallet.address)` — always 0 for newly-listed tokens — then passes that balance to `swapExactTokensForETHSupportingFeeOnTransferTokens.staticCall`. The router rejects `amountIn=0` with `UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT`; the check returns `false`; the buy is hard-blocked. **Every V2 token is unsnipable through this gate.**
- **V3:** `simulateSellV3ForChain` (lines 605-611) has a `if (balance === 0n) { return true; }` short-circuit. For every newly-listed token this passes vacuously without exercising the token's transfer logic at all. **Zero honeypot detection on V3, silently.**
- Both bugs are documented in `HONEYPOT-SIM-BRIEFING.md` at repo root.

**Rebuild progress (Phase 18 plans 18-00 .. 18-06 complete as of 2026-05-16):**
| Plan | Status | What it shipped |
|------|--------|-----------------|
| 18-00 | Done | HONEY-12 requirement row added |
| 18-02 | Done | `HoneypotChecker.sol` + TS dispatch skeleton (`src/utils/honeypot/*`) |
| 18-04 | Done | Safety-bank audit + `isBlacklistedTokenForChain` fix-in-flight |
| 18-01 | Done | Wave-1 honeypot fixtures (`Honeypot.sol` 5-mode + 3 ETH JSON fixtures) |
| 18-03 | Done | `bytecodeScan.ts` (HONEY-12) + Mythril severity gate |
| 18-06 | Done | `ChainConfig.honeypotChecker` required field + hardhat networks + deploy CLI |
| 18-05 | Done | Slither + Mythril audit + CI gate evergreen |
| **18-07** | **NEXT** | ETH mainnet deploy of HoneypotChecker (autonomous:false — operator funds wallet, runs deploy + Etherscan verify) |
| 18-08 | Pending | BSC / Base / Arb mainnet deploy |
| 18-09 | Pending | `checkerContract.ts` real implementations + bot.ts:229 parallel-safety-bank wire-up |

**What you can claim today:**
- The `HoneypotChecker.sol` contract exists, is audited (Slither + Mythril clean), and the audit gate is live in CI
- The deploy pipeline (Ignition module + CLI wrapper + per-chain hardhat networks + `hardhat-verify` config) is shipped
- The TypeScript dispatcher (`src/utils/honeypot/index.ts`) is wired and returns `verdict: 'unknown'` for every call today because `checkerContract.ts` is a documented placeholder
- The HONEY-12 bytecode mutability scan (`isMutableTokenForChain`) ships, but it is not yet called from `bot.ts:229` — that wire-up is plan 18-09
- `bot.ts` still calls the old `simulateSellForChain` and `simulateSellV3ForChain` — those will be removed / replaced when plan 18-09 lands

**Honest framing for the README:** the safety-stack rebuild is mid-execution; the on-chain audit is complete; the runtime hot-path has not yet been switched over.

### Anti-rug runtime monitoring — **Not started**
Phase 19 ANTIRUG. `.planning/PROJECT.md` describes intended behavior (event-driven WebSocket subscription, single-listener-per-chain, 50% LP-removal default, confirm-after-N-blocks default, HTTP-poll fallback). No code exists in `src/` for this yet.

### Going-live ops hardening — **Partial / informational**
`GOING-LIVE.md` is a thorough first-time-setup runbook at repo root. Wallet-balance pre-flight, stale-data warnings, env-validation messaging upgrades, and the runbook's eventual move to `docs/operations/going-live.md` are still pending Phase 20.

### v6.16 deferred live-runtime items (Phase 21 EXIT-LIVE)
The following were validated only in tests during v6.16 and need real-mainnet validation in Phase 21: live exit poll cycle + state persistence across restart, real sell `amount_out` non-null on mainnet, real Flashbots tx hash on mainnet, dashboard WebSocket position updates rendered in a browser, live price / Telegram / chain restart warnings, bot-startup SQLite + `.bot-state.json` migration on real boot.

### Future deferred (not active)
- **DETECT-01** mempool / block-0 sniping (upgrade from block-mode to mempool pending-liquidity monitoring)
- **CHAIN-05** fully-dynamic opportunity-quality-weighted capital allocation (fixed per-chain budgets shipped in v6.16)

---

## 15. Architectural Highlights

- **Chain abstraction via discriminated unions** — `DexConfig = DexConfigV2 | DexConfigV3` and `MevStrategyType` with exhaustive `never` checks. Adding a new chain or DEX type is a typed-template addition, not a refactor.
- **Layered MEV strategy** — `MevStrategy` interface lets the bot mix Flashbots (ETH), bloXroute private tx (BSC), and direct submission (Base/Arb) behind one `sendTxWithRetry` call. Each strategy owns its own retry semantics, fee handling, and health-check protocol.
- **Discriminated-union HoneypotResult as a compile-gate vacuous-pass guard** — `safe` requires non-optional `buyTaxBps`/`sellTaxBps`, making the empty-evidence literal a TypeScript error by construction. This is the lesson learned from the FIX-04 silent-pass bug, baked into the type system.
- **Single source of truth for chain config** — `chainRegistry.ts` overlays static templates with env, fails loud on bad input, and exposes a `ChainContext` to every downstream consumer. The legacy single-chain `CONFIG` in `config.ts` is kept only for backward compatibility.
- **Immutable, stateless, eth_call-only on-chain checker** — the contract design rejects every conventional smart-contract escape hatch (no owner, no proxy, no killSwitch, no selfdestruct, no tx.origin) precisely so that the audit-once-deploy-once model holds. Patch path is "deploy v2 at new address." Every audited Slither/Mythril finding is dispositioned against this stance, on the record in `.planning/milestones/v6.17-honeypot-checker-audit.md`.
- **Capability-split deploy key** — `DEPLOY_PRIVATE_KEY` is a separate, deliberately-scoped wallet so bot-key compromise cannot push a malicious checker to the trusted address.
- **State machine that survives restart** — the exit engine writes `exit_state` every poll, and `resumeMultiChainMonitoring` reconstructs every monitor on boot. The bot wears its own state correctly even after a SIGKILL.
- **Sell-race elimination via per-token mutex** — composite `chain:token` keys + check-and-set in a single event-loop tick eliminate the same-tick double-sell case that single-threaded JavaScript otherwise allows.
- **Audit gate as evergreen CI invariant** — `paths-filter@v3` triggers Slither + Mythril on every `contracts/**` change, with a Python severity-gate script (zero new npm deps) blocking any new Medium+ Mythril issue.
- **Receipt decoder feeds P&L** — every sell's `amount_out` is parsed from real receipt logs (WETH `Withdrawal` for V2, `Transfer→wallet` for V3) with a defensive retry and explicit nulls when nothing matches, so the P&L view distinguishes "we don't know" from "0".
- **Defense-in-depth env handling** — `DASHBOARD_API_KEY` is validated at startup *and* re-validated at login time to protect against test harnesses, hot-reload, and post-startup `process.env` mutation.
- **Spreadsheet-formula-injection-safe CSV export** — `/api/trades/export` escapes the `= + - @ \t \r` prefix-attack vectors so a malicious token name can't run a formula when an operator opens the file in Excel.

---

## 16. Ambiguous / Hard-to-Classify Areas

- **The pre-buy sell simulation is currently in a deliberate broken state** because the v6.17 rebuild is mid-flight. The README needs to be honest about this — the original "FIX-04 sell-sim hard gate" claim from v6.16 is no longer accurate as-shipped. The honest framing is "the sell-sim that v6.16 declared shipped turned out to silently break the buy pipeline (V2) or silently no-op (V3); v6.17 is replacing it with an audited on-chain contract — contract done and audited, runtime wire-up in flight."
- **Phase numbering** — `.planning/PROJECT.md` and `STATE.md` track 17 plans through five-phase blocks; that's internal planning metadata that the README should not surface.
- **Two parallel code paths** — `src/config.ts` carries a "legacy single-chain CONFIG" and `src/chainRegistry.ts` carries the multi-chain registry. The legacy path is largely vestigial except for `CONFIG.slippagePercent`, `CONFIG.trailingStopPct`, etc. read by the exit engine. The README can describe the multi-chain registry as the source of truth without dwelling on the legacy object.
- **`getTradesByToken` removal** — STATE.md notes the unused export was deleted in Phase 17. Worth not mentioning unless the README would otherwise cite it.
- **Dashboard `dist/`** — committed paths exist (`dashboard/dist/`) but the build is not part of the bot's normal startup. Operators run `cd dashboard && npm run build` first or develop with `vite dev` on another port.
- **Single fork test** — `test/fork/snipeLifecycle.test.ts` is the only fork suite; framing it as "comprehensive fork coverage" would overstate. It's a single end-to-end lifecycle.
- **Honeypot stub vs placeholder** — `simulator.ts` is a stub for the alternate `eth_simulateV1` route that may be activated later; `checkerContract.ts` is a placeholder that plan 18-09 will overwrite. Both return `verdict:'unknown'` today and the dispatcher routes them through the same "one-shot skip" policy.
- **Telegram listener is optional** — missing `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION` is a graceful skip (the bot runs factory-event-only), but the env validator marks them required. The README should call out the listener as a feature, not bury the optional path.
- **Blocklist is empty** — `BLOCKLIST.tokens` and `BLOCKLIST.pairs` are exported as empty Sets. The plumbing exists; no curated content lives in repo.

---

## 17. File-Path References (For Sanity-Checking)

| Claim | File path(s) |
|-------|--------------|
| Entry point | `src/bot.ts:949-951` (`if (require.main === module) startMultiChainBot()`) |
| Multi-chain orchestration | `src/bot.ts:702-832` (`startMultiChainBot`) |
| V2 detection + buy path | `src/bot.ts:174-347` (`handleNewPairForChain`) |
| V3 detection + buy path | `src/bot.ts:353-536` (`handleNewV3PoolForChain`) |
| V3 liquidity wait | `src/bot.ts:86-121` (`waitForLiquidity`) |
| WS listener + reconnect | `src/bot.ts:542-637` (`startDexListener`) |
| HTTP polling fallback | `src/bot.ts:644-696` |
| Resume monitoring on restart | `src/bot.ts:838-880` (`resumeMultiChainMonitoring`) |
| Graceful shutdown | `src/bot.ts:886-943` (`initMultiChainShutdownHandler`) |
| Chain registry, types, env overlay | `src/chainRegistry.ts:54-432` |
| Hardcoded chain templates (eth/bsc/base/arb) | `src/chainRegistry.ts:121-296` |
| Env validation + fail-loud `process.exit(1)` | `src/config.ts:13-79` |
| 5-rule risk gate | `src/riskManager.ts:75-153` (`canSnipe`) |
| Portfolio exposure query | `src/riskManager.ts:168-181` (`getPortfolioExposure`) |
| Unified exit engine | `src/exitEngine.ts` (full file ~1100 lines) |
| Volatility tracker | `src/exitEngine.ts:133-191` (`VolatilityTracker`) |
| Partial-sell tier parser | `src/exitEngine.ts:73-94` (`parsePartialSellTargets`) |
| Trailing-stop math | `src/exitEngine.ts:213-223` (`computeEffectiveTrailingPct`) |
| SQLite schema + migrations | `src/utils/db.ts:27-123` |
| JSON→SQLite migration | `src/utils/db.ts:131-203` |
| `getPnL` self-join query | `src/utils/db.ts:241-274` |
| Chain-scoped `isTokenSniped` | `src/utils/db.ts:231-237` |
| Receipt decoder (V2 Withdrawal + V3 Transfer) | `src/utils/receiptDecoder.ts` |
| Flashbots MEV strategy | `src/utils/mevStrategies/flashbots.ts` |
| bloXroute MEV strategy | `src/utils/mevStrategies/bloxroute.ts` |
| Passthrough MEV strategy | `src/utils/mevStrategies/passthrough.ts` |
| MEV strategy dispatch + dual-overload TX | `src/utils/txManager.ts` |
| Parallel safety bank (all 10 ForChain fns) | `src/utils/tokenSafety.ts` |
| **Broken** V2 sell-sim (FIX-04) | `src/utils/tokenSafety.ts:560-585` |
| **Vacuous-pass** V3 sell-sim (V3-03) | `src/utils/tokenSafety.ts:598-639` |
| Honeypot dispatcher | `src/utils/honeypot/index.ts` |
| Discriminated-union `HoneypotResult` | `src/utils/honeypot/types.ts` |
| **Placeholder** checker adapters | `src/utils/honeypot/checkerContract.ts` |
| **Stub** eth_simulateV1 path | `src/utils/honeypot/simulator.ts` |
| HONEY-12 bytecode mutability scan | `src/utils/honeypot/bytecodeScan.ts` |
| Audited HoneypotChecker.sol | `contracts/honeypot/HoneypotChecker.sol` (~360 lines) |
| Ignition deploy module | `ignition/modules/HoneypotChecker.ts` |
| Per-chain deploy CLI | `scripts/deploy-honeypot-checker.ts` |
| Mythril severity gate | `scripts/check-mythril-report.ts` |
| Express + WS server | `src/api/server.ts` |
| Health route (unauthed) | `src/api/routes/health.ts` |
| Login + session auth | `src/api/routes/auth.ts` + `src/api/middleware/auth.ts` |
| Positions / trades / risk / chains / controls | `src/api/routes/{positions,trades,risk,chains,controls}.ts` |
| WS broadcaster (auth-gated) | `src/api/ws/broadcaster.ts`, `src/api/ws/handler.ts` |
| Dashboard SPA entry | `dashboard/src/App.tsx`, `dashboard/src/pages/{Overview,TradeHistory,RiskExposure,ChainControls,Login}.tsx` |
| Telegram alpha listener | `src/telegramListener.ts` |
| Telegram → DEX-discovery routing | `src/alphaDrop.ts` |
| Telegram notifier + WS fan-out | `src/utils/notifier.ts` |
| Hardhat config (networks + audit subtask) | `hardhat.config.ts` |
| GitHub Actions workflow | `.github/workflows/test.yml` |
| Vitest config (3 projects, coverage thresholds) | `vitest.config.ts` |
| Honest project status snapshot | `.planning/STATE.md`, `.planning/PROJECT.md` |
| V2/V3 sell-sim bug write-up | `HONEYPOT-SIM-BRIEFING.md` |
| First-time setup runbook | `GOING-LIVE.md` |
