# Pitfalls Research

**Domain:** Multi-chain EVM crypto sniper bot (ethers v6 migration, multi-chain, Uniswap V3, risk management, SQLite storage, smart exits, web dashboard)
**Researched:** 2026-03-19
**Confidence:** HIGH (verified against official docs, GitHub issues, and codebase analysis)

## Critical Pitfalls

### Pitfall 1: BigInt Precision Loss During ethers v6 Migration

**What goes wrong:**
The existing codebase uses `Number()` to convert BigNumber values for price comparisons (e.g., `const initialPrice = Number(initialOut[1])` in `src/bot.ts:61`). After migrating to ethers v6, all contract return values become native BigInt. Developers instinctively continue using `Number()` for arithmetic, but JavaScript `Number` loses precision above `2^53 - 1` (9,007,199,254,740,991) -- which is only ~0.009 ETH in wei. Any token balance, price quote, or liquidity amount above this threshold silently rounds, causing incorrect stop-loss/take-profit triggers, wrong slippage calculations, and miscalculated position sizes.

**Why it happens:**
BigInt cannot use standard comparison operators with Number (`bigint > number` throws). Developers convert to Number "just to compare" without realizing the magnitude of wei-denominated values. The existing codebase already has this pattern in 6+ places across `bot.ts`.

**How to avoid:**
- All arithmetic on token amounts and prices must stay in BigInt until the final display formatting step.
- Use `ethers.formatEther()` / `ethers.formatUnits()` only for display, never for calculation inputs.
- For percentage calculations (ROI, stop-loss thresholds), multiply first then divide: `(currentPrice * 100n) / initialPrice` instead of converting to Number for floating-point math.
- Create a utility module (`src/utils/math.ts`) with BigInt-safe percentage, ratio, and comparison helpers.
- Lint rule: ban `Number()` on any variable that could hold a wei value.

**Warning signs:**
- `Number()` or `.toString()` followed by `parseFloat()` appearing in price/amount code.
- ROI calculations returning `NaN` or `Infinity`.
- Stop-loss triggering on positions that should be profitable (rounding made the price look lower).
- Unit tests passing with small values but failing with realistic mainnet-scale values.

**Phase to address:**
Phase 1 (ethers v6 migration) -- this must be the very first concern when touching any arithmetic code.

---

### Pitfall 2: Flashbots Provider Package Version Mismatch

**What goes wrong:**
The project currently uses `@flashbots/ethers-provider-bundle@0.6.1`, which has a peer dependency on ethers v5. The v6-compatible version is `@flashbots/ethers-provider-bundle@1.0.0`, which requires `ethers@6.7.1` as a peer dependency. The API has changed significantly: `FlashbotsBundleProvider.create()` constructor arguments differ, `providers.JsonRpcProvider` becomes `ethers.JsonRpcProvider`, the `Wallet` import path changes, and `TransactionRequest` types are restructured. Simply upgrading ethers without also upgrading the Flashbots provider will cause a hard crash at import time due to incompatible types.

**Why it happens:**
Developers upgrade ethers first and assume dependent packages will "just work." The Flashbots package is a critical dependency but easy to overlook since it is only imported in two files (`flashbots.ts`, `txManager.ts`). The ethers v6 migration guide does not mention Flashbots specifically.

**How to avoid:**
- Upgrade `@flashbots/ethers-provider-bundle` from 0.6.1 to 1.0.0 simultaneously with the ethers v5-to-v6 migration.
- Update all import paths: `import { providers, Wallet } from "ethers"` becomes `import { JsonRpcProvider, Wallet } from "ethers"`.
- Update `FlashbotsBundleProvider.create()` call signature in `src/utils/flashbots.ts`.
- Update `TransactionRequest` import from `@ethersproject/abstract-provider` (v5 sub-package) to `ethers` (v6 top-level export).
- Test Flashbots bundle submission on Sepolia with the v6 provider before touching any other code.

**Warning signs:**
- TypeScript errors mentioning `providers` not being an exported member of `ethers`.
- Runtime error: `FlashbotsBundleProvider.create is not a function`.
- Import errors from `@ethersproject/*` sub-packages (these do not exist in v6).

**Phase to address:**
Phase 1 (ethers v6 migration) -- Flashbots upgrade must be atomic with ethers upgrade.

---

### Pitfall 3: Treating All EVM Chains as Identical

**What goes wrong:**
Developers build a "chain abstraction" that assumes all EVM chains behave identically, just with different RPC URLs and contract addresses. In reality, chains differ in critical ways that affect a sniper bot: BSC has 3-second blocks (vs. Ethereum's 12s), Arbitrum has no traditional mempool and variable block times, Base uses a sequencer that controls transaction ordering, gas pricing mechanisms differ (EIP-1559 on some, legacy on others), and MEV protection strategies are fundamentally different per chain. A naive abstraction that swaps config values will produce a bot that is too slow on BSC, wastes gas on Arbitrum, and gets front-run on Base.

**Why it happens:**
"EVM-compatible" implies behavioral equivalence. Tutorials show multi-chain deployment as "just change the RPC URL." The ethers.js API does abstract away most chain differences at the RPC level, hiding the operational differences that matter for latency-sensitive trading.

**How to avoid:**
- Design the chain abstraction with per-chain strategy interfaces, not just per-chain config objects.
- Each chain module must implement: `getGasStrategy()`, `getMevProtection()`, `getBlockTiming()`, `getNonceManager()`.
- BSC: Use 1-2 second polling intervals (not 15s), legacy gas pricing, Merkle/Blink private RPC for MEV protection.
- Arbitrum: No Flashbots -- use Merkle or Alchemy MEV protection RPC. Gas estimation is L1+L2 composite. Block times are variable (can be sub-second).
- Base: Sequencer controls ordering. Use Flashbots Protect RPC or Merkle. Account for sequencer downtime.
- ETH Mainnet: Flashbots bundles or Flashbots Protect RPC. EIP-1559 gas with `maxFeePerGas`/`maxPriorityFeePerGas`.
- Test each chain independently with chain-specific integration tests.

**Warning signs:**
- A single `ChainConfig` type that is purely data (no behavioral hooks).
- Same polling interval across all chains.
- `getGasPrice()` used identically across chains (some need `getFeeData()` for EIP-1559).
- "Works on Sepolia" assumed to mean "works on BSC."

**Phase to address:**
Phase 2 (multi-chain architecture) -- must be designed correctly from the start; retrofitting per-chain behaviors is a rewrite.

---

### Pitfall 4: Uniswap V3 Fee Tier Blindness

**What goes wrong:**
In V2, one token pair = one pool. In V3, one token pair can have up to 4 pools (0.01%, 0.05%, 0.3%, 1% fee tiers). A sniper bot that listens for `PoolCreated` events and processes only the first pool it sees will miss the pool where actual liquidity is deployed. Worse, a token creator can create a low-fee pool as a decoy (with minimal liquidity) while the real liquidity sits in a different fee tier. The bot snipes into the wrong pool and gets a terrible fill or cannot exit.

**Why it happens:**
V2 mental model: one pair address per token pair. The V2 factory event `PairCreated` returns a single pair. The V3 factory event `PoolCreated` also returns a single pool, but it fires separately for each fee tier. Developers map V2 logic onto V3 without realizing the 1:N relationship.

**How to avoid:**
- On V3 `PoolCreated` event, do NOT immediately snipe. Instead, query all existing pools for that token pair across all fee tiers.
- Select the pool with the deepest liquidity (highest TVL), not just the first one detected.
- Implement a brief delay (2-5 blocks) after pool creation to check if liquidity is actually added (pool creation and liquidity addition are separate transactions in V3).
- Route swaps through the Uniswap V3 SwapRouter which can auto-route across fee tiers, or implement manual routing logic.
- Store all known pools per token pair, not a single pool address.

**Warning signs:**
- Data model stores a single `pairAddress` per token (current `addresses.json` pattern).
- Bot snipes tokens but gets 0 output or reverts with "insufficient liquidity."
- Token appears to have liquidity on Etherscan but the bot's pool reference is empty.

**Phase to address:**
Phase 3 (Uniswap V3 integration) -- fundamental to correct V3 pool discovery.

---

### Pitfall 5: Nonce Collision Across Concurrent Chains and Monitors

**What goes wrong:**
With multi-chain operation, the bot manages multiple wallets (or a single wallet across chains -- each chain has independent nonces). The current codebase fetches the nonce once at the start of `sendTxWithRetry` and reuses it across all retries (the existing bug in `src/utils/txManager.ts:15`). In a multi-chain scenario, add concurrent stop-loss/take-profit/timed-sell monitors, and you get: two sell transactions on the same chain grabbing the same nonce, one being rejected; retries with stale nonces failing silently; and a stuck nonce blocking all subsequent transactions on that chain until the bot is restarted.

**Why it happens:**
Nonce management is trivially correct in single-transaction-at-a-time scenarios. The existing bot's polling-based monitors (`setInterval` in `bot.ts`) can trigger multiple sell attempts simultaneously on the same token (documented in CONCERNS.md). Multi-chain amplifies this: 4 chains x 10 monitored tokens = 40+ concurrent operations competing for nonces.

**How to avoid:**
- Implement a per-chain nonce manager that tracks in-flight nonces locally (do not rely solely on `provider.getTransactionCount`).
- Use a mutex/queue per chain: only one transaction can be built and submitted at a time per chain-wallet pair.
- On transaction failure, sync local nonce with on-chain nonce before retrying.
- On transaction success, increment local nonce immediately (do not re-fetch).
- The nonce manager should be a singleton per chain, shared across all monitors.
- Consider using an atomic datastore (SQLite) for nonce tracking if worker threads are introduced later.

**Warning signs:**
- "nonce too low" errors in logs.
- Transactions stuck as "pending" indefinitely.
- Sell transactions failing after a successful buy on the same chain.
- Multiple `getTransactionCount` RPC calls per second from concurrent monitors.

**Phase to address:**
Phase 1 (bug fixes/hardening) for the existing single-chain nonce bug; Phase 2 (multi-chain) for per-chain nonce isolation.

---

### Pitfall 6: SQLite Migration Losing Atomicity Guarantees

**What goes wrong:**
Developers replace JSON file writes with SQLite inserts but continue using the same read-modify-write pattern: read state into memory, modify in-memory object, write entire state back. This negates SQLite's transactional guarantees. Concurrent operations (stop-loss monitor updates token status while a new snipe writes to the same table) still produce race conditions because the in-memory cache diverges from disk. The "SQLite migration" becomes a file format change with zero concurrency improvement.

**Why it happens:**
The existing storage pattern (`src/utils/storage.ts`) loads the entire state into a module-level `let state: State` object on startup and writes the whole thing back on every change. Developers port this pattern to SQLite: load all rows into memory on startup, modify the in-memory object, flush to SQLite. This is the single most common SQLite anti-pattern in Node.js applications.

**How to avoid:**
- Eliminate the in-memory state cache. Every read goes through SQLite queries, every write is an SQL statement.
- Use `better-sqlite3` (synchronous, simpler, faster for single-process use) with WAL mode enabled for concurrent reads.
- Wrap multi-step operations in explicit transactions: `db.transaction(() => { ... })()`.
- Use `INSERT OR REPLACE` / `UPDATE ... WHERE` for idempotent writes instead of read-modify-write.
- Add a `version` or `updated_at` column for optimistic concurrency control on position updates.
- Enable WAL mode: `db.pragma('journal_mode = WAL')` -- this is not the default.

**Warning signs:**
- A module-level cache object that mirrors the database contents.
- `SELECT *` on startup to load everything into memory.
- Database writes happening through a single `persist()` function that dumps the entire state.
- Race condition bugs that existed with JSON files still occurring after SQLite migration.

**Phase to address:**
Phase 1 (SQLite migration) -- the migration must change the access pattern, not just the file format.

---

### Pitfall 7: Double-Sell Race Condition Amplified by Multi-Chain

**What goes wrong:**
The existing bot has a documented race condition (CONCERNS.md): stop-loss and take-profit monitors can fire simultaneously on the same token, both reading the token balance, both submitting sell transactions, one succeeding, one failing and wasting gas (or worse, one reverting with the token already sold). With multi-chain and smart exits (trailing stop, partial sells, time-weighted exits), the surface area for this bug expands dramatically. Add V3 positions across multiple fee tiers and you now have 3-4 exit monitors per position per chain.

**Why it happens:**
Each monitor is an independent `setInterval` callback. There is no shared lock, no position state machine, and no "currently selling" flag. The `updateTokenStatus` function is non-atomic (read-modify-write on JSON file). Even with SQLite, without proper locking, two monitors can both read `status: "pending"` and both attempt to sell.

**How to avoid:**
- Implement a position state machine with transitions: `MONITORING -> SELLING -> SOLD/FAILED`. Only one transition from MONITORING to SELLING can succeed.
- Use a mutex per position: `const lock = new Mutex(); await lock.runExclusive(async () => { ... })`.
- In SQLite: `UPDATE positions SET status = 'selling' WHERE token = ? AND status = 'monitoring'` returns `changes` count -- if 0, another monitor already claimed it.
- Consolidate all exit monitors into a single `PositionManager` class per position that coordinates stop-loss, take-profit, trailing stop, and timed sell internally.
- Cancel all other monitors when any one triggers a sell.

**Warning signs:**
- Two sell transactions for the same token appearing in the transaction log.
- Gas spent on reverted sell transactions.
- Token status stuck in "pending" after one sell succeeded and one failed.
- `updateTokenStatus` called multiple times for the same token in quick succession.

**Phase to address:**
Phase 1 (bug fixes) for the basic fix; Phase 4 (smart exits) for the full state machine with trailing stops and partial sells.

---

### Pitfall 8: V3 Pool Creation vs. Liquidity Addition Timing Gap

**What goes wrong:**
In Uniswap V2, `PairCreated` and `addLiquidity` can happen in the same transaction (and usually do for new token launches). In V3, `createPool` and `mint` (adding liquidity) are always separate calls, and the pool has zero liquidity when first created. A sniper bot that reacts to `PoolCreated` and immediately attempts to swap will get a revert ("insufficient liquidity") or a catastrophically bad price because there is no liquidity in any tick range yet. The bot wastes gas on a guaranteed-to-fail transaction.

**Why it happens:**
V2's `PairCreated` event is a reliable signal that liquidity is being added (the factory creates the pair as part of the first `addLiquidity` call). Developers carry this assumption to V3. But V3's `createPool` is a standalone call that just initializes the pool contract at a specific price -- liquidity comes later via `mint` on the NonfungiblePositionManager.

**How to avoid:**
- On V3 `PoolCreated`: record the pool but do NOT attempt to trade.
- Listen for the `Mint` event on the newly created pool (or `IncreaseLiquidity` on the NonfungiblePositionManager) as the actual trade signal.
- After detecting liquidity, verify the amount meets the minimum threshold before sniping.
- Implement a "pool maturity" check: wait for at least one `Mint` event, then verify reserves, then proceed with safety checks.
- V2 and V3 need different event-processing pipelines despite both being "new pool" detection.

**Warning signs:**
- Swap transactions reverting immediately after pool creation events.
- "Pool has no liquidity" errors in logs despite the pool existing on-chain.
- Bot sniping V3 pools and getting 0 tokens back.
- High gas waste from failed transactions on V3 pools.

**Phase to address:**
Phase 3 (Uniswap V3 integration) -- requires a fundamentally different event processing pipeline.

---

### Pitfall 9: Hardcoded Etherscan Links and Chain-Specific Constants

**What goes wrong:**
The current codebase has hardcoded `etherscan.io` URLs in Telegram notifications (e.g., `https://etherscan.io/tx/${sellTx.hash}` in `bot.ts:98`). When the bot runs on BSC, the link goes to Ethereum Etherscan (wrong chain, non-existent transaction). Similarly, the WETH address (`wethAddress` in `addresses.json` currently set to `0x000...000`) is chain-specific: it is WETH on Ethereum, WBNB on BSC, and different wrapped native tokens on each chain. Using the wrong wrapped token address causes swaps to revert.

**Why it happens:**
These constants are embedded throughout the codebase as string literals. They are invisible during development because Sepolia testing uses Etherscan URLs and the correct WETH address. The bug only manifests when deploying to other chains.

**How to avoid:**
- Create a per-chain constants registry: `{ explorerUrl, wrappedNativeToken, nativeSymbol, explorerApiKey }`.
- Replace all hardcoded URLs with template functions: `getExplorerTxUrl(chainId, txHash)`.
- Replace `CONFIG.wethAddress` with `chainConfig.wrappedNativeToken` that varies per chain.
- Automated test: for each supported chain config, verify that `wrappedNativeToken` is a valid contract on that chain.
- Search for all `etherscan.io` string literals and replace with chain-aware functions.

**Warning signs:**
- Telegram notifications with broken explorer links.
- Swap reverts with "TRANSFER_FAILED" or "INVALID_PATH" on non-Ethereum chains.
- WETH address returning `0` balance on BSC (because WETH does not exist on BSC at the Ethereum address).

**Phase to address:**
Phase 2 (multi-chain) -- must be part of the chain abstraction design.

---

### Pitfall 10: Missing Per-Chain MEV Protection Strategy

**What goes wrong:**
Flashbots works only on Ethereum mainnet. The bot currently hardcodes Flashbots relay usage (`"https://relay.flashbots.net"` in `flashbots.ts:12`). On BSC, Base, and Arbitrum, Flashbots bundles will be silently rejected (or the relay endpoint will not even respond). The bot falls back to public mempool submission, gets sandwich attacked, and loses value on every trade.

**Why it happens:**
Flashbots is the most well-known MEV protection solution, so developers assume it works everywhere. The Flashbots Protect RPC (`rpc.flashbots.net`) only works on Ethereum mainnet. Other chains require different MEV protection providers (Merkle, Blink, Alchemy MEV protection) or entirely different transaction submission strategies.

**How to avoid:**
- Design MEV protection as a per-chain pluggable strategy interface: `interface MevProtection { submitTx(tx): Promise<TxReceipt> }`.
- ETH Mainnet: Flashbots Protect RPC (`rpc.flashbots.net/fast`) or Flashbots bundle provider. Consider switching from bundle API to Protect RPC (simpler, library-agnostic, works with standard `eth_sendRawTransaction`).
- BSC: Merkle private RPC (`bsc-rpc.merkle.io`) or Blink BSC endpoint.
- Arbitrum: Merkle or Alchemy MEV-protected RPC. No traditional mempool, so sequencer ordering is the main concern.
- Base: Merkle or Alchemy MEV-protected RPC. Sequencer-controlled ordering.
- Fallback strategy: if the private RPC is down, decide whether to submit publicly (risky) or skip the trade (safe).
- Never silently fall through to public mempool -- log a critical warning.

**Warning signs:**
- `sendBundle` returning errors or timeouts on non-Ethereum chains.
- Transactions being sandwich attacked on BSC/Base/Arbitrum despite "MEV protection" being enabled.
- The Flashbots relay URL being used for all chains.

**Phase to address:**
Phase 2 (multi-chain) -- MEV strategy is per-chain infrastructure, not a global setting.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `Number()` on BigInt for quick arithmetic | Simpler code, familiar operators | Silent precision loss on amounts > 0.009 ETH in wei; wrong trades | Never in production code handling real funds |
| Single `addresses.json` for all chains | Quick to set up, easy to read | Cannot support multiple chains; every chain needs different addresses | Only during single-chain development/testing |
| Flashbots Protect RPC instead of bundle API | Simpler integration (just change RPC URL), no library dependency | Less control over bundle targeting, no multi-tx bundles, no simulation before submission | Acceptable for initial implementation; upgrade to bundles only if advanced features needed |
| In-memory state cache with periodic SQLite flush | Faster reads, simpler migration from JSON | State divergence between memory and disk; crash loses unflushed state; race conditions persist | Never -- use SQLite as the source of truth from day one |
| Polling-based price monitoring (`setInterval`) | Simple to implement, easy to reason about | 15s latency to detect price changes; 1440+ RPC calls/day/token; scales poorly with multi-chain | Only for MVP; must migrate to WebSocket event-based monitoring for production |
| Same safety pipeline for V2 and V3 pools | Less code, single code path | V3 has different liquidity structure (concentrated, tick-based); V2 safety checks may not apply or may give false confidence | Never -- V3 needs V3-specific liquidity and price range validation |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Flashbots relay | Hardcoding relay URL to mainnet; not validating relay response | Use chain-aware relay selection; validate bundle inclusion response (`waitResponse === 0` means included, not success) |
| Alchemy/Infura RPC | Using same API key across all chains; hitting rate limits when monitoring 4 chains | Separate API keys per chain; implement request queue with rate limiting; rotate between multiple RPC providers |
| Uniswap V3 NonfungiblePositionManager | Using V2 router ABI for V3 swaps | V3 uses SwapRouter (not Router02); LP positions are NFTs managed by NonfungiblePositionManager, not ERC-20 LP tokens |
| Honeypot API | Assuming the API works for all chains | Honeypot.is primarily supports Ethereum; BSC has Go+ Security API; some chains have no reliable honeypot detection |
| Telegram MTProto | Session strings expiring silently; bot continues running but stops receiving alpha signals | Implement session health check on startup; detect `AuthKeyError` and alert; add periodic connection test |
| Block explorers | Constructing Etherscan URLs for all chains | Each chain has its own explorer (BscScan, Arbiscan, BaseScan) with different URL patterns and API keys |
| better-sqlite3 | Not enabling WAL mode; getting SQLITE_BUSY errors under concurrent reads | Enable WAL mode immediately after opening: `db.pragma('journal_mode = WAL')` |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-token `setInterval` for price monitoring | Memory growth, RPC rate limiting, event loop blocking | Use a single monitoring loop that batches all position checks; multicall contract for batch RPC | > 20 monitored positions across all chains |
| `provider.getGasPrice()` per transaction | Stale gas prices, 1 extra RPC call per tx, race between gas estimation and submission | Cache gas price with 5-second TTL; use `getFeeData()` for EIP-1559 chains | > 50 transactions/minute across chains |
| `getAmountsOut()` for V3 price quotes | Returns incorrect prices for V3 (V3 has no `getAmountsOut`); using V2 router for V3 tokens gives wrong results | Use V3 Quoter contract (`quoteExactInputSingle`) for V3 pools | Immediately upon V3 integration |
| Synchronous SQLite writes in hot path | Event loop blocked during writes; missed PairCreated events | Use `better-sqlite3` transactions for batch writes; keep write operations minimal in event handlers | > 5 simultaneous new pair events |
| Unbounded `processedContracts` Set (existing pattern) | Memory growth ~2KB per token, never cleaned | LRU cache with TTL; evict entries older than 24h | > 10,000 tokens processed (days of operation) |
| Individual RPC calls for token safety checks | 8+ sequential RPC calls per token; each takes 200-500ms; 4+ seconds per safety check | Use Multicall3 contract to batch all view calls into a single RPC call; reduces safety check to ~500ms total | > 10 new pairs detected per minute |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using same wallet private key across all chains | If one chain's RPC is compromised, attacker drains all chains | Use separate hot wallets per chain; keep minimal balance per chain; implement per-chain spending limits |
| Falling back to public mempool when private relay is down | Every trade gets sandwiched; typical loss of 1-5% per trade | Fail-closed: skip the trade if MEV protection is unavailable; never silently fall back to public |
| Trusting honeypot API as sole safety gate | API can be down, rate-limited, or wrong; bot skips safety check and buys a honeypot | Honeypot check must be one of N checks, all must pass; simulate the actual sell transaction on-chain as the final gate |
| Logging transaction hashes and wallet addresses to Telegram | Links wallet activity to Telegram account; chain analysis can identify operator | Hash or abbreviate addresses in notifications; use separate notification wallet address |
| Not validating RPC endpoint chain ID on startup | If environment variable points to wrong chain, bot trades on wrong network | On startup: `provider.getNetwork()` must match expected chain ID; abort if mismatch |
| Storing SQLite database with transaction history unencrypted | If server is compromised, attacker gets full trade history and can infer strategy | Encrypt sensitive columns (tx hashes, token addresses) or use full-disk encryption |
| Auto-approving `MaxUint256` to router contracts | If router contract is compromised or malicious, all approved tokens can be drained | Approve only the exact amount needed per trade; revoke approvals after selling |

## UX Pitfalls

Common user experience mistakes in this domain (web dashboard and notifications).

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Dashboard showing stale data because WebSocket disconnected silently | User thinks positions are stable when they are actually being sold; makes wrong decisions | Implement heartbeat/reconnection logic; show "last updated" timestamp prominently; visual indicator for connection status |
| Showing raw wei values in dashboard | Unreadable numbers like `100000000000000000` instead of `0.1 ETH` | Format all values with `formatEther`/`formatUnits` and include token symbol; round to 4-6 significant digits |
| Telegram notification spam during high-activity periods | User mutes the bot; misses critical alerts (stop-loss, failed sells) | Priority levels: critical (sells, errors) always send; info (new token detected) batched/throttled; debug only in dashboard |
| No distinction between "bot is stopped" and "no new tokens" | User cannot tell if bot is working or crashed | Health check endpoint; periodic heartbeat notification ("Bot alive, monitoring 4 chains, 12 positions open") |
| Dashboard controls (start/stop) without confirmation | User accidentally stops bot on a chain with open positions | Confirmation dialog for destructive actions; show open positions count before allowing stop |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **ethers v6 migration:** Often missing BigInt arithmetic in monitoring loops -- verify `monitorStopLoss`, `monitorTakeProfit`, and `scheduleTimedSell` all use BigInt, not Number, for price comparisons
- [ ] **Multi-chain support:** Often missing per-chain gas strategy -- verify BSC uses legacy gasPrice, Ethereum uses EIP-1559 maxFeePerGas, Arbitrum uses L1+L2 fee estimation
- [ ] **V3 integration:** Often missing fee tier discovery -- verify bot checks all 4 fee tiers (1bp, 5bp, 30bp, 100bp) before selecting pool for swap
- [ ] **V3 integration:** Often missing Mint event listener -- verify bot waits for actual liquidity addition, not just pool creation
- [ ] **SQLite migration:** Often missing WAL mode -- verify `PRAGMA journal_mode = WAL` is set; without it, concurrent reads block on writes
- [ ] **SQLite migration:** Often missing migration from in-memory cache -- verify there is NO module-level state object mirroring the database
- [ ] **Risk management:** Often missing daily loss limit enforcement across chains -- verify the limit aggregates losses from ALL chains, not per-chain
- [ ] **Smart exits:** Often missing trailing stop cancellation -- verify trailing stop monitor is cancelled when position is sold via take-profit or stop-loss
- [ ] **MEV protection:** Often missing chain-specific relay -- verify BSC, Base, and Arbitrum do NOT use the Flashbots relay URL
- [ ] **Web dashboard:** Often missing authentication -- verify the dashboard requires at minimum a password/token before exposing position data and bot controls
- [ ] **Nonce management:** Often missing retry nonce refresh -- verify that after a failed transaction, the nonce is re-synced with on-chain state before retry

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| BigInt precision loss causing bad trades | HIGH (financial loss already occurred) | Audit all trade logs for discrepancies; add BigInt-only arithmetic throughout; cannot recover lost funds |
| Flashbots version mismatch crash | LOW (no financial loss, just downtime) | Pin both packages; upgrade atomically; deploy on testnet first |
| Wrong chain WETH address causing swap reverts | LOW (transactions revert, gas wasted) | Fix chain config; no funds lost (reverted transactions) |
| Double-sell race condition | MEDIUM (gas wasted, one sell fails) | Add position mutex; audit trade history for double-sell attempts; refund gas from operational budget |
| SQLite write contention | MEDIUM (potential state corruption) | Enable WAL mode; if state corrupted, reconstruct from on-chain transaction history |
| Nonce stuck on one chain | MEDIUM (all transactions blocked on that chain) | Submit a zero-value self-transfer at the stuck nonce with higher gas to unstick; implement nonce recovery in bot |
| MEV sandwich attack due to missing protection | HIGH (value extracted from every affected trade) | Switch to private RPC immediately; audit affected trades for loss amount; cannot recover extracted MEV |
| V3 snipe into empty pool | LOW (transaction reverts, only gas lost) | Add liquidity verification step before trade; gas cost is the only loss |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| BigInt precision loss | Phase 1: ethers v6 migration | Grep for `Number()` on any contract return value; unit tests with realistic wei-scale values |
| Flashbots version mismatch | Phase 1: ethers v6 migration | `npm ls ethers` shows single v6 version; Flashbots bundle test passes on Sepolia |
| Double-sell race condition | Phase 1: bug fixes | Concurrent test: trigger stop-loss and take-profit simultaneously; only one sell executes |
| SQLite anti-patterns | Phase 1: SQLite migration | No module-level state cache exists; WAL mode enabled; concurrent write test passes |
| Chain behavior differences | Phase 2: multi-chain | Integration test per chain with chain-specific gas estimation and block timing |
| Hardcoded chain constants | Phase 2: multi-chain | Zero occurrences of `etherscan.io` string literals in codebase; all explorer URLs from chain config |
| Per-chain MEV protection | Phase 2: multi-chain | Each chain config specifies MEV strategy; test bundle/RPC on each chain's testnet |
| Nonce collision | Phase 2: multi-chain | Load test: 10 concurrent transactions on same chain; all succeed with sequential nonces |
| V3 fee tier blindness | Phase 3: V3 integration | Test with token that has pools in multiple fee tiers; bot selects deepest liquidity pool |
| V3 pool creation timing | Phase 3: V3 integration | Test: create V3 pool without adding liquidity; bot does NOT attempt to trade |
| Trailing stop cancellation | Phase 4: smart exits | Test: take-profit fires; verify trailing stop interval is cleared (not still polling) |
| Daily loss limit | Phase 4: risk management | Test: simulate 5% portfolio loss across 2 chains; bot halts on both chains |
| Dashboard stale data | Phase 5: web dashboard | Disconnect WebSocket; verify dashboard shows connection status within 5 seconds |

## Sources

- [ethers v5 to v6 official migration guide](https://docs.ethers.org/v6/migrating/)
- [ethers v6 migration pain points -- GitHub Discussion #4312](https://github.com/ethers-io/ethers.js/discussions/4312)
- [ethers v6 migration notes -- GitHub Issue #3795](https://github.com/ethers-io/ethers.js/issues/3795)
- [Flashbots ethers-provider-bundle repository](https://github.com/flashbots/ethers-provider-flashbots-bundle)
- [Flashbots ethers.js provider docs](https://docs.flashbots.net/flashbots-auction/libraries/ethers-js-provider) (confirms v5 design)
- [npm: @flashbots/ethers-provider-bundle v1.0.0](https://www.npmjs.com/package/@flashbots/ethers-provider-bundle) (peer dep: ethers 6.7.1)
- [Flashbots Protect RPC overview](https://docs.flashbots.net/flashbots-protect/overview)
- [Uniswap V3 concentrated liquidity docs](https://docs.uniswap.org/concepts/protocol/concentrated-liquidity)
- [Uniswap V3 IUniswapV3Factory interface](https://docs.uniswap.org/contracts/v3/reference/core/interfaces/IUniswapV3Factory)
- [Uniswap V3 fee tiers](https://docs.uniswap.org/concepts/protocol/fees)
- [Merkle MEV protection (BSC, Base, Arbitrum)](https://www.merkle.io/bsc-rpc)
- [Alchemy MEV protection docs](https://www.alchemy.com/docs/reference/mev-protection)
- [EVM nonce management guide -- QuickNode](https://www.quicknode.com/guides/ethereum-development/transactions/how-to-manage-nonces-with-ethereum-transactions)
- [thirdweb nonce management](https://blog.thirdweb.com/sending-more-than-one-transaction-at-a-time/)
- [better-sqlite3 performance/WAL docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- [Crypto trading bot pitfalls 2025](https://www.gate.com/news/detail/13225882)
- [PancakeSwap V3 contract addresses](https://developer.pancakeswap.finance/contracts/v3/addresses)
- Codebase analysis: `src/bot.ts`, `src/utils/txManager.ts`, `src/utils/storage.ts`, `src/utils/flashbots.ts`, `src/config.ts`
- Known issues: `.planning/codebase/CONCERNS.md`

---
*Pitfalls research for: Multi-chain EVM crypto sniper bot*
*Researched: 2026-03-19*
