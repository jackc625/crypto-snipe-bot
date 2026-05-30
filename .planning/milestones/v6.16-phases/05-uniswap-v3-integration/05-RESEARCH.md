# Phase 5: Uniswap V3 Integration - Research

**Researched:** 2026-03-23
**Domain:** Uniswap V3 smart contract integration (Factory, SwapRouter, Quoter, Pool events) via raw ABI calls with ethers v6
**Confidence:** HIGH

## Summary

This phase extends the existing multi-chain snipe bot to detect and execute swaps on Uniswap V3 pools alongside the existing V2 infrastructure. The bot must subscribe to `PoolCreated` events from V3 factories, wait for `Mint` events confirming liquidity, execute buys via the V3 SwapRouter's `exactInputSingle`, and monitor positions using the V3 QuoterV2's `quoteExactInputSingle`.

The implementation is well-scoped because: (1) official Uniswap V3 is deployed on all four target chains (ETH, BSC, Base, Arbitrum), (2) the raw ABI approach avoids the Uniswap SDK's ethers v5 dependency conflict, and (3) the existing multi-chain architecture (ChainContext, DexConfig array, WebSocket+HTTP listeners) provides clean extension points. BSC additionally has PancakeSwap V3 as a second V3 DEX option with compatible ABI interfaces.

**Primary recommendation:** Extend the `DexConfig` interface with a `dexType: 'v2' | 'v3'` discriminator and V3-specific address fields (swapRouterAddress, quoterAddress). Add V3 ABIs to `abis.ts`. Create V3-specific handler/monitor functions that parallel the existing V2 `handleNewPairForChain`/`monitorStopLossForChain` pattern but use V3 contract calls. DB schema migration adds `pool_type` and `fee_tier` columns to the trades table.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Subscribe + timeout pattern -- On PoolCreated, subscribe to the new pool's Mint event. If a Mint arrives within 30 seconds, proceed to snipe. If timeout expires, drop the opportunity and clean up the subscription.
- D-02: Same-block check first -- Before subscribing to future Mints, check the PoolCreated block for existing Mint events on that pool. If found (common with atomic launch scripts), skip the subscription and snipe immediately.
- D-03: Configurable minimum liquidity threshold per chain (e.g., 0.5 ETH equivalent) before sniping. Prevents sniping dust-liquidity pools that can't be exited profitably. Threshold set in per-chain config alongside existing snipeAmount/maxCapital.
- D-04: Raw ABI calls with ethers v6 -- no Uniswap V3 SDK dependency. The bot only needs exactInputSingle (SwapRouter), quoteExactInputSingle (Quoter), slot0 (Pool), and factory event subscription. Raw ABI avoids ethers v5 conflict risk flagged in STATE.md.
- D-05: sqrtPriceLimitX96 handling -- Claude's discretion on whether to pass 0 (no price limit, relying on amountOutMinimum for slippage protection) or calculate from slippage tolerance.
- D-06: Listen for PoolCreated across all four V3 fee tiers (100, 500, 3000, 10000 bps). Cast the widest net for new token launches.
- D-07: First pool wins dedup -- once a token is sniped via any pool (V2 or V3, any fee tier), all other pools for the same token are ignored. Existing isAlreadySniped dedup mechanism extended to cover V3 pools.
- D-08: Use V3 Quoter contract's quoteExactInputSingle (static call) for position price monitoring. Most accurate -- accounts for current tick, liquidity depth, and fee tier. Analogous to V2's getAmountsOut.
- D-09: Same 15-second polling interval as V2 monitoring. Consistency across DEX types; Quoter static calls are cheap.
- D-10: Sell through the same pool (same fee tier) the bot bought from. Simple, predictable, and matches V2 behavior of selling through the discovery pair.

### Claude's Discretion
- DexConfig extension structure (how to distinguish V2 vs V3 entries in chain registry -- likely a dexType field)
- V3 factory ABI definition and event parsing
- sqrtPriceLimitX96 parameter strategy (zero vs calculated from slippage)
- How to refactor startDexListener / handleNewPairForChain to support V3 event shape (PoolCreated has fee + tickSpacing args instead of just pair address)
- V3 SwapRouter ABI and exactInputSingle parameter construction
- Quoter contract deployment addresses per chain
- How to store the fee tier / pool address for V3 positions (DB schema extension if needed)
- Safety pipeline adaptation for V3 (simulateSell via V3 router instead of V2)

### Deferred Ideas (OUT OF SCOPE)
- Multi-pool routing (finding best pool across fee tiers at sell time) -- revisit if single-pool sells show poor execution
- V3 concentrated liquidity position management (providing LP, not just swapping) -- completely out of scope, different product
- Tick-range analysis for liquidity depth assessment -- could improve entry quality but adds complexity
- V3 flash swap support -- different use case from sniping
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| V3-01 | Bot detects new V3 pool creation (PoolCreated events) across all configured chains and fee tiers | V3 Factory ABI, PoolCreated event signature, deployment addresses for all 4 chains verified. All fee tiers (100, 500, 3000, 10000) emitted as indexed param. |
| V3-02 | Bot waits for Mint event (liquidity addition) after PoolCreated before sniping -- does not snipe empty pools | V3 Pool Mint event ABI verified. Same-block check pattern (D-02) and subscribe+timeout pattern (D-01) researched. |
| V3-03 | V3 swap execution uses the V3 SwapRouter with correct fee tier and sqrtPriceX96 parameters | SwapRouter exactInputSingle ABI verified for both SwapRouter (with deadline) and SwapRouter02 (without deadline). ethers v6 struct encoding pattern confirmed. |
| V3-04 | V3 price monitoring uses sqrtPriceX96 or oracle for accurate position valuation | QuoterV2 quoteExactInputSingle ABI verified -- returns amountOut via static call. Slot0 ABI verified as fallback. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ethers | 6.16.0 | Contract interaction, ABI encoding, event subscription | Already pinned in project; raw ABI approach eliminates SDK dependency |

No new npm packages are required. All V3 interaction is through raw ABI definitions with ethers v6 Contract instances -- per locked decision D-04.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw ABI calls | @uniswap/v3-sdk + @uniswap/sdk-core | SDK bundles ethers v5 internally, causing dependency conflict. Raw ABI is 100% compatible with ethers v6. LOCKED: D-04 chose raw ABI. |
| QuoterV2 for pricing | Pool.slot0() sqrtPriceX96 math | slot0 is cheaper (no simulation) but doesn't account for actual liquidity depth at current tick. QuoterV2 gives accurate amountOut. LOCKED: D-08 chose QuoterV2. |

## Architecture Patterns

### DexConfig Extension

The existing `DexConfig` interface must be extended with a type discriminator. Recommended approach: discriminated union.

```typescript
// Existing V2 shape preserved, V3 shape adds new fields
export interface DexConfigBase {
    name: string;
    factoryAddress: string;
}

export interface DexConfigV2 extends DexConfigBase {
    dexType: 'v2';
    routerAddress: string;
}

export interface DexConfigV3 extends DexConfigBase {
    dexType: 'v3';
    swapRouterAddress: string;
    quoterAddress: string;
}

export type DexConfig = DexConfigV2 | DexConfigV3;
```

This preserves backward compatibility -- existing code accessing `dex.routerAddress` still works on V2 configs. TypeScript narrowing via `dex.dexType === 'v3'` gates V3-specific code paths.

**Alternative considered:** Single DexConfig with optional fields (`routerAddress?: string`, `swapRouterAddress?: string`). Rejected because it loses type safety and allows invalid combinations.

### V3 Listener + Handler Pattern

The existing `startDexListener` subscribes to `PairCreated` events. V3 needs a parallel function for `PoolCreated` events with different parameters:

```
startDexListener(ctx, dex)  // existing -- dispatches V2 PairCreated
    |
    +-- if dex.dexType === 'v2' --> subscribe PairCreated --> handleNewPairForChain
    +-- if dex.dexType === 'v3' --> subscribe PoolCreated --> handleNewV3PoolForChain
```

The V3 handler pipeline differs from V2:
1. Receive PoolCreated(token0, token1, fee, tickSpacing, pool)
2. Dedup check (isAlreadySniped on target token -- same as V2, cross-DEX dedup per D-07)
3. **Liquidity wait** (NEW -- D-01/D-02): same-block Mint check, then subscribe+timeout
4. **Minimum liquidity check** (NEW -- D-03): verify liquidity meets chain threshold
5. Safety checks (reuse existing ForChain functions, but simulateSell needs V3 variant)
6. Buy via V3 SwapRouter exactInputSingle (different from V2 swapExactETHForTokens)
7. Monitor via V3 QuoterV2 (different from V2 getAmountsOut)

### DB Schema Extension

Current trades table needs two new columns:

```sql
ALTER TABLE trades ADD COLUMN pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3'));
ALTER TABLE trades ADD COLUMN fee_tier INTEGER;
```

These enable: (1) knowing which router to use for sells, and (2) routing sells through the correct fee tier pool per D-10.

Schema migration increments `user_version` from 1 to 2.

### Recommended File Changes

```
src/
  chainRegistry.ts          # Extend DexConfig with discriminated union, add V3 entries
  bot.ts                    # Add V3 listener, V3 handler, V3 monitor, V3 sell functions
  utils/
    abis.ts                 # Add V3_FACTORY_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI, V3_POOL_ABI
    db.ts                   # Schema migration v2: add pool_type, fee_tier columns
    tokenSafety.ts          # Add simulateSellV3ForChain (sell sim via V3 quoter)
```

### Anti-Patterns to Avoid
- **Importing @uniswap/v3-sdk or @uniswap/sdk-core:** Introduces ethers v5 transitive dependency. All V3 interaction MUST use raw ABIs. (LOCKED: D-04)
- **Separate event loop for V3:** The existing `startMultiChainBot` loop already iterates `chain.dexes` -- V3 entries should be added to the same array, not handled separately.
- **Hardcoding fee tier assumptions:** New pools can use any of the 4 fee tiers. The handler must store and propagate the fee tier from the PoolCreated event through the entire buy-monitor-sell pipeline.
- **Using SwapRouter (0xE592...) on chains that only have SwapRouter02 (0x68b3...):** Base and BSC only deploy SwapRouter02. The ABI struct differs (no `deadline` field in SwapRouter02 -- it uses a `checkDeadline` modifier instead).

## V3 Contract Addresses Per Chain

All addresses verified from official Uniswap deployment docs (2026-03-23).

### Ethereum (chainId: 1)
| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| SwapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` |
| QuoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |

### BSC / BNB Chain (chainId: 56)
| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` |
| SwapRouter02 | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` |
| QuoterV2 | `0x78D78E420Da98ad378D7799bE8f4AF69033EB077` |

BSC also has PancakeSwap V3 (compatible ABI):
| Contract | Address |
|----------|---------|
| PancakeV3Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| SwapRouter | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` |
| QuoterV2 | `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` |

### Base (chainId: 8453)
| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |

### Arbitrum (chainId: 42161)
| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| SwapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` |
| QuoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |

**Router choice recommendation:** Use SwapRouter02 on all chains for consistency. It is deployed everywhere and is the current standard. The struct difference (no `deadline` field) is handled via `multicall` with `checkDeadline` modifier, or by calling `exactInputSingle` directly without deadline in the struct.

**Critical note on SwapRouter vs SwapRouter02:** The original SwapRouter's `ExactInputSingleParams` includes `deadline` in the struct. SwapRouter02's version does NOT include `deadline` in the struct (deadline is enforced via a separate `checkDeadline` modifier called via `multicall`). Using the wrong ABI for the wrong router will revert transactions. Recommendation: use SwapRouter02 on all chains with its correct ABI.

## V3 ABI Definitions

These are the exact ABI fragments needed for raw ethers v6 Contract instances.

### V3 Factory ABI
```typescript
export const V3_FACTORY_ABI = [
    "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"
];
```

### V3 Pool ABI
```typescript
export const V3_POOL_ABI = [
    "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() external view returns (uint128)"
];
```

### V3 SwapRouter02 ABI (for exactInputSingle without deadline in struct)
```typescript
export const V3_SWAP_ROUTER_ABI = [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
    "function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] memory)"
];
```

### V3 QuoterV2 ABI
```typescript
export const V3_QUOTER_V2_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];
```

### ethers v6 Struct Encoding Pattern

ethers v6 handles tuple/struct parameters as plain objects:

```typescript
// SwapRouter02 exactInputSingle -- no deadline in struct
const params = {
    tokenIn: wethAddress,
    tokenOut: targetToken,
    fee: feeTier,         // uint24: 100, 500, 3000, or 10000
    recipient: wallet.address,
    amountIn: amountIn,   // bigint
    amountOutMinimum: minOut, // bigint
    sqrtPriceLimitX96: 0n // 0 = no price limit, rely on amountOutMinimum
};

// Call with ETH value (since tokenIn is WETH, send ETH directly)
const tx = await v3Router.exactInputSingle(params, { value: amountIn, gasLimit: gasLimit });
```

For SwapRouter02, deadline enforcement via multicall:
```typescript
const deadline = Math.floor(Date.now() / 1000) + 60;
const swapData = v3Router.interface.encodeFunctionData('exactInputSingle', [params]);
const tx = await v3Router.multicall(deadline, [swapData], { value: amountIn, gasLimit: gasLimit });
```

### QuoterV2 Static Call Pattern

```typescript
// QuoterV2 quoteExactInputSingle -- static call for price monitoring
const quoteParams = {
    tokenIn: targetToken,
    tokenOut: wethAddress,
    amountIn: tokenBalance,
    fee: feeTier,
    sqrtPriceLimitX96: 0n
};

// Use callStatic equivalent (ethers v6: just call the function, it's view-like via staticCall)
const [amountOut] = await quoter.quoteExactInputSingle.staticCall(quoteParams);
```

## sqrtPriceLimitX96 Strategy (Claude's Discretion -- D-05)

**Recommendation: Pass 0 (no price limit), rely on `amountOutMinimum` for slippage protection.**

Rationale:
1. `amountOutMinimum` already provides slippage protection -- the tx reverts if output is below minimum.
2. Calculating sqrtPriceLimitX96 requires knowing the current sqrtPriceX96 (extra slot0 call) and applying slippage math with Q96 fixed-point arithmetic -- complexity with no additional safety benefit when amountOutMinimum is set correctly.
3. Setting sqrtPriceLimitX96 to 0 is the standard pattern used in Uniswap's own example code and documentation.
4. For a snipe bot where speed matters, eliminating the extra slot0 call saves latency.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| V3 swap execution | Custom low-level calldata encoding | ethers v6 Contract with human-readable ABI | ethers handles tuple encoding, type coercion, and error decoding automatically |
| sqrtPriceX96 to human price conversion | Manual Q96 fixed-point math | QuoterV2 quoteExactInputSingle static call | QuoterV2 returns actual amountOut accounting for liquidity depth, tick spacing, and fees -- no math needed |
| Deadline enforcement on SwapRouter02 | Adding deadline to struct (wrong ABI) | multicall(deadline, [swapData]) wrapper | SwapRouter02 uses modifier pattern, not struct field |
| V3 pool address derivation | CREATE2 address computation | Read pool address from PoolCreated event | Event already provides the pool address; computing it requires init code hash that varies by deployment |

**Key insight:** The V3 contract surface area needed is small (4 functions + 2 events). Raw ABI with ethers v6 is simpler than importing the SDK, which would bring in ethers v5 transitive deps and hundreds of KB of unused code.

## Common Pitfalls

### Pitfall 1: SwapRouter vs SwapRouter02 ABI Mismatch
**What goes wrong:** Transaction reverts with opaque error because the `ExactInputSingleParams` struct has a `deadline` field in the original SwapRouter but NOT in SwapRouter02.
**Why it happens:** Both are called "SwapRouter" in documentation. Base and BSC only deploy SwapRouter02.
**How to avoid:** Use SwapRouter02 ABI exclusively. Enforce deadline via `multicall(deadline, [swapData])` wrapper.
**Warning signs:** "execution reverted" on swap attempts with no clear reason.

### Pitfall 2: Sniping Empty V3 Pools
**What goes wrong:** Bot detects PoolCreated and immediately tries to swap, but the pool has zero liquidity. The swap reverts or executes at an extreme price.
**Why it happens:** V3 pool creation and liquidity addition are separate transactions (unlike V2 where PairCreated often coincides with addLiquidity in atomic scripts).
**How to avoid:** ALWAYS wait for Mint event before sniping (D-01/D-02). Check pool.liquidity() > 0 as sanity check.
**Warning signs:** Swap reverts with "SPL" (sqrtPriceLimit) errors on empty pools.

### Pitfall 3: QuoterV2 Reverts Instead of Returning Zero
**What goes wrong:** QuoterV2.quoteExactInputSingle reverts when pool has zero liquidity or insufficient liquidity for the quoted amount, instead of returning 0.
**Why it happens:** The Quoter internally executes the swap and catches the revert to extract the output amount -- if the swap itself can't execute, the Quoter reverts.
**How to avoid:** Wrap QuoterV2 calls in try-catch. A revert in the price monitor means the position is illiquid -- trigger emergency sell or flag for manual intervention.
**Warning signs:** Monitoring loops logging repeated errors for a specific token.

### Pitfall 4: Fee Tier Not Propagated Through Pipeline
**What goes wrong:** Bot buys via one fee tier pool but tries to sell via a different fee tier (or defaults to 3000).
**Why it happens:** The fee tier from PoolCreated is not stored/passed through the buy -> monitor -> sell pipeline.
**How to avoid:** Store fee tier in DB (fee_tier column) and pass it through all V3 function calls. The sell must use the exact same fee tier as the buy.
**Warning signs:** Sell transactions reverting because wrong pool is targeted.

### Pitfall 5: Forgetting to Handle Payable on SwapRouter
**What goes wrong:** Sending ETH to swap for tokens via V3 requires `{ value: amountIn }` in the transaction options because the SwapRouter wraps ETH to WETH internally.
**Why it happens:** V2 router has `swapExactETHForTokens` which is explicitly payable. V3's `exactInputSingle` is also payable but it's less obvious -- you set tokenIn to WETH address but send raw ETH.
**How to avoid:** When tokenIn is WETH, always include `{ value: amountIn }` in tx overrides.
**Warning signs:** "insufficient funds" or "STF" (safe transfer failed) errors.

### Pitfall 6: Sell Simulation Mismatch for V3
**What goes wrong:** simulateSellForChain uses V2 router's getAmountsOut which doesn't work for V3 pools.
**Why it happens:** The existing sell simulation is hardcoded to V2 router ABI.
**How to avoid:** Create simulateSellV3ForChain that uses QuoterV2 to simulate the sell. Gate on dexType at the handler level.
**Warning signs:** All V3 tokens failing sell simulation and being skipped.

### Pitfall 7: Mint Event Subscription Leak
**What goes wrong:** If the 30-second timeout fires and the bot cleans up, but a Mint event arrives on the pool later and is still processed.
**Why it happens:** ethers event listeners require explicit removal.
**How to avoid:** On timeout, explicitly call `pool.removeAllListeners('Mint')` to prevent stale callbacks.
**Warning signs:** Unexpected snipe attempts on pools that should have been timed out.

## Code Examples

### PoolCreated Event Handling (V3-01)
```typescript
// Source: Uniswap V3 Factory interface + ethers v6 event pattern
const v3Factory = new Contract(dex.factoryAddress, V3_FACTORY_ABI, wsProvider);

v3Factory.on('PoolCreated', (token0: string, token1: string, fee: bigint, tickSpacing: bigint, pool: string) => {
    // fee is uint24 but ethers v6 returns indexed uint24 as bigint
    const feeTier = Number(fee);
    handleNewV3PoolForChain(ctx, dex, token0, token1, feeTier, pool);
});
```

### Liquidity Wait Pattern (V3-02, D-01, D-02)
```typescript
// Source: Pattern derived from decisions D-01 and D-02
async function waitForLiquidity(
    ctx: ChainContext,
    poolAddress: string,
    blockNumber: number
): Promise<boolean> {
    const pool = new Contract(poolAddress, V3_POOL_ABI, ctx.httpProvider);

    // D-02: Same-block check first -- atomic launch scripts emit PoolCreated + Mint in one block
    const mintFilter = pool.filters.Mint();
    const existingMints = await pool.queryFilter(mintFilter, blockNumber, blockNumber);
    if (existingMints.length > 0) {
        ctx.log.info({ pool: poolAddress, block: blockNumber }, 'Mint found in same block as PoolCreated');
        return true;
    }

    // D-01: Subscribe + timeout for future Mints
    return new Promise<boolean>((resolve) => {
        const wsPool = new Contract(poolAddress, V3_POOL_ABI, ctx.wsProvider || ctx.httpProvider);
        const timeout = setTimeout(() => {
            wsPool.removeAllListeners('Mint');
            ctx.log.info({ pool: poolAddress }, 'Mint timeout (30s), dropping opportunity');
            resolve(false);
        }, 30_000);

        wsPool.on('Mint', () => {
            clearTimeout(timeout);
            wsPool.removeAllListeners('Mint');
            ctx.log.info({ pool: poolAddress }, 'Mint event received, proceeding to snipe');
            resolve(true);
        });
    });
}
```

### V3 Buy Execution (V3-03)
```typescript
// Source: Uniswap V3 SwapRouter02 ABI + ethers v6 tuple encoding
async function executeV3Buy(
    ctx: ChainContext,
    dex: DexConfigV3,
    targetToken: string,
    feeTier: number,
    amountIn: bigint,
    minOut: bigint
): Promise<void> {
    const v3Router = new Contract(dex.swapRouterAddress, V3_SWAP_ROUTER_ABI, ctx.wallet);
    const deadline = Math.floor(Date.now() / 1000) + 60;

    const params = {
        tokenIn: ctx.chain.wethAddress,
        tokenOut: targetToken,
        fee: feeTier,
        recipient: ctx.wallet.address,
        amountIn: amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n
    };

    // Use multicall for deadline enforcement on SwapRouter02
    const swapData = v3Router.interface.encodeFunctionData('exactInputSingle', [params]);
    const tx = await v3Router.multicall(deadline, [swapData], {
        value: amountIn,
        gasLimit: ctx.chain.gas.maxGasLimit
    });

    return tx;
}
```

### V3 Price Monitoring (V3-04)
```typescript
// Source: Uniswap V3 QuoterV2 interface + ethers v6 staticCall
async function getV3Price(
    ctx: ChainContext,
    quoterAddress: string,
    tokenAddress: string,
    feeTier: number,
    amount: bigint
): Promise<bigint | null> {
    const quoter = new Contract(quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);

    try {
        const quoteParams = {
            tokenIn: tokenAddress,
            tokenOut: ctx.chain.wethAddress,
            amountIn: amount,
            fee: feeTier,
            sqrtPriceLimitX96: 0n
        };

        const [amountOut] = await quoter.quoteExactInputSingle.staticCall(quoteParams);
        return amountOut;
    } catch {
        return null; // Pool illiquid or other error
    }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SwapRouter (0xE592...) with deadline in struct | SwapRouter02 (0x68b3...) with multicall deadline | 2022 | Must use correct ABI per router version. SwapRouter02 is the standard on newer deployments. |
| Quoter (v1) with positional args | QuoterV2 with struct params + extra return values | 2022 | QuoterV2 returns gasEstimate and more data. Base and BSC only have QuoterV2 (no v1). |
| @uniswap/v3-sdk with ethers v5 | Raw ABI approach with ethers v6 | Ongoing | SDK still internally uses ethers v5; raw ABI is the clean path for ethers v6 projects. |

**Deprecated/outdated:**
- Quoter v1 (0xb273...): Still deployed on ETH and Arbitrum but NOT on Base or BSC. Use QuoterV2 universally.
- SwapRouter v1 (0xE592...): Still deployed on ETH and Arbitrum but NOT on Base or BSC. Use SwapRouter02 universally.

## Open Questions

1. **Minimum liquidity check mechanics (D-03)**
   - What we know: D-03 requires configurable minimum liquidity per chain. V3 pools expose `liquidity()` function (total liquidity) and token amounts can be derived from slot0 + liquidity.
   - What's unclear: Whether to check `pool.liquidity()` (concentrated liquidity units, not directly comparable to ETH amount) or use QuoterV2 to simulate a small swap and check the output.
   - Recommendation: Use QuoterV2 to simulate swapping a reference amount (e.g., 0.001 ETH) to the new token. If quoter reverts or returns < threshold, liquidity is insufficient. This is simpler and more accurate than interpreting raw liquidity units.

2. **PancakeSwap V3 on BSC: include or defer?**
   - What we know: Both Uniswap V3 and PancakeSwap V3 are deployed on BSC with compatible ABIs. PancakeSwap V3 has higher BSC volume.
   - What's unclear: Whether to include PancakeSwap V3 as a second V3 DEX entry on BSC in this phase.
   - Recommendation: Include both. The DexConfig array pattern already supports multiple DEXes per chain. PancakeSwap V3 uses the same ABI interface (PoolCreated, exactInputSingle, quoteExactInputSingle). Adding it is just another entry in the BSC chain template. This maximizes coverage.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Hardhat + chai (existing devDependencies) |
| Config file | hardhat.config.ts (exists, Sepolia only) |
| Quick run command | `npx hardhat test` |
| Full suite command | `npx hardhat test` |

Note: No project-level test files currently exist. The project has Hardhat + chai in devDependencies but no test directory or test files. Phase 9 (Testing) is dedicated to building the test suite. For this phase, validation is primarily through compilation (`tsc`) and manual UAT.

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| V3-01 | PoolCreated event detection across chains/fee tiers | integration | Manual: deploy V3 factory on hardhat fork, emit event | No -- Wave 0 |
| V3-02 | Mint event wait before sniping | integration | Manual: emit PoolCreated without Mint, verify no snipe | No -- Wave 0 |
| V3-03 | exactInputSingle execution with correct params | integration | Manual: fork mainnet, execute swap against real pool | No -- Wave 0 |
| V3-04 | QuoterV2 price monitoring accuracy | integration | Manual: compare QuoterV2 output to known pool state | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` (type checking)
- **Per wave merge:** `npx tsc --noEmit` + manual smoke test
- **Phase gate:** Full compilation green + manual UAT on all 4 requirements

### Wave 0 Gaps
None for this phase -- testing infrastructure is deferred to Phase 9 per project roadmap. Validation relies on TypeScript compilation and manual UAT, consistent with Phases 1-4 approach.

## Sources

### Primary (HIGH confidence)
- [Uniswap V3 Ethereum Deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments) - Factory, SwapRouter, SwapRouter02, Quoter, QuoterV2 addresses
- [Uniswap V3 Base Deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments) - Base V3 contract addresses
- [Uniswap V3 Arbitrum Deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/arbitrum-deployments) - Arbitrum V3 contract addresses
- [Uniswap V3 BNB Deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/bnb-deployments) - BSC V3 contract addresses
- [PancakeSwap V3 Addresses](https://developer.pancakeswap.finance/contracts/v3/addresses) - PancakeSwap V3 BSC contract addresses
- [IUniswapV3Factory Interface](https://docs.uniswap.org/contracts/v3/reference/core/interfaces/IUniswapV3Factory) - PoolCreated event definition
- [ISwapRouter Interface](https://docs.uniswap.org/contracts/v3/reference/periphery/interfaces/ISwapRouter) - exactInputSingle struct definition
- [IUniswapV3PoolEvents](https://docs.uniswap.org/contracts/v3/reference/core/interfaces/pool/IUniswapV3PoolEvents) - Mint event definition
- [IUniswapV3PoolState](https://docs.uniswap.org/contracts/v3/reference/core/interfaces/pool/IUniswapV3PoolState) - slot0 function definition
- [QuoterV2 Interface](https://docs.uniswap.org/contracts/v3/reference/periphery/lens/QuoterV2) - quoteExactInputSingle struct definition
- [Single Swaps Guide](https://docs.uniswap.org/contracts/v3/guides/swaps/single-swaps) - Official swap integration guide
- [V3SwapRouter Source](https://github.com/Uniswap/swap-router-contracts/blob/main/contracts/V3SwapRouter.sol) - SwapRouter02 source confirming no deadline in struct

### Secondary (MEDIUM confidence)
- [Uniswap V3 Swap Examples](https://solidity-by-example.org/defi/uniswap-v3-swap/) - Community examples cross-verified with official docs
- [ethers.js Discussion #3480](https://github.com/ethers-io/ethers.js/discussions/3480) - ethers v5/v6 struct encoding for V3

### Tertiary (LOW confidence)
- None -- all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new packages needed; raw ABI with ethers v6 is the decided approach (D-04), project already has ethers 6.16.0 pinned
- Architecture: HIGH - Existing DexConfig/ChainContext patterns provide clear extension points; discriminated union is idiomatic TypeScript
- Contract addresses: HIGH - All addresses fetched from official Uniswap docs deployment pages and PancakeSwap developer docs
- ABI definitions: HIGH - Cross-verified with Uniswap GitHub source code (v3-core, v3-periphery, swap-router-contracts)
- Pitfalls: HIGH - SwapRouter vs SwapRouter02 difference confirmed via source code; empty pool risk is well-documented in V3 ecosystem

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (contract addresses are permanent; API surfaces stable)
