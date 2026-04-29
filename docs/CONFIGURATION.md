<!-- generated-by: gsd-doc-writer -->
# Configuration

The crypto-snipe-bot is configured exclusively through environment variables loaded via
`dotenv` in `src/config.ts`. Copy `.env.example` to `.env` and fill in values before
starting the bot. Startup validation (`validateEnvVars()` in `src/config.ts`) exits the
process with a fatal log if any required variable is missing.

## Environment Variables

Variables are grouped by subsystem. "Required" variables cause the bot to exit on startup
if absent. "Conditional" variables are required only when a specific chain or feature is
enabled.

### Wallet

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PRIVATE_KEY` | Required | (none) | Wallet private key used for signing transactions on every enabled chain. |

### Multi-Chain Selection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENABLED_CHAINS` | Optional | `eth` | Comma-separated chain names to enable. Valid values: `eth`, `bsc`, `base`, `arb`. |

Chain names outside the valid set cause a fatal startup error
(`src/chainRegistry.ts:283`).

### Per-Chain RPC Endpoints

Each chain below uses two env vars for RPC connectivity. The HTTP URL is Required when the
chain is listed in `ENABLED_CHAINS`; the WebSocket URL is always Optional (event detection
falls back to HTTP polling when absent).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ETH_RPC_URL` | Conditional (when `eth` enabled) | (none; falls back to `ALCHEMY_URL`) | Ethereum mainnet HTTP RPC endpoint. |
| `ETH_WS_URL` | Optional | (none) | Ethereum WebSocket RPC endpoint for event detection. |
| `BSC_RPC_URL` | Conditional (when `bsc` enabled) | `https://bsc-dataseed.binance.org/` (legacy `CONFIG.rpc.bsc` only) | BSC HTTP RPC endpoint. |
| `BSC_WS_URL` | Optional | (none) | BSC WebSocket RPC endpoint. |
| `BASE_RPC_URL` | Conditional (when `base` enabled) | (none) | Base HTTP RPC endpoint. |
| `BASE_WS_URL` | Optional | (none) | Base WebSocket RPC endpoint. |
| `ARB_RPC_URL` | Conditional (when `arb` enabled) | (none) | Arbitrum HTTP RPC endpoint. |
| `ARB_WS_URL` | Optional | (none) | Arbitrum WebSocket RPC endpoint. |

Backward-compat note: for `eth`, if `ETH_RPC_URL` is not set the bot falls back to
`ALCHEMY_URL` (`src/chainRegistry.ts:302-305`). `ALCHEMY_URL` is also listed as Required
in the legacy `REQUIRED_ENV_VARS` list in `src/config.ts`, so current startup requires it
even when `ETH_RPC_URL` is supplied.

### Per-Chain Capital Limits

Defaults come from static chain templates in `src/chainRegistry.ts` (`CHAIN_TEMPLATES`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ETH_SNIPE_AMOUNT` | Optional | `0.01` | ETH per trade on Ethereum. |
| `ETH_MAX_CAPITAL` | Optional | `1.0` | Max ETH deployment on Ethereum. |
| `BSC_SNIPE_AMOUNT` | Optional | `0.05` | BNB per trade on BSC. |
| `BSC_MAX_CAPITAL` | Optional | `5.0` | Max BNB deployment on BSC. |
| `BASE_SNIPE_AMOUNT` | Optional | `0.005` | ETH per trade on Base. |
| `BASE_MAX_CAPITAL` | Optional | `0.5` | Max ETH deployment on Base. |
| `ARB_SNIPE_AMOUNT` | Optional | `0.005` | ETH per trade on Arbitrum. |
| `ARB_MAX_CAPITAL` | Optional | `0.5` | Max ETH deployment on Arbitrum. |
| `ETH_MIN_LIQUIDITY` | Optional | `0.5` | Minimum liquidity threshold (ETH) — read in `chainRegistry.ts:299`. |
| `BSC_MIN_LIQUIDITY` | Optional | `1.0` | Minimum liquidity threshold (BNB). |
| `BASE_MIN_LIQUIDITY` | Optional | `0.1` | Minimum liquidity threshold (ETH). |
| `ARB_MIN_LIQUIDITY` | Optional | `0.1` | Minimum liquidity threshold (ETH). |

### MEV Protection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FLASHBOTS_AUTH_KEY` | Conditional (when `eth` enabled) | (none) | Flashbots auth signing key. Fatal at startup if `eth` is enabled and this is unset (`chainRegistry.ts:315-318`). |
| `BLOXROUTE_AUTH_HEADER` | Conditional (when `bsc` enabled) | (none) | bloXroute authorization header. Fatal at startup if `bsc` is enabled and this is unset (`chainRegistry.ts:319-322`). |

Base and Arbitrum use MEV strategy `passthrough` and require no auth credentials.

### Telegram (notifications)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Required | (none) | Bot token from @BotFather, used for outbound alerts. |
| `TELEGRAM_CHAT_ID` | Required | (none) | Chat ID receiving alerts. |

### Telegram Listener (alpha signals)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_API_ID` | Required | (none) | Telegram API ID from my.telegram.org. |
| `TELEGRAM_API_HASH` | Required | (none) | Telegram API hash from my.telegram.org. |
| `TELEGRAM_SESSION` | Required | (none) | Telegram session string. Generate manually using the `telegram` package's `StringSession` workflow — see `docs/GETTING-STARTED.md` troubleshooting section. |

### Telegram Whitelist (access control)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_ALLOWED_SENDERS` | Optional | (empty — allow all) | Comma-separated sender IDs permitted to trigger signals. |
| `TELEGRAM_ALLOWED_CHANNELS` | Optional | (empty — allow all) | Comma-separated channel/group IDs permitted to broadcast signals. |

### Dashboard API

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DASHBOARD_API_KEY` | Required | (none) | API key for dashboard login. The dashboard server starts unconditionally on every bot run, so this is always required. |
| `DASHBOARD_PORT` | Optional | `8080` | Dashboard API server port (`src/api/server.ts:117`). |
| `DASHBOARD_HOST` | Optional | `127.0.0.1` | Dashboard bind address. Set to `0.0.0.0` to expose remotely (use with caution). |
| `NODE_ENV` | Optional | (none) | When set to `production`, auth middleware enables stricter cookie settings (`src/api/middleware/auth.ts:64`). |

### Risk Management

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAX_OPEN_POSITIONS` | Optional | `10` | Max concurrent open positions across all chains (`src/riskManager.ts:28`). |
| `MAX_TOTAL_EXPOSURE` | Optional | `10.0` | Max total native currency deployed across all chains. Sums raw native amounts (ETH + BNB) regardless of denomination. |
| `DAILY_LOSS_PCT` | Optional | `10` | Daily loss limit as percent of per-chain `maxCapital`. Uses rolling 24h window with auto-resume. |
| `SNIPE_COOLDOWN_MS` | Optional | `30000` | Milliseconds between snipes per chain. Cross-chain snipes are independent. |
| `MAX_POSITION_SIZE` | Optional | (empty — uses per-chain `snipeAmount`) | Hard cap on native currency per snipe. |

### Exit Strategy

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRAILING_STOP_PCT` | Optional | `15` | Trailing stop pullback percentage from peak. Active at >=2x. |
| `TRAILING_MIN_PCT` | Optional | `5` | Minimum trailing stop percentage after volatility/urgency adjustment. |
| `TRAILING_MAX_PCT` | Optional | `40` | Maximum trailing stop percentage after volatility adjustment. |
| `PARTIAL_SELL_TARGETS` | Optional | (empty — no partial sells) | Partial sell tiers in the form `2x:50,5x:25` (multiplier:percent pairs). |
| `STOP_LOSS_PCT` | Optional | `25` | Fixed stop-loss percent below entry, active before trailing activates at 2x. |

### Legacy / Backward Compatibility

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALCHEMY_URL` | Required (current behavior) | (none) | Legacy Ethereum RPC URL. Listed as Required in `REQUIRED_ENV_VARS` (`src/config.ts:16`). Falls back to providing the `eth` HTTP RPC when `ETH_RPC_URL` is not set. |
| `NETWORK` | Optional | `sepolia` | Legacy network selector. Accepted values derive from `rpc` keys: `sepolia`, `mainnet`, `bsc`. Invalid values cause fatal startup error (`src/config.ts:97-100`). |

### General

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | Optional | `info` | Pino log level: `debug`, `info`, `warn`, `error` (`src/utils/logger.ts:7`). |
| `DB_PATH` | Optional | `./data/bot.db` | SQLite database path (`src/utils/db.ts:9`). Resolved relative to `process.cwd()` when default is used. |

## Config File Format

This project does not use a separate config file format (JSON/YAML/TOML) for runtime
settings. All runtime configuration flows through environment variables. A single
`.env.example` file in the project root serves as the canonical template; copy it to `.env`
and edit values.

Developer tooling uses its own config files that are orthogonal to bot runtime
configuration:

- `tsconfig.json`, `tsconfig.bot.json` — TypeScript compilation settings.
- `vitest.config.ts` — test runner configuration.
- `eslint.config.mjs` — linting rules.
- `hardhat.config.ts` — Hardhat network and compiler settings for the `contracts/`
  directory.

## Required vs Optional Settings

The following variables cause the bot to exit immediately on startup if unset
(`validateEnvVars()` in `src/config.ts:68-79`):

- `PRIVATE_KEY`
- `ALCHEMY_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `DASHBOARD_API_KEY`

Additional conditional requirements are validated in `buildChainRegistry()`
(`src/chainRegistry.ts:307-323`):

- When any chain is enabled via `ENABLED_CHAINS`, its `<PREFIX>_RPC_URL` must be set.
- When `eth` is enabled, `FLASHBOTS_AUTH_KEY` must be set.
- When `bsc` is enabled, `BLOXROUTE_AUTH_HEADER` must be set.

All other variables listed above are Optional and have defaults defined in source code.

## Defaults

Defaults are declared at two layers:

1. **Per-chain static template defaults** (`src/chainRegistry.ts`, `CHAIN_TEMPLATES`):
   snipe amount, max capital, min liquidity, DEX addresses, MEV strategy, gas settings,
   explorer URL. These are hardcoded per chain and not overridable via env vars except
   through the `<PREFIX>_SNIPE_AMOUNT`, `<PREFIX>_MAX_CAPITAL`, and `<PREFIX>_MIN_LIQUIDITY`
   overrides.

2. **Parsed env var defaults** (`src/config.ts`, `src/riskManager.ts`,
   `src/api/server.ts`, `src/utils/db.ts`, `src/utils/logger.ts`): numeric and string
   fallbacks applied via `process.env.X || 'default'` or `parseFloat(process.env.X || 'N')`
   patterns. These are the defaults shown in the tables above.

Hardcoded non-configurable constants that behave like defaults but cannot be changed via
env vars include (`src/config.ts:131-145`):

- `stopLossCheckInterval`: `15000` ms
- `autoSellAfterMs`: `300000` ms (5 minutes)
- `takeProfitPercent`: `50`
- `takeProfitCheckInterval`: `15000` ms
- `exitPollIntervalMs`: `5000` ms
- `urgencyWindowMs`: `1800000` ms (30 minutes)
- `volatilityBaselineCV`: `0.03`
- `volatilityMaxSamples`: `60`
- `volatilityMinSamples`: `12`
- `gasMultiplier`: `1.2` (legacy `CONFIG`; per-chain gas uses `chainRegistry` values)
- `gasLimit`: `300_000` (legacy `CONFIG`)
- `slippageTolerance`: `0.1`
- `slippagePercent`: `5`

## Per-Environment Overrides

The repository does not ship `.env.development`, `.env.production`, or `.env.test` files
and does not branch configuration on `NODE_ENV` for runtime behavior (except the auth
middleware's secure-cookie toggle in `src/api/middleware/auth.ts:64`).

Recommended approach for running against different environments:

1. Maintain a single `.env` file per deployment/machine.
2. Use a secret manager or host-level environment variables for production secrets instead
   of committing `.env` files. The top-level `.env` is gitignored.
3. For local testing, `vitest.config.ts` loads `.env` via dotenv so unit and integration
   tests see the same variables as the bot runtime.

<!-- VERIFY: Production deployment target and secret management mechanism (no deploy config present in repo) -->
<!-- VERIFY: Whether production uses a specific ETH_RPC_URL/ALCHEMY_URL provider beyond the example Alchemy URL -->
