# Phase 11: Dashboard Accuracy & Bot Integration Wiring - Research

**Researched:** 2026-04-01
**Domain:** Express API wiring, on-chain price queries, Telegram client integration, multi-chain bot orchestration
**Confidence:** HIGH

## Summary

Phase 11 closes three specific gaps from the v6.16 milestone audit: (1) the positions API returns stale `highWaterMark` as `currentPrice` instead of live on-chain prices, (2) the chain restart endpoint lacks an `onRestart` callback to re-attach factory event listeners, and (3) the telegram listener runs as a standalone process instead of being integrated into the multi-chain orchestrator. Additionally, FIX-09 (telegram sender whitelist enforcement) is already implemented in the code but only operates within the standalone process -- integration via the orchestrator closes this gap.

All three fixes are internal wiring changes within existing modules. No new dependencies are needed. The core challenge is threading parameters through function signatures (`startApiServer` needs the registry, `chainRoutes` needs an `onRestart` callback, `startTelegramListener` needs `ChainContext[]`) and building a shared `buildPositionsWithLivePrices(contexts)` helper that both REST and WebSocket paths consume.

**Primary recommendation:** Structure work as three independent fix tracks (positions accuracy, chain restart wiring, telegram integration) that converge in a final integration plan wiring everything into `bot.ts` and `server.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Call `queryPrice()` per request for each open position -- freshest possible data, no caching layer
- D-02: Query all open positions' prices in parallel via `Promise.all` -- one RPC round-trip time regardless of position count
- D-03: If `queryPrice()` fails for a position, fall back to `highWaterMark` as `currentPrice` with a `priceStale: true` flag in the response
- D-04: Resolve the correct ChainContext and DexConfig per position by matching chain name to contexts array, then finding the DexConfig matching `pool_type` and `fee_tier` from the chain's dexes array
- D-05: Compute live unrealized P&L per position: `(remaining tokens x currentPrice) - (original buy cost - partial sell revenue already received)` -- net cost basis accounting for partial takes
- D-06: Extract a shared `buildPositionsWithLivePrices(contexts)` async function used by both GET /api/positions and the WebSocket 5s push
- D-07: WebSocket position updates also include live on-chain prices from `queryPrice()`
- D-08: Both REST and WS call the same shared helper (`buildPositionsWithLivePrices`) for identical output shape
- D-09: Pass chain registry to `startApiServer(contexts, registry)` -- the `onRestart` callback is built inside `server.ts` using the registry
- D-10: Re-run MEV health check on chain restart before re-attaching listeners -- warn if unhealthy but don't block restart
- D-11: Reconnect WebSocket provider if it was disconnected during stop -- factory listeners need WS events to detect new pairs
- D-12: Partial restart success: return 200 with `ok: true` and a `warnings` array listing which DEX listeners failed
- D-13: Refactor `telegramListener.ts` to export `startTelegramListener()` function -- remove standalone `main()` and `process.stdin.resume()`, called from `bot.ts` after chain listeners are up
- D-14: Telegram listener is optional -- if `TELEGRAM_API_ID` or `TELEGRAM_SESSION` env vars are missing, log a warning and skip
- D-15: If telegram listener fails to connect at startup, log error and continue -- no retry, no blocking
- D-16: Make multi-chain aware -- pass `ChainContext[]` to `startTelegramListener()` so alpha drops can target the right chain
- D-17: Chain routing: detect target chain by checking the contract address against each chain's RPC (`getCode` or similar) -- if contract exists on multiple chains, trigger `handleAlphaDrop` on all matching chains
- D-18: Whitelist env vars continue to be read from `process.env` inside telegramListener.ts
- D-19: Add telegram listener connected/disconnected status to `GET /health` response
- D-20: Include `TelegramClient.disconnect()` in the graceful shutdown handler in `bot.ts`
- D-21: Whitelist enforcement code already exists and is correctly implemented -- keep OR logic
- D-22: No logic change needed for whitelist -- integration via D-13 closes FIX-09 gap
- D-23: Telegram connection failure at startup: log error and continue
- D-24: Chain restart partial failure: report partial success with warnings array
- D-25: queryPrice failure per position: fall back to highWaterMark with priceStale flag
- D-26: Unit + integration tests for all three fixes
- D-27: Unit tests: mock `queryPrice` for positions helper, mock `startDexListener` for restart callback, mock `TelegramClient` for listener startup
- D-28: Integration tests: chain restart flow via HTTP, positions endpoint with mocked RPC
- D-29: Test multi-chain routing for telegram: mock `getCode()` responses to simulate contract existing on ETH but not BSC
- Test file organization (new test files vs extending existing ones) -- Claude's discretion

### Claude's Discretion
- How to wire the onRestart callback (reuse startDexListener vs new re-subscribe function)
- Exact implementation of WebSocket provider reconnection on chain restart
- How buildPositionsWithLivePrices resolves DexConfig per trade (exact lookup logic)
- queryPrice parameter construction from trade data (buyAmountWei source)
- How to expose TelegramClient disconnect handle to bot.ts shutdown handler
- Test file organization (new test files vs extending existing ones)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | Web dashboard displays real-time open positions with current P&L per token and chain | `buildPositionsWithLivePrices()` shared helper calling `queryPrice()` per position with `Promise.all`, fallback to highWaterMark with priceStale flag, unrealized P&L calculation using net cost basis |
| DASH-03 | Bot controls accessible from dashboard (start/stop per chain, adjust snipe parameters) | `onRestart` callback wired through `startApiServer(contexts, registry)` to `chainRoutes`, callback re-creates WS provider and calls `startDexListener` per DEX with MEV health check |
| FIX-09 | Telegram alpha listener only processes messages from whitelisted sender IDs | Whitelist logic already implemented in telegramListener.ts lines 20-53; integration into orchestrator via `startTelegramListener(contexts)` export closes the gap |
</phase_requirements>

## Architecture Patterns

### Current Code Structure (Files Being Modified)

```
src/
  api/
    routes/
      positions.ts    # FIX: Replace highWaterMark with queryPrice() calls
      chains.ts       # FIX: Receive real onRestart callback
      health.ts       # ADD: telegram connected status
    server.ts         # FIX: Accept registry param, build onRestart, use shared helper for WS push
  bot.ts              # FIX: Pass registry to startApiServer, call startTelegramListener, add TG to shutdown
  telegramListener.ts # REFACTOR: Export startTelegramListener(), remove main(), multi-chain routing
  alphaDrop.ts        # REFACTOR: Accept ChainContext for multi-chain alpha drops
  exitEngine.ts       # REUSE: queryPrice() called from positions helper (no changes)
  chainRegistry.ts    # REUSE: Types used everywhere (no changes)
```

### Pattern 1: Shared Position Builder (D-06, D-08)

**What:** Extract `buildPositionsWithLivePrices(contexts)` as a standalone async function that both the REST GET /api/positions handler and the WebSocket 5s push interval call.

**When to use:** Any time the positions list with live prices is needed.

**Key implementation details:**
- The function accepts `ChainContext[]` and returns the same shape as the current positions endpoint
- For each open position (buy_status === 'pending'), resolve the matching ChainContext by `trade.chain`, then find the DexConfig matching `trade.pool_type` and `trade.fee_tier`
- `queryPrice()` requires: `ctx: ChainContext`, `dex: DexConfig`, `tokenAddress: string`, `feeTier: number | null`, `buyAmountWei: bigint`
- `buyAmountWei` comes from `ethers.parseEther(trade.buy_cost)` where `buy_cost` is `amount_in` in the DB (the native currency spent on the buy, e.g., "0.01" ETH)
- `originalTokenAmount` comes from `exit_state.original_token_amount` (BigInt as string in DB)
- Unrealized P&L per D-05: `(remaining_tokens * currentPrice) - (buy_cost - partial_sell_revenue)` where `remaining_tokens` is tracked in exit_state

**DexConfig lookup logic (D-04):**
```typescript
// Find matching ChainContext
const ctx = contexts.find(c => c.chain.name === trade.chain);
// Find matching DexConfig from chain's dexes array
const dex = ctx.chain.dexes.find(d =>
    d.dexType === trade.pool_type &&
    (trade.pool_type === 'v2' || /* for v3, any dex of that type works since fee_tier is in the query */)
);
```

Note: For V3, `fee_tier` is passed to `queryPrice` directly, so any V3 DexConfig on the right chain will work. For V2, there could be multiple V2 DEXes on a chain (e.g., BSC has pancakeswap-v2 and biswap-v2). The trade doesn't currently store which specific DEX was used. Research finding: the `dex_name` is not stored in the trades table. The positions helper should try the first matching V2 DEX on the chain -- if the price query fails, fallback to highWaterMark per D-03.

### Pattern 2: onRestart Callback Construction (D-09, D-10, D-11, D-12)

**What:** Build the `onRestart` callback inside `server.ts` using the registry parameter, then pass it to `chainRoutes`.

**Key implementation details:**
- `startDexListener` is currently a **module-private** function in `bot.ts` (line 748: `async function startDexListener(` -- NOT exported)
- Options for the restart callback:
  1. **Export `startDexListener` from bot.ts** -- simplest, allows reuse of exact same logic including WS reconnect handlers
  2. **Duplicate the listener setup logic in server.ts** -- violates DRY, hard to maintain
  3. **Pass a pre-built callback from bot.ts to startApiServer** -- requires changing the call chain

**Recommendation (Claude's discretion):** Export `startDexListener` from `bot.ts` and import it in `server.ts`. The callback in server.ts then:
  1. Reconnects WebSocket provider if disconnected (using `getWsProvider` to create fresh connection)
  2. Runs MEV health check (warn-only, per D-10)
  3. Calls `startDexListener(ctx, dex, registry)` for each DEX on the chain
  4. Collects per-DEX results, returns warnings array for any failures (D-12)

**WebSocket reconnection on restart (D-11):**
```typescript
// In the onRestart callback, if wsProvider is null or disconnected:
if (!ctx.wsProvider || /* check connection state */) {
    const newWsProvider = new WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId);
    ctx.wsProvider = newWsProvider;
    // Also update the provider cache
}
```
The existing `removeWsProvider` + `getWsProvider` pattern in `provider.ts` can be reused.

### Pattern 3: Telegram Listener Refactor (D-13 through D-20)

**What:** Convert `telegramListener.ts` from standalone script to importable module.

**Current structure (to be removed):**
- Module-level `main()` function that creates TelegramClient
- Auto-invoked via `main()` at bottom of file
- `process.stdin.resume()` to keep process alive

**New structure:**
- Export `startTelegramListener(contexts: ChainContext[]): Promise<{ client: TelegramClient | null }>` (or similar handle for shutdown)
- Telegram client creation and event handler registration inside the exported function
- Multi-chain alpha routing: for each extracted contract address, check `getCode()` against each chain's httpProvider, call `handleAlphaDrop` (refactored to accept ChainContext) on all matching chains
- Return client handle so `bot.ts` can call `client.disconnect()` in shutdown handler (D-20)
- Optional: return `null` client if env vars missing (D-14)

**Multi-chain alpha routing (D-17):**
```typescript
// For each matched address from telegram message:
const matchingContexts = await Promise.all(
    contexts.map(async ctx => {
        const code = await ctx.httpProvider.getCode(address);
        return code !== '0x' ? ctx : null;
    })
);
const validContexts = matchingContexts.filter(Boolean);
// Trigger handleAlphaDrop on each matching chain
for (const ctx of validContexts) {
    handleAlphaDropForChain(ctx, address);
}
```

**alphaDrop.ts refactor:**
The current `handleAlphaDrop` uses the legacy single-chain `handleNewPair()` and `getProvider()`. It needs a new `handleAlphaDropForChain(ctx: ChainContext, tokenAddress: string)` variant that:
- Uses `ctx.httpProvider` instead of `getProvider()`
- Calls `handleNewPairForChain` / `handleNewV3PoolForChain` instead of `handleNewPair`
- Needs to discover which DEX the token's pair is on (query each factory)

### Anti-Patterns to Avoid
- **Duplicating position-building logic** between REST and WS: Use the shared helper (D-06)
- **Caching queryPrice results**: D-01 explicitly requires fresh per-request queries
- **Blocking bot startup on telegram failure**: D-14/D-15 require graceful degradation
- **Passing stoppedChains to the restart callback**: The chains.ts route already manages stoppedChains state; the callback just needs the ChainContext

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| On-chain price queries | Custom quoter logic | Existing `queryPrice()` in exitEngine.ts | Already handles V2 getAmountsOut and V3 QuoterV2 with proper error handling |
| WebSocket provider caching | Manual provider map | `getWsProvider`/`removeWsProvider` in provider.ts | Existing cache with destroy semantics |
| Factory event subscription | New listener logic | Export and reuse `startDexListener` from bot.ts | Includes V2/V3 branching, reconnect handlers, HTTP polling fallback |
| MEV health check | Custom health probe | `createMevStrategy(chain).healthCheck()` from txManager | Already tested and used in bot startup |

## Common Pitfalls

### Pitfall 1: buyAmountWei Source for queryPrice

**What goes wrong:** `queryPrice` requires `buyAmountWei: bigint` which represents the native currency amount spent on the buy. Using the wrong value (e.g., token amount instead of ETH amount) returns nonsensical prices.

**Why it happens:** The DB stores `amount_in` as a string like "0.01" (ETH), but `queryPrice` expects `ethers.parseEther("0.01")` = 10000000000000000n.

**How to avoid:** Always derive buyAmountWei via `ethers.parseEther(trade.buy_cost)` where `buy_cost` is the PnLResult field mapped from `b.amount_in`.

**Warning signs:** Price values that are astronomically large or near zero.

### Pitfall 2: V2 DEX Ambiguity on Multi-DEX Chains

**What goes wrong:** BSC has two V2 DEXes (pancakeswap-v2, biswap-v2). The trades table doesn't record which specific DEX was used. Querying the wrong DEX's router will return null or wrong price.

**Why it happens:** When a token was sniped on pancakeswap-v2 but the positions helper queries biswap-v2's router, the pair may not exist on that DEX.

**How to avoid:** Try the first matching V2 DEX. If `queryPrice` returns null, try the next V2 DEX on the chain. If all fail, fall back to highWaterMark per D-03. Document this as a known limitation.

**Warning signs:** Many positions showing `priceStale: true` on BSC.

### Pitfall 3: WebSocket Provider State After Stop

**What goes wrong:** When a chain is stopped via POST /:name/stop, `ctx.wsProvider.removeAllListeners()` is called but the provider is NOT destroyed. On restart, the existing provider may be in a bad state (e.g., underlying TCP connection dropped).

**Why it happens:** The stop handler preserves the provider for exit monitors (D-14 in Phase 8). But the WebSocket connection may have timed out or been closed by the server during the stop period.

**How to avoid:** In the onRestart callback, check if the WebSocket is still connected. If not, destroy the old provider and create a new one via `removeWsProvider`/`getWsProvider` pattern. Update `ctx.wsProvider` in place (the ChainContext object is passed by reference).

**Warning signs:** Restart returns success but no new pair events are detected.

### Pitfall 4: Telegram Client Lifecycle Leak

**What goes wrong:** If `startTelegramListener` creates a TelegramClient that isn't properly exposed for shutdown, the process hangs on SIGTERM because the Telegram connection keeps the event loop alive.

**Why it happens:** The current standalone `telegramListener.ts` uses `process.stdin.resume()` and never calls `client.disconnect()`. When moving to the orchestrator, the disconnect handle must be accessible from `bot.ts`.

**How to avoid:** Return the client handle (or null) from `startTelegramListener`. Store it in `bot.ts` and pass to `initMultiChainShutdownHandler`. Add `client.disconnect()` to the graceful shutdown sequence before `process.exit(0)`.

**Warning signs:** Bot hangs for 5+ seconds on shutdown, eventually killed by the safety timeout.

### Pitfall 5: Circular Import Between bot.ts and server.ts

**What goes wrong:** If `server.ts` imports `startDexListener` from `bot.ts`, and `bot.ts` already imports `startApiServer` from `server.ts`, this creates a circular dependency.

**Why it happens:** Node.js can handle circular imports but the module at the "bottom" of the cycle may see undefined exports at import time.

**How to avoid:** Two options:
1. **Pass startDexListener as a parameter** to `startApiServer` instead of importing it (preferred -- avoids circular import entirely)
2. Use dynamic `require()` inside the callback (works but less clean)

**Recommendation:** Pass the restart callback function from `bot.ts` to `startApiServer(contexts, registry, onRestart)` rather than building it inside server.ts. This avoids the circular import issue entirely and keeps bot.ts as the sole owner of listener logic.

### Pitfall 6: Unrealized P&L Calculation Complexity

**What goes wrong:** The unrealized P&L formula per D-05 requires: `(remaining_tokens * currentPrice) - (buy_cost - partial_sell_revenue)`. Getting the "remaining tokens" requires looking at `exit_state.original_token_amount` minus tokens already sold in partial sells.

**Why it happens:** Partial sells reduce the token balance but the exit_state's `original_token_amount` reflects the balance at the time the exit monitor was started (or resumed). After partial sells, the actual remaining balance is `original_token_amount - sum(partial_sell_amounts)`.

**How to avoid:** The `sell_revenue` field from PnLResult already aggregates all sell amounts (full + partial). The net cost basis is `buy_cost - sell_revenue`. The unrealized component uses `currentPrice` (from `queryPrice`) which already factors in the current token balance via the quoter. Actually, `queryPrice` uses `buyAmountWei` (ETH spent) not token balance -- it returns "how much ETH you'd get for that many tokens." So the unrealized P&L should be: `currentPrice - parseFloat(buy_cost)` as a simple comparison, since `queryPrice` returns the ETH value of the position's original token amount. But with partial sells, the remaining tokens are less. The correct approach: query price using the remaining token amount, not the original buy amount. This means using `original_token_amount - tokens_sold` as the input to a different quoter call, OR simplifying to use `currentPrice / buyAmountWei * remainingTokens` as a ratio.

**Recommendation:** For simplicity and consistency with the exit engine, use `buyAmountWei` (the original ETH amount) in `queryPrice` to get a "price per unit" ratio, then scale by remaining fraction: `unrealizedValue = currentPrice * (remainingTokens / originalTokenAmount)`. Then `unrealizedPnl = unrealizedValue - (buyCost - sellRevenue)`.

## Code Examples

### buildPositionsWithLivePrices Helper

```typescript
// src/api/helpers/positions.ts (new file)
// Source: Derived from existing positions.ts and exitEngine.ts patterns

import { ethers } from 'ethers';
import type { ChainContext, DexConfig } from '../../chainRegistry';
import { getPnL, getExitState, getTradeIdForPendingToken } from '../../utils/db';
import { queryPrice, exitConfig } from '../../exitEngine';
import type { ExitStateRow } from '../../exitEngine';

export async function buildPositionsWithLivePrices(contexts: ChainContext[]) {
    const allTrades = getPnL();
    const openTrades = allTrades.filter(t => t.buy_status === 'pending');

    const positions = await Promise.all(openTrades.map(async trade => {
        // Resolve chain context (D-04)
        const ctx = contexts.find(c => c.chain.name === trade.chain);

        // Resolve DexConfig (D-04)
        const dex = ctx?.chain.dexes.find(d => d.dexType === trade.pool_type) ?? null;

        // Get trade ID and exit state
        const tradeIdRow = getTradeIdForPendingToken.get(trade.token, trade.chain) as { id: number } | undefined;
        const tradeId = tradeIdRow?.id ?? null;

        // ... (exit state parsing same as current positions.ts)

        // Live price query (D-01, D-02)
        let currentPrice: number | null = null;
        let priceStale = false;

        if (ctx && dex && trade.buy_cost) {
            const buyAmountWei = ethers.parseEther(trade.buy_cost);
            currentPrice = await queryPrice(ctx, dex, trade.token, trade.fee_tier, buyAmountWei);
        }

        if (currentPrice === null && exitState) {
            currentPrice = exitState.highWaterMark; // D-03 fallback
            priceStale = true;
        }

        // Unrealized P&L (D-05)
        // ...

        return { tradeId, token: trade.token, chain: trade.chain, currentPrice, priceStale, /* ... */ };
    }));

    return positions;
}
```

### onRestart Callback (built in bot.ts, passed to startApiServer)

```typescript
// Inside startMultiChainBot() in bot.ts:

// Build restart callback
const onRestart: RestartChainListenersCallback = async (ctx) => {
    const warnings: string[] = [];

    // D-11: Reconnect WS if disconnected
    if (!ctx.wsProvider) {
        if (ctx.chain.wsRpcUrl) {
            removeWsProvider(ctx.chain.name);
            const newWs = getWsProvider(ctx.chain.name, ctx.chain.wsRpcUrl, ctx.chain.chainId);
            ctx.wsProvider = newWs;
        }
    }

    // D-10: MEV health check (warn only)
    const strategy = createMevStrategy(ctx.chain);
    const mevHealthy = await strategy.healthCheck();
    if (!mevHealthy) {
        warnings.push('MEV service unreachable');
        ctx.log.warn('MEV service unreachable during chain restart');
    }

    // Re-attach listeners per DEX
    for (const dex of ctx.chain.dexes) {
        try {
            await startDexListener(ctx, dex, registry);
        } catch (err) {
            warnings.push(`Failed to restart ${dex.name}: ${err}`);
            ctx.log.error({ err, dex: dex.name }, 'Failed to restart DEX listener');
        }
    }

    if (warnings.length > 0) {
        ctx.log.warn({ warnings }, 'Chain restarted with warnings');
    }
};

const apiServer = startApiServer(contexts, registry, onRestart);
```

### startTelegramListener Export

```typescript
// src/telegramListener.ts (refactored)
// Source: Based on existing telegramListener.ts with multi-chain routing added

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import type { ChainContext } from './chainRegistry';
import { handleAlphaDropForChain } from './alphaDrop';
import { logger } from './utils/logger';

const log = logger.child({ module: 'telegramListener' });

export interface TelegramListenerHandle {
    client: TelegramClient | null;
    connected: boolean;
}

export async function startTelegramListener(
    contexts: ChainContext[]
): Promise<TelegramListenerHandle> {
    // D-14: Optional -- check env vars
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    const session = process.env.TELEGRAM_SESSION;

    if (!apiId || !apiHash || !session) {
        log.warn('Telegram env vars missing, running in factory-event-only mode');
        return { client: null, connected: false };
    }

    try {
        const client = new TelegramClient(
            new StringSession(session),
            parseInt(apiId),
            apiHash,
            { connectionRetries: 5 }
        );
        await client.connect();

        // Whitelist setup (D-18: read from process.env)
        const allowedSenders = new Set(/* ... same parsing ... */);
        const allowedChannels = new Set(/* ... same parsing ... */);

        // Event handler with multi-chain routing (D-16, D-17)
        client.addEventHandler(async (event: NewMessageEvent) => {
            // Whitelist check (FIX-09, D-21)
            // ... same OR logic ...

            // Extract addresses and route to matching chains
            for (const address of matchedAddresses) {
                const matchingCtxs = (await Promise.all(
                    contexts.map(async ctx => {
                        try {
                            const code = await ctx.httpProvider.getCode(address);
                            return code !== '0x' ? ctx : null;
                        } catch { return null; }
                    })
                )).filter(Boolean) as ChainContext[];

                for (const ctx of matchingCtxs) {
                    await handleAlphaDropForChain(ctx, address);
                }
            }
        }, new NewMessage({}));

        log.info('Telegram listener connected and listening');
        return { client, connected: true };
    } catch (err) {
        // D-15: Log error and continue
        log.error({ err }, 'Failed to connect Telegram listener');
        return { client: null, connected: false };
    }
}
```

## Signature Changes Summary

These are the exact function signature changes required:

| Function | Current Signature | New Signature |
|----------|------------------|---------------|
| `startApiServer` | `(contexts: ChainContext[])` | `(contexts: ChainContext[], onRestart?: RestartChainListenersCallback)` |
| `chainRoutes` | `(contexts, stoppedChains, onRestart?)` | No change needed -- already accepts optional onRestart |
| `positionRoutes` | `(contexts: ChainContext[])` | No change needed -- contexts already available |
| `startDexListener` | `async function startDexListener(...)` (private) | `export async function startDexListener(...)` |
| `telegramListener.main()` | standalone main() | `export async function startTelegramListener(contexts): Promise<TelegramListenerHandle>` |
| `handleAlphaDrop` | `(tokenAddress: string)` | New: `handleAlphaDropForChain(ctx: ChainContext, tokenAddress: string)` |

## Common Pitfalls

### Pitfall 7: Missing entry_price in Positions Response

**What goes wrong:** The current positions.ts (line 83-85) has a convoluted way of getting `entryPrice` -- it calls `getExitState.get(tradeId)` twice. The refactored version should just use the already-parsed exitState data.

**How to avoid:** Extract `entry_price` from the ExitStateRow once during parsing, include it in the exitState object, and reference it from there.

### Pitfall 8: WebSocket Broadcast Becoming Expensive

**What goes wrong:** The 5s WebSocket push calls `buildPositionsWithLivePrices` which fires `queryPrice` for every open position. With many positions across multiple chains, this could generate significant RPC load.

**Why it happens:** D-07 explicitly requires live prices in WebSocket updates.

**How to avoid:** This is accepted by design (D-01 says no caching). The `Promise.all` parallel pattern (D-02) limits wall-clock time. If RPC rate limits become an issue, the user can address it post-v1. For now, implement as specified.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | vitest.config.ts (workspace with unit/integration/fork projects) |
| Quick run command | `rtk vitest run --project unit` |
| Full suite command | `rtk vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01-a | buildPositionsWithLivePrices returns live prices via queryPrice | unit | `rtk vitest run --project unit test/unit/positionsHelper.test.ts -t "live price"` | Wave 0 |
| DASH-01-b | queryPrice failure falls back to highWaterMark with priceStale flag | unit | `rtk vitest run --project unit test/unit/positionsHelper.test.ts -t "fallback"` | Wave 0 |
| DASH-01-c | Unrealized P&L calculated with net cost basis | unit | `rtk vitest run --project unit test/unit/positionsHelper.test.ts -t "unrealized"` | Wave 0 |
| DASH-01-d | GET /api/positions returns live currentPrice (integration) | integration | `rtk vitest run --project integration test/integration/api/positions.test.ts` | Exists -- needs update |
| DASH-01-e | WebSocket push uses shared helper with live prices | integration | `rtk vitest run --project integration test/integration/api/wsPush.test.ts` | Wave 0 |
| DASH-03-a | onRestart callback re-attaches factory listeners | unit | `rtk vitest run --project unit test/unit/chainRestart.test.ts -t "restart"` | Wave 0 |
| DASH-03-b | WS provider reconnected on chain restart | unit | `rtk vitest run --project unit test/unit/chainRestart.test.ts -t "reconnect"` | Wave 0 |
| DASH-03-c | MEV health check runs before listener re-attach | unit | `rtk vitest run --project unit test/unit/chainRestart.test.ts -t "mev"` | Wave 0 |
| DASH-03-d | Partial restart success returns warnings array | integration | `rtk vitest run --project integration test/integration/api/chains.test.ts -t "restart"` | Exists -- needs update |
| FIX-09-a | startTelegramListener exports and connects successfully | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "connect"` | Wave 0 |
| FIX-09-b | Telegram skipped when env vars missing | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "optional"` | Wave 0 |
| FIX-09-c | Multi-chain routing checks getCode on all chains | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "routing"` | Wave 0 |
| FIX-09-d | Whitelist OR logic preserved | unit | `rtk vitest run --project unit test/unit/telegramListener.test.ts -t "whitelist"` | Wave 0 |
| FIX-09-e | Health endpoint includes telegram status | integration | `rtk vitest run --project integration test/integration/api/health.test.ts -t "telegram"` | Exists -- needs update |

### Sampling Rate
- **Per task commit:** `rtk vitest run --project unit`
- **Per wave merge:** `rtk vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/unit/positionsHelper.test.ts` -- covers DASH-01-a,b,c (new shared helper tests)
- [ ] `test/unit/chainRestart.test.ts` -- covers DASH-03-a,b,c (restart callback logic)
- [ ] `test/unit/telegramListener.test.ts` -- covers FIX-09-a,b,c,d (refactored listener)
- [ ] Update `test/integration/api/positions.test.ts` -- update for new response shape (priceStale, live currentPrice)
- [ ] Update `test/integration/api/chains.test.ts` -- add restart with callback test cases
- [ ] Update `test/integration/api/health.test.ts` -- add telegram status assertion

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all files listed in canonical references
- `src/exitEngine.ts` lines 307-337 -- queryPrice implementation and parameter requirements
- `src/bot.ts` lines 748-802 -- startDexListener implementation (private function)
- `src/bot.ts` lines 908-973 -- startMultiChainBot orchestration flow
- `src/api/routes/positions.ts` -- current positions implementation using highWaterMark
- `src/api/routes/chains.ts` -- existing onRestart callback signature (optional param)
- `src/api/server.ts` -- current startApiServer signature and WebSocket push logic
- `src/telegramListener.ts` -- current standalone structure with whitelist enforcement
- `src/chainRegistry.ts` -- ChainConfig/ChainContext/DexConfig type definitions
- `src/utils/db.ts` -- PnLResult type, getPnL query, exit_state schema
- `src/utils/provider.ts` -- getWsProvider/removeWsProvider cache management
- `test/integration/api/` -- existing test patterns and fixtures

### Secondary (MEDIUM confidence)
- `src/alphaDrop.ts` -- current single-chain alpha drop handling (needs multi-chain refactor)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing modules
- Architecture: HIGH -- all integration points thoroughly analyzed in source code
- Pitfalls: HIGH -- derived from actual code analysis (circular imports, provider state, DEX ambiguity)
- Testing: HIGH -- existing test infrastructure well-established, clear gap list

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable -- internal wiring only, no external dependency churn)
