# Codebase Structure

**Analysis Date:** 2026-03-19

## Directory Layout

```
crypto-snipe-bot/
├── src/                        # TypeScript source code (bot logic)
│   ├── bot.ts                  # Primary: Factory event listener & execution orchestrator
│   ├── telegramListener.ts      # Secondary: Telegram message parser & alpha listener
│   ├── alphaDrop.ts             # Telegram-triggered snipe handler
│   ├── config.ts                # Centralized configuration & environment
│   ├── addresses.json           # Contract addresses (factory, router, WETH, tokens)
│   ├── utils/                   # Shared utility modules
│   │   ├── tokenSafety.ts       # 9-stage token validation pipeline
│   │   ├── txManager.ts         # Flashbots transaction builder & executor
│   │   ├── notifier.ts          # Telegram alert sender
│   │   ├── storage.ts           # Persistent state (sniped tokens registry)
│   │   ├── flashbots.ts         # Flashbots provider initialization
│   │   ├── pairDiscovery.ts     # Token → Pair address lookup
│   │   ├── gasManager.ts        # Gas fee calculation with multiplier
│   │   ├── retry.ts             # Exponential backoff retry utility
│   │   ├── logger.ts            # Timestamped logging
│   │   ├── blocklist.ts         # Known bad tokens/creators/pairs registry
│   │   ├── testAlert.ts         # Telegram message testing utility
│   └── scripts/
│       └── genAuthWallet.ts     # Wallet generation helper
├── scripts/                     # Deployment & operational scripts
│   ├── deploySepoliaTest.ts     # Deploy test contracts to Sepolia
│   ├── addLiquidity.ts          # Create initial LP for testing
│   └── manualTrigger.ts         # Manually trigger bot for testing
├── contracts/                   # Solidity smart contracts (test fixtures)
│   ├── FakeToken.sol            # Mock ERC20 for testing
│   ├── UniswapV2Factory.sol     # Uniswap v2 factory (Sepolia test copy)
│   ├── UniswapV2Router02.sol    # Uniswap v2 router (Sepolia test copy)
│   └── interfaces/
│       └── IWETH.sol            # WETH interface
├── test/                        # Test files
├── ignition/                    # Hardhat Ignition deployment modules
├── artifacts/                   # Compiled contract ABIs (generated)
├── typechain-types/             # TypeChain generated types (generated)
├── cache/                       # Build cache (generated)
├── .planning/                   # GSD planning documents
│   └── codebase/                # Architecture & structure analysis
├── .env                         # Environment variables (secrets, credentials)
├── package.json                 # Dependencies & build scripts
├── tsconfig.json                # TypeScript compiler configuration
├── tsconfig.bot.json            # Alternative TS config variant
├── hardhat.config.ts            # Hardhat configuration (contracts, testing)
└── auth.ts                      # Telegram session generation (run once at setup)
```

## Directory Purposes

**src/**
- Purpose: Core bot application logic
- Contains: Event listeners, validation pipeline, execution orchestration, utilities
- Key files: `bot.ts` (primary entry), `telegramListener.ts` (secondary entry), `config.ts` (configuration)

**src/utils/**
- Purpose: Reusable modules for token validation, transaction submission, notifications, state persistence
- Contains: Individual responsibility modules (tokenSafety, txManager, notifier, storage, etc.)
- Key files: All are critical to bot functionality; no file is optional

**scripts/**
- Purpose: Development and testing support scripts (not part of production runtime)
- Contains: Contract deployment, liquidity pool creation, manual triggers
- Key files: Run via `hardhat run` or `ts-node`

**contracts/**
- Purpose: Smart contract test fixtures for Sepolia testnet
- Contains: Mock token, factory, router (not custom logic — copies of existing DEX contracts)
- Key files: Used only in deployment/testing scripts, not directly by bot

**test/**
- Purpose: Test suites (currently empty; testing infrastructure in place via Hardhat)
- Contains: (none yet)
- Key files: N/A

**ignition/**
- Purpose: Hardhat Ignition deployment modules (infrastructure as code for contracts)
- Contains: Deployment specifications (currently unused; manual scripts used instead)
- Key files: N/A

**artifacts/ & typechain-types/**
- Purpose: Generated files from Hardhat compilation
- Contains: Contract ABIs, type definitions
- Generated: Yes
- Committed: No (gitignore'd)

**cache/**
- Purpose: Hardhat build cache
- Generated: Yes
- Committed: No

**.planning/codebase/**
- Purpose: GSD mapping documents (this analysis)
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Committed: Yes (reference for implementation)

## Key File Locations

**Entry Points:**
- `src/bot.ts`: Primary bot (blockchain event listener)
  - Exports: `handleNewPair()` (core function), `startBot()` (event listener setup)
  - Runs: `node dist/src/bot.js` or `ts-node src/bot.ts`

- `src/telegramListener.ts`: Secondary bot (Telegram listener)
  - Exports: `main()` function
  - Runs: `ts-node src/telegramListener.ts`

- `auth.ts`: One-time setup for Telegram authentication
  - Runs: `npx ts-node auth.ts`

**Configuration:**
- `src/config.ts`: Centralized CONFIG object
  - Provides: Network, RPC endpoints, wallet, contract addresses, snipe parameters, monitoring intervals
  - Loads: Environment variables via dotenv

- `src/addresses.json`: Contract address constants
  - Contains: factoryAddress, routerAddress, wethAddress, tokenAddress, pairAddress
  - Usage: Spread into CONFIG

- `.env`: Environment secrets (DO NOT COMMIT)
  - Required: PRIVATE_KEY, ALCHEMY_URL, TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, FLASHBOTS_AUTH_KEY

**Core Logic:**
- `src/bot.ts`: Main event loop
  - `startBot()`: Register factory listener (default: every new pair triggers handleNewPair)
  - `handleNewPair()`: Orchestrate validation → execution (270+ lines)
  - `monitorStopLoss()`: Price-based exit (every 15s check interval)
  - `monitorTakeProfit()`: Price-based exit (every 15s check interval)
  - `scheduleTimedSell()`: Time-based exit (5 minutes default)

- `src/utils/tokenSafety.ts`: Validation pipeline (300+ lines)
  - `isHoneypot()`: Honeypot API check with static call fallback
  - `checkTokenMetadata()`: Symbol/name/decimals validation
  - `simulateSwap()`: Dry-run swap to detect reverts
  - `isBlacklistedToken()`: Check for anti-bot function selectors
  - `hasHighTransferTax()`: Estimate transfer tax via simulation
  - `hasMaxWalletOrTxLimits()`: Check anti-whale limits
  - `isLiquidityLocked()`: Unicrypt API check + burn fallback
  - `isLiquiditySufficient()`: Minimum 1 ETH in LP requirement
  - `isKnownBadToken()`: Blocklist + code existence check

- `src/utils/txManager.ts`: Flashbots wrapper
  - `sendTxWithRetry()`: Build, sign, submit via Flashbots (with fallback to direct send)

- `src/utils/notifier.ts`: Telegram integration
  - `sendTelegramAlert()`: POST to Telegram Bot API

- `src/utils/storage.ts`: Persistent state
  - `markSniped()`: Record token acquisition
  - `isAlreadySniped()`: Check dedup set
  - `updateTokenStatus()`: Mark as "sold" or "failed"

**Testing & Deployment:**
- `scripts/deploySepoliaTest.ts`: Deploy test contracts
- `scripts/addLiquidity.ts`: Create LP pools
- `scripts/manualTrigger.ts`: Trigger bot execution manually
- `hardhat.config.ts`: Hardhat network configuration

**Configuration Files:**
- `tsconfig.json`: Main TypeScript config (target: ES2022, module: commonjs)
- `tsconfig.bot.json`: Alternative config (unused)
- `package.json`: Dependencies (ethers 5.7.2, telegram 2.26.22, @flashbots/ethers-provider-bundle 0.6.1, axios, dotenv)

## Naming Conventions

**Files:**
- `camelCase.ts` for source files: `bot.ts`, `config.ts`, `flashbots.ts`
- `descriptive-name.ts` for utility files: `pairDiscovery.ts`, `gasManager.ts`, `tokenSafety.ts`
- `UPPERCASE.ts` for scripts: Not used; scripts follow camelCase: `deploySepoliaTest.ts`, `addLiquidity.ts`
- `.json` for data: `addresses.json`, `.bot-state.json` (state persistence)

**Directories:**
- `lowercase` for directories: `src/`, `scripts/`, `contracts/`, `utils/`
- No abbreviations in directory names

**Functions:**
- `camelCase` for function names: `handleNewPair()`, `monitorStopLoss()`, `sendTxWithRetry()`
- Prefix pattern for related functions: `is*` for boolean checks (`isHoneypot()`, `isAlreadySniped()`), `check*` for validation (`checkTokenMetadata()`), `has*` for existence checks (`hasHighTransferTax()`)
- Export pattern: Named exports for utilities, `export async function name() {}`

**Variables:**
- `camelCase` for variables: `tokenAddress`, `pairAddress`, `walletPrivateKey`
- `UPPERCASE` for constants: `CONFIG`, `BLOCKLIST`, `TELEGRAM_API`, `PATH` (file paths)
- `processedContracts` for Set/Map collections

**Types:**
- TypeScript interfaces: `State` (in storage.ts), `SupportedNetwork` (in config.ts)
- `type` aliases for unions: `type SupportedNetwork = keyof typeof rpc`
- Implicit inference preferred (minimal explicit annotations)

## Where to Add New Code

**New Token Safety Check:**
- Location: `src/utils/tokenSafety.ts`
- Pattern: Export async function returning boolean, accept tokenAddress and provider, log via console
- Integration: Add to Promise.all() array in `handleNewPair()` line 245, add to final validation gate line 290
- Example: `export async function checkMyNewValidation(tokenAddress: string): Promise<boolean> { ... }`

**New Sell Exit Strategy:**
- Location: `src/bot.ts` inside `handleNewPair()` after line 336
- Pattern: Create monitoring function similar to `monitorStopLoss()` or `monitorTakeProfit()`, spawn as concurrent task
- Example: `await monitorMyStrategy(targetToken, CONFIG.snipeAmountETH);`

**New Alert/Notification Channel:**
- Location: `src/utils/notifier.ts`
- Pattern: Export async function accepting message string, implement API call
- Integration: Import and call from `bot.ts` at alert points
- Example: `export async function sendDiscordAlert(message: string) { ... }`

**New Utility Module:**
- Location: `src/utils/myFeature.ts`
- Pattern: Export named functions only (no default exports)
- Convention: If utility handles cross-cutting concern (gas, retry, logging), create as sibling to existing utils

**Configuration Addition:**
- Location: `src/config.ts` in CONFIG object
- Pattern: Read from environment via `process.env.VARIABLE_NAME!` or provide fallback
- Add to `.env` template with documentation comment

**New Entry Point/Script:**
- Location: `scripts/myScript.ts` for operational tasks, or `auth.ts` pattern for setup
- Pattern: Export `main()` function, call on module check: `if (require.main === module) { main(); }`
- Build: Run via `ts-node scripts/myScript.ts` or add npm script to package.json

## Special Directories

**cache/**
- Purpose: Hardhat compilation cache
- Generated: Yes (build artifacts)
- Committed: No (in .gitignore)

**artifacts/**
- Purpose: Contract ABI output from Solidity compilation
- Generated: Yes (hardhat compile)
- Committed: No (in .gitignore)

**typechain-types/**
- Purpose: Generated TypeScript type definitions for contracts
- Generated: Yes (typechain plugin)
- Committed: No (in .gitignore)

**.bot-state.json**
- Purpose: Persistent registry of sniped tokens
- Generated: Yes (by bot at runtime)
- Committed: No (in .gitignore, stateful)
- Format: `{ sniped: { "0xaddress": { txHash, timestamp, status } } }`

**.env**
- Purpose: Environment variables and secrets
- Generated: No (manual setup)
- Committed: No (in .gitignore, contains sensitive data)
- Required: PRIVATE_KEY, ALCHEMY_URL, TELEGRAM_* keys, FLASHBOTS_AUTH_KEY

**node_modules/**
- Purpose: Installed npm dependencies
- Generated: Yes (npm install)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-03-19*
