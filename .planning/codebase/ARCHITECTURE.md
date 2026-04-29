# Architecture

**Analysis Date:** 2026-03-19

## Pattern Overview

**Overall:** Event-driven MEV (Maximal Extractable Value) sniper bot with layered validation and risk management.

**Key Characteristics:**
- Event-listener pattern for detecting new token pair creation on DEX
- Multi-stage token safety validation pipeline
- Dual data ingestion: blockchain events and Telegram alpha signals
- Modular utility layer for cross-cutting concerns (gas, retry, notifications)
- Persistent state management for tracking sniped tokens
- Flashbots integration for private transaction submission

## Layers

**Event Detection Layer:**
- Purpose: Monitor blockchain for pair creation events and Telegram messages
- Location: `src/bot.ts`, `src/telegramListener.ts`
- Contains: Event listeners, message parsers, contract watchers
- Depends on: ethers.js providers, Telegram client library
- Used by: Central orchestration

**Token Validation Pipeline:**
- Purpose: Multi-stage risk assessment before execution
- Location: `src/utils/tokenSafety.ts`
- Contains: Honeypot detection, blacklist checks, liquidity verification, tax simulation, metadata validation
- Depends on: External APIs (honeypot.is, unicrypt.network), on-chain simulation
- Used by: `src/bot.ts` (handleNewPair)

**Execution Layer:**
- Purpose: Construct and submit transactions with MEV protection
- Location: `src/bot.ts` (handleNewPair function), `src/utils/txManager.ts`
- Contains: Swap logic, approval handling, Flashbots bundling, retry mechanism
- Depends on: ethers.js wallet/signer, Flashbots provider
- Used by: Event handlers

**Position Management Layer:**
- Purpose: Monitor and auto-exit positions based on price targets
- Location: `src/bot.ts` (monitorStopLoss, monitorTakeProfit, scheduleTimedSell)
- Contains: Price monitoring loops, sell execution, ROI calculation
- Depends on: Router contract for price queries
- Used by: Main bot flow

**Notification Layer:**
- Purpose: Send real-time alerts via Telegram
- Location: `src/utils/notifier.ts`
- Contains: Telegram API integration, message formatting
- Depends on: Telegram Bot API
- Used by: All major bot operations

**Persistence Layer:**
- Purpose: Track token acquisition and position status
- Location: `src/utils/storage.ts`
- Contains: State serialization, sniped token registry
- Depends on: File system
- Used by: Deduplication logic, status updates

**Utility Layers:**
- **Gas Management** (`src/utils/gasManager.ts`): Fee calculation with multiplier
- **Retry & Recovery** (`src/utils/retry.ts`): Exponential backoff for API calls
- **Flashbots Integration** (`src/utils/flashbots.ts`): Bundle provider initialization
- **Pair Discovery** (`src/utils/pairDiscovery.ts`): Token-to-pair lookup
- **Blocklist** (`src/utils/blocklist.ts`): Known bad token/creator registry

## Data Flow

**Primary Flow (Blockchain Event):**

1. Factory contract emits `PairCreated` event with (token0, token1, pair)
2. `handleNewPair()` receives event parameters
3. Identify target token (non-WETH address)
4. Check deduplication (storage layer)
5. Validate token safety (9-stage pipeline in tokenSafety.ts)
6. Calculate slippage-adjusted minOut
7. Build swap transaction via `swapExactETHForTokens()`
8. Submit via Flashbots bundle (`sendTxWithRetry()`)
9. On success: Launch 3 concurrent monitors (stop-loss, take-profit, timed sell)
10. On confirmation: Update storage, send Telegram alert

**Secondary Flow (Telegram Alert):**

1. `telegramListener.ts` receives message in joined channels
2. Regex extract Ethereum addresses (0x...)
3. Check cooldown (5s) and dedup set
4. Call `handleAlphaDrop()` for manual token address
5. Look up pair via factory contract
6. Extract token0/token1 from pair
7. Route to `handleNewPair()` (same validation/execution as primary flow)

**Exit Flow (Automatic Sell Triggers):**

- **Stop-Loss**: Price drops below (initial_price * (1 - stopLossPercent/100))
  - Triggered every 15s interval
  - Sells entire balance
  - Updates storage status to "sold"

- **Take-Profit**: Price reaches (initial_price * (1 + takeProfitPercent/100))
  - Triggered every 15s interval
  - Sells entire balance
  - Updates storage status to "sold"

- **Timed Sell**: Executes after fixed duration (autoSellAfterMs = 5 minutes default)
  - setTimeout triggered regardless of price
  - Serves as circuit-breaker fallback

**State Management:**

- **In-Memory**: Processed contract addresses (cooldown tracking)
- **Disk Persistence** (`.bot-state.json`): Token → {txHash, timestamp, status}
- **Configuration** (`config.ts`): Centralized parameter management
- **Blocklist** (`blocklist.ts`): Preventive filter for known bad tokens

## Key Abstractions

**Token Safety Pipeline:**
- Purpose: Gate execution with 9-stage validation
- Examples: `isHoneypot()`, `checkTokenMetadata()`, `simulateSwap()`, `hasHighTransferTax()`, `hasMaxWalletOrTxLimits()`, `isLiquidityLocked()`, `isBlacklistedToken()`, `isLiquiditySufficient()`, `isKnownBadToken()`
- Pattern: Async functions returning boolean, with fallback mechanisms (e.g., honeypot API → static call simulation)

**Transaction Manager:**
- Purpose: Reliable transaction execution with retries and MEV protection
- Examples: `sendTxWithRetry()`
- Pattern: Builder pattern for tx construction, Flashbots bundling with fallback to direct send

**State Tracker:**
- Purpose: Prevent duplicate snipes and track position lifecycle
- Examples: `markSniped()`, `isAlreadySniped()`, `updateTokenStatus()`
- Pattern: Object serialization to JSON file, in-memory set for cooldown

**Config Provider:**
- Purpose: Centralize environment and contract constants
- Examples: `CONFIG` object in `src/config.ts`
- Pattern: Singleton with dotenv loading, network-specific RPC endpoints

## Entry Points

**Bot Listener (Primary):**
- Location: `src/bot.ts`
- Triggers: `startBot()` called when run as main module
- Responsibilities: Register factory contract event listener, handle PairCreated events, orchestrate validation→execution pipeline

**Telegram Listener (Secondary):**
- Location: `src/telegramListener.ts`
- Triggers: `main()` called when run as main module
- Responsibilities: Connect to Telegram client, parse incoming messages, extract addresses, throttle with cooldown, route to handleAlphaDrop

**Auth Bootstrap:**
- Bootstrap: generate TELEGRAM_SESSION manually via telegram package's StringSession (no helper script — placeholder auth.ts removed in cleanup task 260429).

**Deployment Scripts:**
- Location: `scripts/deploySepoliaTest.ts`, `scripts/addLiquidity.ts`, `scripts/manualTrigger.ts`
- Triggers: Hardhat environment context
- Responsibilities: Test contract deployment, liquidity pool creation, manual bot triggering

## Error Handling

**Strategy:** Graceful degradation with retry + fallback + alert

**Patterns:**

- **API Failures**: Retry with exponential backoff (1s, 2s, 4s default), fallback to alternative (e.g., honeypot.is → static call)
- **Contract Calls**: Try-catch with default return values (symbol="?", decimals=18), log warnings without throwing
- **Flashbots Failures**: Fallback to direct wallet.sendTransaction() with standard gas params
- **Validation Failures**: Log rejection reason, send Telegram alert with token address, skip to next opportunity
- **State Persistence**: Log warning if .bot-state.json missing, initialize fresh state
- **Telegram Connectivity**: TELEGRAM_SESSION validation on startup, graceful disconnect

## Cross-Cutting Concerns

**Logging:**
- Approach: Console.log with emoji prefixes ([BOT], 🔍, ✅, ❌, ⚠️) for readability
- Implementation: `src/utils/logger.ts` provides timestamp wrapping
- Usage: All modules log state changes, errors, confirmations

**Validation:**
- Approach: Multi-stage pipeline with short-circuit logic (fail fast on first breach)
- Implementation: `tokenSafety.ts` functions return boolean; called in parallel where possible
- Decision Point: Line 290 in bot.ts — one failure blocks entire snipe

**Authentication:**
- Approach: Environment-based credentials (PRIVATE_KEY, TELEGRAM credentials)
- Implementation: `.env` loading via dotenv, wallet instantiation from private key
- Security: Private keys never logged; Flashbots auth key in env

**MEV Protection:**
- Approach: Flashbots bundle submission for private mempool placement
- Implementation: `flashbots.ts` creates bundle provider; `txManager.ts` sends bundle with retry
- Fallback: Standard transaction submission if Flashbots unavailable

**Configuration:**
- Approach: Centralized `CONFIG` object with environment overrides
- Implementation: `src/config.ts` spreads addresses.json, sets defaults
- Parameters: Network selection, gas limits, monitoring intervals, slippage tolerance

---

*Architecture analysis: 2026-03-19*
