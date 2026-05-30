# Phase 11: Dashboard Accuracy & Bot Integration Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 11-dashboard-accuracy-bot-wiring
**Areas discussed:** Live price source, Chain restart wiring, Telegram integration, FIX-09 whitelist, WebSocket price push, Error handling scope, Testing strategy

---

## Live Price Source

| Option | Description | Selected |
|--------|-------------|----------|
| Read from exit engine state | Add currentPrice to in-memory state, updated every 5s poll. Zero latency, no extra RPC calls. | |
| Call queryPrice() per request | Positions API calls queryPrice() for each open position on every GET request. Freshest price. | ✓ |
| Store in exit_state DB table | Exit engine writes currentPrice to SQLite each poll cycle. Persists across restarts. | |

**User's choice:** Call queryPrice() per request
**Notes:** User chose freshest data over latency optimization.

### Staleness guard on failure

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to highWaterMark with flag | Return highWaterMark as currentPrice with priceStale: true field. | ✓ |
| Return null for currentPrice | Dashboard handles missing price display. | |
| Cache last successful price | Store last successful result with timestamp. | |

**User's choice:** Fall back to highWaterMark with flag

### Parallelism

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel with Promise.all | Query all positions concurrently. Fastest response time. | ✓ |
| Sequential per position | Query one at a time. Simpler error handling. | |

**User's choice:** Parallel with Promise.all

### Live unrealized P&L

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, compute live unrealized P&L | Calculate (currentPrice - entryPrice) / entryPrice. Real-time P&L per position. | ✓ |
| No, keep existing realized P&L only | currentPrice informational only. | |

**User's choice:** Yes, compute live unrealized P&L

### Net cost basis

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, net cost basis | Unrealized P&L accounts for partial sells already taken. | ✓ |
| Simple gross calculation | Ignores partial sells. Simple ratio. | |

**User's choice:** Yes, net cost basis

### Context resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Lookup from contexts + chain registry | Match chain name to ChainContext, then find DexConfig. | ✓ |
| Store DEX config ref in trades table | Add dex_name column. Requires schema migration. | |

**User's choice:** Lookup from contexts + chain registry

---

## Chain Restart Wiring

### Restart callback approach

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse startDexListener loop | onRestart iterates ctx.chain.dexes and calls startDexListener. | |
| New lightweight re-subscribe function | Dedicated resubscribeFactoryEvents. | |
| You decide | Claude picks during implementation. | ✓ |

**User's choice:** You decide

### MEV health check on restart

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, health check on restart | Run MEV healthCheck before re-attaching. Warn if unhealthy. | ✓ |
| No, skip MEV check | Periodic 5-min check covers it. | |

**User's choice:** Yes, health check on restart

### API parameter passing

| Option | Description | Selected |
|--------|-------------|----------|
| Pass registry to startApiServer | Add registry as second parameter. | ✓ |
| Build callback in bot.ts, pass to startApiServer | Bot.ts creates closure, passes to server.ts. | |

**User's choice:** Pass registry to startApiServer

### WS provider reconnection

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, reconnect WS provider | Create fresh WebSocketProvider if destroyed during stop. | ✓ |
| Assume WS is still alive | Stop only calls removeAllListeners, WS may still be connected. | |

**User's choice:** Yes, reconnect WS provider

---

## Telegram Integration

### Integration approach

| Option | Description | Selected |
|--------|-------------|----------|
| Export startTelegramListener() | Refactor to exportable function. Remove standalone main(). | ✓ |
| Keep as separate process | Leave standalone. Document separate startup. | |
| Import and call existing main() | Export main() as-is. Minimal refactor. | |

**User's choice:** Export startTelegramListener()

### Optional startup

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, optional with warning | Log warning and skip if Telegram env vars missing. | ✓ |
| Required, fail on missing vars | Bot refuses to start without Telegram. | |

**User's choice:** Yes, optional with warning

### Multi-chain awareness

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, make multi-chain aware | Pass ChainContext[] for cross-chain alpha routing. | ✓ |
| Keep single-chain for now | Works on default chain only. | |
| You decide | Claude evaluates complexity. | |

**User's choice:** Yes, make multi-chain aware

### Chain routing for alpha drops

| Option | Description | Selected |
|--------|-------------|----------|
| Detect from contract address | Check getCode() against each chain's RPC. Auto-routes. | ✓ |
| User specifies chain in message | Message includes chain hint prefix. | |
| Default chain with override | Default to ETH, optional chain prefix. | |

**User's choice:** Detect from contract address

### Multi-chain match behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Snipe on all matching chains | Trigger handleAlphaDrop on each chain where contract exists. | ✓ |
| First match wins | Check chains in priority order, snipe first match. | |
| You decide | Claude picks based on risk manager interaction. | |

**User's choice:** Snipe on all matching chains

### Health endpoint visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, in health endpoint | Add telegram connected/disconnected status to GET /health. | ✓ |
| No, keep dashboard chain-only | Don't mix telegram into health status. | |

**User's choice:** Yes, in health endpoint

### Graceful shutdown

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, graceful disconnect | Add TelegramClient.disconnect() to shutdown handler. | ✓ |
| Let it die with process | TelegramClient killed on process exit. | |

**User's choice:** Yes, graceful disconnect

---

## FIX-09 Whitelist

### Whitelist logic gate

| Option | Description | Selected |
|--------|-------------|----------|
| Keep OR logic | Passes if sender OR channel is whitelisted. | ✓ |
| AND logic when both configured | Both must match when both whitelists set. | |
| You decide | Claude picks based on security patterns. | |

**User's choice:** Keep OR logic

### Config source

| Option | Description | Selected |
|--------|-------------|----------|
| Keep env var reads | Continue reading from process.env inside telegramListener.ts. | ✓ |
| Pass as parameters | startTelegramListener(contexts, { allowedSenders, allowedChannels }). | |
| You decide | Claude picks based on refactoring scope. | |

**User's choice:** Keep env var reads

---

## WebSocket Price Push

### WS live prices

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, WS pushes live prices too | 5s WS push calls queryPrice() for each position. | ✓ |
| WS keeps existing data, REST has live | Only REST does live queryPrice(). WS continues with highWaterMark. | |
| You decide | Claude evaluates WS push code. | |

**User's choice:** Yes, WS pushes live prices too

### Shared logic

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, shared helper | Extract buildPositionsWithLivePrices() called by both REST and WS. | ✓ |
| Separate implementations | REST and WS each have own logic. | |

**User's choice:** Yes, shared helper

---

## Error Handling Scope

### Telegram failure at startup

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, log error and continue | Bot operates without telegram. | ✓ |
| Retry with backoff then continue | 3 reconnection attempts before giving up. | |

**User's choice:** Yes, log error and continue

### Chain restart partial failure

| Option | Description | Selected |
|--------|-------------|----------|
| Report partial success with details | Return 200 with ok:true and warnings array. | ✓ |
| Roll back to stopped state | All-or-nothing restart. | |
| You decide | Claude picks based on startDexListener error handling. | |

**User's choice:** Report partial success with details

---

## Testing Strategy

### Coverage level

| Option | Description | Selected |
|--------|-------------|----------|
| Unit + integration tests | Full coverage: mocked units + API surface tests. | ✓ |
| Integration tests only | Test through API surface only. | |
| Minimal smoke tests | Basic endpoint response tests. | |
| You decide | Claude matches Phase 9 patterns. | |

**User's choice:** Unit + integration tests

### Telegram multi-chain routing tests

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, test multi-chain routing | Mock getCode() responses, verify routing. | ✓ |
| Test startup only | Verify connection and handler registration. | |

**User's choice:** Yes, test multi-chain routing

---

## Claude's Discretion

- How to wire the onRestart callback (reuse startDexListener vs new re-subscribe function)
- Exact WebSocket provider reconnection implementation
- buildPositionsWithLivePrices DexConfig lookup logic
- queryPrice parameter construction from trade data
- TelegramClient disconnect handle exposure to shutdown handler
- Test file organization

## Deferred Ideas

None — discussion stayed within phase scope
