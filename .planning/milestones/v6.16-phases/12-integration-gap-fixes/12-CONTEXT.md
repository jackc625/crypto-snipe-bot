# Phase 12: Integration Gap Fixes - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Close three non-blocking integration gaps found in v6.16 milestone audit: (1) multi-dex price resolution so BSC PancakeSwap V3 positions get the correct quoter address, (2) WebSocket broadcast of chain start/stop events so all connected dashboard sessions update without page refresh, and (3) stale .js build artifact cleanup across dashboard/src/. Also includes schema migration for dex_name tracking. No new trading logic, no new dashboard pages, no new exit strategies.

</domain>

<decisions>
## Implementation Decisions

### Multi-dex price resolution (INT-02)
- **D-01:** Add `dex_name TEXT DEFAULT NULL` column to trades table via schema migration v5. `insertTrade` stores `dex.name` at snipe time. New trades are always tagged with their DEX identity.
- **D-02:** `positions.ts` matches trades to DexConfig using chain + pool_type + dex_name. When `dex_name` is non-NULL, it must match `dex.name` from the chain's dexes array. This resolves the BSC first-match bug where PancakeSwap V3 trades got Uniswap V3's quoter.
- **D-03:** Existing trades with `dex_name = NULL` fall back to current first-match behavior (`dex.find(d => d.dexType === trade.pool_type)`). No data backfill — only new trades benefit from precise dex matching.
- **D-04:** Surface `dex_name` in API output — `getPnL` returns `dex_name` alongside `pool_type` so trade history and positions endpoints can display which DEX each trade used.
- **D-05:** `queryPrice` keeps its existing `DexConfig` parameter signature. The fix is in `positions.ts` resolving the correct `DexConfig` before calling `queryPrice` — no exitEngine changes needed.

### WebSocket chain status broadcast (INT-03)
- **D-06:** Import `broadcast()` directly in `chains.ts` from `broadcaster.ts`. Call it after successful stop/start operations. Event type: `'chain_status_change'`.
- **D-07:** Broadcast payload is the full chain list (same shape as GET /api/chains response). Dashboard replaces its entire chain state on receiving the event — guarantees consistency.
- **D-08:** Extract a shared `buildChainStatus(contexts, stoppedChains)` async helper from the existing GET / handler logic. Both the GET handler and stop/start handlers call it. DRY and ensures broadcast data matches REST response exactly.
- **D-09:** Dashboard `WebSocketContext` dispatches a state update on `'chain_status_change'` event. ChainControls page re-renders automatically — seamless multi-tab experience.
- **D-10:** Event type strings used inline (`'chain_status_change'`, `'positions_update'`). Only 2 WS event types total — a constants file would be overengineering.
- **D-11:** On WS reconnect, client refetches chain status via REST (GET /api/chains) — existing page load behavior. WS is for real-time updates after initial hydration, not initial state delivery.

### Stale artifact cleanup (INT-01)
- **D-12:** Delete all stale `.js` build artifacts from `dashboard/src/` — components, hooks, pages, types, utils. These are untracked Vite/TS compilation output with matching `.tsx` sources as the committed truth.
- **D-13:** Add `dashboard/src/**/*.js` pattern to `.gitignore` to prevent build artifacts from reappearing in git status.

### Schema migration safety
- **D-14:** Migration v5 uses column-existence guard — check if `dex_name` column already exists before ALTER TABLE, in addition to the standard `user_version` check. Belt-and-suspenders for partial run resilience.

### Testing
- **D-15:** INT-02 (dex_name): Unit test `buildPositionsWithLivePrices` with mocked BSC contexts having 2 V3 dexes, plus integration test hitting `/api/positions` with seeded DB containing BSC V3 trades with `dex_name` values.
- **D-16:** INT-03 (WS broadcast): Unit test that stop/start handlers call `broadcast('chain_status_change', ...)` with correct payload, plus WebSocket integration test — connect WS client, trigger chain stop via HTTP, verify client receives the event.

### Claude's Discretion
- Exact SQL for column-existence check in migration v5
- How to structure the `buildChainStatus` helper (sync vs async, parameter shape)
- Test file organization — new files vs extending existing Phase 11 test files
- Whether `dex_name` column should have an index for query performance
- How WebSocketContext.js dispatches chain status updates (new state key, event handler pattern)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone audit (gap source)
- `.planning/v6.16-MILESTONE-AUDIT.md` — INT-01, INT-02, INT-03 gap definitions, severity, affected requirements

### Requirements
- `.planning/REQUIREMENTS.md` — DASH-01 (real-time positions with P&L), DASH-03 (bot controls from dashboard)

### Multi-dex resolution (INT-02)
- `src/api/helpers/positions.ts` — `buildPositionsWithLivePrices()`, line 63 dex resolution bug (first-match on `dexType`)
- `src/utils/db.ts` — `insertTrade` prepared statement (line 167), `getPnL` query, schema migrations
- `src/chainRegistry.ts` — BSC dexes array with 2 V3 entries (Uniswap V3 + PancakeSwap V3 at line 165)
- `src/exitEngine.ts` — `queryPrice()` function, `dex.name` usage at line 818

### WebSocket broadcast (INT-03)
- `src/api/routes/chains.ts` — Stop/start handlers, GET / status builder, `RestartChainListenersCallback` type
- `src/api/ws/broadcaster.ts` — `broadcast()` function, `addClient()`, `getClientCount()`
- `src/api/server.ts` — WebSocket setup, existing `positions_update` broadcast interval (line 93)
- `dashboard/src/hooks/WebSocketContext.js` — WS event handler, client-side state management

### Stale artifacts (INT-01)
- `dashboard/src/components/TradeTable.js` — Stale .js artifact (untracked)
- `dashboard/src/components/TradeTable.tsx` — Committed .tsx source (verified correct in Phase 10)

### Prior phase context
- `.planning/phases/11-dashboard-accuracy-bot-wiring/11-CONTEXT.md` — D-04: DexConfig resolution, D-06/D-08: shared positions helper, D-09: onRestart callback
- `.planning/phases/10-partial-sell-revenue-fix/10-CONTEXT.md` — P&L query patterns, sell_revenue aggregation
- `.planning/phases/08-monitoring-web-dashboard/08-CONTEXT.md` — Dashboard architecture, WebSocket push, chain controls

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `broadcast()` in broadcaster.ts: Ready to use for chain status events — just needs to be called from chains.ts
- `buildPositionsWithLivePrices()` in positions.ts: Phase 11 helper that needs the dex resolution fix applied
- `queryPrice()` in exitEngine.ts: Already accepts DexConfig parameter — no changes needed, just pass the correct one
- `user_version` pragma migration pattern in db.ts: Established pattern for schema versioning

### Established Patterns
- Prepared statements with inline SQL in db.ts
- `broadcast(type, data)` for WS events with `{ type, data, timestamp }` envelope
- `asyncHandler` wrapper in route files for error propagation
- `ChainContext[]` passed to route factories
- Phase 3 `user_version` pragma for DB schema migrations
- `.gitignore` patterns for build output (dist/ already ignored)

### Integration Points
- `insertTrade.run()` in db.ts — add `@dexName` parameter for new `dex_name` column
- `getPnL()` query — add `dex_name` to SELECT output
- `chains.ts` stop/start handlers — add `broadcast()` call after success
- `WebSocketContext.js` — add `'chain_status_change'` event handler
- `.gitignore` — add `dashboard/src/**/*.js` pattern

</code_context>

<specifics>
## Specific Ideas

- The `buildChainStatus` helper should produce the exact same JSON shape as the current GET / handler, extracted as a reusable function within chains.ts
- The dex_name match in positions.ts should be: if `trade.dex_name` exists, find `dex` where `dex.name === trade.dex_name` AND `dex.dexType === trade.pool_type`; if NULL, fall back to existing `dex.find(d => d.dexType === trade.pool_type)`
- The WS integration test can follow the Phase 11 pattern (11-04-PLAN WS push test) — connect authenticated WS client, trigger chain action via HTTP, assert event received

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-integration-gap-fixes*
*Context gathered: 2026-04-04*
