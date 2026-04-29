# Architecture Research

**Domain:** Multi-chain EVM crypto sniper bot
**Researched:** 2026-03-19
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
                              INGESTION LAYER
  +-----------------------------------------------------------------+
  |  +-------------+  +-------------+  +-------------+              |
  |  | ETH Listener|  | BSC Listener|  | ARB Listener|  ...per chain|
  |  | (V2+V3 Fac) |  | (PCS V2+V3) |  | (V2+V3 Fac) |            |
  |  +------+------+  +------+------+  +------+------+              |
  |         |                |                |                      |
  |  +------+------+  +------+------+  +------+------+              |
  |  | Telegram    |  (all feed into the Event Bus)                  |
  |  | Listener    |                                                 |
  |  +------+------+                                                 |
  +---------+-------------------------------------------------------+
            |
            v
  +-----------------------------------------------------------------+
  |                        EVENT BUS / ROUTER                        |
  |  Normalizes chain-specific events into ChainEvent objects        |
  |  Routes to orchestrator with chain context attached              |
  +-----------------------------------------------------------------+
            |
            v
  +-----------------------------------------------------------------+
  |                      ORCHESTRATION LAYER                         |
  |  +------------------+  +------------------+  +----------------+ |
  |  | Token Validator  |  | Risk Manager     |  | Capital Alloc  | |
  |  | (9-stage pipe)   |  | (limits, P&L)    |  | (per-chain $)  | |
  |  +--------+---------+  +--------+---------+  +-------+--------+ |
  |           |                      |                    |          |
  +-----------+----------------------+--------------------+----------+
              |
              v
  +-----------------------------------------------------------------+
  |                       EXECUTION LAYER                            |
  |  +-------------+  +-------------+  +-------------+              |
  |  | ETH Executor|  | BSC Executor|  | ARB Executor|              |
  |  | (Flashbots) |  | (bloXroute) |  | (Timeboost) |              |
  |  +------+------+  +------+------+  +------+------+              |
  +---------+-------------------------------------------------------+
            |
            v
  +-----------------------------------------------------------------+
  |                    POSITION MANAGEMENT LAYER                     |
  |  +------------------+  +------------------+                      |
  |  | Price Monitor    |  | Exit Strategy    |                      |
  |  | (per-chain WS)   |  | Engine           |                      |
  |  +--------+---------+  +--------+---------+                      |
  +-----------+----------------------+-------------------------------+
              |
              v
  +-----------------------------------------------------------------+
  |                       PERSISTENCE LAYER                          |
  |  +------------------+  +------------------+  +----------------+ |
  |  | SQLite DB        |  | Audit Trail      |  | Config Store   | |
  |  | (positions, P&L) |  | (all tx history) |  | (per-chain)    | |
  |  +------------------+  +------------------+  +----------------+ |
  +-----------------------------------------------------------------+
              |
              v
  +-----------------------------------------------------------------+
  |                       INTERFACE LAYER                            |
  |  +------------------+  +------------------+                      |
  |  | Web Dashboard    |  | Telegram Notifier|                      |
  |  | (Fastify + WS)   |  | (alerts)         |                      |
  |  +------------------+  +------------------+                      |
  +-----------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Chain Listener | Subscribe to factory PairCreated/PoolCreated events per chain | One ethers.js WebSocket provider per chain, listening to V2 Factory + V3 Factory events simultaneously |
| Telegram Listener | Parse alpha signals (contract addresses) from Telegram channels | MTProto client, regex extraction, cooldown/dedup, feeds into Event Bus with "manual" chain hint |
| Event Bus | Normalize chain-specific events into a common `ChainEvent` type and route them | TypeScript EventEmitter or simple pub/sub; attaches chain context (chainId, dex, version) to every event |
| Token Validator | Run safety pipeline (honeypot, blacklist, liquidity, tax, metadata) | Async pipeline with chain-aware API calls; same 9 checks but with chain-specific contract addresses and APIs |
| Risk Manager | Enforce position limits, daily P&L caps, max exposure per chain | Queries SQLite for current positions and 24h P&L; gates execution with YES/NO |
| Capital Allocator | Decide how much native currency to commit per snipe per chain | Reads wallet balances across chains, applies allocation rules, returns snipe amount |
| Chain Executor | Build and submit transactions with chain-specific MEV protection | Strategy pattern: Flashbots (ETH), bloXroute Protect RPC (BSC), standard RPC (Base/Arbitrum with sequencer ordering) |
| Price Monitor | Track token prices in real-time for exit decisions | WebSocket providers for block events; batch `getAmountsOut` calls per chain |
| Exit Strategy Engine | Execute stop-loss, take-profit, trailing stop, partial sells | State machine per position; coordinates with executor for sell transactions |
| SQLite Store | Persist positions, trades, P&L, configuration atomically | better-sqlite3 with WAL mode; synchronous API eliminates callback complexity |
| Web Dashboard | Real-time UI for monitoring and control | Fastify HTTP + WebSocket server; pushes state updates to connected clients |
| Telegram Notifier | Send alerts for snipes, sells, errors | Telegram Bot API via HTTP POST; chain-aware message formatting with block explorer links |

## Recommended Project Structure

```
src/
+-- chains/                    # Chain abstraction layer
|   +-- types.ts               # ChainConfig, ChainEvent, DEXConfig interfaces
|   +-- registry.ts            # Chain registry: maps chainId -> full config
|   +-- ethereum.ts            # ETH-specific config (addresses, MEV strategy)
|   +-- bsc.ts                 # BSC-specific config
|   +-- base.ts                # Base-specific config
|   +-- arbitrum.ts            # Arbitrum-specific config
+-- listeners/                 # Event ingestion
|   +-- factoryListener.ts     # V2 PairCreated + V3 PoolCreated listener (generic)
|   +-- telegramListener.ts    # Telegram alpha signal parser
|   +-- eventBus.ts            # Normalized event routing
+-- validation/                # Token safety pipeline
|   +-- pipeline.ts            # Orchestrates all checks, returns pass/fail + reasons
|   +-- checks/                # Individual check modules
|   |   +-- honeypot.ts
|   |   +-- blacklist.ts
|   |   +-- liquidity.ts
|   |   +-- metadata.ts
|   |   +-- taxDetection.ts
|   |   +-- walletLimits.ts
|   |   +-- sellSimulation.ts
+-- execution/                 # Transaction building and submission
|   +-- executor.ts            # Common executor interface
|   +-- strategies/            # Chain-specific MEV protection
|   |   +-- flashbots.ts       # ETH Flashbots bundle submission
|   |   +-- bloxroute.ts       # BSC private RPC submission
|   |   +-- directRpc.ts       # Base/Arbitrum standard submission
|   +-- nonceManager.ts        # Per-chain nonce tracking
+-- positions/                 # Position lifecycle management
|   +-- positionManager.ts     # Create, monitor, exit positions
|   +-- priceMonitor.ts        # Real-time price tracking per chain
|   +-- exitStrategies/        # Exit strategy implementations
|   |   +-- stopLoss.ts
|   |   +-- takeProfit.ts
|   |   +-- trailingStop.ts
|   |   +-- timedSell.ts
|   |   +-- partialSell.ts
+-- risk/                      # Risk management
|   +-- riskManager.ts         # Position limits, daily P&L, exposure
|   +-- capitalAllocator.ts    # Per-chain capital allocation
+-- storage/                   # Persistence layer
|   +-- database.ts            # SQLite connection, migrations
|   +-- repositories/          # Data access objects
|   |   +-- positions.ts
|   |   +-- trades.ts
|   |   +-- auditLog.ts
|   +-- migrations/            # Schema version migrations
+-- dashboard/                 # Web interface
|   +-- server.ts              # Fastify HTTP + WebSocket server
|   +-- routes/                # API routes
|   +-- websocket.ts           # Real-time push to clients
|   +-- public/                # Static frontend assets
+-- notifications/             # Alert system
|   +-- notifier.ts            # Notification dispatcher
|   +-- channels/              # Notification channel implementations
|   |   +-- telegram.ts
+-- shared/                    # Cross-cutting utilities
|   +-- providers.ts           # Singleton provider registry (per chain)
|   +-- abis.ts                # Centralized ABI constants
|   +-- config.ts              # Environment loading + validation
|   +-- logger.ts              # Structured logging
|   +-- retry.ts               # Exponential backoff
|   +-- types.ts               # Shared type definitions
+-- index.ts                   # Main entry point: starts all chain listeners
```

### Structure Rationale

- **chains/:** Isolates per-chain configuration (addresses, gas strategies, MEV approach) from business logic. Adding a new chain means adding one file and registering it, without touching validators, executors, or listeners.
- **listeners/:** Separates event ingestion from processing. The factory listener is generic -- it takes a ChainConfig and subscribes to the right factory addresses. Telegram listener is its own ingestion path.
- **validation/:** Each safety check is its own module. The pipeline orchestrator runs them in parallel (Promise.all) and short-circuits. Chain-aware because it receives provider and addresses from the chain config.
- **execution/:** Strategy pattern for MEV protection. Each chain has different protection mechanisms, but the executor interface is the same: `execute(tx, chainConfig) -> receipt`.
- **positions/:** Position lifecycle is separate from entry logic. The position manager owns the state machine (open -> monitoring -> exiting -> closed). Exit strategies are pluggable.
- **risk/:** Centralized risk gate that sits between validation passing and execution. Checks portfolio-level constraints, not just token-level safety.
- **storage/:** Repository pattern over SQLite. Migrations handle schema evolution. All persistence goes through typed repositories, never raw SQL in business logic.
- **dashboard/:** Self-contained web server. Reads from SQLite and receives WebSocket pushes from the position manager. Does not touch execution logic directly.

## Architectural Patterns

### Pattern 1: Chain Registry with Strategy Dispatch

**What:** A central registry maps chain IDs to full configuration objects (RPC URLs, contract addresses, DEX configs, MEV strategy). All chain-specific behavior is resolved at the registry level, not scattered through business logic.

**When to use:** Any time the bot needs to do something chain-specific (create provider, get factory address, submit transaction).

**Trade-offs:** Adds one level of indirection but eliminates all hardcoded chain references. A new chain is a config object, not a code change.

**Example:**
```typescript
interface ChainConfig {
  chainId: number;
  name: string;
  nativeCurrency: string;
  rpcUrls: string[];          // Multiple for fallback
  wsUrls: string[];           // WebSocket endpoints
  blockExplorerUrl: string;
  dexes: DEXConfig[];         // V2 and V3 factory/router per DEX
  mevStrategy: 'flashbots' | 'bloxroute' | 'direct';
  mevConfig?: {               // Strategy-specific config
    relayUrl?: string;
    authKey?: string;
  };
  gasConfig: {
    multiplier: number;
    maxGasPrice: bigint;
    supportsEIP1559: boolean;
  };
  wrappedNative: string;      // WETH, WBNB, etc.
  minLiquidity: string;       // Min native currency in LP
}

interface DEXConfig {
  name: string;               // 'uniswap-v2', 'pancakeswap-v2', 'uniswap-v3'
  version: 2 | 3;
  factoryAddress: string;
  routerAddress: string;
  // V3-specific
  feeTiers?: number[];        // [500, 3000, 10000]
}

// Registry usage
const chain = chainRegistry.get(1);  // Ethereum
const executor = executorFactory.create(chain.mevStrategy, chain.mevConfig);
```

### Pattern 2: Normalized Event Bus

**What:** All ingestion sources (factory listeners, Telegram, dashboard manual triggers) emit events through a single typed bus. Events carry chain context so downstream handlers are chain-agnostic.

**When to use:** Every time a new token opportunity is detected, regardless of source.

**Trade-offs:** Slight coupling to event schema, but decouples sources from handlers completely. Makes testing trivial -- emit synthetic events.

**Example:**
```typescript
interface ChainEvent {
  type: 'pair_created' | 'pool_created' | 'alpha_signal';
  chainId: number;
  dex: string;
  dexVersion: 2 | 3;
  token0: string;
  token1: string;
  pairOrPool: string;
  feeTier?: number;          // V3 only
  source: 'factory' | 'telegram' | 'dashboard';
  timestamp: number;
}

// Listener emits normalized event
eventBus.emit('opportunity', {
  type: 'pair_created',
  chainId: 56,               // BSC
  dex: 'pancakeswap',
  dexVersion: 2,
  token0, token1, pairOrPool,
  source: 'factory',
  timestamp: Date.now()
});

// Single handler processes all chains
eventBus.on('opportunity', async (event: ChainEvent) => {
  const chain = chainRegistry.get(event.chainId);
  const isValid = await validationPipeline.run(event, chain);
  if (!isValid) return;
  const approved = await riskManager.approve(event, chain);
  if (!approved) return;
  await executor.execute(event, chain);
});
```

### Pattern 3: Position State Machine

**What:** Each open position is modeled as a state machine with clear transitions: `pending -> open -> monitoring -> exiting -> closed`. Exit strategies observe the position and trigger transitions. A mutex prevents concurrent exit attempts on the same position.

**When to use:** After a successful snipe, for the entire lifecycle of monitoring and selling.

**Trade-offs:** More code than bare setInterval loops, but eliminates the race condition where stop-loss and take-profit fire simultaneously. Positions are auditable because every state change is logged.

**Example:**
```typescript
type PositionState = 'pending' | 'open' | 'monitoring' | 'exiting' | 'closed' | 'failed';

interface Position {
  id: string;
  chainId: number;
  tokenAddress: string;
  pairAddress: string;
  state: PositionState;
  entryPrice: bigint;
  entryAmount: bigint;
  currentPrice: bigint;
  entryTimestamp: number;
  exitReason?: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'timed_sell' | 'manual';
  exitPrice?: bigint;
  pnl?: bigint;
}

// State machine prevents double-sell
class PositionManager {
  private locks = new Map<string, boolean>();

  async tryExit(positionId: string, reason: string): Promise<boolean> {
    if (this.locks.get(positionId)) return false;  // Already exiting
    this.locks.set(positionId, true);
    try {
      await this.executeExit(positionId, reason);
      return true;
    } finally {
      this.locks.delete(positionId);
    }
  }
}
```

### Pattern 4: Provider Singleton Registry

**What:** A single registry holds one provider (and one wallet/signer) per chain. All modules request providers from this registry rather than instantiating their own. Providers are created lazily on first access and cached.

**When to use:** Everywhere. The current codebase creates 5+ redundant provider instances.

**Trade-offs:** Requires passing the registry (or using module-level singleton), but eliminates connection churn, reduces RPC quota waste, and makes provider fallback/rotation possible in one place.

**Example:**
```typescript
class ProviderRegistry {
  private providers = new Map<number, JsonRpcProvider>();
  private wallets = new Map<number, Wallet>();

  getProvider(chainId: number): JsonRpcProvider {
    if (!this.providers.has(chainId)) {
      const config = chainRegistry.get(chainId);
      // FallbackProvider for multiple RPCs
      const provider = new FallbackProvider(
        config.rpcUrls.map(url => new JsonRpcProvider(url))
      );
      this.providers.set(chainId, provider);
    }
    return this.providers.get(chainId)!;
  }

  getWallet(chainId: number): Wallet {
    if (!this.wallets.has(chainId)) {
      const provider = this.getProvider(chainId);
      this.wallets.set(chainId, new Wallet(process.env.PRIVATE_KEY!, provider));
    }
    return this.wallets.get(chainId)!;
  }
}
```

## Data Flow

### Snipe Flow (Primary)

```
[Chain Factory Event]
    |
    v
[Factory Listener] -- normalizes --> [Event Bus]
    |
    v
[Orchestrator]
    |
    +---> [Token Validator] -- chain-aware checks --> PASS/FAIL
    |         |
    |         v (if PASS)
    +---> [Risk Manager] -- portfolio checks --> APPROVED/REJECTED
    |         |
    |         v (if APPROVED)
    +---> [Capital Allocator] -- returns snipe amount
    |         |
    |         v
    +---> [Chain Executor] -- builds tx, submits via MEV strategy
    |         |
    |         v (on confirmation)
    +---> [Position Manager] -- creates position, starts monitors
    |         |
    |         v
    +---> [SQLite] -- records trade
    |
    +---> [Notifier] -- sends Telegram alert with chain-specific explorer link
```

### Exit Flow

```
[Price Monitor] -- polls getAmountsOut per chain, per position
    |
    v
[Exit Strategy Engine] -- evaluates all active strategies per position
    |
    +-- stop-loss: price < entry * (1 - threshold)
    +-- take-profit: price > entry * (1 + threshold)
    +-- trailing stop: price < peak * (1 - trail)
    +-- timed sell: elapsed > maxHoldTime
    +-- partial sell: price crossed tier target
    |
    v (first strategy to trigger wins; mutex prevents double-fire)
[Position Manager] -- locks position, transitions to 'exiting'
    |
    v
[Chain Executor] -- builds sell tx on correct chain
    |
    v
[SQLite] -- records exit, calculates P&L
    |
    v
[Notifier] -- sends exit alert
```

### Dashboard Flow

```
[Web Client] -- connects via WebSocket
    |
    v
[Fastify Server]
    +-- GET /api/positions      -- reads from SQLite
    +-- GET /api/trades         -- reads from SQLite
    +-- GET /api/chains/status  -- reads from ProviderRegistry (block height, connection status)
    +-- POST /api/bot/control   -- start/stop per chain
    +-- WS /ws                  -- real-time push
    |
    v
[Position Manager] -- emits state changes --> [WebSocket Hub] --> [All Clients]
[Notifier]         -- emits alerts        --> [WebSocket Hub] --> [All Clients]
```

### Key Data Flows

1. **Opportunity detection:** Factory event on any chain -> Event Bus -> Orchestrator. The listener is dumb (just forwards events). All intelligence is in the orchestrator.

2. **Chain-aware execution:** The orchestrator resolves chain config from the event's chainId, passes it to executor. The executor picks the right MEV strategy. Business logic never touches chain-specific details directly.

3. **Position lifecycle:** After successful snipe, the Position Manager creates a tracked position in SQLite and spawns monitoring. All exit strategies observe the same position object. First to trigger acquires the mutex and executes.

4. **Dashboard updates:** The dashboard is a passive consumer. It reads SQLite for historical data and receives WebSocket pushes for real-time state. It can send control commands (start/stop chain) but never directly touches execution.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-2 chains, <50 positions | Single process, single SQLite DB. Current architecture is sufficient. WebSocket monitoring for price is nice-to-have but polling works. |
| 4 chains, <200 positions | Single process still fine for Node.js event loop. Use WebSocket providers instead of polling for price. Add FallbackProvider per chain with 2-3 RPC endpoints. RPC rate limiting becomes important. |
| 8+ chains, 500+ positions | Consider worker_threads for price monitoring (offload polling to workers). SQLite WAL mode handles concurrent reads well. Main thread handles event bus + orchestration only. |

### Scaling Priorities

1. **First bottleneck: RPC rate limits.** Free-tier Alchemy allows ~300 req/min. With 4 chains and position monitoring, this is hit fast. Solution: multiple RPC providers per chain via FallbackProvider, request queuing with rate limiter.

2. **Second bottleneck: Price monitoring overhead.** Each position polls `getAmountsOut` per interval. At 100 positions across 4 chains, that is 400 calls every 15 seconds (1600/min). Solution: batch price queries where possible, use WebSocket providers for block subscription to trigger price checks only on new blocks.

3. **Third bottleneck: Event loop contention.** SQLite writes are synchronous with better-sqlite3 (by design -- this is actually good for atomicity). But if many positions exit simultaneously across chains, the event loop could stall. Solution: batch writes, use WAL mode, consider write queue for non-critical updates.

## Anti-Patterns

### Anti-Pattern 1: Hardcoded Chain References in Business Logic

**What people do:** `if (chainId === 1) { useFlashbots() } else if (chainId === 56) { useBloxroute() }` scattered throughout the codebase.

**Why it's wrong:** Adding a new chain requires finding and updating every conditional. Chain-specific logic leaks into validation, execution, and monitoring code. The current codebase already has this problem with hardcoded Sepolia/mainnet references.

**Do this instead:** Put all chain-specific behavior in the chain config registry. Business logic receives a ChainConfig object and uses its properties. The executor uses a strategy pattern driven by `chainConfig.mevStrategy`.

### Anti-Pattern 2: Shared Mutable State Without Synchronization

**What people do:** Multiple async handlers (stop-loss, take-profit, timed sell) all call `updateTokenStatus()` and `router.swapExactTokensForETH()` on the same position without coordination.

**Why it's wrong:** Two handlers can fire simultaneously, both see the position as "open," both attempt to sell, one succeeds and the other fails (or worse, both submit transactions and one reverts, wasting gas). The current codebase has this exact bug.

**Do this instead:** Use a position-level mutex (or simple boolean lock map). The Position Manager mediates all exit attempts. First to acquire the lock transitions the position to "exiting." Others see the lock and skip.

### Anti-Pattern 3: Provider Instance Proliferation

**What people do:** Create a `new JsonRpcProvider()` inside each function that needs to interact with the chain. The current codebase does this in tokenSafety.ts (line 7, 96, 175), alphaDrop.ts (line 29, 36), and bot.ts (line 21).

**Why it's wrong:** Each provider instance opens its own HTTP connection, maintains its own block cache, and counts against RPC rate limits independently. With multi-chain, this multiplies: 4 chains x 5 redundant providers = 20 connections instead of 4.

**Do this instead:** Singleton ProviderRegistry. One provider per chain, one wallet per chain. All modules import from the registry. The registry handles fallback and reconnection.

### Anti-Pattern 4: Monolithic handleNewPair Function

**What people do:** A single 270+ line function (like the current `handleNewPair`) that does validation, execution, position creation, and monitoring setup all in one procedural block.

**Why it's wrong:** Cannot test validation without execution. Cannot add chain-awareness without rewriting the whole function. Cannot reuse execution logic for manual triggers from the dashboard.

**Do this instead:** Break into pipeline stages. Each stage is independently testable. The orchestrator chains them: validate -> risk check -> allocate capital -> execute -> create position -> notify. Each stage receives typed input and returns typed output.

### Anti-Pattern 5: Polling When Events Are Available

**What people do:** `setInterval(() => getAmountsOut(...), 15000)` for every monitored position.

**Why it's wrong:** 15-second latency to detect price changes. 5,760 RPC calls per day per position. With 50 positions across 4 chains, that is 288,000 calls/day. Most calls return "no change."

**Do this instead:** Subscribe to block events via WebSocket provider. On each new block, batch-check prices for all positions on that chain in one call. This reduces calls to ~1 per block per chain (roughly every 2-12 seconds depending on chain), regardless of position count.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Ethereum RPC (Alchemy/Infura) | ethers.js JsonRpcProvider + WebSocketProvider | Use FallbackProvider with 2+ endpoints. Free tier is 300 req/min; paid tier recommended for multi-chain. |
| BSC RPC (BNB Chain public nodes) | ethers.js JsonRpcProvider | Public BSC RPC (`bsc-dataseed.binance.org`) is rate-limited. Use Ankr, QuickNode, or Chainstack for reliability. |
| Base RPC | ethers.js JsonRpcProvider | Base uses Coinbase-operated sequencer. Alchemy, Infura, and QuickNode support Base. |
| Arbitrum RPC | ethers.js JsonRpcProvider | Arbitrum has its own sequencer with Timeboost for MEV. Standard RPCs work for submission. |
| Flashbots Relay (ETH only) | @flashbots/ethers-provider-bundle | Submit bundles to `relay.flashbots.net`. Requires auth signer. Only works on Ethereum mainnet (and Sepolia for testing). |
| bloXroute Protect RPC (BSC) | Standard JSON-RPC to bloXroute endpoint | Transactions submitted to bloXroute's private mempool instead of public BSC mempool. Requires API key. |
| Honeypot.is API | HTTP GET via axios/fetch | Rate limited. Supports multiple chains (pass `chainId` parameter). Fallback to on-chain simulation. |
| Unicrypt Locker API | HTTP GET via axios/fetch | Liquidity lock verification. Pass `chainId` parameter for multi-chain support. May not support all chains. |
| Telegram Bot API | HTTP POST to api.telegram.org | Notifications. Chain-aware message formatting (different block explorer URLs per chain). |
| Telegram MTProto | telegram library (gram.js) | Alpha signal ingestion. Session-based auth. Independent of chain -- just parses addresses. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Listener -> Orchestrator | Event Bus (EventEmitter) | Decoupled. Listener knows nothing about validation or execution. |
| Orchestrator -> Validator | Direct function call | Validator receives ChainConfig + token info. Returns pass/fail with reasons array. |
| Orchestrator -> Executor | Strategy dispatch via ChainConfig | Executor interface is chain-agnostic. Strategy selected from config. |
| Executor -> Position Manager | Return value (receipt) triggers position creation | Orchestrator creates position in manager after executor confirms. |
| Position Manager -> Exit Strategies | Observer pattern | Exit strategies register interest in position state changes. Position Manager emits price updates. |
| Position Manager -> Dashboard | WebSocket push | Position state changes pushed to all connected dashboard clients. |
| Dashboard -> Bot Control | REST API | Start/stop per chain, adjust parameters. Dashboard never directly executes trades. |
| All Components -> SQLite | Repository pattern | No raw SQL in business logic. Repositories provide typed CRUD operations. |
| All Components -> Logger | Direct import | Structured logger with context (chainId, component name, position ID). |

## Build Order (Dependencies Between Components)

The architecture has clear dependency layers that dictate build order:

```
Phase 1: Foundation (no dependencies)
  +-- Chain Registry + Types
  +-- Provider Registry (singleton)
  +-- SQLite + Migrations + Repositories
  +-- Centralized ABIs
  +-- Structured Logger
  +-- Config validation

Phase 2: Core Pipeline (depends on Phase 1)
  +-- Token Validation Pipeline (refactored, chain-aware)
  +-- Event Bus
  +-- Factory Listener (generic, uses Chain Registry)
  +-- Nonce Manager

Phase 3: Execution (depends on Phase 1 + 2)
  +-- Executor Interface + Strategy Pattern
  +-- Flashbots Strategy (ETH)
  +-- Direct RPC Strategy (Base, Arbitrum)
  +-- bloXroute Strategy (BSC)

Phase 4: Position Management (depends on Phase 1 + 3)
  +-- Position State Machine
  +-- Price Monitor (WebSocket-based)
  +-- Exit Strategy Engine (stop-loss, take-profit, trailing, timed, partial)
  +-- Risk Manager + Capital Allocator

Phase 5: Interface (depends on Phase 1 + 4)
  +-- Fastify Web Server
  +-- REST API Routes
  +-- WebSocket Hub
  +-- Dashboard Frontend
  +-- Enhanced Telegram Notifier (chain-aware)
```

Key dependency insight: The chain registry and provider registry are the foundation everything else depends on. They must be built first and right, because every other component uses them. SQLite storage is also foundational because position management, risk management, and the dashboard all query it.

The existing codebase's validation pipeline and Flashbots integration can be refactored in-place during Phase 2 and 3 rather than rewritten from scratch -- the logic is sound, just not chain-abstracted yet.

## DEX Contract Addresses Reference

Addresses verified from official sources for the four target chains:

**Ethereum:**
- Uniswap V2 Factory: `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`
- Uniswap V2 Router02: `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`
- Uniswap V3 Factory: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- WETH: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`

**BSC (PancakeSwap):**
- PancakeSwap V2 Factory: `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`
- PancakeSwap V2 Router: `0x10ED43C718714eb63d5aA57B78B54704E256024E`
- PancakeSwap V3 Factory: `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`
- WBNB: `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`

**Base:**
- Uniswap V2 Factory: `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`
- Uniswap V2 Router02: `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24`
- Uniswap V3 Factory: `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`
- WETH (Base): `0x4200000000000000000000000000000000000006`

**Arbitrum:**
- Uniswap V2 Factory: `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9`
- Uniswap V2 Router02: `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24`
- Uniswap V3 Factory: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- WETH (Arbitrum): `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`

**Confidence:** HIGH for Ethereum and BSC (verified on Etherscan/BscScan). MEDIUM for Base V2 and Arbitrum V2 (from official Uniswap docs, not independently verified on explorers). HIGH for V3 addresses (from official Uniswap deployment reference).

## MEV Protection per Chain

| Chain | Strategy | Mechanism | Notes |
|-------|----------|-----------|-------|
| Ethereum | Flashbots Protect | Bundle submission to private relay; bypasses public mempool | Most mature. 98.5% success rate. Auth signer required. |
| BSC | bloXroute Protect RPC | Send tx to bloXroute private endpoint instead of public RPC | Requires bloXroute API key. 48Club + Blockrazor control 96% of BSC blocks. |
| Base | Direct RPC (sequencer-ordered) | Base uses Coinbase sequencer with FCFS ordering; no public mempool exposure | MEV risk is lower on L2 with sequencer. Standard RPC submission is sufficient. |
| Arbitrum | Direct RPC (Timeboost) | Arbitrum sequencer provides private mempool; Timeboost auction for priority | Mempool is private by default. Timeboost gives express lane to auction winners. Standard submission is protected. |

**Key insight:** Only Ethereum requires specialized MEV protection (Flashbots). BSC benefits from bloXroute but can work without it. Base and Arbitrum have sequencer-level protection by default -- standard RPC submission is sufficient for a sniper bot.

## Sources

- [Uniswap V3 Factory Interface](https://docs.uniswap.org/contracts/v3/reference/core/interfaces/IUniswapV3Factory) - PoolCreated event spec
- [Uniswap V2 Deployment Addresses](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) - Official V2 addresses per chain
- [Uniswap V3 Base Deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments) - Official V3 Base addresses
- [PancakeSwap V2 Addresses](https://developer.pancakeswap.finance/contracts/v2/addresses) - BSC V2 factory/router
- [PancakeSwap V3 Addresses](https://developer.pancakeswap.finance/contracts/v3/addresses) - BSC V3 factory
- [bloXroute BSC Protect RPC](https://docs.bloxroute.com/evm-networks-bsc-eth/protect-rpcs/bsc-protect-rpc) - BSC MEV protection
- [Flashbots Protect Overview](https://docs.flashbots.net/flashbots-protect/overview) - ETH MEV protection
- [Arbitrum Timeboost](https://docs.arbitrum.io/how-arbitrum-works/timeboost/gentle-introduction) - Arbitrum MEV ordering
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite for Node.js, synchronous API, WAL mode
- [ethers.js v6 Providers](https://docs.ethers.org/v6/api/providers/) - Multi-provider patterns
- [ethers.js Multi-Provider Discussion](https://github.com/ethers-io/ethers.js/issues/2055) - Managing multiple providers

---
*Architecture research for: Multi-chain EVM crypto sniper bot*
*Researched: 2026-03-19*
