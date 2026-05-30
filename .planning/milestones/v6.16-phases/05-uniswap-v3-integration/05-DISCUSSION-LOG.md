# Phase 5: Uniswap V3 Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-23
**Phase:** 05-uniswap-v3-integration
**Areas discussed:** Liquidity wait strategy, V3 SDK vs raw ABI, Fee tier handling, Price monitoring

---

## Liquidity Wait Strategy

### Q1: How should the bot handle the gap between PoolCreated and liquidity (Mint)?

| Option | Description | Selected |
|--------|-------------|----------|
| Subscribe + timeout | On PoolCreated, subscribe to Mint event with 30s timeout. Fast and resource-efficient. | ✓ |
| Poll slot0 for liquidity | Poll pool's slot0 periodically to check for liquidity. Simpler but slower. | |
| Block-range scan | Scan next N blocks for Mint events. Batched, less reactive. | |

**User's choice:** Subscribe + timeout
**Notes:** None

### Q2: How long should the bot wait for a Mint event before dropping a PoolCreated opportunity?

| Option | Description | Selected |
|--------|-------------|----------|
| 30 seconds | Most launches add liquidity within seconds. Catches delayed adds without tying up resources. | ✓ |
| 60 seconds | More conservative. Lower chance of missing but ties up subscription longer. | |
| 10 seconds | Aggressive. Only catches near-instant adds. May miss legitimate launches. | |

**User's choice:** 30 seconds
**Notes:** None

### Q3: If PoolCreated and first Mint are in the same block, handle specially?

| Option | Description | Selected |
|--------|-------------|----------|
| Check same block first | Check PoolCreated block for existing Mints before subscribing. Handles atomic launches. | ✓ |
| Always subscribe | Subscribe regardless. Simpler code but wastes time on already-liquid pools. | |
| You decide | Let Claude determine. | |

**User's choice:** Check same block first
**Notes:** None

### Q4: Minimum liquidity threshold before sniping a V3 pool?

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable threshold | Require minimum liquidity (e.g., 0.5 ETH equiv) per chain config. Prevents dust-liquidity pools. | ✓ |
| Any Mint triggers snipe | Existing safety checks gate this already. No additional V3 threshold. | |
| You decide | Let Claude determine based on existing safety pipeline. | |

**User's choice:** Configurable threshold
**Notes:** None

---

## V3 SDK vs Raw ABI

### Q1: How should the bot interact with V3 contracts?

| Option | Description | Selected |
|--------|-------------|----------|
| Raw ABI calls | ethers v6 Contract with V3 ABIs directly. No SDK dependency, no v5 conflict. | ✓ |
| Uniswap V3 SDK | @uniswap/v3-sdk for swap construction and price math. May conflict with ethers v6. | |
| Minimal SDK + raw fallback | SDK for price math, raw ABI for execution. Hybrid approach. | |

**User's choice:** Raw ABI calls
**Notes:** STATE.md flagged V3 SDK ethers v5 dependency concern. Raw ABI avoids this entirely.

### Q2: How to handle sqrtPriceLimitX96 in exactInputSingle?

| Option | Description | Selected |
|--------|-------------|----------|
| Zero (no price limit) | Accept any execution price. Slippage via amountOutMinimum. Simpler. | |
| Calculate from slippage | Compute from current price + tolerance. More precise but adds latency. | |
| You decide | Let Claude determine optimal approach. | ✓ |

**User's choice:** You decide
**Notes:** None

---

## Fee Tier Handling

### Q1: Which V3 fee tiers should the bot listen for?

| Option | Description | Selected |
|--------|-------------|----------|
| All four tiers | Listen across 100, 500, 3000, 10000 bps. Widest net. Dedup by token address. | ✓ |
| High tiers only (3000 + 10000) | Most new launches use 0.3% or 1%. Less noise. | |
| Configurable per chain | Per-chain config for fee tiers. Different patterns per chain. | |

**User's choice:** All four tiers
**Notes:** None

### Q2: If same token has pools at multiple fee tiers?

| Option | Description | Selected |
|--------|-------------|----------|
| First pool wins | Snipe whichever pool detected first with liquidity. Dedup by token address. | ✓ |
| Best liquidity pool | Wait to see all pools, pick most liquid. Better execution but slower. | |
| You decide | Let Claude determine dedup/selection strategy. | |

**User's choice:** First pool wins
**Notes:** None

---

## Price Monitoring

### Q1: How should the bot get V3 position prices for stop-loss/take-profit?

| Option | Description | Selected |
|--------|-------------|----------|
| Quoter contract | quoteExactInputSingle static call. Most accurate — accounts for tick, liquidity, fee. | ✓ |
| Pool slot0 sqrtPriceX96 | Direct storage read. Cheaper but doesn't account for liquidity depth. | |
| You decide | Let Claude determine based on gas/accuracy tradeoffs. | |

**User's choice:** Quoter contract
**Notes:** None

### Q2: Same 15s interval as V2, or different cadence?

| Option | Description | Selected |
|--------|-------------|----------|
| Same 15s interval | Consistency with V2. Quoter static calls are cheap. | ✓ |
| Configurable per DEX type | Allow different intervals for V2 vs V3. V3 may warrant faster polling. | |
| You decide | Let Claude determine. | |

**User's choice:** Same 15s interval
**Notes:** None

### Q3: Sell through same pool or find best route?

| Option | Description | Selected |
|--------|-------------|----------|
| Same pool | Sell through exact pool (same fee tier) bought from. Simple, predictable. | ✓ |
| Best available pool | Check all V3 pools at sell time. Better execution but more complex. | |

**User's choice:** Same pool
**Notes:** None

---

## Claude's Discretion

- sqrtPriceLimitX96 parameter strategy (zero vs calculated from slippage)
- DexConfig extension structure (dexType field, V3-specific addresses)
- V3 factory/SwapRouter/Quoter/Pool ABI definitions
- Refactoring startDexListener and handleNewPairForChain for V3 event shape
- DB schema extension for fee tier / pool address storage
- Safety pipeline V3 adaptation (simulateSell via V3 router)

## Deferred Ideas

- Multi-pool routing at sell time (finding best pool across fee tiers)
- V3 concentrated liquidity position management (LP, not just swapping)
- Tick-range analysis for liquidity depth assessment
- V3 flash swap support
