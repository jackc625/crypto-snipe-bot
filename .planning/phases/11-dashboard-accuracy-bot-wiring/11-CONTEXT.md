# Phase 11: Dashboard Accuracy & Bot Integration Wiring - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix three specific gaps from the v6.16 milestone audit: (1) GET /api/positions returns live on-chain prices instead of the highWaterMark peak price, (2) POST /api/chains/:name/start re-attaches factory event listeners via the onRestart callback, and (3) telegramListener is imported and started within the multi-chain bot orchestrator. Also closes FIX-09 (telegram sender whitelist enforcement). No new dashboard pages, no new trading logic, no schema changes.

</domain>

<decisions>
## Implementation Decisions

### Live price source for positions API
- **D-01:** Call `queryPrice()` per request for each open position — freshest possible data, no caching layer
- **D-02:** Query all open positions' prices in parallel via `Promise.all` — one RPC round-trip time regardless of position count
- **D-03:** If `queryPrice()` fails for a position, fall back to `highWaterMark` as `currentPrice` with a `priceStale: true` flag in the response — no position goes price-less
- **D-04:** Resolve the correct ChainContext and DexConfig per position by matching chain name to contexts array, then finding the DexConfig matching `pool_type` and `fee_tier` from the chain's dexes array — no schema changes needed
- **D-05:** Compute live unrealized P&L per position: `(remaining tokens x currentPrice) - (original buy cost - partial sell revenue already received)` — net cost basis accounting for partial takes
- **D-06:** Extract a shared `buildPositionsWithLivePrices(contexts)` async function used by both GET /api/positions and the WebSocket 5s push — no logic duplication

### WebSocket price push
- **D-07:** WebSocket position updates also include live on-chain prices from `queryPrice()` — consistent data across REST and WS
- **D-08:** Both REST and WS call the same shared helper (`buildPositionsWithLivePrices`) for identical output shape

### Chain restart wiring
- **D-09:** Pass chain registry to `startApiServer(contexts, registry)` — the `onRestart` callback is built inside `server.ts` using the registry
- **D-10:** Re-run MEV health check on chain restart before re-attaching listeners — warn if unhealthy but don't block restart
- **D-11:** Reconnect WebSocket provider if it was disconnected during stop — factory listeners need WS events to detect new pairs
- **D-12:** Partial restart success: return 200 with `ok: true` and a `warnings` array listing which DEX listeners failed — chain removed from stopped set, dashboard shows degraded indicator

### Telegram listener integration
- **D-13:** Refactor `telegramListener.ts` to export `startTelegramListener()` function — remove standalone `main()` and `process.stdin.resume()`, called from `bot.ts` after chain listeners are up
- **D-14:** Telegram listener is optional — if `TELEGRAM_API_ID` or `TELEGRAM_SESSION` env vars are missing, log a warning and skip. Bot runs in factory-event-only mode
- **D-15:** If telegram listener fails to connect at startup, log error and continue — no retry, no blocking
- **D-16:** Make multi-chain aware — pass `ChainContext[]` to `startTelegramListener()` so alpha drops can target the right chain
- **D-17:** Chain routing: detect target chain by checking the contract address against each chain's RPC (`getCode` or similar) — if contract exists on multiple chains, trigger `handleAlphaDrop` on all matching chains (each chain's risk gate independently decides)
- **D-18:** Whitelist env vars continue to be read from `process.env` inside telegramListener.ts — no parameter passing for whitelist config
- **D-19:** Add telegram listener connected/disconnected status to `GET /health` response
- **D-20:** Include `TelegramClient.disconnect()` in the graceful shutdown handler in `bot.ts`

### FIX-09 whitelist enforcement
- **D-21:** Whitelist enforcement code already exists (lines 43-53 of telegramListener.ts) and is correctly implemented — keep OR logic (message passes if sender OR channel is whitelisted, empty whitelist = allow all)
- **D-22:** No logic change needed — verification confirms FIX-09 is implemented. The main gap is that the code runs in a standalone process, not the orchestrator. Integration via D-13 closes this gap.

### Error handling
- **D-23:** Telegram connection failure at startup: log error and continue (consistent with D-14/D-15)
- **D-24:** Chain restart partial failure: report partial success with warnings array (D-12)
- **D-25:** queryPrice failure per position: fall back to highWaterMark with priceStale flag (D-03)

### Testing
- **D-26:** Unit + integration tests for all three fixes
- **D-27:** Unit tests: mock `queryPrice` for positions helper, mock `startDexListener` for restart callback, mock `TelegramClient` for listener startup
- **D-28:** Integration tests: chain restart flow via HTTP, positions endpoint with mocked RPC
- **D-29:** Test multi-chain routing for telegram: mock `getCode()` responses to simulate contract existing on ETH but not BSC, verify correct routing

### Claude's Discretion
- How to wire the onRestart callback (reuse startDexListener vs new re-subscribe function)
- Exact implementation of WebSocket provider reconnection on chain restart
- How buildPositionsWithLivePrices resolves DexConfig per trade (exact lookup logic)
- queryPrice parameter construction from trade data (buyAmountWei source)
- How to expose TelegramClient disconnect handle to bot.ts shutdown handler
- Test file organization (new test files vs extending existing ones)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — DASH-01 (real-time positions with P&L), DASH-03 (bot controls from dashboard), FIX-09 (telegram sender whitelist)

### Positions API (being fixed)
- `src/api/routes/positions.ts` — Current implementation using highWaterMark as currentPrice (line 86). Must be rewritten with queryPrice() calls.
- `src/api/server.ts` — WebSocket push logic, startApiServer function signature (must add registry param)

### Chain restart (being wired)
- `src/api/routes/chains.ts` — onRestart callback signature exists (line 29-41), POST /:name/start handler (line 138-178). Must receive and use the callback.
- `src/bot.ts` — startMultiChainBot() (line 908), startDexListener() (line 748), startApiServer call (line 966). Must pass registry and wire restart.

### Telegram listener (being integrated)
- `src/telegramListener.ts` — Standalone listener with main(), whitelist enforcement (lines 20-53), handleAlphaDrop integration (line 87). Must be refactored to export startTelegramListener().
- `src/alphaDrop.ts` — handleAlphaDrop() function called by telegram listener. Must be evaluated for multi-chain awareness.

### Price query (reused for live prices)
- `src/exitEngine.ts` — queryPrice() function used by exit engine for on-chain price queries. Same function to be called by positions API.

### Data layer
- `src/utils/db.ts` — getPnL(), getExitState, getTradeIdForPendingToken — used by positions API
- `src/chainRegistry.ts` — ChainConfig, ChainContext, buildChainRegistry() — needed for chain restart and price query resolution

### Prior phase context
- `.planning/phases/08-monitoring-web-dashboard/08-CONTEXT.md` — Dashboard architecture, WebSocket push, chain controls, API design
- `.planning/phases/10-partial-sell-revenue-fix/10-CONTEXT.md` — P&L aggregation with partial sells, exposure reduction
- `.planning/phases/07-smart-exit-strategies/07-CONTEXT.md` — Exit engine poll interval, queryPrice usage, exit_state table

### Codebase analysis
- `.planning/codebase/ARCHITECTURE.md` — Overall architecture layers
- `.planning/codebase/CONVENTIONS.md` — Code patterns to maintain

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `queryPrice()` in exitEngine.ts: Already queries live on-chain prices for both V2 and V3 pools. Accepts ChainContext, DexConfig, token, feeTier, buyAmountWei. Can be called directly from positions API.
- `chainRoutes()` onRestart callback: Signature and invocation logic already exist in chains.ts. Just needs a real callback to be passed from server.ts.
- Whitelist parsing in telegramListener.ts: allowedSenders/allowedChannels Sets with OR logic already implemented and tested.
- `buildChainRegistry()` / `getEnabledChains()`: Chain setup functions in bot.ts that can be passed to server.ts for restart wiring.
- `startDexListener()`: Per-DEX listener setup in bot.ts — candidate for reuse in the restart callback.

### Established Patterns
- Parallel Promise.all for per-chain operations (used in chains.ts GET /)
- asyncHandler wrapper in route files for error propagation
- ChainContext[] passed to route factories for direct state access
- exitConfig imported directly from exitEngine for config values
- In-memory Sets for fast lookup (stoppedChains, processedContracts, allowedSenders)

### Integration Points
- `startApiServer(contexts)` in bot.ts line 966 — add registry parameter here
- `chainRoutes(contexts, stoppedChains)` in server.ts line 64 — add onRestart callback here
- `startMultiChainBot()` in bot.ts — add startTelegramListener() call after chain listeners
- `initMultiChainShutdownHandler(contexts, apiServer)` in bot.ts — add TelegramClient disconnect
- WebSocket 5s push interval in server.ts — replace with buildPositionsWithLivePrices call

</code_context>

<specifics>
## Specific Ideas

- The shared `buildPositionsWithLivePrices(contexts)` function should return the same shape as the current positions endpoint but with accurate `currentPrice` and `unrealizedPnl` fields
- Net cost basis for unrealized P&L means subtracting partial sell revenue already received — aligns with Phase 10's exposure reduction pattern
- Multi-chain alpha routing (check contract on all chains via getCode) matches the "snipe on all matching chains" philosophy — each chain's risk gate independently decides
- Telegram status in health endpoint adds a new section alongside the per-chain status — simple boolean `telegramConnected` plus optional error message
- Chain restart with WS reconnection should follow the same WebSocket setup pattern used in bot.ts initial startup

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-dashboard-accuracy-bot-wiring*
*Context gathered: 2026-03-31*
