# Phase 12: Integration Gap Fixes - Research

**Researched:** 2026-04-04
**Domain:** SQLite schema migration, WebSocket event broadcasting, multi-dex price resolution, stale artifact cleanup
**Confidence:** HIGH

## Summary

Phase 12 closes three non-blocking integration gaps identified in the v6.16 milestone audit. INT-02 (multi-dex price resolution) requires a schema migration to add `dex_name` to the trades table, plus a fix in `positions.ts` to resolve the correct DexConfig by matching `dex_name` instead of first-matching on `dexType`. INT-03 (WebSocket chain status broadcast) requires importing the existing `broadcast()` function into `chains.ts` and calling it after stop/start operations, plus updating the client's event handler to match the chosen event type. INT-01 (stale artifacts) is a simple deletion of 28 `.js` files in `dashboard/src/` plus a `.gitignore` addition.

All three integration points use existing infrastructure -- no new libraries needed. The schema migration follows the established `user_version` pragma pattern from Phase 3. The WebSocket broadcast uses the existing `broadcast()` function from `broadcaster.ts`. The stale artifact cleanup is purely file deletion and `.gitignore` configuration.

**Primary recommendation:** Execute in three independent work streams: (1) schema migration + dex_name storage + positions.ts fix, (2) WebSocket chain status broadcast + client handler update, (3) stale artifact cleanup + gitignore. These have no interdependencies and can be planned as separate plans.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add `dex_name TEXT DEFAULT NULL` column to trades table via schema migration v5. `insertTrade` stores `dex.name` at snipe time.
- **D-02:** `positions.ts` matches trades to DexConfig using chain + pool_type + dex_name. When `dex_name` is non-NULL, it must match `dex.name` from the chain's dexes array.
- **D-03:** Existing trades with `dex_name = NULL` fall back to current first-match behavior. No data backfill.
- **D-04:** Surface `dex_name` in API output -- `getPnL` returns `dex_name` alongside `pool_type`.
- **D-05:** `queryPrice` keeps its existing `DexConfig` parameter signature. The fix is in `positions.ts` resolving the correct `DexConfig` before calling `queryPrice`.
- **D-06:** Import `broadcast()` directly in `chains.ts` from `broadcaster.ts`. Call it after successful stop/start operations. Event type: `'chain_status_change'`.
- **D-07:** Broadcast payload is the full chain list (same shape as GET /api/chains response). Dashboard replaces its entire chain state on receiving the event.
- **D-08:** Extract a shared `buildChainStatus(contexts, stoppedChains)` async helper from the existing GET / handler logic. Both the GET handler and stop/start handlers call it.
- **D-09:** Dashboard `WebSocketContext` dispatches a state update on `'chain_status_change'` event. ChainControls page re-renders automatically.
- **D-10:** Event type strings used inline. Only 2 WS event types total -- no constants file.
- **D-11:** On WS reconnect, client refetches chain status via REST. WS is for real-time updates after initial hydration.
- **D-12:** Delete all stale `.js` build artifacts from `dashboard/src/`.
- **D-13:** Add `dashboard/src/**/*.js` pattern to `.gitignore`.
- **D-14:** Migration v5 uses column-existence guard -- check if `dex_name` column already exists before ALTER TABLE.
- **D-15:** INT-02 (dex_name): Unit test `buildPositionsWithLivePrices` with mocked BSC contexts having 2 V3 dexes, plus integration test hitting `/api/positions` with seeded DB containing BSC V3 trades with `dex_name` values.
- **D-16:** INT-03 (WS broadcast): Unit test that stop/start handlers call `broadcast('chain_status_change', ...)` with correct payload, plus WebSocket integration test.

### Claude's Discretion
- Exact SQL for column-existence check in migration v5
- How to structure the `buildChainStatus` helper (sync vs async, parameter shape)
- Test file organization -- new files vs extending existing Phase 11 test files
- Whether `dex_name` column should have an index for query performance
- How WebSocketContext.js dispatches chain status updates (new state key, event handler pattern)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | Web dashboard displays real-time open positions with current P&L per token and chain | INT-02 fix ensures BSC PancakeSwap V3 positions get correct live price via proper dex resolution in positions.ts |
| DASH-03 | Bot controls accessible from dashboard (start/stop per chain, adjust snipe parameters) | INT-03 fix ensures chain start/stop events broadcast via WebSocket so all connected dashboard sessions update without page refresh |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | Schema migration for dex_name column | Already installed, used throughout for all DB operations [VERIFIED: package.json] |
| ws | (peer of express) | WebSocket broadcast infrastructure | Already in use via broadcaster.ts [VERIFIED: codebase inspection] |
| vitest | (installed) | Unit and integration testing | Established test framework for this project [VERIFIED: vitest.config.ts] |

### Supporting
No new libraries required. All changes use existing infrastructure.

## Architecture Patterns

### Recommended Change Structure
```
src/
  utils/db.ts              # Migration v5: add dex_name column
  api/helpers/positions.ts  # Fix dex resolution logic
  api/routes/chains.ts      # Add broadcast calls + extract buildChainStatus helper
  bot.ts                    # Add dexName param to insertTrade.run calls (3 call sites)
  exitEngine.ts             # Add dexName param to insertTrade.run calls (2 call sites)
dashboard/
  src/hooks/useWebSocket.ts # Update event type from 'chain_status' to 'chain_status_change'
  src/**/*.js               # DELETE 28 stale .js artifacts
.gitignore                  # Add dashboard/src/**/*.js pattern
test/
  unit/positionsHelper.test.ts   # Add multi-V3-dex test case
  integration/api/chains.test.ts # Add broadcast verification tests
```

### Pattern 1: Schema Migration (Established)
**What:** Add `dex_name TEXT DEFAULT NULL` column via `user_version` pragma guard
**When to use:** Any time the trades table schema changes
**Example:**
```typescript
// Source: src/utils/db.ts existing migration pattern (verified)
// CURRENT_SCHEMA_VERSION increments from 3 to 5 (skip 4 since user_version=4 may exist from partial runs)
// Actually: CURRENT_SCHEMA_VERSION should go to 4 -- version 4 has not been used
if (version < 4) {
    // Belt-and-suspenders: check column existence before ALTER
    const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
    const hasColumn = columns.some(c => c.name === 'dex_name');
    if (!hasColumn) {
        db.exec(`ALTER TABLE trades ADD COLUMN dex_name TEXT DEFAULT NULL`);
    }
    logger.info('Added dex_name column (schema version 4)');
}
db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
```
[VERIFIED: db.ts current schema is version 3, uses user_version pragma pattern]

### Pattern 2: Dex Resolution Fix
**What:** Match trades to DexConfig using chain + pool_type + dex_name instead of just pool_type
**When to use:** Any time a trade's DexConfig is needed for price queries
**Example:**
```typescript
// Source: positions.ts line 63 (verified bug location)
// BEFORE (bug): const dex = ctx?.chain.dexes.find(d => d.dexType === trade.pool_type) ?? null;
// AFTER (fix):
const dex = ctx?.chain.dexes.find(d => {
    if (d.dexType !== trade.pool_type) return false;
    // When dex_name is available (new trades), require exact match
    if (trade.dex_name) return d.name === trade.dex_name;
    // Legacy trades (dex_name NULL): fall back to first-match (D-03)
    return true;
}) ?? null;
```
[VERIFIED: positions.ts line 63 uses first-match, BSC chainRegistry has 2 V3 dexes]

### Pattern 3: Broadcast After Mutation
**What:** Call `broadcast()` after chain stop/start operations with full chain list
**When to use:** Any state mutation that other dashboard sessions need to see
**Example:**
```typescript
// Source: broadcaster.ts API (verified)
import { broadcast } from '../ws/broadcaster';

// After successful stop:
const chainList = await buildChainStatus(contexts, stoppedChains);
broadcast('chain_status_change', { chains: chainList });

// buildChainStatus returns same shape as GET / handler response
```
[VERIFIED: broadcast() accepts (type: string, data: unknown) and sends to all authenticated clients]

### Pattern 4: Extract buildChainStatus Helper (D-08)
**What:** Extract the chain status building logic from GET / handler into reusable async function
**When to use:** Called by both GET handler and stop/start handlers to ensure consistent response shape
**Recommendation:**
```typescript
// async because it calls ctx.httpProvider.getBlockNumber()
async function buildChainStatus(
    contexts: ChainContext[],
    stoppedChains: Set<string>
): Promise<Array<{name: string; displayName: string; status: string; /* ... */}>> {
    // Same logic currently in GET / handler (lines 48-101 of chains.ts)
}
```
[VERIFIED: GET handler at lines 48-101 of chains.ts builds chain status with async provider calls]

### Anti-Patterns to Avoid
- **First-match dex resolution:** Always use chain + pool_type + dex_name for disambiguation when dex_name is available. First-match only for legacy NULL dex_name trades.
- **Dual event type strings:** The client currently handles `'chain_status'` but D-06 specifies `'chain_status_change'`. Must update BOTH sides to use the same string. See Pitfall 1 below.
- **Modifying dist/ output to fix dashboard issues:** The stale `.js` files are in `dashboard/src/`, not `dashboard/dist/`. They are transpilation artifacts that Vite picks up as source, potentially causing confusion.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket broadcast | Custom socket management | `broadcast()` from broadcaster.ts | Already handles client tracking, readyState checks, JSON serialization [VERIFIED] |
| Schema migration | Manual SQL execution | `user_version` pragma pattern from db.ts | Established pattern with idempotent version guards [VERIFIED] |
| Column existence check | Try/catch around ALTER TABLE | `PRAGMA table_info('trades')` inspection | SQLite standard introspection, no exception handling needed [VERIFIED: SQLite docs] |

## Common Pitfalls

### Pitfall 1: WebSocket Event Type Mismatch (CRITICAL)
**What goes wrong:** Backend broadcasts `'chain_status_change'` (per D-06), but the client's `useWebSocket.ts` currently handles `'chain_status'` (line 83). Events are silently dropped.
**Why it happens:** The `.ts` source file (`useWebSocket.ts` line 83) already has a `'chain_status'` handler from Phase 8 planning, but it was never wired to receive events because the backend never broadcast them. D-06 uses a different event type name.
**How to avoid:** The client must be updated to handle `'chain_status_change'` instead of `'chain_status'`. Change the case label in `useWebSocket.ts` from `'chain_status'` to `'chain_status_change'`, and use the same string in `chains.ts` broadcast calls.
**Warning signs:** Chain status changes work on the initiating tab but not on other tabs.
[VERIFIED: useWebSocket.ts line 83 handles 'chain_status', CONTEXT.md D-06 specifies 'chain_status_change']

### Pitfall 2: ChainControls Uses useApi, Not useWs
**What goes wrong:** Even with WS broadcast working, ChainControls won't react to WS events because it reads chain data from `useApi('/api/chains')`, not from `useWs().chainStatuses`.
**Why it happens:** ChainControls was built in Phase 8 before WS chain status broadcasting was planned.
**How to avoid:** ChainControls.tsx must either (a) switch to consuming `useWs().chainStatuses` directly, or (b) keep `useApi` but the WS event handler needs to trigger a refetch. Option (a) is cleaner and matches the Overview page pattern which uses `useWs()` for positions.
**Warning signs:** Chain status updates arrive at the WS hook but ChainControls does not re-render.
[VERIFIED: ChainControls.tsx imports useApi not useWs; Overview.tsx uses useWs() for real-time data]

### Pitfall 3: insertTrade Prepared Statement Parameter Mismatch
**What goes wrong:** Adding `@dexName` to the INSERT SQL but forgetting to pass `dexName` in one of the 5 call sites causes a SQLite binding error at runtime.
**Why it happens:** `insertTrade.run()` is called in 5 different places across 2 files (3 in bot.ts, 2 in exitEngine.ts). Easy to miss one.
**How to avoid:** After modifying the prepared statement, grep for all `insertTrade.run(` call sites and verify each passes `dexName`.
**Warning signs:** SQLite binding error on first trade attempt.
**Call sites found:**
1. `bot.ts:325` -- handleNewPairForChain (V2 buy, has `dex` in scope)
2. `bot.ts:511` -- handleNewV3PoolForChain (V3 buy, has `dex` in scope)
3. `bot.ts:678` -- legacy handleNewPair (no multi-chain `dex`, use `null`)
4. `exitEngine.ts:472` -- executeFullSell (has `dex` in scope)
5. `exitEngine.ts:567` -- partial sell (has `dex` in scope)
[VERIFIED: grep of all insertTrade.run call sites]

### Pitfall 4: Schema Migration Version Number
**What goes wrong:** Using version 5 as stated in CONTEXT.md D-01, but current schema is version 3. Versions 4 and 5 would both run on first migration, but only version 5 is defined.
**Why it happens:** CONTEXT.md says "schema migration v5" but the current CURRENT_SCHEMA_VERSION is 3.
**How to avoid:** Use version 4 (the next sequential version). CURRENT_SCHEMA_VERSION goes from 3 to 4. The `if (version < 4)` guard handles the dex_name column addition.
**Warning signs:** `user_version` gap (3 to 5) leaves version 4 unused.
[VERIFIED: db.ts CURRENT_SCHEMA_VERSION = 3]

### Pitfall 5: Stale .js Files May Include Non-Artifact Files
**What goes wrong:** Blindly deleting all `.js` files in `dashboard/src/` might remove legitimate source files that don't have `.ts`/`.tsx` counterparts.
**Why it happens:** Some files might intentionally be plain JS (config files, polyfills).
**How to avoid:** Cross-reference: every `.js` file in `dashboard/src/` has a corresponding `.ts` or `.tsx` file. Verified: all 28 `.js` files have matching `.ts`/`.tsx` sources. The `.js` files are Vite/TypeScript transpilation output.
**Warning signs:** Dashboard build failure after deletion.
[VERIFIED: all 28 .js files have matching .ts/.tsx counterparts]

### Pitfall 6: getPnL Query Needs dex_name in SELECT
**What goes wrong:** D-04 says `getPnL` should return `dex_name` alongside `pool_type`, but the SELECT clause doesn't include it.
**Why it happens:** The getPnL query was written before the `dex_name` column existed.
**How to avoid:** Add `b.dex_name` to the SELECT list in `getPnLQuery`, and add `dex_name` to the `PnLResult` interface.
**Warning signs:** `positions.ts` can't access `trade.dex_name` for dex resolution.
[VERIFIED: getPnLQuery SELECT does not include dex_name, PnLResult interface lacks dex_name]

## Code Examples

### Schema Migration v4: Add dex_name Column
```typescript
// Source: db.ts migration pattern (verified existing pattern in db.ts lines 29-113)
const CURRENT_SCHEMA_VERSION = 4; // was 3

// Inside migrateSchema():
if (version < 4) {
    // D-14: Belt-and-suspenders column-existence guard
    const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
    const hasColumn = columns.some(c => c.name === 'dex_name');
    if (!hasColumn) {
        db.exec(`ALTER TABLE trades ADD COLUMN dex_name TEXT DEFAULT NULL`);
    }
    logger.info('Added dex_name column (schema version 4)');
}
```

### Updated insertTrade Prepared Statement
```typescript
// Source: db.ts line 167-170 (verified current statement)
const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status, pool_type, fee_tier, dex_name)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status, @poolType, @feeTier, @dexName)
`);
```

### Updated Dex Resolution in positions.ts
```typescript
// Source: positions.ts line 63 (verified bug location)
const dex = ctx?.chain.dexes.find(d => {
    if (d.dexType !== trade.pool_type) return false;
    if (trade.dex_name) return d.name === trade.dex_name;
    return true; // Legacy fallback for NULL dex_name (D-03)
}) ?? null;
```

### buildChainStatus Helper Extraction
```typescript
// Source: chains.ts lines 48-101 (verified existing logic)
async function buildChainStatus(
    contexts: ChainContext[],
    stoppedChains: Set<string>
) {
    return Promise.all(
        contexts.map(async (ctx) => {
            // ... exact same logic as current GET / handler body ...
        })
    );
}
```

### Broadcast After Stop/Start
```typescript
// Source: chains.ts stop handler (verified) + broadcaster.ts API (verified)
import { broadcast } from '../ws/broadcaster';

// After stoppedChains.add(ctx.chain.name):
const chainList = await buildChainStatus(contexts, stoppedChains);
broadcast('chain_status_change', { chains: chainList });
```

### Client Event Type Update
```typescript
// Source: useWebSocket.ts line 83 (verified current code)
// Change from: case 'chain_status':
// Change to:
case 'chain_status_change': {
    const data = msg.data as { chains: ChainStatus[] };
    setChainStatuses(data.chains || []);
    break;
}
```

### Stale Artifact File List (28 files)
```
dashboard/src/App.js
dashboard/src/components/ChainBadge.js
dashboard/src/components/ChainStatusCard.js
dashboard/src/components/ConfirmDialog.js
dashboard/src/components/EmergencyConfirmDialog.js
dashboard/src/components/EventFeed.js
dashboard/src/components/ExposureDonut.js
dashboard/src/components/FilterChips.js
dashboard/src/components/Layout.js
dashboard/src/components/LoginForm.js
dashboard/src/components/PnLChart.js
dashboard/src/components/PositionTable.js
dashboard/src/components/RiskGauge.js
dashboard/src/components/Sidebar.js
dashboard/src/components/StatCard.js
dashboard/src/components/StatusDot.js
dashboard/src/components/TimeRangeSelector.js
dashboard/src/components/TradeTable.js
dashboard/src/hooks/useApi.js
dashboard/src/hooks/useWebSocket.js
dashboard/src/hooks/WebSocketContext.js
dashboard/src/main.js
dashboard/src/pages/ChainControls.js
dashboard/src/pages/Login.js
dashboard/src/pages/Overview.js
dashboard/src/pages/RiskExposure.js
dashboard/src/pages/TradeHistory.js
dashboard/src/types/api.js
dashboard/src/utils/formatters.js
```
[VERIFIED: find command found all 28 .js files, each has matching .ts/.tsx source]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| First-match dex resolution by pool_type | Match by chain + pool_type + dex_name | Phase 12 (this phase) | Correct price for multi-dex chains |
| Chain status via REST polling only | REST + WebSocket push on mutations | Phase 12 (this phase) | Real-time multi-tab consistency |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CURRENT_SCHEMA_VERSION should go to 4 (not 5 as CONTEXT.md D-01 says) since current version is 3 | Architecture Patterns | Migration may skip intended version checks if 5 is used, but functionality is identical -- the version number is arbitrary as long as it's > 3 |
| A2 | The `dex_name` column does not need an index since it's only used in application-level matching (not in SQL WHERE clauses) | Claude's Discretion | Minor -- if future queries filter by dex_name, an index would be needed, but current usage is post-query filtering in positions.ts |
| A3 | ChainControls should switch from useApi to useWs for chain data to achieve D-09's "re-renders automatically" goal | Pitfall 2 | If useApi is kept, a separate mechanism to trigger refetch on WS events would be needed |

## Open Questions (RESOLVED)

1. **Event type: `'chain_status_change'` vs `'chain_status'`**
   - What we know: CONTEXT.md D-06 specifies `'chain_status_change'`. The client already has a handler for `'chain_status'` (from Phase 8 planning). Neither has been wired end-to-end.
   - What's unclear: Whether the user intended to reuse the existing client handler name or intentionally chose a different name.
   - Recommendation: Follow D-06 and use `'chain_status_change'` on both sides. Update the client from `'chain_status'` to `'chain_status_change'`. The existing handler was never functional, so changing its name has zero behavioral impact.
   - RESOLVED: Per D-06, event type is `'chain_status_change'`. Plan 12-02 Task 1 broadcasts with this type, Task 2 updates the client handler from `'chain_status'` to `'chain_status_change'`.

2. **ChainControls data source: useApi vs useWs**
   - What we know: D-09 says "ChainControls page re-renders automatically" on WS event. Currently it uses `useApi` (REST polling).
   - What's unclear: Whether to fully replace `useApi` with `useWs()` or add WS as supplementary.
   - Recommendation: Keep `useApi` for initial load and refetch on user actions (stop/start), but also consume `useWs().chainStatuses` and merge/prefer WS data when available. This matches the hybrid pattern -- REST for initial state (D-11), WS for real-time updates.
   - RESOLVED: Per D-09 and D-11, hybrid approach adopted. Plan 12-02 Task 2 wires ChainControls to consume `useWebSocket().chainStatuses` for real-time updates while keeping `useApi` for initial REST load.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (installed) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --project unit --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 (INT-02) | BSC PancakeSwap V3 position gets correct quoter via dex_name match | unit | `npx vitest run test/unit/positionsHelper.test.ts -t "dex_name" -x` | Extends existing |
| DASH-01 (INT-02) | dex_name column exists after migration v4 | unit | `npx vitest run test/unit/db.test.ts -t "dex_name" -x` | Extends existing |
| DASH-01 (INT-02) | insertTrade stores dex_name, getPnL returns it | unit | `npx vitest run test/unit/db.test.ts -t "dex_name" -x` | Extends existing |
| DASH-03 (INT-03) | Chain stop broadcasts chain_status_change event | unit | `npx vitest run test/integration/api/chains.test.ts -t "broadcast" -x` | Extends existing |
| DASH-03 (INT-03) | Chain start broadcasts chain_status_change event | unit | `npx vitest run test/integration/api/chains.test.ts -t "broadcast" -x` | Extends existing |
| DASH-03 (INT-03) | WS client receives chain_status_change after chain stop | integration | `npx vitest run test/integration/api/wsPush.test.ts -t "chain_status" -x` | Extends existing |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/helpers/testDb.ts` -- needs update: add `dex_name` column to in-memory schema (currently schema version 3, needs version 4)
- [ ] `test/fixtures/api.fixtures.ts` -- may need BSC mock context with multiple V3 dexes for multi-dex tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (no auth changes) |
| V3 Session Management | no | N/A (no session changes) |
| V4 Access Control | no | N/A (broadcast only to authenticated WS clients, already enforced by broadcaster.ts) |
| V5 Input Validation | yes | dex_name stored as-is from trusted DexConfig.name (not user input); SQL parameterized via prepared statements |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via dex_name | Tampering | Parameterized prepared statement (@dexName binding) -- already the project pattern [VERIFIED] |
| Unauthenticated WS broadcast | Information Disclosure | broadcaster.ts only sends to authenticatedClients set -- verified in source [VERIFIED] |

No new security concerns. All changes use existing parameterized SQL and authenticated WebSocket infrastructure.

## Sources

### Primary (HIGH confidence)
- `src/utils/db.ts` -- Schema migration pattern, prepared statements, current version (3)
- `src/api/helpers/positions.ts` -- Bug at line 63 (first-match dex resolution)
- `src/api/routes/chains.ts` -- Stop/start handlers, GET / status builder
- `src/api/ws/broadcaster.ts` -- `broadcast()` function signature and behavior
- `src/chainRegistry.ts` -- BSC dexes array with 2 V3 entries (lines 159-171)
- `src/bot.ts` -- 3 insertTrade.run() call sites with dex in scope
- `src/exitEngine.ts` -- 2 insertTrade.run() call sites with dex in scope
- `dashboard/src/hooks/useWebSocket.ts` -- Client WS handler with 'chain_status' event type (line 83)
- `dashboard/src/pages/ChainControls.tsx` -- Uses useApi, not useWs
- `dashboard/src/pages/Overview.tsx` -- Uses useWs() for real-time data (pattern reference)
- `.planning/phases/12-integration-gap-fixes/12-CONTEXT.md` -- All implementation decisions
- `.planning/v6.16-MILESTONE-AUDIT.md` -- INT-01, INT-02, INT-03 gap definitions
- `vitest.config.ts` -- Test framework configuration
- `test/helpers/testDb.ts` -- In-memory test DB factory (current schema v3)
- `test/unit/positionsHelper.test.ts` -- Existing positions helper tests
- `test/integration/api/chains.test.ts` -- Existing chains route tests
- `test/integration/api/wsPush.test.ts` -- Existing WS broadcast tests
- `test/fixtures/api.fixtures.ts` -- Mock ChainContext factory

### Secondary (MEDIUM confidence)
- SQLite `PRAGMA table_info()` for column existence checking [CITED: https://www.sqlite.org/pragma.html#pragma_table_info]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all existing libraries, no new dependencies
- Architecture: HIGH -- all patterns verified against actual source code
- Pitfalls: HIGH -- all 6 pitfalls verified through codebase inspection with exact line numbers
- Test strategy: HIGH -- extending existing test files with established patterns

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (stable codebase, no external dependency changes)
