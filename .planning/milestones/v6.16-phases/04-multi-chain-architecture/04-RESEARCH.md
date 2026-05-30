# Phase 4: Multi-Chain Architecture - Research

**Researched:** 2026-03-22
**Domain:** Multi-chain EVM bot architecture, per-chain MEV protection, chain-specific safety APIs
**Confidence:** MEDIUM

## Summary

Phase 4 extends the existing single-chain snipe bot to operate concurrently across ETH, BSC, Base, and Arbitrum. The core challenge is building a chain abstraction layer (ChainConfig registry) that maps each chain to its RPC endpoints, DEX contracts, MEV protection strategy, safety API providers, and capital limits. The bot currently uses hardcoded Ethereum addresses, a single Flashbots MEV strategy, and Ethereum-specific safety APIs (honeypot.is, Unicrypt). Every one of these must become chain-aware.

The MEV protection landscape differs significantly per chain. ETH already has Flashbots bundles (built). BSC uses bloXroute's BSC Protect RPC as a drop-in private RPC endpoint (simplest integration path) or the `bsc_private_tx` JSON-RPC method for more control. Base has a natively private sequencer mempool, meaning standard RPC submission already provides MEV protection -- no additional service is strictly needed, though bloXroute and Merkle offer enhanced Base protection. Arbitrum also has a private sequencer mempool with FCFS (first-come-first-served) ordering, meaning standard submission to the public RPC is already MEV-protected by design.

The token safety API landscape also varies. Honeypot.is covers Ethereum, BSC, and Base (confirmed). For Arbitrum, GoPlus Security API (gopluslabs.io) covers 40+ chains including all four targets. Liquidity lock checking must use Unicrypt on ETH and Mudra Locker on BSC. The existing 9-stage safety pipeline in tokenSafety.ts must accept a chain context to route API calls to the correct provider per chain.

**Primary recommendation:** Build a typed `ChainConfig` registry as the single source of truth. Use the strategy pattern for MEV services (Flashbots adapter, bloXroute adapter, passthrough adapter for Base/Arbitrum). Use config-driven dispatch for safety APIs. Spawn one WebSocket subscription per chain+DEX combination, all in a single Node.js process.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Chain registry object in `config.ts` mapping chainId to a typed `ChainConfig` -- RPC URLs, contract addresses, gas config, MEV strategy, DEX list, safety API providers, capital limits, and enabled flag. Single source of truth for all chain-specific settings.
- **D-02:** `ENABLED_CHAINS` env var (comma-separated chain names) controls which chains are active at startup. Chains not listed are ignored. RPC URLs come from per-chain env vars (`ETH_RPC_URL`, `BSC_RPC_URL`, etc.) -- secrets in env, constants in code.
- **D-03:** Multi-DEX per chain -- each `ChainConfig` has a `dexes[]` array with factory/router address pairs. Listener spawns per-DEX. Covers Uniswap + SushiSwap on ETH, PancakeSwap + BiSwap on BSC, etc.
- **D-04:** WebSocket primary for event detection (`WebSocketProvider` for `PairCreated` subscriptions). HTTP `JsonRpcProvider` as fallback for chains with unreliable WebSocket support. WS URL comes from per-chain env var (`ETH_WS_URL`, `BSC_WS_URL`, etc.).
- **D-05:** Chain-specific MEV services -- integrate each chain's native MEV protection: Flashbots bundles on ETH (already built), bloXroute BDN SDK on BSC, Flashbots Protect RPC on Base, direct sequencer submission on Arbitrum (no MEV needed). Each service integrated with its native API, not just a private RPC URL swap.
- **D-06:** Skip snipe on MEV failure -- if a chain's MEV service is unavailable after retries, the snipe is rejected entirely. Never trade unprotected. Log warning + Telegram alert with chain and failure reason.
- **D-07:** Startup MEV health check -- on boot, verify each enabled chain's MEV service responds. Warn loudly if unreachable but still start the bot (other chains work). Periodic re-check every 5 minutes detects mid-run service outages.
- **D-08:** Fixed budget per chain via env vars (`ETH_MAX_CAPITAL`, `BSC_MAX_CAPITAL`, etc.). Each chain operates independently within its budget. No cross-chain capital logic. Dynamic allocation deferred to a future phase.
- **D-09:** Per-chain snipe amount in native currency -- each `ChainConfig` has `snipeAmount` (per-trade size) and `maxCapital` (total deployment cap). Different chains have vastly different gas costs and token economics, so a global snipe amount doesn't make sense.
- **D-10:** Async per-chain loops in a single Node.js process. Each chain+DEX gets its own WebSocket subscription running concurrently via async event handlers. Node's event loop handles concurrency naturally -- the snipe pipeline is 99% async I/O (RPC calls, API requests, tx submission). No worker threads or separate processes.
- **D-11:** Auto-reconnect with exponential backoff on WebSocket disconnect -- 1s, 2s, 4s, 8s... capped at 60s. Uses existing `retry.ts` pattern. Telegram alert on disconnect and reconnect. Other chains unaffected by one chain's disconnection.
- **D-12:** Chain prefix in Telegram messages -- every alert prepended with `[ETH]`, `[BSC]`, `[BASE]`, `[ARB]` for at-a-glance chain identification. Single Telegram chat for all chains.
- **D-13:** Per-chain API routing for token safety pipeline -- chain config maps each safety check to its API provider. ETH uses honeypot.is + Unicrypt for liquidity lock checks. BSC uses Go+ Security API + Mudra locker. Chain-specific fallbacks when primary API is unavailable.

### Claude's Discretion
- Exact `ChainConfig` TypeScript interface structure and field names
- WebSocket reconnect implementation details (event-based vs wrapper class)
- bloXroute SDK integration specifics (authentication, bundle format)
- How to refactor `bot.ts` to accept chain context (parameter injection vs module-level chain state)
- Safety API adapter pattern (strategy pattern, config-driven dispatch, or per-chain function)
- Boot sequence ordering (validate config, check MEV, start listeners)
- How to handle the existing `addresses.json` (migrate into registry or keep as ETH defaults)

### Deferred Ideas (OUT OF SCOPE)
- Dynamic capital allocation based on opportunity quality signals (CHAIN-05 partially deferred) -- add as enhancement once multi-chain is stable with fixed budgets
- Cross-chain position correlation (detect coordinated rug pulls) -- v2 requirement ARISK-02
- Separate Telegram chats per chain -- revisit if single-chat notification volume becomes overwhelming
- WebSocket provider for chains with unreliable WS -- HTTP polling fallback is in scope, but automatic WS to HTTP failover logic complexity deferred if not straightforward
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAIN-01 | Chain registry maps chainId to RPC endpoints, contract addresses, gas config, and MEV strategy | ChainConfig interface design, verified contract addresses for all 4 chains, MEV strategy mapping documented |
| CHAIN-02 | Per-chain configuration supports ETH mainnet, BSC, Base, and Arbitrum with chain-specific parameters | All DEX factory/router addresses verified, WETH/WBNB addresses confirmed, gas config differences documented |
| CHAIN-03 | Bot runs concurrent event listeners on all configured chains simultaneously | ethers v6 WebSocketProvider API documented, reconnect pattern researched, async concurrency model validated |
| CHAIN-04 | MEV protection uses Flashbots on ETH, bloXroute/private RPCs on BSC, and appropriate strategies per chain | Flashbots (existing), bloXroute BSC Protect RPC/bsc_private_tx API, Base native private mempool, Arbitrum FCFS sequencer all researched |
| CHAIN-05 | Dynamic capital allocation distributes funds across chains based on opportunity quality and activity levels | Fixed budget per chain (D-08/D-09) covers this for v1; dynamic allocation explicitly deferred |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ethers | 6.16.0 | Provider, wallet, contract interaction, WebSocketProvider | Already in project; v6 migration complete in Phase 2; WebSocketProvider built-in |
| @flashbots/ethers-provider-bundle | 1.0.0 | ETH Flashbots bundle submission | Already in project; ETH MEV strategy |
| axios | 1.10.0 | HTTP requests to safety APIs (GoPlus, honeypot.is, Unicrypt, Mudra) | Already in project; used by tokenSafety.ts |
| better-sqlite3 | ^12.8.0 | Trade storage with chain column | Already in project; trades table already has chain column |
| pino | ^10.3.1 | Structured logging with chain context | Already in project; child loggers support chain field |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All required libraries already in project |

**No new npm dependencies required.** bloXroute BSC integration uses HTTP JSON-RPC calls via axios (already installed). GoPlus API uses HTTP GET via axios. ethers v6 includes WebSocketProvider natively. The entire phase can be built with existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bloXroute BSC Protect RPC | bloXroute `bsc_private_tx` JSON-RPC API | Protect RPC is simpler (drop-in URL), but `bsc_private_tx` gives more control. Decision D-05 says "native API, not just a private RPC URL swap" -- use `bsc_private_tx` for explicit private tx submission |
| Custom WebSocket reconnect | ws library with reconnect | ethers v6 WebSocketProvider is sufficient; custom ws adds unnecessary dependency |

**Installation:**
```bash
# No new packages needed -- all dependencies already present
npm ls ethers @flashbots/ethers-provider-bundle axios better-sqlite3 pino
```

**Version verification:** ethers 6.16.0 confirmed as latest stable on npm registry (checked 2026-03-22).

## Architecture Patterns

### Recommended Project Structure
```
src/
  config.ts              # Extended with CHAIN_REGISTRY and ChainConfig type
  chainRegistry.ts       # NEW: Chain registry builder, env var loading, validation
  bot.ts                 # Refactored: startBot() spawns per-chain+DEX listeners
  utils/
    provider.ts          # Extended: WebSocket provider cache + HTTP fallback
    txManager.ts         # Refactored: dispatches to chain-specific MEV strategy
    mevStrategies/       # NEW directory
      types.ts           # MevStrategy interface
      flashbots.ts       # ETH: existing logic extracted as strategy
      bloxroute.ts       # BSC: bsc_private_tx via JSON-RPC
      passthrough.ts     # Base/ARB: direct tx submission (native private mempool)
    tokenSafety.ts       # Refactored: accepts ChainContext, routes to chain APIs
    safetyProviders/     # NEW directory
      types.ts           # SafetyProvider interface
      honeypotIs.ts      # ETH/BSC/Base: honeypot.is API adapter
      goplus.ts          # All chains: GoPlus Security API adapter
      unicrypt.ts        # ETH: liquidity lock check
      mudra.ts           # BSC: liquidity lock check
    notifier.ts          # Extended: chain prefix injection
    exitManager.ts       # Extended: timer registry keyed by chain+token
    db.ts                # Unchanged (trades table already has chain column)
```

### Pattern 1: Chain Context Injection
**What:** Every function in the snipe pipeline receives a `ChainContext` object containing the chain config, providers, and logger.
**When to use:** Any function that currently references CONFIG global fields that are chain-specific (addresses, RPC, MEV, safety APIs).
**Example:**
```typescript
// ChainContext passed through the pipeline
interface ChainContext {
  chain: ChainConfig;
  httpProvider: JsonRpcProvider;
  wsProvider: WebSocketProvider | null;
  wallet: Wallet;
  log: Logger;  // pino child logger with { chain: 'eth' }
}

// handleNewPair now receives chain context
async function handleNewPair(
  ctx: ChainContext,
  dex: DexConfig,
  token0: string,
  token1: string,
  pairAddress: string
): Promise<void> {
  const targetToken = token0.toLowerCase() === ctx.chain.wethAddress.toLowerCase()
    ? token1 : token0;
  // ... rest of pipeline uses ctx.chain.* instead of CONFIG.*
}
```

### Pattern 2: MEV Strategy Pattern
**What:** Abstract interface for MEV transaction submission, with chain-specific implementations.
**When to use:** txManager.ts dispatches to the correct strategy based on chain config.
**Example:**
```typescript
interface MevStrategy {
  name: string;
  healthCheck(): Promise<boolean>;
  sendTransaction(
    txRequest: TransactionRequest,
    wallet: Wallet,
    provider: JsonRpcProvider
  ): Promise<string>; // returns tx hash
}

// BSC bloXroute implementation
class BloxrouteMevStrategy implements MevStrategy {
  name = 'bloxroute-bsc';
  private endpoint = 'https://api.blxrbdn.com';

  async sendTransaction(tx: TransactionRequest, wallet: Wallet): Promise<string> {
    const signedTx = await wallet.signTransaction(tx);
    const response = await axios.post(this.endpoint, {
      jsonrpc: '2.0', id: 1,
      method: 'bsc_private_tx',
      params: { transaction: signedTx }
    }, {
      headers: { 'Authorization': process.env.BLOXROUTE_AUTH_HEADER! }
    });
    return response.data.result;
  }
}
```

### Pattern 3: Safety API Config-Driven Dispatch
**What:** ChainConfig maps each safety check type to an API provider identifier. A dispatcher routes to the correct adapter.
**When to use:** tokenSafety.ts functions that currently call hardcoded APIs.
**Example:**
```typescript
// In ChainConfig
safetyApis: {
  honeypot: 'honeypot.is' | 'goplus',
  liquidityLock: 'unicrypt' | 'mudra' | 'goplus',
  tokenSecurity: 'goplus',  // always available as universal fallback
}

// Dispatcher
async function checkHoneypot(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
  const provider = ctx.chain.safetyApis.honeypot;
  if (provider === 'honeypot.is') return honeypotIsCheck(ctx, tokenAddress);
  if (provider === 'goplus') return goplusHoneypotCheck(ctx, tokenAddress);
  throw new Error(`Unknown honeypot provider: ${provider}`);
}
```

### Pattern 4: WebSocket Reconnect Wrapper
**What:** A class that wraps ethers WebSocketProvider with auto-reconnect logic using exponential backoff.
**When to use:** Each chain+DEX listener needs resilient WebSocket connectivity.
**Example:**
```typescript
class ResilientWsProvider {
  private provider: WebSocketProvider | null = null;
  private reconnectDelay = 1000;
  private maxDelay = 60000;
  private log: Logger;

  constructor(
    private wsUrl: string,
    private chainId: number,
    log: Logger
  ) { this.log = log; }

  async connect(): Promise<WebSocketProvider> {
    this.provider = new WebSocketProvider(this.wsUrl, this.chainId);
    this.provider.websocket.on('close', () => this.handleDisconnect());
    this.provider.websocket.on('error', (err) => {
      this.log.error({ err }, 'WebSocket error');
    });
    this.reconnectDelay = 1000; // reset on successful connect
    return this.provider;
  }

  private async handleDisconnect(): Promise<void> {
    this.log.warn({ delay: this.reconnectDelay }, 'WebSocket disconnected, reconnecting');
    await sendTelegramAlert(`[${this.chainName}] WebSocket disconnected, reconnecting...`);
    await new Promise(r => setTimeout(r, this.reconnectDelay));
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
    try {
      await this.connect();
      this.log.info('WebSocket reconnected');
      await sendTelegramAlert(`[${this.chainName}] WebSocket reconnected`);
      // Re-subscribe to events after reconnect
      this.onReconnect?.();
    } catch (err) {
      this.log.error({ err }, 'Reconnect failed, will retry');
      this.handleDisconnect(); // recursive retry
    }
  }
}
```

### Anti-Patterns to Avoid
- **Global CONFIG access for chain-specific data:** Every chain-specific value must come from ChainContext, not the global CONFIG. The global CONFIG should only hold truly global settings (Telegram credentials, DB path, log level).
- **Hardcoded chain IDs or addresses in business logic:** All chain-specific values live in the registry. No `if (chainId === 56)` scattered through code.
- **Shared mutable state between chains:** Each chain's listener operates independently. No shared nonce counters, no shared rate limiters. A BSC RPC outage must not affect ETH listeners.
- **Synchronous blocking in the event loop:** All MEV submissions and API calls must be async. A slow bloXroute call on BSC must not block ETH PairCreated event processing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket provider | Custom WebSocket client | ethers v6 `WebSocketProvider` | Handles JSON-RPC over WebSocket, event subscriptions, message framing |
| Honeypot detection | Custom contract analysis | honeypot.is API + GoPlus API | 40+ checks per token, maintained databases of known scams |
| Token security analysis | Custom bytecode scanner | GoPlus Security API (`api.gopluslabs.io`) | Covers 40+ chains, maintained threat database, no API key needed for basic use |
| Flashbots bundling | Custom bundle builder | `@flashbots/ethers-provider-bundle` | Already integrated; handles bundle construction, simulation, relay communication |
| BSC private tx | Custom validator routing | bloXroute `bsc_private_tx` JSON-RPC | Routes to BDN-connected validators, handles private mempool mechanics |

**Key insight:** The value of this phase is in the abstraction layer and correct wiring, not in building novel MEV or safety infrastructure. Each chain has established solutions -- the bot needs to correctly route to them.

## Common Pitfalls

### Pitfall 1: WebSocket Provider Reconnection Loses Event Subscriptions
**What goes wrong:** After a WebSocket disconnect and reconnect, the new provider instance does not have the old event subscriptions. PairCreated events are silently missed.
**Why it happens:** ethers v6 WebSocketProvider does not auto-resubscribe after reconnection. Creating a new provider creates a fresh instance with no listeners.
**How to avoid:** The reconnect handler must re-register all `factory.on("PairCreated", ...)` listeners after creating a new provider. Store the listener function reference and re-attach it.
**Warning signs:** Logs show "WebSocket reconnected" but no new pair events appear afterward.

### Pitfall 2: bloXroute Authentication Token Expiration
**What goes wrong:** BSC private transactions fail silently or return auth errors after the bloXroute auth header expires or is revoked.
**Why it happens:** bloXroute auth headers are tied to account plans. Plan changes, billing issues, or key rotation can invalidate them.
**How to avoid:** The MEV health check (D-07) catches this at startup and every 5 minutes. Parse error responses specifically for auth failures and alert distinctly from other errors.
**Warning signs:** BSC snipes consistently fail with HTTP 401/403 from bloXroute endpoint.

### Pitfall 3: Wrong WETH Address Per Chain
**What goes wrong:** Token safety checks or swap paths use ETH's WETH address on BSC (where it should be WBNB), causing all swaps to fail.
**Why it happens:** The current code uses `CONFIG.wethAddress` globally. After multi-chain, each chain has a different wrapped native token address.
**How to avoid:** `ChainConfig.wethAddress` must be verified per chain and used exclusively through `ctx.chain.wethAddress`. Never reference a global WETH constant.
**Warning signs:** "INSUFFICIENT_LIQUIDITY" errors on BSC/Base/Arbitrum when ETH listeners work fine.

### Pitfall 4: Chain ID Mismatch in Transaction Signing
**What goes wrong:** Transaction signed with wrong chainId is rejected by the target chain's RPC.
**Why it happens:** ethers v6 provider auto-detects chainId, but if the provider is misconfigured or the chain registry has a typo, the signed transaction won't match.
**How to avoid:** Validate chainId at startup by calling `provider.getNetwork()` and comparing to expected value in ChainConfig. Fail loudly on mismatch.
**Warning signs:** "invalid chain id" or "wrong v value" errors in transaction submission.

### Pitfall 5: GoPlus API Rate Limiting on Multi-Chain
**What goes wrong:** With 4 chains each detecting pairs, GoPlus API rate limits are hit, causing safety checks to fail and snipes to be blocked.
**Why it happens:** GoPlus free tier has rate limits. Querying for every new pair on 4 chains multiplies API calls by 4x.
**How to avoid:** Use honeypot.is as primary on supported chains (ETH, BSC, Base) and GoPlus only as fallback or for Arbitrum. Implement per-provider rate tracking. Consider GoPlus API key for higher limits.
**Warning signs:** HTTP 429 responses from GoPlus; safety checks consistently returning failure.

### Pitfall 6: BSC WebSocket Unreliability
**What goes wrong:** BSC public WebSocket endpoints drop connections frequently (every 5-15 minutes), causing event gaps.
**Why it happens:** BSC public WebSocket infrastructure is less stable than Ethereum. Free tier providers often have aggressive connection timeouts.
**How to avoid:** Use a paid WebSocket provider for BSC (Alchemy, QuickNode, GetBlock). The reconnect logic (D-11) is critical for BSC especially. Consider HTTP polling as genuine fallback if WS is persistently unreliable.
**Warning signs:** Frequent "WebSocket disconnected" logs on BSC but not other chains.

### Pitfall 7: Gas Price Estimation Differs Per Chain
**What goes wrong:** Gas price multiplier tuned for ETH produces absurdly high or insufficient gas on BSC/Base/Arbitrum.
**Why it happens:** ETH uses EIP-1559 (maxFeePerGas/maxPriorityFeePerGas), BSC uses legacy gas pricing, Base/Arbitrum use L2-specific gas models with L1 data posting costs.
**How to avoid:** Per-chain gas config in ChainConfig: `gasType: 'eip1559' | 'legacy'`, `gasMultiplier`, `gasLimit`. gasManager.ts must use the correct fee estimation method per chain.
**Warning signs:** Transactions stuck pending on one chain while working on others; unexpectedly high gas costs on L2s.

## Code Examples

Verified patterns from official sources and existing codebase:

### ChainConfig Interface (Recommended)
```typescript
// Source: Architecture decision from CONTEXT.md D-01 through D-13
interface DexConfig {
  name: string;                    // 'uniswap-v2', 'pancakeswap-v2', etc.
  factoryAddress: string;
  routerAddress: string;
}

interface SafetyApiConfig {
  honeypot: 'honeypot.is' | 'goplus';
  liquidityLock: 'unicrypt' | 'mudra' | 'goplus';
  tokenSecurity: 'goplus';        // universal fallback for all chains
}

type MevStrategyType = 'flashbots' | 'bloxroute' | 'passthrough';

interface GasConfig {
  type: 'eip1559' | 'legacy';
  multiplier: number;
  maxGasLimit: bigint;
}

interface ChainConfig {
  chainId: number;
  name: string;                    // 'eth', 'bsc', 'base', 'arb'
  displayName: string;             // '[ETH]', '[BSC]', '[BASE]', '[ARB]'
  enabled: boolean;
  nativeCurrency: string;          // 'ETH', 'BNB', 'ETH', 'ETH'
  wethAddress: string;             // WETH or WBNB

  // RPC endpoints (from env vars)
  httpRpcUrl: string;
  wsRpcUrl: string | null;

  // DEX configuration
  dexes: DexConfig[];

  // MEV protection
  mevStrategy: MevStrategyType;
  mevConfig: Record<string, string>;  // strategy-specific config (API keys, endpoints)

  // Safety APIs
  safetyApis: SafetyApiConfig;

  // Gas
  gas: GasConfig;

  // Capital
  snipeAmount: string;             // in native currency
  maxCapital: string;              // in native currency

  // Block explorer (for Telegram links)
  explorerUrl: string;             // 'https://etherscan.io', etc.
}
```

### GoPlus Security API Call
```typescript
// Source: https://docs.gopluslabs.io/reference/tokensecurityusingget_1
// Endpoint: GET https://api.gopluslabs.io/api/v1/token_security/{chain_id}?contract_addresses={address}
// No API key required for basic use
async function goplusHoneypotCheck(
  ctx: ChainContext,
  tokenAddress: string
): Promise<boolean> {
  const chainId = ctx.chain.chainId.toString();
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}`;

  const { data } = await retry(() =>
    axios.get(url, { params: { contract_addresses: tokenAddress } })
  );

  if (data.code !== 1 || !data.result[tokenAddress.toLowerCase()]) {
    ctx.log.warn({ token: tokenAddress }, 'GoPlus API returned no data');
    return true; // default to blocking
  }

  const result = data.result[tokenAddress.toLowerCase()];
  return result.is_honeypot === '1';
}
```

### bloXroute BSC Private Transaction
```typescript
// Source: https://docs.bloxroute.com/bsc-and-eth/apis/frontrunning-protection/bsc-private-transactions
// Endpoint: POST https://api.blxrbdn.com
// Auth: Authorization header from bloXroute account
async function sendBscPrivateTx(
  signedTx: string,
  authHeader: string
): Promise<string> {
  const { data } = await axios.post('https://api.blxrbdn.com', {
    jsonrpc: '2.0',
    id: 1,
    method: 'bsc_private_tx',
    params: { transaction: signedTx }
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    }
  });

  if (data.error) throw new Error(`bloXroute error: ${data.error.message}`);
  return data.result; // tx hash
}
```

### ethers v6 WebSocketProvider Usage
```typescript
// Source: https://docs.ethers.org/v6/api/providers/
import { WebSocketProvider, Contract } from 'ethers';

const wsProvider = new WebSocketProvider('wss://eth-mainnet.ws.alchemyapi.io/v2/KEY', 1);
const factory = new Contract(factoryAddress, FACTORY_ABI, wsProvider);

factory.on('PairCreated', (token0, token1, pair) => {
  handleNewPair(ctx, dex, token0, token1, pair);
});

// Access underlying WebSocket for reconnect handling
// Note: wsProvider.websocket gives access to the WebSocketLike object
```

### Startup Multi-Chain Boot Sequence
```typescript
// Recommended boot order
async function startMultiChainBot(): Promise<void> {
  // 1. Load and validate chain registry from env vars
  const registry = buildChainRegistry();

  // 2. For each enabled chain, create providers and wallet
  for (const chain of registry.enabledChains()) {
    const ctx = await createChainContext(chain);

    // 3. Validate chainId matches expected
    const network = await ctx.httpProvider.getNetwork();
    if (Number(network.chainId) !== chain.chainId) {
      log.fatal({ chain: chain.name, expected: chain.chainId, got: network.chainId },
        'Chain ID mismatch');
      continue; // skip this chain, don't crash
    }

    // 4. MEV health check (D-07)
    const mevHealthy = await ctx.mevStrategy.healthCheck();
    if (!mevHealthy) {
      log.warn({ chain: chain.name }, 'MEV service unreachable at startup');
      // Still start -- periodic re-check will detect recovery
    }

    // 5. Start listeners per DEX
    for (const dex of chain.dexes) {
      await startDexListener(ctx, dex);
    }
  }

  // 6. Start periodic MEV health check (every 5 min)
  startMevHealthCheckLoop(registry);

  // 7. Resume monitoring for pending trades
  resumeMonitoring(registry);
}
```

## Verified Contract Addresses

### Ethereum Mainnet (chainId: 1)
| Contract | Address | Source |
|----------|---------|--------|
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | Etherscan verified |
| Uniswap V2 Factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | [Uniswap V2 Deployments](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) |
| Uniswap V2 Router02 | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | [Uniswap V2 Deployments](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) |
| SushiSwap Factory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | Etherscan verified |
| SushiSwap Router | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` | Etherscan verified |

### BSC Mainnet (chainId: 56)
| Contract | Address | Source |
|----------|---------|--------|
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | BscScan verified |
| PancakeSwap V2 Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` | [PancakeSwap Developer](https://developer.pancakeswap.finance/contracts/v2/addresses) |
| PancakeSwap V2 Router02 | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | BscScan verified |
| BiSwap Factory | `0x858E3312ed3A876947EA49d572A7C42DE08af7EE` | BscScan verified |
| BiSwap Router | `0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8` | BscScan verified |

### Base Mainnet (chainId: 8453)
| Contract | Address | Source |
|----------|---------|--------|
| WETH | `0x4200000000000000000000000000000000000006` | BaseScan verified |
| Uniswap V2 Factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | [Uniswap V2 Deployments](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) |
| Uniswap V2 Router02 | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | [Uniswap V2 Deployments](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) |

### Arbitrum One (chainId: 42161)
| Contract | Address | Source |
|----------|---------|--------|
| WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | Arbiscan verified |
| Uniswap V2 Factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | [Uniswap V2 Deployments](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) |
| Uniswap V2 Router02 | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | [Uniswap V2 Deployments](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) |
| SushiSwap Factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | Arbiscan verified |
| SushiSwap Router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | Arbiscan verified |

## MEV Strategy Per Chain

| Chain | Strategy | Endpoint/Method | Auth Required | Notes |
|-------|----------|-----------------|---------------|-------|
| ETH | Flashbots Bundle | `FlashbotsBundleProvider.create()` | FLASHBOTS_AUTH_KEY | Already built in flashbots.ts; extract as strategy |
| BSC | bloXroute `bsc_private_tx` | `POST https://api.blxrbdn.com` | BLOXROUTE_AUTH_HEADER | JSON-RPC call; routes to BDN validators privately |
| Base | Passthrough (direct send) | Standard `eth_sendRawTransaction` | None additional | Base sequencer has private mempool by design; no MEV exposure |
| Arbitrum | Passthrough (direct send) | Standard `eth_sendRawTransaction` | None additional | Arbitrum sequencer uses FCFS ordering; private mempool by design |

**Critical finding for D-05:** The CONTEXT.md says "Flashbots Protect RPC on Base" but research shows Flashbots Protect currently only supports Ethereum mainnet, Sepolia, and Holesky testnet -- not Base. Base's sequencer already provides a private mempool, so direct submission via standard RPC is the correct MEV strategy. The planner should use a "passthrough" strategy for Base (same as Arbitrum) that simply sends the transaction directly. This achieves the same protection goal without a nonexistent service.

## Safety API Coverage Per Chain

| Chain | Honeypot Check | Liquidity Lock | Token Security | Fallback |
|-------|---------------|----------------|----------------|----------|
| ETH (1) | honeypot.is (PRIMARY) | Unicrypt API | GoPlus | Static call simulation |
| BSC (56) | honeypot.is (SUPPORTED) | Mudra Locker | GoPlus (PRIMARY) | Static call simulation |
| Base (8453) | honeypot.is (SUPPORTED) | GoPlus | GoPlus | Static call simulation |
| Arbitrum (42161) | GoPlus (honeypot.is NOT supported) | GoPlus | GoPlus | Static call simulation |

**GoPlus API Details:**
- Endpoint: `GET https://api.gopluslabs.io/api/v1/token_security/{chain_id}?contract_addresses={address}`
- Chain IDs: `1` (ETH), `56` (BSC), `8453` (Base), `42161` (Arbitrum)
- No API key required for basic queries
- Response includes: `is_honeypot`, `is_blacklisted`, `cannot_sell_all`, `slippage_modifiable`, `transfer_pausable`, `is_mintable`
- Confidence: HIGH (verified from official docs at docs.gopluslabs.io)

**Honeypot.is Coverage:**
- Supports: Ethereum, BSC, Base
- Does NOT support: Arbitrum
- Supports DEXes: Uniswap V2, V3, SushiSwap, PancakeSwap, BiSwap
- Confidence: HIGH (verified from docs.honeypot.is/chains)

**Mudra Locker (BSC):**
- Website-based lock verification at mudra.website
- No documented REST API for programmatic lock checking
- Alternative: Check PancakeSwap lock contracts directly on-chain, or use GoPlus `lp_holders` data
- Confidence: LOW -- may need to fall back to burn address check (existing pattern)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BSC MEV: Merkle/Blink private mempool | BSC MEV: bloXroute BDN + Protect RPC | 2025 | bloXroute is dominant BSC MEV protection provider |
| Flashbots for L2s | L2 sequencers have native private mempool | 2024-2025 | Base and Arbitrum don't need external MEV protection |
| Honeypot.is ETH-only | Honeypot.is supports ETH + BSC + Base | 2024 | Broader coverage but still no Arbitrum |
| GoPlus limited chains | GoPlus 40+ chains | 2025 | Universal fallback safety API |
| Arbitrum FCFS ordering | Arbitrum Timeboost auction | 2025 | Express lane introduces priority lanes, but standard transactions still protected from sandwich attacks |

**Deprecated/outdated:**
- Merkle/Blink for BSC MEV: Still exists but bloXroute has become the dominant player for BSC private transactions
- Flashbots Protect on L2s: Not available yet despite announced plans; L2s use native sequencer privacy instead

## Environment Variables Required

```bash
# Per-chain RPC (HTTP)
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/KEY
BSC_RPC_URL=https://bsc-dataseed.binance.org/
BASE_RPC_URL=https://mainnet.base.org
ARB_RPC_URL=https://arb1.arbitrum.io/rpc

# Per-chain RPC (WebSocket)
ETH_WS_URL=wss://eth-mainnet.ws.alchemyapi.io/v2/KEY
BSC_WS_URL=wss://bsc-ws-node.nariox.org:443
BASE_WS_URL=wss://base-mainnet.g.alchemy.com/v2/KEY
ARB_WS_URL=wss://arb-mainnet.g.alchemy.com/v2/KEY

# Chain selection
ENABLED_CHAINS=eth,bsc,base,arb

# Per-chain capital
ETH_SNIPE_AMOUNT=0.01
ETH_MAX_CAPITAL=0.5
BSC_SNIPE_AMOUNT=0.05
BSC_MAX_CAPITAL=2.0
BASE_SNIPE_AMOUNT=0.01
BASE_MAX_CAPITAL=0.5
ARB_SNIPE_AMOUNT=0.01
ARB_MAX_CAPITAL=0.5

# MEV service credentials
FLASHBOTS_AUTH_KEY=...          # ETH (existing)
BLOXROUTE_AUTH_HEADER=...      # BSC bloXroute

# Existing (unchanged)
PRIVATE_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Open Questions

1. **Mudra Locker API availability**
   - What we know: Mudra is the dominant BSC liquidity locker, but their API is not publicly documented for programmatic lock checking.
   - What's unclear: Whether there is a hidden API endpoint or if on-chain verification of lock contracts is needed.
   - Recommendation: Use GoPlus `lp_holders` data as primary for BSC liquidity lock assessment. Fall back to the existing burn address check pattern. Mark as LOW confidence and test with real BSC tokens.

2. **bloXroute pricing post-February 2026**
   - What we know: bloXroute BSC endpoints became paid extensions starting February 2026.
   - What's unclear: Exact pricing and whether the cloud-api `bsc_private_tx` endpoint is included in free tier or requires paid plan.
   - Recommendation: User needs a bloXroute account with BSC access. Add a clear error message at startup if BLOXROUTE_AUTH_HEADER is missing when BSC is enabled. The bot should function without BSC if auth is unavailable.

3. **SushiSwap V2 on Base**
   - What we know: SushiSwap is deployed on many chains, but the specific Base V2 factory/router addresses were not found in research.
   - What's unclear: Whether SushiSwap V2 has significant liquidity on Base or if Uniswap V2 alone is sufficient.
   - Recommendation: Start with Uniswap V2 only on Base. SushiSwap can be added later if volume justifies it. The multi-DEX architecture supports adding DEXes per chain without code changes.

4. **ethers v6 WebSocketProvider reconnect internals**
   - What we know: ethers v6 WebSocketProvider exposes a `.websocket` property that gives access to the underlying WebSocket-like object. The exact reconnect behavior is not well-documented.
   - What's unclear: Whether `.websocket.on('close')` is the reliable way to detect disconnections in ethers v6, or if there's a higher-level API.
   - Recommendation: Build the ResilientWsProvider wrapper class that handles reconnection externally. Test with intentional disconnections during development. If `.websocket` access is problematic, fall back to creating a new WebSocketProvider on a timer-based health check.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Hardhat + Chai (already configured in devDependencies) |
| Config file | `hardhat.config.ts` (exists) |
| Quick run command | `npx hardhat test --grep "chain"` |
| Full suite command | `npx hardhat test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAIN-01 | Chain registry maps chainId to config correctly | unit | `npx hardhat test --grep "ChainRegistry"` | Wave 0 |
| CHAIN-02 | Per-chain config loads from env vars, validates | unit | `npx hardhat test --grep "ChainConfig"` | Wave 0 |
| CHAIN-03 | Concurrent listeners receive events independently | integration | `npx hardhat test --grep "multichain listener"` | Wave 0 |
| CHAIN-04 | MEV strategy dispatches to correct service per chain | unit | `npx hardhat test --grep "MevStrategy"` | Wave 0 |
| CHAIN-05 | Capital budget enforced per chain | unit | `npx hardhat test --grep "capital"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx hardhat test --grep "chain" --bail`
- **Per wave merge:** `npx hardhat test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/chainRegistry.test.ts` -- covers CHAIN-01, CHAIN-02 (unit tests for registry builder, env var loading, validation)
- [ ] `test/mevStrategy.test.ts` -- covers CHAIN-04 (unit tests for strategy dispatch, health check, error handling)
- [ ] `test/multiChainBot.test.ts` -- covers CHAIN-03 (integration test with local hardhat forks)
- [ ] `test/safetyProviders.test.ts` -- covers CHAIN-02/CHAIN-13 (unit tests for GoPlus adapter, honeypot.is adapter routing)
- [ ] `test/fixtures/chainConfig.ts` -- shared test fixtures for chain configs

## Sources

### Primary (HIGH confidence)
- [Uniswap V2 Deployment Addresses](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) - Factory and Router addresses for ETH, Base, Arbitrum
- [PancakeSwap V2 Addresses](https://developer.pancakeswap.finance/contracts/v2/addresses) - BSC factory and router
- [GoPlus Security API Reference](https://docs.gopluslabs.io/reference/tokensecurityusingget_1) - Token security endpoint, chain IDs, response format
- [Honeypot.is Chain Support](https://docs.honeypot.is/chains) - Supported chains: ETH, BSC, Base (not Arbitrum)
- [ethers v6 Providers Documentation](https://docs.ethers.org/v6/api/providers/) - WebSocketProvider constructor and API
- [bloXroute BSC Private Transactions](https://docs.bloxroute.com/bsc-and-eth/apis/frontrunning-protection/bsc-private-transactions) - bsc_private_tx JSON-RPC method
- [Arbitrum Sequencer Documentation](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/sequencer) - Private mempool, FCFS ordering
- [Flashbots Protect Quick Start](https://docs.flashbots.net/flashbots-protect/quick-start) - Confirmed ETH-only support

### Secondary (MEDIUM confidence)
- [bloXroute BSC Protect RPC](https://docs.bloxroute.com/bsc-and-eth/protect-rpcs/bsc-protect-rpc) - BSC Protect RPC endpoint URL `https://bsc.rpc.blxrbdn.com`
- [BscScan WBNB Token](https://bscscan.com/token/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c) - WBNB address verified
- [BaseScan WETH Token](https://basescan.org/token/0x4200000000000000000000000000000000000006) - Base WETH address verified
- [Arbiscan WETH Token](https://arbiscan.io/token/0x82af49447d8a07e3bd95bd0d56f35241523fbab1) - Arbitrum WETH address verified
- [SushiSwap Router on Arbitrum](https://arbiscan.io/address/0x1b02da8cb0d097eb8d57a175b88c7d8b47997506) - SushiSwap Arbitrum addresses
- [SushiSwap Factory on Ethereum](https://etherscan.io/address/0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac) - SushiSwap ETH addresses

### Tertiary (LOW confidence)
- Mudra Locker API -- no public REST API documentation found; web-based UI only
- BiSwap Factory address `0x858E3312ed3A876947EA49d572A7C42DE08af7EE` -- derived from router constructor args, not official docs
- bloXroute pricing post-Feb 2026 -- pricing model may have changed; needs validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in project, no new deps needed
- Architecture: MEDIUM - patterns are well-established but WebSocket reconnect and bloXroute integration need runtime validation
- Contract addresses: HIGH - verified against official docs and block explorers
- MEV strategies: MEDIUM - ETH Flashbots is proven; BSC bloXroute needs auth setup and testing; Base/Arbitrum passthrough is straightforward
- Safety API coverage: MEDIUM - GoPlus and honeypot.is coverage verified, but Mudra Locker API availability is LOW confidence
- Pitfalls: HIGH - based on real-world multi-chain bot operation patterns

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (30 days -- contract addresses stable, API endpoints may change)
