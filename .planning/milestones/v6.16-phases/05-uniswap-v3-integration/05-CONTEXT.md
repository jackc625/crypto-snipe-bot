# Phase 5: Uniswap V3 Integration - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect and snipe V3 pool launches across all supported chains (ETH, BSC, Base, Arbitrum), handling fee tiers and concentrated liquidity correctly. V3 factories emit `PoolCreated` events; the bot subscribes to these alongside existing V2 `PairCreated` listeners, waits for liquidity (Mint event), executes swaps via V3 SwapRouter's `exactInputSingle`, and monitors positions using V3 Quoter for price queries. No new exit strategies, risk controls, or safety pipeline capabilities — only extending the existing multi-chain bot to handle V3 pool types in addition to V2.

</domain>

<decisions>
## Implementation Decisions

### Liquidity wait strategy
- **D-01:** Subscribe + timeout pattern — On `PoolCreated`, subscribe to the new pool's `Mint` event. If a Mint arrives within 30 seconds, proceed to snipe. If timeout expires, drop the opportunity and clean up the subscription.
- **D-02:** Same-block check first — Before subscribing to future Mints, check the `PoolCreated` block for existing Mint events on that pool. If found (common with atomic launch scripts), skip the subscription and snipe immediately.
- **D-03:** Configurable minimum liquidity threshold per chain (e.g., 0.5 ETH equivalent) before sniping. Prevents sniping dust-liquidity pools that can't be exited profitably. Threshold set in per-chain config alongside existing `snipeAmount`/`maxCapital`.

### V3 contract interaction
- **D-04:** Raw ABI calls with ethers v6 — no Uniswap V3 SDK dependency. The bot only needs `exactInputSingle` (SwapRouter), `quoteExactInputSingle` (Quoter), `slot0` (Pool), and factory event subscription. Raw ABI avoids ethers v5 conflict risk flagged in STATE.md.
- **D-05:** sqrtPriceLimitX96 handling — Claude's discretion on whether to pass 0 (no price limit, relying on `amountOutMinimum` for slippage protection) or calculate from slippage tolerance.

### Fee tier handling
- **D-06:** Listen for `PoolCreated` across all four V3 fee tiers (100, 500, 3000, 10000 bps). Cast the widest net for new token launches.
- **D-07:** First pool wins dedup — once a token is sniped via any pool (V2 or V3, any fee tier), all other pools for the same token are ignored. Existing `isAlreadySniped` dedup mechanism extended to cover V3 pools.

### Price monitoring
- **D-08:** Use V3 Quoter contract's `quoteExactInputSingle` (static call) for position price monitoring. Most accurate — accounts for current tick, liquidity depth, and fee tier. Analogous to V2's `getAmountsOut`.
- **D-09:** Same 15-second polling interval as V2 monitoring. Consistency across DEX types; Quoter static calls are cheap.
- **D-10:** Sell through the same pool (same fee tier) the bot bought from. Simple, predictable, and matches V2 behavior of selling through the discovery pair.

### Claude's Discretion
- DexConfig extension structure (how to distinguish V2 vs V3 entries in chain registry — likely a `dexType` field)
- V3 factory ABI definition and event parsing
- sqrtPriceLimitX96 parameter strategy (zero vs calculated from slippage)
- How to refactor `startDexListener` / `handleNewPairForChain` to support V3 event shape (`PoolCreated` has fee + tickSpacing args instead of just pair address)
- V3 SwapRouter ABI and `exactInputSingle` parameter construction
- Quoter contract deployment addresses per chain
- How to store the fee tier / pool address for V3 positions (DB schema extension if needed)
- Safety pipeline adaptation for V3 (simulateSell via V3 router instead of V2)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — V3-01 through V3-04 define all Uniswap V3 integration requirements

### Current implementation (being extended)
- `src/chainRegistry.ts` — Chain registry with `DexConfig` interface (currently V2-only: name, factoryAddress, routerAddress). Must extend for V3 with additional addresses and dexType field
- `src/bot.ts` — `startDexListener()` (line 714) subscribes to `PairCreated` — needs V3 `PoolCreated` equivalent. `handleNewPairForChain()` (line 406) runs the V2 snipe pipeline — needs V3 variant for `exactInputSingle` execution
- `src/bot.ts` — `monitorStopLossForChain()` / `monitorTakeProfitForChain()` use V2 `getAmountsOut` for price — need V3 Quoter alternative
- `src/bot.ts` — `simulateSellForChain()` uses V2 router — needs V3 router equivalent
- `src/utils/txManager.ts` — `sendTxWithRetry()` handles MEV-protected submission — reusable as-is for V3 transactions
- `src/utils/abis.ts` — Centralized ABI definitions — V3 factory, SwapRouter, Quoter, Pool ABIs should be added here

### Prior phase context
- `.planning/phases/04-multi-chain-architecture/04-CONTEXT.md` — Multi-chain architecture decisions: chain registry pattern, DexConfig array per chain, WebSocket + HTTP fallback, per-chain MEV strategies, capital allocation
- `.planning/phases/03-sqlite-storage-code-quality/03-CONTEXT.md` — SQLite as sole source of truth, trades table with chain column, pino structured logging
- `.planning/phases/02-ethers-v6-migration/02-CONTEXT.md` — ethers v6 patterns, BigInt arithmetic, raw ABI approach aligns with v6-native style

### Codebase analysis
- `.planning/codebase/ARCHITECTURE.md` — Event-driven architecture, data flow, layer responsibilities
- `.planning/codebase/STRUCTURE.md` — Directory layout, where to add new code
- `.planning/codebase/CONVENTIONS.md` — Code patterns to maintain

### Research concerns (from STATE.md)
- Uniswap V3 SDK may have ethers v5 internal dependency — raw ABI approach chosen (D-04) to avoid this entirely

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/chainRegistry.ts`: `DexConfig` interface and chain registry builder — extend with `dexType` and V3-specific addresses (SwapRouter, Quoter)
- `src/bot.ts`: `startDexListener()` with WebSocket + reconnect — pattern reusable for V3 factory subscription
- `src/bot.ts`: `handleNewPairForChain()` pipeline (dedup → safety → swap → monitor) — V3 variant follows same flow with different swap/price mechanics
- `src/bot.ts`: `startHttpPollingListener()` — reusable for V3 factory event polling fallback
- `src/utils/txManager.ts`: `sendTxWithRetry()` — reusable as-is for V3 swap transactions (just a different tx payload)
- `src/utils/abis.ts`: Centralized ABI module — add V3 contract ABIs here
- `src/utils/db.ts`: SQLite trades table already has chain column — may need pool_type or fee_tier column for V3
- `src/utils/retry.ts`: Exponential backoff — reusable for Mint event timeout and Quoter call retries

### Established Patterns
- DexConfig array per chain in registry — V3 DEX entries follow same array pattern with `dexType` discriminator
- WebSocket primary + HTTP polling fallback for event detection (Phase 4)
- Chain prefix `[ETH]`/`[BSC]` in Telegram alerts (Phase 4)
- Per-chain safety API routing via `safetyApis` config (Phase 4)
- `isAlreadySniped` dedup check before entering snipe pipeline — already token-address-based, works for V3

### Integration Points
- `startMultiChainBot()` in `bot.ts` — must iterate V3 DEX entries and spawn V3 listeners alongside V2 listeners
- `handleNewPairForChain()` — V3 variant needs different event args (fee, tickSpacing, pool instead of just pair)
- `simulateSellForChain()` — needs V3 Quoter-based sell simulation
- `monitorStopLossForChain()` / `monitorTakeProfitForChain()` — need V3 Quoter price source
- Exit manager sell execution — needs V3 `exactInputSingle` swap path alongside V2 `swapExactTokensForETH`

</code_context>

<specifics>
## Specific Ideas

- Raw ABI approach explicitly chosen to avoid Uniswap V3 SDK ethers v5 dependency conflict — do not introduce @uniswap/v3-sdk or @uniswap/sdk-core
- Same-block Mint check before subscribing catches the common atomic-launch pattern (PoolCreated + Mint in one transaction)
- First-pool-wins dedup prevents the bot from sniping the same token across multiple fee tiers or V2+V3 pools
- V3 positions should store the fee tier and pool address so sells route through the correct pool

</specifics>

<deferred>
## Deferred Ideas

- Multi-pool routing (finding best pool across fee tiers at sell time) — revisit if single-pool sells show poor execution
- V3 concentrated liquidity position management (providing LP, not just swapping) — completely out of scope, different product
- Tick-range analysis for liquidity depth assessment — could improve entry quality but adds complexity
- V3 flash swap support — different use case from sniping

</deferred>

---

*Phase: 05-uniswap-v3-integration*
*Context gathered: 2026-03-23*
